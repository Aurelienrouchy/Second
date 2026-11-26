import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';

export type RefundStatus = 'pending' | 'requires_action' | 'unknown' | 'succeeded' | 'failed' | 'canceled' | 'reconciliation_required';

export interface IssueRefundResult {
  success: boolean;
  status: RefundStatus;
  intentId: string | null;
  refundId: string | null;
  actionRequired: boolean;
  message: string;
  outstandingCardCents: number | null;
  localReconciliationRequired: boolean;
  bankWaiting: boolean;
  alreadyRefunded?: boolean;
}

export function hasUnsettledRefund(data: FirebaseFirestore.DocumentData): boolean {
  if (data.refundBlocked === true || data.refundLegacyReconciliationRequired === true) return true;
  const refund = data.refund;
  if (refund == null) return false;
  return typeof refund !== 'object' || typeof refund.intentId !== 'string' || !refund.intentId || refund.state !== 'succeeded' || !refund.fundsAppliedAt ||
    !Number.isSafeInteger(refund.outstandingCardCents) || refund.outstandingCardCents !== 0;
}

/** Owner notices bind only a native intention and its unchanged parties. This
 * qualification is separate from settlement: no inferred identity/amount is
 * sent to an owner when the financial source needs manual rapprochement. */
export function qualifiedRefundNoticeSource(order: FirebaseFirestore.DocumentData, intent: FirebaseFirestore.DocumentData) {
  const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const cents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (!id(intent.intentId) || !id(intent.attemptId) || !id(order.buyerId) || !id(order.sellerId) || order.buyerId === order.sellerId ||
      intent.buyerId !== order.buyerId || intent.sellerId !== order.sellerId || intent.currency !== 'cad' ||
      !(intent.requestedAt instanceof Timestamp) || !Number.isSafeInteger(intent.requestedAtMs) || intent.requestedAtMs < 0 ||
      !cents(intent.cardAmountCents) || !cents(intent.capturedCardCents) || intent.cardAmountCents > intent.capturedCardCents ||
      !cents(intent.walletAmountCents) || !cents(intent.sellerDebitCents)) return null;
  return { buyerId: order.buyerId, sellerId: order.sellerId, intentId: intent.intentId, attemptId: intent.attemptId,
    cardAmountCents: intent.cardAmountCents, walletAmountCents: intent.walletAmountCents, currency: 'CAD' as const };
}

/** Only a server instruction about a native pre-send order can release stock.
 * Carrier observations, returns and private holds are separate obligations. */
function rejectedLabelAttempt(attempt: any, rateId: string, shipmentId: string, afterMs: number): number | null {
  const evidence = attempt?.rejection?.evidence;
  if (!attempt || typeof attempt.attemptId !== 'string' || !attempt.attemptId || attempt.rateId !== rateId || attempt.shipmentId !== shipmentId ||
      !(attempt.requestedAt instanceof Timestamp) || !(attempt.rejectedAt instanceof Timestamp) || attempt.rejection?.outcome !== 'rejected' ||
      evidence?.httpStatus !== 400 || typeof evidence.requestId !== 'string' || !evidence.requestId ||
      !Array.isArray(evidence.errors) || !evidence.errors.length || evidence.errors.some((entry: any) =>
        entry?.source !== 'shipengine' || entry.type !== 'validation' || typeof entry.code !== 'string' || !entry.code) ||
      attempt.providerLabelId != null || attempt.committedAt != null || attempt.qualification != null || attempt.lastObservation != null) return null;
  const requested = attempt.requestedAt.toMillis(), rejected = attempt.rejectedAt.toMillis();
  return requested >= afterMs && rejected >= requested && rejected <= Date.now() + 60_000 ? rejected : null;
}
/** Existing V1 POST rejection semantics, not a TTL/absence/provider guess.
 * Every recorded attempt must be attributable and definitively rejected. */
export function qualifiedRejectedLabelPurchase(data: FirebaseFirestore.DocumentData, transactionId: unknown) {
  const purchase = data.labelPurchase, snapshot = data.shippingSnapshot;
  if (typeof transactionId !== 'string' || !transactionId || transactionId.includes('/') ||
      !purchase || purchase.schemaVersion !== 1 || purchase.state !== 'rejected' || purchase.transactionId !== transactionId ||
      purchase.buyerId !== data.buyerId || purchase.sellerId !== data.sellerId || typeof data.buyerId !== 'string' ||
      typeof data.sellerId !== 'string' || !data.buyerId || !data.sellerId || data.buyerId === data.sellerId || !(purchase.reservedAt instanceof Timestamp) ||
      !snapshot || snapshot.schemaVersion !== 1 || snapshot.provider !== 'shipengine' || snapshot.currency !== 'CAD' ||
      typeof snapshot.shipmentId !== 'string' || !snapshot.shipmentId || purchase.shipmentId !== snapshot.shipmentId ||
      typeof data.shipEngineRateId !== 'string' || !data.shipEngineRateId || purchase.rateId !== data.shipEngineRateId ||
      snapshot.rate?.rateId !== purchase.rateId || snapshot.rate?.shipmentId !== purchase.shipmentId ||
      purchase.sourceHash !== createHash('sha256').update(JSON.stringify({ buyerId: data.buyerId, sellerId: data.sellerId,
        articleId: data.articleId, snapshot: data.shippingSnapshot, rateId: data.shipEngineRateId })).digest('hex') ||
      !Array.isArray(purchase.previousAttempts) || purchase.previousAttempts.length > 20) return null;
  const seen = new Set<string>(); let previousRejected = 0;
  for (const prior of purchase.previousAttempts) {
    const rejected = rejectedLabelAttempt(prior, purchase.rateId, purchase.shipmentId, previousRejected);
    if (rejected === null || seen.has(prior.attemptId)) return null;
    seen.add(prior.attemptId); previousRejected = rejected;
  }
  const rejected = rejectedLabelAttempt(purchase, purchase.rateId, purchase.shipmentId, purchase.reservedAt.toMillis());
  if (rejected === null || seen.has(purchase.attemptId) || purchase.reservedAt.toMillis() < previousRejected) return null;
  const canonical = JSON.stringify(purchase, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return { schemaVersion: 1, transactionId, attemptId: purchase.attemptId as string, labelSourceHash: purchase.sourceHash as string,
    rejectionSourceHash: createHash('sha256').update(canonical).digest('hex'), rejectedAttempts: seen.size + 1 };
}
export function hasUnresolvedLabelOrParcelSource(data: FirebaseFirestore.DocumentData): boolean {
  return data.shipEngineLabelId != null || data.shippingLabelUrl != null || data.trackingNumber != null || data.trackingUrl != null ||
    data.labelCreatedAt != null || data.labelReservationAt != null || data.labelReconciliationRequired != null && data.labelReconciliationRequired !== false ||
    data.trackingReviewRequired != null && data.trackingReviewRequired !== false || data.trackingRead != null || data.trackingStatus != null ||
    data.shippedAt != null || data.deliveredAt != null || data.deliveryConfirmedAt != null || data.trackingIdentityProof != null ||
    data.trackingObservation != null || data.trackingSnapshot != null || data.deliveryTrackingProof != null ||
    data.labelPurchase != null && !qualifiedRejectedLabelPurchase(data, data.labelPurchase.transactionId);
}
export function refundHasPreSendInventoryProof(data: FirebaseFirestore.DocumentData, intent = data.refund): boolean {
  if (returnToSenderBlocksProgress(data) || !intent || !['sellerCancelTransaction', 'sweepPendingLabels_giveup', 'expireOrphanedTransactions_paidNotShipped'].includes(intent.source) ||
      intent.originalStatus !== 'paid' || intent.commercialDecision != null || hasUnresolvedLabelOrParcelSource(data) ||
      data.returnRequest != null || data.returnRequestedAt != null || data.disputed === true || data.bankDispute != null || data.deliveryCorrection != null) return false;
  if (intent.source !== 'sweepPendingLabels_giveup') return true;
  const native = intent.labelGiveupProof, current = qualifiedRejectedLabelPurchase(data, native?.transactionId);
  return !!current && native?.schemaVersion === 1 && native.transactionId === current.transactionId && native.attemptId === current.attemptId &&
    native.labelSourceHash === current.labelSourceHash && native.rejectionSourceHash === current.rejectionSourceHash && native.rejectedAttempts === current.rejectedAttempts;
}

export function refundInventoryRequiresReview(data: FirebaseFirestore.DocumentData, nativeLateRecoveryOwnReviewQualified = false): boolean {
  if (returnToSenderBlocksProgress(data)) return true;
  if (data.refundInventoryReviewRequired != null && data.refundInventoryReviewRequired !== false &&
      !(data.refundInventoryReviewRequired === true && nativeLateRecoveryOwnReviewQualified)) return true;
  if (data.refund == null && data.refundedAt == null && data.status !== 'refunded') return false;
  // This argument is supplied only by the native stock consumer after its TX
  // requalifies the immutable E20 decision and every current source. It is
  // never a client payload. It satisfies only the exact true physical-review
  // witness produced by this refund; malformed witnesses and RTS remain held.
  return !nativeLateRecoveryOwnReviewQualified && !refundHasPreSendInventoryProof(data);
}

export function refundResult(refund: FirebaseFirestore.DocumentData, alreadyRefunded = false): IssueRefundResult {
  const statuses = new Set<RefundStatus>(['pending', 'requires_action', 'unknown', 'succeeded', 'failed', 'canceled', 'reconciliation_required']);
  let status: RefundStatus = refund.state === 'requested' ? 'pending' : statuses.has(refund.state) ? refund.state : 'unknown';
  const success = status === 'succeeded' && typeof refund.intentId === 'string' && refund.intentId.length > 0 && !!refund.fundsAppliedAt && refund.outstandingCardCents === 0;
  if (status === 'succeeded' && !success) status = 'reconciliation_required';
  const messages: Record<RefundStatus, string> = {
    pending: 'Votre remboursement est en cours. La confirmation est attendue.',
    requires_action: 'Une action est nécessaire pour finaliser le remboursement. Contactez le support.',
    unknown: 'Le remboursement doit être vérifié. Une nouvelle demande ne sera pas émise sans rapprochement.',
    succeeded: 'Votre remboursement est confirmé.',
    failed: 'Le remboursement carte a échoué. Le support doit traiter la somme restant due.',
    canceled: 'Le remboursement carte a été annulé. Le support doit traiter la somme restant due.',
    reconciliation_required: 'Un rapprochement financier est nécessaire avant de finaliser le remboursement.',
  };
  return { success, status, intentId: typeof refund.intentId === 'string' ? refund.intentId : null, refundId: typeof refund.stripeRefundId === 'string' ? refund.stripeRefundId : null,
    outstandingCardCents: Number.isSafeInteger(refund.outstandingCardCents) && refund.outstandingCardCents >= 0 ? refund.outstandingCardCents : null, localReconciliationRequired: status === 'reconciliation_required',
    bankWaiting: refund.bankWaiting === true,
    actionRequired: !success && status !== 'pending', message: refund.bankWaiting && status === 'pending'
      ? 'Le remboursement attend la décision bancaire. Les fonds restent réservés.' : messages[status], ...(alreadyRefunded ? { alreadyRefunded: true } : {}) };
}

export function assertNoUnsettledRefund(data: FirebaseFirestore.DocumentData): void {
  if (hasUnsettledRefund(data)) throw new HttpsError('failed-precondition', 'Un remboursement reste à confirmer ou à rapprocher. Cette opération est suspendue.');
}
import { HttpsError } from 'firebase-functions/v2/https';
