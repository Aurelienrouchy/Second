import AsyncStorage from '@/utils/environmentStorage';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { hasBankObligation, hasUnsettledRefund } from '@/utils/refundPresentation';
import type { Transaction } from '@/types/transaction';
import type { CheckoutObservation, LegacyCheckout, LegacyRetirementResult, ManualCheckout, ManualPaymentAttempt, ManualPaymentPhase } from '@/types/manualPayment';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const cents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => cents(value) && value > 0;
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const phases: ManualPaymentPhase[] = ['prepare_requested', 'prepared', 'confirmation_requested', 'authentication_requested', 'authentication_returned', 'wallet_requested', 'reconciliation_required', 'settled'];
const preparationStates = ['creating', 'prepared', 'confirming', 'unknown', 'action_required', 'requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'succeeded', 'requires_capture', 'canceled'];
const statuses = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'succeeded', 'requires_capture', 'canceled', 'unknown'];
const key = (uid: string, transactionId: string) => `manual-payment:v1:${encodeURIComponent(uid)}:${encodeURIComponent(transactionId)}`;
const active = new Set<string>();
const writes = new Map<string, Promise<unknown>>();
const unknown = () => new Error('Le résultat du paiement reste à vérifier. Relisez cette commande avant toute nouvelle demande.');

export function exactPaymentCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const rounded = Math.round(value * 100);
  return Number.isSafeInteger(rounded) && Math.abs(value * 100 - rounded) < 0.000001 ? rounded : null;
}
export function hasExistingPaymentExposure(order: Transaction): boolean {
  return order.stripePaymentIntentId != null || order.stripeCheckoutProtocol != null || order.walletCheckoutAttemptId != null ||
    order.walletCheckoutOutcome != null || order.walletPayment != null || order.paidVia != null || order.paidAt != null ||
    Object.prototype.hasOwnProperty.call(order, 'serviceFeePercent');
}
/** Each witness also blocks the server's new-intent branch if its private intent is missing. */
export function canReadExistingCheckoutWithoutCreation(order: Transaction): boolean {
  return order.stripePaymentIntentId != null || order.walletCheckoutAttemptId != null || order.walletCheckoutOutcome != null ||
    order.walletPayment != null || order.paidVia != null || order.paidAt != null || Object.prototype.hasOwnProperty.call(order, 'serviceFeePercent');
}
const nativeDate = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime());
/** Current server settlement only; provider status and an old refunded receipt are insufficient. */
export function hasConfirmedPurchasePayment(order: Transaction, uid: string, accepted?: ManualPaymentAttempt): boolean {
  const total = exactPaymentCents(order.totalAmount);
  if (order.buyerId !== uid || order.deliveryType !== 'shipping' || total === null || total <= 0 ||
      !['paid', 'label_created', 'shipped', 'delivered', 'completed'].includes(order.status) || !nativeDate(order.paidAt) ||
      hasBankObligation(order) || hasUnsettledRefund(order) || order.disputed === true || order.refund != null ||
      order.refundedAt != null || order.bankDispute != null || (order.currency != null && order.currency !== 'CAD') ||
      (accepted && (accepted.transactionId !== order.id || accepted.uid !== uid || accepted.totalCents !== total || order.currency !== 'CAD'))) return false;
  const wallet = order.walletAmountUsed ?? 0;
  if (!cents(wallet) || (accepted && accepted.walletCents !== wallet)) return false;
  if (order.paidVia === 'wallet') {
    const p = order.walletPayment;
    return wallet === total && (!accepted || accepted.mode === 'wallet') && !!p && p.schemaVersion === 1 && p.state === 'committed' &&
      p.actorUid === uid && p.amountCents === total && p.currency === 'CAD' && identity(p.ledgerId) && nativeDate(p.committedAt) &&
      typeof p.quoteId === 'string' && p.quoteId.length > 0 && typeof p.rateId === 'string' && p.rateId.length > 0 &&
      p.quoteId === order.shippingQuoteId && p.rateId === order.shipEngineRateId;
  }
  return (!accepted || accepted.mode === 'card' && order.stripeCheckoutProtocol === 'server_manual_v1') &&
    typeof order.stripeChargeId === 'string' && /^ch_[A-Za-z0-9]+$/.test(order.stripeChargeId) &&
    typeof order.stripePaymentIntentId === 'string' && /^pi_[A-Za-z0-9]+$/.test(order.stripePaymentIntentId) &&
    cents(order.capturedCardCents) && order.capturedCardCents > 0 && order.capturedCardCents + wallet === total &&
    (wallet === 0 || order.paidVia === 'mixed' || order.paidVia === 'wallet_and_card');
}
function validAttempt(value: unknown, uid: string, transactionId: string): value is ManualPaymentAttempt {
  return record(value) && value.version === 1 && value.uid === uid && value.transactionId === transactionId &&
    Object.keys(value).every(k => ['version', 'uid', 'transactionId', 'totalCents', 'walletCents', 'mode', 'phase', 'intentVersion', 'legacyRetirement'].includes(k)) &&
    positive(value.totalCents) && cents(value.walletCents) && value.walletCents <= value.totalCents &&
    ((value.mode === 'wallet' && value.walletCents === value.totalCents) || (value.mode === 'card' && value.totalCents - value.walletCents >= 50)) &&
    phases.includes(value.phase as ManualPaymentPhase) && (value.intentVersion === undefined || positive(value.intentVersion)) &&
    (value.legacyRetirement === undefined || record(value.legacyRetirement) && typeof value.legacyRetirement.paymentIntentId === 'string' &&
      Object.keys(value.legacyRetirement).every(k => ['paymentIntentId', 'retirementVersion'].includes(k)) &&
      /^pi_[A-Za-z0-9]+$/.test(value.legacyRetirement.paymentIntentId) && typeof value.legacyRetirement.retirementVersion === 'string' && /^[a-f0-9]{64}$/.test(value.legacyRetirement.retirementVersion));
}
function walletReceipt(value: Record<string, unknown>, transactionId: string): boolean {
  return value.success === true && value.transactionId === transactionId && typeof value.replay === 'boolean' &&
    value.paymentCommitted === true && value.paymentPermissionGranted === false && typeof value.currentStatus === 'string' &&
    (value.newBalance === null || cents(value.newBalance)) && typeof value.balanceSource === 'string';
}
function parseObservation(raw: unknown, order: Transaction, accepted?: ManualPaymentAttempt): CheckoutObservation {
  const total = exactPaymentCents(order.totalAmount);
  if (!record(raw) || raw.transactionId !== order.id || raw.paymentPermissionGranted !== false || 'clientSecret' in raw) throw unknown();
  const pick = (keys: string[]) => Object.fromEntries(keys.filter(k => raw[k] !== undefined).map(k => [k, raw[k]]));
  if (raw.protocol === 'wallet_receipt' && walletReceipt(raw, order.id)) return pick(['protocol', 'success', 'transactionId', 'replay',
    'paymentCommitted', 'paymentPermissionGranted', 'currentStatus', 'newBalance', 'balanceSource']) as unknown as CheckoutObservation;
  if (raw.currency !== 'CAD' || !cents(raw.walletCents) || !cents(raw.cardCents) || total === null ||
      raw.walletCents + raw.cardCents !== total || (accepted && (accepted.totalCents !== total || accepted.walletCents !== raw.walletCents))) throw unknown();
  if (raw.protocol === 'legacy') {
    if (!statuses.includes(String(raw.providerStatus)) || typeof raw.settlementPending !== 'boolean' ||
        typeof raw.legacyCardCapabilityOpen !== 'boolean' || typeof raw.retirementVersion !== 'string' || !/^[a-f0-9]{64}$/.test(raw.retirementVersion) ||
        !['awaitSettlement', 'retireLegacyCheckout'].includes(String(raw.action))) throw unknown();
    return pick(['protocol', 'transactionId', 'providerStatus', 'paymentPermissionGranted', 'settlementPending', 'legacyCardCapabilityOpen',
      'retirementVersion', 'walletCents', 'cardCents', 'currency', 'action']) as unknown as LegacyCheckout;
  }
  if (raw.protocol !== 'server_manual_v1' || !positive(raw.intentVersion) || !preparationStates.includes(String(raw.preparationState)) ||
      !statuses.includes(String(raw.providerStatus)) || raw.totalCents !== total || raw.cardCents < 50 ||
      typeof raw.confirmationRequired !== 'boolean' || typeof raw.settlementPending !== 'boolean' ||
      !['confirmOnServer', 'handleNextAction', 'refreshCheckout', 'contactSupport', 'reviewCancellation'].includes(String(raw.action)) ||
      (accepted?.intentVersion !== undefined && raw.intentVersion < accepted.intentVersion)) throw unknown();
  if (raw.confirmationRequired && (!['requires_payment_method', 'requires_confirmation'].includes(String(raw.providerStatus)) || raw.settlementPending)) throw unknown();
  if (raw.confirmationRequired && raw.action === 'confirmOnServer' &&
      !['prepared', 'requires_payment_method', 'requires_confirmation', 'requires_action'].includes(String(raw.preparationState))) throw unknown();
  if (raw.action === 'handleNextAction' && (raw.providerStatus !== 'requires_action' || raw.confirmationRequired || raw.settlementPending ||
      ['unknown', 'confirming', 'creating', 'action_required'].includes(String(raw.preparationState)) || typeof raw.actionClientSecret !== 'string' ||
      !/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(raw.actionClientSecret) || !order.stripePaymentIntentId ||
      !raw.actionClientSecret.startsWith(`${order.stripePaymentIntentId}_secret_`))) throw unknown();
  if (raw.action !== 'handleNextAction' && raw.actionClientSecret !== undefined) throw unknown();
  return pick(['protocol', 'transactionId', 'intentVersion', 'preparationState', 'providerStatus', 'totalCents', 'walletCents', 'cardCents',
    'currency', 'paymentPermissionGranted', 'confirmationRequired', 'settlementPending', 'action', 'actionClientSecret']) as unknown as ManualCheckout;
}

export class ManualPaymentService {
  static async run<T>(uid: string, transactionId: string, assertContext: () => void, operation: () => Promise<T>): Promise<T> {
    const session = captureTradeSession(uid); assertContext();
    const slot = key(uid, transactionId);
    if (active.has(slot)) throw new Error('Une opération est déjà en cours pour cette commande. Vérifiez son résultat.');
    active.add(slot);
    try { assertTradeSessionCurrent(session); return await operation(); }
    finally { active.delete(slot); }
  }
  static async readAttempt(uid: string, transactionId: string, assertContext: () => void): Promise<ManualPaymentAttempt | null> {
    const session = captureTradeSession(uid); assertContext();
    const raw = await AsyncStorage.getItem(key(uid, transactionId));
    assertTradeSessionCurrent(session); assertContext();
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!validAttempt(value, uid, transactionId)) throw unknown();
    return value;
  }
  static async remember(attempt: ManualPaymentAttempt, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(attempt.uid);
    const slot = key(attempt.uid, attempt.transactionId);
    const pending = (writes.get(slot) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertTradeSessionCurrent(session); assertContext();
      if (!validAttempt(attempt, session.uid, attempt.transactionId)) throw unknown();
      const old = await this.readAttempt(session.uid, attempt.transactionId, assertContext);
      if (old && (old.totalCents !== attempt.totalCents || old.walletCents !== attempt.walletCents || old.mode !== attempt.mode ||
          old.phase === 'settled' && attempt.phase !== 'settled' || (old.intentVersion ?? 0) > (attempt.intentVersion ?? 0) ||
          old.legacyRetirement && JSON.stringify(old.legacyRetirement) !== JSON.stringify(attempt.legacyRetirement))) throw unknown();
      await AsyncStorage.setItem(slot, JSON.stringify(attempt));
      assertTradeSessionCurrent(session); assertContext();
    });
    writes.set(slot, pending);
    try { await pending; } finally { if (writes.get(slot) === pending) writes.delete(slot); }
  }
  static async observe(uid: string, order: Transaction, accepted: ManualPaymentAttempt | undefined,
    assertContext: () => void, recoveryOnly: boolean): Promise<CheckoutObservation> {
    const session = captureTradeSession(uid); assertContext();
    if (order.buyerId !== uid || !identity(order.id) || recoveryOnly && !canReadExistingCheckoutWithoutCreation(order)) throw unknown();
    const input = { transactionId: order.id, ...(accepted?.mode === 'card' ? { walletAmount: accepted.walletCents } : {}) };
    const response = await httpsCallable<typeof input, unknown>(functions, 'createStripeCheckout')(input);
    assertTradeSessionCurrent(session); assertContext();
    return parseObservation(response.data, order, accepted);
  }
  static async confirm(uid: string, order: Transaction, accepted: ManualPaymentAttempt, observation: ManualCheckout,
    assertContext: () => void, paymentMethodId?: string): Promise<CheckoutObservation> {
    const session = captureTradeSession(uid); assertContext();
    if (order.buyerId !== uid || observation.transactionId !== order.id || observation.protocol !== 'server_manual_v1' ||
        observation.totalCents !== accepted.totalCents || observation.walletCents !== accepted.walletCents ||
        !observation.confirmationRequired || observation.action !== 'confirmOnServer' ||
        observation.providerStatus === 'requires_payment_method' && !/^pm_[A-Za-z0-9]+$/.test(paymentMethodId ?? '')) throw unknown();
    await this.remember({ ...accepted, phase: 'confirmation_requested', intentVersion: observation.intentVersion }, assertContext);
    const input = { transactionId: order.id, expectedIntentVersion: observation.intentVersion, ...(paymentMethodId ? { paymentMethodId } : {}) };
    const response = await httpsCallable<typeof input, unknown>(functions, 'confirmStripeCheckout')(input);
    assertTradeSessionCurrent(session); assertContext();
    return parseObservation(response.data, order, { ...accepted, intentVersion: observation.intentVersion });
  }
  static async retire(uid: string, order: Transaction, observation: LegacyCheckout, assertContext: () => void): Promise<LegacyRetirementResult> {
    const session = captureTradeSession(uid); assertContext();
    if (order.buyerId !== uid || !order.stripePaymentIntentId || observation.transactionId !== order.id ||
        observation.action !== 'retireLegacyCheckout' || observation.settlementPending) throw unknown();
    const attempt: ManualPaymentAttempt = { version: 1, uid, transactionId: order.id,
      totalCents: observation.cardCents + observation.walletCents, walletCents: observation.walletCents,
      mode: 'card', phase: 'reconciliation_required', legacyRetirement: {
        paymentIntentId: order.stripePaymentIntentId, retirementVersion: observation.retirementVersion,
      } };
    await this.remember(attempt, assertContext);
    const response = await httpsCallable<{
      transactionId: string; expectedPaymentIntentId: string; expectedRetirementVersion: string;
    }, LegacyRetirementResult>(functions, 'retireLegacyStripeCheckout')({ transactionId: order.id,
      expectedPaymentIntentId: attempt.legacyRetirement!.paymentIntentId, expectedRetirementVersion: attempt.legacyRetirement!.retirementVersion });
    assertTradeSessionCurrent(session); assertContext();
    const r = response.data;
    if (r?.protocol !== 'legacy_retirement_v1' || r.transactionId !== order.id || r.providerStatus !== 'canceled' ||
        r.paymentPermissionGranted !== false || r.cardCapabilityNeutralized !== true || typeof r.walletObligationOpen !== 'boolean' ||
        r.walletCents !== observation.walletCents || typeof r.replay !== 'boolean' || !['contactSupport', 'requestNewQuote'].includes(r.action)) throw unknown();
    return r;
  }
}
