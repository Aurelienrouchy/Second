/** One seller statement about one entire article/set unit and its listing. A hash
 * identifies this content; it does not identify a physical item across drafts
 * and does not certify ownership, authenticity or photo rights. */
import { createHash } from 'node:crypto';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { childSafetyStatementProjection } from '../shared/articleChildSafety';

export const ARTICLE_SALE_DECLARATION_VERSION = 'personal_item_v3';
/** Technical receipt of published content, never a seller authenticity or
 * physical-identity statement. New listings require no separate declaration. */
export const LISTING_CONTENT_VERSION = 'listing_content_v2';
const LEGACY_LISTING_CONTENT_VERSION = 'listing_content_v1';
export const isListingContentVersion = (value: unknown): value is 'listing_content_v1' | 'listing_content_v2' =>
  value === LEGACY_LISTING_CONTENT_VERSION || value === LISTING_CONTENT_VERSION;
const SALE_UNIT_DECLARATION_VERSION = 'personal_item_v2';
const LEGACY_SALE_DECLARATION_VERSION = 'personal_item_v1';
export const ARTICLE_SALE_UNITS = ['single_article', 'set_as_one'] as const;
export type ArticleSaleUnit = typeof ARTICLE_SALE_UNITS[number];
export const ARTICLE_COUNTERFEIT_STATUSES = ['not_counterfeit', 'declared_counterfeit'] as const;
export type ArticleCounterfeitStatus = typeof ARTICLE_COUNTERFEIT_STATUSES[number];
export const SALE_DECLARATION_CONTENT_FIELDS = ['quantity', 'stock', 'title', 'description', 'category', 'categoryIds', 'condition',
  'brandStatus', 'brand', 'size', 'colors', 'color', 'materials', 'material', 'hasKnownDefects', 'defectsDescription',
  'hasAlterations', 'alterationsDescription', 'images', 'hygieneDeclaration', 'saleUnit', 'childSafetyDeclaration'] as const;
const LISTING_CONTENT_V1_FIELDS = SALE_DECLARATION_CONTENT_FIELDS.filter(field =>
  !['brandStatus', 'hasAlterations', 'alterationsDescription', 'saleUnit'].includes(field));
const LISTING_CONTENT_V2_FIELDS = LISTING_CONTENT_V1_FIELDS.filter(field =>
  !['hasKnownDefects', 'defectsDescription'].includes(field));
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function saleDeclarationContent(article: FirebaseFirestore.DocumentData, projectionVersion?: string) {
  const version = projectionVersion ?? article.saleDeclaration?.version;
  // Explicit legacy projections ignore even a forged/new unsupported field.
  // A prospective V3 declaration supplies its version before it is committed.
  const fields = version === LISTING_CONTENT_VERSION ? LISTING_CONTENT_V2_FIELDS :
    version === LEGACY_LISTING_CONTENT_VERSION ? LISTING_CONTENT_V1_FIELDS :
    version === ARTICLE_SALE_DECLARATION_VERSION ? [...SALE_DECLARATION_CONTENT_FIELDS, 'counterfeitStatus'] : SALE_DECLARATION_CONTENT_FIELDS;
  return Object.fromEntries(fields.filter(field => !['saleUnit', 'childSafetyDeclaration'].includes(field) || article[field] !== undefined).map(field => {
    if (field === 'images') return [field, Array.isArray(article.images) ? article.images.map(image =>
      typeof image === 'string' ? image : typeof image?.url === 'string' ? image.url : null) : null];
    if (field === 'hygieneDeclaration') {
      const native = article.hygieneDeclaration;
      return [field, native && typeof native === 'object' && !Array.isArray(native) ? Object.fromEntries(
        ['schemaVersion', 'kind', 'neverWorn', 'isNew', 'isSealed', 'categoryIds'].map(key => [key, native[key] ?? null])) : null];
    }
    if (field === 'childSafetyDeclaration') return [field, childSafetyStatementProjection(article.childSafetyDeclaration)];
    return [field, article[field] ?? null];
  }));
}
export function recordArticleListingContent(articleId: string, article: FirebaseFirestore.DocumentData, actorUid: string,
  requestHash: string, previousContentHash: string | null) {
  assertSingleArticleInput(article, true);
  if (article.sellerId !== actorUid) throw new HttpsError('permission-denied', 'Pas votre annonce.');
  return { schemaVersion: 1, version: LISTING_CONTENT_VERSION, scope: 'single_listing', source: 'seller_publication',
    articleId, actorUid, quantity: 1, contentHash: saleDeclarationContentHash(articleId, article, LISTING_CONTENT_VERSION),
    declaredAt: Timestamp.now(), requestHash, previousContentHash };
}
export function saleDeclarationContentHash(articleId: string, article: FirebaseFirestore.DocumentData, projectionVersion?: string): string {
  return hash([articleId, article.sellerId, saleDeclarationContent(article, projectionVersion)]);
}
/** FieldValue.delete is a command, not content. Hash the resulting stored
 * value, including removal of a formerly identified brand. */
export function mergeSaleDeclarationContent(article: FirebaseFirestore.DocumentData, updates: Record<string, unknown>) {
  const result = { ...article };
  for (const [key, value] of Object.entries(updates)) {
    if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete result[key];
    else result[key] = value;
  }
  return result;
}
export function assertSingleArticleInput(input: Record<string, unknown>, requireQuantity = false): void {
  if (requireQuantity && input.quantity !== 1 || 'quantity' in input && input.quantity !== 1 || 'stock' in input && input.stock !== 1) {
    throw new HttpsError('invalid-argument', 'Une annonce doit proposer une seule unité entière : article ou ensemble vendu comme un tout, quantité 1, sans stock multiple.',
      { reason: 'article_single_specimen_required', field: 'quantity' });
  }
}
export function assertSaleDeclarationInput(raw: unknown, historicalReceipt = false): void {
  const value = raw as any;
  if (historicalReceipt && value?.version === LEGACY_SALE_DECLARATION_VERSION && value.accepted === true &&
      typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw!).sort().join(',') === 'accepted,version') return;
  if (historicalReceipt && value?.version === SALE_UNIT_DECLARATION_VERSION && value.accepted === true &&
      typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw!).sort().join(',') === 'accepted,saleUnit,version' &&
      (ARTICLE_SALE_UNITS as readonly unknown[]).includes(value.saleUnit)) return;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['version', 'accepted', 'saleUnit', 'counterfeitStatus'].includes(key)) ||
      value.version !== ARTICLE_SALE_DECLARATION_VERSION || value.accepted !== true) {
    throw new HttpsError('failed-precondition', 'Confirmez explicitement la déclaration sur l’unité entière proposée, son contenu et les droits nécessaires.',
      { reason: 'article_sale_declaration_required', field: 'saleDeclaration', declarationVersion: ARTICLE_SALE_DECLARATION_VERSION });
  }
  if (value.saleUnit === 'independent_lot') throw new HttpsError('failed-precondition',
    'Les lots d’articles indépendants ne sont pas admis au lancement. Publiez des annonces distinctes ou un ensemble vendu comme un tout.',
    { reason: 'article_independent_lot_not_admitted', field: 'saleDeclaration.saleUnit', declarationVersion: ARTICLE_SALE_DECLARATION_VERSION });
  if (!(ARTICLE_SALE_UNITS as readonly unknown[]).includes(value.saleUnit)) throw new HttpsError('failed-precondition',
    'Choisissez explicitement un article ou un ensemble vendu comme un tout.',
    { reason: 'article_sale_unit_required', field: 'saleDeclaration.saleUnit', declarationVersion: ARTICLE_SALE_DECLARATION_VERSION });
  if (value.counterfeitStatus === 'declared_counterfeit') throw new HttpsError('failed-precondition',
    'Un article contrefait ou une réplique de marque non autorisée ne peut pas être proposé, même en le déclarant dans l’annonce.',
    { reason: 'article_declared_counterfeit_not_admitted', field: 'saleDeclaration.counterfeitStatus', declarationVersion: ARTICLE_SALE_DECLARATION_VERSION });
  if (value.counterfeitStatus !== 'not_counterfeit') throw new HttpsError('failed-precondition',
    'Indiquez explicitement si cet article est contrefait ou une réplique de marque non autorisée. Cette déclaration ne certifie pas son authenticité.',
    { reason: 'article_counterfeit_declaration_required', field: 'saleDeclaration.counterfeitStatus', declarationVersion: ARTICLE_SALE_DECLARATION_VERSION });
}
export function declaredArticleSale(articleId: string, article: FirebaseFirestore.DocumentData, actorUid: string,
  input: unknown, requestHash: string, previousContentHash: string | null) {
  assertSaleDeclarationInput(input); assertSingleArticleInput(article, true);
  if (article.sellerId !== actorUid) throw new HttpsError('permission-denied', 'Pas votre annonce.');
  const saleUnit = (input as {saleUnit: ArticleSaleUnit}).saleUnit;
  const counterfeitStatus = (input as {counterfeitStatus: ArticleCounterfeitStatus}).counterfeitStatus;
  if (article.saleUnit !== saleUnit) throw new HttpsError('failed-precondition', 'Le choix de l’unité doit être figé dans le contenu examiné.');
  if (article.counterfeitStatus !== counterfeitStatus) throw new HttpsError('failed-precondition', 'La déclaration sur la contrefaçon doit être figée dans le contenu examiné.');
  return { schemaVersion: 1, version: ARTICLE_SALE_DECLARATION_VERSION, scope: 'single_personal_sale_unit_and_listing', saleUnit, counterfeitStatus,
    source: 'seller_explicit_statement', accepted: true, articleId, actorUid, quantity: 1,
    contentHash: saleDeclarationContentHash(articleId, article, ARTICLE_SALE_DECLARATION_VERSION), declaredAt: Timestamp.now(), requestHash, previousContentHash };
}
export function qualifiedArticleSaleDeclaration(articleId: string, article: FirebaseFirestore.DocumentData): boolean {
  const declaration = article.saleDeclaration;
  if (isListingContentVersion(declaration?.version)) {
    return article.quantity === 1 && (!Object.prototype.hasOwnProperty.call(article, 'stock') || article.stock === 1) &&
      declaration.schemaVersion === 1 && declaration.scope === 'single_listing' && declaration.source === 'seller_publication' &&
      !['accepted', 'saleUnit', 'counterfeitStatus'].some(field => Object.prototype.hasOwnProperty.call(declaration, field)) &&
      declaration.articleId === articleId && declaration.actorUid === article.sellerId && declaration.quantity === 1 &&
      declaration.declaredAt instanceof Timestamp && declaration.declaredAt.toMillis() > 0 && declaration.declaredAt.toMillis() <= Date.now() + 60_000 &&
      typeof declaration.requestHash === 'string' && /^[a-f0-9]{64}$/.test(declaration.requestHash) &&
      (declaration.previousContentHash === null || typeof declaration.previousContentHash === 'string' && /^[a-f0-9]{64}$/.test(declaration.previousContentHash)) &&
      declaration.contentHash === saleDeclarationContentHash(articleId, article, declaration.version);
  }
  return article.quantity === 1 && (!Object.prototype.hasOwnProperty.call(article, 'stock') || article.stock === 1) && declaration?.schemaVersion === 1 &&
    (declaration.version === LEGACY_SALE_DECLARATION_VERSION && declaration.scope === 'single_personal_specimen_and_listing' ||
      [SALE_UNIT_DECLARATION_VERSION, ARTICLE_SALE_DECLARATION_VERSION].includes(declaration.version) && declaration.scope === 'single_personal_sale_unit_and_listing' &&
      (ARTICLE_SALE_UNITS as readonly unknown[]).includes(article.saleUnit) && declaration.saleUnit === article.saleUnit &&
      (declaration.version !== ARTICLE_SALE_DECLARATION_VERSION || (ARTICLE_COUNTERFEIT_STATUSES as readonly unknown[]).includes(article.counterfeitStatus) &&
        declaration.counterfeitStatus === article.counterfeitStatus)) &&
    declaration.source === 'seller_explicit_statement' && declaration.accepted === true && declaration.articleId === articleId &&
    declaration.actorUid === article.sellerId && declaration.quantity === 1 && declaration.declaredAt instanceof Timestamp &&
    declaration.declaredAt.toMillis() > 0 && declaration.declaredAt.toMillis() <= Date.now() + 60_000 &&
    typeof declaration.requestHash === 'string' && /^[a-f0-9]{64}$/.test(declaration.requestHash) &&
    (declaration.previousContentHash === null || typeof declaration.previousContentHash === 'string' && /^[a-f0-9]{64}$/.test(declaration.previousContentHash)) &&
    declaration.contentHash === saleDeclarationContentHash(articleId, article, declaration.version);
}
/** Only new commerce. Historical agreements and real receipts are read first. */
export function assertArticleSaleDeclaration(articleId: string, article: FirebaseFirestore.DocumentData): void {
  if (!qualifiedArticleSaleDeclaration(articleId, article)) throw new HttpsError('failed-precondition',
    'Le vendeur doit confirmer la déclaration de cette unité entière et du contenu actuel avant une nouvelle opération.',
    { reason: 'article_sale_declaration_unqualified', action: 'reviewArticleSaleDeclaration', field: 'saleDeclaration' });
  if (isListingContentVersion(article.saleDeclaration.version)) return;
  if (article.saleDeclaration.version !== ARTICLE_SALE_DECLARATION_VERSION) throw new HttpsError('failed-precondition',
    'Le vendeur doit confirmer la déclaration actuelle sur la contrefaçon avant une nouvelle opération.',
    { reason: 'article_counterfeit_declaration_required', action: 'reviewArticleSaleDeclaration', field: 'saleDeclaration.counterfeitStatus', declarationVersion: ARTICLE_SALE_DECLARATION_VERSION });
  if (article.counterfeitStatus !== 'not_counterfeit') throw new HttpsError('failed-precondition',
    'Un article contrefait ou une réplique de marque non autorisée ne peut pas faire l’objet d’une nouvelle opération.',
    { reason: 'article_declared_counterfeit_not_admitted', action: 'reviewArticleSaleDeclaration', field: 'saleDeclaration.counterfeitStatus' });
  if (!(ARTICLE_SALE_UNITS as readonly unknown[]).includes(article.saleUnit) ||
      article.saleDeclaration.saleUnit !== article.saleUnit) throw new HttpsError('failed-precondition',
    'Le vendeur doit choisir explicitement un article ou un ensemble vendu comme un tout avant une nouvelle opération.',
    { reason: 'article_sale_unit_unqualified', action: 'reviewArticleSaleDeclaration', field: 'saleDeclaration.saleUnit', declarationVersion: ARTICLE_SALE_DECLARATION_VERSION });
}
export function articleSaleDeclarationView(articleId: string, article: FirebaseFirestore.DocumentData) {
  const declaration = article.saleDeclaration, qualified = qualifiedArticleSaleDeclaration(articleId, article);
  const qualification = declaration == null ? 'missing' : qualified ? isListingContentVersion(declaration.version)
    ? 'matching_listing_content' : 'matching_seller_statement' : 'unqualified';
  return { schemaVersion: 1, articleId, ownerId: article.sellerId, currentContentHash: saleDeclarationContentHash(articleId, article),
    content: saleDeclarationContent(article), quantity: article.quantity === 1 ? 1 : null, qualification,
    declaration: qualified ? { version: declaration.version as string, actorUid: declaration.actorUid as string,
      contentHash: declaration.contentHash as string, declaredAtMs: Math.floor(declaration.declaredAt.toMillis()),
      requestHash: declaration.requestHash as string, previousContentHash: declaration.previousContentHash as string | null,
      scope: declaration.scope as string,
      ...([SALE_UNIT_DECLARATION_VERSION, ARTICLE_SALE_DECLARATION_VERSION].includes(declaration.version) ? {saleUnit: declaration.saleUnit as ArticleSaleUnit} : {}),
      ...(declaration.version === ARTICLE_SALE_DECLARATION_VERSION ? {counterfeitStatus: declaration.counterfeitStatus as ArticleCounterfeitStatus} : {}) } : null,
    platformVerificationGranted: false, commonPhysicalIdentityProven: false };
}
