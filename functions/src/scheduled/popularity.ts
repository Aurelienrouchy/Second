/**
 * Scheduled popularity score updates
 * Firebase Functions v7 - using onSchedule
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue } from '../config/firebase';
import { calculatePopularityScore } from '../utils/search';

/**
 * Update popularity scores for all active products
 * Runs every 6 hours
 */
export const updatePopularityScores = onSchedule({ schedule: 'every 6 hours', memory: '512MiB' }, async () => {
  try {
    console.log('Starting popularity scores update...');

    const batch = db.batch();
    let updateCount = 0;

    // Get all active products from search index
    const searchIndexSnapshot = await db
      .collection('search_index')
      .where('isActive', '==', true)
      .where('isSold', '==', false)
      .get();

    searchIndexSnapshot.forEach((doc) => {
      const data = doc.data();
      const newPopularityScore = calculatePopularityScore(
        data.views || 0,
        data.likes || 0,
        data.createdAt?.toDate() || new Date()
      );

      // Only update if score changed significantly
      const currentScore = data.popularityScore || 0;
      if (Math.abs(newPopularityScore - currentScore) > 0.1) {
        batch.update(doc.ref, {
          popularityScore: newPopularityScore,
          lastIndexed: FieldValue.serverTimestamp(),
        });
        updateCount++;
      }
    });

    if (updateCount > 0) {
      await batch.commit();
      console.log(`Updated ${updateCount} popularity scores`);
    } else {
      console.log('No popularity scores needed updating');
    }
  } catch (error) {
    console.error('Error updating popularity scores:', error);
  }
});
