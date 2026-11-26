/** Carrier-confirmed return reception is distinct from refund settlement. */
import { db, FieldValue } from '../config/firebase';
import { resumeTransactionRefund, type IssueRefundResult } from './refund';
import { trackingObservationDisposition, type QualifiedTracking } from '../config/shipEngine';
import { trackingOutcomeMatches } from './trackingTransition';
import {committedReturnReceipt} from './returnRequest';

export interface ReturnRefundResult {
  refunded: boolean;
  alreadyRefunded?: boolean;
  refund?: IssueRefundResult;
}

export async function processReturnDelivered(transactionId: string, source: string, proof?: QualifiedTracking['proof'],
  guard?: (tx: FirebaseFirestore.Transaction) => Promise<unknown>): Promise<ReturnRefundResult> {
  const txRef = db.collection('transactions').doc(transactionId);
  const data = await db.runTransaction(async tx => {
    await guard?.(tx);
    const fresh = (await tx.get(txRef)).data();
    const legacyReturnRefund = typeof fresh?.refund?.source === 'string' && fresh.refund.source.startsWith('returnRefund_');
    if (!fresh || !committedReturnReceipt(transactionId, fresh) && !legacyReturnRefund ||
        proof?.statusCode !== 'DE' || !await trackingOutcomeMatches(tx, transactionId, fresh, proof, 'return')) return null;
    if (trackingObservationDisposition(fresh, proof, 'return') === 'snapshot') return null;
    if (!fresh.returnDeliveredAt && trackingObservationDisposition(fresh, proof, 'return') === 'replay') return null;
    const alertRef = db.collection('admin_alerts').doc(`return_content_${transactionId}`);
    const alert = await tx.get(alertRef);
    tx.update(txRef, { returnTrackingStatus: 'DELIVERED', ...(!fresh.returnDeliveredAt ? {returnDeliveredAt: FieldValue.serverTimestamp(),
      returnDeliveryProof: {...proof, recordedAt: FieldValue.serverTimestamp()}} : {}),
      returnTrackingObservation: {...proof, source, recordedAt: FieldValue.serverTimestamp()} });
    // A carrier delivered a parcel. Neither its contents nor responsibility for
    // the label charge is proved by that scan. Preserve the financial hold and
    // open instruction instead of creating a new refund or deducting a fee.
    if (!fresh.refund) tx.set(alertRef, {kind: 'return_content_review', severity: 'warning', status: 'open', refId: transactionId,
      message: 'Colis de retour livré : vérifier le contenu et décider du remboursement et des frais.',
      context: {transactionId, requestId: fresh.returnRequest?.requestId ?? null, buyerId: fresh.buyerId,
        sellerId: fresh.sellerId, labelId: proof.labelId, trackingNumber: proof.trackingNumber,
        refundDecisionGranted: false, contentsReceivedConfirmed: false},
      createdAt: alert.data()?.createdAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    return {...fresh, resumeExistingReturnRefund: legacyReturnRefund};
  });
  if (!data) return {refunded: false};
  // Only the already engaged legacy return-refund intention is resumed. A
  // later DE never starts/re-drives an unrelated refund or alters its outcome.
  if (data.resumeExistingReturnRefund) {
    const result = await resumeTransactionRefund(transactionId);
    return { refunded: result.success, refund: result, ...(result.alreadyRefunded ? { alreadyRefunded: true } : {}) };
  }
  return {refunded: false};
}
