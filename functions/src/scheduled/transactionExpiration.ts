/**
 * Scheduled transaction expiration
 * Firebase Functions v7 - using onSchedule
 *
 * Expires orphaned transactions that were never completed:
 * 1. meetup_pending transactions older than 48h (seller never confirmed)
 * 2. pending_payment transactions older than 1h (buyer never paid)
 * 3. paid transactions older than 7 days (seller never shipped)
 *
 * For each expired transaction:
 * - Status is set to 'cancelled'
 * - The article's isSold flag is reset to false
 * - For paid-not-shipped: buyer is notified via push notification
 *
 * Runs every hour.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { issueTransactionRefund } from '../utils/refund';
import { sendPushNotification } from '../utils/notifications';

/** Firestore batch limit is 500; use 450 for safety margin */
const BATCH_SIZE = 450;

/**
 * Cap how many docs each query pulls per scheduled run. Each paid-not-shipped
 * doc triggers a Stripe network call (refund) and a runTransaction, so an
 * unbounded `.get()` on a backlog could timeout the function, partially fail,
 * and re-process on the next run (P1-29). With a cap + per-status pagination,
 * the backlog drains across successive hourly runs deterministically.
 */
const MAX_PER_RUN = 200;

/** Process Stripe-bound work in small concurrent lots to bound network fan-out. */
const STRIPE_LOT_SIZE = 10;

/** Meetup transactions expire after 48 hours */
const MEETUP_EXPIRY_MS = 48 * 60 * 60 * 1000;

/** Pending payment transactions expire after 1 hour */
const PENDING_PAYMENT_EXPIRY_MS = 1 * 60 * 60 * 1000;

/** Paid but not shipped transactions expire after 7 days (seller didn't ship) */
const PAID_NOT_SHIPPED_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Stripe PaymentIntent statuses that mean money is in flight or already captured.
 * If a 'pending_payment' transaction's PaymentIntent is in one of these states we
 * must NOT expire/cancel it — the webhook (PI.succeeded) is either about to fire
 * or already did; expiring here would race the credit and leave a paid charge on
 * a cancelled transaction (P1: expiration vs payment in flight).
 */
const STRIPE_PI_IN_FLIGHT = new Set([
  'requires_capture',
  'processing',
  'succeeded',
]);

export const expireOrphanedTransactions = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    secrets: ['STRIPE_SECRET_KEY'],
  },
  async () => {
    const now = Date.now();
    let totalExpired = 0;

    // =========================================================================
    // 1. Expire meetup_pending transactions older than 48h
    // =========================================================================

    try {
      const meetupCutoff = new Date(now - MEETUP_EXPIRY_MS);
      const meetupSnap = await db
        .collection('transactions')
        .where('status', '==', 'meetup_pending')
        .where('createdAt', '<', meetupCutoff)
        .limit(MAX_PER_RUN)
        .get();

      if (!meetupSnap.empty) {
        let batch = db.batch();
        let count = 0;

        for (const doc of meetupSnap.docs) {
          const data = doc.data();

          // Cancel the transaction
          batch.update(doc.ref, {
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelReason: 'meetup_expired_48h',
          });

          // Release the article
          if (data.articleId) {
            const articleRef = db.collection('articles').doc(data.articleId);
            batch.update(articleRef, { isSold: false });
          }

          count++;
          totalExpired++;

          if (count >= BATCH_SIZE) {
            await batch.commit();
            batch = db.batch();
            count = 0;
          }
        }

        if (count > 0) {
          await batch.commit();
        }

        logger.info(`[expireOrphanedTransactions] Expired ${meetupSnap.size} meetup_pending transactions`);
      }
    } catch (error) {
      logger.error('[expireOrphanedTransactions] Error expiring meetup_pending transactions', {
        error: error instanceof Error ? error.message : error,
      });
    }

    // =========================================================================
    // 2. Expire pending_payment transactions older than 1h
    // =========================================================================

    try {
      const paymentCutoff = new Date(now - PENDING_PAYMENT_EXPIRY_MS);
      const paymentSnap = await db
        .collection('transactions')
        .where('status', '==', 'pending_payment')
        .where('createdAt', '<', paymentCutoff)
        .limit(MAX_PER_RUN)
        .get();

      if (!paymentSnap.empty) {
        const stripe = getStripe();
        let pendingExpired = 0;

        // Process in small concurrent lots: each doc may require a Stripe
        // PaymentIntent retrieve/cancel network call. Promise.allSettled keeps
        // one slow/failing PI from aborting the whole batch.
        for (let i = 0; i < paymentSnap.docs.length; i += STRIPE_LOT_SIZE) {
          const lot = paymentSnap.docs.slice(i, i + STRIPE_LOT_SIZE);
          const results = await Promise.allSettled(
            lot.map((doc) => expirePendingPayment(doc, stripe))
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              pendingExpired++;
              totalExpired++;
            }
          }
        }

        logger.info(
          `[expireOrphanedTransactions] Expired ${pendingExpired}/${paymentSnap.size} pending_payment transactions (rest had in-flight PaymentIntents)`
        );
      }
    } catch (error) {
      logger.error('[expireOrphanedTransactions] Error expiring pending_payment transactions', {
        error: error instanceof Error ? error.message : error,
      });
    }

    // =========================================================================
    // 3. Expire paid but not shipped transactions older than 7 days
    //    F3: Now includes Stripe refund (card portion) + wallet refund
    // =========================================================================

    try {
      const paidCutoff = new Date(now - PAID_NOT_SHIPPED_EXPIRY_MS);
      const paidSnap = await db
        .collection('transactions')
        .where('status', '==', 'paid')
        .where('createdAt', '<', paidCutoff)
        .limit(MAX_PER_RUN)
        .get();

      if (!paidSnap.empty) {
        const stripe = getStripe();
        let paidExpired = 0;

        // Each doc issues a Stripe refund (network) + runTransactions, so we
        // process in small concurrent lots and isolate failures with
        // Promise.allSettled (one bad refund never aborts the rest).
        for (let i = 0; i < paidSnap.docs.length; i += STRIPE_LOT_SIZE) {
          const lot = paidSnap.docs.slice(i, i + STRIPE_LOT_SIZE);
          const results = await Promise.allSettled(
            lot.map((doc) => refundPaidNotShipped(doc, stripe))
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              paidExpired++;
              totalExpired++;
            }
          }
        }

        logger.info(
          `[expireOrphanedTransactions] Expired ${paidExpired}/${paidSnap.size} paid-not-shipped transactions (7d)`
        );
      }
    } catch (error) {
      logger.error('[expireOrphanedTransactions] Error expiring paid-not-shipped transactions', {
        error: error instanceof Error ? error.message : error,
      });
    }

    // =========================================================================
    // 4. Resume interrupted refunds (status === 'refund_in_progress')
    //    A refund that crashed between PHASE 1 (mark in_progress) and PHASE 3
    //    (confirm) is no longer matched by the 'paid' query above. Re-drive it:
    //    refundPaidNotShipped resumes from refund_in_progress, re-using the
    //    persisted stripeRefundId (no double Stripe refund) and finalizing to
    //    'refunded'. Single equality filter — no composite index required.
    // =========================================================================

    try {
      const stuckSnap = await db
        .collection('transactions')
        .where('status', '==', 'refund_in_progress')
        .limit(MAX_PER_RUN)
        .get();

      if (!stuckSnap.empty) {
        const stripe = getStripe();
        let resumed = 0;

        for (let i = 0; i < stuckSnap.docs.length; i += STRIPE_LOT_SIZE) {
          const lot = stuckSnap.docs.slice(i, i + STRIPE_LOT_SIZE);
          const results = await Promise.allSettled(
            lot.map((doc) => refundPaidNotShipped(doc, stripe))
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              resumed++;
              totalExpired++;
            }
          }
        }

        logger.info(
          `[expireOrphanedTransactions] Resumed ${resumed}/${stuckSnap.size} interrupted refunds (refund_in_progress)`
        );
      }
    } catch (error) {
      logger.error('[expireOrphanedTransactions] Error resuming interrupted refunds', {
        error: error instanceof Error ? error.message : error,
      });
    }

    logger.info(`[expireOrphanedTransactions] Total expired: ${totalExpired}`);
  }
);

/** The Stripe client singleton type (or null when not configured). */
type StripeClient = ReturnType<typeof getStripe>;

/**
 * Expire a single 'pending_payment' transaction, respecting an in-flight
 * PaymentIntent.
 *
 * P1 (expiration vs payment in flight): a buyer can authorize/capture a payment
 * right at the 1h boundary; the PI.succeeded webhook may not have landed yet.
 * Blindly expiring would cancel a transaction whose card was (or is about to be)
 * charged → paid charge on a cancelled order.
 *
 *  - If a stripePaymentIntentId exists, retrieve the PI. If its status is
 *    in-flight (requires_capture/processing/succeeded) → DO NOT expire; let the
 *    webhook (or reconciler) finish the job.
 *  - Otherwise cancel the PI (best-effort, idempotent) so no late capture can
 *    occur, then expire the transaction + release the article atomically.
 *
 * @returns true if the transaction was expired, false if it was left in place.
 */
async function expirePendingPayment(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  stripe: StripeClient
): Promise<boolean> {
  const transactionId = doc.id;
  const data = doc.data();
  const paymentIntentId = data.stripePaymentIntentId;

  try {
    if (paymentIntentId && stripe) {
      // 1. Is the payment in flight / already captured?
      let piStatus: string | undefined;
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        piStatus = pi.status;
      } catch (retrieveErr) {
        // Could not reach Stripe — be conservative and DO NOT expire this run.
        // The next hourly run will retry; expiring blindly risks cancelling a
        // captured payment.
        logger.warn('[expireOrphanedTransactions] PI retrieve failed — deferring expiry', {
          transactionId,
          paymentIntentId,
          error: retrieveErr instanceof Error ? retrieveErr.message : retrieveErr,
        });
        return false;
      }

      if (piStatus && STRIPE_PI_IN_FLIGHT.has(piStatus)) {
        logger.info('[expireOrphanedTransactions] pending_payment PI in flight — not expiring', {
          transactionId,
          paymentIntentId,
          piStatus,
        });
        return false;
      }

      // 2. Not in flight (requires_payment_method / requires_action /
      //    requires_confirmation / canceled). Cancel the PI so no late capture
      //    is possible, then expire. cancel is idempotent against an already
      //    canceled PI (Stripe throws — we swallow that specific case).
      if (piStatus !== 'canceled') {
        try {
          await stripe.paymentIntents.cancel(paymentIntentId);
          logger.info('[expireOrphanedTransactions] cancelled in-flight-less PI before expiry', {
            transactionId,
            paymentIntentId,
            piStatusBefore: piStatus,
          });
        } catch (cancelErr) {
          // If it became uncancelable between retrieve and cancel (e.g. it just
          // succeeded), defer — never expire a possibly-captured payment.
          logger.warn('[expireOrphanedTransactions] PI cancel failed — deferring expiry', {
            transactionId,
            paymentIntentId,
            error: cancelErr instanceof Error ? cancelErr.message : cancelErr,
          });
          return false;
        }
      }
    }

    // 3. Expire the transaction + release the article atomically. The status
    //    guard inside the transaction keeps this idempotent across runs.
    const expired = await db.runTransaction(async (tx) => {
      const txSnap = await tx.get(doc.ref);
      const txData = txSnap.data();
      if (!txData || txData.status !== 'pending_payment') {
        return false;
      }

      let articleSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      const articleRef = txData.articleId
        ? db.collection('articles').doc(txData.articleId)
        : null;
      if (articleRef) {
        articleSnap = await tx.get(articleRef);
      }

      tx.update(doc.ref, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: 'pending_payment_expired_1h',
      });

      if (articleRef && articleSnap && articleSnap.exists) {
        tx.update(articleRef, { isSold: false });
      }
      return true;
    });

    return expired;
  } catch (err) {
    logger.error('[expireOrphanedTransactions] Error expiring pending_payment transaction', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}

/**
 * Refund + expire a single 'paid' transaction the seller never shipped (>7d).
 *
 * P1 (transactional, idempotent refund — R005/R008/R028): the refund is done in
 * three phases so a crash between the Stripe call and the Firestore writes can
 * never double-refund nor leave the buyer un-refunded:
 *
 *  1. INTENT (runTransaction): re-check status==='paid', then mark the tx
 *     `refund_in_progress` and stamp `refundReason`. If a `stripeRefundId` is
 *     already persisted we skip straight to the Stripe call guard.
 *  2. EXECUTE (Stripe, idempotent): refunds.create with idempotencyKey
 *     `rf_${transactionId}` (deterministic — Stripe dedups re-tries), reversing
 *     the transfer + application fee for destination charges. Persist the
 *     returned `stripeRefundId` before applying wallet movements.
 *  3. CONFIRM (runTransaction): apply wallet movements (debit seller pending,
 *     re-credit buyer wallet portion), release the article, and set the final
 *     status to `refunded`. Final status `refunded` makes the inbound
 *     `charge.refunded` webhook (triggered by the refund above) a no-op
 *     (its idempotence guard skips status==='refunded'), preventing a second
 *     wallet mutation.
 *
 * @returns true if the transaction reached a terminal refunded state this run.
 */
async function refundPaidNotShipped(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  stripe: StripeClient
): Promise<boolean> {
  const transactionId = doc.id;
  const data = doc.data();

  // P1 (atomicity payment<->label): a transaction still awaiting its shipping
  // label is owned by sweepPendingLabels (re-rate + retry, then refund after N
  // attempts). Do NOT expire/refund it here — the seller was never credited and
  // the sweep handles the eventual refund itself.
  if (data.labelCreationPending === true) {
    logger.info('[expireOrphanedTransactions] skipping labelCreationPending tx (owned by sweepPendingLabels)', {
      transactionId,
    });
    return false;
  }

  try {
    // -----------------------------------------------------------------------
    // PHASE 1 — INTENT: mark refund_in_progress atomically (idempotent).
    // -----------------------------------------------------------------------
    const intent = await db.runTransaction(async (tx) => {
      const txSnap = await tx.get(doc.ref);
      const txData = txSnap.data();
      if (!txData) {
        return { proceed: false as const, existingRefundId: null };
      }

      // Idempotence: only act on a still-'paid' tx, OR resume a tx already
      // flagged refund_in_progress (crash recovery on a prior run).
      if (txData.status === 'paid') {
        tx.update(doc.ref, {
          status: 'refund_in_progress',
          refundReason: 'seller_did_not_ship_7d',
          refundStartedAt: FieldValue.serverTimestamp(),
        });
        return {
          proceed: true as const,
          existingRefundId:
            typeof txData.stripeRefundId === 'string' ? txData.stripeRefundId : null,
        };
      }

      if (txData.status === 'refund_in_progress') {
        // Resume an interrupted refund from a previous run.
        return {
          proceed: true as const,
          existingRefundId:
            typeof txData.stripeRefundId === 'string' ? txData.stripeRefundId : null,
        };
      }

      // Any other status (cancelled/refunded/shipped/...) → nothing to do.
      return { proceed: false as const, existingRefundId: null };
    });

    if (!intent.proceed) {
      return false;
    }

    // -----------------------------------------------------------------------
    // PHASE 2 — EXECUTE: Stripe refund (idempotent). Skip if already refunded.
    // -----------------------------------------------------------------------
    let stripeRefundId: string | null = intent.existingRefundId;

    if (data.stripePaymentIntentId && stripe && !stripeRefundId) {
      try {
        // Destination charges (card-only purchases) were created with
        // transfer_data + application_fee_amount, so the seller's Connect
        // account already received the funds. A plain refund would leave that
        // money with the seller while the wallet ledger is debited => platform
        // absorbs the loss. We MUST reverse the transfer and the application fee.
        //
        // Mixed wallet+card charges are direct platform charges (NO transfer_data
        // / application_fee_amount), so there is nothing to reverse — passing
        // reverse_transfer would error.
        const isMixedCharge =
          data.paidVia === 'wallet_and_card' || data.paidVia === 'mixed';
        const refund = await stripe.refunds.create(
          {
            payment_intent: data.stripePaymentIntentId,
            ...(isMixedCharge
              ? {}
              : { reverse_transfer: true, refund_application_fee: true }),
          },
          // Deterministic key tied to the transaction so a re-run of the
          // scheduler (or a resumed refund_in_progress) never issues a second
          // refund for the same purchase.
          { idempotencyKey: `rf_${transactionId}` }
        );
        stripeRefundId = refund.id;

        // Persist the refund id immediately so a crash before PHASE 3 lets the
        // next run resume without re-calling Stripe with a fresh decision.
        await doc.ref.update({
          stripeRefundId,
          stripeRefundIssuedAt: FieldValue.serverTimestamp(),
        });

        logger.info('[expireOrphanedTransactions] Stripe refund created', {
          transactionId,
          paymentIntentId: data.stripePaymentIntentId,
          stripeRefundId,
          reverseTransfer: !isMixedCharge,
        });
      } catch (refundErr) {
        // Refund failed → leave the tx in 'refund_in_progress' so the next run
        // retries (the idempotencyKey guarantees no double refund). Do NOT
        // apply wallet movements without a confirmed Stripe refund.
        logger.error('[expireOrphanedTransactions] Stripe refund failed — leaving refund_in_progress', {
          transactionId,
          paymentIntentId: data.stripePaymentIntentId,
          error: refundErr instanceof Error ? refundErr.message : refundErr,
        });
        return false;
      }
    }

    // -----------------------------------------------------------------------
    // PHASE 3 — CONFIRM: wallet movements + release article + status=refunded.
    // -----------------------------------------------------------------------
    const paidVia = data.paidVia;
    const walletAmountUsed = data.walletAmountUsed || 0; // in cents
    const hasWalletPortion =
      walletAmountUsed > 0 &&
      (paidVia === 'wallet' || paidVia === 'wallet_and_card' || paidVia === 'mixed');

    const confirmed = await db.runTransaction(async (tx) => {
      const txSnap = await tx.get(doc.ref);
      const txData = txSnap.data();

      // Idempotence: only confirm a tx still in refund_in_progress (a concurrent
      // run or the charge.refunded webhook may have finished it already).
      if (!txData || txData.status !== 'refund_in_progress') {
        return false;
      }

      // Reads before writes.
      let buyerWalletSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      const buyerWalletRef = hasWalletPortion
        ? db.collection('wallets').doc(data.buyerId)
        : null;
      if (buyerWalletRef) {
        buyerWalletSnap = await tx.get(buyerWalletRef);
      }

      const sellerWalletRef = data.sellerId
        ? db.collection('wallets').doc(data.sellerId)
        : null;
      let sellerWalletSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (sellerWalletRef) {
        sellerWalletSnap = await tx.get(sellerWalletRef);
      }

      let articleSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      const articleRef = data.articleId
        ? db.collection('articles').doc(data.articleId)
        : null;
      if (articleRef) {
        articleSnap = await tx.get(articleRef);
      }

      // --- Writes ---

      // 1. Finalize the transaction as refunded. Final status 'refunded' makes
      //    the inbound charge.refunded webhook idempotent (it skips refunded).
      tx.update(doc.ref, {
        status: 'refunded',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: 'seller_did_not_ship_7d',
        refundedAt: FieldValue.serverTimestamp(),
        ...(stripeRefundId ? { stripeRefundId } : {}),
      });

      // 2. Release the article.
      if (articleRef && articleSnap && articleSnap.exists) {
        tx.update(articleRef, { isSold: false });
      }

      // 3. Debit seller pendingBalance.
      if (sellerWalletRef && sellerWalletSnap && sellerWalletSnap.exists) {
        const sellerWalletData = sellerWalletSnap.data()!;
        const sellerPayout = data.sellerPayout || data.amount || 0;
        const sellerPayoutCents = Math.round(sellerPayout * 100);
        const deduction = Math.min(sellerPayoutCents, sellerWalletData.pendingBalance || 0);

        if (deduction > 0) {
          tx.update(sellerWalletRef, {
            pendingBalance: FieldValue.increment(-deduction),
            updatedAt: FieldValue.serverTimestamp(),
          });

          const sellerLedgerRef = sellerWalletRef.collection('ledger').doc();
          tx.set(sellerLedgerRef, {
            type: 'refund_debit',
            amount: deduction,
            balanceAfter: (sellerWalletData.pendingBalance || 0) - deduction,
            description: 'Annulation — vendeur n\'a pas expédié',
            transactionId,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }

      // 4. Refund wallet portion to buyer.
      if (hasWalletPortion && buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
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
          description: 'Remboursement — vendeur n\'a pas expedie',
          transactionId,
          createdAt: FieldValue.serverTimestamp(),
        });

        logger.info('[expireOrphanedTransactions] Wallet portion refunded', {
          transactionId,
          buyerId: data.buyerId,
          walletAmountRefunded: walletAmountUsed,
        });
      }

      return true;
    });

    if (!confirmed) {
      return false;
    }

    // Notify buyer that the order was cancelled and refunded (non-blocking).
    if (data.buyerId) {
      const articleTitle = data.articleTitle || 'votre article';
      sendPushNotification(
        data.buyerId,
        'Commande annulee et remboursee',
        `Votre commande ${articleTitle} a ete annulee car le vendeur n'a pas expedie dans les delais. Le remboursement est en cours.`,
        { transactionId, articleId: data.articleId || '' },
        'order_cancelled'
      ).catch((err) => {
        logger.warn('[expireOrphanedTransactions] Failed to notify buyer of paid expiry', {
          transactionId,
          error: err instanceof Error ? err.message : err,
        });
      });
    }

    return true;
  } catch (err) {
    logger.error('[expireOrphanedTransactions] Error processing paid-not-shipped transaction', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}
