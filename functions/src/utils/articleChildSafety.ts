import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { CHILD_SAFETY_INPUT_FIELDS, childSafetyCategory, childSafetyStatementProjection, parseChildSafetyDeclaration } from '../shared/articleChildSafety';

const CONTENT_FIELDS = ['title', 'description', 'category', 'categoryIds', 'condition', 'size', 'brandStatus', 'brand',
  'colors', 'color', 'materials', 'material', 'hasKnownDefects', 'defectsDescription', 'hasAlterations', 'alterationsDescription', 'images', 'saleUnit'] as const;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const stamp = (value: unknown): value is Timestamp => value instanceof Timestamp && value.toMillis() > 0 && value.toMillis() <= Date.now() + 60_000;
function content(article: FirebaseFirestore.DocumentData) {
  return Object.fromEntries(CONTENT_FIELDS.filter(key => article[key] !== undefined).map(key => [key, key === 'images' && Array.isArray(article.images)
    ? article.images.map(image => typeof image === 'string' ? image : image?.url ?? null) : article[key]]));
}
export function childSafetyContentHash(articleId: string, article: FirebaseFirestore.DocumentData): string {
  return hash([articleId, article.sellerId ?? null, content(article)]);
}
export function declaredArticleChildSafety(articleId: string, article: FirebaseFirestore.DocumentData, uid: string, input: unknown) {
  const category = childSafetyCategory(article.categoryIds);
  if (category === 'invalid') throw new HttpsError('invalid-argument', 'Choisissez une catégorie canonique précise.', { reason: 'article_child_safety_category_invalid' });
  if (category === 'not_child_clothing' && !Object.prototype.hasOwnProperty.call(article, 'childSafetyPreparation')) {
    if (input != null) throw new HttpsError('invalid-argument', 'La déclaration enfant ne correspond pas à cette catégorie.', { reason: 'article_child_safety_category_mismatch' });
    return null;
  }
  const declaration = parseChildSafetyDeclaration(input);
  if (!declaration) throw new HttpsError('failed-precondition', 'Déclarez explicitement l’usage et les observations de sécurité du vêtement enfant.',
    { reason: 'article_child_safety_statement_required', field: 'childSafetyDeclaration' });
  if (article.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre annonce.');
  const contentHash = childSafetyContentHash(articleId, article);
  return { ...declaration, articleId, actorUid: uid, categoryIds: [...article.categoryIds], contentHash,
    statementHash: hash([articleId, uid, contentHash, declaration]), declaredAt: Timestamp.now() };
}
export function readArticleChildSafetySource(articleId: string, article: FirebaseFirestore.DocumentData) {
  const category = childSafetyCategory(article.categoryIds), native = article.childSafetyDeclaration;
  const input = childSafetyStatementProjection(native), contentHash = childSafetyContentHash(articleId, article);
  const nativeKeys = ['articleId', 'actorUid', 'categoryIds', 'contentHash', 'statementHash', 'declaredAt'];
  const qualified = !!input && !!native && Object.keys(native).every(key => (CHILD_SAFETY_INPUT_FIELDS as readonly string[]).includes(key) || nativeKeys.includes(key)) && native.articleId === articleId &&
    typeof article.sellerId === 'string' && native.actorUid === article.sellerId && stamp(native.declaredAt) &&
    JSON.stringify(native.categoryIds) === JSON.stringify(article.categoryIds) && native.contentHash === contentHash &&
    native.statementHash === hash([articleId, article.sellerId, contentHash, input]);
  const reasons: string[] = [];
  if (category === 'invalid') reasons.push('canonical_category_unknown');
  if (Object.prototype.hasOwnProperty.call(article, 'childSafetyPreparation')) reasons.push('previous_child_safety_review');
  if (category === 'canonical_sleepwear') reasons.push('canonical_sleepwear');
  if (qualified && (input!.intendedUse !== 'daywear_only' || input!.sleepwearStyle !== null)) reasons.push('sleep_or_use_uncertain');
  if (qualified && input!.safetyConcern !== 'none_observed') reasons.push('safety_concern_or_unknown');
  if (qualified && (category === 'canonical_sleepwear' || input!.intendedUse !== 'daywear_only') && input!.labelStatus !== 'readable') reasons.push('sleepwear_label_unknown');
  const requirement = category === 'not_child_clothing' && !reasons.length ? 'not_required'
    : !qualified && category !== 'not_child_clothing' ? 'seller_statement_required'
    : reasons.length ? 'human_review_required' : 'daywear_statement';
  // Deliberately excludes our moderation/preparation/decision writes and price.
  const sourceHash = hash(['article_child_safety_source_v1', articleId, article.sellerId ?? null, content(article), native ?? null]);
  return { protocol: 'article_child_safety_source_v1' as const, articleId, sellerId: typeof article.sellerId === 'string' ? article.sellerId : null,
    sourceHash, requirement, reasons, statementQualification: qualified ? 'native_current' as const : category === 'not_child_clothing' && !native ? 'not_applicable' as const : 'unknown' as const,
    declaration: qualified ? { ...input!, actorUid: native.actorUid as string, declaredAtMs: Math.floor(native.declaredAt.toMillis()), statementHash: native.statementHash as string } : null,
    physicalComplianceVerified: false as const, platformCertificationGranted: false as const };
}
/** Sole exception to generic editing locks: correct this native preparation,
 * never an unrelated removal, an engaged agreement, or a privacy withdrawal. */
export function isChildSafetyPreparationEditable(articleId: string, article: FirebaseFirestore.DocumentData): boolean {
  const marker = article.childSafetyPreparation, source = readArticleChildSafetySource(articleId, article);
  return marker?.protocol === 'article_child_safety_preparation_v1' && marker.articleId === articleId && marker.sellerId === article.sellerId &&
    marker.sourceHash === source.sourceHash && marker.state === 'awaiting_review' && stamp(marker.submittedAt) &&
    article.moderationStatus === 'pending' && article.moderationSource === 'child_safety_review' && article.isActive === false && article.isSold === false;
}
export function childSafetyPreparation(articleId: string, article: FirebaseFirestore.DocumentData) {
  const source = readArticleChildSafetySource(articleId, article);
  if (source.requirement === 'seller_statement_required') throw new HttpsError('failed-precondition', 'La déclaration de sécurité enfant manque ou ne correspond plus au contenu.', { reason: 'article_child_safety_statement_required' });
  if (source.requirement !== 'human_review_required') return {};
  return { isActive: false, moderationStatus: 'pending', moderationSource: 'child_safety_review', childSafetyPreparation: {
    protocol: 'article_child_safety_preparation_v1', articleId, sellerId: article.sellerId, sourceHash: source.sourceHash,
    state: 'awaiting_review', submittedAt: Timestamp.now() } };
}
