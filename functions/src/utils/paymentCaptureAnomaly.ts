/** Durable signed capture anomalies. Operator-only evidence; no financial replay. */
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import type { MissingOrderCheckoutProof } from './paymentCheckoutReconciliation';

export interface PaymentCaptureContext { eventId?: string; source?: 'signed_event' | 'platform_get'; accountId?: unknown; stripeContext?: unknown; }
export type PaymentCaptureAnomalyReason = 'missing_reference' | 'invalid_reference' | 'invalid_payment_intent'
  | 'invalid_currency' | 'invalid_capture_amount' | 'transaction_not_found' | 'payment_identity_mismatch' | 'native_payment_identity_unqualified'
  | 'orphan_capture_original_refund_reserved' | 'payment_account_scope_unqualified' | 'wallet_amount_invalid'
  | 'expected_amount_invalid' | 'amount_mismatch' | 'late_capture_refund_unqualified' | 'inventory_engagement_mismatch';

export interface ExpectedCaptureAmounts {
  totalCents: number | null;
  walletCents: number | null;
  cardCents: number | null;
}

const textOrNull = (value: unknown, max = 300): string | null => typeof value === 'string' ? value.substring(0, max) : null;
const nonNegativeCents = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const validPi = (value: unknown): value is string => typeof value === 'string' && value.length <= 200 && /^pi_[A-Za-z0-9_]+$/.test(value);
const proofHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex');
export type PaymentInspectionAdmission = (tx: FirebaseFirestore.Transaction) => Promise<void>;

export function validCaptureReference(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !value.includes('/');
}
export function validCapturedPaymentIntent(value: unknown): value is string { return validPi(value); }
/** Only a signature-verified event envelope or an actual platform GET caller
 * supplies scope. Metadata on the PaymentIntent never supplies account scope. */
export function paymentCaptureScope(context: PaymentCaptureContext): 'platform' | 'non_platform' | 'unknown' {
  if (!['signed_event', 'platform_get'].includes(context.source ?? '') ||
      !Object.prototype.hasOwnProperty.call(context, 'accountId') || !Object.prototype.hasOwnProperty.call(context, 'stripeContext') ||
      context.source === 'signed_event' && (typeof context.eventId !== 'string' || !/^evt_[A-Za-z0-9_]{1,190}$/.test(context.eventId))) return 'unknown';
  if (context.accountId === null && context.stripeContext === null) return 'platform';
  const validAccount = context.accountId === null || typeof context.accountId === 'string' && /^acct_[A-Za-z0-9_]{1,190}$/.test(context.accountId);
  const validContext = context.stripeContext === null || typeof context.stripeContext === 'string' && context.stripeContext.length > 0 && context.stripeContext.length <= 512;
  return validAccount && validContext ? 'non_platform' : 'unknown';
}

/** This persistence is mandatory: failure propagates so the webhook cannot ACK. */
export async function recordPaymentCaptureAnomaly(
  paymentIntent: any, reason: PaymentCaptureAnomalyReason, context: PaymentCaptureContext = {},
  originalPaymentIntentId: unknown = null,
  expectedAmounts?: ExpectedCaptureAmounts,
): Promise<string> {
  const candidateReference = textOrNull(paymentIntent?.metadata?.transactionId);
  const observedPaymentIntentId = textOrNull(paymentIntent?.id);
  const signedEvidence = {
    observedPaymentIntentId, candidateReference,
    candidateTransactionId: validCaptureReference(candidateReference) ? candidateReference : null,
    originalPaymentIntentId: textOrNull(originalPaymentIntentId),
    currency: textOrNull(paymentIntent?.currency, 20),
    collectedAmountCents: nonNegativeCents(paymentIntent?.amount_received),
    // Planned amount is retained separately. It NEVER becomes capture proof.
    requestedAmountCents: nonNegativeCents(paymentIntent?.amount),
    providerContext: { source: context.source ?? 'unknown', accountScope: paymentCaptureScope(context),
      accountId: textOrNull(context.accountId), stripeContext: textOrNull(context.stripeContext, 512) },
    ...(expectedAmounts ? { expectedAmounts: { totalCents: nonNegativeCents(expectedAmounts.totalCents),
      walletCents: nonNegativeCents(expectedAmounts.walletCents), cardCents: nonNegativeCents(expectedAmounts.cardCents) } } : {}),
  };
  const eventId = textOrNull(context.eventId);
  const identity = observedPaymentIntentId ?? eventId ?? JSON.stringify(signedEvidence);
  const operationId = 'capture_' + createHash('sha256').update(identity).digest('hex');
  const ref = db.collection('failed_operations').doc(operationId);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const prior = snap.data();
    const reasons = [...new Set([...(Array.isArray(prior?.payload?.reasons) ? prior!.payload.reasons : []), reason])].slice(0, 20);
    const eventIds = [...new Set([...(Array.isArray(prior?.payload?.eventIds) ? prior!.payload.eventIds : []), ...(eventId ? [eventId] : [])])].slice(0, 50);
    // A duplicate cannot erase the exact documentary resolution. A different
    // signed observation reopens review; the old observation stays historical.
    let resolvedDuplicate = prior?.status === 'resolved' && prior.actionRequired === false &&
      prior.resolution === 'purchase_payment_committed' && prior.payload?.paymentCommitted === true &&
      prior.payload?.resolvedSignedEvidenceHash === proofHash(signedEvidence) &&
      Array.isArray(prior.payload.reasons) && prior.payload.reasons.includes(reason);
    if (resolvedDuplicate && validPi(observedPaymentIntentId)) {
      const {readCommittedCheckoutCapture} = await import('./paymentCheckoutReconciliation');
      const native = await readCommittedCheckoutCapture(tx, observedPaymentIntentId);
      resolvedDuplicate = native.sourceHash === prior?.payload?.currentOrderProof?.sourceHash;
    } else resolvedDuplicate = false;
    tx.set(ref, { type: 'payment_capture_reconciliation', refId: signedEvidence.candidateTransactionId ?? observedPaymentIntentId ?? operationId,
      payload: { signedEvidence: prior?.payload?.signedEvidence ?? signedEvidence, lastSignedEvidence: signedEvidence, reasons, eventIds,
        currentProviderProof: prior?.payload?.currentProviderProof ?? null,
        providerLookupState: prior?.payload?.providerLookupState ?? 'not_checked',
        providerLookupError: prior?.payload?.providerLookupError ?? null,
        ...(!resolvedDuplicate ? {paymentCommitted: false, qualified: false, reason: 'capture_observation_requires_review',
          currentCheckoutProof: null, resolvedSignedEvidenceHash: null} : {}) },
      error: reason, actionRequired: !resolvedDuplicate, status: resolvedDuplicate ? 'resolved' : 'pending',
      ...(!resolvedDuplicate ? {resolution: null, resolvedAt: null} : {}),
      attempts: prior?.attempts ?? 0, lastTriedAt: null,
      createdAt: prior?.createdAt ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return operationId;
}

export interface PaymentCaptureAnomalyInspection {
  operationId: string;
  status: 'pending' | 'resolved';
  actionRequired: boolean;
  resolution: 'purchase_payment_committed' | null;
  paymentCommitted: boolean;
  qualified: boolean;
  reason: string;
  automaticRefundAllowed: false;
  automaticCaptureAllowed: false;
  automaticCardRefundAllowed: false;
  paymentPermissionGranted: false;
  currentOrderProof: Record<string, unknown> | null;
  currentCheckoutProof: MissingOrderCheckoutProof | null;
  message: string;
  signedEvidence: Record<string, unknown>;
  currentProviderProof: Record<string, unknown> | null;
  providerLookupState: 'verified' | 'invalid' | 'unavailable';
}

/** Recognizes an already committed native payment, never executes one. Source
 * identity comes from the stored PI; metadata is only corroborating evidence. */
export async function inspectPaymentCaptureAnomalyProof(
  operationId: string, inspectedBy: string, admit?: PaymentInspectionAdmission,
): Promise<PaymentCaptureAnomalyInspection> {
  if (typeof operationId !== 'string' || !/^capture_[a-f0-9]{64}$/.test(operationId)) throw new HttpsError('invalid-argument', 'Dossier de capture invalide.');
  const ref = db.collection('failed_operations').doc(operationId);
  const preSnap = await ref.get(), pre = preSnap.data();
  if (!pre || pre.type !== 'payment_capture_reconciliation') throw new HttpsError('not-found', 'Dossier de capture introuvable.');
  const observedId = pre.payload?.signedEvidence?.observedPaymentIntentId;
  const { readCommittedCheckoutCapture, readMissingOrderCheckoutCapture } = await import('./paymentCheckoutReconciliation');
  const source = validPi(observedId) ? await db.runTransaction(tx => readCommittedCheckoutCapture(tx, observedId)) : null;
  const checkoutSource = validPi(observedId) && source?.currentOrderProof === null ?
    await db.runTransaction(tx => readMissingOrderCheckoutCapture(tx, observedId)) : null;
  let providerLookupState: 'verified' | 'invalid' | 'unavailable' = 'invalid';
  let currentProviderProof: Record<string, unknown> | null = null;
  let providerLookupError: string | null = 'Identité du PI non vérifiable.';
  let pi: any = null, charge: any = null;
  if (validPi(observedId)) {
    try {
      const stripe = getStripe();
      if (!stripe) throw new Error('Provider unavailable');
      const options = {timeout: 7000, maxNetworkRetries: 0};
      const current = await stripe.paymentIntents.retrieve(observedId, {}, options);
      pi = current;
      currentProviderProof = {
        paymentIntentId: textOrNull(current.id), currency: textOrNull(current.currency, 20),
        collectedAmountCents: nonNegativeCents(current.amount_received), requestedAmountCents: nonNegativeCents(current.amount),
        candidateReference: textOrNull(current.metadata?.transactionId), status: textOrNull(current.status),
        accountScope: 'platform_get',
        checkedAtMs: Date.now(),
      };
      const valid = current.id === observedId && current.currency === 'cad' && current.status === 'succeeded' &&
        nonNegativeCents(current.amount_received) !== null && current.amount_received > 0;
      providerLookupState = valid ? 'verified' : 'invalid';
      providerLookupError = valid ? null : 'Identité, devise, statut ou montant collecté actuel non conformes.';
      // An absent order may still leave a native, authorized checkout+quote.
      // Only that native join permits following the exact PI's charge GET;
      // the provider's transaction metadata alone never supplies a candidate.
      const observedCharge = typeof current.latest_charge === 'string' ? current.latest_charge :
        current.latest_charge?.object === 'charge' ? current.latest_charge.id : null;
      const nativeChargeId = source?.currentOrderProof?.stripeChargeId ??
        (checkoutSource?.currentCheckoutProof ? observedCharge : null);
      if (valid && typeof nativeChargeId === 'string' && /^ch_[A-Za-z0-9]+$/.test(nativeChargeId)) {
        charge = await stripe.charges.retrieve(nativeChargeId, {}, options);
        currentProviderProof.charge = {chargeId: textOrNull(charge.id), currency: textOrNull(charge.currency, 20),
          collectedAmountCents: nonNegativeCents(charge.amount_captured), refundedAmountCents: nonNegativeCents(charge.amount_refunded),
          paid: charge.paid === true, captured: charge.captured === true, disputed: charge.disputed === true};
      }
    } catch {
      providerLookupState = 'unavailable';
      providerLookupError = 'Le prestataire ne permet pas actuellement de vérifier ce PI.';
    }
  }
  const result = await db.runTransaction(async tx => {
    if (admit) await admit(tx);
    const snap = await tx.get(ref), current = snap.data();
    if (!current || current.type !== 'payment_capture_reconciliation' ||
        proofHash(current) !== proofHash(pre) ||
        preSnap.updateTime && (!snap.updateTime || !preSnap.updateTime.isEqual(snap.updateTime)))
      throw new HttpsError('aborted', 'Le dossier a changé. Relisez-le.');
    const native = validPi(observedId) ? await readCommittedCheckoutCapture(tx, observedId, pi, charge) : null;
    const checkoutNative = checkoutSource && validPi(observedId) ? await readMissingOrderCheckoutCapture(tx, observedId, pi, charge) : null;
    let reason = !source || !native ? 'native_payment_identity_unknown' : source.sourceHash !== native.sourceHash ?
      'native_source_changed_during_observation' : operationId !== 'capture_' + createHash('sha256').update(observedId).digest('hex') ?
        'capture_dossier_identity_unqualified' : providerLookupState !== 'verified' ? 'provider_capture_unavailable' : native.reason;
    let currentCheckoutProof: MissingOrderCheckoutProof | null = null;
    if (reason === 'native_order_not_unique' && checkoutSource && checkoutNative) {
      if (checkoutSource.sourceHash !== checkoutNative.sourceHash) reason = 'native_source_changed_during_observation';
      else if (checkoutNative.reason === null && checkoutNative.currentCheckoutProof) {
        currentCheckoutProof = checkoutNative.currentCheckoutProof;
        reason = 'native_checkout_link_found_order_missing';
      } else if (checkoutNative.reason !== 'native_order_present_or_ambiguous') reason = checkoutNative.reason ?? 'native_checkout_source_unqualified';
    }
    if(validPi(observedId)&&await (await import('./orphanCaptureRefund')).orphanCaptureBlocksPayment(tx,observedId))reason='orphan_capture_original_refund_reserved';
    const settled = reason === null;
    tx.update(ref, { 'payload.currentProviderProof': currentProviderProof,
      'payload.providerLookupState': providerLookupState, 'payload.providerLookupError': providerLookupError,
      'payload.currentOrderProof': native?.currentOrderProof ?? null,
      'payload.currentCheckoutProof': currentCheckoutProof,
      'payload.paymentCommitted': settled, 'payload.qualified': settled,
      'payload.reason': reason ?? 'purchase_payment_committed',
      'payload.resolvedSignedEvidenceHash': settled ? proofHash(current.payload.lastSignedEvidence ?? current.payload.signedEvidence) : null,
      actionRequired: !settled, status: settled ? 'resolved' : 'pending',
      resolution: settled ? 'purchase_payment_committed' : null,
      resolvedAt: settled ? FieldValue.serverTimestamp() : null,
      lastProofCheckedBy: inspectedBy, lastProofCheckedAt: FieldValue.serverTimestamp() });
    return {signedEvidence: current.payload.signedEvidence, settled, reason: reason ?? 'purchase_payment_committed',
      currentOrderProof: native?.currentOrderProof ?? null, currentCheckoutProof};
  });
  return { operationId, status: result.settled ? 'resolved' : 'pending', actionRequired: !result.settled,
    resolution: result.settled ? 'purchase_payment_committed' : null, paymentCommitted: result.settled, qualified: result.settled,
    reason: result.reason, currentOrderProof: result.currentOrderProof, currentCheckoutProof: result.currentCheckoutProof,
    automaticRefundAllowed: false, automaticCaptureAllowed: false, automaticCardRefundAllowed: false, paymentPermissionGranted: false,
    message: result.settled ? 'Le paiement de cette commande était déjà enregistré. Le dossier de capture est rapproché ; aucun nouveau mouvement n’a été exécuté.' :
      result.currentCheckoutProof ? 'L’intention de paiement et le devis acceptés sont reliés à cette capture, mais la commande est absente. Le dossier reste ouvert ; aucune commande ni aucun règlement n’a été recréé.' :
        'Rapprocher cette capture auprès du prestataire et de la commande correspondante. Le règlement reste non qualifié.',
    signedEvidence: result.signedEvidence, currentProviderProof, providerLookupState };
}
