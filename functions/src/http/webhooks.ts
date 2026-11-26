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
import { getStripe } from '../config/stripe';
import { withFinancialRecoveryScope, assertFinancialRecoveryEffect, preserveFinancialRecoveryObservation, FinancialRecoveryBlocked } from '../utils/financialRecoveryInterlock';
import { recoveryDigest } from '../config/recoveryControl';

function recoveryStripeFacts(event: {created?: number; data: {object: unknown}}): {ids: string[]; facts: Record<string,string|number|boolean|null>} {
  const object = event.data.object as Record<string,unknown>, facts: Record<string,string|number|boolean|null> = {};
  if (Number.isSafeInteger(event.created)) facts.eventCreated = event.created!;
  for (const key of ['status','amount','amount_received','amount_refunded','amount_reversed','currency','created','livemode']) {
    const value = object[key];
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isSafeInteger(value) ||
        typeof value === 'string' && value.length <= 120 && /^[a-zA-Z0-9_. :/-]*$/.test(value)) facts[key] = value;
  }
  const metadata = object.metadata as Record<string,unknown> | undefined;
  for (const key of ['transactionId','orderId','swapId','secondAccountOperationId','refundIntentId','withdrawalId','walletRequestId','checkoutIntentId']) {
    const value = metadata?.[key];
    if (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(value)) facts[`native_${key}`] = value;
  }
  const ids = ['id','payment_intent','charge','destination','transfer','refund','balance_transaction'].map(key => object[key])
    .map(value => typeof value === 'string' ? value : value && typeof value === 'object' ? (value as {id?:unknown}).id : null)
    .filter((value): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(value));
  return {ids, facts};
}

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

    let recoveryEvidencePreserved = false;
    try {
      // Authentication precedes all preservation. Every accepted event has a
      // private, immutable copy of its bounded causal facts OUTSIDE the restored
      // database, even when a restored stripe_events marker would skip it.
      const causal = recoveryStripeFacts(event);
      await preserveFinancialRecoveryObservation({provider:'stripe', eventId:event.id, eventType:event.type,
        payloadHash:recoveryDigest((req as {rawBody?:Buffer}).rawBody ?? Buffer.from(JSON.stringify(event))),
        accountId:event.account ?? null, liveMode:event.livemode, objectIds:causal.ids, facts:causal.facts});
      recoveryEvidencePreserved = true;
      const result = await withFinancialRecoveryScope({operation:'stripeWebhook',sourceRefs:[event.id,...causal.ids]}, async () => {
      await assertFinancialRecoveryEffect('webhook_admission', {refs:[event.id,...causal.ids]});
      const eventType = event.type;
      const isFraudSignalEvent = eventType === 'radar.early_fraud_warning.created' || eventType === 'radar.early_fraud_warning.updated' ||
        eventType === 'review.opened' || eventType === 'review.closed';

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
        // Legacy unhandled markers did not contain a fraud-review receipt.
        // The private producer qualifies its own permanent receipt before ACK.
        if (isFraudSignalEvent) await handleFraudSignal(event);
        logger.info('Stripe webhook: duplicate event ignored', {
          eventId: event.id,
          eventType,
        });
        return { received: true };
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
          await handlePaymentIntentSucceeded(event.data.object, { eventId: event.id, source: 'signed_event',
            accountId: event.account === undefined ? null : event.account,
            stripeContext: event.context === undefined ? null : event.context });
        }
      }

      // =======================================================================
      // PAYMENT_INTENT.PAYMENT_FAILED
      // =======================================================================

      else if (eventType === 'payment_intent.payment_failed') {
        await handlePaymentIntentFailed(event.data.object);
      }
      else if (eventType === 'payment_intent.canceled') {
        if (event.data.object?.metadata?.type === 'shop_tier') await handleShopTierCanceled(event.data.object);
        else if (event.data.object?.metadata?.type !== 'swap_topup') {
          const { observeCanceledPurchase } = await import('../utils/paymentCheckoutReconciliation');
          await observeCanceledPurchase(event.data.object, `stripeWebhook:${event.id}`);
        }
      }

      // =======================================================================
      // CHARGE.DISPUTE.CREATED — Buyer opened a dispute
      // =======================================================================

      else if (eventType === 'charge.dispute.created') {
        await recordBankDisputeCaseEvent(event);
        await handleDisputeCreated(event.data.object);
      }

      // =======================================================================
      // CHARGE.DISPUTE.CLOSED — Dispute resolved (won / lost)
      // =======================================================================

      else if (eventType === 'charge.dispute.closed') {
        await recordBankDisputeCaseEvent(event);
        await handleDisputeClosed(event.data.object);
      }

      else if (isFraudSignalEvent) {
        await handleFraudSignal(event);
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
      } else if (eventType === 'refund.created') {
        await handleRefundCreated(event.data.object);
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

      else if (eventType === 'charge.dispute.updated') {
        await recordBankDisputeCaseEvent(event);
      }
      else if (
        eventType === 'charge.dispute.funds_withdrawn' ||
        eventType === 'charge.dispute.funds_reinstated'
      ) {
        await recordBankDisputeCaseEvent(event);
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
        await handleAccountUpdated(event.data.object, event.id);
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
        await assertFinancialRecoveryEffect('firestore_commit', {refs:[eventMarkerRef.path]});
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
        if (markerErr instanceof FinancialRecoveryBlocked) throw markerErr;
        logger.info('Stripe webhook: event marker already claimed (concurrent delivery)', {
          eventId: event.id,
          eventType,
          error: markerErr instanceof Error ? markerErr.message : markerErr,
        });
      }

      return { received: true };
      });
      res.json(result);
    } catch (error: unknown) {
      if (recoveryEvidencePreserved && error instanceof FinancialRecoveryBlocked) {
        res.json({received:true, deferred:true}); return;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error processing Stripe webhook', { error: message });
      res.status(500).send(`Webhook processing error: ${message}`);
    }
  }
);

// =============================================================================
// HANDLER: payment_intent.succeeded
// =============================================================================

import { handlePaymentIntentFailed, handlePaymentIntentSucceeded } from './stripe/payment';
import { handleShopTierSucceeded, handleShopTierCanceled } from './stripe/shopTier';
import { handleSwapTopUpSucceeded } from './stripe/swapTopUp';
import { handleDisputeClosed, handleDisputeCreated, recordBankDisputeCaseEvent } from './stripe/disputes';
import { handlePayoutCanceled, handlePayoutFailed, handlePayoutPaid } from './stripe/payouts';
import { handleChargeRefunded, handleRefundFailed, handleRefundUpdated, handleRefundCreated } from './stripe/refunds';
import { handleAccountUpdated } from './stripe/account';
import { handleFraudSignal } from './stripe/fraudSignals';

export { redrivePaymentIntentSucceeded } from './stripe/redrive';
