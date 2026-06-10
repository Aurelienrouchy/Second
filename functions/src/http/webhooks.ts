/**
 * HTTP webhook handlers
 * Firebase Functions v7 - using onRequest
 *
 * Stripe webhook: payment confirmation + ShipEngine label creation
 * Stripe Connect account status updates
 *
 * CRITICAL: All Firestore mutations (transaction status, article sold,
 * seller wallet credit) are wrapped in a single runTransaction for
 * atomicity. The idempotence check is INSIDE the transaction to prevent
 * race conditions from concurrent webhook replays.
 *
 * ShipEngine label creation (external network call) runs AFTER the
 * transaction — it is not atomic but can be safely retried/recreated
 * manually without financial inconsistency.
 */
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { Timestamp } from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import { getShipEngine } from '../config/shipEngine';
import { getStripe } from '../config/stripe';
import { sendPushNotification } from '../utils/notifications';
import { getOrCreateSellerWallet } from '../callable/wallet';
import {
  creditSellerForSale,
  recordTransactionRevenue,
  createLabelIdempotent,
} from '../utils/labelFulfillment';
import { writeFailedOperation, writeAdminAlert } from '../utils/failedOperations';
import { issueTransactionRefund } from '../utils/refund';
import { revertFailedPayout } from '../utils/payoutRecovery';
import { deriveStripeAccountState, stripeAccountFirestoreFields } from '../utils/stripeAccount';
import { shopTierPriceCents, type PaidShopTier } from '../callable/shopTier';

/**
 * F107: TTL for `stripe_events` dedup markers. 90 days is far beyond Stripe's
 * ~3-day retry window, so purging older markers never weakens idempotence. A
 * Firestore TTL policy must be created on the `expiresAt` field (console/gcloud).
 */
const STRIPE_EVENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// =============================================================================
// STRIPE WEBHOOK — Payment confirmed + Account updates
// =============================================================================

/**
 * Stripe calls this endpoint for payment and account events.
 *
 * Handled events:
 * - payment_intent.succeeded: Mark transaction paid, credit seller, create label
 * - payment_intent.payment_failed: Cancel transaction, release article
 * - charge.dispute.created: Mark transaction disputed
 * - charge.refunded: Mark transaction refunded, decrement seller balance
 * - account.updated: Update seller's Connect account status in Firestore
 *
 * Flow for payment_intent.succeeded:
 * 1. Verify webhook signature (Stripe constructEvent)
 * 2. Atomic transaction: idempotence check + mark paid + mark sold + credit seller
 * 3. Create shipping label via ShipEngine (non-atomic, retry-safe)
 * 4. Send system message with tracking info
 */
export const stripeWebhook = onRequest(
  {
    region: 'northamerica-northeast1',
    cors: false,
    memory: '512MiB',
    // F100: TWO Stripe endpoints point at this URL — the PLATFORM endpoint
    // (payment_intent.*, charge.*) signed with STRIPE_WEBHOOK_SECRET and the
    // CONNECT endpoint (payout.*, account.updated, connected-account disputes)
    // signed with STRIPE_CONNECT_WEBHOOK_SECRET. Each Stripe endpoint has its own
    // signing secret; we try both below. Both must be registered in the Stripe
    // dashboard against this same URL (see firestore-schema.md).
    secrets: [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'STRIPE_CONNECT_WEBHOOK_SECRET',
      'SHIPENGINE_API_KEY',
    ],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const stripe = getStripe();
    if (!stripe) {
      logger.error('Stripe webhook: Stripe not configured');
      res.status(500).send('Stripe not configured');
      return;
    }

    // =========================================================================
    // SIGNATURE VERIFICATION
    // =========================================================================

    const sig = req.headers['stripe-signature'] as string | undefined;
    // F100: two Stripe endpoints (platform + Connect) share this URL, each with
    // its own signing secret. Try every configured secret; the event is valid as
    // soon as ONE constructEvent succeeds, and only rejected (401) when NONE do.
    const candidateSecrets = [
      process.env.STRIPE_WEBHOOK_SECRET,
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    ].filter((s): s is string => typeof s === 'string' && s.length > 0);

    let event;

    if (candidateSecrets.length > 0 && sig) {
      // Production path: verify signature against each configured endpoint secret.
      let lastError: unknown = null;
      for (const secret of candidateSecrets) {
        try {
          event = stripe.webhooks.constructEvent((req as any).rawBody, sig, secret);
          lastError = null;
          break;
        } catch (err: unknown) {
          lastError = err;
        }
      }
      if (!event) {
        const message = lastError instanceof Error ? lastError.message : 'Unknown error';
        logger.error('Stripe webhook: signature verification failed (all secrets)', {
          error: message,
          secretsTried: candidateSecrets.length,
        });
        res.status(401).send(`Webhook signature verification failed: ${message}`);
        return;
      }
    } else if (candidateSecrets.length === 0) {
      logger.error(
        'Stripe webhook: no webhook secret configured (STRIPE_WEBHOOK_SECRET / STRIPE_CONNECT_WEBHOOK_SECRET) — rejecting request'
      );
      res.status(500).send('Webhook secret not configured');
      return;
    } else {
      logger.error('Stripe webhook: missing stripe-signature header');
      res.status(401).send('Missing stripe-signature header');
      return;
    }

    try {
      const eventType = event.type;

      // =======================================================================
      // UNIVERSAL IDEMPOTENCE — dedup by Stripe event.id (marker AFTER success)
      // =======================================================================
      // Stripe may deliver the same event multiple times (retries on a slow
      // ACK, at-least-once delivery). We dedup with a stripe_events/{event.id}
      // marker, but the marker is written ONLY AFTER the handler succeeds (F3):
      // committing it up-front meant a handler that threw left the marker behind,
      // so Stripe's retry saw "already handled" and the event was lost forever
      // (dispute.closed, payout.failed never replayed). Now a thrown handler
      // returns 500 with NO marker, so Stripe re-delivers and the event is
      // retried. Per-handler status guards make a re-run safe (defense-in-depth)
      // and absorb the small window where a concurrent duplicate slips through
      // before the marker is written.
      const eventMarkerRef = db.collection('stripe_events').doc(event.id);
      const markerSnap = await eventMarkerRef.get();
      if (markerSnap.exists) {
        logger.info('Stripe webhook: duplicate event ignored', {
          eventId: event.id,
          eventType,
        });
        res.json({ received: true });
        return;
      }

      // =======================================================================
      // PAYMENT_INTENT.SUCCEEDED
      // =======================================================================

      if (eventType === 'payment_intent.succeeded') {
        // Swap cash top-up payments are tagged with metadata.type === 'swap_topup'
        // and handled separately (advance swap + credit payee wallet pending).
        // Shop tier forfait payments are tagged metadata.type === 'shop_tier'
        // (F134) — they grant a paid tier on the shop after payment succeeds.
        const piType = event.data.object?.metadata?.type;
        if (piType === 'swap_topup') {
          await handleSwapTopUpSucceeded(event.data.object);
        } else if (piType === 'shop_tier') {
          await handleShopTierSucceeded(event.data.object);
        } else {
          await handlePaymentIntentSucceeded(event.data.object);
        }
      }

      // =======================================================================
      // PAYMENT_INTENT.PAYMENT_FAILED
      // =======================================================================

      else if (eventType === 'payment_intent.payment_failed') {
        await handlePaymentIntentFailed(event.data.object);
      }

      // =======================================================================
      // CHARGE.DISPUTE.CREATED — Buyer opened a dispute
      // =======================================================================

      else if (eventType === 'charge.dispute.created') {
        await handleDisputeCreated(event.data.object);
      }

      // =======================================================================
      // CHARGE.DISPUTE.CLOSED — Dispute resolved (won / lost)
      // =======================================================================

      else if (eventType === 'charge.dispute.closed') {
        await handleDisputeClosed(event.data.object);
      }

      // =======================================================================
      // PAYOUT.FAILED / PAYOUT.PAID — Withdrawal payout lifecycle
      // =======================================================================

      else if (eventType === 'payout.failed') {
        await handlePayoutFailed(event.data.object);
      }

      else if (eventType === 'payout.paid') {
        await handlePayoutPaid(event.data.object);
      }

      // =======================================================================
      // PAYOUT.CANCELED — treated like payout.failed (F42)
      // =======================================================================
      // A canceled payout never reaches the bank: the wallet was already debited
      // at walletWithdraw time, so re-credit it AND reverse the transfer, exactly
      // like a failure. revertFailedPayout is idempotent via the request status.

      else if (eventType === 'payout.canceled') {
        await handlePayoutCanceled(event.data.object);
      }

      // =======================================================================
      // CHARGE.REFUNDED — Full or partial refund processed
      // =======================================================================

      else if (eventType === 'charge.refunded') {
        await handleChargeRefunded(event.data.object);
      }

      // =======================================================================
      // REFUND.FAILED / REFUND.UPDATED — a refund did NOT settle (F104)
      // =======================================================================
      // We optimistically mark transactions 'refunded' when we CREATE a refund.
      // If Stripe later reports the refund failed (e.g. the original card can no
      // longer be credited), leaving the tx 'refunded' is wrong — the buyer was
      // never actually reimbursed. We cannot auto-fix this (it needs an alternate
      // refund channel), so raise a CRITICAL admin alert. ACK 200 (informational —
      // a 400 would make Stripe retry forever).

      else if (eventType === 'refund.failed') {
        await handleRefundFailed(event.data.object);
      } else if (eventType === 'refund.updated') {
        await handleRefundUpdated(event.data.object);
      }

      // =======================================================================
      // CHARGE.DISPUTE.FUNDS_WITHDRAWN / FUNDS_REINSTATED — chargeback cash flow
      // =======================================================================
      // Informational mirrors of the dispute lifecycle (Stripe debiting/recrediting
      // the platform balance). The authoritative seller debit / hold release lives
      // in dispute.created / dispute.closed; here we only log + ACK so the events
      // never retry in a loop (F106).

      else if (
        eventType === 'charge.dispute.funds_withdrawn' ||
        eventType === 'charge.dispute.funds_reinstated'
      ) {
        logger.info('Stripe webhook: dispute funds flow (informational)', {
          eventType,
          disputeId: event.data.object?.id,
          amount: event.data.object?.amount,
        });
      }

      // =======================================================================
      // TRANSFER.REVERSED — a platform->connected transfer was reversed (F106)
      // =======================================================================
      // Our own reversals (rev_${transferId}) are deliberate (failed payout); this
      // is the confirmation. Log for the audit trail + ACK so it never retries.

      else if (eventType === 'transfer.reversed') {
        logger.info('Stripe webhook: transfer reversed (informational)', {
          transferId: event.data.object?.id,
          amountReversed: event.data.object?.amount_reversed,
        });
      }

      // =======================================================================
      // ACCOUNT.UPDATED — Seller's Connect account status changed
      // =======================================================================

      else if (eventType === 'account.updated') {
        await handleAccountUpdated(event.data.object);
      }

      // =======================================================================
      // UNHANDLED EVENT
      // =======================================================================

      else {
        logger.info('Stripe webhook: unhandled event type', { eventType });
      }

      // Handler succeeded (or the event was unhandled / a legitimate skip):
      // claim the event.id so Stripe retries don't re-run it. create() is a
      // no-op-then-throw if a concurrent delivery already wrote it; we swallow
      // that — the work is done, ACK 200. Anything that threw above skipped this
      // line, leaving NO marker, so Stripe re-delivers (F3).
      try {
        await eventMarkerRef.create({
          type: eventType,
          createdAt: FieldValue.serverTimestamp(),
          // F107: TTL field so a Firestore TTL policy on `stripe_events.expiresAt`
          // can purge old dedup markers (collection grows unboundedly otherwise).
          // 90 days >> Stripe's 3-day retry window, so dedup is never weakened.
          // NOTE: creating the TTL policy itself is a console/gcloud action.
          expiresAt: Timestamp.fromMillis(Date.now() + STRIPE_EVENT_TTL_MS),
        });
      } catch (markerErr) {
        logger.info('Stripe webhook: event marker already claimed (concurrent delivery)', {
          eventId: event.id,
          eventType,
          error: markerErr instanceof Error ? markerErr.message : markerErr,
        });
      }

      res.json({ received: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error processing Stripe webhook', { error: message });
      res.status(500).send(`Webhook processing error: ${message}`);
    }
  }
);

// =============================================================================
// HANDLER: payment_intent.succeeded
// =============================================================================

async function handlePaymentIntentSucceeded(paymentIntent: any): Promise<void> {
  const transactionId = paymentIntent.metadata?.transactionId;

  if (!transactionId) {
    logger.error('Stripe webhook: PaymentIntent missing transactionId in metadata', {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  // Sanity bounds: Firestore doc IDs are 1-1500 chars, cannot contain '/'
  if (
    typeof transactionId !== 'string' ||
    transactionId.length === 0 ||
    transactionId.length > 200 ||
    transactionId.includes('/')
  ) {
    logger.error('Stripe webhook: invalid transactionId shape', { transactionId });
    return;
  }

  // Amount received (in cents) — convert to dollars for verification
  const amountReceivedCents = paymentIntent.amount_received || paymentIntent.amount;
  const amountReceivedDollars = amountReceivedCents / 100;

  // Check if this is a mixed wallet+card payment
  const isMixedPayment = paymentIntent.metadata?.paymentType === 'wallet_and_card';
  const walletAmountUsedCents = isMixedPayment
    ? parseInt(paymentIntent.metadata?.walletAmountUsed || '0', 10)
    : 0;

  const transactionRef = db.collection('transactions').doc(transactionId);

  // =====================================================================
  // ATOMIC TRANSACTION: idempotence + mark paid + mark sold + credit seller
  // =====================================================================

  const result = await db.runTransaction(async (tx) => {
    const txSnap = await tx.get(transactionRef);
    const txData = txSnap.data();

    if (!txData) {
      logger.error('Stripe webhook: transaction not found', { transactionId });
      return { processed: false, reason: 'transaction_not_found' };
    }

    // SECURITY: Verify the paid amount matches what we expect.
    // For mixed wallet+card payments, the Stripe charge is only for the
    // card portion (totalAmount - walletAmountUsed).
    //
    // P1 (dead-letter, not throw): an amount mismatch is a DETERMINISTIC error
    // (the captured charge and the stored total will not change on a retry).
    // Throwing here returned a 500, which is wrong on two counts: (a) Stripe
    // would re-deliver the same event for ~3 days to no effect, and (b) the
    // charge stays captured while the transaction is never marked paid, the
    // seller is never credited and the article stays locked — a silent loss with
    // no audit trail. Instead we RETURN a structured reason; the caller persists
    // a `failed_operations` dead-letter (and optionally auto-refunds) and ACKs
    // 200 so Stripe stops retrying a problem code cannot self-heal.
    const expectedAmount = txData.totalAmount;
    if (expectedAmount != null) {
      const expectedComparable = isMixedPayment
        ? expectedAmount - walletAmountUsedCents / 100
        : expectedAmount;
      if (Math.abs(amountReceivedDollars - expectedComparable) > 0.01) {
        logger.error(
          `Stripe webhook: amount mismatch${isMixedPayment ? ' (mixed payment)' : ''}`,
          {
            transactionId,
            received: amountReceivedDollars,
            expected: expectedComparable,
            expectedTotal: expectedAmount,
            walletCents: walletAmountUsedCents,
          }
        );
        // Buyer is short-changed (paid LESS than owed) => seller would be
        // under-funded; buyer overpaid (paid MORE) => buyer is owed a refund.
        // Either way the platform must NOT mark this paid blindly.
        return {
          processed: false,
          reason: 'amount_mismatch' as const,
          // Carry the tx data so the buyer-overpaid auto-refund can reuse the
          // shared refund core (atomic Stripe refund + wallet reconciliation).
          txData,
          mismatch: {
            received: amountReceivedDollars,
            expected: expectedComparable,
            expectedTotal: expectedAmount,
            walletCents: walletAmountUsedCents,
            isMixedPayment,
            // Buyer overpaid → refunding makes them whole; underpaid → manual.
            buyerOverpaid: amountReceivedDollars - expectedComparable > 0.01,
          },
        };
      }
    }

    // IDEMPOTENCE: If already paid/label_created/shipped/delivered, do nothing
    // (replay protection).
    const currentStatus = txData.status;
    if (
      currentStatus === 'paid' ||
      currentStatus === 'label_created' ||
      currentStatus === 'shipped' ||
      currentStatus === 'delivered'
    ) {
      logger.info('Stripe webhook: transaction already processed', {
        transactionId,
        currentStatus,
      });
      return { processed: false, reason: 'already_processed' };
    }

    // P1 (expiration vs payment in flight): the order was cancelled/expired
    // BEFORE this success landed (e.g. the 1h expiry raced a late capture, or
    // the buyer paid right after the order was cancelled). We must NOT mark it
    // paid — the article may already be relisted/sold. Instead, trigger an
    // idempotent Stripe refund AFTER the transaction so the buyer is made whole.
    // Already-refunded / in-progress states need no new refund (the refund key
    // is deterministic, so even a duplicate request would be a no-op, but we
    // skip to avoid noise).
    if (
      currentStatus === 'cancelled' ||
      currentStatus === 'refund_in_progress' ||
      currentStatus === 'refunded'
    ) {
      logger.warn('Stripe webhook: PI.succeeded on a non-payable transaction — will refund', {
        transactionId,
        currentStatus,
      });
      return {
        processed: false,
        reason: currentStatus === 'cancelled' ? 'cancelled_needs_refund' : 'already_refunded',
        // Carry the tx data so the post-transaction refund (issueTransactionRefund)
        // can re-credit the buyer wallet portion and debit the seller exactly what
        // was credited, in one atomic operation (no two-phase charge.refunded).
        txData,
      };
    }

    // --- Credit seller's wallet pendingBalance ---
    // P1 (atomicity payment<->label): for SHIPPING transactions the seller is
    // credited ONLY after the shipping label is successfully created (deferred
    // to the label step / sweepPendingLabels). Crediting here then failing the
    // label would leave the seller paid for a parcel that never ships. For
    // non-shipping (meetup is handled elsewhere; this guards anything that is
    // not 'shipping') there is no label, so we credit immediately.
    //
    // F1: creditSellerForSale reads the wallet (tx.get via getOrCreateSellerWallet),
    // so it MUST run BEFORE any tx.update below — the Admin SDK forbids a read after
    // a buffered write in the same runTransaction (READ_AFTER_WRITE_ERROR).
    const sellerId = txData.sellerId;
    if (txData.deliveryType !== 'shipping') {
      await creditSellerForSale(tx, transactionRef, txData, transactionId);
    }

    // --- Mark transaction as paid ---
    tx.update(transactionRef, {
      status: 'paid',
      paidAt: FieldValue.serverTimestamp(),
      stripePaymentIntentId: paymentIntent.id,
      stripeChargeId: paymentIntent.latest_charge || null,
    });

    // --- Mark article as sold ---
    if (txData.articleId) {
      const articleRef = db.collection('articles').doc(txData.articleId);
      tx.update(articleRef, {
        isSold: true,
        soldAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      processed: true,
      sellerId,
      chatId: txData.chatId,
      shipEngineRateId: txData.shipEngineRateId,
      deliveryType: txData.deliveryType,
      shippingCost: typeof txData.shippingCost === 'number' ? txData.shippingCost : 0,
      serviceFee: typeof txData.serviceFee === 'number' ? txData.serviceFee : 0,
      taxTotal: typeof txData.taxTotal === 'number' ? txData.taxTotal : 0,
      chargeId: paymentIntent.latest_charge || null,
      articleId: txData.articleId,
      articleTitle: txData.articleTitle || null,
    };
  });

  if (!result.processed) {
    // P1: the payment succeeded but the order is no longer payable (cancelled
    // by the 1h expiry that raced this success). Issue an idempotent Stripe
    // refund so the buyer is reimbursed. The deterministic key rf_${txId} dedups
    // against the expiry job's own refund, so this can never double-refund. The
    // resulting charge.refunded webhook applies any wallet reconciliation.
    if (result.reason === 'cancelled_needs_refund') {
      // Reuse the shared refund core: ONE atomic operation does the idempotent
      // Stripe refund (deterministic key rf_${txId} — dedups against the expiry
      // job) AND the wallet reconciliation (re-credit buyer wallet portion, debit
      // seller exactly what was credited — 0 here since a cancelled tx was never
      // paid). No longer two-phase (no dependency on a follow-up charge.refunded).
      // The stored stripePaymentIntentId may be absent on the tx (the PI.succeeded
      // landing here might predate persistence), so pass the live id from the event.
      const stripe = getStripe();
      if (!stripe) {
        logger.error('Stripe webhook: cannot auto-refund cancelled transaction — Stripe not configured', {
          transactionId,
          paymentIntentId: paymentIntent.id,
        });
        return;
      }
      try {
        const cancelledTxData = 'txData' in result ? result.txData : {};
        await issueTransactionRefund(
          transactionId,
          { ...cancelledTxData, stripePaymentIntentId: paymentIntent.id },
          {
            reason: 'cancelled_payment_succeeded_late',
            idempotencyKey: `rf_${transactionId}`,
            // Cancel already relisted the article; relisting again is a harmless
            // no-op (isSold=false). Keep default true to stay consistent.
            source: 'webhook_cancelled_needs_refund',
          }
        );
        logger.warn('Stripe webhook: auto-refunded payment on cancelled transaction', {
          transactionId,
          paymentIntentId: paymentIntent.id,
        });
      } catch (refundErr) {
        // issueTransactionRefund already dead-lettered the Stripe failure with the
        // same deterministic key, so a future retry is safe. Just log domain ctx.
        logger.error('Stripe webhook: auto-refund on cancelled transaction FAILED', {
          transactionId,
          paymentIntentId: paymentIntent.id,
          error: refundErr instanceof Error ? refundErr.message : refundErr,
        });
      }
      return;
    }

    // P1 (amount mismatch — deterministic): the captured amount does not match
    // what we expected. This cannot self-heal on a Stripe retry, so we MUST NOT
    // 500. Persist a dead-letter for manual reconciliation BEFORE returning. If
    // the buyer OVERPAID, we additionally CANCEL the sale and refund the FULL
    // charge idempotently (the tx never reaches 'paid', no seller credit; the
    // entire charge returns to the buyer — buyer-favourable and deterministic).
    // An UNDERPAYMENT is left for a human (refunding the full charge or chasing
    // the balance is a business decision).
    if (result.reason === 'amount_mismatch') {
      const mismatch = 'mismatch' in result ? result.mismatch : undefined;
      const buyerOverpaid = mismatch?.buyerOverpaid === true;
      const isMixedMismatch = mismatch?.isMixedPayment === true;

      await writeFailedOperation({
        type: 'amount_mismatch',
        refId: transactionId,
        payload: {
          paymentIntentId: paymentIntent.id,
          received: mismatch?.received ?? amountReceivedDollars,
          expected: mismatch?.expected ?? null,
          expectedTotal: mismatch?.expectedTotal ?? null,
          walletCents: mismatch?.walletCents ?? walletAmountUsedCents,
          isMixedCharge: isMixedMismatch,
          // Drive retryFailedOperations: only auto-refund the buyer-overpaid case.
          autoRefund: buyerOverpaid,
        },
        error: 'PaymentIntent amount does not match expected transaction amount',
      });

      if (buyerOverpaid) {
        const stripe = getStripe();
        if (stripe) {
          // Reuse the shared refund core: ONE atomic op refunds the full card
          // charge (deterministic key rf_mismatch_${txId}) AND reconciles the
          // wallet (re-credit buyer wallet portion, debit seller exactly what was
          // credited — 0 here since the tx was never marked paid). The tx never
          // persisted stripePaymentIntentId (never reached 'paid'), so we inject
          // the live id from the event. The refund is a plain platform-charge
          // refund (single-rail model, no transfer to reverse).
          const mismatchTxData = 'txData' in result ? result.txData : {};
          try {
            await issueTransactionRefund(
              transactionId,
              { ...mismatchTxData, stripePaymentIntentId: paymentIntent.id },
              {
                reason: 'amount_mismatch_buyer_overpaid',
                idempotencyKey: `rf_mismatch_${transactionId}`,
                source: 'webhook_amount_mismatch',
              }
            );
            logger.warn('Stripe webhook: amount mismatch (buyer overpaid) — auto-refunded', {
              transactionId,
              paymentIntentId: paymentIntent.id,
            });
          } catch (refundErr) {
            // issueTransactionRefund already dead-lettered the Stripe failure with
            // the same deterministic key, in addition to the amount_mismatch
            // dead-letter above; a later replay (retryFailedOperations) is safe.
            logger.error('CRITICAL Stripe webhook: amount mismatch auto-refund FAILED', {
              transactionId,
              paymentIntentId: paymentIntent.id,
              error: refundErr instanceof Error ? refundErr.message : refundErr,
            });
          }
        }
      } else {
        // F30: buyer UNDERPAID. We cannot fulfill at the wrong price, and the
        // article was locked (isSold=true) at createTransaction time. Leaving it
        // here strands the buyer's (partial) charge AND locks the article forever.
        // Deterministic safe treatment: refund the captured charge in full
        // (idempotent key) so the buyer is made whole, RELEASE the article so it
        // can be sold again, and keep the dead-letter for human visibility. The
        // refund key is distinct from the overpaid path; both never run for the
        // same transaction (mutually exclusive branches).
        logger.error('CRITICAL Stripe webhook: amount underpaid — refunding + releasing article', {
          transactionId,
          paymentIntentId: paymentIntent.id,
        });
        const stripe = getStripe();
        if (stripe) {
          const underpaidTxData = 'txData' in result ? result.txData : {};
          try {
            await issueTransactionRefund(
              transactionId,
              { ...underpaidTxData, stripePaymentIntentId: paymentIntent.id },
              {
                reason: 'amount_mismatch_buyer_underpaid',
                idempotencyKey: `rf_mismatch_${transactionId}`,
                // Item never fulfilled — re-list it so it is not locked forever.
                relistArticle: true,
                source: 'webhook_amount_mismatch_underpaid',
              }
            );
            logger.warn('Stripe webhook: amount underpaid — auto-refunded + article released', {
              transactionId,
              paymentIntentId: paymentIntent.id,
            });
          } catch (refundErr) {
            // issueTransactionRefund already dead-lettered the Stripe failure with
            // the same deterministic key; a later replay is safe. The article is
            // released by the refund core's atomic stage; if that never committed,
            // the dead-letter above keeps the case visible for a human.
            logger.error('CRITICAL Stripe webhook: amount underpaid auto-refund FAILED', {
              transactionId,
              paymentIntentId: paymentIntent.id,
              error: refundErr instanceof Error ? refundErr.message : refundErr,
            });
          }
        }
      }
      // ACK 200 (return normally): the outer handler responds received:true.
      return;
    }

    logger.info('Stripe webhook: skipping post-processing', {
      transactionId,
      reason: result.reason,
    });
    return;
  }

  logger.info('Stripe webhook: payment confirmed, atomic mutations committed', {
    transactionId,
    paymentIntentId: paymentIntent.id,
  });

  // =====================================================================
  // PLATFORM REVENUE LEDGER (E6 / F133c) — record gross revenue + tax once
  // =====================================================================
  // Idempotent by deterministic doc id; best-effort (never blocks the webhook).
  // Records serviceFee (+ tax if collected) + shippingCost collected, and the
  // Stripe processor fee from the charge's balance_transaction, so net margin per
  // transaction is computable from platform_ledger.
  await recordTransactionRevenue({
    transactionId,
    sellerId: result.sellerId,
    serviceFee: result.serviceFee ?? 0,
    shippingCost: result.shippingCost ?? 0,
    taxTotal: result.taxTotal ?? 0,
    chargeId: result.chargeId ?? null,
  });

  // =====================================================================
  // SHIPPING LABEL (non-atomic, external call — safe to retry separately)
  // =====================================================================

  let trackingNumber = '';
  let labelUrl = '';
  let trackingUrl = '';

  if (result.deliveryType === 'shipping') {
    const rateId = result.shipEngineRateId;

    // Guard: reject fallback rateIds generated by the client when ShipEngine
    // was unreachable. These are not real ShipEngine rate IDs and will fail
    // label creation. Flag the transaction for the sweep job — the seller is
    // NOT credited (no label = no shipment), the transaction stays 'paid'.
    if (rateId && rateId.startsWith('fallback_')) {
      logger.warn('Stripe webhook: fallback rateId detected — deferring to sweepPendingLabels', {
        transactionId,
        rateId,
      });
      await db.collection('transactions').doc(transactionId).update({
        labelCreationPending: true,
        labelCreationNote: `Fallback rateId "${rateId}" — re-rate + retry required`,
        status: 'paid',
      });
    } else {
      const shipEngine = getShipEngine();
      if (shipEngine && rateId) {
        // F5/F82: idempotent, double-spend-safe label creation. The helper
        // reserves the tx (atomic) BEFORE the paid ShipEngine call, so a webhook
        // timeout / Stripe retry / concurrent sweep can never create a 2nd label;
        // on success it credits the seller + persists the label atomically.
        const outcome = await createLabelIdempotent({
          transactionRef,
          transactionId,
          rateId,
          shipEngine,
          estimatedShippingCost: result.shippingCost ?? 0,
        });

        if (outcome === 'created' || outcome === 'skip') {
          // Read back the persisted label fields for the chat system message
          // below (a 'skip' means another path already created the label).
          const fresh = (await transactionRef.get()).data();
          trackingNumber = fresh?.trackingNumber || '';
          labelUrl = fresh?.shippingLabelUrl || '';
          trackingUrl = fresh?.trackingUrl || '';
          logger.info('Stripe webhook: label creation outcome', { transactionId, outcome });
        } else {
          // 'failed': the reservation was cleared (createLabel error) — defer to
          // sweepPendingLabels which re-rates + retries. Payment stays valid; the
          // seller is NOT credited (deferred-credit model).
          await db.collection('transactions').doc(transactionId).update({
            labelCreationPending: true,
            labelCreationNote: 'ShipEngine createLabel failed — re-rate + retry required',
          }).catch((err) => {
            logger.error('Failed to flag labelCreationPending', {
              transactionId,
              error: err instanceof Error ? err.message : err,
            });
          });
        }
      } else {
        // No ShipEngine client or no rateId — defer to the sweep.
        logger.warn('Stripe webhook: no ShipEngine/rateId — deferring to sweepPendingLabels', {
          transactionId,
          hasRateId: !!rateId,
        });
        await db.collection('transactions').doc(transactionId).update({
          labelCreationPending: true,
          labelCreationNote: 'No rateId/ShipEngine at payment — re-rate + retry required',
        });
      }
    }
  }

  // =====================================================================
  // SYSTEM MESSAGE: Send shipping/tracking info to chat
  // =====================================================================

  const chatId = result.chatId;
  if (chatId) {
    const labelInfo = trackingNumber
      ? `\n\nNumero de suivi: ${trackingNumber}\nEtiquette: disponible dans les details de la commande.`
      : '\n\nL\'etiquette d\'expedition sera disponible sous peu.';

    let participants: string[] = [];
    try {
      const chatSnap = await db.collection('chats').doc(chatId).get();
      if (chatSnap.exists) {
        participants = (chatSnap.data()?.participants as string[]) || [];
      }
    } catch (lookupErr) {
      logger.warn('Could not load chat participants', {
        chatId,
        error: lookupErr instanceof Error ? lookupErr.message : lookupErr,
      });
    }

    await db.collection('messages').add({
      chatId,
      senderId: 'system',
      receiverId: 'system',
      type: 'system',
      content: `Paiement confirme !${labelInfo}\n\nLe vendeur peut maintenant expedier l'article.`,
      participants,
      timestamp: FieldValue.serverTimestamp(),
      status: 'sent',
      isRead: true,
      ...(trackingNumber && {
        shippingLabel: {
          labelUrl,
          trackingNumber,
          trackingUrl,
        },
      }),
    });
  }

  // =====================================================================
  // PUSH NOTIFICATION: Notify seller of new sale
  // =====================================================================

  try {
    const articleTitle = result.articleTitle || 'un article';
    await sendPushNotification(
      result.sellerId,
      'Nouvelle vente !',
      `Vous avez vendu ${articleTitle}. Preparez l'envoi.`,
      { transactionId, articleId: result.articleId || '' },
      'new_sale'
    );
    logger.info('Stripe webhook: seller notification sent', {
      transactionId,
      sellerId: result.sellerId,
    });
  } catch (notifError) {
    // Non-critical: payment is already confirmed, don't fail the webhook
    logger.warn('Stripe webhook: failed to send seller notification', {
      transactionId,
      error: notifError instanceof Error ? notifError.message : notifError,
    });
  }

  logger.info('Stripe webhook: fully processed', { transactionId });
}

/**
 * F77: re-drive a LOST payment_intent.succeeded from a dead-letter replay.
 * retryFailedOperations calls this when a `lost_pi_succeeded_webhook` op is
 * eligible: it retrieves the live PI from Stripe and replays the canonical
 * handler, which is idempotent (status guards + deterministic keys). Routes
 * swap top-up / shop tier PIs to their own handlers based on metadata.type so a
 * lost top-up/forfait succeeded is also recoverable.
 *
 * @returns true if a handler ran to completion (resolve the dead-letter),
 *          false if Stripe was unreachable / the PI was not actually succeeded
 *          (keep retrying).
 */
export async function redrivePaymentIntentSucceeded(paymentIntentId: string): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return false;
  let pi: any;
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (err) {
    logger.warn('[redrivePaymentIntentSucceeded] PI retrieve failed', {
      paymentIntentId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
  if (pi.status !== 'succeeded') {
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
    await handlePaymentIntentSucceeded(pi);
  }
  return true;
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
async function handleSwapTopUpSucceeded(paymentIntent: any): Promise<void> {
  const swapId = paymentIntent.metadata?.swapId;

  if (
    typeof swapId !== 'string' ||
    swapId.length === 0 ||
    swapId.length > 200 ||
    swapId.includes('/')
  ) {
    logger.error('Stripe webhook: swap_topup PaymentIntent missing/invalid swapId', {
      paymentIntentId: paymentIntent.id,
      swapId,
    });
    return;
  }

  const payeeId = paymentIntent.metadata?.payeeId;
  const baseAmountCents = parseInt(paymentIntent.metadata?.topUpAmount || '0', 10);

  if (typeof payeeId !== 'string' || !payeeId || !Number.isInteger(baseAmountCents) || baseAmountCents <= 0) {
    logger.error('Stripe webhook: swap_topup PaymentIntent missing payeeId/topUpAmount', {
      paymentIntentId: paymentIntent.id,
      swapId,
    });
    return;
  }

  const amountReceivedCents = paymentIntent.amount_received || paymentIntent.amount;
  const swapRef = db.collection('swaps').doc(swapId);

  // Terminal states a swap can never advance OUT of into the exchange flow. If a
  // late top-up capture lands here while the swap already reached one of these,
  // the payer was charged for an exchange that will never happen → refund.
  const CANCELLED_LIKE = new Set(['cancelled', 'declined', 'expired', 'disputed']);

  const result = await db.runTransaction(async (tx) => {
    const swapSnap = await tx.get(swapRef);
    const swap = swapSnap.data();

    if (!swap) {
      logger.error('Stripe webhook: swap_topup swap not found', { swapId });
      return { outcome: 'not_found' as const };
    }

    // SECURITY: verify the charged amount matches base + fee from the swap doc.
    //
    // P1 (dead-letter, not throw): a swap top-up amount mismatch is a
    // DETERMINISTIC error (the captured charge and the stored base+fee will not
    // change on a Stripe retry). Throwing here propagated to a 500, which (a) made
    // Stripe re-deliver the same event for ~3 days to no effect, and (b) left the
    // charge captured while the swap never advanced and the payee was never
    // credited — a silent loss with no audit trail. Instead we RETURN a structured
    // outcome; the caller persists a dead-letter (and auto-refunds idempotently if
    // the payer OVERPAID) and ACKs 200, mirroring the purchase amount_mismatch path.
    const expectedTotalCents = baseAmountCents + (swap.topUpFee || 0);
    if (Math.abs(amountReceivedCents - expectedTotalCents) > 1) {
      logger.error('Stripe webhook: swap_topup amount mismatch', {
        swapId,
        received: amountReceivedCents,
        expected: expectedTotalCents,
      });
      // Pre-set topUpRefundReconciledAt so a later charge.refunded webhook
      // (handleSwapTopUpRefund) short-circuits and does NOT debit the payee wallet:
      // we never credited it (we return before the pendingBalance increment), so a
      // debit would wrongly drain an unrelated top-up sitting in the same wallet.
      tx.update(swapRef, {
        topUpPaymentIntentId: paymentIntent.id,
        topUpChargeId: paymentIntent.latest_charge || null,
        topUpRefundReconciledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        outcome: 'amount_mismatch' as const,
        mismatch: {
          received: amountReceivedCents,
          expected: expectedTotalCents,
          // Payer overpaid → a full refund of the (direct platform) charge makes
          // them whole; underpaid → a human decides (refund vs chase the balance).
          payerOverpaid: amountReceivedCents - expectedTotalCents > 1,
        },
      };
    }

    // A1 (race capture vs cancellation/expiry): the swap was cancelled (by the
    // initiator) or expired (expireStaleProposedSwaps) BEFORE this capture landed.
    // The payer was debited but the exchange is dead → refund, mirroring the
    // purchase `cancelled_needs_refund` path. The wallet was NEVER credited (we
    // only credit on the payment_pending → accepted transition below), so there is
    // nothing to reverse internally; the charge.refunded webhook reconciles
    // defensively (min(amount, pendingBalance) = 0 here). We persist the PI/charge
    // ids so the post-transaction refund and any reconciliation can resolve them.
    if (CANCELLED_LIKE.has(swap.status)) {
      logger.warn('Stripe webhook: swap_topup captured on a cancelled/expired swap — will refund', {
        swapId,
        currentStatus: swap.status,
      });
      // Pre-set topUpRefundReconciledAt so the upcoming charge.refunded webhook
      // (handleSwapTopUpRefund) short-circuits and does NOT debit the payee wallet:
      // we never credited it (we return before the pendingBalance increment), so a
      // debit would wrongly drain an unrelated top-up sitting in the same wallet.
      tx.update(swapRef, {
        topUpPaidAt: FieldValue.serverTimestamp(),
        topUpPaymentIntentId: paymentIntent.id,
        topUpChargeId: paymentIntent.latest_charge || null,
        topUpRefundReconciledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { outcome: 'cancelled_needs_refund' as const };
    }

    // IDEMPOTENCE: only advance a swap still awaiting payment. Any other status
    // (accepted/photos_pending/shipping/completed…) means a prior delivery of a
    // top-up capture already advanced this swap — do nothing.
    if (swap.status !== 'payment_pending') {
      logger.info('Stripe webhook: swap_topup already processed or not pending', {
        swapId,
        currentStatus: swap.status,
      });
      return { outcome: 'already_processed' as const };
    }

    // Credit payee wallet pendingBalance (escrow), auto-create if absent.
    const { walletRef, walletData, isNew } = await getOrCreateSellerWallet(tx, payeeId);
    if (!isNew) {
      tx.update(walletRef, {
        pendingBalance: FieldValue.increment(baseAmountCents),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.update(walletRef, {
        pendingBalance: baseAmountCents,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const ledgerRef = walletRef.collection('ledger').doc();
    tx.set(ledgerRef, {
      type: 'sale_credit',
      amount: baseAmountCents,
      balanceAfter: (walletData.pendingBalance || 0) + baseAmountCents,
      description: 'Complément d\'échange — fonds en attente',
      swapId,
      createdAt: FieldValue.serverTimestamp(),
      status: 'pending',
    });

    // Advance swap to 'accepted' (exchange mode flow proceeds from here).
    tx.update(swapRef, {
      status: 'accepted',
      topUpPaidAt: FieldValue.serverTimestamp(),
      topUpPaymentIntentId: paymentIntent.id,
      topUpChargeId: paymentIntent.latest_charge || null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { outcome: 'accepted' as const };
  });

  // P1 (amount mismatch — deterministic): the captured top-up amount does not
  // match base+fee from the swap doc. This cannot self-heal on a Stripe retry, so
  // we MUST NOT 500. We always persist a dead-letter for audit/reconciliation. If
  // the payer OVERPAID we additionally auto-refund the full (direct platform)
  // charge idempotently — a defensive, payer-favourable action. An UNDERPAYMENT is
  // left for a human (refunding the full charge vs chasing the balance is a
  // business decision). Either way we ACK 200 so Stripe stops retrying.
  if (result.outcome === 'amount_mismatch') {
    const mismatch = 'mismatch' in result ? result.mismatch : undefined;
    const payerOverpaid = mismatch?.payerOverpaid === true;
    const stripe = getStripe();

    if (payerOverpaid && stripe) {
      try {
        // DIRECT PLATFORM CHARGE: no transfer_data → must NOT pass reverse_transfer
        // / refund_application_fee (Stripe rejects them). Deterministic key
        // `rf_swap_${swapId}` is SHARED with refundSwapTopUpIfPaid + the
        // cancelled-race branch below, so this can never double-refund.
        const refund = await stripe.refunds.create(
          {
            payment_intent: paymentIntent.id,
            metadata: { type: 'swap_topup_refund', swapId, reason: 'amount_mismatch_payer_overpaid' },
          },
          { idempotencyKey: `rf_swap_${swapId}` }
        );
        await swapRef.update({
          topUpRefundId: refund.id,
          topUpRefundedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        logger.warn('Stripe webhook: swap_topup amount mismatch (payer overpaid) — auto-refunded', {
          swapId,
          paymentIntentId: paymentIntent.id,
          refundId: refund.id,
        });
      } catch (refundErr) {
        // Replayable dead-letter. type 'stripe_refund_failed' + isMixedCharge:true
        // makes retryFailedOperations re-issue refunds.create WITHOUT
        // reverse_transfer (direct charge), reusing the SAME `rf_swap_${swapId}`
        // key so a later replay never double-refunds. kind tags the swap mismatch.
        await writeFailedOperation({
          type: 'stripe_refund_failed',
          refId: swapId,
          payload: {
            paymentIntentId: paymentIntent.id,
            idempotencyKey: `rf_swap_${swapId}`,
            isMixedCharge: true,
            kind: 'swap_topup_amount_mismatch',
            received: mismatch?.received ?? amountReceivedCents,
            expected: mismatch?.expected ?? null,
          },
          error: refundErr,
        });
        logger.error('CRITICAL Stripe webhook: swap_topup mismatch auto-refund FAILED', {
          swapId,
          paymentIntentId: paymentIntent.id,
          error: refundErr instanceof Error ? refundErr.message : refundErr,
        });
      }
    } else {
      // Underpaid (or Stripe not configured): no safe auto-action. Persist an audit
      // dead-letter for manual reconciliation. amount_mismatch with autoRefund:false
      // keeps it visible (retryFailedOperations logs CRITICAL until it exhausts)
      // without taking a money-moving action a human must decide.
      await writeFailedOperation({
        type: 'amount_mismatch',
        refId: swapId,
        payload: {
          paymentIntentId: paymentIntent.id,
          received: mismatch?.received ?? amountReceivedCents,
          expected: mismatch?.expected ?? null,
          isMixedCharge: true,
          autoRefund: false,
          kind: 'swap_topup_amount_mismatch',
        },
        error: 'Swap top-up amount does not match expected base+fee total',
      });
      logger.error('CRITICAL Stripe webhook: swap_topup amount underpaid — dead-lettered for manual reconciliation', {
        swapId,
        paymentIntentId: paymentIntent.id,
        stripeConfigured: !!stripe,
      });
    }
    // ACK 200 (return normally): the outer handler responds received:true.
    return;
  }

  // A1 refund: issue an idempotent Stripe refund of the full top-up charge for a
  // capture that landed on a dead (cancelled/expired) swap. The deterministic key
  // `rf_swap_${swapId}` is SHARED with refundSwapTopUpIfPaid (cancel/dispute
  // callables), so this can never double-refund regardless of which path runs
  // first. On failure we dead-letter (replayed by retryFailedOperations) and ACK
  // 200 — a captured charge on a dead swap cannot self-heal on a Stripe retry.
  if (result.outcome === 'cancelled_needs_refund') {
    const stripe = getStripe();
    if (!stripe) {
      logger.error('Stripe webhook: cannot auto-refund cancelled swap top-up — Stripe not configured', {
        swapId,
        paymentIntentId: paymentIntent.id,
      });
      await writeFailedOperation({
        type: 'stripe_refund_failed',
        refId: swapId,
        // idempotencyKey MUST equal the original (`rf_swap_${swapId}`) so the
        // retry never issues a second refund. isMixedCharge:true tells the retry
        // handler to OMIT reverse_transfer/refund_application_fee — a swap top-up
        // is a direct platform charge (no transfer_data), and Stripe rejects those
        // flags on such a charge (see refundSwapTopUpIfPaid in swaps.ts).
        payload: {
          paymentIntentId: paymentIntent.id,
          idempotencyKey: `rf_swap_${swapId}`,
          isMixedCharge: true,
          kind: 'swap_topup_cancelled_race',
        },
        error: 'Stripe not configured at swap top-up cancelled-race refund',
      });
      return;
    }
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntent.id,
          metadata: { type: 'swap_topup_refund', swapId, reason: 'cancelled_payment_succeeded_late' },
        },
        { idempotencyKey: `rf_swap_${swapId}` }
      );
      await swapRef.update({
        topUpRefundId: refund.id,
        topUpRefundedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      logger.warn('Stripe webhook: auto-refunded swap top-up on cancelled/expired swap', {
        swapId,
        paymentIntentId: paymentIntent.id,
        refundId: refund.id,
      });
    } catch (refundErr) {
      await writeFailedOperation({
        type: 'stripe_refund_failed',
        refId: swapId,
        // Same key + isMixedCharge contract as the not-configured branch above.
        payload: {
          paymentIntentId: paymentIntent.id,
          idempotencyKey: `rf_swap_${swapId}`,
          isMixedCharge: true,
          kind: 'swap_topup_cancelled_race',
        },
        error: refundErr,
      });
      logger.error('CRITICAL Stripe webhook: swap top-up cancelled-race auto-refund FAILED', {
        swapId,
        paymentIntentId: paymentIntent.id,
        error: refundErr instanceof Error ? refundErr.message : refundErr,
      });
    }
    return;
  }

  if (result.outcome === 'accepted') {
    logger.info('Stripe webhook: swap top-up confirmed, swap advanced to accepted', {
      swapId,
      paymentIntentId: paymentIntent.id,
      payeeId,
    });
  }
}

// =============================================================================
// HANDLER: payment_intent.succeeded (metadata.type === 'shop_tier') — F134
// =============================================================================

/**
 * Confirm a paid shop tier forfait purchase. AFTER the platform charge succeeds:
 *  1. Verify the captured amount matches the server forfait price (base+period).
 *  2. Idempotently stamp `tier` + `tierPaidUntil` (now + periodMonths) on the
 *     shop. A replay (same status guard via tierPaymentIntentId) is a no-op.
 *  3. Write a `shop_tier_revenue` platform_ledger entry (idempotent, deterministic
 *     id) so the forfait revenue is accounted (E6).
 *
 * tier/tierPaidUntil are CF-only in firestore.rules — only this Admin SDK path
 * (and admin moderation) may set them; a client can never self-attribute a tier.
 */
async function handleShopTierSucceeded(paymentIntent: any): Promise<void> {
  const shopId = paymentIntent.metadata?.shopId;
  const tier = paymentIntent.metadata?.tier as PaidShopTier | undefined;
  const periodMonths = parseInt(paymentIntent.metadata?.periodMonths || '0', 10);

  if (
    typeof shopId !== 'string' ||
    shopId.length === 0 ||
    shopId.length > 200 ||
    shopId.includes('/')
  ) {
    logger.error('Stripe webhook: shop_tier PaymentIntent missing/invalid shopId', {
      paymentIntentId: paymentIntent.id,
      shopId,
    });
    return;
  }
  if (tier !== 'pro' && tier !== 'premium') {
    logger.error('Stripe webhook: shop_tier PaymentIntent invalid tier', {
      paymentIntentId: paymentIntent.id,
      shopId,
      tier,
    });
    return;
  }
  if (!Number.isInteger(periodMonths) || periodMonths < 1 || periodMonths > 12) {
    logger.error('Stripe webhook: shop_tier PaymentIntent invalid periodMonths', {
      paymentIntentId: paymentIntent.id,
      shopId,
      periodMonths,
    });
    return;
  }

  const amountReceivedCents = paymentIntent.amount_received || paymentIntent.amount;
  const expectedCents = shopTierPriceCents(tier, periodMonths);
  const shopRef = db.collection('shops').doc(shopId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(shopRef);
    if (!snap.exists) {
      logger.error('Stripe webhook: shop_tier shop not found', { shopId });
      return { applied: false as const, reason: 'shop_not_found' as const };
    }
    const shop = snap.data()!;

    // B10 (defensive): the callable refuses non-approved shops, but a shop could
    // be suspended/rejected between purchase and this webhook (race). Stamping a
    // tier here would encash a forfait that grants no buyer-fee reduction. Do NOT
    // stamp — surface for manual refund (admin_alert) and ACK 200.
    if (shop.status !== 'approved') {
      logger.error('Stripe webhook: shop_tier shop not approved at confirmation', {
        shopId,
        status: shop.status,
        paymentIntentId: paymentIntent.id,
      });
      return {
        applied: false as const,
        reason: 'not_approved' as const,
        status: typeof shop.status === 'string' ? shop.status : 'unknown',
      };
    }

    // Amount mismatch: deterministic (the captured amount and server price will
    // not change on a Stripe retry). Persist the PI id + dead-letter, ACK 200.
    if (Math.abs(amountReceivedCents - expectedCents) > 1) {
      logger.error('Stripe webhook: shop_tier amount mismatch', {
        shopId,
        received: amountReceivedCents,
        expected: expectedCents,
      });
      return {
        applied: false as const,
        reason: 'amount_mismatch' as const,
        received: amountReceivedCents,
        expected: expectedCents,
      };
    }

    // Idempotence: a replay carrying the same PaymentIntent id was already
    // applied — do nothing (do not extend tierPaidUntil twice).
    if (shop.tierPaymentIntentId === paymentIntent.id) {
      logger.info('Stripe webhook: shop_tier already applied (same PaymentIntent)', {
        shopId,
        paymentIntentId: paymentIntent.id,
      });
      return { applied: false as const, reason: 'already_applied' as const };
    }

    // tierPaidUntil = max(now, current paid-until) + periodMonths so a renewal
    // before expiry STACKS onto the remaining time rather than truncating it.
    const now = Date.now();
    const currentUntilMs =
      shop.tierPaidUntil && typeof shop.tierPaidUntil.toMillis === 'function'
        ? shop.tierPaidUntil.toMillis()
        : 0;
    const baseMs = Math.max(now, currentUntilMs);
    const paidUntil = new Date(baseMs);
    paidUntil.setMonth(paidUntil.getMonth() + periodMonths);

    tx.update(shopRef, {
      tier,
      tierPaidUntil: paidUntil,
      tierPaymentIntentId: paymentIntent.id,
      tierChargeId: paymentIntent.latest_charge || null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      applied: true as const,
      ownerId: typeof shop.ownerId === 'string' ? shop.ownerId : null,
      paidUntilIso: paidUntil.toISOString(),
    };
  });

  if (result.applied) {
    // Forfait revenue ledger entry (idempotent: deterministic per PaymentIntent).
    try {
      await db
        .collection('platform_ledger')
        .doc(`shop_tier_revenue_${paymentIntent.id}`)
        .set({
          type: 'shop_tier_revenue',
          shopId,
          ownerId: result.ownerId,
          tier,
          periodMonths,
          amount: amountReceivedCents / 100,
          paymentIntentId: paymentIntent.id,
          chargeId: paymentIntent.latest_charge || null,
          currency: 'cad',
          createdAt: FieldValue.serverTimestamp(),
        });
    } catch (ledgerErr) {
      logger.error('Stripe webhook: shop_tier_revenue ledger write failed', {
        shopId,
        paymentIntentId: paymentIntent.id,
        error: ledgerErr instanceof Error ? ledgerErr.message : ledgerErr,
      });
    }
    logger.info('Stripe webhook: shop tier applied', {
      shopId,
      tier,
      periodMonths,
      paidUntil: result.paidUntilIso,
    });
    return;
  }

  if (result.reason === 'amount_mismatch') {
    await writeFailedOperation({
      type: 'amount_mismatch',
      refId: shopId,
      payload: {
        paymentIntentId: paymentIntent.id,
        received: result.received,
        expected: result.expected,
        autoRefund: false,
        kind: 'shop_tier_amount_mismatch',
      },
      error: 'Shop tier amount does not match expected forfait price',
    });
    logger.error('CRITICAL Stripe webhook: shop_tier amount mismatch — dead-lettered', {
      shopId,
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  if (result.reason === 'not_approved') {
    // B10: forfait paid for a shop that is not (or no longer) approved — no tier
    // was stamped (grants no benefit). Flag for MANUAL REFUND; no auto-refund path.
    await writeAdminAlert({
      kind: 'shop_tier_not_approved',
      severity: 'critical',
      refId: shopId,
      message: `Forfait ${tier} (${periodMonths} mois) payé pour une boutique non approuvée (statut: ${result.status}). Remboursement manuel requis.`,
      context: {
        paymentIntentId: paymentIntent.id,
        chargeId: paymentIntent.latest_charge || null,
        amountCents: amountReceivedCents,
        tier,
        periodMonths,
        shopStatus: result.status,
      },
    });
  }
}

// =============================================================================
// HANDLER: payment_intent.payment_failed
// =============================================================================

async function handlePaymentIntentFailed(paymentIntent: any): Promise<void> {
  const transactionId = paymentIntent.metadata?.transactionId;

  if (!transactionId) {
    logger.error('Stripe webhook: payment_failed PaymentIntent missing transactionId in metadata', {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  if (
    typeof transactionId !== 'string' ||
    transactionId.length === 0 ||
    transactionId.length > 200 ||
    transactionId.includes('/')
  ) {
    logger.error('Stripe webhook: payment_failed invalid transactionId shape', { transactionId });
    return;
  }

  const transactionRef = db.collection('transactions').doc(transactionId);

  // F102: Stripe emits payment_intent.payment_failed on EVERY failed attempt
  // (card declined, 3DS abandoned), but the buyer can immediately retry in the
  // SAME Payment Sheet on the SAME PaymentIntent. Cancelling on the first failure
  // relisted the article mid-checkout and, if the retry then succeeded, produced
  // a PI.succeeded on a 'cancelled' tx → auto-refund + lost sale.
  //
  // The PaymentIntent status is the authority: only a TERMINAL 'canceled' PI is a
  // real, final failure. Anything else (requires_payment_method/requires_action/
  // processing) is a retryable attempt — do nothing and let the 1h pending_payment
  // expiry (which re-reads the live PI status, transactionExpiration.ts) decide.
  const stripe = getStripe();
  let piTerminallyCanceled = false;
  if (stripe && typeof paymentIntent.id === 'string') {
    try {
      const livePi = await stripe.paymentIntents.retrieve(paymentIntent.id);
      piTerminallyCanceled = livePi.status === 'canceled';
      if (!piTerminallyCanceled) {
        logger.info('Stripe webhook: payment_failed is a retryable attempt — not cancelling', {
          transactionId,
          paymentIntentId: paymentIntent.id,
          piStatus: livePi.status,
        });
      }
    } catch (retrieveErr) {
      // Could not reach Stripe — be conservative and do NOT cancel; the 1h expiry
      // will reconcile against the live PI status.
      logger.warn('Stripe webhook: payment_failed PI retrieve failed — deferring to expiry', {
        transactionId,
        paymentIntentId: paymentIntent.id,
        error: retrieveErr instanceof Error ? retrieveErr.message : retrieveErr,
      });
    }
  }

  if (!piTerminallyCanceled) {
    return;
  }

  await db.runTransaction(async (tx) => {
    const txSnap = await tx.get(transactionRef);
    const txData = txSnap.data();

    if (!txData) {
      logger.error('Stripe webhook: payment_failed transaction not found', { transactionId });
      return;
    }

    // Idempotence: only cancel if still in a pre-payment status
    const cancellableStatuses = new Set(['pending_payment', 'pending']);
    if (!cancellableStatuses.has(txData.status)) {
      logger.info('Stripe webhook: payment_failed skipping — transaction not in cancellable status', {
        transactionId,
        currentStatus: txData.status,
      });
      return;
    }

    // ALL reads BEFORE all writes (Admin SDK READ_AFTER_WRITE_ERROR, cf. F1):
    // read the article + buyer wallet now, write everything after.
    const articleRef = txData.articleId
      ? db.collection('articles').doc(txData.articleId)
      : null;
    const articleSnap = articleRef ? await tx.get(articleRef) : null;

    const walletAmountUsed = txData.walletAmountUsed || 0; // in cents
    const shouldRefundWallet =
      walletAmountUsed > 0 &&
      (txData.paidVia === 'wallet_and_card' || txData.paidVia === 'wallet');
    const buyerId = txData.buyerId;
    const buyerWalletRef = shouldRefundWallet
      ? db.collection('wallets').doc(buyerId)
      : null;
    const buyerWalletSnap = buyerWalletRef ? await tx.get(buyerWalletRef) : null;

    // Cancel the transaction
    tx.update(transactionRef, {
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: 'payment_failed',
    });

    // Release the article so it can be purchased again
    if (articleRef && articleSnap && articleSnap.exists) {
      tx.update(articleRef, { isSold: false });
    }

    // F02: Refund wallet portion if this was a mixed wallet+card payment
    if (buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
      const walletData = buyerWalletSnap.data()!;
      tx.update(buyerWalletRef, {
        balance: FieldValue.increment(walletAmountUsed),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
      tx.set(buyerLedgerRef, {
        type: 'refund_credit',
        amount: walletAmountUsed,
        balanceAfter: (walletData.balance || 0) + walletAmountUsed,
        description: 'Remboursement — echec de paiement',
        transactionId,
        createdAt: FieldValue.serverTimestamp(),
      });

      logger.info('Stripe webhook: payment_failed — wallet portion refunded', {
        transactionId,
        buyerId,
        walletAmountRefunded: walletAmountUsed,
      });
    }
  });

  const failureMessage = paymentIntent.last_payment_error?.message || 'Unknown failure';
  logger.error('Stripe webhook: payment failed — transaction cancelled', {
    transactionId,
    paymentIntentId: paymentIntent.id,
    failureMessage,
  });
}

// =============================================================================
// HANDLER: charge.dispute.created
// =============================================================================

async function handleDisputeCreated(dispute: any): Promise<void> {
  // The dispute object contains a payment_intent field
  const paymentIntentId = dispute.payment_intent;

  if (!paymentIntentId) {
    logger.error('Stripe webhook: dispute missing payment_intent', {
      disputeId: dispute.id,
    });
    return;
  }

  // Look up the transaction by stripePaymentIntentId
  const txQuery = await db
    .collection('transactions')
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();

  if (txQuery.empty) {
    logger.error('Stripe webhook: dispute — no transaction found for PaymentIntent', {
      disputeId: dispute.id,
      paymentIntentId,
    });
    return;
  }

  const txDoc = txQuery.docs[0];
  const transactionId = txDoc.id;

  await db.runTransaction(async (tx) => {
    const txSnap = await tx.get(txDoc.ref);
    const txData = txSnap.data();

    if (!txData) return;

    // Idempotence: if already disputed or refunded, skip
    if (txData.status === 'disputed' || txData.status === 'refunded') {
      logger.info('Stripe webhook: dispute skipping — already in terminal status', {
        transactionId,
        currentStatus: txData.status,
      });
      return;
    }

    // ---------------------------------------------------------------------
    // FREEZE FUNDS — the disputed payout must NOT remain in withdrawable
    // `balance`. Funds may sit in any of the three buckets depending on the
    // transaction stage:
    //   - pendingBalance (paid, not delivered)  -> already non-withdrawable
    //   - heldBalance    (delivered, in window) -> already non-withdrawable
    //   - balance        (released)             -> MUST move back to heldBalance
    // We move any released portion from `balance` into `heldBalance` (capped so
    // balance never goes negative), keeping the rest in place. The seller
    // cannot withdraw heldBalance/pendingBalance. We do NOT release; the
    // dispute.closed handler decides won (release) vs lost (debit).
    // ---------------------------------------------------------------------
    const sellerId = txData.sellerId;
    const sellerPayout = txData.sellerPayout ?? txData.amount;
    const sellerPayoutCents =
      typeof sellerPayout === 'number' ? Math.round(sellerPayout * 100) : 0;

    // Track the EXACT amount moved balance -> heldBalance so dispute.closed can
    // give it back on a WON/warning_closed outcome (F37). 0 if nothing in balance.
    let freezeCents = 0;

    if (sellerId && sellerPayoutCents > 0) {
      const sellerWalletRef = db.collection('wallets').doc(sellerId);
      const sellerWalletSnap = await tx.get(sellerWalletRef);

      if (sellerWalletSnap.exists) {
        const walletData = sellerWalletSnap.data()!;
        const balanceNow = walletData.balance || 0;
        // Only move what's actually sitting in withdrawable balance.
        freezeCents = Math.min(sellerPayoutCents, balanceNow);

        if (freezeCents > 0) {
          tx.update(sellerWalletRef, {
            balance: FieldValue.increment(-freezeCents),
            heldBalance: FieldValue.increment(freezeCents),
            updatedAt: FieldValue.serverTimestamp(),
          });

          const ledgerRef = sellerWalletRef.collection('ledger').doc();
          tx.set(ledgerRef, {
            type: 'dispute_hold',
            amount: freezeCents,
            balanceAfter: balanceNow - freezeCents,
            description: 'Litige ouvert — fonds gelés',
            transactionId,
            createdAt: FieldValue.serverTimestamp(),
            status: 'held',
          });
        }
      } else {
        logger.warn('Stripe webhook: dispute — seller wallet not found, cannot freeze', {
          transactionId,
          sellerId,
        });
      }
    }

    // Preserve the status held BEFORE the dispute so dispute.closed (won) can
    // restore the normal release cycle (paid/shipped/delivered). Persist the
    // exact hold so the close handler can release it (F37).
    tx.update(txDoc.ref, {
      status: 'disputed',
      statusBeforeDispute: txData.status,
      disputed: true,
      disputeId: dispute.id,
      disputedAt: FieldValue.serverTimestamp(),
      disputeReason: dispute.reason || null,
      disputeFreezeCents: freezeCents,
    });
  });

  logger.warn('Stripe webhook: dispute created — transaction marked disputed, funds frozen', {
    transactionId,
    disputeId: dispute.id,
    reason: dispute.reason,
    amount: dispute.amount,
  });
}

// =============================================================================
// HANDLER: charge.dispute.closed
// =============================================================================

/**
 * Resolve a closed dispute.
 *
 *  - WON (dispute.status === 'won'): the seller keeps the money. F37: release the
 *    exact amount frozen at dispute.created (disputeFreezeCents) from heldBalance
 *    back to balance — otherwise the hold stays stranded forever. Restore the
 *    transaction status that preceded the dispute and clear the `disputed` flag.
 *
 *  - LOST (dispute.status === 'lost'): Stripe has already pulled the money back
 *    from the platform. F38: debit the seller across pendingBalance -> heldBalance
 *    -> balance (aligned with handleChargeRefunded), recording any shortfall as
 *    `sellerDebt`. F37: any frozen amount the debit did not consume from
 *    heldBalance is released back to balance. Mark the transaction 'refunded'.
 *
 *  - OTHER (e.g. warning_closed): treated like WON — release the hold, restore
 *    the status.
 */
async function handleDisputeClosed(dispute: any): Promise<void> {
  const paymentIntentId = dispute.payment_intent;

  if (!paymentIntentId) {
    logger.error('Stripe webhook: dispute.closed missing payment_intent', {
      disputeId: dispute.id,
    });
    return;
  }

  const txQuery = await db
    .collection('transactions')
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();

  if (txQuery.empty) {
    logger.error('Stripe webhook: dispute.closed — no transaction found for PaymentIntent', {
      disputeId: dispute.id,
      paymentIntentId,
    });
    return;
  }

  const txDoc = txQuery.docs[0];
  const transactionId = txDoc.id;
  const outcome = dispute.status; // 'won' | 'lost' | 'warning_closed' | ...

  await db.runTransaction(async (tx) => {
    const txSnap = await tx.get(txDoc.ref);
    const txData = txSnap.data();
    if (!txData) return;

    // Idempotence: only act on a transaction currently in dispute.
    if (txData.status !== 'disputed') {
      logger.info('Stripe webhook: dispute.closed skipping — not in disputed status', {
        transactionId,
        currentStatus: txData.status,
        outcome,
      });
      return;
    }

    const sellerId = txData.sellerId;
    // P1: debit the EXACT amount credited to the seller (persisted at credit
    // time) so the lost-dispute debit and the original credit can never drift.
    // Under the deferred-credit model an uncredited tx has no sellerCreditedCents
    // and therefore a debit target of 0 (no false debt).
    const sellerPayoutCents =
      typeof txData.sellerCreditedCents === 'number' ? txData.sellerCreditedCents : 0;

    // F37: amount moved balance -> heldBalance at dispute.created (persisted).
    const freezeCents =
      typeof txData.disputeFreezeCents === 'number' ? txData.disputeFreezeCents : 0;

    const sellerWalletRef = sellerId ? db.collection('wallets').doc(sellerId) : null;
    const sellerWalletSnap = sellerWalletRef ? await tx.get(sellerWalletRef) : null;

    // F40: on a LOST dispute (chargeback) of a MIXED payment, the buyer recovers
    // the CARD portion through their bank, but the WALLET portion they already
    // spent at checkout is NOT clawed back by Stripe — the platform must re-credit
    // it (otherwise the buyer loses that part). Read the buyer wallet now (before
    // any write — Admin SDK READ_AFTER_WRITE) so the LOST branch can re-credit.
    const buyerId = txData.buyerId;
    const buyerWalletAmountUsed =
      typeof txData.walletAmountUsed === 'number' ? txData.walletAmountUsed : 0; // cents
    const buyerHasWalletPortion =
      buyerWalletAmountUsed > 0 &&
      (txData.paidVia === 'wallet_and_card' || txData.paidVia === 'mixed' || txData.paidVia === 'wallet');
    const buyerWalletRef =
      buyerHasWalletPortion && buyerId ? db.collection('wallets').doc(buyerId) : null;
    const buyerWalletSnap = buyerWalletRef ? await tx.get(buyerWalletRef) : null;

    if (outcome === 'won') {
      // Seller keeps the funds. F37: give the frozen amount back (heldBalance ->
      // balance) so the dispute_hold is never stranded. Restore the pre-dispute
      // status so the normal release cycle can resume; clear the dispute flag.
      if (freezeCents > 0 && sellerWalletRef && sellerWalletSnap && sellerWalletSnap.exists) {
        const walletData = sellerWalletSnap.data()!;
        const heldNow = walletData.heldBalance || 0;
        const releaseCents = Math.min(freezeCents, heldNow);
        if (releaseCents > 0) {
          tx.update(sellerWalletRef, {
            heldBalance: FieldValue.increment(-releaseCents),
            balance: FieldValue.increment(releaseCents),
            updatedAt: FieldValue.serverTimestamp(),
          });
          const ledgerRef = sellerWalletRef.collection('ledger').doc();
          tx.set(ledgerRef, {
            type: 'dispute_hold_released',
            amount: releaseCents,
            balanceAfter: (walletData.balance || 0) + releaseCents,
            description: 'Litige gagné — fonds gelés restitués',
            transactionId,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }

      const restored = txData.statusBeforeDispute || 'delivered';
      tx.update(txDoc.ref, {
        status: restored,
        disputed: false,
        disputeClosedAt: FieldValue.serverTimestamp(),
        disputeOutcome: 'won',
        disputeFreezeCents: 0,
      });

      logger.warn('Stripe webhook: dispute.closed WON — status restored, hold released', {
        transactionId,
        restored,
        releasedCents: freezeCents,
      });
      return;
    }

    if (outcome === 'lost') {
      // Stripe already clawed back the funds from the platform. F38: cascade the
      // debit pendingBalance -> heldBalance -> balance (aligned with
      // handleChargeRefunded) so a chargeback on a still-pending sale drains the
      // sale's own pending credit instead of other sales / false debt. Track any
      // shortfall as debt.
      if (sellerId && sellerPayoutCents > 0) {
        if (sellerWalletRef && sellerWalletSnap && sellerWalletSnap.exists) {
          const walletData = sellerWalletSnap.data()!;
          const pendingNow = walletData.pendingBalance || 0;
          const heldNow = walletData.heldBalance || 0;
          const balanceNow = walletData.balance || 0;

          const fromPending = Math.min(sellerPayoutCents, pendingNow);
          let remaining = sellerPayoutCents - fromPending;
          const fromHeld = Math.min(remaining, heldNow);
          remaining -= fromHeld;
          const fromBalance = Math.min(remaining, balanceNow);
          const shortfall = remaining - fromBalance;

          const walletUpdate: Record<string, any> = {
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (fromPending > 0) walletUpdate.pendingBalance = FieldValue.increment(-fromPending);
          if (fromHeld > 0) walletUpdate.heldBalance = FieldValue.increment(-fromHeld);
          if (fromBalance > 0) walletUpdate.balance = FieldValue.increment(-fromBalance);
          if (shortfall > 0) walletUpdate.sellerDebt = FieldValue.increment(shortfall);
          tx.update(sellerWalletRef, walletUpdate);

          const debited = fromPending + fromHeld + fromBalance;
          const ledgerRef = sellerWalletRef.collection('ledger').doc();
          tx.set(ledgerRef, {
            type: 'refund_debit',
            amount: debited,
            balanceAfter: (balanceNow - fromBalance),
            description:
              shortfall > 0
                ? 'Litige perdu — débit vendeur (dette enregistrée pour le solde manquant)'
                : 'Litige perdu — débit vendeur',
            transactionId,
            createdAt: FieldValue.serverTimestamp(),
            ...(shortfall > 0 && { debtRecorded: shortfall }),
          });

          // F37: if the debit took LESS from heldBalance than was frozen at
          // dispute.created (e.g. uncredited tx -> sellerPayoutCents = 0, or a
          // partial credit), the residual frozen amount would stay stranded in
          // heldBalance. Release exactly that residual back to balance.
          const residualHold = Math.max(0, freezeCents - fromHeld);
          const heldAfterDebit = heldNow - fromHeld;
          const releaseResidual = Math.min(residualHold, Math.max(0, heldAfterDebit));
          if (releaseResidual > 0) {
            tx.update(sellerWalletRef, {
              heldBalance: FieldValue.increment(-releaseResidual),
              balance: FieldValue.increment(releaseResidual),
            });
            const releaseLedgerRef = sellerWalletRef.collection('ledger').doc();
            tx.set(releaseLedgerRef, {
              type: 'dispute_hold_released',
              amount: releaseResidual,
              balanceAfter: (balanceNow - fromBalance) + releaseResidual,
              description: 'Litige perdu — surplus gelé restitué',
              transactionId,
              createdAt: FieldValue.serverTimestamp(),
            });
          }
        } else {
          // No wallet at all: record full payout as debt.
          logger.warn('Stripe webhook: dispute.closed LOST — seller wallet missing, recording full debt', {
            transactionId,
            sellerId,
          });
          const sellerWalletRefMissing = db.collection('wallets').doc(sellerId);
          tx.set(
            sellerWalletRefMissing,
            {
              sellerDebt: FieldValue.increment(sellerPayoutCents),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      } else if (
        // Uncredited tx (sellerPayoutCents = 0) but funds were still frozen at
        // dispute.created (rare): release the whole frozen amount on LOST so it
        // is never stranded. Stripe pulled the money from the platform, not from
        // a credit the seller never received.
        freezeCents > 0 &&
        sellerWalletRef &&
        sellerWalletSnap &&
        sellerWalletSnap.exists
      ) {
        const walletData = sellerWalletSnap.data()!;
        const heldNow = walletData.heldBalance || 0;
        const releaseCents = Math.min(freezeCents, heldNow);
        if (releaseCents > 0) {
          tx.update(sellerWalletRef, {
            heldBalance: FieldValue.increment(-releaseCents),
            balance: FieldValue.increment(releaseCents),
            updatedAt: FieldValue.serverTimestamp(),
          });
          const releaseLedgerRef = sellerWalletRef.collection('ledger').doc();
          tx.set(releaseLedgerRef, {
            type: 'dispute_hold_released',
            amount: releaseCents,
            balanceAfter: (walletData.balance || 0) + releaseCents,
            description: 'Litige perdu — surplus gelé restitué',
            transactionId,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }

      // F40: re-credit the buyer's WALLET portion of a mixed payment. The bank
      // refunds the card portion on a chargeback; the wallet portion is the
      // platform's responsibility. Idempotent: this LOST branch only runs while
      // status === 'disputed' and ends by setting status='refunded', so a replay
      // (already 'refunded') never re-enters and never double-credits.
      if (buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists && buyerWalletAmountUsed > 0) {
        const bwd = buyerWalletSnap.data()!;
        tx.update(buyerWalletRef, {
          balance: FieldValue.increment(buyerWalletAmountUsed),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
        tx.set(buyerLedgerRef, {
          type: 'refund_credit',
          amount: buyerWalletAmountUsed,
          balanceAfter: (bwd.balance || 0) + buyerWalletAmountUsed,
          description: 'Litige perdu — portion porte-monnaie restituée',
          transactionId,
          createdAt: FieldValue.serverTimestamp(),
        });
        logger.info('Stripe webhook: dispute.closed LOST — buyer wallet portion re-credited', {
          transactionId,
          buyerId,
          walletCents: buyerWalletAmountUsed,
        });
      } else if (buyerHasWalletPortion && (!buyerWalletSnap || !buyerWalletSnap.exists)) {
        // F40/F93: the buyer wallet doc is gone — do not silently drop the
        // re-credit. Create it with the owed balance so the buyer is made whole.
        const recreateRef = db.collection('wallets').doc(buyerId);
        tx.set(
          recreateRef,
          {
            balance: FieldValue.increment(buyerWalletAmountUsed),
            status: 'active',
            currency: 'cad',
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        const buyerLedgerRef = recreateRef.collection('ledger').doc();
        tx.set(buyerLedgerRef, {
          type: 'refund_credit',
          amount: buyerWalletAmountUsed,
          balanceAfter: buyerWalletAmountUsed,
          description: 'Litige perdu — portion porte-monnaie restituée (porte-monnaie recréé)',
          transactionId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      tx.update(txDoc.ref, {
        status: 'refunded',
        disputed: false,
        disputeClosedAt: FieldValue.serverTimestamp(),
        disputeOutcome: 'lost',
        refundedAt: FieldValue.serverTimestamp(),
        disputeFreezeCents: 0,
      });

      logger.warn('Stripe webhook: dispute.closed LOST — seller debited, transaction refunded', {
        transactionId,
      });
      return;
    }

    // Other outcomes (e.g. warning_closed): treat like WON — the seller keeps the
    // funds. F37: release the frozen hold, clear the flag, restore the status.
    if (freezeCents > 0 && sellerWalletRef && sellerWalletSnap && sellerWalletSnap.exists) {
      const walletData = sellerWalletSnap.data()!;
      const heldNow = walletData.heldBalance || 0;
      const releaseCents = Math.min(freezeCents, heldNow);
      if (releaseCents > 0) {
        tx.update(sellerWalletRef, {
          heldBalance: FieldValue.increment(-releaseCents),
          balance: FieldValue.increment(releaseCents),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const ledgerRef = sellerWalletRef.collection('ledger').doc();
        tx.set(ledgerRef, {
          type: 'dispute_hold_released',
          amount: releaseCents,
          balanceAfter: (walletData.balance || 0) + releaseCents,
          description: 'Litige clôturé — fonds gelés restitués',
          transactionId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }

    const restored = txData.statusBeforeDispute || 'delivered';
    tx.update(txDoc.ref, {
      status: restored,
      disputed: false,
      disputeClosedAt: FieldValue.serverTimestamp(),
      disputeOutcome: outcome || 'closed',
      disputeFreezeCents: 0,
    });

    logger.info('Stripe webhook: dispute.closed other outcome — status restored, hold released', {
      transactionId,
      outcome,
      releasedCents: freezeCents,
    });
  });
}

// =============================================================================
// HANDLER: payout.failed
// =============================================================================

/**
 * A Stripe payout to the seller's bank failed (e.g. invalid bank account).
 * The wallet was already debited at walletWithdraw time, so we must re-credit
 * the withdrawn amount AND reverse the platform->connected transfer (otherwise
 * the funds stay stranded on the Custom account and the next withdrawal would
 * double-finance). Both effects live in the shared revertFailedPayout helper so
 * the reconciliation replay (lost webhook) can re-drive the EXACT same logic.
 *
 * The payout is matched to its withdrawal_requests doc via metadata.
 * withdrawalRequestId (set by walletWithdraw inside the debit transaction).
 * Idempotent via the withdrawal request status.
 */
async function handlePayoutFailed(payout: any): Promise<void> {
  const withdrawalRequestId = payout.metadata?.withdrawalRequestId;
  const userId = payout.metadata?.firebaseUserId;

  if (typeof withdrawalRequestId !== 'string' || !withdrawalRequestId) {
    logger.warn('Stripe webhook: payout.failed missing withdrawalRequestId metadata', {
      payoutId: payout.id,
    });
    return;
  }

  await revertFailedPayout(
    {
      withdrawalRequestId,
      payoutId: payout.id,
      failureReason: payout.failure_message || payout.failure_code || null,
      ownerIdFallback: typeof userId === 'string' ? userId : null,
    },
    getStripe()
  );

  logger.warn('Stripe webhook: payout.failed — withdrawal reverted', {
    withdrawalRequestId,
    payoutId: payout.id,
  });
}

// =============================================================================
// HANDLER: payout.canceled (F42)
// =============================================================================

/**
 * A Stripe payout was canceled before reaching the bank. Identical financial
 * treatment to payout.failed: re-credit the wallet (debited at walletWithdraw
 * time) AND reverse the platform->connected transfer. revertFailedPayout is
 * idempotent via the withdrawal_requests status, so this is safe even if
 * payout.failed and payout.canceled both arrive for the same request.
 */
async function handlePayoutCanceled(payout: any): Promise<void> {
  const withdrawalRequestId = payout.metadata?.withdrawalRequestId;
  const userId = payout.metadata?.firebaseUserId;

  if (typeof withdrawalRequestId !== 'string' || !withdrawalRequestId) {
    logger.warn('Stripe webhook: payout.canceled missing withdrawalRequestId metadata', {
      payoutId: payout.id,
    });
    return;
  }

  await revertFailedPayout(
    {
      withdrawalRequestId,
      payoutId: payout.id,
      failureReason: 'payout canceled',
      ownerIdFallback: typeof userId === 'string' ? userId : null,
    },
    getStripe()
  );

  logger.warn('Stripe webhook: payout.canceled — withdrawal reverted', {
    withdrawalRequestId,
    payoutId: payout.id,
  });
}

// =============================================================================
// HANDLER: payout.paid
// =============================================================================

/**
 * A Stripe payout to the seller's bank succeeded. Close out the matching
 * withdrawal request. Idempotent via status. The wallet was already debited at
 * walletWithdraw time; nothing financial to do here, just bookkeeping.
 */
async function handlePayoutPaid(payout: any): Promise<void> {
  const withdrawalRequestId = payout.metadata?.withdrawalRequestId;

  if (typeof withdrawalRequestId !== 'string' || !withdrawalRequestId) {
    logger.warn('Stripe webhook: payout.paid missing withdrawalRequestId metadata', {
      payoutId: payout.id,
    });
    return;
  }

  const requestRef = db.collection('withdrawal_requests').doc(withdrawalRequestId);

  await db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) {
      logger.warn('Stripe webhook: payout.paid — withdrawal request not found', {
        withdrawalRequestId,
        payoutId: payout.id,
      });
      return;
    }

    const request = requestSnap.data()!;

    // Idempotence: only complete a request still processing.
    if (request.status !== 'processing') {
      logger.info('Stripe webhook: payout.paid — request not processing, skipping', {
        withdrawalRequestId,
        currentStatus: request.status,
      });
      return;
    }

    tx.update(requestRef, {
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      stripePayoutId: payout.id,
    });
  });

  logger.info('Stripe webhook: payout.paid — withdrawal completed', {
    withdrawalRequestId,
    payoutId: payout.id,
  });
}

// =============================================================================
// HANDLER: charge.refunded
// =============================================================================

async function handleChargeRefunded(charge: any): Promise<void> {
  const paymentIntentId = charge.payment_intent;

  if (!paymentIntentId) {
    logger.error('Stripe webhook: refund missing payment_intent on charge', {
      chargeId: charge.id,
    });
    return;
  }

  // F101/F28: charge.refunded fires for PARTIAL refunds too. The full
  // reconciliation below (mark 'refunded', re-credit the WHOLE wallet portion,
  // debit the ENTIRE sellerCreditedCents, relist the article) is only correct for
  // a TOTAL refund. A partial refund — a small commercial gesture from the Stripe
  // dashboard, OR an internal partial refund already reconciled by
  // issueTransactionRefund (return-leg B2) — must NOT unwind the whole sale. Only
  // proceed when amount_refunded >= amount (full). Otherwise dead-letter for human
  // review and stop (internal refunds are already reconciled in Firestore).
  const chargeAmount = typeof charge.amount === 'number' ? charge.amount : null;
  const amountRefunded =
    typeof charge.amount_refunded === 'number' ? charge.amount_refunded : null;
  if (chargeAmount !== null && amountRefunded !== null && amountRefunded < chargeAmount) {
    logger.warn('Stripe webhook: charge.refunded PARTIAL — not unwinding the sale (review)', {
      chargeId: charge.id,
      paymentIntentId,
      chargeAmount,
      amountRefunded,
    });
    await writeFailedOperation({
      type: 'amount_mismatch',
      refId: paymentIntentId,
      payload: {
        kind: 'partial_charge_refund',
        chargeId: charge.id,
        paymentIntentId,
        chargeAmount,
        amountRefunded,
        autoRefund: false,
      },
      error: 'Partial charge.refunded — full reconciliation skipped, manual review',
    });
    return;
  }

  // Look up the transaction by stripePaymentIntentId
  const txQuery = await db
    .collection('transactions')
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();

  if (txQuery.empty) {
    // Not a purchase — could be a swap cash top-up refund. Reconcile the payee
    // wallet: the complement sits in pendingBalance (pre-reception), heldBalance
    // (post-reception, inside the 7-day window) or balance (released by
    // releaseHeldFunds). handleSwapTopUpRefund cascades across the buckets.
    const swapQuery = await db
      .collection('swaps')
      .where('topUpPaymentIntentId', '==', paymentIntentId)
      .limit(1)
      .get();

    if (swapQuery.empty) {
      logger.error('Stripe webhook: refund — no transaction or swap found for PaymentIntent', {
        chargeId: charge.id,
        paymentIntentId,
      });
      return;
    }

    await handleSwapTopUpRefund(swapQuery.docs[0]);
    return;
  }

  const txDoc = txQuery.docs[0];
  const transactionId = txDoc.id;

  await db.runTransaction(async (tx) => {
    const txSnap = await tx.get(txDoc.ref);
    const txData = txSnap.data();

    if (!txData) return;

    // Idempotence: if already refunded, skip
    if (txData.status === 'refunded') {
      logger.info('Stripe webhook: refund skipping — already refunded', { transactionId });
      return;
    }

    // Mark transaction as refunded
    tx.update(txDoc.ref, {
      status: 'refunded',
      refundedAt: FieldValue.serverTimestamp(),
      stripeRefundId: charge.refunds?.data?.[0]?.id || null,
    });

    const sellerId = txData.sellerId;
    const paidVia = txData.paidVia;
    const walletAmountUsed = txData.walletAmountUsed || 0; // in cents

    // --- Handle wallet refund for buyer (mixed/100%-wallet payments) ---
    // The buyer's wallet portion is a purely INTERNAL movement: it was debited
    // from the buyer at checkout, so on refund it must be re-credited to the
    // buyer's wallet. The card portion is returned to the card by the Stripe
    // refund itself (a plain refund on the platform charge — single-rail model,
    // no transfer to reverse). This handler only reconciles the ledger.
    if (paidVia === 'wallet' || paidVia === 'wallet_and_card') {
      const buyerId = txData.buyerId;
      const buyerWalletRef = db.collection('wallets').doc(buyerId);
      const buyerWalletSnap = await tx.get(buyerWalletRef);

      if (buyerWalletSnap.exists) {
        const walletData = buyerWalletSnap.data()!;
        // Refund the wallet portion back to buyer's wallet
        const walletRefundAmount = paidVia === 'wallet'
          ? Math.round((txData.totalAmount || 0) * 100) // Full amount for 100% wallet
          : walletAmountUsed; // Wallet portion for mixed payments

        if (walletRefundAmount > 0) {
          tx.update(buyerWalletRef, {
            balance: FieldValue.increment(walletRefundAmount),
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Create refund ledger entry
          const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
          tx.set(buyerLedgerRef, {
            type: 'refund_credit',
            amount: walletRefundAmount,
            balanceAfter: (walletData.balance || 0) + walletRefundAmount,
            description:
              paidVia === 'wallet_and_card'
                ? 'Remboursement — portion porte-monnaie restituée'
                : 'Remboursement — retour au porte-monnaie',
            transactionId,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } else {
        logger.warn('Stripe webhook: refund — buyer wallet not found, cannot re-credit wallet portion', {
          transactionId,
          buyerId,
        });
      }
    }

    // --- Debit seller wallet of EXACTLY what was credited ---
    // P1: debit the precise amount that was credited to the seller for this sale
    // (persisted as sellerCreditedCents at credit time). Cascade across the
    // three buckets in escrow order pendingBalance -> heldBalance -> balance so
    // we drain wherever the funds currently sit (paid, delivered-in-window, or
    // released). Any remainder the seller no longer holds (already withdrawn) is
    // recorded as sellerDebt and blocks future withdrawals until recovered —
    // NEVER masked with min().
    //
    // P1 (atomicity): under the deferred-credit model the seller is credited
    // ONLY after the shipping label is created. A shipping transaction still
    // 'paid' with labelCreationPending was NEVER credited, so sellerCreditedCents
    // is absent and the debit target is 0 (debiting would create false debt).
    // The legacy derived-payout fallback is intentionally dropped here.
    const sellerWalletRef = db.collection('wallets').doc(sellerId);
    const sellerWalletSnap = await tx.get(sellerWalletRef);
    const sellerDebitTarget =
      typeof txData.sellerCreditedCents === 'number' ? txData.sellerCreditedCents : 0;

    if (sellerDebitTarget > 0) {
      if (sellerWalletSnap.exists) {
        const sellerWalletData = sellerWalletSnap.data()!;
        const pendingNow = sellerWalletData.pendingBalance || 0;
        const heldNow = sellerWalletData.heldBalance || 0;
        const balanceNow = sellerWalletData.balance || 0;

        const fromPending = Math.min(sellerDebitTarget, pendingNow);
        let remaining = sellerDebitTarget - fromPending;
        const fromHeld = Math.min(remaining, heldNow);
        remaining -= fromHeld;
        const fromBalance = Math.min(remaining, balanceNow);
        const shortfall = remaining - fromBalance;

        const walletUpdate: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (fromPending > 0) walletUpdate.pendingBalance = FieldValue.increment(-fromPending);
        if (fromHeld > 0) walletUpdate.heldBalance = FieldValue.increment(-fromHeld);
        if (fromBalance > 0) walletUpdate.balance = FieldValue.increment(-fromBalance);
        if (shortfall > 0) walletUpdate.sellerDebt = FieldValue.increment(shortfall);
        tx.update(sellerWalletRef, walletUpdate);

        const debited = fromPending + fromHeld + fromBalance;
        const sellerLedgerRef = sellerWalletRef.collection('ledger').doc();
        tx.set(sellerLedgerRef, {
          type: 'refund_debit',
          amount: debited,
          balanceAfter: balanceNow - fromBalance,
          description:
            shortfall > 0
              ? 'Remboursement Stripe — débit vendeur (dette enregistrée pour le solde manquant)'
              : 'Remboursement Stripe — débit vendeur',
          transactionId,
          createdAt: FieldValue.serverTimestamp(),
          ...(shortfall > 0 && { debtRecorded: shortfall }),
        });

        if (shortfall > 0) {
          logger.warn('Stripe webhook: refund — seller balance insufficient, debt recorded', {
            transactionId,
            sellerId,
            debitTarget: sellerDebitTarget,
            debited,
            shortfall,
          });
        }
      } else {
        // No wallet at all: the seller was paid (destination charge / earlier
        // credit) but the wallet doc is gone — record the full amount as debt so
        // the loss is tracked and future withdrawals stay blocked.
        logger.warn('Stripe webhook: refund — seller wallet missing, recording full debt', {
          transactionId,
          sellerId,
          debitTarget: sellerDebitTarget,
        });
        tx.set(
          sellerWalletRef,
          {
            sellerDebt: FieldValue.increment(sellerDebitTarget),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        const sellerLedgerRef = sellerWalletRef.collection('ledger').doc();
        tx.set(sellerLedgerRef, {
          type: 'refund_debit',
          amount: 0,
          balanceAfter: 0,
          description: 'Remboursement Stripe — porte-monnaie absent, dette enregistrée',
          transactionId,
          createdAt: FieldValue.serverTimestamp(),
          debtRecorded: sellerDebitTarget,
        });
      }
    }

    // Release the article
    if (txData.articleId) {
      const articleRef = db.collection('articles').doc(txData.articleId);
      const articleSnap = await tx.get(articleRef);
      if (articleSnap.exists) {
        tx.update(articleRef, { isSold: false });
      }
    }
  });

  logger.warn('Stripe webhook: charge refunded — transaction marked refunded, balances adjusted', {
    transactionId,
    chargeId: charge.id,
    paymentIntentId,
  });
}

// =============================================================================
// HANDLER: refund.failed (F104)
// =============================================================================

/**
 * A previously-created refund did NOT settle (e.g. the original card can no
 * longer be credited). We optimistically mark transactions 'refunded' when we
 * CREATE the refund, so a failed refund means our internal state says "refunded"
 * while the buyer was never actually reimbursed. Code cannot pick an alternate
 * refund channel automatically, so raise a CRITICAL admin alert keyed by the
 * payment intent and ACK 200 (informational — never 400, which would loop).
 * Idempotent: writes an admin_alert (operators dedup by refId + kind).
 */
async function handleRefundFailed(refund: any): Promise<void> {
  const paymentIntentId =
    typeof refund.payment_intent === 'string' ? refund.payment_intent : null;
  const refId = paymentIntentId || (typeof refund.id === 'string' ? refund.id : 'unknown');

  logger.error('CRITICAL Stripe webhook: refund.failed — buyer NOT reimbursed', {
    refundId: refund.id,
    paymentIntentId,
    failureReason: refund.failure_reason || null,
    status: refund.status,
  });

  await writeAdminAlert({
    kind: 'refund_failed',
    severity: 'critical',
    refId,
    message:
      'Un remboursement Stripe a échoué — la transaction est marquée remboursée mais l\'acheteur n\'a pas été crédité. Canal de remboursement alternatif requis.',
    context: {
      refundId: refund.id ?? null,
      paymentIntentId,
      failureReason: refund.failure_reason ?? null,
      amount: refund.amount ?? null,
    },
  });
}

// =============================================================================
// HANDLER: refund.updated (F104)
// =============================================================================

/**
 * refund.updated fires on any refund state change. Only the terminal 'failed'
 * status is actionable for us (it means the buyer was never reimbursed) — we
 * route that to the same alert as refund.failed. Every other transition
 * (pending -> succeeded, etc.) is informational; log + ACK so Stripe never
 * retries in a loop.
 */
async function handleRefundUpdated(refund: any): Promise<void> {
  if (refund.status === 'failed' || refund.status === 'canceled') {
    await handleRefundFailed(refund);
    return;
  }
  logger.info('Stripe webhook: refund.updated (informational)', {
    refundId: refund.id,
    status: refund.status,
    paymentIntentId: refund.payment_intent ?? null,
  });
}

/**
 * Reconcile a swap top-up refund on the payee wallet.
 *
 * The refund was issued via stripe.refunds.create(...) in the swap callable
 * (cancelSwap / openSwapDispute) or the cancelled-race auto-refund above. This
 * handler claws the complement back from wherever it currently sits, cascading
 * pendingBalance -> heldBalance -> balance (the three escrow buckets), and writes
 * a refund_debit ledger entry. Any shortfall becomes sellerDebt. Idempotent via
 * topUpRefundReconciledAt.
 */
async function handleSwapTopUpRefund(swapDoc: FirebaseFirestore.QueryDocumentSnapshot): Promise<void> {
  const swapId = swapDoc.id;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(swapDoc.ref);
    const swap = snap.data();
    if (!swap) return;

    // Idempotence
    if (swap.topUpRefundReconciledAt) {
      logger.info('Stripe webhook: swap top-up refund already reconciled', { swapId });
      return;
    }

    const topUp = swap.cashTopUp;
    if (topUp == null || typeof topUp.amount !== 'number') {
      logger.warn('Stripe webhook: swap top-up refund — no cashTopUp on swap', { swapId });
      tx.update(swapDoc.ref, { topUpRefundReconciledAt: FieldValue.serverTimestamp() });
      return;
    }

    const payeeId = topUp.payerId === swap.initiatorId ? swap.receiverId : swap.initiatorId;
    const baseAmountCents = Math.round(topUp.amount);

    const payeeWalletRef = db.collection('wallets').doc(payeeId);
    const payeeWalletSnap = await tx.get(payeeWalletRef);

    if (payeeWalletSnap.exists) {
      const walletData = payeeWalletSnap.data()!;
      // The top-up complement can sit in one of three buckets depending on the
      // swap stage when the refund lands (mirrors the purchase 3-bucket model):
      //   pendingBalance — pre-reception (topUpFundsHeldAt unset)
      //   heldBalance    — post-reception, inside the 7-day window
      //                    (topUpFundsHeldAt set, topUpReleasedAt unset)
      //   balance        — released by releaseHeldFunds (topUpReleasedAt set)
      // Cascade pending -> held -> balance so we drain wherever the funds
      // actually are. The platform refunds the payer in full via Stripe; this
      // only reconciles the internal ledger. Any shortfall (payee already
      // withdrew released funds) is recorded as sellerDebt and blocks future
      // withdrawals until recovered — NEVER masked.
      const pendingNow = walletData.pendingBalance || 0;
      const heldNow = walletData.heldBalance || 0;
      const balanceNow = walletData.balance || 0;

      const fromPending = Math.min(baseAmountCents, pendingNow);
      let remaining = baseAmountCents - fromPending;
      const fromHeld = Math.min(remaining, heldNow);
      remaining -= fromHeld;
      const fromBalance = Math.min(remaining, balanceNow);
      const shortfall = remaining - fromBalance;

      const walletUpdate: Record<string, any> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (fromPending > 0) walletUpdate.pendingBalance = FieldValue.increment(-fromPending);
      if (fromHeld > 0) walletUpdate.heldBalance = FieldValue.increment(-fromHeld);
      if (fromBalance > 0) walletUpdate.balance = FieldValue.increment(-fromBalance);
      if (shortfall > 0) walletUpdate.sellerDebt = FieldValue.increment(shortfall);
      tx.update(payeeWalletRef, walletUpdate);

      const debited = fromPending + fromHeld + fromBalance;
      const ledgerRef = payeeWalletRef.collection('ledger').doc();
      tx.set(ledgerRef, {
        type: 'refund_debit',
        amount: debited,
        balanceAfter: balanceNow - fromBalance,
        description:
          shortfall > 0
            ? 'Remboursement complément d\'échange — débit (dette enregistrée pour le solde manquant)'
            : 'Remboursement complément d\'échange — débit',
        swapId,
        createdAt: FieldValue.serverTimestamp(),
        ...(shortfall > 0 && { debtRecorded: shortfall }),
      });

      if (shortfall > 0) {
        logger.warn('Stripe webhook: swap top-up refund — payee balance insufficient, debt recorded', {
          swapId,
          payeeId,
          debitTarget: baseAmountCents,
          debited,
          shortfall,
        });
      }
    } else {
      logger.warn('Stripe webhook: swap top-up refund — payee wallet not found', { swapId, payeeId });
    }

    tx.update(swapDoc.ref, {
      topUpRefundReconciledAt: FieldValue.serverTimestamp(),
      stripeRefundId: swap.topUpRefundId || null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.warn('Stripe webhook: swap top-up refund reconciled', { swapId });
}

// =============================================================================
// HANDLER: account.updated
// =============================================================================

async function handleAccountUpdated(account: any): Promise<void> {
  const stripeAccountId = account.id;

  if (!stripeAccountId) {
    logger.warn('Stripe webhook: account.updated missing account id');
    return;
  }

  // Find the user with this Stripe account
  const usersQuery = await db
    .collection('users')
    .where('stripeAccountId', '==', stripeAccountId)
    .limit(1)
    .get();

  if (usersQuery.empty) {
    logger.info('Stripe webhook: no user found for Stripe account', { stripeAccountId });
    return;
  }

  const userDoc = usersQuery.docs[0];
  const userData = userDoc.data() || {};

  // Derive the canonical account state — works for both Standard and Custom
  // accounts and persists KYC requirements (F59) + bank status alongside the
  // charges/payouts/details booleans (F62/F117). Never undefined.
  const state = deriveStripeAccountState(account);
  const updateData = stripeAccountFirestoreFields(state);

  await userDoc.ref.update(updateData);

  // KYC continuous remediation (F59c): notify the seller — idempotently — when
  // a NEW requirement appears or the account becomes restricted. We compare the
  // freshly derived currently_due against the previously persisted set so a
  // stream of identical account.updated events does not spam the seller.
  const prevDue: string[] = Array.isArray(userData.stripeRequirementsCurrentlyDue)
    ? userData.stripeRequirementsCurrentlyDue
    : [];
  const nowDue = state.requirementsCurrentlyDue;
  const prevDisabledReason =
    typeof userData.stripeRequirementsDisabledReason === 'string'
      ? userData.stripeRequirementsDisabledReason
      : null;
  const hasNewRequirement = nowDue.some((r) => !prevDue.includes(r));
  const newlyDisabled =
    state.disabledReason !== null && state.disabledReason !== prevDisabledReason;

  if (nowDue.length > 0 && (hasNewRequirement || newlyDisabled)) {
    try {
      await sendPushNotification(
        userDoc.id,
        'Action requise sur votre compte vendeur',
        'Stripe a besoin d\'informations supplementaires pour debloquer vos paiements. Ouvrez l\'application pour les fournir.',
        {
          type: 'stripe_requirements_due',
          stripeAccountId,
        },
        'stripe_requirements_due'
      );
    } catch (notifyErr) {
      logger.warn('Stripe webhook: failed to notify seller of new KYC requirement', {
        userId: userDoc.id,
        stripeAccountId,
        error: notifyErr instanceof Error ? notifyErr.message : notifyErr,
      });
    }
  }

  logger.info('Stripe webhook: seller account status updated', {
    userId: userDoc.id,
    stripeAccountId,
    status: state.status,
    chargesEnabled: state.chargesEnabled,
    payoutsEnabled: state.payoutsEnabled,
    requirementsCurrentlyDue: nowDue,
    disabledReason: state.disabledReason,
    hasExternalAccount: state.hasExternalAccount,
  });
}
