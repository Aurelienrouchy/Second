/** Provider evidence, not a status/identifier shortcut to fulfillment. */
export const nonnegativeCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const nativeTime = (v: any): boolean => v instanceof Date ? Number.isFinite(v.getTime()) :
  typeof v?.toMillis === 'function' && Number.isFinite(v.toMillis());
export type IntentEvidence = { state: 'unconfirmed' | 'action' | 'confirmation' | 'processing' | 'succeeded' | 'authorized' | 'canceled';
  id: string; status: string; amountCents: number; receivedCents: number; capturableCents: number; method: 'manual' | 'automatic' };
export function stripeIntentEvidence(pi: any, expected: { id?: string; orderId: string; buyerId: string; sellerId: string;
  cardCents: number; walletCents: number; intentId?: string }): IntentEvidence | null {
  if (!pi || typeof pi.id !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(pi.id) || (expected.id && pi.id !== expected.id) ||
    !nonnegativeCents(pi.amount) || pi.amount !== expected.cardCents || !nonnegativeCents(pi.amount_received) ||
    !nonnegativeCents(pi.amount_capturable) || pi.amount_received > pi.amount || pi.amount_capturable > pi.amount ||
    typeof pi.currency !== 'string' || pi.currency.toLowerCase() !== 'cad' ||
    !['manual','automatic'].includes(pi.confirmation_method) || pi.metadata?.transactionId !== expected.orderId ||
    pi.metadata?.buyerId !== expected.buyerId || pi.metadata?.sellerId !== expected.sellerId ||
    (expected.walletCents > 0 && (pi.metadata?.walletAmountUsed !== String(expected.walletCents) ||
      !['wallet_and_card','mixed'].includes(pi.metadata?.paymentType))) ||
    (expected.walletCents === 0 && ((pi.metadata?.walletAmountUsed != null && pi.metadata.walletAmountUsed !== '0') || ['mixed','wallet_and_card'].includes(pi.metadata?.paymentType))) ||
    pi.transfer_data != null || (pi.application_fee_amount != null && pi.application_fee_amount !== 0) ||
    (expected.intentId && (pi.metadata?.checkoutIntentId !== expected.intentId || pi.confirmation_method !== 'manual'))) return null;
  const states: Record<string, IntentEvidence['state']> = { requires_payment_method:'unconfirmed', requires_action:'action',
    requires_confirmation:'confirmation', processing:'processing', succeeded:'succeeded', requires_capture:'authorized', canceled:'canceled' };
  const state = states[pi.status]; if (!state) return null;
  if (state === 'succeeded' && (pi.amount_received !== pi.amount || pi.amount_capturable !== 0)) return null;
  if (['unconfirmed','action','confirmation','canceled'].includes(state) && (pi.amount_received !== 0 || pi.amount_capturable !== 0)) return null;
  return { state, id: pi.id, status: pi.status, amountCents: pi.amount, receivedCents: pi.amount_received,
    capturableCents: pi.amount_capturable, method: pi.confirmation_method };
}
export function exactMixedDebit(order: any, rows: { id: string; data: any }[], amount: number, expectedLedgerId?: string): boolean {
  if (!nonnegativeCents(amount) || amount === 0 || order.walletAmountUsed !== amount ||
    !['wallet_and_card','mixed'].includes(order.paidVia) || rows.length !== 1) return false;
  const r = rows[0], d = r.data;
  return (!expectedLedgerId || r.id === expectedLedgerId) && d.type === 'purchase_debit' && d.amount === amount &&
    nonnegativeCents(d.balanceAfter) && nativeTime(d.createdAt) &&
    (d.currency == null || (typeof d.currency === 'string' && d.currency.toUpperCase() === 'CAD'));
}
/** A prepared PI/secret alone is not a confirmation attempt. Detection of an
 * unresolved card-only confirm requires its actual native authorization. This
 * predicate neither proves no earlier effect nor permits another confirmation. */
export function nativeUnknownStripeConfirmation(id: string, order: any, intent: any, pi: any): boolean {
  const total = typeof order?.totalAmount === 'number' ? Math.round(order.totalAmount * 100) : NaN;
  const wallet = order?.walletAmountUsed ?? 0;
  const created = nativeTime(intent?.createdAt) ? intent.createdAt instanceof Date ? intent.createdAt.getTime() : intent.createdAt.toMillis() : NaN;
  const authorized = nativeTime(intent?.authorizedAt) ? intent.authorizedAt instanceof Date ? intent.authorizedAt.getTime() : intent.authorizedAt.toMillis() : NaN;
  if (order?.status !== 'pending_payment' || order.currency !== 'CAD' || !nonnegativeCents(total) || total < 1 ||
      Math.abs(order.totalAmount * 100 - total) > 0.0000001 || !nonnegativeCents(wallet) || wallet >= total ||
      typeof order.buyerId !== 'string' || typeof order.sellerId !== 'string' || order.buyerId === order.sellerId ||
      !intent || intent.schemaVersion !== 1 || intent.protocol !== 'server_manual_v1' || intent.transactionId !== id ||
      intent.ownerId !== order.buyerId || intent.sellerId !== order.sellerId || typeof intent.intentId !== 'string' || !intent.intentId || intent.intentId.length > 200 ||
      intent.paymentIntentId !== order.stripePaymentIntentId || !Number.isSafeInteger(intent.version) || intent.version < 3 || intent.version >= Number.MAX_SAFE_INTEGER ||
      !(intent.state === 'confirming' || intent.state === 'unknown' && intent.unknownOperation === 'confirm') ||
      typeof intent.confirmAttemptId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(intent.confirmAttemptId) ||
      !Number.isFinite(created) || created <= 0 || !Number.isFinite(authorized) || authorized < created || authorized > Date.now() ||
      intent.totalCents !== total || intent.walletCents !== wallet || intent.cardCents !== total - wallet || intent.cardCents < 50 || intent.currency !== 'CAD' ||
      intent.quoteId !== order.shippingQuoteId || intent.rateId !== order.shipEngineRateId ||
      typeof intent.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(intent.sourceHash) || intent.authorizedSourceHash !== intent.sourceHash ||
      !Number.isSafeInteger(intent.sourceRevision) || intent.sourceRevision < 0 || !Number.isSafeInteger(intent.authorizedObservationRevision) || intent.authorizedObservationRevision < 0) return false;
  const proof = stripeIntentEvidence(pi, {id: order.stripePaymentIntentId, orderId: id, buyerId: order.buyerId, sellerId: order.sellerId,
    cardCents: total - wallet, walletCents: wallet, intentId: intent.intentId});
  return !!proof && ['unconfirmed', 'confirmation'].includes(proof.state);
}
