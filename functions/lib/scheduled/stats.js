"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateGlobalStats = void 0;
/**
 * Scheduled statistics functions
 * Firebase Functions v7 - using onSchedule
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_1 = require("../config/firebase");
/**
 * Update global stats periodically
 * Runs every hour
 */
exports.updateGlobalStats = (0, scheduler_1.onSchedule)({ schedule: 'every 1 hours', memory: '512MiB' }, async () => {
    try {
        console.log('Starting global stats update...');
        // Get total counts
        const [productsSnapshot, usersSnapshot] = await Promise.all([
            firebase_1.db
                .collection('products')
                .where('isActive', '==', true)
                .where('isSold', '==', false)
                .get(),
            firebase_1.db.collection('users').where('isActive', '==', true).get(),
        ]);
        const totalProducts = productsSnapshot.size;
        const totalUsers = usersSnapshot.size;
        // Calculate sales and revenue
        const soldProductsSnapshot = await firebase_1.db
            .collection('products')
            .where('isSold', '==', true)
            .get();
        let totalSales = 0;
        let totalRevenue = 0;
        const categoryStats = {};
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
        await firebase_1.db.collection('stats').doc('global').set({
            totalProducts,
            totalUsers,
            totalSales,
            totalRevenue,
            categoryStats,
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        console.log('Global stats updated successfully');
    }
    catch (error) {
        console.error('Error updating global stats:', error);
    }
});
//# sourceMappingURL=stats.js.map