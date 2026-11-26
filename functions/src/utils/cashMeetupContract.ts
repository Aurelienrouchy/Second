/** Native cash agreement and reservation release; neither proves a handover nor an outside payment. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { hasActiveBankDispute } from './bankDispute';
import { hasUnsettledRefund } from './refundState';

type Data = FirebaseFirestore.DocumentData;
export const cashReference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
export const cashOwnerUid = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 &&
  !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
export const cashHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function canonical(v: any): any {
  if (v instanceof Timestamp) return [v.seconds, v.nanoseconds];
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v === undefined ? null : v;
}
export const cashDigest = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const zeroFields = ['shippingCost', 'serviceFee', 'serviceFeePercent', 'serviceFeeFixed', 'serviceFeeMin', 'buyerFeeReduction',
  'taxTotal', 'taxGst', 'taxQst', 'insuranceCost', 'actualShippingCost', 'shippingCostDelta', 'returnLabelCost',
  'walletAmountUsed', 'walletPaidAmount', 'sellerCreditedCents', 'sellerPendingCreditCents', 'sellerHeldCreditCents',
  'sellerReleasedCents', 'sellerDebtRepaidCents', 'disputeFreezeCents', 'labelAttempts'];
const financialMarkers = ['stripePaymentIntentId', 'stripeClientSecret', 'stripeChargeId', 'capturedCardCents', 'paidAt',
  'stripeCheckoutCreatedAt', 'stripeCheckoutProtocol', 'walletCheckoutAttemptId', 'walletCheckoutOutcome', 'walletDebitedAt', 'walletPayment',
  'fundsReleaseAt', 'fundsReleasedAt', 'refund', 'stripeRefundId', 'stripeRefundIssuedAt', 'refundedAt', 'refundedVia',
  'refundStartedAt', 'refundReason', 'refundLegacyOperationId', 'bankDispute', 'disputeId', 'disputeClosedAt',
  'shippingQuoteId', 'shipEngineRateId', 'shipEngineLabelId', 'carrierCode', 'shippingLabelUrl', 'trackingNumber', 'trackingStatus', 'trackingUrl',
  'shippingAddress', 'intelcomBookingId', 'labelCreatedAt', 'lastLabelAttemptAt', 'labelStaleNudgedAt',
  'shippingReconciledAt', 'shippedAt', 'deliveredAt', 'deliveryFailedAt', 'deliveryConfirmedAt', 'trackingObservation', 'trackingSnapshot',
  'deliveryTrackingProof', 'deliveryCorrection', 'deliveryCorrectionBlocked', 'orderModeration', 'buyerReport', 'pendingCancellation',
  'returnRequest', 'returnLabelId', 'returnTrackingNumber', 'returnLabelUrl', 'returnRequestedAt', 'returnDeliveredAt',
  'refundInventoryReviewRequired', 'returnReconciliationRequired', 'returnReconciliationReason', 'returnReason'];

/** Absence of a provider ID alone is never evidence of a cash contract. */
export function cashAmountsRemainUnfinanced(order: Data): boolean {
  const present = (k: string) => Object.prototype.hasOwnProperty.call(order, k);
  return order.deliveryType === 'meetup' && !hasActiveBankDispute(order) && !hasUnsettledRefund(order) &&
    !financialMarkers.some(present) && zeroFields.every(k => !present(k) || order[k] === 0) &&
    ['refundBlocked', 'refundLegacyReconciliationRequired', 'returnLabelPending'].every(k => !present(k) || order[k] === false) &&
    (!present('paidVia') || order.paidVia === 'cash') && (!present('currency') || order.currency === 'CAD') &&
    typeof order.amount === 'number' && Number.isFinite(order.amount) && order.amount > 0 &&
    Number.isSafeInteger(Math.round(order.amount * 100)) && Math.abs(order.amount * 100 - Math.round(order.amount * 100)) < 0.0000001 &&
    order.totalAmount === order.amount && order.sellerPayout === order.amount && order.shippingCost === 0 && order.serviceFee === 0;
}

export function cashAgreementFacts(transactionId: string, order: Data, agreement: Data) {
  return { transactionId, articleId: order.articleId, buyerId: order.buyerId, sellerId: order.sellerId, chatId: order.chatId,
    offerMessageId: order.offerMessageId, amountCents: Math.round(order.amount * 100), currency: 'CAD', shippingCents: 0,
    serviceFeeCents: 0, source: 'acceptMeetupOffer', offeredBy: agreement.offeredBy, acceptedBy: agreement.acceptedBy,
    articleSourceHash: agreement.articleSourceHash, locationSourceHash: cashDigest(order.meetupSpot) };
}

export function qualifiedCashAgreement(transactionId: string, order: Data): boolean {
  const a = order.cashAgreement;
  if (!a || a.protocol !== 'cash_meetup_agreement_v1' || !cashAmountsRemainUnfinanced(order) ||
      ![order.articleId, order.chatId, order.offerMessageId].every(cashReference) ||
      ![order.buyerId, order.sellerId].every(cashOwnerUid) ||
      order.buyerId === order.sellerId || ![order.buyerId, order.sellerId].includes(a.offeredBy) ||
      ![order.buyerId, order.sellerId].includes(a.acceptedBy) || a.offeredBy === a.acceptedBy ||
      !(a.acceptedAt instanceof Timestamp) || !cashHash(a.articleSourceHash) ||
      a.articleSourceHash !== cashDigest(order.articleSnapshot) || a.platformMoneyObligationCents !== 0 ||
      a.outsidePaymentVerified !== false || a.physicalHandoverVerified !== false) return false;
  const facts = cashAgreementFacts(transactionId, order, a);
  return a.agreementId === cashDigest(facts) && Object.entries(facts).every(([k, v]) => a[k] === v);
}

export function cashReleaseFacts(transactionId: string, order: Data, receipt: Data) {
  return { transactionId, agreementId: order.cashAgreement?.agreementId, articleId: order.articleId,
    buyerId: order.buyerId, sellerId: order.sellerId, offerMessageId: order.offerMessageId, disputeId: receipt.disputeId,
    declaredBy: receipt.declaredBy, reason: receipt.reason, detailsHash: receipt.detailsHash,
    originalStatus: receipt.originalStatus, source: 'reportMeetupNoShow', moneyMoved: false, complaintClosed: false,
    faultEstablished: false, reservationReleased: true };
}

/** Server-only immutable receipt survives the case classification; it never revives the old agreement. */
export function cashReservationWasReleased(transactionId: string, order: Data): boolean {
  const r = order.cashReservationRelease, report = order.noShowReport;
  if (!qualifiedCashAgreement(transactionId, order) || !r || r.protocol !== 'cash_meetup_reservation_release_v1' ||
    !['disputed', 'cancelled'].includes(order.status) || order.cashReservationReviewRequired === true || !cashReference(r.disputeId) || !report ||
      report.disputeId !== r.disputeId || report.reportedBy !== r.declaredBy || report.reason !== r.reason ||
      ![order.buyerId, order.sellerId].includes(r.declaredBy) || report.reportedAgainst === r.declaredBy ||
      ![order.buyerId, order.sellerId].includes(report.reportedAgainst) || cashDigest(report.details ?? null) !== r.detailsHash ||
      !['meetup_pending', 'meetup_confirmed'].includes(r.originalStatus) ||
      !(r.releasedAt instanceof Timestamp) || !(report.reportedAt instanceof Timestamp) ||
      !r.releasedAt.isEqual(report.reportedAt) || r.releasedAt.toMillis() < order.cashAgreement.acceptedAt.toMillis()) return false;
  const facts = cashReleaseFacts(transactionId, order, r);
  return r.releaseId === cashDigest(facts) && Object.entries(facts).every(([k, v]) => r[k] === v);
}

