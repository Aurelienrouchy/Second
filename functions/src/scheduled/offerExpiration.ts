/**
 * Scheduled offer expiration
 * Firebase Functions v7 - using onSchedule
 *
 * Expires stale offer messages whose expiresAt has passed but whose
 * status is still 'pending' in Firestore. The client calculates
 * expiresAt (48h from creation) and displays "Expired" locally, but
 * this job ensures the Firestore status is authoritative so that
 * other readers (triggers, other clients) see the correct state.
 *
 * Runs every hour.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';

/** Firestore batch limit is 500; use 450 for safety margin */
const BATCH_SIZE = 450;

/**
 * F80: bound the stale-offer query per run. An unbounded .get() loads every
 * stale offer into memory (OOM/timeout at scale). The next hourly run picks up
 * any remainder, so capping per run never loses work.
 */
const MAX_OFFERS_PER_RUN = 1000;

/**
 * Find all offer messages that are still pending but past their
 * expiresAt timestamp and flip them to 'expired'.
 */
export const expireStaleOffers = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    const now = new Date();

    try {
      // Query all offer messages still pending past their expiry
      // Requires composite index: type ASC, offer.status ASC, offer.expiresAt ASC
      const pendingOffersSnap = await db
        .collection('messages')
        .where('type', '==', 'offer')
        .where('offer.status', '==', 'pending')
        .where('offer.expiresAt', '<', now)
        .limit(MAX_OFFERS_PER_RUN)
        .get();

      if (pendingOffersSnap.empty) {
        logger.info('[expireStaleOffers] No stale offers found');
        return;
      }

      // Batch update in chunks to respect Firestore 500-op limit
      let batch = db.batch();
      let count = 0;
      let totalExpired = 0;

      for (const doc of pendingOffersSnap.docs) {
        batch.update(doc.ref, { 'offer.status': 'expired' });
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

      logger.info(`[expireStaleOffers] Expired ${totalExpired} stale offers`);
    } catch (error) {
      logger.error('[expireStaleOffers] Error expiring stale offers', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }
);
