import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { hasNativeUnacceptedSwapAgreement, hasUnreservedSwapProposal } from './swapLaunchPolicy';

const HISTORY_LIMIT = 101;
const nativeTime = (value: unknown): value is Timestamp => value instanceof Timestamp &&
  value.toMillis() > 0 && value.toMillis() <= Date.now() + 60_000;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('/');
const refusal = (reason: string) => new HttpsError('failed-precondition',
  'Cet article est engagé dans un Troc ou son historique doit être examiné avant une nouvelle réservation.', { reason });

/** Only a native ended proposal proves release. A completed exchange consumed
 * the article even while its post-transaction isSold projection is still late.
 * Financial/dispute/physical markers are never interpreted as a release. */
function isReleasedProposal(data: FirebaseFirestore.DocumentData, articleId: string): boolean {
  if (!['cancelled', 'declined'].includes(data.status) || !id(data.initiatorId) || !id(data.receiverId) || data.initiatorId === data.receiverId ||
      data.articleDeclarationProposalVersion !== 1 || !nativeTime(data.articleDeclarationProposalRecordedAt) || !nativeTime(data.createdAt) ||
      data.articleDeclarationProposalRecordedAt.toMillis() > data.createdAt.toMillis() || !nativeTime(data.updatedAt) ||
      data.updatedAt.toMillis() < data.createdAt.toMillis()) return false;
  const irreversible = ['initiatorPhotos', 'receiverPhotos', 'initiatorShippedAt', 'receiverShippedAt',
    'initiatorReceivedAt', 'receiverReceivedAt', 'completedAt', 'acceptedAt', 'statusBeforeDispute', 'paymentIntentId', 'stripePaymentIntentId', 'stripeChargeId', 'bankDispute'];
  if (Object.keys(data).some(key => irreversible.includes(key) || /^(topup|refund|dispute)/i.test(key))) return false;
  if (['exchangeMode', 'exchangeAgreement', 'swapLaunchPolicyVersion'].some(key => key in data) &&
      !hasNativeUnacceptedSwapAgreement({ ...data, status: 'proposed' })) return false;
  const sides = ['initiator', 'receiver'] as const;
  const selected = sides.flatMap(side => {
    const items = data[side + 'Items'] ?? (data[side + 'Item'] ? [data[side + 'Item']] : []);
    return Array.isArray(items) ? items.filter(item => item?.articleId === articleId).map(item => ({ side, item })) : [];
  });
  if (selected.length !== 1) return false;
  const { side, item } = selected[0], witness = item.saleDeclarationProposalWitness;
  if (witness?.schemaVersion !== 1 || witness.source !== 'native_article_at_proposal' || witness.articleId !== articleId ||
      witness.sellerId !== data[side + 'Id'] || !nativeTime(witness.declaration?.declaredAt)) return false;
  if (data.status === 'declined') return !('acceptedAt' in data) && [data.initiatorId, data.receiverId].includes(data.declinedBy) &&
    nativeTime(data.declinedAt) && data.declinedAt.toMillis() >= data.createdAt.toMillis();
  return ['cancelled_by_initiator', 'proposed_expired_7d'].includes(data.cancelReason) &&
    (data.cancelReason !== 'proposed_expired_7d' || !('acceptedAt' in data));
}

/** NEW reservation/authorization only, after exact committed receipt recovery.
 * Queries run under the same transaction as the article read and reservation
 * write, so a competing native swap creation participates in serialization.
 * Each is a single-field index. Older array roots without articleIds are
 * checked by the native seller's participation, never a client owner input. */
export async function assertArticleNotSwapEngaged(tx: FirebaseFirestore.Transaction, articleId: string): Promise<void> {
  const article = (await tx.get(db.collection('articles').doc(articleId))).data();
  if (!id(article?.sellerId)) throw refusal('article_swap_history_review_required');
  const queries: { query: FirebaseFirestore.Query; side?: 'initiator' | 'receiver' }[] = [
    { query: db.collection('swaps').where('articleIds', 'array-contains', articleId) },
    { query: db.collection('swaps').where('initiatorItem.articleId', '==', articleId) },
    { query: db.collection('swaps').where('receiverItem.articleId', '==', articleId) },
    { query: db.collection('swaps').where('initiatorId', '==', article.sellerId), side: 'initiator' },
    { query: db.collection('swaps').where('receiverId', '==', article.sellerId), side: 'receiver' }];
  const seen = new Set<string>();
  for (const { query, side } of queries) {
    const found = await tx.get(query.limit(HISTORY_LIMIT));
    if (found.size >= HISTORY_LIMIT) throw refusal('article_swap_history_review_required');
    for (const doc of found.docs) {
      if (seen.has(doc.id)) continue;
      const data = doc.data();
      if (side) {
        const items = data[side + 'Items'] ?? (data[side + 'Item'] ? [data[side + 'Item']] : null);
        if (!Array.isArray(items) || items.some(item => !id(item?.articleId))) throw refusal('article_swap_history_review_required');
        if (!items.some(item => item.articleId === articleId)) continue;
      }
      seen.add(doc.id);
      if (hasUnreservedSwapProposal(data)) continue;
      if (!isReleasedProposal(data, articleId)) throw refusal(data.status === 'completed' ? 'article_swap_consumed' : 'article_swap_engaged');
    }
  }
}
