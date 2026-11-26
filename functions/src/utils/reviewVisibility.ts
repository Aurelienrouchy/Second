/** Public reviews and their atomic rating projection. Originals remain private. */
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {supportHash, supportSourceHash, supportRevision} from './supportRequest';
export const CONTENT_SAFETY_CAPABILITY = 'content_safety_v1';
export const CONTENT_SAFETY_ENABLED: boolean = true;
export const contentCaseId = (type: 'review' | 'message', id: string) => 'cm_' + supportHash([type, id]);
export const contentCaseRef = (type: 'review' | 'message', id: string) => db.collection('content_moderation_cases').doc(contentCaseId(type, id));
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const id = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') && Buffer.byteLength(v, 'utf8') <= 1500;
export function publicReviewVisible(d: FirebaseFirestore.DocumentData) {
  if (Object.prototype.hasOwnProperty.call(d, 'contentModeration') &&
      (d.contentModeration?.protocol !== 'content_visibility_v1' || d.contentModeration.state !== 'visible')) return false;
  return typeof d.note === 'number' && Number.isFinite(d.note) && d.note >= 1 && d.note <= 5 && typeof d.text === 'string';
}
/** A private native original permits an exact old Troc receipt to be observed;
 * it does not make the hidden review public or authorize another rating. */
export async function historicalReviewBody(tx: FirebaseFirestore.Transaction, reviewId: string, review: FirebaseFirestore.DocumentData) {
  const marker = review.contentModeration;
  if (marker == null || publicReviewVisible(review)) return review;
  if (marker.protocol !== 'content_visibility_v1' || marker.state !== 'hidden' || marker.caseId !== contentCaseId('review', reviewId)) return null;
  const root = (await tx.get(contentCaseRef('review', reviewId))).data();
  const raw = root?.original ? (await tx.get(contentCaseRef('review', reviewId).collection('originals').doc(root.original))).data() : null;
  const body = raw?.body;
  return raw?.protocol === 'content_original_v1' && raw.targetType === 'review' && raw.targetId === reviewId && native(raw.recordedAt) &&
    body && supportSourceHash(body) === raw.sourceHash && raw.sourceHash === root?.original && publicReviewVisible(body) &&
    root?.current?.state === 'hidden' && Number.isSafeInteger(marker.version) && root.current.version >= marker.version &&
    body.reviewerId === review.reviewerId && body.vendeurId === review.vendeurId && body.transactionId === review.transactionId ? body : null;
}
export async function readNativeReview(tx: FirebaseFirestore.Transaction, reviewId: string) {
  const snap = await tx.get(db.collection('avis').doc(reviewId)), review = snap.data();
  if (!review || !id(review.reviewerId) || !id(review.vendeurId) || review.reviewerId === review.vendeurId || !id(review.transactionId)) return null;
  const swap = review.transactionType === 'swap';
  const parent = await tx.get(db.collection(swap ? 'swaps' : 'transactions').doc(review.transactionId)), data = parent.data();
  const parties = swap ? [data?.initiatorId, data?.receiverId] : [data?.buyerId, data?.sellerId];
  if (!data || !parties.every(id) || parties[0] === parties[1] || !parties.includes(review.reviewerId) || !parties.includes(review.vendeurId)) return null;
  return {snap, review, parent, parties: parties as string[], kind: swap ? 'swap' as const : 'order' as const,
    sourceHash: supportSourceHash({review, parent: data, reviewRevision: supportRevision(snap), parentRevision: supportRevision(parent)})};
}
export function visibleReviewSummary(rows: {id: string; data: FirebaseFirestore.DocumentData}[], overflow = false) {
  const visible = rows.filter(r => publicReviewVisible(r.data));
  const malformed = rows.some(r => !publicReviewVisible(r.data) && !(r.data.contentModeration?.protocol === 'content_visibility_v1' &&
    r.data.contentModeration.state === 'hidden' && r.data.note === null && r.data.text === ''));
  const known = !overflow && !malformed;
  return {qualification: known ? 'native_visible_reviews' as const : 'unknown' as const,
    totalReviews: known ? visible.length : null, averageRating: known ? visible.length ? Math.round(visible.reduce((s, r) => s + r.data.note, 0) / visible.length * 10) / 10 : 0 : null};
}
/** Every create/hide/restore reads and updates the same user inside its TX.
 * A concurrent review cannot overwrite a moderation aggregate from an old scan. */
export async function prepareVisibleRating(tx: FirebaseFirestore.Transaction, userId: string, change?: {id: string; data: FirebaseFirestore.DocumentData}) {
  const userRef = db.collection('users').doc(userId), user = await tx.get(userRef);
  const page = await tx.get(db.collection('avis').where('vendeurId', '==', userId).limit(1001));
  const rows = page.docs.filter(r => r.id !== change?.id).map(r => ({id: r.id, data: r.data()}));
  if (change) rows.push(change);
  const summary = visibleReviewSummary(rows, page.size > 1000);
  return {summary, commit: () => {
    if (user.exists) tx.update(userRef, {rating: summary.averageRating, reviewCount: summary.totalReviews,
      reviewStatsQualification: summary.qualification, updatedAt: Timestamp.now()});
  }};
}
