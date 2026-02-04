/**
 * Scheduled statistics functions
 * Firebase Functions v7 - using onSchedule
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue } from '../config/firebase';

/**
 * Update global stats periodically
 * Runs every hour
 */
export const updateGlobalStats = onSchedule({ schedule: 'every 1 hours', memory: '512MiB' }, async () => {
  try {
    console.log('Starting global stats update...');

    // Get total counts
    const [productsSnapshot, usersSnapshot] = await Promise.all([
      db
        .collection('products')
        .where('isActive', '==', true)
        .where('isSold', '==', false)
        .get(),
      db.collection('users').where('isActive', '==', true).get(),
    ]);

    const totalProducts = productsSnapshot.size;
    const totalUsers = usersSnapshot.size;

    // Calculate sales and revenue
    const soldProductsSnapshot = await db
      .collection('products')
      .where('isSold', '==', true)
      .get();

    let totalSales = 0;
    let totalRevenue = 0;
    const categoryStats: Record<
      string,
      {
        productCount: number;
        totalSales: number;
        totalRevenue: number;
        averagePrice?: number;
      }
    > = {};

    soldProductsSnapshot.forEach((doc) => {
      const product = doc.data();
      totalSales++;
      totalRevenue += product.price || 0;

      const category = product.category;
      if (category) {
        if (!categoryStats[category]) {
          categoryStats[category] = {
            productCount: 0,
            totalSales: 0,
            totalRevenue: 0,
          };
        }
        categoryStats[category].totalSales++;
        categoryStats[category].totalRevenue += product.price || 0;
      }
    });

    // Count active products by category
    productsSnapshot.forEach((doc) => {
      const product = doc.data();
      const category = product.category;
      if (category) {
        if (!categoryStats[category]) {
          categoryStats[category] = {
            productCount: 0,
            totalSales: 0,
            totalRevenue: 0,
          };
        }
        categoryStats[category].productCount++;
      }
    });

    // Calculate average prices
    Object.keys(categoryStats).forEach((category) => {
      const stats = categoryStats[category];
      stats.averagePrice =
        stats.totalSales > 0 ? stats.totalRevenue / stats.totalSales : 0;
    });

    // Update global stats
    await db.collection('stats').doc('global').set(
      {
        totalProducts,
        totalUsers,
        totalSales,
        totalRevenue,
        categoryStats,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log('Global stats updated successfully');
  } catch (error) {
    console.error('Error updating global stats:', error);
  }
});
