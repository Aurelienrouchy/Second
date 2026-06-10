/**
 * Scheduled transaction expiration
 * Firebase Functions v7 - using onSchedule
 *
 * Expires orphaned transactions that were never completed:
 * 1. meetup_pending transactions older than 48h (seller never confirmed)
 * 1b. meetup_confirmed transactions older than 7 days (A3: neither party ever
 *     tapped "completed" → zombie tx leaving the article unsellable forever)
 * 2. pending_payment transactions older than 1h (buyer never paid)
 * 3. paid transactions older than 7 days (seller never shipped)
 *
 * For each expired transaction:
 * - Status is set to 'cancelled'
 * - The article's isSold flag is reset to false
 * - For paid-not-shipped: buyer is notified via push notification
 *
 * Meetups are pure cash-in-hand exchanges — NO money flows through the platform,
 * so meetup expiries never refund / never touch the wallet ledger.
 *
 * Runs every hour.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { issueTransactionRefund } from '../utils/refund';
import { sendPushNotification } from '../utils/notifications';
import { logAutomatedDecision } from '../callable/automatedDecisions';

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

/**
 * A3: a `meetup_confirmed` transaction whose meetup was supposedly arranged but
 * which neither party ever marked `meetup_completed`. After 7 days from creation
 * we treat the meetup as abandoned and auto-cancel it, releasing the article so
 * it can be re-sold. Generous window (vs 48h for unconfirmed) because the parties
 * agreed on a date that may legitimately be days out. No money is involved
 * (cash-in-hand), so there is nothing to refund.
 */
const MEETUP_CONFIRMED_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Pending payment transactions expire after 1 hour */
const PENDING_PAYMENT_EXPIRY_MS = 1 * 60 * 60 * 1000;

/** Paid but not shipped transactions expire after 7 days (seller didn't ship) */
const PAID_NOT_SHIPPED_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * F26: a return leg with no carrier DELIVERED scan after this window is routed to
 * admin for human review (a dispute doc is opened). We never auto-release nor
 * auto-refund here — the buyer may never have posted the parcel (fraud) OR the
 * carrier scan may simply be missing. Routing to admin is the safe default: it
 * unblocks the funds-frozen dead-end (return_requested + disputed freezes the
 * seller's payout forever) without silently favoring either party. 21 days is
 * generous (a return ships + transits + scans well within that).
 */
const RETURN_LEG_STALE_MS = 21 * 24 * 60 * 60 * 1000;

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
        // F13/F83: cancel each tx TRANSACTIONALLY with a status re-check instead
        // of a blind batch. A batch.update would (a) reject the WHOLE batch if the
        // article was hard-deleted between query and commit, and (b) clobber a tx
        // whose status changed (e.g. a confirmation/payment landing) in that
        // window. The per-doc tx only cancels while status is STILL
        // 'meetup_pending', and tolerates a missing article.
        const cancelledMeetups: { id: string; data: FirebaseFirestore.DocumentData }[] = [];
        for (const doc of meetupSnap.docs) {
          try {
            const cancelled = await db.runTransaction(async (tx) => {
              const snap = await tx.get(doc.ref);
              if (!snap.exists) return false;
              const data = snap.data()!;
              if (data.status !== 'meetup_pending') return false; // status moved on

              // Read the article BEFORE writing (Admin SDK READ_AFTER_WRITE).
              const articleRef = data.articleId
                ? db.collection('articles').doc(data.articleId)
                : null;
              const articleSnap = articleRef ? await tx.get(articleRef) : null;

              tx.update(doc.ref, {
                status: 'cancelled',
                cancelledAt: FieldValue.serverTimestamp(),
                cancelReason: 'meetup_expired_48h',
              });
              if (articleRef && articleSnap && articleSnap.exists) {
                tx.update(articleRef, { isSold: false });
              }
              return true;
            });
            if (cancelled) {
              totalExpired++;
              cancelledMeetups.push({ id: doc.id, data: doc.data() });
            }
          } catch (cancelErr) {
            logger.error('[expireOrphanedTransactions] failed to cancel meetup_pending tx', {
              transactionId: doc.id,
              error: cancelErr instanceof Error ? cancelErr.message : cancelErr,
            });
          }
        }

        // Loi 25 art. 12.1 — journal each AUTOMATED cancellation that ACTUALLY
        // happened (status re-check passed) and notify the affected parties.
        // Best-effort; never affects the cancellation itself.
        for (const { id: transactionId, data } of cancelledMeetups) {
          await logAutomatedDecision({
            transactionId,
            userId: typeof data.buyerId === 'string' ? data.buyerId : (data.sellerId ?? ''),
            decisionType: 'transaction_expired',
            criteria: {
              status: 'meetup_pending',
              expiryWindowHours: 48,
              cancelReason: 'meetup_expired_48h',
            },
            result: 'Transaction annulée (rendez-vous non confirmé sous 48h)',
          });
          if (typeof data.buyerId === 'string' && data.buyerId.length > 0) {
            const articleTitle = data.articleTitle || 'votre commande';
            sendPushNotification(
              data.buyerId,
              'Commande annulée automatiquement',
              `Votre commande ${articleTitle} a été annulée automatiquement : le rendez-vous n'a pas été confirmé dans les délais (48 h). Si vous contestez cette décision, vous pouvez nous le signaler.`,
              { transactionId, articleId: data.articleId || '' },
              'order_cancelled'
            ).catch((err) => {
              logger.warn('[expireOrphanedTransactions] Failed to notify buyer of meetup expiry', {
                transactionId,
                error: err instanceof Error ? err.message : err,
              });
            });
          }
        }

        logger.info(`[expireOrphanedTransactions] Expired ${cancelledMeetups.length} meetup_pending transactions`);
      }
    } catch (error) {
      logger.error('[expireOrphanedTransactions] Error expiring meetup_pending transactions', {
        error: error instanceof Error ? error.message : error,
      });
    }

    // =========================================================================
    // 1b. A3 — Expire abandoned meetup_confirmed transactions older than 7 days
    //     The seller confirmed the appointment but neither party ever tapped
    //     "completed" (completeMeetupTransaction). Without this branch the tx
    //     sits in meetup_confirmed forever and the article stays unsellable
    //     (toggleArticleSold/createTransaction treat meetup_confirmed as an
    //     active blocking transaction). Auto-cancel + release the article.
    //     Reuses the existing (status ASC, createdAt ASC) composite index.
    // =========================================================================

    try {
      const meetupConfirmedCutoff = new Date(now - MEETUP_CONFIRMED_EXPIRY_MS);
      const meetupConfirmedSnap = await db
        .collection('transactions')
        .where('status', '==', 'meetup_confirmed')
        .where('createdAt', '<', meetupConfirmedCutoff)
        .limit(MAX_PER_RUN)
        .get();

      if (!meetupConfirmedSnap.empty) {
        let confirmedExpired = 0;

        for (const doc of meetupConfirmedSnap.docs) {
          const data = doc.data();
          // Atomic per-doc: re-check status under the lock so this stays
          // idempotent if a party completes/cancels between query and commit.
          const expired = await db.runTransaction(async (tx) => {
            const txSnap = await tx.get(doc.ref);
            const txData = txSnap.data();
            if (!txData || txData.status !== 'meetup_confirmed') {
              return false;
            }

            let articleRef: FirebaseFirestore.DocumentReference | null = null;
            let articleSnap: FirebaseFirestore.DocumentSnapshot | null = null;
            if (typeof txData.articleId === 'string' && txData.articleId.length > 0) {
              articleRef = db.collection('articles').doc(txData.articleId);
              articleSnap = await tx.get(articleRef);
            }

            tx.update(doc.ref, {
              status: 'cancelled',
              cancelledAt: FieldValue.serverTimestamp(),
              cancelReason: 'meetup_confirmed_expired_7d',
            });

            if (articleRef && articleSnap && articleSnap.exists) {
              tx.update(articleRef, { isSold: false });
            }
            return true;
          }).catch((err) => {
            logger.error('[expireOrphanedTransactions] Error expiring a meetup_confirmed tx', {
              transactionId: doc.id,
              error: err instanceof Error ? err.message : err,
            });
            return false;
          });

          if (!expired) continue;
          confirmedExpired++;
          totalExpired++;

          // Loi 25 art. 12.1 — journal the AUTOMATED expiry (best-effort) and
          // notify BOTH parties that the abandoned meetup was auto-cancelled and
          // can be contested. No money moved (cash-in-hand meetup).
          const transactionId = doc.id;
          await logAutomatedDecision({
            transactionId,
            userId: typeof data.buyerId === 'string' ? data.buyerId : (data.sellerId ?? ''),
            decisionType: 'transaction_expired',
            criteria: {
              status: 'meetup_confirmed',
              expiryWindowDays: 7,
              cancelReason: 'meetup_confirmed_expired_7d',
            },
            result: 'Rencontre annulée automatiquement (non finalisée sous 7 jours)',
          });

          const articleTitle = data.articleTitle || 'votre rencontre';
          const payload = { transactionId, articleId: data.articleId || '' };
          for (const party of [data.buyerId, data.sellerId]) {
            if (typeof party === 'string' && party.length > 0) {
              sendPushNotification(
                party,
                'Rencontre annulée automatiquement',
                `La rencontre pour « ${articleTitle} » a été annulée automatiquement : elle n'a pas été finalisée dans les délais (7 jours). Si vous contestez cette décision, vous pouvez nous le signaler.`,
                payload,
                'order_cancelled'
              ).catch((err) => {
                logger.warn('[expireOrphanedTransactions] Failed to notify party of meetup_confirmed expiry', {
                  transactionId,
                  error: err instanceof Error ? err.message : err,
                });
              });
            }
          }
        }

        logger.info(
          `[expireOrphanedTransactions] Expired ${confirmedExpired}/${meetupConfirmedSnap.size} meetup_confirmed transactions (7d)`
        );
      }
    } catch (error) {
      logger.error('[expireOrphanedTransactions] Error expiring meetup_confirmed transactions', {
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

    // =========================================================================
    // 5. F26: route stale return legs to admin. A `return_requested` tx whose
    //    return parcel never scanned DELIVERED after 21 days is a frozen-funds
    //    dead-end (seller payout blocked forever). We open a `disputes` doc for
    //    human review (safe default — no silent auto-release / auto-refund) and
    //    stamp `returnEscalatedAt` so it is escalated exactly once.
    // =========================================================================

    try {
      const returnCutoff = new Date(now - RETURN_LEG_STALE_MS);
      const returnSnap = await db
        .collection('transactions')
        .where('status', '==', 'return_requested')
        .where('returnRequestedAt', '<', returnCutoff)
        .limit(MAX_PER_RUN)
        .get();

      if (!returnSnap.empty) {
        let escalated = 0;
        for (const doc of returnSnap.docs) {
          const data = doc.data();
          // Idempotence: already escalated.
          if (data.returnEscalatedAt) continue;
          try {
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(doc.ref);
              if (!snap.exists) return;
              const d = snap.data()!;
              if (d.status !== 'return_requested' || d.returnEscalatedAt) return;

              const disputeRef = db.collection('disputes').doc();
              tx.set(disputeRef, {
                transactionId: doc.id,
                type: 'return_not_delivered',
                buyerId: d.buyerId ?? null,
                sellerId: d.sellerId ?? null,
                articleId: d.articleId ?? null,
                articleTitle: d.articleTitle ?? null,
                reason: 'return_leg_stale',
                details:
                  'Colis de retour non livré (aucun scan DELIVERED) après 21 jours — revue manuelle requise.',
                status: 'open',
                statusBeforeDispute: 'return_requested',
                createdAt: FieldValue.serverTimestamp(),
              });

              tx.update(doc.ref, {
                returnEscalatedAt: FieldValue.serverTimestamp(),
              });
            });
            escalated++;
          } catch (e) {
            logger.error('[expireOrphanedTransactions] Failed to escalate stale return', {
              transactionId: doc.id,
              error: e instanceof Error ? e.message : e,
            });
          }
        }
        logger.warn(
          `[expireOrphanedTransactions] Escalated ${escalated}/${returnSnap.size} stale return legs to admin (21d)`
        );
      }
    } catch (error) {
      logger.error('[expireOrphanedTransactions] Error escalating stale return legs', {
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
      // ── ALL READS FIRST ──
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

      // F22: a mixed (wallet_and_card) / wallet 'pending_payment' tx had its
      // wallet part debited at createStripeCheckout time. If the buyer abandoned
      // the Payment Sheet, that debit must be restored on expiry — same wallet
      // reconciliation as cancelPendingTransaction. The status guard above makes
      // this idempotent: a re-run sees 'cancelled' and never double-credits.
      const walletAmountUsed =
        typeof txData.walletAmountUsed === 'number' ? txData.walletAmountUsed : 0; // cents
      const hasWalletDebit =
        walletAmountUsed > 0 &&
        (txData.paidVia === 'wallet_and_card' || txData.paidVia === 'wallet');
      let buyerWalletSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      let buyerWalletRef: FirebaseFirestore.DocumentReference | null = null;
      if (hasWalletDebit && typeof txData.buyerId === 'string' && txData.buyerId.length > 0) {
        buyerWalletRef = db.collection('wallets').doc(txData.buyerId);
        buyerWalletSnap = await tx.get(buyerWalletRef);
      }

      // ── ALL WRITES AFTER ALL READS ──
      const txUpdate: Record<string, any> = {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: 'pending_payment_expired_1h',
      };
      // F22/F73: clear the wallet markers so the PI (already cancelled in step 2)
      // can never drive a second wallet re-credit via issueTransactionRefund.
      if (hasWalletDebit) {
        txUpdate.walletAmountUsed = FieldValue.delete();
        txUpdate.paidVia = FieldValue.delete();
      }
      tx.update(doc.ref, txUpdate);

      if (articleRef && articleSnap && articleSnap.exists) {
        tx.update(articleRef, { isSold: false });
      }

      if (hasWalletDebit && buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
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
          description: 'Remboursement — paiement non finalisé (porte-monnaie)',
          transactionId,
          createdAt: FieldValue.serverTimestamp(),
        });

        logger.info('[expireOrphanedTransactions] wallet portion restored on expiry', {
          transactionId,
          buyerId: txData.buyerId,
          walletAmountRefunded: walletAmountUsed,
        });
      }
      return true;
    });

    if (expired) {
      // Loi 25 art. 12.1 — journal the AUTOMATED expiry decision (best-effort).
      await logAutomatedDecision({
        transactionId,
        userId: typeof data.buyerId === 'string' ? data.buyerId : '',
        decisionType: 'transaction_expired',
        criteria: {
          status: 'pending_payment',
          expiryWindowHours: 1,
          cancelReason: 'pending_payment_expired_1h',
        },
        result: 'Transaction annulée (paiement non finalisé sous 1h)',
      });

      // Transparency notification to the buyer (best-effort).
      if (typeof data.buyerId === 'string' && data.buyerId.length > 0) {
        const articleTitle = data.articleTitle || 'votre commande';
        sendPushNotification(
          data.buyerId,
          'Commande annulée automatiquement',
          `Votre commande ${articleTitle} a été annulée automatiquement : le paiement n'a pas été finalisé dans le délai imparti (1 h). Si vous contestez cette décision, vous pouvez nous le signaler.`,
          { transactionId, articleId: data.articleId || '' },
          'order_cancelled'
        ).catch((err) => {
          logger.warn('[expireOrphanedTransactions] Failed to notify buyer of pending_payment expiry', {
            transactionId,
            error: err instanceof Error ? err.message : err,
          });
        });
      }
    }

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
 * REUSES the shared issueTransactionRefund core (single source of truth for the
 * Stripe refund + sellerDebt reconciliation + dead-lettering on Stripe
 * failure with the deterministic key rf_${txId}). The previous bespoke 3-phase
 * implementation is replaced by:
 *
 *  1. INTENT (runTransaction): re-check status (paid OR resume a stuck
 *     refund_in_progress), mark `refund_in_progress`, stamp `refundReason`.
 *  2. CORE: issueTransactionRefund does the idempotent Stripe refund OUTSIDE a
 *     transaction (key rf_${txId} — Stripe dedups any re-run / resume) then the
 *     atomic Firestore reconciliation: re-credit buyer wallet portion, debit the
 *     seller EXACTLY sellerCreditedCents across pending->held->balance (shortfall
 *     -> sellerDebt, never masked), re-list the article, status -> 'refunded'.
 *     Final status 'refunded' makes the inbound charge.refunded webhook a no-op.
 *  3. STAMP: record cancelReason/cancelledAt (audit fields the generic core does
 *     not own). On the core throwing (Stripe failed -> dead-lettered), roll the
 *     status back to 'refund_in_progress' is NOT needed — the tx is already
 *     refund_in_progress and the next run (section 4 resume) re-drives it.
 *
 * NOTE: the seller debit now uses sellerCreditedCents (matching the rest of the
 * hardened ledger) instead of the legacy derived sellerPayout — a correctness
 * improvement. Under the deferred-credit model a never-credited 'paid' tx has no
 * sellerCreditedCents, so the debit target is 0 (no false debt).
 *
 * @returns true if the transaction reached a terminal refunded state this run.
 */
async function refundPaidNotShipped(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  _stripe: StripeClient
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
    // Acts on a still-'paid' tx OR resumes a tx already flagged
    // refund_in_progress (crash recovery on a prior run / section-4 resume).
    // -----------------------------------------------------------------------
    const intent = await db.runTransaction(async (tx) => {
      const txSnap = await tx.get(doc.ref);
      const txData = txSnap.data();
      if (!txData) return { proceed: false as const, preData: null };

      if (txData.status === 'paid') {
        tx.update(doc.ref, {
          status: 'refund_in_progress',
          refundReason: 'seller_did_not_ship_7d',
          refundStartedAt: FieldValue.serverTimestamp(),
        });
        return { proceed: true as const, preData: txData };
      }

      if (txData.status === 'refund_in_progress') {
        // Resume an interrupted refund from a previous run.
        return { proceed: true as const, preData: txData };
      }

      // Any other status (cancelled/refunded/shipped/...) → nothing to do.
      return { proceed: false as const, preData: null };
    });

    if (!intent.proceed || !intent.preData) {
      return false;
    }

    // -----------------------------------------------------------------------
    // PHASE 2 — CORE: shared idempotent Stripe refund + atomic reconciliation.
    // The core issues a plain platform-charge refund (single-rail model),
    // re-credits the buyer wallet portion, debits the seller
    // exactly sellerCreditedCents, re-lists the article, sets status='refunded'.
    // On Stripe failure it dead-letters (stripe_refund_failed, key rf_${txId})
    // and throws — we leave the tx in refund_in_progress for the next run.
    // -----------------------------------------------------------------------
    await issueTransactionRefund(transactionId, intent.preData, {
      reason: 'seller_did_not_ship_7d',
      idempotencyKey: `rf_${transactionId}`,
      // Item never shipped — it still exists, so re-list it (default).
      relistArticle: true,
      source: 'expireOrphanedTransactions_paidNotShipped',
    });

    // -----------------------------------------------------------------------
    // PHASE 3 — STAMP audit fields the generic core does not own. Best-effort
    // merge — the core already set status='refunded' + refundedAt atomically.
    // -----------------------------------------------------------------------
    await doc.ref
      .update({
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: 'seller_did_not_ship_7d',
      })
      .catch((err) =>
        logger.warn('[expireOrphanedTransactions] failed to stamp cancel fields after refund', {
          transactionId,
          error: err instanceof Error ? err.message : err,
        })
      );

    // Loi 25 art. 12.1 — journal the AUTOMATED expiry+refund decision
    // (best-effort, never affects the refund already committed by the core).
    await logAutomatedDecision({
      transactionId,
      userId: typeof data.buyerId === 'string' ? data.buyerId : '',
      decisionType: 'transaction_expired',
      criteria: {
        status: 'paid',
        expiryWindowDays: 7,
        cancelReason: 'seller_did_not_ship_7d',
      },
      result: 'Commande annulée et remboursée (vendeur n\'a pas expédié sous 7 jours)',
    });

    // Notify buyer that the order was cancelled and refunded (non-blocking).
    // ENRICHED for Loi 25 transparency: states the decision was AUTOMATIC and
    // that it can be contested (right to human review).
    if (data.buyerId) {
      const articleTitle = data.articleTitle || 'votre article';
      sendPushNotification(
        data.buyerId,
        'Commande annulée et remboursée automatiquement',
        `Votre commande ${articleTitle} a été annulée automatiquement car le vendeur n'a pas expédié dans les délais (7 jours). Le remboursement est en cours. Si vous contestez cette décision, vous pouvez nous le signaler.`,
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
    // issueTransactionRefund already dead-lettered a Stripe failure with the
    // deterministic key; the tx stays refund_in_progress so section 4 re-drives
    // it next run. Just log domain context.
    logger.error('[expireOrphanedTransactions] Error processing paid-not-shipped transaction', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}
