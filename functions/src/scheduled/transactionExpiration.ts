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
import { sendPushNotification } from '../utils/notifications';

/** Firestore batch limit is 500; use 450 for safety margin */
const BATCH_SIZE = 450;

/** Meetup transactions expire after 48 hours */
const MEETUP_EXPIRY_MS = 48 * 60 * 60 * 1000;

/** Pending payment transactions expire after 1 hour */
const PENDING_PAYMENT_EXPIRY_MS = 1 * 60 * 60 * 1000;

/** Paid but not shipped transactions expire after 7 days (seller didn't ship) */
const PAID_NOT_SHIPPED_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

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
        .get();

      if (!paymentSnap.empty) {
        let batch = db.batch();
        let count = 0;

        for (const doc of paymentSnap.docs) {
          const data = doc.data();

          // Cancel the transaction
          batch.update(doc.ref, {
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelReason: 'pending_payment_expired_1h',
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

        logger.info(`[expireOrphanedTransactions] Expired ${paymentSnap.size} pending_payment transactions`);
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
        .get();

      if (!paidSnap.empty) {
        const stripe = getStripe();

        for (const doc of paidSnap.docs) {
          const data = doc.data();
          const transactionId = doc.id;

          try {
            // --- Stripe refund (card portion) ---
            if (data.stripePaymentIntentId && stripe) {
              try {
                // Destination charges (card-only purchases) were created with
                // transfer_data + application_fee_amount, so the seller's Connect
                // account already received the funds. A plain refund would leave
                // that money with the seller while the wallet ledger is debited =>
                // platform absorbs the loss. We MUST reverse the transfer and the
                // application fee.
                //
                // Mixed wallet+card charges are direct platform charges (NO
                // transfer_data / application_fee_amount), so there is nothing to
                // reverse — passing reverse_transfer would error.
                const isMixedCharge =
                  data.paidVia === 'wallet_and_card' || data.paidVia === 'mixed';
                const refundParams: import('stripe').Stripe.RefundCreateParams = {
                  payment_intent: data.stripePaymentIntentId,
                };
                if (!isMixedCharge) {
                  refundParams.reverse_transfer = true;
                  refundParams.refund_application_fee = true;
                }
                await stripe.refunds.create(refundParams);
                logger.info('[expireOrphanedTransactions] Stripe refund created', {
                  transactionId,
                  paymentIntentId: data.stripePaymentIntentId,
                  reverseTransfer: !isMixedCharge,
                });
              } catch (refundErr) {
                // Log but continue — the transaction should still be cancelled
                // and wallet refunded even if the Stripe refund fails.
                // Manual reconciliation may be needed.
                logger.error('[expireOrphanedTransactions] Stripe refund failed', {
                  transactionId,
                  paymentIntentId: data.stripePaymentIntentId,
                  error: refundErr instanceof Error ? refundErr.message : refundErr,
                });
              }
            }

            // --- Wallet refund (if applicable) + cancel + release article ---
            const paidVia = data.paidVia;
            const walletAmountUsed = data.walletAmountUsed || 0; // in cents
            const hasWalletPortion =
              walletAmountUsed > 0 &&
              (paidVia === 'wallet' || paidVia === 'wallet_and_card' || paidVia === 'mixed');

            await db.runTransaction(async (tx) => {
              const txSnap = await tx.get(doc.ref);
              const txData = txSnap.data();

              // Idempotence: skip if already cancelled or in a terminal state
              if (!txData || txData.status !== 'paid') {
                return;
              }

              // Read buyer wallet if wallet was used (reads before writes)
              let buyerWalletSnap = null;
              const buyerWalletRef = hasWalletPortion
                ? db.collection('wallets').doc(data.buyerId)
                : null;
              if (buyerWalletRef) {
                buyerWalletSnap = await tx.get(buyerWalletRef);
              }

              // Read seller wallet to debit pendingBalance
              const sellerWalletRef = data.sellerId
                ? db.collection('wallets').doc(data.sellerId)
                : null;
              let sellerWalletSnap = null;
              if (sellerWalletRef) {
                sellerWalletSnap = await tx.get(sellerWalletRef);
              }

              // Read article if exists
              let articleSnap = null;
              const articleRef = data.articleId
                ? db.collection('articles').doc(data.articleId)
                : null;
              if (articleRef) {
                articleSnap = await tx.get(articleRef);
              }

              // --- Writes ---

              // 1. Cancel the transaction
              tx.update(doc.ref, {
                status: 'cancelled',
                cancelledAt: FieldValue.serverTimestamp(),
                cancelReason: 'seller_did_not_ship_7d',
                refundedAt: FieldValue.serverTimestamp(),
              });

              // 2. Release the article
              if (articleRef && articleSnap && articleSnap.exists) {
                tx.update(articleRef, { isSold: false });
              }

              // 3. Debit seller pendingBalance
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

              // 4. Refund wallet portion to buyer
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
            });

            totalExpired++;

            // Notify buyer that the order was cancelled and refunded (non-blocking)
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
          } catch (txError) {
            // Log per-transaction error and continue with the rest
            logger.error('[expireOrphanedTransactions] Error processing paid-not-shipped transaction', {
              transactionId,
              error: txError instanceof Error ? txError.message : txError,
            });
          }
        }

        logger.info(`[expireOrphanedTransactions] Expired ${paidSnap.size} paid-not-shipped transactions (7d)`);
      }
    } catch (error) {
      logger.error('[expireOrphanedTransactions] Error expiring paid-not-shipped transactions', {
        error: error instanceof Error ? error.message : error,
      });
    }

    logger.info(`[expireOrphanedTransactions] Total expired: ${totalExpired}`);
  }
);
