import AsyncStorage from '@/utils/environmentStorage';
import { catalogueCallableName } from '@/config/catalogueCallableContracts';
import { onAuthStateChanged } from 'firebase/auth';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { privateMediaUrl } from '@/utils/privateMedia';
import {
    collection,
    doc,
    documentId,
    limit as firestoreLimit,
    getDoc,
    getDocFromServer,
    getDocs,
    getDocsFromServer,
    orderBy,
    query,
    QueryDocumentSnapshot,
    type Query,
    type QueryConstraint,
    startAfter,
    where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, deleteObject } from 'firebase/storage';
import { uploadPreparedJpeg } from '@/services/nativeStorageUpload';
import { firestore, auth, storage, functions } from '../config/firebaseConfig';
import { Article, ArticleImage, ArticleSize } from '../types';
import {
  fixStorageUrl as fixStorageUrlUtil,
  isStorageUrl as isStorageUrlUtil,
} from '../utils/fixStorageUrl';
import { brandKey } from '../utils/normalizeBrand';
import { processImageWithBlurhash } from '../utils/imageUtils';
import { normalizeArticleImages } from '../utils/articleImages';
import { getCallableErrorCode } from '@/utils/callableError';
import { assertTradeSessionCurrent, captureTradeSession, type TradeSession } from '@/services/tradeOperation';
import type { ArticleSaleDeclarationView, ArticleSaleDeclarationInput, ArticleInventoryUnitChoice, ArticleInventoryUnitDeclaration, ArticleInventoryUnitReceipt, ArticleInventoryUnitView } from '@/types/article';
import { childSafetyStatementProjection } from '@/functions/src/shared/articleChildSafety';

export const LEGACY_ARTICLE_SALE_DECLARATION_TEXT = 'Je confirme proposer un seul exemplaire personnel de cet article. Sa description et ses photos reflètent fidèlement l’article et son état, y compris les défauts et retouches connus. J’ai les droits nécessaires pour vendre cet article et publier ces photos, et je ne propose pas de contrefaçon.';
export const ARTICLE_SALE_DECLARATION_TEXT = 'Je confirme vendre une seule unité personnelle entière : l’article ou l’ensemble choisi, avec tous les éléments décrits. La description et les photos reflètent ce qui est compris et son état, y compris les défauts et retouches connus. J’ai les droits nécessaires pour vendre cette unité et publier ces photos, et je ne propose pas de contrefaçon.';
export function isArticleSaleDeclarationInput(v: unknown): v is ArticleSaleDeclarationInput {
  if (!saleObject(v) || v.accepted !== true) return false;
  return v.version === 'personal_item_v1' ? Object.keys(v).length === 2 && Object.keys(v).every(k => ['version', 'accepted'].includes(k)) :
    (v.version === 'personal_item_v2' && Object.keys(v).length === 3 && Object.keys(v).every(k => ['version', 'accepted', 'saleUnit'].includes(k)) ||
    v.version === 'personal_item_v3' && Object.keys(v).length === 4 && Object.keys(v).every(k => ['version', 'accepted', 'saleUnit', 'counterfeitStatus'].includes(k)) &&
      ['not_counterfeit', 'declared_counterfeit'].includes(String(v.counterfeitStatus))) && ['single_article', 'set_as_one'].includes(String(v.saleUnit));
}
const SALE_CONTENT_FIELDS = ['quantity', 'stock', 'title', 'description', 'category', 'categoryIds', 'condition', 'brandStatus', 'brand', 'size',
  'colors', 'color', 'materials', 'material', 'hasKnownDefects', 'defectsDescription', 'hasAlterations', 'alterationsDescription', 'images', 'hygieneDeclaration'];
const SALE_REQUEST_FIELDS = ['title', 'description', 'price', 'images', 'category', 'categoryIds', 'condition', 'isHandDelivery', 'isShipping',
  'neighborhoods', 'neighborhood', 'size', 'brand', 'colors', 'color', 'materials', 'material', 'packageSize', 'hasKnownDefects', 'defectsDescription',
  'brandStatus', 'hasAlterations', 'alterationsDescription', 'hygieneDeclaration', 'quantity', 'stock', 'saleDeclaration', 'childSafetyDeclaration'];
// V1/V5 remain immutable for already-issued receipts and exact historical replays.
const LISTING_CONTENT_V1_FIELDS = SALE_CONTENT_FIELDS.filter(field => !['brandStatus', 'hasAlterations', 'alterationsDescription'].includes(field));
const LISTING_REQUEST_V5_FIELDS = SALE_REQUEST_FIELDS.filter(field => !['brandStatus', 'hasAlterations', 'alterationsDescription', 'saleDeclaration'].includes(field));
const LISTING_CONTENT_V2_FIELDS = LISTING_CONTENT_V1_FIELDS.filter(field => !['hasKnownDefects', 'defectsDescription'].includes(field));
const LISTING_REQUEST_V6_FIELDS = LISTING_REQUEST_V5_FIELDS.filter(field => !['hasKnownDefects', 'defectsDescription'].includes(field));
const isListingContentVersion = (version: unknown): version is 'listing_content_v1' | 'listing_content_v2' =>
  version === 'listing_content_v1' || version === 'listing_content_v2';
const saleObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const saleHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const saleCanonical = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => saleObject(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const inventoryArticleId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
/** A partial local choice is not a native declaration. Never infer one for old drafts. */
export function parseInventoryUnitChoice(v: unknown): ArticleInventoryUnitChoice | null {
  if (!saleObject(v)) return null;
  if (v.kind === 'new_unit' && Object.keys(v).length === 1) return {kind: 'new_unit'};
  return v.kind === 'same_unit' && Object.keys(v).length === 2 && Object.keys(v).every(k => ['kind', 'articleId'].includes(k)) &&
    (v.articleId === null || inventoryArticleId(v.articleId)) ? {kind: 'same_unit', articleId: v.articleId} : null;
}
export function isInventoryUnitDeclaration(v: unknown): v is ArticleInventoryUnitDeclaration {
  const choice = parseInventoryUnitChoice(v); return choice !== null && (choice.kind === 'new_unit' || choice.articleId !== null);
}
export function parseInventoryUnitView(v: unknown, articleId: string): ArticleInventoryUnitView {
  if (!saleObject(v) || Object.keys(v).length !== 7 || Object.keys(v).some(k => !['protocol', 'articleId', 'qualification', 'revision', 'inventoryUnitId', 'memberArticleIds', 'availability'].includes(k)) ||
    v.protocol !== 'article_inventory_unit_view_v1' || v.articleId !== articleId || !['native_current', 'legacy_missing', 'review_required'].includes(String(v.qualification)) || !saleHash(v.revision) ||
    !(v.inventoryUnitId === null || inventoryArticleId(v.inventoryUnitId)) || !Array.isArray(v.memberArticleIds) || v.memberArticleIds.length > 20 ||
    !v.memberArticleIds.every(inventoryArticleId) || new Set(v.memberArticleIds).size !== v.memberArticleIds.length ||
    !['available', 'engaged', 'consumed', 'unknown'].includes(String(v.availability)) ||
    v.qualification === 'native_current' && (typeof v.inventoryUnitId !== 'string' || !/^unit_[a-f0-9]{64}$/.test(v.inventoryUnitId) || !v.memberArticleIds.includes(articleId) || v.availability === 'unknown') ||
    v.qualification !== 'native_current' && (v.inventoryUnitId !== null || v.memberArticleIds.length !== 0 || v.availability !== 'unknown')) throw new Error('Le groupe déclaré de ce bien doit être relu. Aucune disponibilité n’est déduite.');
  return v as unknown as ArticleInventoryUnitView;
}
async function inventoryRequestHash(input: Record<string, unknown>, editing: boolean): Promise<string> {
  const fields = editing ? [...SALE_REQUEST_FIELDS, 'expectedSaleDeclarationContentHash', 'isActive', 'inventoryUnitDeclaration', 'expectedInventoryUnitRevision'] : [...SALE_REQUEST_FIELDS, 'inventoryUnitDeclaration'];
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, saleCanonical(Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k, input[k]]))));
}
async function parseInventoryUnitReceipt(v: unknown, articleId: string, input: Record<string, unknown>, editing: boolean, assertCurrent: () => void, version?: string): Promise<ArticleInventoryUnitReceipt> {
  if (!saleObject(v) || Object.keys(v).length !== 6 || Object.keys(v).some(k => !['protocol', 'articleId', 'unitId', 'requestHash', 'previousRevision', 'recordedAt'].includes(k)) ||
    v.protocol !== 'article_inventory_unit_receipt_v1' || v.articleId !== articleId || typeof v.unitId !== 'string' || !/^unit_[a-f0-9]{64}$/.test(v.unitId) || !saleHash(v.requestHash) ||
    v.previousRevision !== (editing ? input.expectedInventoryUnitRevision : null) || typeof v.recordedAt !== 'string' || !Number.isFinite(Date.parse(v.recordedAt)) || Date.parse(v.recordedAt) <= 0 || Date.parse(v.recordedAt) > Date.now() + 60_000 || new Date(v.recordedAt).toISOString() !== v.recordedAt)
    throw new Error('Le reçu propre à ce choix de bien doit être rapproché.');
  const expected = await (isListingContentVersion(version) ? saleRequestHash(input, editing, version) : inventoryRequestHash(input, editing)); assertCurrent();
  if (v.requestHash !== expected) throw new Error('Ce reçu ne correspond pas au choix et aux champs conservés.');
  return v as unknown as ArticleInventoryUnitReceipt;
}
export function articleSaleDeclarationContent(article: Record<string, unknown>, projectionVersion?: string): Record<string, unknown> {
  const version = projectionVersion ?? (saleObject(article.saleDeclaration) ? article.saleDeclaration.version :
    Object.prototype.hasOwnProperty.call(article, 'counterfeitStatus') ? 'personal_item_v3' : undefined);
  const fields = version === 'listing_content_v2' ? LISTING_CONTENT_V2_FIELDS : version === 'listing_content_v1' ? LISTING_CONTENT_V1_FIELDS : SALE_CONTENT_FIELDS;
  return Object.fromEntries([...fields, ...(isListingContentVersion(version) || article.saleUnit === undefined ? [] : ['saleUnit']), ...(article.childSafetyDeclaration === undefined ? [] : ['childSafetyDeclaration']),
    ...(version === 'personal_item_v3' ? ['counterfeitStatus'] : [])].map(field => {
    if (field === 'childSafetyDeclaration') return [field, childSafetyStatementProjection(article.childSafetyDeclaration)];
    if (field === 'images') return [field, Array.isArray(article.images) ? article.images.map(image => typeof image === 'string' ? image : saleObject(image) && typeof image.url === 'string' ? image.url : null) : null];
    if (field === 'hygieneDeclaration') return [field, saleObject(article.hygieneDeclaration)
      ? Object.fromEntries(['schemaVersion', 'kind', 'neverWorn', 'isNew', 'isSealed', 'categoryIds'].map(key => [key, article.hygieneDeclaration && saleObject(article.hygieneDeclaration) ? article.hygieneDeclaration[key] ?? null : null])) : null];
    return [field, article[field] ?? null];
  }));
}
export const articleSaleDeclarationContentKey = (article: Record<string, unknown>, projectionVersion?: string) => saleCanonical(articleSaleDeclarationContent(article, projectionVersion));
async function saleRequestHash(input: Record<string, unknown>, editing: boolean, version?: string) {
  const requestFields = version === 'listing_content_v2' ? LISTING_REQUEST_V6_FIELDS : version === 'listing_content_v1' ? LISTING_REQUEST_V5_FIELDS : SALE_REQUEST_FIELDS;
  const fields = editing ? [...requestFields, 'expectedSaleDeclarationContentHash', 'isActive'] : requestFields;
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, saleCanonical(Object.fromEntries(fields.filter(field => input[field] !== undefined).map(field => [field, input[field]]))));
}
async function parseSaleView(value: unknown, uid: string, articleId: string, assertContext: () => void): Promise<ArticleSaleDeclarationView> {
  const technical = saleObject(value) && saleObject(value.content) &&
    (value.qualification === 'matching_listing_content' || saleObject(value.declaration) && isListingContentVersion(value.declaration.version) ||
      !Object.prototype.hasOwnProperty.call(value.content, 'brandStatus'));
  if (technical) {
    const version = saleObject(value.declaration) && isListingContentVersion(value.declaration.version) ? value.declaration.version
      : Object.prototype.hasOwnProperty.call(value.content, 'hasKnownDefects') ? 'listing_content_v1' : 'listing_content_v2';
    const fields = version === 'listing_content_v1' ? LISTING_CONTENT_V1_FIELDS : LISTING_CONTENT_V2_FIELDS;
    if (value.schemaVersion !== 1 || value.articleId !== articleId || value.ownerId !== uid || !saleHash(value.currentContentHash) ||
        !saleObject(value.content) || Object.keys(value.content).some(key => ![...fields, 'childSafetyDeclaration'].includes(key)) ||
        !fields.every(key => Object.prototype.hasOwnProperty.call(value.content, key)) ||
        ![null, 1].includes(value.quantity as 1 | null) || !['missing', 'matching_listing_content', 'unqualified'].includes(String(value.qualification)) ||
        value.platformVerificationGranted !== false || value.commonPhysicalIdentityProven !== false) throw new Error('Le contenu de cette annonce doit être relu.');
    const expected = await digestStringAsync(CryptoDigestAlgorithm.SHA256, saleCanonical([articleId, uid, value.content])); assertContext();
    const receipt = value.declaration;
    if (expected !== value.currentContentHash || (value.qualification === 'matching_listing_content') !== (receipt !== null) ||
        receipt !== null && (!saleObject(receipt) || Object.keys(receipt).length !== 7 ||
          Object.keys(receipt).some(key => !['version', 'scope', 'actorUid', 'contentHash', 'declaredAtMs', 'requestHash', 'previousContentHash'].includes(key)) ||
          receipt.version !== version || receipt.scope !== 'single_listing' || receipt.actorUid !== uid || receipt.contentHash !== expected || value.quantity !== 1 ||
          !saleHash(receipt.requestHash) || !(receipt.previousContentHash === null || saleHash(receipt.previousContentHash)) ||
          typeof receipt.declaredAtMs !== 'number' || !Number.isSafeInteger(receipt.declaredAtMs) || receipt.declaredAtMs <= 0 || !Number.isFinite(new Date(receipt.declaredAtMs).getTime())))
      throw new Error('Le reçu technique ne correspond pas au contenu de cette annonce.');
    return value as unknown as ArticleSaleDeclarationView;
  }
  if (!saleObject(value) || value.schemaVersion !== 1 || value.articleId !== articleId || value.ownerId !== uid || !saleHash(value.currentContentHash) ||
    !saleObject(value.content) || Object.keys(value.content).some(k => ![...SALE_CONTENT_FIELDS, 'saleUnit', 'childSafetyDeclaration', 'counterfeitStatus'].includes(k)) || !SALE_CONTENT_FIELDS.every(field => Object.prototype.hasOwnProperty.call(value.content, field)) ||
    Object.prototype.hasOwnProperty.call(value.content, 'counterfeitStatus') && ![null, 'not_counterfeit', 'declared_counterfeit'].includes(value.content.counterfeitStatus as null | string) ||
    ![null, 1].includes(value.quantity as 1 | null) || !['missing', 'matching_seller_statement', 'unqualified'].includes(String(value.qualification)) ||
    value.platformVerificationGranted !== false || value.commonPhysicalIdentityProven !== false) throw new Error('La déclaration de cette annonce doit être relue.');
  const expected = await digestStringAsync(CryptoDigestAlgorithm.SHA256, saleCanonical([articleId, uid, value.content])); assertContext();
  if (expected !== value.currentContentHash || (value.qualification === 'matching_seller_statement') !== (value.declaration !== null)) throw new Error('Le contenu de la déclaration doit être rapproché.');
  const declared = value.declaration;
  if (declared !== null && (!saleObject(declared) || Object.keys(declared).length !== (declared.version === 'personal_item_v3' ? 9 : declared.version === 'personal_item_v2' ? 8 : 7) ||
    Object.keys(declared).some(k => !['version', 'actorUid', 'contentHash', 'declaredAtMs', 'requestHash', 'previousContentHash', 'scope', ...(['personal_item_v2', 'personal_item_v3'].includes(String(declared.version)) ? ['saleUnit'] : []), ...(declared.version === 'personal_item_v3' ? ['counterfeitStatus'] : [])].includes(k)) || !['personal_item_v1', 'personal_item_v2', 'personal_item_v3'].includes(String(declared.version)) || declared.actorUid !== uid ||
    declared.contentHash !== expected || value.quantity !== 1 ||
    (declared.version === 'personal_item_v1' ? declared.scope !== 'single_personal_specimen_and_listing' || Object.prototype.hasOwnProperty.call(declared, 'saleUnit') :
      declared.scope !== 'single_personal_sale_unit_and_listing' || !['single_article', 'set_as_one'].includes(String(declared.saleUnit)) || declared.saleUnit !== value.content.saleUnit) ||
    (declared.version === 'personal_item_v3' ? !['not_counterfeit', 'declared_counterfeit'].includes(String(declared.counterfeitStatus)) || declared.counterfeitStatus !== value.content.counterfeitStatus :
      Object.prototype.hasOwnProperty.call(value.content, 'counterfeitStatus')) ||
    !saleHash(declared.requestHash) || !(declared.previousContentHash === null || saleHash(declared.previousContentHash)) ||
    typeof declared.declaredAtMs !== 'number' || !Number.isSafeInteger(declared.declaredAtMs) || declared.declaredAtMs <= 0 || !Number.isFinite(new Date(declared.declaredAtMs).getTime()))) throw new Error('La réception de la déclaration doit être rapprochée.');
  return value as unknown as ArticleSaleDeclarationView;
}

/**
 * Normalize free text for search query matching.
 *
 * NOTE: this exact function is duplicated verbatim in
 * `functions/src/utils/search.ts` (the search indexer). There is no shared
 * module possible between the Expo app and Cloud Functions, so the two copies
 * MUST stay in sync — any change here must be mirrored there (and vice-versa),
 * otherwise the keywords written by the indexer and the keyword built by this
 * client query diverge and matches silently break.
 *
 * Steps: NFD decompose -> strip diacritics -> lowercase -> strip punctuation
 * -> collapse whitespace -> trim.
 */
function normalizeSearchText(input: string): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // strip ponctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Max Firestore batches fetched while refilling a client-filtered page.
 *
 * When a page applies client-side filters (colors/sizes/materials/brands, or
 * the popular-browse / shop-scoped paths where category/condition/price run
 * client-side), each batch over-fetches `limitCount * 5` docs and the loop runs
 * at most MAX_REFILL_BATCHES times. The bounded worst case is therefore
 * `limitCount * 5 * MAX_REFILL_BATCHES` document reads per page; if the page
 * still isn't full after the cap, `hasMore` lets the UI keep paging from the
 * last consumed cursor. A future server-side index (B2) could push these
 * predicates into Firestore and remove the over-fetch entirely.
 */
const MAX_REFILL_BATCHES = 5;

/** A page of search results plus pagination metadata. */
interface SearchPage {
  articles: Article[];
  lastVisible: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

interface ArticleSession { uid: string; generation: number; sdk: TradeSession }
let observedUid = auth.currentUser?.uid ?? null;
let observedGeneration = 0;
const observeArticleAccount = (uid: string | null) => {
  if (uid !== observedUid) { observedUid = uid; observedGeneration++; }
};
onAuthStateChanged(auth, user => observeArticleAccount(user?.uid ?? null));
function articleSession(): ArticleSession {
  observeArticleAccount(auth.currentUser?.uid ?? null);
  if (!observedUid) throw new Error('Utilisateur non authentifie');
  return { uid: observedUid, generation: observedGeneration, sdk: captureTradeSession(observedUid) };
}
function assertArticleSession(session: ArticleSession): void {
  assertTradeSessionCurrent(session.sdk);
  observeArticleAccount(auth.currentUser?.uid ?? null);
  if (observedUid !== session.uid || observedGeneration !== session.generation) {
    throw Object.assign(new Error('La session a changé.'), { code: 'functions/unauthenticated' });
  }
}
interface PublicationAttempt {
  input: string;
  payload: Record<string, unknown>;
  outcome: 'unknown' | 'refused' | 'confirmed';
  articleId?: string;
}
const publicationQueues = new Map<string, Promise<unknown>>();
function withPublicationLock<T>(key: string, execute: () => Promise<T>): Promise<T> {
  const previous = publicationQueues.get(key);
  const running = previous ? previous.then(execute, execute) : execute();
  const tail = running.catch(() => undefined);
  publicationQueues.set(key, tail);
  void tail.then(() => { if (publicationQueues.get(key) === tail) publicationQueues.delete(key); });
  return running;
}
const isProvenCallableRefusal = (error: unknown): boolean => {
  const code = getCallableErrorCode(error);
  return !!code && ['invalid-argument', 'failed-precondition', 'permission-denied',
    'unauthenticated', 'not-found', 'resource-exhausted', 'out-of-range', 'unimplemented'].includes(code);
};

export class ArticlesService {
  static async readInventoryUnit(articleId: string, assertContext: () => void): Promise<ArticleInventoryUnitView> {
    const session = articleSession(); assertContext();
    if (!inventoryArticleId(articleId)) throw new Error('Référence de votre annonce invalide.');
    const result = await httpsCallable<unknown, unknown>(functions, catalogueCallableName('updateArticle'))({articleId, mode: 'inventory_unit', expectedUid: session.uid});
    assertArticleSession(session); assertContext(); return parseInventoryUnitView(result.data, articleId);
  }
  static async assertNewInventoryChoice(choice: ArticleInventoryUnitDeclaration, assertContext: () => void, currentArticleId?: string): Promise<void> {
    if (!isInventoryUnitDeclaration(choice)) throw new Error('Choisissez explicitement un nouveau bien ou une annonce propre du même bien.');
    assertContext();
    if (choice.kind === 'same_unit') {
      const target = await this.readInventoryUnit(choice.articleId, assertContext); assertContext();
      if (target.qualification !== 'native_current' || target.availability !== 'available' || target.memberArticleIds.length >= 20 && (!currentArticleId || !target.memberArticleIds.includes(currentArticleId)))
        throw new Error('Cette annonce ne permet pas une nouvelle liaison. Son bien doit être déclaré, disponible et comporter moins de vingt annonces. Une ancienne annonce doit d’abord être déclarée depuis son édition.');
    }
  }
  /** Bounded own navigation references, never availability or permission. */
  static async getOwnInventoryCandidates(uid: string, cursor: string | null, assertContext: () => void): Promise<{items: {articleId: string; title: string | null}[]; cursor: string | null}> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    if (cursor !== null && !inventoryArticleId(cursor)) throw new Error('Le curseur de vos annonces doit être relu.');
    const constraints: QueryConstraint[] = [where('sellerId', '==', uid), orderBy(documentId(), 'asc'), firestoreLimit(21)];
    if (cursor) constraints.push(startAfter(cursor));
    const page = await getDocsFromServer(query(collection(firestore, 'articles'), ...constraints)); current();
    const rows = page.docs.slice(0, 20);
    return {items: rows.flatMap(row => {const data = row.data(); return data.sellerId === uid && inventoryArticleId(row.id)
      ? [{articleId: row.id, title: typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 500) : null}] : [];}), cursor: page.size > 20 ? rows.at(-1)!.id : null};
  }
  static async updateArticleWithInventory(articleId: string, updates: Record<string, unknown>, assertContext: () => void): Promise<{
    saleDeclarationView: ArticleSaleDeclarationView; inventoryUnitView: ArticleInventoryUnitView; inventoryUnitReceipt: ArticleInventoryUnitReceipt;
  } | ArticleSaleDeclarationView> {
    const session = articleSession(); assertContext();
    if (!isInventoryUnitDeclaration(updates.inventoryUnitDeclaration) || !saleHash(updates.expectedInventoryUnitRevision)) throw new Error('Le choix du bien et sa révision native sont nécessaires.');
    const result = await httpsCallable<unknown, unknown>(functions, catalogueCallableName('updateArticle'))({articleId, updates});
    const current = () => {assertArticleSession(session); assertContext();}; current();
    if (!saleObject(result.data) || result.data.success !== true || typeof result.data.replayed !== 'boolean') throw new Error('Le reçu de ce bien doit être relu.');
    const saleDeclarationView = await parseSaleView(result.data.saleDeclarationView, session.uid, articleId, current);
    if (saleDeclarationView.qualification === 'matching_listing_content') {
      if (!await this.saleDeclarationMatchesUpdate(saleDeclarationView, updates, current)) throw new Error('Le reçu technique de cette intention doit être rapproché.');
      current(); return saleDeclarationView;
    }
    const inventoryUnitView = parseInventoryUnitView(result.data.inventoryUnitView, articleId);
    const inventoryUnitReceipt = await parseInventoryUnitReceipt(result.data.inventoryUnitReceipt, articleId, updates, true, current);
    if (updates.saleDeclaration !== undefined && !await this.saleDeclarationMatchesUpdate(saleDeclarationView, updates, current)) throw new Error('Le reçu descriptif de cette même intention doit être rapproché.');
    current(); return {saleDeclarationView, inventoryUnitView, inventoryUnitReceipt};
  }
  static async readSaleDeclaration(articleId: string, assertContext: () => void): Promise<ArticleSaleDeclarationView> {
    const session = articleSession(); assertContext();
    const result = await httpsCallable<{mode: 'declaration_observe'; articleId: string; expectedUid: string}, unknown>(functions, catalogueCallableName('updateArticle'))(
      {mode: 'declaration_observe', articleId, expectedUid: session.uid});
    assertArticleSession(session); assertContext();
    return parseSaleView(result.data, session.uid, articleId, () => {assertArticleSession(session); assertContext();});
  }
  static async saleDeclarationMatchesUpdate(view: ArticleSaleDeclarationView, updates: Record<string, unknown>, assertContext: () => void): Promise<boolean> {
    const expected = await saleRequestHash(updates, true, view.declaration?.version); assertContext();
    return ['matching_seller_statement', 'matching_listing_content'].includes(view.qualification) && view.declaration?.requestHash === expected &&
      (isListingContentVersion(view.declaration.version) && !Object.prototype.hasOwnProperty.call(updates, 'expectedSaleDeclarationContentHash') ||
        view.declaration.previousContentHash === updates.expectedSaleDeclarationContentHash);
  }
  static async updateArticleWithDeclaration(articleId: string, updates: Record<string, unknown>, assertContext: () => void): Promise<ArticleSaleDeclarationView> {
    const session = articleSession(); assertContext();
    const result = await httpsCallable<{articleId: string; updates: Record<string, unknown>}, unknown>(functions, catalogueCallableName('updateArticle'))({articleId, updates});
    assertArticleSession(session); assertContext();
    if (!saleObject(result.data) || result.data.success !== true || typeof result.data.replayed !== 'boolean') throw new Error('Le reçu de modification doit être relu.');
    const view = await parseSaleView(result.data.saleDeclarationView, session.uid, articleId, () => {assertArticleSession(session); assertContext();});
    if (!await this.saleDeclarationMatchesUpdate(view, updates, assertContext)) throw new Error('La déclaration enregistrée ne correspond pas à cette intention.');
    return view;
  }
  /** @deprecated Import { isStorageUrl } from '@/utils/fixStorageUrl'. */
  static isStorageUrl(url: string): boolean {
    return isStorageUrlUtil(url);
  }

  /** @deprecated Import { fixStorageUrl } from '@/utils/fixStorageUrl'. */
  static fixStorageUrl(url: string): string {
    return fixStorageUrlUtil(url);
  }

  /**
   * Fix all image URLs in an article
   */
  static fixArticleImageUrls(images: ArticleImage[] | undefined): ArticleImage[] {
    return normalizeArticleImages(images);
  }

  /**
   * Create an article via the createArticle Cloud Function.
   *
   * Flow:
   * 1. If images are already Storage URLs (fast path from AI analysis) --
   *    pass them directly to the callable.
   * 2. If images are local URIs (legacy path) -- upload to Storage first
   *    using a temp ID, then pass the resulting download URLs.
   * 3. The Cloud Function validates, sanitises, and creates the article
   *    atomically in Firestore.
   */
  /**
   * `options.requestId` identifies this publish (the draft id): a retry after
   * a lost response returns the article already created instead of a copy.
   */
  static async createArticle(
    articleData: Omit<Article, 'id' | 'createdAt' | 'views' | 'likes' | 'isActive' | 'isSold' | 'brand' | 'saleUnit' | 'counterfeitStatus' | 'saleDeclaration' | 'brandStatus' | 'hasAlterations' | 'alterationsDescription' | 'hasKnownDefects' | 'defectsDescription'> & { brand?: string | null },
    options: { requestId?: string; assertContext?: () => void } = {},
  ): Promise<string> {
    const session = articleSession();
    const assertContext = () => { assertArticleSession(session); options.assertContext?.(); };
    assertContext();
    // Snapshot before the first await: caller mutations cannot change this intent.
    const input = JSON.stringify(articleData);
    const snapshot = JSON.parse(input) as typeof articleData;
    if (!options.requestId || !/^[a-zA-Z0-9_-]{1,128}$/.test(options.requestId)) throw new Error('Une référence stable du brouillon est nécessaire pour publier. Rouvrez son aperçu.');
    const key = `@article_publication:${encodeURIComponent(session.uid)}:${encodeURIComponent(options.requestId)}`;
    const execute = async (): Promise<string> => {
      let attempt: PublicationAttempt | null = null;
      let serverRefused = false;
      let priorUnresolved = false;
      try {
        assertContext();
        if (key) {
          const saved = await AsyncStorage.getItem(key);
          assertContext();
          attempt = saved ? JSON.parse(saved) as PublicationAttempt : null;
          if (attempt && (typeof attempt.input !== 'string' || !saleObject(attempt.payload) || attempt.payload.clientRequestId !== options.requestId ||
            !['unknown', 'refused', 'confirmed'].includes(attempt.outcome))) throw new Error('Le journal de cette publication doit être rapproché.');
          priorUnresolved = !!attempt && attempt.outcome !== 'refused';
          if (attempt && attempt.input !== input && attempt.outcome !== 'refused') {
            throw new Error('La publication précédente doit être vérifiée avec son contenu initial avant de modifier cette tentative.');
          }
          if (attempt?.input !== input) attempt = null;
        }
        if (!attempt && (snapshot.quantity !== 1 || snapshot.stock !== undefined && snapshot.stock !== 1)) throw new Error('Une annonce doit proposer une seule unité, sans stock multiple.');
        let finalImages: ArticleImage[] = [];

        if (!attempt && snapshot.images && snapshot.images.length > 0) {
          const imageUris = snapshot.images.map(img => img.url);

          // Check if images are already Storage URLs (pre-uploaded during AI analysis)
          const allStorageUrls = imageUris.every(uri => this.isStorageUrl(uri));

          if (__DEV__) console.log('[ArticlesService] createArticle:', {
            imagesCount: imageUris.length,
            allStorageUrls,
          });

          if (allStorageUrls) {
            // Fast path: images already in Storage -- use them directly
            finalImages = snapshot.images.map(img => {
              const entry: ArticleImage = { url: img.url };
              if (img.blurhash) entry.blurhash = img.blurhash;
              return entry;
            });
          } else {
            // Local URIs (analysis skipped) -- upload to Storage first, into the
            // seller's own draft folder: the rules let only its owner write
            // there, account deletion purges it, and the daily sweep spares
            // every file an article still references. The former
            // `articles/draft_{timestamp}/` belonged to no article and no
            // account, so nothing could protect or find those files.
            const uid = auth.currentUser?.uid;
            if (!uid) {
              throw new Error('Utilisateur non authentifie - impossible d\'uploader');
            }

            if (__DEV__) console.log('[ArticlesService] Uploading local images (legacy path)...');
            const locals = imageUris.map((uri, index) => ({ uri, index })).filter(({ uri }) => !this.isStorageUrl(uri));
            const uploaded = await this.uploadImagesReactNative(
              locals.map(({ uri }) => uri),
              `drafts/${uid}/${options.requestId || `manual_${Date.now()}`}`,
              assertContext,
            );
            if (uploaded.length !== locals.length) throw new Error('Toutes les images doivent être préparées.');
            finalImages = snapshot.images.map((image, index) => {
              const local = locals.findIndex(entry => entry.index === index);
              return local >= 0 ? uploaded[local] : image;
            });
          }
        }

        assertContext();

        // Build the payload -- remove undefined values and let the callable
        // handle defaults / sanitisation.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: Record<string, unknown> = {
          title: snapshot.title,
          description: snapshot.description,
          price: snapshot.price,
          images: finalImages,
          category: snapshot.category,
          categoryIds: snapshot.categoryIds,
          condition: snapshot.condition,
          sellerName: snapshot.sellerName,
          isHandDelivery: snapshot.isHandDelivery,
          isShipping: snapshot.isShipping,
        };

        // Optional fields
        if (snapshot.size) payload.size = snapshot.size;
        if (snapshot.brand) payload.brand = snapshot.brand;
        else if (snapshot.brand === null) payload.brand = null;
        if (snapshot.pattern) payload.pattern = snapshot.pattern;
        if (snapshot.sellerImage) payload.sellerImage = snapshot.sellerImage;

        if (snapshot.colors && snapshot.colors.length > 0) {
          payload.colors = snapshot.colors;
        } else if (snapshot.color) {
          payload.color = snapshot.color;
        }

        if (snapshot.materials && snapshot.materials.length > 0) {
          payload.materials = snapshot.materials;
        } else if (snapshot.material) {
          payload.material = snapshot.material;
        }

        if (snapshot.neighborhoods && snapshot.neighborhoods.length > 0) {
          payload.neighborhoods = snapshot.neighborhoods;
        } else if (snapshot.neighborhood) {
          payload.neighborhood = snapshot.neighborhood;
        }

        if (snapshot.packageSize) payload.packageSize = snapshot.packageSize;
        if (snapshot.quantity !== undefined) payload.quantity = snapshot.quantity;
        if (snapshot.stock !== undefined) payload.stock = snapshot.stock;
        if (snapshot.childSafetyDeclaration !== undefined) payload.childSafetyDeclaration = snapshot.childSafetyDeclaration;
        if (options.requestId) payload.clientRequestId = options.requestId;
        if (snapshot.hygieneDeclaration !== undefined) payload.hygieneDeclaration = snapshot.hygieneDeclaration;
        // Remove undefined values -- Firestore / callable rejects them
        const cleanedPayload = attempt?.payload ?? Object.fromEntries(
          Object.entries(payload).filter(([, v]) => v !== undefined),
        );

        const createArticleFn = httpsCallable<
          Record<string, unknown>,
          { articleId: string; saleDeclarationView?: unknown; inventoryUnitView?: unknown; inventoryUnitReceipt?: unknown }
        >(functions, catalogueCallableName('createArticle'));

        attempt = { input, payload: cleanedPayload, outcome: 'unknown' };
        // Persist the exact prepared URLs/payload BEFORE a potentially committed call.
        if (key) await AsyncStorage.setItem(key, JSON.stringify(attempt));
        assertContext();
        let result;
        try { result = await createArticleFn(cleanedPayload); }
        catch (error) { serverRefused = isProvenCallableRefusal(error); throw error; }
        const articleId = result.data.articleId;
        if (typeof articleId !== 'string' || !articleId) throw new Error('Réponse de publication à vérifier.');
        let receiptVersion: string | undefined;
        if (result.data.saleDeclarationView !== undefined) {
          const view = await parseSaleView(result.data.saleDeclarationView, session.uid, articleId, () => undefined);
          receiptVersion = view.declaration?.version;
          if (view.qualification === 'matching_listing_content') {
            if (view.declaration?.requestHash !== await saleRequestHash(cleanedPayload, false, receiptVersion)) throw new Error('Le reçu technique ne correspond pas à cette publication.');
          } else if (cleanedPayload.saleDeclaration !== undefined && (view.qualification !== 'matching_seller_statement' ||
            view.declaration?.requestHash !== await saleRequestHash(cleanedPayload, false))) throw new Error('Cette réception ne prouve pas la déclaration de cette intention.');
        }
        else if (cleanedPayload.saleDeclaration !== undefined) throw new Error('La réception de cette déclaration doit être relue depuis son intention d’origine.');
        if (result.data.inventoryUnitReceipt !== undefined || cleanedPayload.inventoryUnitDeclaration !== undefined) {
          parseInventoryUnitView(result.data.inventoryUnitView, articleId);
          await parseInventoryUnitReceipt(result.data.inventoryUnitReceipt, articleId, cleanedPayload, false, () => undefined, receiptVersion);
        }
        // A late receipt is preserved for its original owner, never projected to another session.
        if (key) await AsyncStorage.setItem(key, JSON.stringify({ ...attempt, outcome: 'confirmed', articleId }));
        assertContext();

        if (__DEV__) console.log('[ArticlesService] Article created via callable:', articleId);

        return articleId;
      } catch (error: unknown) {
        if (key && attempt && serverRefused && !priorUnresolved) {
          // Preserve even refusals: the next explicit attempt may correct input,
          // while an unknown attempt may only replay its original payload.
          await AsyncStorage.setItem(key, JSON.stringify({ ...attempt, outcome: 'refused' }));
        }
        // Keep the callable envelope (code/details) intact for the owner consumer.
        if (error instanceof Error) {
          const wrapped = new Error(`Erreur lors de la création de l'article: ${error.message}`);
          if ('code' in error) Object.assign(wrapped, { code: error.code });
          if ('details' in error) Object.assign(wrapped, { details: error.details });
          throw wrapped;
        }
        throw new Error('Erreur lors de la création de l’article');
      }
    };
    if (!key) return execute();
    return withPublicationLock(key, execute);
  }

  /** Called only after the owning draft's exact, confirmed removal. */
  static async finishPublication(requestId: string, assertContext: () => void): Promise<void> {
    const session = articleSession();
    assertContext();
    const key = `@article_publication:${encodeURIComponent(session.uid)}:${encodeURIComponent(requestId)}`;
    return withPublicationLock(key, async () => {
      assertArticleSession(session); assertContext();
      const saved = await AsyncStorage.getItem(key);
      assertArticleSession(session); assertContext();
      if (saved && (JSON.parse(saved) as PublicationAttempt).outcome === 'confirmed') {
        await AsyncStorage.removeItem(key);
        assertArticleSession(session); assertContext();
      }
    });
  }

  /** Inspect an owner's immutable attempt without changing its payload or receipt. */
  static async getPendingPublicationInput(requestId: string, assertContext: () => void): Promise<string | null> {
    const session = articleSession();
    const key = `@article_publication:${encodeURIComponent(session.uid)}:${encodeURIComponent(requestId)}`;
    assertContext();
    return withPublicationLock(key, async () => {
      assertArticleSession(session); assertContext();
      const saved = await AsyncStorage.getItem(key);
      assertArticleSession(session); assertContext();
      if (!saved) return null;
      const value: unknown = JSON.parse(saved);
      if (!saleObject(value) || typeof value.input !== 'string' || !saleObject(value.payload) || value.payload.clientRequestId !== requestId ||
        !['unknown', 'refused', 'confirmed'].includes(String(value.outcome))) throw new Error('Le journal de cette publication doit être rapproché.');
      const attempt = value as unknown as PublicationAttempt;
      return attempt.outcome === 'refused' ? null : attempt.input;
    });
  }

  /** Compresse et téléverse `imageUris` sous le dossier Storage `folder`. */
  static async uploadImagesReactNative(imageUris: string[], folder: string, assertContext?: () => void): Promise<ArticleImage[]> {
    try {
      // Verifier que l'utilisateur est authentifie
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Utilisateur non authentifie - impossible d\'uploader');
      }
      if (__DEV__) console.log('[ArticlesService] Upload images:', { imageUris, folder, userId: currentUser.uid });

      const session = articleSession();
      const current = () => {assertArticleSession(session); assertContext?.();};
      current();
      const uploadPromises = imageUris.map(async (uri, index) => {
        try {
          if (__DEV__) console.log(`[ArticlesService] Processing image ${index}:`, uri);

          // Compress image and generate blurhash
          const { compressedUri, blurhash } = await processImageWithBlurhash(uri, {
            maxWidth: 1200,
            maxHeight: 1200,
            quality: 0.75,
          });

          current();
          // Create Firebase Storage reference
          // A UUID avoids overwriting another simultaneous attempt's photo.
          const imageId = BigInt(`0x${randomUUID().replace(/-/g, '')}`).toString();
          const storagePath = `${folder}/image_${index}_${imageId}.jpg`;

          // Native streaming avoids the Web SDK Blob path; metadata is created
          // atomically with this fresh source object and is never patched later.
          await uploadPreparedJpeg({ownerUid: session.uid, path: storagePath, localUri: compressedUri,
            assertContext: current});
          current();
          const downloadURL = privateMediaUrl(storage.app.options.storageBucket!, storagePath);

          const articleImage: ArticleImage = {
            url: downloadURL,
          };

          if (blurhash) {
            articleImage.blurhash = blurhash;
          }

          return articleImage;
        } catch (imageError: any) {
          if (__DEV__) console.error(`[ArticlesService] Error uploading image ${index}:`, imageError);
          throw imageError;
        }
      });

      const uploadedImages = await Promise.all(uploadPromises);
      current();
      if (__DEV__) console.log('[ArticlesService] All uploads done:', uploadedImages);

      return uploadedImages;
    } catch (error: any) {
      if (__DEV__) console.error('[ArticlesService] Global upload error:', error);
      throw new Error(`Erreur lors de l'upload des images: ${error.message}`);
    }
  }

  static async getArticleById(articleId: string, ownerServicingUid?: string, options?: {source: 'server'}): Promise<Article | null> {
    const ownerSession = ownerServicingUid ? captureTradeSession(ownerServicingUid) : null;
    try {
      const docRef = doc(firestore, 'articles', articleId);
      const docSnap = options?.source === 'server' ? await getDocFromServer(docRef) : await getDoc(docRef);
      if (ownerSession) assertTradeSessionCurrent(ownerSession);

      if (docSnap.exists()) {
        const data = docSnap.data();
        if (!data) return null;
        // Inactive (soft-deleted) articles should not be visible
        if (!data.isActive && (!ownerSession || data.sellerId !== ownerSession.uid)) return null;
        return {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          images: ArticlesService.fixArticleImageUrls(data.images),
        } as Article;
      }

      return null;
    } catch (error: any) {
      throw new Error(`Erreur lors de la recuperation de l'article: ${error.message}`);
    }
  }

  /**
   * Batch-fetch articles by id, returning a Map keyed by id (missing/inactive
   * ids are simply absent). Replaces an N+1 of getArticleById calls (e.g. one
   * per order/sale row, F130) with `documentId() in [...]` chunks of 30 (the
   * Firestore `in` limit). Inactive (soft-deleted) articles are excluded, same
   * as getArticleById.
   */
  static async getArticlesByIds(ids: string[]): Promise<Map<string, Article>> {
    const result = new Map<string, Article>();
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return result;

    const CHUNK = 30; // Firestore `in` operator cap.
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      chunks.push(unique.slice(i, i + CHUNK));
    }

    const snaps = await Promise.all(
      chunks.map((chunk) =>
        getDocs(
          query(collection(firestore, 'articles'), where(documentId(), 'in', chunk)),
        ),
      ),
    );

    for (const snap of snaps) {
      snap.forEach((d) => {
        const data = d.data();
        if (!data || !data.isActive) return; // mirror getArticleById
        result.set(d.id, {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          images: ArticlesService.fixArticleImageUrls(data.images),
        } as Article);
      });
    }

    return result;
  }

  /**
   * Map a search_index document to an Article.
   * search_index has a subset of Article fields with slightly different shapes
   * (e.g. firstImage instead of images[], no categoryIds).
   */
  private static mapSearchIndexToArticle(
    docId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>,
  ): Article {
    return {
      id: docId,
      title: data.title ?? '',
      description: data.description ?? '',
      price: data.price ?? 0,
      images: data.firstImage ? [{ url: this.fixStorageUrl(data.firstImage) }] : [],
      category: data.category ?? '',
      categoryIds: data.categoryIds ?? [],
      size: data.size ?? null,
      brand: data.brand ?? undefined,
      color: data.color ?? undefined,
      colors: data.colors ?? undefined,
      material: data.material ?? undefined,
      materials: data.materials ?? undefined,
      condition: data.condition ?? 'bon état',
      sellerId: data.sellerId ?? '',
      sellerName: data.sellerName ?? '',
      createdAt: data.createdAt?.toDate?.() ?? new Date(),
      isActive: data.isActive ?? true,
      isSold: data.isSold ?? false,
      likes: data.likes ?? 0,
      views: data.views ?? 0,
    } as Article;
  }

  static async searchArticles(
    searchTerm?: string,
    filters?: {
      category?: string;
      categoryIds?: string[];
      colors?: string[];
      sizes?: ArticleSize[];
      materials?: string[];
      condition?: string;
      minPrice?: number;
      maxPrice?: number;
      brands?: string[];
      sortBy?: 'recent' | 'price_asc' | 'price_desc' | 'popular';
      excludeUserId?: string;
      sellerId?: string;
    },
    limitCount: number = 20,
    lastVisible?: QueryDocumentSnapshot
  ): Promise<SearchPage> {
    try {
      if (__DEV__) {
        console.log('searchArticles called with:', { searchTerm, filters, limitCount });
      }

      const trimmedSearch = searchTerm?.trim() ?? '';
      const sortBy = filters?.sortBy ?? 'recent';

      // Decide which collection to query:
      // - searchTerm present -> search_index (has keywords index)
      // - sortBy=popular -> search_index (has popularityScore)
      // - otherwise -> articles (has all fields + more indexes)
      const useSearchIndex = trimmedSearch.length > 0 || sortBy === 'popular';

      if (useSearchIndex) {
        return this.searchViaSearchIndex(trimmedSearch, filters, limitCount, lastVisible, sortBy);
      }

      return this.searchViaArticles(filters, limitCount, lastVisible, sortBy);
    } catch (error: any) {
      if (__DEV__) console.error('searchArticles error:', error);
      throw new Error(`Erreur lors de la recherche: ${error.message}`);
    }
  }

  /**
   * Query the search_index collection.
   * Used when a searchTerm is present (keywords array-contains) or sortBy=popular.
   */
  private static async searchViaSearchIndex(
    trimmedSearch: string,
    filters: Parameters<typeof ArticlesService.searchArticles>[1],
    limitCount: number,
    lastVisible: QueryDocumentSnapshot | undefined,
    // sortBy is intentionally unused on the text-search path: the only usable
    // server order with `keywords array-contains` is popularityScore DESC, and
    // the UI hides price/date sort while a text term is present. Re-sorting only
    // the current page client-side would corrupt the global order and skip docs.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sortBy: 'recent' | 'price_asc' | 'price_desc' | 'popular',
  ): Promise<SearchPage> {
    const searchIndexRef = collection(firestore, 'search_index');

    const hasTerm = trimmedSearch.length > 0;

    // Normalize the search term exactly like the indexer (NFD + strip accents
    // + strip punctuation). The first normalized keyword drives the Firestore
    // `array-contains`; the remaining ones are matched client-side against the
    // doc's `keywords` (which already contains the description tokens).
    const normalized = hasTerm ? normalizeSearchText(trimmedSearch) : '';
    // The native index drops words of one or two characters, including stop
    // words such as « en » and short labels such as « QA ».
    const keywords = normalized.split(' ').filter(word => word.length > 2);
    const firstKeyword = keywords[0];
    const remainingKeywords = keywords.slice(1);

    // A non-empty term that normalizes to no usable keyword (pure punctuation,
    // accents only, etc.) has nothing to match — return an empty page rather
    // than falling through to the popular-browse branch (which would ignore the
    // text term and return the full popular feed).
    if (hasTerm && !firstKeyword) {
      return { articles: [], lastVisible: null, hasMore: false };
    }

    // Build the immutable part of the query (everything except the cursor).
    const buildConstraints = (
      cursor: QueryDocumentSnapshot | undefined,
      fetchLimit: number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const constraints: any[] = [];

      if (hasTerm && firstKeyword) {
        constraints.push(where('keywords', 'array-contains', firstKeyword));
        // Only usable composite index: keywords CONTAINS + popularityScore DESC.
        constraints.push(orderBy('popularityScore', 'desc'));
      } else {
        // No search term but sortBy=popular -> isActive+isSold(+condition)+popularityScore
        constraints.push(where('isActive', '==', true));
        constraints.push(where('isSold', '==', false));

        // Sans terme, la catégorie est un filtre PRINCIPAL : la laisser en
        // mémoire vidait la page dès que la catégorie sortait des 500 premiers
        // documents par popularité.
        if (filters?.categoryIds && filters.categoryIds.length > 0) {
          constraints.push(
            where('categoryIds', 'array-contains', filters.categoryIds[filters.categoryIds.length - 1]),
          );
        } else if (filters?.category) {
          constraints.push(where('category', '==', filters.category));
        }
        if (filters?.condition) {
          constraints.push(where('condition', '==', filters.condition));
        }

        constraints.push(orderBy('popularityScore', 'desc'));
      }

      constraints.push(firestoreLimit(fetchLimit));
      if (cursor) {
        constraints.push(startAfter(cursor));
      }
      return constraints;
    };

    // Client-side filters that search_index has no composite index for.
    const hasClientSideFilter = !!(
      hasTerm ||
      // La catégorie ne reste en mémoire que sur le chemin texte : sans terme
      // elle est poussée au serveur (index dédié), donc plus de sur-lecture.
      (hasTerm && filters?.categoryIds && filters.categoryIds.length > 0) ||
      (filters?.colors && filters.colors.length > 0) ||
      (filters?.sizes && filters.sizes.length > 0) ||
      (filters?.materials && filters.materials.length > 0) ||
      (filters?.brands && filters.brands.length > 0) ||
      filters?.sellerId ||
      filters?.excludeUserId ||
      filters?.minPrice !== undefined ||
      filters?.maxPrice !== undefined
    );
    const fetchLimit = hasClientSideFilter ? limitCount * 5 : limitCount + 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matchDoc = (data: Record<string, any>): boolean => {
      // The keywords array-contains query doesn't constrain isActive/isSold.
      if (hasTerm && (!data.isActive || data.isSold)) return false;

      if (filters?.excludeUserId && data.sellerId === filters.excludeUserId) return false;
      if (filters?.sellerId && data.sellerId !== filters.sellerId) return false;

      // M2: every remaining word must be present in the doc's keywords
      // (keywords already include description tokens), not just title/brand.
      if (remainingKeywords.length > 0) {
        const docKeywords: string[] = Array.isArray(data.keywords) ? data.keywords : [];
        const allMatch = remainingKeywords.every((kw) => docKeywords.includes(kw));
        if (!allMatch) return false;
      }

      // Category filter via canonical hierarchical IDs only (no legacy fallback).
      if (filters?.categoryIds && filters.categoryIds.length > 0) {
        const targetCategoryId = filters.categoryIds[filters.categoryIds.length - 1];
        const docCategoryIds: string[] = data.categoryIds || [];
        if (!docCategoryIds.includes(targetCategoryId)) return false;
      } else if (hasTerm && filters?.category) {
        if (data.category !== filters.category) return false;
      }

      if (hasTerm && filters?.condition) {
        if (data.condition !== filters.condition) return false;
      }

      if (filters?.minPrice !== undefined && data.price < filters.minPrice) return false;
      if (filters?.maxPrice !== undefined && data.price > filters.maxPrice) return false;

      return this.matchesClientSideFilters(data, filters);
    };

    return this.scanSearchPage(
      (cursor) => query(searchIndexRef, ...buildConstraints(cursor, fetchLimit)),
      (docSnap) => {
        const data = docSnap.data();
        return matchDoc(data) ? this.mapSearchIndexToArticle(docSnap.id, data) : null;
      },
      fetchLimit,
      limitCount,
      lastVisible,
    );
  }

  /**
   * Query the articles collection directly.
   * Used when no searchTerm and sortBy != popular.
   */
  private static async searchViaArticles(
    filters: Parameters<typeof ArticlesService.searchArticles>[1],
    limitCount: number,
    lastVisible: QueryDocumentSnapshot | undefined,
    sortBy: 'recent' | 'price_asc' | 'price_desc' | 'popular',
  ): Promise<SearchPage> {
    const articlesRef = collection(firestore, 'articles');

    // Shop-scoped search (sellerId present): keep the server query to
    // isActive + isSold + sellerId + createdAt DESC (which has a simple index)
    // and apply categoryIds / category / condition / price client-side, exactly
    // like colors/sizes/materials/brands already are. This avoids requiring a
    // new composite index per attribute combination on top of sellerId.
    const isShopScoped = !!filters?.sellerId;

    const hasPriceFilter =
      filters?.minPrice !== undefined || filters?.maxPrice !== undefined;

    // C2: when a price inequality is present (and not shop-scoped), Firestore
    // REQUIRES the inequality field to lead the ordering. So `price` must be the
    // first orderBy, with `createdAt DESC` as a stable secondary. Direction:
    // price_desc -> desc, everything else (price_asc / recent / popular) -> asc.
    const priceDir: 'asc' | 'desc' = sortBy === 'price_desc' ? 'desc' : 'asc';

    const buildConstraints = (
      cursor: QueryDocumentSnapshot | undefined,
      fetchLimit: number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const constraints: any[] = [
        where('isActive', '==', true),
        where('isSold', '==', false),
      ];

      if (isShopScoped) {
        // Shop-scoped: only sellerId server-side, ordered by recency. All other
        // attribute filters (category / condition / price) run client-side.
        constraints.push(where('sellerId', '==', filters!.sellerId));
        constraints.push(orderBy('createdAt', 'desc'));
        constraints.push(firestoreLimit(fetchLimit));
        if (cursor) {
          constraints.push(startAfter(cursor));
        }
        return constraints;
      }

      if (filters?.categoryIds && filters.categoryIds.length > 0) {
        const targetCategoryId = filters.categoryIds[filters.categoryIds.length - 1];
        constraints.push(where('categoryIds', 'array-contains', targetCategoryId));
      } else if (filters?.category) {
        constraints.push(where('category', '==', filters.category));
      }

      if (filters?.condition) {
        constraints.push(where('condition', '==', filters.condition));
      }

      if (filters?.minPrice !== undefined) {
        constraints.push(where('price', '>=', filters.minPrice));
      }
      if (filters?.maxPrice !== undefined) {
        constraints.push(where('price', '<=', filters.maxPrice));
      }

      // Ordering.
      if (hasPriceFilter) {
        // Inequality field must lead the orderBy. createdAt DESC is the stable
        // secondary key.
        constraints.push(orderBy('price', priceDir));
        constraints.push(orderBy('createdAt', 'desc'));
      } else {
        switch (sortBy) {
          case 'price_asc':
            constraints.push(orderBy('price', 'asc'));
            constraints.push(orderBy('createdAt', 'desc'));
            break;
          case 'price_desc':
            constraints.push(orderBy('price', 'desc'));
            constraints.push(orderBy('createdAt', 'desc'));
            break;
          case 'recent':
          default:
            constraints.push(orderBy('createdAt', 'desc'));
            break;
        }
      }

      constraints.push(firestoreLimit(fetchLimit));
      if (cursor) {
        constraints.push(startAfter(cursor));
      }
      return constraints;
    };

    // Filters resolved client-side. When shop-scoped, category / condition /
    // price join the always-client-side attribute filters.
    const hasShopAttributeFilter =
      isShopScoped &&
      !!(
        (filters?.categoryIds && filters.categoryIds.length > 0) ||
        filters?.category ||
        filters?.condition ||
        hasPriceFilter
      );

    const hasClientSideFilter = !!(
      (filters?.colors && filters.colors.length > 0) ||
      (filters?.sizes && filters.sizes.length > 0) ||
      (filters?.materials && filters.materials.length > 0) ||
      (filters?.brands && filters.brands.length > 0) ||
      hasShopAttributeFilter ||
      filters?.excludeUserId
    );
    const fetchLimit = hasClientSideFilter ? limitCount * 5 : limitCount + 1;

    // Shop-scoped category / condition / price predicates, applied per doc.
    const matchesShopAttributes = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: Record<string, any>,
    ): boolean => {
      if (!isShopScoped) return true;

      if (filters?.categoryIds && filters.categoryIds.length > 0) {
        const targetCategoryId = filters.categoryIds[filters.categoryIds.length - 1];
        const docCategoryIds: string[] = Array.isArray(data.categoryIds) ? data.categoryIds : [];
        if (!docCategoryIds.includes(targetCategoryId)) return false;
      } else if (filters?.category) {
        if (data.category !== filters.category) return false;
      }

      if (filters?.condition && data.condition !== filters.condition) return false;

      if (filters?.minPrice !== undefined && data.price < filters.minPrice) return false;
      if (filters?.maxPrice !== undefined && data.price > filters.maxPrice) return false;

      return true;
    };

    return this.scanSearchPage(
      (cursor) => query(articlesRef, ...buildConstraints(cursor, fetchLimit)),
      (docSnap) => {
        const data = docSnap.data();
        if (filters?.excludeUserId && data.sellerId === filters.excludeUserId) return null;
        if (!matchesShopAttributes(data) || !this.matchesClientSideFilters(data, filters)) return null;
        return {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() ?? new Date(),
          images: this.fixArticleImageUrls(data.images),
        } as Article;
      },
      fetchLimit,
      limitCount,
      lastVisible,
    );
  }

  /**
   * Consume documents in query order. The extra matching document is lookahead:
   * it belongs to the next page, so the cursor must stay BEFORE it. Rejected
   * documents can be consumed safely. A capped full scan still exposes a
   * continuation, even when this page contains no matches.
   */
  private static async scanSearchPage(
    buildQuery: (cursor: QueryDocumentSnapshot | undefined) => Query,
    matchArticle: (doc: QueryDocumentSnapshot) => Article | null,
    fetchLimit: number,
    limitCount: number,
    lastVisible?: QueryDocumentSnapshot,
  ): Promise<SearchPage> {
    const articles: Article[] = [];
    let lastConsumed = lastVisible ?? null;
    for (let batch = 0; batch < MAX_REFILL_BATCHES; batch++) {
      const snap = await getDocs(buildQuery(lastConsumed ?? undefined));
      for (const doc of snap.docs) {
        const article = matchArticle(doc);
        if (article && articles.length === limitCount) {
          return { articles, lastVisible: lastConsumed, hasMore: true };
        }
        lastConsumed = doc;
        if (article) articles.push(article);
      }
      if (snap.docs.length < fetchLimit) {
        return { articles, lastVisible: lastConsumed, hasMore: false };
      }
    }
    return { articles, lastVisible: lastConsumed, hasMore: true };
  }

  /**
   * Apply client-side attribute filters (colors, sizes, materials, brands).
   * Works with both articles and search_index documents.
   *
   * All matching is strict equality on canonical IDs (no substring), so e.g.
   * `bleu` no longer matches `bleu-marine`, `or` no longer matches `bordeaux`,
   * `cuir` no longer matches `cuir-synthetique`, and `Gap` no longer matches
   * `Gap Kids`. Object sizes ({ value, system }) match exactly on both fields
   * so US/EU never collide; legacy string sizes match by value only.
   * Articles missing the filtered attribute are excluded.
   */
  private static matchesClientSideFilters(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>,
    filters?: {
      colors?: string[];
      sizes?: ArticleSize[];
      materials?: string[];
      brands?: string[];
    },
  ): boolean {
    if (filters?.colors && filters.colors.length > 0) {
      const articleColors: string[] = data.colors || (data.color ? [data.color] : []);
      if (articleColors.length === 0) return false;
      const matches = filters.colors.some((color) => articleColors.includes(color));
      if (!matches) return false;
    }

    if (filters?.sizes && filters.sizes.length > 0) {
      const articleSize = data.size;
      if (!articleSize) return false;
      if (typeof articleSize === 'object') {
        // Canonical ArticleSize { value, system }: match on both fields so
        // US/EU never collide.
        const matches = filters.sizes.some(
          (f) => f.value === articleSize.value && f.system === articleSize.system,
        );
        if (!matches) return false;
      } else {
        // Legacy size stored as a bare string: compare by value only (the
        // system is unknown), so legacy docs and personalized-feed string
        // filters still match.
        const articleSizeValue = String(articleSize);
        const matches = filters.sizes.some((f) => f.value === articleSizeValue);
        if (!matches) return false;
      }
    }

    if (filters?.materials && filters.materials.length > 0) {
      const articleMaterials: string[] = data.materials || (data.material ? [data.material] : []);
      if (articleMaterials.length === 0) return false;
      const matches = filters.materials.some((material) => articleMaterials.includes(material));
      if (!matches) return false;
    }

    if (filters?.brands && filters.brands.length > 0) {
      if (!data.brand) return false;
      // Normalize both sides (lowercase + trim via brandKey) then compare exactly.
      const docBrandKey = brandKey(data.brand as string);
      const matches = filters.brands.some((brand) => brandKey(brand) === docBrandKey);
      if (!matches) return false;
    }

    return true;
  }

  static async getUserArticles(userId: string): Promise<Article[]> {
    try {
      const articlesRef = collection(firestore, 'articles');
      const q = query(
        articlesRef,
        where('sellerId', '==', userId),
        where('isActive', '==', true),
        orderBy('createdAt', 'desc')
      );

      const querySnapshot = await getDocs(q);
      const articles: Article[] = [];

      querySnapshot.forEach((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();

        articles.push({
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() ?? new Date(),
          images: this.fixArticleImageUrls(data.images),
        } as Article);
      });

      return articles;
    } catch (error: any) {
      throw new Error(`Erreur lors de la recuperation des articles utilisateur: ${error.message}`);
    }
  }

  /** Owner navigation references only. No cached marker grants editing, admission or publication. */
  static async getUserArticlePreparations(expectedUid: string, cursor: string | null, assertContext: () => void): Promise<{
    items: {articleId: string; title: string | null}[]; cursor: string | null; hasMore: boolean; inspected: number;
  }> {
    const session = captureTradeSession(expectedUid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.includes('/') || ['.', '..'].includes(cursor) || /^__.*__$/.test(cursor) || encodeURIComponent(cursor).replace(/%[a-f0-9]{2}/gi, '_').length > 1500)) throw new Error('Le curseur de vos préparations doit être relu.');
    const constraints: QueryConstraint[] = [where('sellerId', '==', session.uid), orderBy(documentId(), 'asc'), firestoreLimit(21)];
    if (cursor) constraints.push(startAfter(cursor));
    const snap = await getDocsFromServer(query(collection(firestore, 'articles'), ...constraints)); current();
    const inspected = snap.docs.slice(0, 20), items = inspected.flatMap(row => {
      const data = row.data();
      if (data.sellerId !== session.uid || !Object.prototype.hasOwnProperty.call(data, 'childSafetyPreparation')) return [];
      return [{articleId: row.id, title: typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 500) : null}];
    });
    return {items, cursor: snap.size > 20 ? inspected.at(-1)!.id : null, hasMore: snap.size > 20, inspected: inspected.length};
  }

  static async updateArticle(articleId: string, updates: Partial<Article>): Promise<void> {
    const update = httpsCallable(functions, catalogueCallableName('updateArticle'));
    await update({ articleId, updates });
  }

  static async deleteArticle(articleId: string): Promise<void> {
    try {
      const updateArticleFn = httpsCallable<
        { articleId: string; updates: { isActive: boolean } },
        { success: boolean }
      >(functions, catalogueCallableName('updateArticle'));

      await updateArticleFn({ articleId, updates: { isActive: false } });
    } catch (error: any) {
      const message = error.message || 'Erreur lors de la suppression';
      throw new Error(`Erreur lors de la suppression de l'article: ${message}`);
    }
  }

  static async deleteImage(imageUrl: string): Promise<void> {
    try {
      const imageRef = ref(storage, imageUrl);
      await deleteObject(imageRef);
    } catch (error: any) {
      throw new Error(`Erreur lors de la suppression de l'image: ${error.message}`);
    }
  }
}
