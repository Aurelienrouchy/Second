/** Native article-review sources. A recorded statement or snapshot proves no physical fact. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportHash, supportId, supportObject, supportRevision, supportSourceHash} from './supportRequest';
import {reportEvidenceReceipt} from './reportEvidence';
import {articlePrivacyWithdrawn} from './publicProfile';
import {readArticleChildSafetySource} from './articleChildSafety';
import {productMaterialAttributes} from './productReviewMaterial';
import {readProductParcelSources, publicProductParcelSources} from './productReviewParcel';

type Data = FirebaseFirestore.DocumentData;
export const PRODUCT_REVIEW_TOPICS = ['authenticity', 'recall', 'child_safety', 'hygiene', 'animal_material'] as const;
export type ProductReviewTopic = typeof PRODUCT_REVIEW_TOPICS[number] | 'nonconformity' | 'parcel_delivery';
export type ProductReviewRole = 'buyer' | 'seller' | 'reporter';
export type ProductReviewContext = {kind: 'order' | 'article_report' | 'article_listing'; id: string};
export const PRODUCT_REVIEW_EFFECTS = {authenticityVerified: false, recallApplicabilityVerified: false,
  childSafetyVerified: false, hygieneVerified: false, speciesOrProvenanceVerified: false,
  financialEffectAuthorized: false, inventoryEffectAuthorized: false, shippingPermissionGranted: false,
  physicalContentsVerified: false, legalDeadlineEstablished: false} as const;
export function productReviewContext(value: unknown): ProductReviewContext {
  const input = supportObject(value, ['kind', 'id']);
  if (!['order', 'article_report', 'article_listing'].includes(input.kind)) throw new HttpsError('invalid-argument', 'Contexte d’examen invalide.');
  return {kind: input.kind, id: supportId(input.id, 'Référence native')};
}
export const productReviewCaseId = (context: ProductReviewContext) => 'pr_' + supportHash([context.kind, context.id]);
export const productReviewCaseRef = (context: ProductReviewContext) => db.collection('product_review_cases').doc(productReviewCaseId(context));
const actorId = (value: unknown): string | null => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') ? value : null;
const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim() && value.length <= max ? value : null;
const plain = (value: unknown): value is Data => !!value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function identity(snap: FirebaseFirestore.DocumentSnapshot | null) {
  let hash: string | null = null;
  if (snap?.exists) {try {hash = supportSourceHash(snap.data());} catch { /* Native malformed data stays unknown. */ }}
  return {present: snap?.exists === true, revision: snap?.exists ? supportRevision(snap) : null, sourceHash: hash};
}
/** No image URL/token, address, financial secret or private reporter narrative. */
function articleText(value: unknown) {
  const item = plain(value) ? value : {};
  const strings = (v: unknown) => Array.isArray(v) && v.length <= 20 && v.every(s => text(s, 200) !== null) ? v : null;
  return {title: text(item.title, 500), description: text(item.description, 8000), condition: text(item.condition, 200),
    brand: text(item.brand, 300), brandStatus: text(item.brandStatus, 100), category: text(item.category, 300),
    categoryIds: strings(item.categoryIds), materials: strings(item.materials),
    model: text(item.model, 300), lot: text(item.lot, 300), productReference: text(item.productReference, 300),
    species: text(item.species, 300), provenance: text(item.provenance, 2000),
    imageCountRecorded: Array.isArray(item.images) && item.images.length <= 100 ? item.images.length : null,
    imagesAreReceivedItemEvidence: false};
}
export type ProductReviewSource = Awaited<ReturnType<typeof readProductReviewSource>>;
async function readListingSource(tx: FirebaseFirestore.Transaction, context: ProductReviewContext) {
  const articleSnap = await tx.get(db.collection('articles').doc(context.id)), data = articleSnap.data();
  if (!data) throw new HttpsError('not-found', 'Annonce native de l’examen indisponible.');
  const sellerId = actorId(data.sellerId);
  if (!sellerId) throw new HttpsError('failed-precondition', 'Le vendeur natif doit être rapproché.');
  const caseSnap = await tx.get(productReviewCaseRef(context));
  const currentRecorded = !articlePrivacyWithdrawn(data);
  const childSafety = readArticleChildSafetySource(context.id, data);
  // This v2 branch cannot alter hashes/DTOs of old order/report sources. No
  // executed contract, received item or listing permission is inferred here.
  const document = {protocol: 'product_review_source_v2', context, articleId: context.id,
    nativeActors: {buyerId: null, sellerId, reporterId: null}, contextSource: identity(articleSnap), articleSource: identity(articleSnap), caseSource: identity(caseSnap),
    sources: {
      contractSnapshot: {qualification: 'unknown', content: articleText(null), executedAgreementVerified: false},
      currentListing: {qualification: currentRecorded ? 'current_listing_recorded' : 'unknown', content: articleText(currentRecorded ? data : null)},
      reportedListing: {qualification: 'unknown', articleRevision: null, contentHash: null, capturedAt: null, mediaCount: null, content: articleText(null)},
      receivedItem: {qualification: 'unknown', source: 'requires_separate_participant_declaration', physicalContentsVerified: false}},
    listingSubmission: {moderationStatus: text(data.moderationStatus, 100), isActive: typeof data.isActive === 'boolean' ? data.isActive : null,
      childSafety, admissionPermissionGranted: false}, ...PRODUCT_REVIEW_EFFECTS};
  return {context, caseId: productReviewCaseId(context), caseSnap, document, sourceHash: supportSourceHash(document), readAt: Timestamp.now()};
}
/** Call within the caller's TX. SDK historical servicing reads native parties,
 * never admission flags/profile. Administrator authority is checked separately. */
export async function readProductReviewSource(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, material = false, parcel = false) {
  if ((material || parcel) && context.kind !== 'order') throw new HttpsError('invalid-argument', 'La comparaison matérielle porte sur une commande native.');
  if (context.kind === 'article_listing') return readListingSource(tx, context);
  const contextSnap = await tx.get(db.collection(context.kind === 'order' ? 'transactions' : 'reports').doc(context.id));
  const data = contextSnap.data();
  if (!data) throw new HttpsError('not-found', 'Source native de l’examen indisponible.');
  const buyerId = context.kind === 'order' ? actorId(data.buyerId) : null;
  const sellerId = actorId(context.kind === 'order' ? data.sellerId : data.targetOwnerId);
  const reporterId = context.kind === 'article_report' ? actorId(data.reporterId) : null;
  const articleId = actorId(context.kind === 'order' ? data.articleId : data.targetType === 'article' ? data.targetId : null);
  if (context.kind === 'order' && (!buyerId || !sellerId || buyerId === sellerId) ||
      context.kind === 'article_report' && (!reporterId || data.targetType !== 'article'))
    throw new HttpsError('failed-precondition', 'Les parties natives de l’examen doivent être rapprochées.');
  const articleSnap = articleId ? await tx.get(db.collection('articles').doc(articleId)) : null;
  const caseSnap = await tx.get(productReviewCaseRef(context));
  let reportCapture: {qualification: 'native_report_capture' | 'unknown'; articleRevision: string | null;
    contentHash: string | null; capturedAt: string | null; mediaCount: number | null} = {
      qualification: 'unknown', articleRevision: null, contentHash: null, capturedAt: null, mediaCount: null};
  if (context.kind === 'article_report' && reporterId && data.articleEvidence?.requestId) {
    try {
      const receipt = await reportEvidenceReceipt(data, context.id, reporterId, data.articleEvidence.requestId, tx);
      reportCapture = {qualification: 'native_report_capture', articleRevision: receipt.articleRevision,
        contentHash: receipt.contentHash, capturedAt: receipt.receivedAt, mediaCount: receipt.mediaCount};
    } catch (error) {
      if (!(error instanceof HttpsError)) throw error;
      // Missing/malformed historical anchors never become preserved pixels.
    }
  }
  const contextSource = identity(contextSnap), articleSource = identity(articleSnap), caseSource = identity(caseSnap);
  const contractRecorded = context.kind === 'order' && plain(data.articleSnapshot);
  const reportRecorded = reportCapture.qualification === 'native_report_capture';
  const currentRecorded = articleSnap?.exists && articleSnap.data()?.sellerId === sellerId && !articlePrivacyWithdrawn(articleSnap.data());
  const document = {protocol: parcel ? 'product_review_source_v4' : material ? 'product_review_source_v3' : 'product_review_source_v1', context, articleId,
    nativeActors: {buyerId, sellerId, reporterId}, contextSource, articleSource, caseSource,
    sources: {
      contractSnapshot: {qualification: contractRecorded ? 'native_order_snapshot_recorded' : 'unknown',
        content: articleText(contractRecorded ? data.articleSnapshot : null), executedAgreementVerified: false},
      currentListing: {qualification: currentRecorded ? 'current_listing_recorded' : 'unknown',
        content: articleText(currentRecorded ? articleSnap!.data() : null)},
      reportedListing: {...reportCapture, content: articleText(reportRecorded ? data.articleEvidence.snapshot : null)},
      receivedItem: {qualification: 'unknown', source: 'requires_separate_participant_declaration', physicalContentsVerified: false}},
    ...((material || parcel) ? {materialAttributes: {protocol: 'product_material_sources_v1',
      contract: {qualification: contractRecorded ? 'native_order_snapshot_recorded' : 'unknown', content: productMaterialAttributes(contractRecorded ? data.articleSnapshot : null)},
      currentListing: {qualification: currentRecorded ? 'current_listing_recorded' : 'unknown', content: productMaterialAttributes(currentRecorded ? articleSnap!.data() : null)},
      received: {qualification: 'unknown', source: 'separate_participant_declaration', physicalFactsVerified: false},
      currentListingSuppliesMissingContract: false, comparisonsCertified: false}} : {}),
    ...(parcel ? {parcelSources: await readProductParcelSources(tx, context.id, data)} : {}),
    ...PRODUCT_REVIEW_EFFECTS};
  return {context, caseId: productReviewCaseId(context), caseSnap, document,
    sourceHash: supportSourceHash(document), readAt: Timestamp.now()};
}
export function productReviewRoles(source: ProductReviewSource, uid: string): ProductReviewRole[] {
  return (['buyer', 'seller', 'reporter'] as const).filter(role => source.document.nativeActors[`${role}Id`] === uid);
}
export function productReviewSourceView(source: ProductReviewSource, uid: string) {
  const {nativeActors: _privateActors, ...document} = source.document;
  return {...document, ...('parcelSources' in document && document.parcelSources ? {parcelSources: publicProductParcelSources(document.parcelSources)} : {}), caseId: source.caseId, sourceHash: source.sourceHash,
    actorId: uid, actorRoles: productReviewRoles(source, uid), readAt: source.readAt.toDate().toISOString(),
    originalsAccessGranted: false, exhaustiveHistoryVerified: false};
}
