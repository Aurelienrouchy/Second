/**
 * Scheduled cleanup functions
 * Firebase Functions v7 - using onSchedule
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../config/firebase';

/**
 * Clean up old search index entries
 * Runs every 24 hours
 */
export const cleanupSearchIndex = onSchedule({ schedule: 'every 24 hours', memory: '512MiB' }, async () => {
  try {
    console.log('Starting search index cleanup...');

    const batch = db.batch();
    let deleteCount = 0;

    // Find search index entries for inactive products
    const searchIndexSnapshot = await db
      .collection('search_index')
      .where('isActive', '==', false)
      .get();

    searchIndexSnapshot.forEach((doc) => {
      batch.delete(doc.ref);
      deleteCount++;
    });

    // Find search index entries for sold products
    const soldSearchIndexSnapshot = await db
      .collection('search_index')
      .where('isSold', '==', true)
      .get();

    soldSearchIndexSnapshot.forEach((doc) => {
      batch.delete(doc.ref);
      deleteCount++;
    });

    if (deleteCount > 0) {
      await batch.commit();
      console.log(`Cleaned up ${deleteCount} search index entries`);
    } else {
      console.log('No search index entries to clean up');
    }
  } catch (error) {
    console.error('Error cleaning up search index:', error);
  }
});
