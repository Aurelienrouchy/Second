/** Frozen shipping-sale terms. A historical deadline is evidence of a deadline,
 * never evidence of a new acceptance. No provider call or financial writer. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { trackingProofMatches, trackingIdentity, trackingProviderMatches } from '../config/shipEngine';
import { exactMixedDebit } from './stripeCheckoutProof';
import { deliveryCorrectionBlocksProgress, orderModerationAllowsProgress } from './orderModeration';
import { exactCents } from './shippingPurchaseRate';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { fraudReviewBlocksProgress } from '../shared/fraudReviewGuard';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import { qualifiedServiceFeeTaxSnapshot, type ServiceFeeTaxSnapshot } from './fees';
import { SHIPPING_PURCHASE_PRICING_VERSION, qualifiedQuoteTaxSnapshot } from './shippingSourceIdentity';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const DAY_MS = 24 * 60 * 60 * 1000;
export const PURCHASE_POLICY_VERSION = 'shipping_purchase_2026_01';
export const PURCHASE_PREPARATION_POLICY_ENABLED: boolean = true;
export const PURCHASE_PREPARATION_POLICY_VERSION = 'shipping_purchase_2026_02';
/** Never edit a published definition. Add another named definition, then move
 * only PURCHASE_POLICY_VERSION for future quotes. Stored V1 stays V1. */
const POLICY_DEFINITIONS = {
  shipping_purchase_2026_01: {
    parameters: { fundsHoldMs: 7 * DAY_MS, deliveryProtectionMs: 7 * DAY_MS, nonShipmentMs: 7 * DAY_MS },
    nonShipmentStartEvent: 'qualified_payment_recorded_at', deliveryStartEvent: 'qualified_provider_delivery_event',
  },
  shipping_purchase_2026_02: {
    parameters: { fundsHoldMs: 7 * DAY_MS, deliveryProtectionMs: 7 * DAY_MS, nonShipmentMs: 7 * DAY_MS },
    nonShipmentStartEvent: 'qualified_payment_recorded_at', deliveryStartEvent: 'qualified_provider_delivery_event',
    preparationTerms: {pendingPayment: {durationMs: 3600000, startEvent: 'native_shipping_acceptance_validated_at'},
      labelAbandonment: {definitiveRejections: 4, countBasis: 'attributed_native_provider_rejections'}},
  },
} as const;
type PurchasePolicyVersion = keyof typeof POLICY_DEFINITIONS;
const definition = (version: PurchasePolicyVersion) => POLICY_DEFINITIONS[version];
function knownVersion(value: unknown): value is PurchasePolicyVersion {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(POLICY_DEFINITIONS, value);
}
const OWNER_REVIEW_REASONS = new Set(['historical_payment_policy_unqualified', 'delivery_policy_time_unqualified',
  'historical_delivery_policy_unqualified', 'existing_delivery_deadline_preserved', 'delivery_scan_recorded_after_window',
  'non_shipment_clock_reconciliation_required', 'policy_source_reconciliation_required']);
export interface PurchasePolicySnapshot {
  schemaVersion: 1; policyVersion: PurchasePolicyVersion; quoteId: string; articleId: string;
  buyerId: string; sellerId: string; sourceHash: string;
  parameters: { fundsHoldMs: number; deliveryProtectionMs: number; nonShipmentMs: number }; hash: string;
  preparationTerms?: {pendingPayment:{durationMs:3600000;startEvent:'native_shipping_acceptance_validated_at'};
    labelAbandonment:{definitiveRejections:4;countBasis:'attributed_native_provider_rejections'}};
}
const id = (v: unknown): v is string => typeof v === 'string' && !!v && v.length <= 200 && !v.includes('/');
export function nativePolicyMillis(value: unknown): number | null {
  if (!(value instanceof Timestamp)) return null;
  const ms = value.toMillis();
  return Number.isFinite(ms) && ms >= 0 && ms <= 8640000000000000 ? Math.floor(ms) : null;
}
export function buildPurchasePolicy(quoteId: string, source: { articleId: string; buyerId: string; sellerId: string; hash: string },
  version: PurchasePolicyVersion = PURCHASE_PREPARATION_POLICY_ENABLED ? PURCHASE_PREPARATION_POLICY_VERSION : PURCHASE_POLICY_VERSION): PurchasePolicySnapshot {
  const body = { schemaVersion: 1 as const, policyVersion: version, quoteId, articleId: source.articleId,
    buyerId: source.buyerId, sellerId: source.sellerId, sourceHash: source.hash, parameters: { ...definition(version).parameters },
    ...(version === PURCHASE_PREPARATION_POLICY_VERSION ? {preparationTerms:{
      pendingPayment:{...POLICY_DEFINITIONS.shipping_purchase_2026_02.preparationTerms.pendingPayment},
      labelAbandonment:{...POLICY_DEFINITIONS.shipping_purchase_2026_02.preparationTerms.labelAbandonment}}} : {}) };
  return { ...body, hash: digest(body) };
}
export function qualifiedPurchasePolicy(raw: any): PurchasePolicySnapshot | null {
  if (!raw || raw.schemaVersion !== 1 || !knownVersion(raw.policyVersion) ||
      ![raw.quoteId, raw.articleId, raw.buyerId, raw.sellerId].every(id) || raw.buyerId === raw.sellerId ||
      !/^[a-f0-9]{64}$/.test(raw.sourceHash ?? '') || raw.parameters?.fundsHoldMs !== definition(raw.policyVersion).parameters.fundsHoldMs ||
      raw.parameters?.deliveryProtectionMs !== definition(raw.policyVersion).parameters.deliveryProtectionMs ||
      raw.parameters?.nonShipmentMs !== definition(raw.policyVersion).parameters.nonShipmentMs) return null;
  const expected = buildPurchasePolicy(raw.quoteId, { articleId: raw.articleId, buyerId: raw.buyerId, sellerId: raw.sellerId, hash: raw.sourceHash }, raw.policyVersion);
  // V1's original body/hash remains unchanged. V2's additional terms must
  // match the named immutable definition, not merely an asserted hash.
  if (raw.policyVersion === PURCHASE_PREPARATION_POLICY_VERSION) {
    const t=raw.preparationTerms;
    if(Object.keys(raw).sort().join(',')!==Object.keys(expected).sort().join(',')||
      Object.keys(raw.parameters).sort().join(',')!=='deliveryProtectionMs,fundsHoldMs,nonShipmentMs'||!t||Object.keys(t).sort().join(',')!=='labelAbandonment,pendingPayment'||
      !t.pendingPayment||Object.keys(t.pendingPayment).sort().join(',')!=='durationMs,startEvent'||t.pendingPayment.durationMs!==3600000||
      t.pendingPayment.startEvent!=='native_shipping_acceptance_validated_at'||!t.labelAbandonment||
      Object.keys(t.labelAbandonment).sort().join(',')!=='countBasis,definitiveRejections'||t.labelAbandonment.definitiveRejections!==4||
      t.labelAbandonment.countBasis!=='attributed_native_provider_rejections')return null;
  }
  return raw.hash === expected.hash ? expected : null;
}
export function assertPurchasePolicyAccepted(data: any, quote: any, quoteId: string): PurchasePolicySnapshot {
  const policy = qualifiedPurchasePolicy(quote.purchasePolicy);
  if (!policy || policy.quoteId !== quoteId || policy.articleId !== quote.articleId || policy.buyerId !== quote.ownerId ||
      policy.sellerId !== quote.sellerId || policy.sourceHash !== quote.source?.hash || data.purchasePolicyAccepted !== true ||
      data.expectedPurchasePolicyVersion !== policy.policyVersion || data.expectedPurchasePolicyHash !== policy.hash) {
    throw new HttpsError('failed-precondition', 'Acceptez la politique de ce devis avant de réserver.',
      { reason: 'purchase_policy_acceptance_required', action: 'quoteShippingPurchase', paymentPermissionGranted: false });
  }
  return policy;
}
export function buildPurchasePolicyAcceptance(policy: PurchasePolicySnapshot, transactionId: string, rateId: string, totalCents: number, acceptedAt: Timestamp,
  pricing?: { pricingVersion: typeof SHIPPING_PURCHASE_PRICING_VERSION; taxSnapshot: ServiceFeeTaxSnapshot }) {
  return { schemaVersion: 1, transactionId, quoteId: policy.quoteId, acceptedBy: policy.buyerId, policyHash: policy.hash,
    policyVersion: policy.policyVersion, rateId, totalCents, acceptedAt,
    ...(pricing ? { pricingVersion: pricing.pricingVersion, taxSnapshot: pricing.taxSnapshot } : {}) };
}
/** New pricing captures are part of the native acceptance. Legacy zero-tax
 * receipts stay readable; a legacy positive total never acquires a new split. */
export function acceptedPurchaseTaxSnapshot(order: any, quote?: any): ServiceFeeTaxSnapshot | null {
  const snapshot = qualifiedServiceFeeTaxSnapshot(order.taxSnapshot, order.serviceFee, order.taxTotal);
  const acceptance = qualifiedServiceFeeTaxSnapshot(order.purchasePolicyAcceptance?.taxSnapshot, order.serviceFee, order.taxTotal);
  if (!snapshot || !acceptance || order.pricingVersion !== SHIPPING_PURCHASE_PRICING_VERSION ||
      order.purchasePolicyAcceptance?.pricingVersion !== SHIPPING_PURCHASE_PRICING_VERSION || digest(snapshot) !== digest(acceptance)) return null;
  if (quote !== undefined) {
    const source = qualifiedQuoteTaxSnapshot(quote), accepted = qualifiedServiceFeeTaxSnapshot(quote.purchasePolicyAcceptance?.taxSnapshot, order.serviceFee, order.taxTotal);
    if (!source || !accepted || quote.purchasePolicyAcceptance?.pricingVersion !== SHIPPING_PURCHASE_PRICING_VERSION ||
        digest(source) !== digest(snapshot) || digest(accepted) !== digest(snapshot)) return null;
  }
  return snapshot;
}
function hasTaxPricingCapture(value: any): boolean {
  return value != null && (Object.prototype.hasOwnProperty.call(value, 'pricingVersion') || value.taxSnapshot?.protocol === 'service_fee_tax_v1');
}
export function acceptedOrderPurchasePolicy(order: any, transactionId: string): PurchasePolicySnapshot | null {
  const policy = qualifiedPurchasePolicy(order.purchasePolicy), acceptance = order.purchasePolicyAcceptance;
  if (!policy || policy.articleId !== order.articleId || policy.buyerId !== order.buyerId || policy.sellerId !== order.sellerId ||
      policy.quoteId !== order.shippingQuoteId || order.deliveryType !== 'shipping' || order.currency !== 'CAD' || acceptance?.schemaVersion !== 1 ||
      acceptance.transactionId !== transactionId || acceptance.quoteId !== policy.quoteId || acceptance.acceptedBy !== policy.buyerId ||
      acceptance.policyHash !== policy.hash || acceptance.policyVersion !== policy.policyVersion || acceptance.rateId !== order.shipEngineRateId ||
      !Number.isSafeInteger(acceptance.totalCents) || acceptance.totalCents <= 0 || acceptance.totalCents !== exactCents(order.totalAmount) ||
      nativePolicyMillis(acceptance.acceptedAt) === null ||
      (hasTaxPricingCapture(order) || hasTaxPricingCapture(acceptance)) && !acceptedPurchaseTaxSnapshot(order)) return null;
  return policy;
}
/** Shared native-copy qualification at new payment authorization. Historical
 * money receipts are recovered by callers before this gate. */
export function acceptedQuotePurchasePolicy(order: any, transactionId: string, quote: any): boolean {
  const policy = acceptedOrderPurchasePolicy(order, transactionId);
  return !!policy && qualifiedPurchasePolicy(quote.purchasePolicy)?.hash === policy.hash && quote.source?.hash === policy.sourceHash &&
    acceptedOrderPurchasePolicy({ ...order, purchasePolicyAcceptance: quote.purchasePolicyAcceptance }, transactionId)?.hash === policy.hash &&
    quote.purchasePolicyAcceptance.acceptedAt.isEqual(order.purchasePolicyAcceptance.acceptedAt) &&
    (!(hasTaxPricingCapture(order) || hasTaxPricingCapture(quote) || hasTaxPricingCapture(quote.source) || hasTaxPricingCapture(quote.purchasePolicyAcceptance)) ||
      acceptedPurchaseTaxSnapshot(order, quote) !== null);
}
/** Called only in the actual qualified paid commit. This is the application's
 * payment-recording time, not an absent provider capture timestamp. */
export function paidPurchasePolicyUpdate(order: any, transactionId: string, recordedAt: Timestamp,
  payment: { kind: 'wallet_ledger' | 'stripe_payment_intent'; referenceId: string; amountCents: number; walletCents?: number }) {
  if (order.nonShipmentPolicyWindow != null || order.paidAt != null) return {};
  const policy = acceptedOrderPurchasePolicy(order, transactionId);
  if (!policy || !id(payment.referenceId) || payment.amountCents !== order.purchasePolicyAcceptance.totalCents) {
    return { purchasePolicyReviewRequired: true, purchasePolicyReviewReason: 'historical_payment_policy_unqualified' };
  }
  const startMs = nativePolicyMillis(recordedAt)!;
  const nativePayment = { kind: payment.kind, referenceId: payment.referenceId, amountCents: payment.amountCents,
    walletCents: payment.walletCents ?? (payment.kind === 'wallet_ledger' ? payment.amountCents : 0) };
  const body = { schemaVersion: 1, transactionId, policyHash: policy.hash, buyerId: policy.buyerId, sellerId: policy.sellerId,
    clockBasis: definition(policy.policyVersion).nonShipmentStartEvent, payment: nativePayment, startsAt: recordedAt,
    expiresAt: Timestamp.fromMillis(startMs + policy.parameters.nonShipmentMs) };
  return { nonShipmentPolicyWindow: { ...body, sourceHash: digest([transactionId, policy.hash, payment.kind,
    payment.referenceId, payment.amountCents, nativePayment.walletCents, startMs, startMs + policy.parameters.nonShipmentMs]) } };
}
function qualifiedNonShipmentWindow(order: any, transactionId: string) {
  const policy = acceptedOrderPurchasePolicy(order, transactionId), window = order.nonShipmentPolicyWindow;
  const start = nativePolicyMillis(window?.startsAt), end = nativePolicyMillis(window?.expiresAt);
  if (!policy || !window || window.schemaVersion !== 1 || window.transactionId !== transactionId || window.policyHash !== policy.hash ||
      window.buyerId !== order.buyerId || window.sellerId !== order.sellerId || window.clockBasis !== definition(policy.policyVersion).nonShipmentStartEvent ||
      start === null || end === null || nativePolicyMillis(order.paidAt) !== start || end - start !== policy.parameters.nonShipmentMs ||
      !window.startsAt.isEqual(order.paidAt) || start < nativePolicyMillis(order.purchasePolicyAcceptance.acceptedAt)! ||
      !id(window.payment?.referenceId) || !['wallet_ledger', 'stripe_payment_intent'].includes(window.payment.kind) ||
      window.payment.amountCents !== order.purchasePolicyAcceptance.totalCents || !Number.isSafeInteger(window.payment.walletCents) ||
      window.payment.walletCents < 0 || window.payment.walletCents > window.payment.amountCents ||
      window.sourceHash !== digest([transactionId, policy.hash, window.payment.kind, window.payment.referenceId,
        window.payment.amountCents, window.payment.walletCents, start, end])) return null;
  const payment = window.payment;
  if (payment.kind === 'wallet_ledger') {
    const native = order.walletPayment;
    if (order.paidVia !== 'wallet' || native?.schemaVersion !== 1 || native.state !== 'committed' || native.actorUid !== order.buyerId ||
        native.ledgerId !== payment.referenceId || native.amountCents !== payment.amountCents || native.currency !== 'CAD' ||
        native.quoteId !== policy.quoteId || native.rateId !== order.shipEngineRateId || !(native.committedAt instanceof Timestamp) ||
        !native.committedAt.isEqual(order.paidAt) || order.walletAmountUsed !== payment.amountCents || payment.walletCents !== payment.amountCents) return null;
  } else if (order.stripePaymentIntentId !== payment.referenceId || order.capturedCardCents !== payment.amountCents - payment.walletCents ||
      payment.walletCents >= payment.amountCents || !/^pi_[a-zA-Z0-9]+$/.test(payment.referenceId) || order.paidVia === 'wallet' ||
      (payment.walletCents > 0 ? !['mixed', 'wallet_and_card'].includes(order.paidVia) || order.walletAmountUsed !== payment.walletCents :
        order.walletAmountUsed != null && order.walletAmountUsed !== 0)) return null;
  return { policy, window, start, end };
}
/** Pure historical payment qualification; no deadline expiry or new effect. */
export function nativePurchasePaymentSource(order: any, transactionId: string) {
  return qualifiedNonShipmentWindow(order, transactionId)?.window.payment ?? null;
}
export function nonShipmentExpirySource(order: any, transactionId: string, now = Date.now()): { sourceHash: string; expiresAtMs: number } | null {
  const qualified = qualifiedNonShipmentWindow(order, transactionId);
  if (!qualified || returnToSenderBlocksProgress(order) || fraudReviewBlocksProgress(order) || qualified.start > now || qualified.end > now || order.status !== 'paid' || order.deliveryType !== 'shipping' ||
      order.purchasePolicyReviewRequired === true || order.trackingReviewRequired === true || order.deliveryCorrectionBlocked === true ||
      order.labelCreationPending === true || order.disputed === true || order.returnRequestedAt != null || order.returnRequest != null ||
      order.trackingObservation != null || order.trackingSnapshot != null || order.trackingIdentityProof != null ||
      order.deliveryTrackingProof != null || order.trackingRead != null || order.shippedAt != null || order.deliveredAt != null ||
      order.trackingStatus != null || order.shipEngineLabelId != null || order.trackingNumber != null ||
      order.labelCreatedAt != null || order.labelPurchase != null) return null;
  return { sourceHash: digest([qualified.window.sourceHash, order.status, order.shipEngineLabelId ?? null,
    order.trackingNumber ?? null, order.refund ?? null]), expiresAtMs: qualified.end };
}
/** Same transaction as first refund reservation. Requalifies payment ledger,
 * frozen acceptance and all native scan markers; never uses createdAt. */
export async function assertNonShipmentExpiry(tx: FirebaseFirestore.Transaction, transactionId: string, order: any,
  expected: { sourceHash: string; expiresAtMs: number }) {
  if (!await fraudReviewAllowsProgress(tx, transactionId, order)) throw new HttpsError('failed-precondition',
    'La revue du paiement exige une décision humaine avant une nouvelle intention de remboursement.', {reason: 'fraud_review_requires_human_decision'});
  const current = nonShipmentExpirySource(order, transactionId), qualified = qualifiedNonShipmentWindow(order, transactionId);
  if (!current || !qualified || current.sourceHash !== expected.sourceHash || current.expiresAtMs !== expected.expiresAtMs)
    throw new HttpsError('failed-precondition', 'Le délai ou les preuves de non-expédition doivent être vérifiés.', { reason: 'non_shipment_policy_review_required' });
  const quote = (await tx.get(db.collection('shipping_quotes').doc(qualified.policy.quoteId))).data();
  if (!quote || quote.transactionId !== transactionId || quote.state !== 'claimed' || quote.ownerId !== order.buyerId ||
      !acceptedQuotePurchasePolicy(order, transactionId, quote) ||
      quote.articleId !== order.articleId || quote.sellerId !== order.sellerId || quote.acceptedRateId !== order.shipEngineRateId ||
      quote.acceptedTotal !== order.totalAmount || !acceptedOrderPurchasePolicy({ ...order, purchasePolicyAcceptance: quote.purchasePolicyAcceptance }, transactionId) ||
      !(quote.purchasePolicyAcceptance?.acceptedAt instanceof Timestamp) || !quote.purchasePolicyAcceptance.acceptedAt.isEqual(order.purchasePolicyAcceptance.acceptedAt))
    throw new HttpsError('failed-precondition', 'L’acceptation de cette vente doit être rapprochée.');
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
  if (claims.size >= 101 || claims.docs.some(d => !['resolved', 'dismissed', 'closed'].includes(d.data().status)) ||
      !await orderModerationAllowsProgress(tx, order)) throw new HttpsError('failed-precondition', 'Un dossier ou une restriction exige une décision préalable.');
  if (qualified.window.payment.kind === 'wallet_ledger') {
    const debit = (await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').doc(qualified.window.payment.referenceId))).data();
    if (!debit || debit.type !== 'purchase_debit' || debit.transactionId !== transactionId || debit.amount !== qualified.window.payment.amountCents ||
        debit.currency !== 'CAD' || !(debit.createdAt instanceof Timestamp) || !debit.createdAt.isEqual(order.paidAt))
      throw new HttpsError('failed-precondition', 'La preuve du paiement doit être rapprochée.');
  } else if (qualified.window.payment.walletCents > 0) {
    const rows = await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
    if (rows.size >= 101 || !exactMixedDebit(order, rows.docs.map(d => ({ id: d.id, data: d.data() })), qualified.window.payment.walletCents))
      throw new HttpsError('failed-precondition', 'La preuve du paiement mixte doit être rapprochée.');
  }
}
/** Already existing deadlines always win. A newly arriving late scan is not a
 * fresh seven-day window and cannot silently release escrow on receipt. */
export function deliveredPurchasePolicyUpdate(order: any, transactionId: string, proof: any, recordedAt: Timestamp): FirebaseFirestore.DocumentData {
  const policy = acceptedOrderPurchasePolicy(order, transactionId);
  const paid = qualifiedNonShipmentWindow(order, transactionId);
  const eventMs = proof?.providerEventAtMs;
  if (!policy || !trackingProofMatches(transactionId, order, proof, 'forward') || proof.statusCode !== 'DE' ||
      !paid || !Number.isSafeInteger(eventMs) || eventMs < paid.start || eventMs > recordedAt.toMillis()) return {
    purchasePolicyReviewRequired: true, purchasePolicyReviewReason: policy ? 'delivery_policy_time_unqualified' : 'historical_delivery_policy_unqualified',
  };
  const deadlineMs = eventMs + policy.parameters.fundsHoldMs;
  if (order.fundsReleaseAt != null) return { purchasePolicyReviewRequired: true, purchasePolicyReviewReason: 'existing_delivery_deadline_preserved' };
  const deadline = Timestamp.fromMillis(deadlineMs);
  return { fundsReleaseAt: deadline, deliveryProtectionEndsAt: Timestamp.fromMillis(eventMs + policy.parameters.deliveryProtectionMs),
    deliveryPolicyWindow: { schemaVersion: 1, transactionId, policyHash: policy.hash, clockBasis: definition(policy.policyVersion).deliveryStartEvent,
      startsAt: Timestamp.fromMillis(eventMs), recordedAt, fundsReleaseAt: deadline,
      protectionEndsAt: Timestamp.fromMillis(eventMs + policy.parameters.deliveryProtectionMs),
      trackingSourceHash: proof.sourceHash, observationHash: proof.observedContentHash, providerEventTimeSource: proof.providerEventTimeSource,
      sourceHash: digest([transactionId, policy.hash, proof.sourceHash, proof.observedContentHash, eventMs, deadlineMs, nativePolicyMillis(recordedAt)]) },
    ...(deadlineMs <= recordedAt.toMillis() ? { purchasePolicyReviewRequired: true, purchasePolicyReviewReason: 'delivery_scan_recorded_after_window' } : {}) };
}
function qualifiedDeliveryWindow(order: any, transactionId: string) {
  const policy = acceptedOrderPurchasePolicy(order, transactionId), paid = qualifiedNonShipmentWindow(order, transactionId);
  const window = order.deliveryPolicyWindow, proof = order.deliveryTrackingProof, identity = trackingIdentity(transactionId, order, 'forward');
  const start = nativePolicyMillis(window?.startsAt), recorded = nativePolicyMillis(window?.recordedAt), end = nativePolicyMillis(window?.fundsReleaseAt);
  if (!policy || !paid || !identity || window?.schemaVersion !== 1 || window.transactionId !== transactionId || window.policyHash !== policy.hash ||
      window.clockBasis !== definition(policy.policyVersion).deliveryStartEvent || start === null || recorded === null || end === null || start < paid.start ||
      recorded < start || end - start !== policy.parameters.fundsHoldMs || nativePolicyMillis(window.protectionEndsAt) !== start + policy.parameters.deliveryProtectionMs ||
      !(order.deliveredAt instanceof Timestamp) || !window.startsAt.isEqual(order.deliveredAt) || !(order.deliveryRecordedAt instanceof Timestamp) ||
      !window.recordedAt.isEqual(order.deliveryRecordedAt) || !(order.fundsReleaseAt instanceof Timestamp) || !window.fundsReleaseAt.isEqual(order.fundsReleaseAt) ||
      !(order.deliveryProtectionEndsAt instanceof Timestamp) || !window.protectionEndsAt.isEqual(order.deliveryProtectionEndsAt) ||
      proof?.schemaVersion !== 1 || !trackingProviderMatches(order, proof) || proof.transactionId !== transactionId || proof.leg !== 'forward' || proof.statusCode !== 'DE' ||
      proof.sourceHash !== identity.sourceHash || window.trackingSourceHash !== proof.sourceHash || window.observationHash !== proof.observedContentHash ||
      !/^[a-f0-9]{64}$/.test(proof.observedContentHash ?? '') || proof.providerEventAtMs !== start ||
      !['actual_delivery_date', 'normalized_event'].includes(proof.providerEventTimeSource) || window.providerEventTimeSource !== proof.providerEventTimeSource ||
      window.sourceHash !== digest([transactionId, policy.hash, proof.sourceHash, proof.observedContentHash, start, end, recorded])) return null;
  return { start, recorded, end, protectionEnd: start + policy.parameters.deliveryProtectionMs };
}
/** The original delivery/window remain historical. Only the occurrence of a
 * current native DE and the accepted immutable policy can qualify a distinct
 * effective window; neither an observation time nor an operator's reading
 * starts it. This pure builder does not call any progress/financial guard. */
export function buildDeliveryCorrectionWindow(order: any, transactionId: string, proof: any) {
  const policy = acceptedOrderPurchasePolicy(order, transactionId), original = qualifiedDeliveryWindow(order, transactionId);
  const occurrence = proof?.providerEventAtMs;
  if (!policy || !original || !trackingProofMatches(transactionId, order, proof, 'forward') || proof.statusCode !== 'DE' ||
      !Number.isSafeInteger(occurrence) || occurrence < nativePolicyMillis(order.paidAt)! || occurrence > proof.observedAtMs ||
      !['actual_delivery_date', 'normalized_event'].includes(proof.providerEventTimeSource)) return null;
  const releaseMs = Math.max(original.end, occurrence + policy.parameters.fundsHoldMs);
  const protectionMs = Math.max(original.protectionEnd, occurrence + policy.parameters.deliveryProtectionMs);
  if (!Number.isSafeInteger(releaseMs) || !Number.isSafeInteger(protectionMs) || releaseMs > 253402300799999 || protectionMs > 253402300799999) return null;
  const body = { schemaVersion: 1, transactionId, policyHash: policy.hash, policyVersion: policy.policyVersion,
    clockBasis: definition(policy.policyVersion).deliveryStartEvent, providerEventAt: Timestamp.fromMillis(occurrence),
    originalFundsReleaseAt: order.fundsReleaseAt as Timestamp, originalProtectionEndsAt: order.deliveryProtectionEndsAt as Timestamp,
    effectiveFundsReleaseAt: Timestamp.fromMillis(releaseMs), effectiveProtectionEndsAt: Timestamp.fromMillis(protectionMs),
    trackingSourceHash: proof.sourceHash, observationHash: proof.observedContentHash };
  return { ...body, sourceHash: digest(body) };
}
export function deliveryCorrectionWindowMatches(order: any, transactionId: string, proof: any, value: any): boolean {
  const expected = buildDeliveryCorrectionWindow(order, transactionId, proof);
  return !!expected && !!value && Object.keys(value).sort().join(',') === Object.keys(expected).sort().join(',') &&
    Object.entries(expected).every(([key, native]) => native instanceof Timestamp ? value[key] instanceof Timestamp && native.isEqual(value[key]) : value[key] === native);
}
/** A missing/unqualified correction clock is unknown, never the old earlier
 * deadline. Historical released funds are not re-held by this reader. */
export function effectivePurchaseReleaseAt(order: any, transactionId: string): Timestamp | null {
  if (deliveryCorrectionBlocksProgress(order)) return null;
  const resolution = order.deliveryCorrection?.resolution;
  if (order.fundsReleasedAt == null && resolution?.effectiveDeliveryWindow != null) {
    if (!deliveryCorrectionWindowMatches(order, transactionId, order.trackingObservation, resolution.effectiveDeliveryWindow)) return null;
    return resolution.effectiveDeliveryWindow.effectiveFundsReleaseAt as Timestamp;
  }
  return nativePolicyMillis(order.fundsReleaseAt) === null ? null : order.fundsReleaseAt as Timestamp;
}
/** Qualified clocks for the opt-in owner reader. V1 remains the immutable
 * original tuple; this source distinguishes correction and recording clocks. */
export function effectiveDeliveryProtectionWindow(order: any, transactionId: string) {
  const policy = acceptedOrderPurchasePolicy(order, transactionId), original = qualifiedDeliveryWindow(order, transactionId);
  if (!policy || !original || deliveryCorrectionBlocksProgress(order)) return null;
  const resolution = order.deliveryCorrection?.resolution;
  const corrected = order.fundsReleasedAt == null && resolution?.effectiveDeliveryWindow != null &&
    deliveryCorrectionWindowMatches(order, transactionId, order.trackingObservation, resolution.effectiveDeliveryWindow)
    ? resolution.effectiveDeliveryWindow : null;
  const iso = (ms: number) => new Date(ms).toISOString();
  return { qualification: corrected ? 'native_corrected_window' as const : 'native_original_window' as const,
    policy: { policyVersion: policy.policyVersion, policyHash: policy.hash,
      acceptedAt: iso(nativePolicyMillis(order.purchasePolicyAcceptance.acceptedAt)!), parameters: policy.parameters },
    window: { clockBasis: definition(policy.policyVersion).deliveryStartEvent,
      occurredAt: iso(corrected ? nativePolicyMillis(corrected.providerEventAt)! : original.start),
      originalDeliveryAt: iso(original.start), originalRecordedAt: iso(original.recorded),
      originalFundsReleaseAt: iso(original.end), originalProtectionEndsAt: iso(original.protectionEnd),
      effectiveFundsReleaseAt: iso(corrected ? nativePolicyMillis(corrected.effectiveFundsReleaseAt)! : original.end),
      effectiveProtectionEndsAt: iso(corrected ? nativePolicyMillis(corrected.effectiveProtectionEndsAt)! : original.protectionEnd),
      correctionId: corrected ? order.deliveryCorrection.correctionId as string : null,
      correctionDecidedAt: corrected ? order.deliveryCorrection.resolution.decidedAt.toDate().toISOString() as string : null } };
}
export function purchasePolicyAllowsRelease(order: any, transactionId: string, nativeRoutingQualified = false, nativeMixedOrderQualified = false): boolean {
  if (['productMixedOrderReview', 'productMixedOrderLink', 'productMixedOrderDecision'].some(k => Object.prototype.hasOwnProperty.call(order, k)) && !nativeMixedOrderQualified) return false;
  if (['productRoutingReview', 'productRoutingDecision'].some(k => Object.prototype.hasOwnProperty.call(order, k)) && !nativeRoutingQualified) return false;
  if (order.purchasePolicyReviewRequired === true || order.trackingReviewRequired === true || returnToSenderBlocksProgress(order) || fraudReviewBlocksProgress(order)) return false;
  if (effectivePurchaseReleaseAt(order, transactionId) === null) return false;
  // Retain the already recorded historical deadline without inventing consent.
  return order.purchasePolicy == null && order.purchasePolicyAcceptance == null ? nativePolicyMillis(order.fundsReleaseAt) !== null :
    qualifiedDeliveryWindow(order, transactionId) !== null;
}
export function purchasePolicyTimeline(order: any, transactionId: string) {
  const policy = acceptedOrderPurchasePolicy(order, transactionId), paid = qualifiedNonShipmentWindow(order, transactionId);
  const delivery = qualifiedDeliveryWindow(order, transactionId), release = nativePolicyMillis(effectivePurchaseReleaseAt(order, transactionId));
  const resolution = order.deliveryCorrection?.resolution;
  const corrected = order.fundsReleasedAt == null && resolution?.effectiveDeliveryWindow != null &&
    deliveryCorrectionWindowMatches(order, transactionId, order.trackingObservation, resolution.effectiveDeliveryWindow)
    ? resolution.effectiveDeliveryWindow : null;
  // V1 describes one original event/recording with an exact fixed duration.
  // A corrected window cannot be squeezed into that tuple without rewriting
  // historical time or breaking older strict clients. Its dates are unknown
  // here; the native transport source separately supplies the qualified
  // effective dates used by the financial release and wallet estimate.
  const distinctWindow = !!corrected && (nativePolicyMillis(corrected.providerEventAt) !== delivery?.start ||
    nativePolicyMillis(corrected.effectiveFundsReleaseAt) !== delivery?.end ||
    nativePolicyMillis(corrected.effectiveProtectionEndsAt) !== delivery?.protectionEnd);
  const unknownDeliveryTuple = distinctWindow || !!delivery && release === null;
  const historical = order.purchasePolicy == null && order.purchasePolicyAcceptance == null;
  const needsReview = distinctWindow || order.purchasePolicyReviewRequired === true || order.trackingReviewRequired === true || deliveryCorrectionBlocksProgress(order) || !policy && (!historical || release === null) ||
    policy != null && (order.paidAt != null && !paid || (order.deliveredAt != null || order.fundsReleaseAt != null) && !delivery);
  return { schemaVersion: 1, qualification: needsReview ? 'review_required' : policy ? 'accepted_snapshot' :
    release !== null ? 'historical_deadline_unknown_acceptance' : 'review_required',
    policyVersion: policy?.policyVersion ?? null, policyHash: policy?.hash ?? null, parameters: policy?.parameters ?? null,
    acceptedAtMs: policy ? nativePolicyMillis(order.purchasePolicyAcceptance.acceptedAt) : null,
    nonShipmentStartsAtMs: paid?.start ?? null, nonShipmentExpiresAtMs: paid?.end ?? null,
    paymentClockBasis: paid ? definition(paid.policy.policyVersion).nonShipmentStartEvent : null,
    deliveryEventAtMs: unknownDeliveryTuple ? null : delivery?.start ?? null, deliveryRecordedAtMs: unknownDeliveryTuple ? null : delivery?.recorded ?? null,
    fundsReleaseAtMs: unknownDeliveryTuple ? null : release, deliveryProtectionEndsAtMs: unknownDeliveryTuple ? null : delivery?.protectionEnd ?? null,
    reviewRequired: needsReview,
    reviewReason: OWNER_REVIEW_REASONS.has(order.purchasePolicyReviewReason) ? order.purchasePolicyReviewReason as string :
      needsReview ? 'policy_source_reconciliation_required' : null,
    externalRightsPreserved: true };
}

export const PURCHASE_PREPARATION_CAPABILITY='purchase_preparation_policy_v1';
/** Only future V2 reservations receive this clock. Its origin is the existing
 * server validation Timestamp, not a guessed Firestore commit or createdAt. */
export function buildPendingPaymentPolicyWindow(policy:PurchasePolicySnapshot,transactionId:string,rateId:string,totalCents:number,acceptedAt:Timestamp) {
  if(policy.policyVersion!==PURCHASE_PREPARATION_POLICY_VERSION||!policy.preparationTerms)return null;
  const startsAt=nativePolicyMillis(acceptedAt);
  if(startsAt===null||!Number.isSafeInteger(totalCents)||totalCents<=0)return null;
  const expiresAt=startsAt+policy.preparationTerms.pendingPayment.durationMs;
  return {schemaVersion:1,protocol:'pending_payment_policy_window_v1',transactionId,quoteId:policy.quoteId,buyerId:policy.buyerId,sellerId:policy.sellerId,
    policyVersion:policy.policyVersion,policyHash:policy.hash,rateId,totalCents,clockBasis:policy.preparationTerms.pendingPayment.startEvent,
    startsAt:acceptedAt,expiresAt:Timestamp.fromMillis(expiresAt),sourceHash:digest([transactionId,policy.quoteId,policy.hash,policy.buyerId,policy.sellerId,
      rateId,totalCents,policy.preparationTerms.pendingPayment.startEvent,startsAt,expiresAt])};
}
function nativePreparationWindow(order:any,transactionId:string,now:number) {
  const policy=acceptedOrderPurchasePolicy(order,transactionId);
  if(!policy||policy.policyVersion!==PURCHASE_PREPARATION_POLICY_VERSION||!policy.preparationTerms)return null;
  const w=order.pendingPaymentPolicyWindow,acceptance=order.purchasePolicyAcceptance;
  const expected=buildPendingPaymentPolicyWindow(policy,transactionId,order.shipEngineRateId,acceptance.totalCents,acceptance.acceptedAt);
  const start=nativePolicyMillis(w?.startsAt),end=nativePolicyMillis(w?.expiresAt);
  if(!expected||!w||Object.keys(w).sort().join(',')!==Object.keys(expected).sort().join(',')||start===null||end===null||
    !Number.isSafeInteger(now)||start<1||start>now||!Number.isSafeInteger(end)||end<=start||
    !(order.shippingSnapshot?.acceptanceValidatedAt instanceof Timestamp)||!order.shippingSnapshot.acceptanceValidatedAt.isEqual(acceptance.acceptedAt)||
    Object.entries(expected).some(([key,v])=>v instanceof Timestamp?!(w[key] instanceof Timestamp)||!w[key].isEqual(v):w[key]!==v))return null;
  return {policy,window:w,start,end};
}
/** Native order, original quote and acceptance must all name the SAME clock.
 * V1 stays accepted for its original terms; it supplies no new prep deadline. */
export async function readPurchasePreparationSource(tx:FirebaseFirestore.Transaction,transactionId:string,order:any,now=Date.now()) {
  const w=nativePreparationWindow(order,transactionId,now);if(!w)return null;
  const quote=(await tx.get(db.collection('shipping_quotes').doc(w.policy.quoteId))).data();
  if(!quote||quote.schemaVersion!==1||quote.state!=='claimed'||quote.transactionId!==transactionId||quote.ownerId!==order.buyerId||
    quote.sellerId!==order.sellerId||quote.articleId!==order.articleId||quote.acceptedRateId!==order.shipEngineRateId||quote.acceptedTotal!==order.totalAmount||
    !acceptedQuotePurchasePolicy(order,transactionId,quote)||!(quote.acceptanceValidatedAt instanceof Timestamp)||
    !quote.acceptanceValidatedAt.isEqual(order.purchasePolicyAcceptance.acceptedAt)||!(quote.acceptedAt instanceof Timestamp)||
    nativePolicyMillis(quote.acceptedAt)===null||quote.acceptedAt.toMillis()<w.start||quote.acceptedAt.toMillis()>now)return null;
  const mirror=nativePreparationWindow({...order,pendingPaymentPolicyWindow:quote.pendingPaymentPolicyWindow},transactionId,now);
  if(!mirror||mirror.window.sourceHash!==w.window.sourceHash)return null;
  return {protocol:'purchase_preparation_source_v1',policyVersion:w.policy.policyVersion,policyHash:w.policy.hash,quoteId:w.policy.quoteId,
    sourceHash:digest([w.policy.hash,w.window.sourceHash,quote.acceptedAt.seconds,quote.acceptedAt.nanoseconds]),
    windowHash:w.window.sourceHash as string,clockBasis:w.window.clockBasis as string,startsAtMs:w.start,expiresAtMs:w.end,
    requiredDefinitiveRejections:w.policy.preparationTerms!.labelAbandonment.definitiveRejections};
}
/** New V2 authorizations must still fit the exact accepted reservation. Native
 * payment/recovery receipts are consumed by callers BEFORE this reader. */
export async function assertPurchasePreparationForNewPayment(tx:FirebaseFirestore.Transaction,transactionId:string,order:any) {
  const p=acceptedOrderPurchasePolicy(order,transactionId);
  if(order.purchasePolicy?.policyVersion!==PURCHASE_PREPARATION_POLICY_VERSION)return;
  const source=p?await readPurchasePreparationSource(tx,transactionId,order):null;
  if(!source||Date.now()>=source.expiresAtMs)throw new HttpsError('failed-precondition','La préparation de ce paiement doit être réexaminée.',
    {reason:'purchase_preparation_window_unqualified_or_elapsed',paymentPermissionGranted:false,action:'contactSupport'});
}
/** The review never writes an acceptance, clock, financial intent or status. */
export async function recordPurchasePreparationReview(transactionId:string,kind:'pending_payment'|'label_abandonment',reason:string) {
  const ref=db.collection('transactions').doc(transactionId),alert=db.collection('admin_alerts').doc(`preparation_policy_${kind}_${transactionId}`);
  return db.runTransaction(async tx=>{
    const order=(await tx.get(ref)).data(),prior=await tx.get(alert);
    if(!order||kind==='pending_payment'&&order.status!=='pending_payment'||kind==='label_abandonment'&&(order.status!=='paid'||order.labelCreationPending!==true))return;
    if(prior.exists&&order.purchasePreparationReviewRequired===true&&order.purchasePreparationReview?.kind===kind&&order.purchasePreparationReview?.reason===reason)return;
    if(!prior.exists)tx.create(alert,{kind:'purchase_preparation_policy_review',severity:'warning',refId:transactionId,status:'open',createdAt:Timestamp.now(),
      message:'Rapprocher les termes de préparation acceptés et leurs sources natives. Aucun délai ni accord historique n’a été inventé.',
      context:{kind,reason,financialEffectAuthorized:false,acceptanceReconstructed:false}});
    tx.update(ref,{purchasePreparationReviewRequired:true,purchasePreparationReview:{protocol:'purchase_preparation_review_v1',kind,reason,observedAt:Timestamp.now(),
      financialEffectAuthorized:false,acceptanceReconstructed:false}});
  });
}

/** Additive owner observation; old policy_observe envelopes keep their keys. */
export async function purchasePreparationObservation(tx:FirebaseFirestore.Transaction,transactionId:string,ownerId:string,order:any) {
  const policy=acceptedOrderPurchasePolicy(order,transactionId),source=await readPurchasePreparationSource(tx,transactionId,order);
  const {qualifiedRejectedLabelPurchase}=await import('./refundState');
  const rejected=qualifiedRejectedLabelPurchase(order,transactionId);
  return {protocol:'purchase_preparation_policy_observation_v1',transactionId,ownerId,
    qualification:source?'accepted_v2_source':policy?.policyVersion===PURCHASE_POLICY_VERSION?'historical_terms_not_recorded':'unknown',
    policyVersion:policy?.policyVersion??null,policyHash:policy?.hash??null,terms:policy?.preparationTerms??null,
    pendingPayment:source?{clockBasis:source.clockBasis,startsAtMs:source.startsAtMs,expiresAtMs:source.expiresAtMs,
      windowHash:source.windowHash,sourceHash:source.sourceHash,state:Date.now()>=source.expiresAtMs?'elapsed':'open'}:null,
    labelAbandonment:source?{requiredDefinitiveRejections:source.requiredDefinitiveRejections,countBasis:'attributed_native_provider_rejections',
      recordedDefinitiveRejections:rejected?.rejectedAttempts??null,latestAttemptId:rejected?.attemptId??null,
      rejectionSourceHash:rejected?.rejectionSourceHash??null,rejectionsQualification:rejected?'native_attributed_rejections':'not_qualified'}:null,
    automatedEffectAuthorized:false,providerObserved:false,financialResolutionVerified:false};
}

/** Same reader at the producer and the first-refund lock. A retry counter,
 * timeout or HTTP error alone is never an attributed definitive rejection. */
export async function readLabelAbandonmentPolicySource(tx:FirebaseFirestore.Transaction,transactionId:string,order:any) {
  const preparation=await readPurchasePreparationSource(tx,transactionId,order);
  const {qualifiedRejectedLabelPurchase}=await import('./refundState');
  const rejection=qualifiedRejectedLabelPurchase(order,transactionId);
  if(!preparation||!rejection||!nativePurchasePaymentSource(order,transactionId)||
    !Number.isSafeInteger(order.labelAttempts)||order.labelAttempts<0||order.labelAttempts>20||
    order.lastCountedLabelAttemptId!==rejection.attemptId)return null;
  return {protocol:'label_abandonment_policy_source_v1',policyHash:preparation.policyHash,windowHash:preparation.windowHash,
    sourceHash:digest([preparation.sourceHash,rejection.rejectionSourceHash,rejection.labelSourceHash,rejection.attemptId,order.labelAttempts,
      preparation.requiredDefinitiveRejections]),requiredFailures:preparation.requiredDefinitiveRejections,
    rejectedAttempts:rejection.rejectedAttempts,expectedLabelAttempts:order.labelAttempts,
    ready:rejection.rejectedAttempts>=preparation.requiredDefinitiveRejections};
}
