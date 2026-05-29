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
import { db, FieldValue } from '../config/firebase';
import { getShipEngine } from '../config/shipEngine';
import { getStripe } from '../config/stripe';
import { sendPushNotification } from '../utils/notifications';
import { getOrCreateSellerWallet } from '../callable/wallet';
import { creditSellerForSale, reconcileShippingCost } from '../utils/labelFulfillment';

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
    secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SHIPENGINE_API_KEY'],
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
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    if (endpointSecret && sig) {
      // Production path: verify signature
      try {
        event = stripe.webhooks.constructEvent(
          (req as any).rawBody,
          sig,
          endpointSecret
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.error('Stripe webhook: signature verification failed', { error: message });
        res.status(401).send(`Webhook signature verification failed: ${message}`);
        return;
      }
    } else if (!endpointSecret) {
      logger.error('Stripe webhook: STRIPE_WEBHOOK_SECRET not configured — rejecting request');
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
      // UNIVERSAL IDEMPOTENCE — dedup by Stripe event.id
      // =======================================================================
      // Stripe may deliver the same event multiple times (retries on a slow
      // ACK, at-least-once delivery). We atomically claim each event.id by
      // creating a stripe_events/{event.id} marker doc inside a transaction.
      // If the marker already exists, the event was already handled — ACK and
      // return without re-running any handler. The per-status guards inside
      // each handler remain as defense-in-depth.
      const eventMarkerRef = db.collection('stripe_events').doc(event.id);
      const alreadyHandled = await db.runTransaction(async (tx) => {
        const markerSnap = await tx.get(eventMarkerRef);
        if (markerSnap.exists) {
          return true;
        }
        tx.create(eventMarkerRef, {
          type: eventType,
          createdAt: FieldValue.serverTimestamp(),
        });
        return false;
      });

      if (alreadyHandled) {
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
        if (event.data.object?.metadata?.type === 'swap_topup') {
          await handleSwapTopUpSucceeded(event.data.object);
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
      // CHARGE.REFUNDED — Full or partial refund processed
      // =======================================================================

      else if (eventType === 'charge.refunded') {
        await handleChargeRefunded(event.data.object);
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
    const expectedAmount = txData.totalAmount;
    if (expectedAmount != null) {
      if (isMixedPayment) {
        // Card portion = total - wallet portion
        const expectedStripeDollars = expectedAmount - (walletAmountUsedCents / 100);
        if (Math.abs(amountReceivedDollars - expectedStripeDollars) > 0.01) {
          logger.error('Stripe webhook: amount mismatch (mixed payment)', {
            transactionId,
            received: amountReceivedDollars,
            expectedStripe: expectedStripeDollars,
            expectedTotal: expectedAmount,
            walletCents: walletAmountUsedCents,
          });
          throw new Error('Payment amount does not match expected card portion');
        }
      } else {
        if (Math.abs(amountReceivedDollars - expectedAmount) > 0.01) {
          logger.error('Stripe webhook: amount mismatch', {
            transactionId,
            received: amountReceivedDollars,
            expected: expectedAmount,
          });
          throw new Error('Payment amount does not match transaction total');
        }
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
      };
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

    // --- Credit seller's wallet pendingBalance ---
    // P1 (atomicity payment<->label): for SHIPPING transactions the seller is
    // credited ONLY after the shipping label is successfully created (deferred
    // to the label step / sweepPendingLabels). Crediting here then failing the
    // label would leave the seller paid for a parcel that never ships. For
    // non-shipping (meetup is handled elsewhere; this guards anything that is
    // not 'shipping') there is no label, so we credit immediately.
    const sellerId = txData.sellerId;
    if (txData.deliveryType !== 'shipping') {
      await creditSellerForSale(tx, transactionRef, txData, transactionId);
    }

    return {
      processed: true,
      sellerId,
      chatId: txData.chatId,
      shipEngineRateId: txData.shipEngineRateId,
      deliveryType: txData.deliveryType,
      shippingCost: typeof txData.shippingCost === 'number' ? txData.shippingCost : 0,
      articleId: txData.articleId,
      articleTitle: txData.articleTitle || null,
    };
  });

  if (!result.processed) {
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
  // SHIPPING LABEL (non-atomic, external call — safe to retry separately)
  // =====================================================================

  let trackingNumber = '';
  let labelUrl = '';
  let trackingUrl = '';
  let carrierCode = '';

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
        try {
          const label = await shipEngine.createLabel(rateId);
          trackingNumber = label.trackingNumber;
          labelUrl = label.labelDownload.href;
          trackingUrl = label.trackingUrl;
          carrierCode = label.carrierCode;

          // ATOMIC: credit the seller (now that the label exists), reconcile the
          // real label cost vs the estimated shippingCost, persist label fields,
          // clear the pending flag, and mark 'label_created' — all in one tx.
          // NOTE: status is 'label_created', NOT 'shipped'. A label existing does
          // not mean the parcel was handed to the carrier. The first real carrier
          // scan (tracking poller / ShipEngine webhook) advances label_created ->
          // shipped, which lets the stale-label sweep nudge non-shipping sellers.
          await db.runTransaction(async (tx) => {
            const txSnap = await tx.get(transactionRef);
            const tdata = txSnap.data();
            if (!tdata) return;
            // Idempotence: don't re-credit / re-label if already advanced.
            if (
              tdata.status === 'label_created' ||
              tdata.status === 'shipped' ||
              tdata.status === 'delivered'
            )
              return;

            await creditSellerForSale(tx, transactionRef, tdata, transactionId);

            const update: Record<string, any> = {
              trackingNumber,
              shippingLabelUrl: labelUrl,
              trackingUrl,
              carrierCode,
              trackingStatus: 'LABEL_CREATED',
              shipEngineLabelId: label.labelId,
              status: 'label_created',
              labelCreatedAt: FieldValue.serverTimestamp(),
              labelCreationPending: false,
            };
            reconcileShippingCost(label, result.shippingCost ?? 0, transactionId, update);
            tx.update(transactionRef, update);
          });

          logger.info('ShipEngine label created — seller credited, transaction marked shipped', {
            transactionId,
            trackingNumber,
            carrierCode,
          });
        } catch (labelError) {
          logger.error('Error creating ShipEngine label (deferring to sweepPendingLabels)', {
            transactionId,
            error: labelError instanceof Error ? labelError.message : labelError,
          });
          // Payment is still valid but the seller is NOT credited and the
          // transaction stays 'paid'. sweepPendingLabels will re-rate + retry.
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

  await db.runTransaction(async (tx) => {
    const swapSnap = await tx.get(swapRef);
    const swap = swapSnap.data();

    if (!swap) {
      logger.error('Stripe webhook: swap_topup swap not found', { swapId });
      return;
    }

    // SECURITY: verify the charged amount matches base + fee from the swap doc.
    const expectedTotalCents = baseAmountCents + (swap.topUpFee || 0);
    if (Math.abs(amountReceivedCents - expectedTotalCents) > 1) {
      logger.error('Stripe webhook: swap_topup amount mismatch', {
        swapId,
        received: amountReceivedCents,
        expected: expectedTotalCents,
      });
      throw new Error('Swap top-up amount does not match expected total');
    }

    // IDEMPOTENCE: only advance a swap still awaiting payment.
    if (swap.status !== 'payment_pending') {
      logger.info('Stripe webhook: swap_topup already processed or not pending', {
        swapId,
        currentStatus: swap.status,
      });
      return;
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
  });

  logger.info('Stripe webhook: swap top-up confirmed, swap advanced to accepted', {
    swapId,
    paymentIntentId: paymentIntent.id,
    payeeId,
  });
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

    // Cancel the transaction
    tx.update(transactionRef, {
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: 'payment_failed',
    });

    // Release the article so it can be purchased again
    if (txData.articleId) {
      const articleRef = db.collection('articles').doc(txData.articleId);
      const articleSnap = await tx.get(articleRef);
      if (articleSnap.exists) {
        tx.update(articleRef, { isSold: false });
      }
    }

    // F02: Refund wallet portion if this was a mixed wallet+card payment
    const walletAmountUsed = txData.walletAmountUsed || 0; // in cents
    if (walletAmountUsed > 0 && (txData.paidVia === 'wallet_and_card' || txData.paidVia === 'wallet')) {
      const buyerId = txData.buyerId;
      const buyerWalletRef = db.collection('wallets').doc(buyerId);
      const buyerWalletSnap = await tx.get(buyerWalletRef);

      if (buyerWalletSnap.exists) {
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

    if (sellerId && sellerPayoutCents > 0) {
      const sellerWalletRef = db.collection('wallets').doc(sellerId);
      const sellerWalletSnap = await tx.get(sellerWalletRef);

      if (sellerWalletSnap.exists) {
        const walletData = sellerWalletSnap.data()!;
        const balanceNow = walletData.balance || 0;
        // Only move what's actually sitting in withdrawable balance.
        const freezeCents = Math.min(sellerPayoutCents, balanceNow);

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
    // restore the normal release cycle (paid/shipped/delivered).
    tx.update(txDoc.ref, {
      status: 'disputed',
      statusBeforeDispute: txData.status,
      disputed: true,
      disputeId: dispute.id,
      disputedAt: FieldValue.serverTimestamp(),
      disputeReason: dispute.reason || null,
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
 *  - WON (dispute.status === 'won'): the seller keeps the money. Restore the
 *    transaction status that preceded the dispute so the normal release cycle
 *    resumes (heldBalance -> balance via releaseHeldFunds), and clear the
 *    `disputed` flag. Funds stay where they are (heldBalance / pendingBalance).
 *
 *  - LOST (dispute.status === 'lost'): Stripe has already pulled the money back
 *    from the platform. Debit the seller: take from heldBalance first, then
 *    balance. If the seller doesn't have enough (already withdrawn before the
 *    freeze), record the shortfall as `sellerDebt` (blocks future withdrawals)
 *    and write a 'refund_debit' ledger entry. Mark the transaction 'refunded'.
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

    if (outcome === 'won') {
      // Seller keeps the funds. Restore the pre-dispute status so the normal
      // release cycle can resume; clear the dispute flag.
      const restored = txData.statusBeforeDispute || 'delivered';
      tx.update(txDoc.ref, {
        status: restored,
        disputed: false,
        disputeClosedAt: FieldValue.serverTimestamp(),
        disputeOutcome: 'won',
      });

      logger.warn('Stripe webhook: dispute.closed WON — status restored', {
        transactionId,
        restored,
      });
      return;
    }

    if (outcome === 'lost') {
      // Stripe already clawed back the funds from the platform. Debit the
      // seller: heldBalance first, then balance. Track any shortfall as debt.
      if (sellerId && sellerPayoutCents > 0) {
        const sellerWalletRef = db.collection('wallets').doc(sellerId);
        const sellerWalletSnap = await tx.get(sellerWalletRef);

        if (sellerWalletSnap.exists) {
          const walletData = sellerWalletSnap.data()!;
          const heldNow = walletData.heldBalance || 0;
          const balanceNow = walletData.balance || 0;

          const fromHeld = Math.min(sellerPayoutCents, heldNow);
          const remainingAfterHeld = sellerPayoutCents - fromHeld;
          const fromBalance = Math.min(remainingAfterHeld, balanceNow);
          const shortfall = remainingAfterHeld - fromBalance;

          const walletUpdate: Record<string, any> = {
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (fromHeld > 0) walletUpdate.heldBalance = FieldValue.increment(-fromHeld);
          if (fromBalance > 0) walletUpdate.balance = FieldValue.increment(-fromBalance);
          if (shortfall > 0) walletUpdate.sellerDebt = FieldValue.increment(shortfall);
          tx.update(sellerWalletRef, walletUpdate);

          const debited = fromHeld + fromBalance;
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
      }

      tx.update(txDoc.ref, {
        status: 'refunded',
        disputed: false,
        disputeClosedAt: FieldValue.serverTimestamp(),
        disputeOutcome: 'lost',
        refundedAt: FieldValue.serverTimestamp(),
      });

      logger.warn('Stripe webhook: dispute.closed LOST — seller debited, transaction refunded', {
        transactionId,
      });
      return;
    }

    // Other outcomes (e.g. warning_closed): clear the flag, restore status.
    const restored = txData.statusBeforeDispute || 'delivered';
    tx.update(txDoc.ref, {
      status: restored,
      disputed: false,
      disputeClosedAt: FieldValue.serverTimestamp(),
      disputeOutcome: outcome || 'closed',
    });

    logger.info('Stripe webhook: dispute.closed other outcome — status restored', {
      transactionId,
      outcome,
    });
  });
}

// =============================================================================
// HANDLER: payout.failed
// =============================================================================

/**
 * A Stripe payout to the seller's bank failed (e.g. invalid bank account).
 * The wallet was already debited at walletWithdraw time, so we must re-credit
 * the withdrawn amount and mark the withdrawal request 'failed'.
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

  const requestRef = db.collection('withdrawal_requests').doc(withdrawalRequestId);

  await db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) {
      logger.warn('Stripe webhook: payout.failed — withdrawal request not found', {
        withdrawalRequestId,
        payoutId: payout.id,
      });
      return;
    }

    const request = requestSnap.data()!;

    // Idempotence: only act on a request still in flight.
    if (request.status !== 'processing') {
      logger.info('Stripe webhook: payout.failed — request not processing, skipping', {
        withdrawalRequestId,
        currentStatus: request.status,
      });
      return;
    }

    const amount = request.amount; // CENTS
    const ownerId = request.userId || userId;

    if (typeof amount === 'number' && amount > 0 && ownerId) {
      const walletRef = db.collection('wallets').doc(ownerId);
      const walletSnap = await tx.get(walletRef);
      if (walletSnap.exists) {
        const walletData = walletSnap.data()!;
        tx.update(walletRef, {
          balance: FieldValue.increment(amount),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const ledgerRef = walletRef.collection('ledger').doc();
        tx.set(ledgerRef, {
          type: 'withdrawal_failed',
          amount,
          balanceAfter: (walletData.balance || 0) + amount,
          description: 'Retrait échoué — fonds restitués',
          withdrawalRequestId,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        logger.warn('Stripe webhook: payout.failed — wallet not found, cannot re-credit', {
          withdrawalRequestId,
          ownerId,
        });
      }
    }

    tx.update(requestRef, {
      status: 'failed',
      failedAt: FieldValue.serverTimestamp(),
      stripePayoutId: payout.id,
      failureReason: payout.failure_message || payout.failure_code || null,
    });
  });

  logger.warn('Stripe webhook: payout.failed — withdrawal reverted', {
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

  // Look up the transaction by stripePaymentIntentId
  const txQuery = await db
    .collection('transactions')
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();

  if (txQuery.empty) {
    // Not a purchase — could be a swap cash top-up refund. Reconcile the payee
    // wallet pendingBalance (the funds were never released to balance because a
    // top-up is only released to balance at confirmSwapReception, and refunds
    // only occur on cancel/dispute BEFORE release).
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
    // refund itself (created upstream with reverse_transfer when the original
    // charge was a destination charge). This handler only reconciles the ledger.
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

/**
 * Reconcile a swap top-up refund on the payee wallet.
 *
 * The refund was issued via stripe.refunds.create({ reverse_transfer: true })
 * in the swap callable (cancelSwap / openSwapDispute). This handler debits the
 * payee's wallet pendingBalance (the escrow that was credited on payment) and
 * writes a refund_debit ledger entry. Idempotent via topUpRefundReconciledAt.
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
      // Funds were released to balance only if topUpReleasedAt is set; refunds
      // happen pre-release, so debit pendingBalance. Guard with min() for safety.
      const fundsReleased = !!swap.topUpReleasedAt;
      if (fundsReleased) {
        const deduction = Math.min(baseAmountCents, walletData.balance || 0);
        tx.update(payeeWalletRef, {
          balance: FieldValue.increment(-deduction),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const ledgerRef = payeeWalletRef.collection('ledger').doc();
        tx.set(ledgerRef, {
          type: 'refund_debit',
          amount: deduction,
          balanceAfter: (walletData.balance || 0) - deduction,
          description: 'Remboursement complément d\'échange — débit',
          swapId,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        const deduction = Math.min(baseAmountCents, walletData.pendingBalance || 0);
        tx.update(payeeWalletRef, {
          pendingBalance: FieldValue.increment(-deduction),
          updatedAt: FieldValue.serverTimestamp(),
        });
        const ledgerRef = payeeWalletRef.collection('ledger').doc();
        tx.set(ledgerRef, {
          type: 'refund_debit',
          amount: deduction,
          balanceAfter: (walletData.pendingBalance || 0) - deduction,
          description: 'Remboursement complément d\'échange — débit (fonds en attente)',
          swapId,
          createdAt: FieldValue.serverTimestamp(),
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

  // Determine status — works for both Standard and Custom accounts.
  // For Custom accounts, charges_enabled becomes true once capabilities
  // are active and payouts_enabled becomes true once a bank account is
  // attached and verified.
  let status: string;
  if (account.charges_enabled && account.payouts_enabled) {
    status = 'active';
  } else if (account.charges_enabled) {
    // Custom accounts: charges enabled but no bank account yet
    status = 'partially_active';
  } else if (account.details_submitted) {
    status = 'pending_verification';
  } else {
    status = 'pending';
  }

  // Check if external accounts (bank accounts) are attached
  const hasExternalAccount =
    account.external_accounts?.data?.length > 0 ||
    false;

  const updateData: Record<string, any> = {
    stripeAccountStatus: status,
    stripeChargesEnabled: account.charges_enabled || false,
    stripePayoutsEnabled: account.payouts_enabled || false,
    stripeDetailsSubmitted: account.details_submitted || false,
  };

  // Track external account status for Custom accounts
  if (hasExternalAccount) {
    updateData.stripeBankAccountAdded = true;
  }

  await userDoc.ref.update(updateData);

  logger.info('Stripe webhook: seller account status updated', {
    userId: userDoc.id,
    stripeAccountId,
    status,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    hasExternalAccount,
  });
}
