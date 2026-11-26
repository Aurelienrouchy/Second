/** Native cash creation and history I/O; pure qualification lives in cashMeetupContract. */
import {Timestamp} from 'firebase-admin/firestore';
import {db,FieldValue} from '../config/firebase';
import {cashAgreementFacts,cashReleaseFacts,cashDigest,cashHash,cashOwnerUid,cashReservationWasReleased} from './cashMeetupContract';
export * from './cashMeetupContract';
type Data=FirebaseFirestore.DocumentData;

export function createCashAgreement(transactionId: string, order: Data, offeredBy: string, acceptedBy: string) {
  const facts = cashAgreementFacts(transactionId, order, { offeredBy, acceptedBy, articleSourceHash: cashDigest(order.articleSnapshot) });
  return { protocol: 'cash_meetup_agreement_v1', ...facts, agreementId: cashDigest(facts), acceptedAt: FieldValue.serverTimestamp(),
    platformMoneyObligationCents: 0, outsidePaymentVerified: false, physicalHandoverVerified: false };
}

export function createCashReservationRelease(transactionId: string, order: Data, disputeId: string,
  declaredBy: string, reason: string, details: string | null) {
  const facts = cashReleaseFacts(transactionId, order, { disputeId, declaredBy, reason, detailsHash: cashDigest(details), originalStatus: order.status });
  return { protocol: 'cash_meetup_reservation_release_v1', ...facts, releaseId: cashDigest(facts), releasedAt: FieldValue.serverTimestamp() };
}

/** A known cash absence claim may stay open while its reservation is released.
 * Any other/unknown contract or inventory complaint still requires review. */
export async function cashReservationCanBeReused(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data): Promise<boolean> {
  if (!cashReservationWasReleased(transactionId, order)) return false;
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
  const r = order.cashReservationRelease, report = order.noShowReport;
  const own = claims.docs.find(claim => claim.id === r.disputeId)?.data();
  if (claims.size >= 101 || !own || own.type !== 'meetup_no_show' || own.articleId !== order.articleId ||
      own.buyerId !== order.buyerId || own.sellerId !== order.sellerId || own.cashAgreementId !== order.cashAgreement.agreementId ||
      own.reservationReleaseId !== r.releaseId || own.reportedBy !== report.reportedBy || own.reportedAgainst !== report.reportedAgainst ||
      own.reason !== report.reason || (own.details ?? null) !== (report.details ?? null) || !(own.createdAt instanceof Timestamp) ||
      !own.createdAt.isEqual(report.reportedAt) || !['open', 'resolved'].includes(own.status)) return false;
  if (own.status === 'resolved' && (!(own.resolvedAt instanceof Timestamp) || !cashOwnerUid(own.resolvedBy) ||
      !cashHash(own.resolutionDecisionId) || !['buyer_upheld', 'dismissed'].includes(own.resolution))) return false;
  return !claims.docs.some(claim => claim.id !== r.disputeId);
}
