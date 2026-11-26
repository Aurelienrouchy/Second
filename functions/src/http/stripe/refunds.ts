import { FinancialRecoveryBlocked } from "../../utils/financialRecoveryInterlock";
import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
/** Purchase refund events consume current provider truth and the durable intent. */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../../config/firebase';
import { getStripe } from '../../config/stripe';
import { observePurchaseRefund } from '../../utils/refund';
import { qualifiedRefundNoticeSource } from '../../utils/refundState';
import { handleSwapTopUpRefund } from './swapTopUp';

function idOf(value: any): string | null { return typeof value === 'string' ? value : typeof value?.id === 'string' ? value.id : null; }
type PurchaseLookup = { kind: 'found'; doc: FirebaseFirestore.QueryDocumentSnapshot } | { kind: 'absent' } | { kind: 'ambiguous' };
/** Search the entire native refund-ID source, not the first two PI candidates.
 * Metadata is never an attribution credential. Current provider evidence is
 * still retrieved by observePurchaseRefund before any financial transition. */
async function nativePurchase(pi: string, refund: any): Promise<PurchaseLookup> {
  const refundId = idOf(refund?.id);
  if (!refundId || !/^re_[A-Za-z0-9_]{1,190}$/.test(refundId)) return { kind: 'absent' };
  const snap = await db.collection('transactions').where('refund.stripeRefundId', '==', refundId).limit(2).get();
  if (snap.empty) return { kind: 'absent' };
  if (snap.size !== 1) return { kind: 'ambiguous' };
  const doc = snap.docs[0], data = doc.data(), intent = data.refund;
  const native = intent && qualifiedRefundNoticeSource(data, intent);
  if (!native || data.stripePaymentIntentId !== pi || intent.paymentIntentId !== pi || intent.stripeRefundId !== refundId ||
      refund.currency !== 'cad' || refund.amount !== native.cardAmountCents ||
      (idOf(refund.payment_intent) != null && idOf(refund.payment_intent) !== pi)) return { kind: 'ambiguous' };
  return { kind: 'found', doc };
}
async function purchase(pi: string, refund?: any): Promise<PurchaseLookup> {
  if (refund) {
    const native = await nativePurchase(pi, refund);
    if (native.kind !== 'absent') return native;
  }
  const snap = await db.collection('transactions').where('stripePaymentIntentId', '==', pi).limit(2).get();
  return snap.empty ? { kind: 'absent' } : snap.size === 1 ? { kind: 'found', doc: snap.docs[0] } : { kind: 'ambiguous' };
}
async function refundAlert(refId: string, refundId: string, kind: string, context: Record<string, unknown>) {
  const ref = db.collection('admin_alerts').doc(`refund_external_${refundId}_${kind}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) tx.set(ref, { kind, severity: 'critical', refId,
      message: 'Remboursement externe à rapprocher avec l’achat et le ledger avant toute réparation.',
      context, status: 'open', createdAt: FieldValue.serverTimestamp() });
  });
}

export async function handleChargeRefunded(charge: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/refunds.handleChargeRefunded"}, async () => {
  const pi = idOf(charge.payment_intent);
  if (!pi) throw new Error('Refund charge lacks PaymentIntent');
  const lookup = await purchase(pi);
  if (lookup.kind === 'ambiguous') {
    const hints = Array.isArray(charge.refunds?.data) ? charge.refunds.data : [];
    if (hints.length > 100 || !hints.length) {
      await refundAlert(pi, charge.id ?? pi, 'ambiguous_purchase_refund', { paymentIntentId: pi,
        chargeId: charge.id ?? null, nativeRefundHintState: hints.length > 100 ? 'saturated' : 'absent' });
      return;
    }
    const seen = new Set<string>();
    for (const hint of hints) {
      const refundId = idOf(hint?.id);
      if (!refundId || seen.has(refundId)) continue;
      seen.add(refundId);
      const native = await nativePurchase(pi, hint);
      if (native.kind !== 'found') {
        await refundAlert(pi, refundId, 'ambiguous_purchase_refund', { paymentIntentId: pi, refundId, nativeLink: native.kind });
        continue;
      }
      // Preserve the exactly attributed historical intention, even if other
      // orders reuse the PI. No arbitrary candidate receives an owner notice.
      await observePurchaseRefund(native.doc.id, refundId);
    }
    if (!seen.size) await refundAlert(pi, charge.id ?? pi, 'ambiguous_purchase_refund',
      { paymentIntentId: pi, chargeId: charge.id ?? null, nativeRefundHintState: 'unqualified' });
    return;
  }
  if (lookup.kind === 'absent') {
    const swaps = await db.collection('swaps').where('topUpPaymentIntentId', '==', pi).limit(2).get();
    if (swaps.size === 1) await handleSwapTopUpRefund(swaps.docs[0], pi);
    else await refundAlert(pi, charge.id ?? pi, 'unmatched_charge_refund', { chargeId: charge.id ?? null });
    return;
  }
  const doc = lookup.doc;
  const stripe = getStripe(); if (!stripe) throw new Error('Stripe client unavailable for refund verification');
  const data = doc.data();
  const ids = new Set<string>((charge.refunds?.data ?? []).map((r: any) => idOf(r.id)).filter(Boolean));
  if (data.refund?.stripeRefundId) ids.add(data.refund.stripeRefundId);
  // Charge.amount_refunded is not independent proof that a Refund settled.
  if (ids.size === 0) {
    const listed = await stripe.refunds.list({ payment_intent: pi, limit: 100 });
    if (listed.has_more) throw new Error('Refund charge needs bounded explicit reconciliation');
    for (const r of listed.data) ids.add(r.id);
  }
  if (!ids.size) throw new Error('No current provider refund found for charge event');
  for (const id of ids) {
    try { await observePurchaseRefund(doc.id, id); }
    catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      await refundAlert(doc.id, id, 'purchase_refund_reconciliation', { paymentIntentId: pi, refundId: id,
        error: error instanceof Error ? error.message : String(error) });
      // A refused partial gesture is a manual case, not a full sale refund.
      if (!(error instanceof Error && 'code' in error && error.code === 'failed-precondition')) throw error;
    }
  }

    });
  }

export async function handleRefundUpdated(refund: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/refunds.handleRefundUpdated"}, async () => {
  const pi = idOf(refund.payment_intent);
  if (!pi || typeof refund.id !== 'string') throw new Error('Refund event lacks valid identity');
  const lookup = await purchase(pi, refund);
  if (lookup.kind === 'ambiguous') {
    await refundAlert(pi, refund.id, 'ambiguous_purchase_refund', { paymentIntentId: pi, refundId: refund.id });
    return;
  }
  if (lookup.kind === 'absent') {
    const swaps = await db.collection('swaps').where('topUpPaymentIntentId', '==', pi).limit(2).get();
    if (swaps.size === 1) await handleSwapTopUpRefund(swaps.docs[0], pi, refund.id);
    else if (refund.status === 'failed' || refund.status === 'canceled') await refundAlert(pi, refund.id, 'refund_failed', { refundId: refund.id, failureReason: refund.failure_reason ?? null });
    else logger.info('Refund event has no purchase', { paymentIntentId: pi, refundId: refund.id });
    return;
  }
  const doc = lookup.doc;
  try { await observePurchaseRefund(doc.id, refund.id); }
  catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    if (!(error instanceof Error && 'code' in error && error.code === 'failed-precondition')) throw error;
    await refundAlert(doc.id, refund.id, 'purchase_refund_reconciliation', { paymentIntentId: pi, refundId: refund.id, error: error.message });
  }

    });
  }
export const handleRefundFailed = handleRefundUpdated;
export const handleRefundCreated = handleRefundUpdated;

export function mapRefundReason(refundReason: unknown): string {
  const r = typeof refundReason === 'string' ? refundReason.toLowerCase() : '';
  if (r.includes('return')) return 'return';
  if (r.includes('seller') || r.includes('cancel')) return 'seller_cancel';
  if (r.includes('delivery_fail') || r.includes('delivery fail')) return 'delivery_failed';
  if (r.includes('lost') || r.includes('not_received') || r.includes('not received')) return 'lost';
  return 'dispute';
}
