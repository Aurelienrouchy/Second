import { inventoryRecoverySourceFields } from './financialRecoverySources';
import { FinancialRecoveryBlocked } from './financialRecoveryInterlock';
/** Terminalising one transaction must never release a different agreement. */
import { db, FieldValue } from '../config/firebase';
import { cashReservationCanBeReused } from './cashMeetup';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import {inventoryEngagementMatches, planInventoryFinish, type InventoryPlan} from './inventoryUnit';

const releasePlans=new WeakMap<object,InventoryPlan>();
const qualifiedReleases=new WeakSet<object>();
/** Commit only after every caller read is finished. No hidden Firestore reads. */
export function commitArticleRelease(tx:FirebaseFirestore.Transaction,articleRef:FirebaseFirestore.DocumentReference,
  fields:FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>):void {
  if(!qualifiedReleases.has(fields))throw new FinancialRecoveryBlocked('inventory_release_not_prepared');
  releasePlans.get(fields)?.commit();tx.update(articleRef,fields);
}

export async function articleReservationOwnedBy(
  tx: FirebaseFirestore.Transaction,
  articleRef: FirebaseFirestore.DocumentReference,
  article: FirebaseFirestore.DocumentData,
  transactionId: string,
  newInventoryRelease = false
): Promise<boolean> {
  if(!await inventoryEngagementMatches(tx,articleRef.id,article,{kind:'purchase',id:transactionId,sourceArticleId:articleRef.id}))return false;
  if (article.activeTransactionId != null && (typeof article.activeTransactionId !== 'string' || !article.activeTransactionId ||
      article.activeTransactionId.includes('/') || article.activeTransactionId !== transactionId)) return false;
  if (article.activeTransactionId != null) {
    const linked = (await tx.get(db.collection('transactions').doc(article.activeTransactionId))).data();
    if (!linked || linked.articleId !== articleRef.id || returnToSenderBlocksProgress(linked)) return false;
  }
  // Legacy documents may have several transactions. Read under the same lock;
  // unknown states and completed sales also protect their article from an old
  // automatic refund/cancellation. Only cancelled/refunded agreements release it.
  const reservations = await tx.get(db.collection('transactions').where('articleId', '==', articleRef.id).limit(101));
  if (reservations.size >= 101) return false;
  for (const other of reservations.docs) {
    if (returnToSenderBlocksProgress(other.data())) return false;
    if (newInventoryRelease && !await fraudReviewAllowsProgress(tx, other.id, other.data(), other)) return false;
    if (other.id !== transactionId && (other.data().cashReservationRelease != null || !['cancelled', 'refunded'].includes(other.data().status)) &&
        !await cashReservationCanBeReused(tx, other.id, other.data())) return false;
  }
  return true;
}

/** Read phase only. Apply the returned fields after all other reads complete. */
export async function articleReleaseUpdate(
  tx: FirebaseFirestore.Transaction,
  articleRef: FirebaseFirestore.DocumentReference,
  article: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> | null> {
  const transaction = (await tx.get(db.collection('transactions').doc(transactionId))).data();
  if (!transaction || transaction.articleId !== articleRef.id || returnToSenderBlocksProgress(transaction)) return null;
  if (!await fraudReviewAllowsProgress(tx, transactionId, transaction)) return null;
  if (!await articleReservationOwnedBy(tx, articleRef, article, transactionId, true)) return null;
  const plan=await planInventoryFinish(tx,articleRef.id,article,{kind:'purchase',id:transactionId,sourceArticleId:articleRef.id});
  if(Object.prototype.hasOwnProperty.call(article,'inventoryUnit')&&!plan)return null;
  const next:FirebaseFirestore.DocumentData={...article,isSold:false};if(article.activeTransactionId===transactionId)delete next.activeTransactionId;
  const proof=plan?{}:await inventoryRecoverySourceFields('inventory_article',articleRef.path,article,next);
  const fields={ ...proof, isSold: false, soldAt: FieldValue.delete(),
    ...(article.activeTransactionId === transactionId ? { activeTransactionId: FieldValue.delete() } : {}) };
  qualifiedReleases.add(fields);if(plan)releasePlans.set(fields,plan);return fields;
}
