import {orphanCaptureBlocksPayment} from '../../utils/orphanCaptureRefund';
/**
 * Webhook Stripe — Rejeu d'un PaymentIntent.succeeded perdu (F77).
 *
 * Éclaté depuis functions/src/http/webhooks.ts (2972 lignes). Le dispatcher
 * et la vérification de signature restent dans webhooks.ts.
 */
import * as logger from 'firebase-functions/logger';
import { getStripe } from '../../config/stripe';
import { handlePaymentIntentSucceeded } from './payment';
import { handleShopTierSucceeded } from './shopTier';
import { handleSwapTopUpSucceeded } from './swapTopUp';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../config/firebase';
import { readCommittedCheckoutCapture } from '../../utils/paymentCheckoutReconciliation';
import { qualifiedShopTierOperation, qualifiedShopTierSettlement, shopTierPaymentMatches } from '../../callable/shopTier';
import { qualifyManualSwapTopUpSettlement } from '../../utils/swapTopUpCheckout';
import { swapTopUpIntentEvidence } from '../../utils/swapTopUpCheckoutProof';
import { stripeIntentEvidence } from '../../utils/stripeCheckoutProof';
import { FinancialRecoveryBlocked } from '../../utils/financialRecoveryInterlock';

const reference = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200 && !v.includes('/');
const nativeTime = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const objectId = (v: any) => typeof v === 'string' ? v : v?.id;

/** A completed handler may have only recorded a conflict, or simply declined
 * an invalid locator. Its void return never settles this older queue entry.
 * Recognize the original native money receipt, independently of later order,
 * Troc, shop, refund or review states; do not change those later obligations. */
async function nativeSettlementRecorded(pi: any, charge: any): Promise<boolean> {
  return db.runTransaction(async tx => {
    if(await orphanCaptureBlocksPayment(tx,pi.id))return false;
    if (pi.metadata?.type === 'shop_tier') {
      const id = pi.metadata.secondAccountOperationId;
      if (typeof id !== 'string' || !/^forfait_[a-f0-9]{64}$/.test(id)) return false;
      const operation = (await tx.get(db.collection('eligibility_audit').doc(id))).data();
      const ledger = (await tx.get(db.collection('platform_ledger').doc(`shop_tier_revenue_${pi.id}`))).data();
      return qualifiedShopTierOperation(operation,id) && shopTierPaymentMatches(pi,operation,id,true) &&
        qualifiedShopTierSettlement(operation,id,ledger) && ledger?.chargeId === charge.id;
    }
    if (pi.metadata?.type === 'swap_topup') {
      const id = pi.metadata.swapId;
      if (!reference(id)) return false;
      const ref = db.collection('swaps').doc(id), swap = (await tx.get(ref)).data();
      if (!swap || swap.status === 'payment_pending' || !nativeTime(swap.topUpPaidAt) ||
          swap.topUpPaymentIntentId !== pi.id || objectId(swap.topUpChargeId) !== charge.id ||
          !reference(swap.initiatorId) || !reference(swap.receiverId) || swap.initiatorId === swap.receiverId ||
          ![swap.initiatorId,swap.receiverId].includes(swap.cashTopUp?.payerId)) return false;
      const payerId = swap.cashTopUp.payerId, payeeId = payerId === swap.initiatorId ? swap.receiverId : swap.initiatorId;
      const intent = (await tx.get(ref.collection('topup_checkout').doc('current'))).data();
      const manual = !!intent || swap.topUpCheckoutProtocol === 'swap_server_manual_v1' || pi.metadata.swapCheckoutIntentId != null;
      if (manual && !await qualifyManualSwapTopUpSettlement(tx,id,swap,pi)) return false;
      const evidence = swapTopUpIntentEvidence(pi,{swapId:id,payerId,payeeId,paymentIntentId:pi.id,
        baseCents:swap.cashTopUp.amount,serviceFeeCents:swap.topUpFee ?? 0,taxCents:swap.topUpTax ?? 0,
        totalCents:swap.cashTopUp.amount + (swap.topUpFee ?? 0) + (swap.topUpTax ?? 0),currency:'CAD',
        ...(manual ? {intentId:intent?.intentId} : {})});
      if (evidence?.state !== 'succeeded') return false;
      const rows = await tx.get(db.collection('wallets').doc(payeeId).collection('ledger').where('swapId','==',id).limit(101));
      const credits = rows.docs.filter(row => row.data().type === 'sale_credit');
      const credit = credits[0]?.data();
      return rows.size < 101 && credits.length === 1 && credit?.swapId === id && credit.paymentIntentId === pi.id &&
        credit.currency === 'CAD' && credit.amount === swap.cashTopUp.amount && nativeTime(credit.createdAt) &&
        credit.createdAt.isEqual(swap.topUpPaidAt);
    }
    const committed = await readCommittedCheckoutCapture(tx,pi.id,pi,charge);
    if (committed.reason === null) return true;
    // Completed/returned/refunded purchases retain their original policy and
    // ledger basis. The canonical allocation reader qualifies that history
    // without manufacturing a fresh paid status or erasing a later refund.
    const orders = await tx.get(db.collection('transactions').where('stripePaymentIntentId','==',pi.id).limit(2));
    if (orders.size !== 1) return false;
    const snap = orders.docs[0], order = snap.data();
    if (order.stripeChargeId !== charge.id || !nativeTime(order.paidAt) || order.capturedCardCents !== pi.amount_received) return false;
    try {
      const {readRefundAllocationSource} = await import('../../utils/refundAllocation');
      const source = await readRefundAllocationSource(tx,snap.id,order);
      return source.basis.payment.kind === 'stripe_payment_intent' && source.basis.payment.referenceId === pi.id &&
        source.cardCents === pi.amount_received && source.totalCents === source.cardCents + source.walletCents &&
        stripeIntentEvidence(pi,{id:pi.id,orderId:snap.id,buyerId:order.buyerId,sellerId:order.sellerId,
          cardCents:source.cardCents,walletCents:source.walletCents,
          ...(committed.currentOrderProof?.intentId ? {intentId:committed.currentOrderProof.intentId} : {})})?.state === 'succeeded';
    } catch (error) {if (error instanceof FinancialRecoveryBlocked) throw error; return false;}
  });
}

/**
 * F77: re-drive a LOST payment_intent.succeeded from a dead-letter replay.
 * retryFailedOperations calls this when a `lost_pi_succeeded_webhook` op is
 * eligible: it retrieves the live PI from Stripe and replays the canonical
 * handler, which is idempotent (status guards + deterministic keys). Routes
 * swap top-up / shop tier PIs to their own handlers based on metadata.type so a
 * lost top-up/forfait succeeded is also recoverable.
 *
 * @returns true only for a qualified original native settlement. Unknown
 * provider/local proof or an unqualified handoff leaves this queue unresolved.
 */

export async function redrivePaymentIntentSucceeded(paymentIntentId: string): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return false;
  let pi: any;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (err) {
    if (err instanceof FinancialRecoveryBlocked) throw err;
    logger.warn('[redrivePaymentIntentSucceeded] PI retrieve failed', {
      paymentIntentId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
  if (pi.id !== paymentIntentId || pi.object !== 'payment_intent' || pi.status !== 'succeeded') {
    // Not actually paid (yet) — nothing to re-drive. Keep the dead-letter pending.
    logger.info('[redrivePaymentIntentSucceeded] PI not succeeded — skipping', {
      paymentIntentId,
      status: pi.status,
    });
    return false;
  }
  const piType = pi.metadata?.type;
  if (piType === 'swap_topup') {
    await handleSwapTopUpSucceeded(pi);
  } else if (piType === 'shop_tier') {
    await handleShopTierSucceeded(pi);
  } else {
    await handlePaymentIntentSucceeded(pi, {source: 'platform_get', accountId: null, stripeContext: null});
  }
  try {
    const chargeId = objectId(pi.latest_charge);
    if (typeof chargeId !== 'string' || !/^ch_[A-Za-z0-9_]+$/.test(chargeId) || pi.currency !== 'cad' ||
        typeof pi.livemode !== 'boolean' || !Number.isSafeInteger(pi.amount_received) || pi.amount_received <= 0 ||
        pi.transfer_data != null || pi.on_behalf_of != null || pi.application_fee_amount != null && pi.application_fee_amount !== 0) return false;
    const charge: any = await stripe.charges.retrieve(chargeId);
    if (charge.object !== 'charge' || charge.id !== chargeId || objectId(charge.payment_intent) !== pi.id ||
        charge.currency !== 'cad' || charge.livemode !== pi.livemode || charge.status !== 'succeeded' || charge.paid !== true ||
        charge.captured !== true || charge.amount !== pi.amount_received || charge.amount_captured !== pi.amount_received ||
        !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > charge.amount_captured ||
        typeof charge.refunded !== 'boolean' || charge.refunded !== (charge.amount_refunded === charge.amount_captured) ||
        typeof charge.disputed !== 'boolean' || charge.transfer_data != null || charge.destination != null || charge.transfer != null ||
        charge.application_fee != null || charge.application_fee_amount != null && charge.application_fee_amount !== 0 || charge.on_behalf_of != null) return false;
    return await nativeSettlementRecorded(pi,charge);
  } catch (error) {
    if (error instanceof FinancialRecoveryBlocked) throw error;
    logger.warn('[redrivePaymentIntentSucceeded] native settlement remains unqualified', {
      paymentIntentId,error:error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// =============================================================================
// HANDLER: payment_intent.succeeded (metadata.type === 'swap_topup')
// =============================================================================

/**
 * Confirm a swap cash top-up payment.
 *
 * Calqued on handlePaymentIntentSucceeded for purchases:
 *  1. Idempotence: only advance a swap still in 'payment_pending'.
 *  2. Verify the amount matches the stored topUpFee + base top-up amount.
 *  3. Transition swap 'payment_pending' → 'accepted' (exchange mode flow next).
 *  4. Credit the payee wallet pendingBalance (escrow) with the base top-up
 *     amount (the platform keeps the fee, mirroring 0% seller commission).
 *     Funds are released to `balance` at confirmSwapReception.
 *
 * The top-up `amount` in metadata is in CENTS (base amount, fee excluded).
 */
