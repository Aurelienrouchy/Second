/** Shared GET-only provider qualification; callers supply server-native signed evidence. */
import {getStripe} from '../config/stripe';
import type {FraudEvent, FraudSignal, FraudPayment} from './fraudReview';
export const fraudIdentifier = (v: unknown, prefix: string): v is string => typeof v === 'string' && v.length <= 200 &&
  new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(v);
const ref = (v: any, prefix: string, object: string): string | null => fraudIdentifier(v, prefix) ? v :
  v?.object === object && fraudIdentifier(v.id, prefix) ? v.id : null;
const text = (v: unknown): string | null => typeof v === 'string' && v.length <= 200 ? v : null;
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const unixMillis = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 &&
  Number.isSafeInteger(v * 1000) && v * 1000 <= Date.now() ? v * 1000 : null;
const FRAUD_TYPES = new Set(['card_never_received', 'fraudulent_card_application', 'made_with_counterfeit_card',
  'made_with_lost_card', 'made_with_stolen_card', 'misc', 'unauthorized_use_of_card']);
const REVIEW_REASONS = new Set(['rule', 'manual', 'approved', 'refunded', 'refunded_as_fraud', 'disputed',
  'redacted', 'canceled', 'payment_never_settled', 'acknowledged']);
export function normalizeFraudSignal(raw: any, family: FraudSignal['family']): FraudSignal {
  return {family, id: fraudIdentifier(raw?.id, family === 'review' ? 'prv' : 'issfr') ? raw.id : null,
    livemode: typeof raw?.livemode === 'boolean' ? raw.livemode : null,
    chargeId: ref(raw?.charge, 'ch', 'charge'), paymentIntentId: ref(raw?.payment_intent, 'pi', 'payment_intent'),
    createdAtMs: unixMillis(raw?.created), actionable: family === 'early_fraud_warning' && typeof raw?.actionable === 'boolean' ? raw.actionable : null,
    open: family === 'review' && typeof raw?.open === 'boolean' ? raw.open : null,
    reason: family === 'review' ? REVIEW_REASONS.has(raw?.reason) ? raw.reason : null : FRAUD_TYPES.has(raw?.fraud_type) ? raw.fraud_type : null,
    closedReason: family === 'review' && REVIEW_REASONS.has(raw?.closed_reason) ? raw.closed_reason : null};
}
export function fraudObjectIdentity(raw: any, family: FraudSignal['family']) {
  return raw?.object === (family === 'review' ? 'review' : 'radar.early_fraud_warning') &&
    fraudIdentifier(raw.id, family === 'review' ? 'prv' : 'issfr') &&
    (raw.charge == null || ref(raw.charge, 'ch', 'charge') !== null) &&
    (raw.payment_intent == null || ref(raw.payment_intent, 'pi', 'payment_intent') !== null);
}
function configuredMode(): boolean | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key && /^(?:sk|rk)_live_/.test(key) ? true : key && /^(?:sk|rk)_test_/.test(key) ? false : null;
}
function paymentEvidence(pi: any, charge: any, mode: boolean): FraudPayment | null {
  if (pi?.object !== 'payment_intent' || !fraudIdentifier(pi.id, 'pi') || charge?.object !== 'charge' || !fraudIdentifier(charge.id, 'ch') ||
      ref(charge.payment_intent, 'pi', 'payment_intent') !== pi.id || ref(pi.latest_charge, 'ch', 'charge') !== charge.id ||
      pi.livemode !== mode || charge.livemode !== mode || pi.currency !== 'cad' || charge.currency !== 'cad' ||
      !cents(pi.amount) || pi.amount <= 0 || charge.amount !== pi.amount || !cents(pi.amount_received) || !cents(pi.amount_capturable) ||
      !cents(charge.amount_captured) || charge.paid !== true || charge.status !== 'succeeded' ||
      pi.transfer_data != null || pi.on_behalf_of != null || pi.application_fee_amount != null && pi.application_fee_amount !== 0 ||
      charge.transfer_data != null || charge.destination != null || charge.on_behalf_of != null || charge.application_fee != null ||
      charge.application_fee_amount != null && charge.application_fee_amount !== 0) return null;
  const captured = charge.captured === true && charge.amount_captured === pi.amount && pi.status === 'succeeded' &&
    pi.amount_received === pi.amount && pi.amount_capturable === 0;
  const authorized = charge.captured === false && charge.amount_captured === 0 && pi.status === 'requires_capture' &&
    pi.amount_received === 0 && pi.amount_capturable === pi.amount;
  if (!captured && !authorized) return null;
  return {paymentIntentId: pi.id, chargeId: charge.id, livemode: mode, currency: 'CAD', amountCents: pi.amount,
    capturedCents: charge.amount_captured, captureState: captured ? 'captured' : 'authorized',
    metadata: {transactionId: text(pi.metadata?.transactionId), buyerId: text(pi.metadata?.buyerId), sellerId: text(pi.metadata?.sellerId),
      walletCents: text(pi.metadata?.walletAmountUsed)}};
}


export async function lookupFraudSignal(event: FraudEvent, bounded = false): Promise<{
  current: FraudSignal | null; payment: FraudPayment | null; reason: string | null;
}> {
  const signed = event.signed, family = signed.family;
  if (!signed.id) return {current: null, payment: null, reason: 'signed_signal_identity_unqualified'};
  if (event.accountPresent) return {current: null, payment: null, reason: 'connected_or_unknown_account_context'};
  const requestOptions = bounded ? {timeout: 4000, maxNetworkRetries: 0} : {};
  const mode = configuredMode();
  if (mode === null || event.livemode !== mode || signed.livemode !== mode) return {current: null, payment: null, reason: 'provider_mode_unqualified'};
  const stripe = getStripe();
  if (!stripe) return {current: null, payment: null, reason: 'provider_unavailable'};
  let current: FraudSignal | null = null, payment: FraudPayment | null = null;
  let reason: string | null = null;
  try {
    const fetched: any = family === 'review' ? await stripe.reviews.retrieve(signed.id!, {}, requestOptions) : await stripe.radar.earlyFraudWarnings.retrieve(signed.id!, {}, requestOptions);
    current = normalizeFraudSignal(fetched, family);
    if (!fraudObjectIdentity(fetched, family) || current.id !== signed.id || current.livemode !== mode ||
        signed.chargeId !== null && current.chargeId !== null && signed.chargeId !== current.chargeId ||
        signed.paymentIntentId !== null && current.paymentIntentId !== null && signed.paymentIntentId !== current.paymentIntentId ||
        signed.createdAtMs !== null && current.createdAtMs !== null && signed.createdAtMs !== current.createdAtMs) {
      reason = 'current_signal_identity_unqualified';
    } else {
      let pi: any, charge: any;
      if (current.paymentIntentId && current.chargeId) {
        [pi, charge] = await Promise.all([stripe.paymentIntents.retrieve(current.paymentIntentId, {}, requestOptions), stripe.charges.retrieve(current.chargeId, {}, requestOptions)]);
      } else if (current.chargeId) {
        charge = await stripe.charges.retrieve(current.chargeId, {}, requestOptions);
        const piId = ref(charge.payment_intent, 'pi', 'payment_intent');
        if (piId) pi = await stripe.paymentIntents.retrieve(piId, {}, requestOptions);
      } else if (current.paymentIntentId) {
        pi = await stripe.paymentIntents.retrieve(current.paymentIntentId, {}, requestOptions);
        const chargeId = ref(pi.latest_charge, 'ch', 'charge');
        if (chargeId) charge = await stripe.charges.retrieve(chargeId, {}, requestOptions);
      }
      payment = paymentEvidence(pi, charge, mode);
      if (!payment) reason = 'current_payment_capture_unqualified';
      else if (current.chargeId !== null && current.chargeId !== payment.chargeId ||
          current.paymentIntentId !== null && current.paymentIntentId !== payment.paymentIntentId)
        {payment = null; reason = 'current_payment_identity_unqualified';}
    }
  } catch (_error) {
    // No raw card, client secret, IP, rule/browser data or provider exception is
    // persisted to an owner. A failed durable review propagates and yields 500.
    reason = 'provider_lookup_unavailable'; payment = null;
  }
  return {current, payment, reason};
}
