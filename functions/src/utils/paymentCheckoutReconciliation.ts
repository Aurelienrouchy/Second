/** Unsettled purchase authorization evidence. Observation never captures or refunds. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { exactMixedDebit, nativeTime, nonnegativeCents, stripeIntentEvidence } from './stripeCheckoutProof';
import { reconcileCanceledPurchase } from './refund';
import type { PaymentInspectionAdmission } from './paymentCaptureAnomaly';
import { qualifiedPurchasePolicy } from './purchasePolicy';
import { qualifiedQuoteTaxSnapshot } from './shippingSourceIdentity';
import { consistentRateDetails, exactCents, hasCurrentRateQualification } from './shippingPurchaseRate';
import { shippingTransportLeg, shippingTransportNativeContext } from '../config/shippingTransportPolicy';

type Data = FirebaseFirestore.DocumentData;
export type CheckoutReconciliationKind = 'authorization_unsettled' | 'cancellation_unsettled' | 'processing_unsettled' | 'confirmation_outcome_unknown';
const text = (v: unknown) => typeof v === 'string' && v.length <= 256 ? v : null;
const number = (v: unknown) => nonnegativeCents(v) ? v : null;
const piId = (v: unknown): v is string => typeof v === 'string' && /^pi_[A-Za-z0-9]+$/.test(v);
const orderId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
// Firebase identities are opaque. Document/command IDs keep their own stricter
// grammar; whitespace and Unicode never select a different wallet owner.
const ownerId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 &&
  !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
function latestChargeId(value: unknown): string | null {
  const id = typeof value === 'string' ? value : value && typeof value === 'object' &&
    'object' in value && value.object === 'charge' && 'id' in value ? value.id : null;
  return typeof id === 'string' && id.length <= 256 && /^ch_[A-Za-z0-9]+$/.test(id) ? id : null;
}
const timeMs = (v: any): number | null => nativeTime(v) ? v instanceof Date ? v.getTime() : v.toMillis() : null;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const binding = (o: Data) => hash([o.buyerId, o.sellerId, o.status, o.totalAmount, o.currency,
  o.shippingQuoteId, o.shipEngineRateId, o.stripePaymentIntentId, o.walletAmountUsed, o.paidVia,
  o.walletCheckoutAttemptId, o.walletCheckoutOutcome, o.paidAt != null, o.stripeChargeId, o.capturedCardCents]);
function evidence(pi: any) {
  return { paymentIntentId: text(pi?.id), status: text(pi?.status), currency: text(pi?.currency),
    requestedCents: number(pi?.amount), receivedCents: number(pi?.amount_received), capturableCents: number(pi?.amount_capturable),
    confirmationMethod: text(pi?.confirmation_method), captureMethod: text(pi?.capture_method),
    transactionId: text(pi?.metadata?.transactionId), buyerId: text(pi?.metadata?.buyerId), sellerId: text(pi?.metadata?.sellerId),
    checkoutIntentId: text(pi?.metadata?.checkoutIntentId), latestChargeId: latestChargeId(pi?.latest_charge), checkedAtMs: Date.now() };
}
function qualify(id: string, o: Data, i: Data | undefined, rows: {id: string; data: Data}[], pi: any): string | null {
  const total = typeof o.totalAmount === 'number' ? Math.round(o.totalAmount * 100) : NaN;
  const wallet = o.walletAmountUsed ?? 0;
  if (!ownerId(o.buyerId) || !ownerId(o.sellerId) || o.buyerId === o.sellerId || !piId(o.stripePaymentIntentId) ||
      o.deliveryType !== 'shipping' || !nonnegativeCents(total) || total <= 0 ||
      Math.abs(o.totalAmount * 100 - total) > 0.0000001 || !nonnegativeCents(wallet) || wallet >= total || o.currency !== 'CAD') return 'order_binding_unqualified';
  if (o.refund != null || o.refundBlocked === true || o.refundLegacyReconciliationRequired === true || o.bankDispute != null ||
      o.disputed === true || o.refundedAt != null) return 'order_obligation_conflict';
  if (o.status === 'pending_payment' ? o.paidAt != null || o.stripeChargeId != null || o.capturedCardCents != null && o.capturedCardCents !== 0 :
    !['paid', 'label_created', 'shipped', 'delivered', 'completed'].includes(o.status) || !nativeTime(o.paidAt) ||
      typeof o.stripeChargeId !== 'string' || !/^ch_[A-Za-z0-9]+$/.test(o.stripeChargeId) ||
      latestChargeId(pi?.latest_charge) !== o.stripeChargeId || o.capturedCardCents !== total - wallet ||
      o.refund != null || o.refundBlocked === true || o.refundLegacyReconciliationRequired === true || o.bankDispute != null || o.disputed === true ||
      o.refundedAt != null || pi?.status !== 'succeeded') return 'local_settlement_unqualified';
  if (!i || i.schemaVersion !== 1 || i.protocol !== 'server_manual_v1' || i.transactionId !== id || i.ownerId !== o.buyerId ||
      i.sellerId !== o.sellerId || typeof i.intentId !== 'string' || !i.intentId || !Number.isSafeInteger(i.version) || i.version < 1 ||
      !nativeTime(i.createdAt) || !nativeTime(i.authorizedAt) || i.paymentIntentId !== o.stripePaymentIntentId ||
      i.totalCents !== total || i.walletCents !== wallet || i.cardCents !== total - wallet || i.cardCents < 50 || i.currency !== 'CAD' ||
      i.quoteId !== o.shippingQuoteId || i.rateId !== o.shipEngineRateId ||
      typeof i.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(i.sourceHash) || !Number.isSafeInteger(i.sourceRevision) || i.sourceRevision < 0 ||
      !['confirming', 'unknown', 'requires_capture', 'processing', 'succeeded', 'canceled'].includes(i.state)) return 'checkout_intent_unqualified';
  if (wallet > 0 ? !nativeTime(i.walletCommittedAt) || !exactMixedDebit(o, rows, wallet, i.walletLedgerId) : rows.length !== 0 || i.walletCommittedAt != null) return 'wallet_debit_unqualified';
  const p = stripeIntentEvidence(pi, {id: o.stripePaymentIntentId, orderId: id, buyerId: o.buyerId, sellerId: o.sellerId,
    cardCents: total - wallet, walletCents: wallet, intentId: i.intentId});
  if (!p) return 'provider_binding_unqualified';
  if (p.state === 'authorized' && (pi.capture_method !== 'manual' || p.receivedCents !== 0 || p.capturableCents !== p.amountCents)) return 'authorization_amount_unqualified';
  return null;
}

/** Read-only recognition of the existing manual checkout commit. Metadata
 * never selects an order: the stored PI must name exactly one native order.
 * The caller compares this source before/after provider IO in its final TX. */
export async function readCommittedCheckoutCapture(tx: FirebaseFirestore.Transaction, paymentIntentId: string,
  pi?: any, charge?: any) {
  const orders = await tx.get(db.collection('transactions').where('stripePaymentIntentId', '==', paymentIntentId).limit(2));
  const revision = (snap: FirebaseFirestore.DocumentSnapshot) => snap.updateTime ?
    `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
  const orderManifest = orders.docs.map(d => [d.id, revision(d), d.data()]);
  const absent = {sourceHash: hash(orderManifest), reason: 'native_order_not_unique', currentOrderProof: null};
  if (orders.size !== 1) return absent;
  const snap = orders.docs[0], order = snap.data(), id = snap.id;
  if (!orderId(id) || !ownerId(order.buyerId) || !ownerId(order.sellerId) || order.buyerId === order.sellerId)
    return {...absent, reason: 'native_order_binding_unqualified'};
  const intentSnap = await tx.get(db.collection('stripe_checkout_intents').doc(id));
  const intent = intentSnap.data();
  const ledger = await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').where('transactionId', '==', id).limit(101));
  const ledgerManifest = ledger.docs.map(d => [d.id, revision(d), d.data()]);
  const sourceHash = hash([orderManifest, revision(intentSnap), intent ?? null, ledgerManifest]);
  const currentOrderProof = {transactionId: id, status: text(order.status), paymentIntentId: text(order.stripePaymentIntentId),
    currency: order.currency === 'CAD' ? 'CAD' : null,
    totalCents: typeof order.totalAmount === 'number' ? number(Math.round(order.totalAmount * 100)) : null,
    walletCents: number(order.walletAmountUsed ?? 0), capturedCardCents: number(order.capturedCardCents),
    stripeChargeId: text(order.stripeChargeId), paidAtMs: timeMs(order.paidAt),
    intentId: text(intent?.intentId), intentVersion: number(intent?.version),
    orderRevision: revision(snap), intentRevision: revision(intentSnap), sourceHash};
  let reason: string | null = !revision(snap) || !revision(intentSnap) || ledger.docs.some(d => !revision(d)) ?
    'native_source_revision_unknown' : ledger.size >= 101 ? 'ledger_coverage_unknown' :
      order.status === 'pending_payment' ? 'native_payment_not_committed' :
        qualify(id, order, intent, ledger.docs.map(d => ({id: d.id, data: d.data()})), pi);
  const paidMs = timeMs(order.paidAt), authorizedMs = timeMs(intent?.authorizedAt), createdMs = timeMs(intent?.createdAt);
  if (reason === null && (paidMs === null || authorizedMs === null || createdMs === null || createdMs <= 0 ||
      createdMs > authorizedMs || authorizedMs > paidMs || paidMs > Date.now() || intent?.state === 'canceled' ||
      (order.walletAmountUsed ?? 0) === 0 && order.paidVia != null && order.paidVia !== 'card')) reason = 'native_payment_commit_unqualified';
  // A GET with the platform key has no connected-account header. Both actual
  // provider objects must agree with the stored capture, without refund/dispute
  // or destination/fee evidence. This does not certify seller or bank funds.
  if (reason === null && (pi?.object !== 'payment_intent' || typeof pi.livemode !== 'boolean' ||
      charge?.object !== 'charge' || charge.id !== order.stripeChargeId || charge.currency !== 'cad' ||
      charge.livemode !== pi.livemode || latestChargeId(pi.latest_charge) !== charge.id ||
      (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id) !== paymentIntentId ||
      charge.status !== 'succeeded' || charge.paid !== true || charge.captured !== true ||
      charge.amount !== order.capturedCardCents || charge.amount_captured !== order.capturedCardCents ||
      charge.amount_refunded !== 0 || charge.refunded !== false || charge.disputed !== false ||
      charge.transfer_data != null || charge.destination != null || charge.transfer != null ||
      charge.application_fee != null || charge.application_fee_amount != null && charge.application_fee_amount !== 0 ||
      pi.on_behalf_of != null || charge.on_behalf_of != null)) reason = 'provider_capture_unqualified';
  return {sourceHash, reason, currentOrderProof};
}

/** Documentary attribution only. These surviving captures cannot replace the
 * missing order, its inventory commitment or its native payment receipt. */
export interface MissingOrderCheckoutProof {
  evidenceKind: 'native_checkout_without_order_v1';
  transactionId: string; articleId: string; buyerId: string; sellerId: string;
  paymentIntentId: string; stripeChargeId: string | null;
  intentId: string; intentVersion: number; quoteId: string; rateId: string;
  totalCents: number; walletCents: number; cardCents: number; currency: 'CAD';
  authorizedAtMs: number; acceptedAtMs: number;
  intentRevision: string; quoteRevision: string; sourceHash: string;
}

/** Starts with the native PI index, never with provider metadata. The caller
 * compares the complete source before/after its bounded platform PI/charge GET.
 * A null reason proves only this documentary join, never a local settlement. */
export async function readMissingOrderCheckoutCapture(tx: FirebaseFirestore.Transaction, paymentIntentId: string,
  pi?: any, charge?: any): Promise<{sourceHash: string; reason: string | null; currentCheckoutProof: MissingOrderCheckoutProof | null}> {
  const revision = (snap: FirebaseFirestore.DocumentSnapshot) => snap.updateTime ?
    `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item) ?
      Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex');
  const manifest = (snap: FirebaseFirestore.DocumentSnapshot) => [snap.id, revision(snap), snap.data() ?? null];
  const capturedTime = (value: unknown) => value instanceof Timestamp && Number.isFinite(value.toMillis()) ? value.toMillis() : null;
  const sameCapturedTime = (a: unknown, b: unknown) => a instanceof Timestamp && b instanceof Timestamp && a.isEqual(b);
  const capturedAtOrAfter = (a: unknown, b: unknown) => a instanceof Timestamp && b instanceof Timestamp &&
    (a.seconds > b.seconds || a.seconds === b.seconds && a.nanoseconds >= b.nanoseconds);
  const orders = await tx.get(db.collection('transactions').where('stripePaymentIntentId', '==', paymentIntentId).limit(2));
  const intents = await tx.get(db.collection('stripe_checkout_intents').where('paymentIntentId', '==', paymentIntentId).limit(2));
  let sourceHash = digest([orders.docs.map(manifest), intents.docs.map(manifest)]);
  const unknown = (reason: string) => ({sourceHash, reason, currentCheckoutProof: null});
  if (!piId(paymentIntentId) || orders.size !== 0) return unknown('native_order_present_or_ambiguous');
  if (intents.size !== 1) return unknown('native_checkout_intent_not_unique');
  const snap = intents.docs[0], i = snap.data(), id = snap.id;
  if (!orderId(id) || i.schemaVersion !== 1 || i.protocol !== 'server_manual_v1' || i.transactionId !== id ||
      !ownerId(i.ownerId) || !ownerId(i.sellerId) || i.ownerId === i.sellerId || i.paymentIntentId !== paymentIntentId ||
      typeof i.intentId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(i.intentId) ||
      !Number.isSafeInteger(i.version) || i.version < 3 || i.version >= Number.MAX_SAFE_INTEGER ||
      !['confirming', 'processing', 'succeeded', 'requires_capture', 'unknown'].includes(i.state) ||
      i.state === 'unknown' && i.unknownOperation !== 'confirm' ||
      typeof i.confirmAttemptId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(i.confirmAttemptId) ||
      !nonnegativeCents(i.totalCents) || !nonnegativeCents(i.walletCents) || i.walletCents >= i.totalCents ||
      i.cardCents !== i.totalCents - i.walletCents || i.cardCents < 50 || i.currency !== 'CAD' ||
      !orderId(i.quoteId) || typeof i.rateId !== 'string' || !/^se-[A-Za-z0-9-]+$/.test(i.rateId) ||
      typeof i.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(i.sourceHash) || i.authorizedSourceHash !== i.sourceHash ||
      !Number.isSafeInteger(i.sourceRevision) || i.sourceRevision < 0 ||
      !Number.isSafeInteger(i.authorizedObservationRevision) || i.authorizedObservationRevision < 0)
    return unknown('native_checkout_authorization_unqualified');
  const [orderSnap, quoteSnap] = await tx.getAll(db.collection('transactions').doc(id), db.collection('shipping_quotes').doc(i.quoteId));
  const ledger = await tx.get(db.collection('wallets').doc(i.ownerId).collection('ledger').where('transactionId', '==', id).limit(101));
  sourceHash = digest([orders.docs.map(manifest), intents.docs.map(manifest), manifest(orderSnap), manifest(quoteSnap), ledger.docs.map(manifest)]);
  if (orderSnap.exists) return unknown('native_order_present_or_ambiguous');
  const intentRevision = revision(snap), quoteRevision = revision(quoteSnap);
  if (!intentRevision || !quoteRevision || ledger.docs.some(d => !revision(d))) return unknown('native_source_revision_unknown');
  const q = quoteSnap.data(), s = q?.source, accepted = q?.purchasePolicyAcceptance;
  const policy = qualifiedPurchasePolicy(q?.purchasePolicy);
  const acceptedAt = capturedTime(accepted?.acceptedAt), createdAt = capturedTime(i.createdAt), authorizedAt = capturedTime(i.authorizedAt);
  const issuedAt = capturedTime(q?.issuedAt), validUntil = capturedTime(q?.validUntil), quoteAcceptedAt = capturedTime(q?.acceptedAt);
  if (!q || q.schemaVersion !== 1 || q.state !== 'claimed' || q.transactionId !== id || q.ownerId !== i.ownerId || q.sellerId !== i.sellerId ||
      !orderId(q.articleId) || s?.articleId !== q.articleId || s.buyerId !== i.ownerId || s.sellerId !== i.sellerId ||
      q.acceptancePolicyVersion !== 1 || q.acceptedRateId !== i.rateId || exactCents(q.acceptedTotal) !== i.totalCents ||
      !qualifiedQuoteTaxSnapshot(q) || !policy || policy.quoteId !== i.quoteId || policy.articleId !== q.articleId ||
      policy.buyerId !== i.ownerId || policy.sellerId !== i.sellerId || policy.sourceHash !== s.hash ||
      accepted?.schemaVersion !== 1 || accepted.transactionId !== id || accepted.quoteId !== i.quoteId || accepted.acceptedBy !== i.ownerId ||
      accepted.policyHash !== policy.hash || accepted.policyVersion !== policy.policyVersion || accepted.rateId !== i.rateId || accepted.totalCents !== i.totalCents ||
      accepted.pricingVersion !== q.pricingVersion || digest(accepted.taxSnapshot) !== digest(q.taxSnapshot) ||
      issuedAt === null || validUntil === null || validUntil - issuedAt !== 900000 || acceptedAt === null ||
      issuedAt < 0 || acceptedAt < issuedAt || acceptedAt >= validUntil || !sameCapturedTime(q.acceptanceValidatedAt, accepted.acceptedAt) ||
      quoteAcceptedAt === null || quoteAcceptedAt < acceptedAt || createdAt === null || createdAt < quoteAcceptedAt ||
      authorizedAt === null || authorizedAt < createdAt || authorizedAt > Date.now()) return unknown('native_claimed_quote_unqualified');
  try {
    const context = shippingTransportNativeContext(s.origin, s.destination, s.parcel);
    const transport = shippingTransportLeg(s.transportAdmission, context, 'forward');
    const terms = q.transportTermsAcceptance;
    if (!hasCurrentRateQualification(q.rates, {...context, transport}) ||
        !hasCurrentRateQualification({...q.rates, qualification: q.acceptedQualification}, {...context, transport}) ||
        !consistentRateDetails(q.rates.qualification, q.acceptedQualification, i.rateId) ||
        terms?.protocol !== 'shipping_transport_acceptance_v1' || terms.termsHash !== transport.admission.termsHash ||
        terms.acceptedBy !== i.ownerId || terms.quoteId !== i.quoteId || terms.rateId !== i.rateId ||
        terms.policyHash !== policy.hash || !sameCapturedTime(terms.acceptedAt, accepted.acceptedAt)) return unknown('native_quote_terms_unqualified');
  } catch { return unknown('native_quote_terms_unqualified'); }
  const selected = q.rates.rates.find((rate: any) => rate.rateId === i.rateId);
  const itemCents = exactCents(s.amount), feeCents = exactCents(s.fee), taxCents = exactCents(s.tax);
  if (!selected || itemCents === null || itemCents < 1 || feeCents === null || taxCents === null ||
      itemCents + feeCents + taxCents + selected.shippingCents !== i.totalCents) return unknown('native_checkout_amount_unqualified');
  const row = ledger.docs[0], debit = row?.data();
  if (ledger.size >= 101 || (i.walletCents === 0 ? ledger.size !== 0 || i.walletLedgerId != null || i.walletCommittedAt != null :
    ledger.size !== 1 || row.id !== i.walletLedgerId || debit?.transactionId !== id || debit.type !== 'purchase_debit' ||
      debit.amount !== i.walletCents || debit.currency !== 'CAD' || !nonnegativeCents(debit.balanceAfter) ||
      capturedTime(i.walletCommittedAt) === null || !sameCapturedTime(debit.createdAt, i.walletCommittedAt) ||
      !capturedAtOrAfter(i.walletCommittedAt, i.createdAt) || !capturedAtOrAfter(i.authorizedAt, i.walletCommittedAt)))
    return unknown('native_wallet_debit_unqualified');
  const currentCheckoutProof: MissingOrderCheckoutProof = {evidenceKind: 'native_checkout_without_order_v1',
    transactionId: id, articleId: q.articleId, buyerId: i.ownerId, sellerId: i.sellerId, paymentIntentId,
    stripeChargeId: latestChargeId(pi?.latest_charge), intentId: i.intentId, intentVersion: i.version, quoteId: i.quoteId, rateId: i.rateId,
    totalCents: i.totalCents, walletCents: i.walletCents, cardCents: i.cardCents, currency: 'CAD', authorizedAtMs: Math.floor(authorizedAt),
    acceptedAtMs: Math.floor(acceptedAt), intentRevision, quoteRevision, sourceHash};
  const provider = stripeIntentEvidence(pi, {id: paymentIntentId, orderId: id, buyerId: i.ownerId, sellerId: i.sellerId,
    cardCents: i.cardCents, walletCents: i.walletCents, intentId: i.intentId});
  const reason = !provider || provider.state !== 'succeeded' || pi?.object !== 'payment_intent' || pi.currency !== 'cad' ||
    typeof pi.livemode !== 'boolean' || !currentCheckoutProof.stripeChargeId || charge?.object !== 'charge' ||
    charge.id !== currentCheckoutProof.stripeChargeId || charge.currency !== 'cad' || charge.livemode !== pi.livemode ||
    (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id) !== paymentIntentId ||
    charge.status !== 'succeeded' || charge.paid !== true || charge.captured !== true || charge.amount !== i.cardCents ||
    charge.amount_captured !== i.cardCents || charge.amount_refunded !== 0 || charge.refunded !== false || charge.disputed !== false ||
    charge.transfer_data != null || charge.destination != null || charge.transfer != null || charge.application_fee != null ||
    charge.application_fee_amount != null && charge.application_fee_amount !== 0 || pi.on_behalf_of != null || charge.on_behalf_of != null ?
    'provider_capture_unqualified' : null;
  return {sourceHash, reason, currentCheckoutProof};
}

/** Deterministic private operator dossier, including conflicts; no secret or payment permission. */
export async function recordCheckoutReconciliation(id: string, pi: any, expected: Data,
  kind: CheckoutReconciliationKind, observedBy: string, localConflict?: string, admit?: PaymentInspectionAdmission) {
  if (!orderId(id) || !piId(expected.stripePaymentIntentId)) throw new HttpsError('invalid-argument', 'Référence de paiement invalide.');
  const operationId = 'checkout_' + hash([id, expected.stripePaymentIntentId]);
  const ref = db.collection('failed_operations').doc(operationId), orderRef = db.collection('transactions').doc(id);
  return db.runTransaction(async tx => {
    if (admit) await admit(tx);
    const [orderSnap, intentSnap, priorSnap] = await tx.getAll(orderRef, db.collection('stripe_checkout_intents').doc(id), ref);
    const current = orderSnap.data();
    if (!current) throw new HttpsError('not-found', 'Commande introuvable.');
    const intent = intentSnap.data();
    const ledger = ownerId(current.buyerId) ? await tx.get(db.collection('wallets').doc(current.buyerId).collection('ledger').where('transactionId', '==', id).limit(101)) : null;
    const reason = binding(current) !== binding(expected) ? 'order_changed_during_observation' : !ledger || ledger.size >= 101 ? 'ledger_unqualified' :
      localConflict ?? qualify(id, current, intent, ledger.docs.map(d => ({id: d.id, data: d.data()})), pi);
    const currentProof = evidence(pi), prior = priorSnap.data();
    const orderProof = {transactionId: id, buyerId: text(current.buyerId), sellerId: text(current.sellerId), status: text(current.status),
      paymentIntentId: text(current.stripePaymentIntentId), totalCents: typeof current.totalAmount === 'number' ? number(Math.round(current.totalAmount * 100)) : null,
      walletCents: number(current.walletAmountUsed ?? 0), intentId: text(intent?.intentId), intentVersion: number(intent?.version),
      intentState: text(intent?.state), walletLedgerId: text(intent?.walletLedgerId), authorizedAtMs: timeMs(intent?.authorizedAt),
      paidAtMs: timeMs(current.paidAt), capturedCardCents: number(current.capturedCardCents), stripeChargeId: text(current.stripeChargeId)};
    const settled = reason === null && current.status !== 'pending_payment' && pi?.status === 'succeeded';
    const result = {protocol: 'checkout_reconciliation_v1' as const, operationId, transactionId: id, kind,
      status: settled ? 'resolved' as const : 'pending' as const, actionRequired: !settled,
      resolution: settled ? 'purchase_payment_committed' as const : null,
      qualified: reason === null, reason: settled ? 'purchase_payment_committed' : reason ?? (kind === 'confirmation_outcome_unknown'
        ? 'confirmation_request_outcome_unproven' : pi.status === 'requires_capture' ? 'authorization_requires_operator_review' : 'provider_transition_requires_local_reconciliation'),
      automaticCaptureAllowed: false as const, automaticRefundAllowed: false as const, automaticCardRefundAllowed: false as const,
      localRestitutionMayCommit: true as const, newConfirmationAllowed: false as const, paymentPermissionGranted: false as const,
      paymentCommitted: settled, currentProviderProof: currentProof, currentOrderProof: orderProof};
    tx.set(ref, {type: 'payment_checkout_reconciliation', refId: id, status: result.status, actionRequired: result.actionRequired,
      ...(settled ? {resolution: 'purchase_payment_committed', resolvedAt: FieldValue.serverTimestamp()} : {}),
      payload: {...(prior?.payload ?? {}), protocol: 'checkout_reconciliation_v1', kind, firstProviderProof: prior?.payload?.firstProviderProof ?? currentProof,
        currentProviderProof: currentProof, currentOrderProof: orderProof, qualified: result.qualified, reason: result.reason,
        automaticCaptureAllowed: false, automaticRefundAllowed: false, automaticCardRefundAllowed: false,
        localRestitutionMayCommit: true, newConfirmationAllowed: false, paymentPermissionGranted: false},
      attempts: prior?.attempts ?? 0, lastTriedAt: null, createdAt: prior?.createdAt ?? FieldValue.serverTimestamp(),
      lastProofCheckedBy: observedBy, lastProofCheckedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    return result;
  });
}

/** Fresh provider read; changed, settled and canceled states remain explicit review until locally reconciled. */
export async function inspectCheckoutReconciliation(operationId: string, inspectedBy: string, admit?: PaymentInspectionAdmission) {
  if (typeof operationId !== 'string' || !/^checkout_[a-f0-9]{64}$/.test(operationId)) throw new HttpsError('invalid-argument', 'Dossier de paiement invalide.');
  const prior = (await db.collection('failed_operations').doc(operationId).get()).data();
  if (!prior || prior.type !== 'payment_checkout_reconciliation' || !orderId(prior.refId)) throw new HttpsError('not-found', 'Dossier introuvable.');
  const current = (await db.collection('transactions').doc(prior.refId).get()).data();
  if (!current || !piId(current.stripePaymentIntentId) || operationId !== 'checkout_' + hash([prior.refId, current.stripePaymentIntentId])) throw new HttpsError('failed-precondition', 'La liaison du dossier a changé.');
  const stripe = getStripe();
  if (!stripe) throw new HttpsError('unavailable', 'Vérification du paiement indisponible.');
  let pi;
  try { pi = await stripe.paymentIntents.retrieve(current.stripePaymentIntentId); }
  catch { throw new HttpsError('unavailable', 'Le paiement n’a pas pu être relu. Le dossier reste ouvert.'); }
  if (pi.status === 'canceled') {
    const result = await reconcileCanceledPurchase(prior.refId, pi, admit);
    if (result.committed) return {protocol: 'checkout_reconciliation_v1' as const, operationId, transactionId: prior.refId, kind: 'cancellation_unsettled' as const,
      status: 'resolved' as const, actionRequired: false as const, qualified: true, reason: 'canceled_purchase_committed',
      resolution: 'canceled_purchase_committed' as const,
      automaticCaptureAllowed: false as const, automaticRefundAllowed: false as const, automaticCardRefundAllowed: false as const,
      localRestitutionCommitted: true as const, paymentPermissionGranted: false as const,
      cancellationCommitted: true, walletRefundCommitted: true, refundedCents: result.refundedCents, replay: result.replay};
    return recordCheckoutReconciliation(prior.refId, pi, current, 'cancellation_unsettled', inspectedBy, result.reason, admit);
  }
  return recordCheckoutReconciliation(prior.refId, pi, current,
    prior.payload?.kind === 'cancellation_unsettled' ? 'cancellation_unsettled' :
      prior.payload?.kind === 'processing_unsettled' ? 'processing_unsettled' :
        prior.payload?.kind === 'confirmation_outcome_unknown' ? 'confirmation_outcome_unknown' : 'authorization_unsettled', inspectedBy, undefined, admit);
}

/** Signed purchase-only cancellation event; unrelated provider objects are ignored. */
export async function observeCanceledPurchase(paymentIntent: any, observedBy: string) {
  const id = paymentIntent?.metadata?.transactionId;
  if (!orderId(id) || !piId(paymentIntent?.id)) return;
  const current = (await db.collection('transactions').doc(id).get()).data();
  if (!current) return;
  const result = await reconcileCanceledPurchase(id, paymentIntent);
  if (!result.committed) await recordCheckoutReconciliation(id, paymentIntent,
    {...current, stripePaymentIntentId: piId(current.stripePaymentIntentId) ? current.stripePaymentIntentId : paymentIntent.id},
    'cancellation_unsettled', observedBy, result.reason);
}
