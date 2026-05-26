/**
 * Scheduled transaction expiration
 * Firebase Functions v7 - using onSchedule
 *
 * Expires orphaned transactions that were never completed:
 * 1. meetup_pending transactions older than 48h (seller never confirmed)
 * 2. pending_payment transactions older than 1h (buyer never paid)
 *
 * For each expired transaction:
 * - Status is set to 'cancelled'
 * - The article's isSold flag is reset to false
 *
 * Runs every hour.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
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
    // =========================================================================

    try {
      const paidCutoff = new Date(now - PAID_NOT_SHIPPED_EXPIRY_MS);
      const paidSnap = await db
        .collection('transactions')
        .where('status', '==', 'paid')
        .where('createdAt', '<', paidCutoff)
        .get();

      if (!paidSnap.empty) {
        let batch = db.batch();
        let count = 0;

        for (const doc of paidSnap.docs) {
          const data = doc.data();

          // Cancel the transaction
          batch.update(doc.ref, {
            status: 'cancelled',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelReason: 'seller_did_not_ship_7d',
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

          // Notify buyer that the order was cancelled (non-blocking)
          if (data.buyerId) {
            const articleTitle = data.articleTitle || 'votre article';
            sendPushNotification(
              data.buyerId,
              'Commande annulee',
              `Votre commande ${articleTitle} a ete annulee car le vendeur n'a pas expedie dans les delais.`,
              { transactionId: doc.id, articleId: data.articleId || '' },
              'order_cancelled'
            ).catch((err) => {
              logger.warn('[expireOrphanedTransactions] Failed to notify buyer of paid expiry', {
                transactionId: doc.id,
                error: err instanceof Error ? err.message : err,
              });
            });
          }
        }

        if (count > 0) {
          await batch.commit();
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
