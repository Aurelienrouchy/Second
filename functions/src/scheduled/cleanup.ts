/**
 * Scheduled cleanup functions
 * Firebase Functions v7 - using onSchedule
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';

/** Firestore batch limit is 500; use 450 for safety margin */
const BATCH_SIZE = 450;

/**
 * Clean up old search index entries
 * Runs every 24 hours
 */
export const cleanupSearchIndex = onSchedule({ schedule: 'every 24 hours', region: 'northamerica-northeast1', memory: '512MiB' }, async () => {
  try {
    logger.info('Starting search index cleanup...');

    // Collect all refs to delete
    const refsToDelete: FirebaseFirestore.DocumentReference[] = [];

    // Find search index entries for inactive products
    const searchIndexSnapshot = await db
      .collection('search_index')
      .where('isActive', '==', false)
      .get();

    searchIndexSnapshot.forEach((doc) => {
      refsToDelete.push(doc.ref);
    });

    // Find search index entries for sold products
    const soldSearchIndexSnapshot = await db
      .collection('search_index')
      .where('isSold', '==', true)
      .get();

    soldSearchIndexSnapshot.forEach((doc) => {
      refsToDelete.push(doc.ref);
    });

    if (refsToDelete.length > 0) {
      // Chunk into batches of BATCH_SIZE to respect Firestore 500-op limit
      let batch = db.batch();
      let count = 0;

      for (const ref of refsToDelete) {
        batch.delete(ref);
        count++;
        if (count >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }
      if (count > 0) {
        await batch.commit();
      }

      logger.info(`Cleaned up ${refsToDelete.length} search index entries`);
    } else {
      logger.info('No search index entries to clean up');
    }
  } catch (error) {
    logger.error('Error cleaning up search index:', error);
  }
});
