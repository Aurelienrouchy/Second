/** Terminalising one transaction must never release a different agreement. */
import { db, FieldValue } from '../config/firebase';

export async function articleReservationOwnedBy(
  tx: FirebaseFirestore.Transaction,
  articleRef: FirebaseFirestore.DocumentReference,
  article: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<boolean> {
  if (typeof article.activeTransactionId === 'string' && article.activeTransactionId.length > 0) {
    return article.activeTransactionId === transactionId;
  }
  // Legacy documents may have several transactions. Read under the same lock;
  // unknown states and completed sales also protect their article from an old
  // automatic refund/cancellation. Only cancelled/refunded agreements release it.
  const reservations = await tx.get(db.collection('transactions').where('articleId', '==', articleRef.id));
  return !reservations.docs.some(other => other.id !== transactionId &&
    !['cancelled', 'refunded'].includes(other.data().status));
}

/** Read phase only. Apply the returned fields after all other reads complete. */
export async function articleReleaseUpdate(
  tx: FirebaseFirestore.Transaction,
  articleRef: FirebaseFirestore.DocumentReference,
  article: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> | null> {
  if (!await articleReservationOwnedBy(tx, articleRef, article, transactionId)) return null;
  return { isSold: false, soldAt: FieldValue.delete(),
    ...(article.activeTransactionId === transactionId ? { activeTransactionId: FieldValue.delete() } : {}) };
}
