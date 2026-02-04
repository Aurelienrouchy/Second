"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePopularityScores = void 0;
/**
 * Scheduled popularity score updates
 * Firebase Functions v7 - using onSchedule
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_1 = require("../config/firebase");
const search_1 = require("../utils/search");
/**
 * Update popularity scores for all active products
 * Runs every 6 hours
 */
exports.updatePopularityScores = (0, scheduler_1.onSchedule)({ schedule: 'every 6 hours', memory: '512MiB' }, async () => {
    try {
        console.log('Starting popularity scores update...');
        const batch = firebase_1.db.batch();
        let updateCount = 0;
        // Get all active products from search index
        const searchIndexSnapshot = await firebase_1.db
            .collection('search_index')
            .where('isActive', '==', true)
            .where('isSold', '==', false)
            .get();
        searchIndexSnapshot.forEach((doc) => {
            var _a;
            const data = doc.data();
            const newPopularityScore = (0, search_1.calculatePopularityScore)(data.views || 0, data.likes || 0, ((_a = data.createdAt) === null || _a === void 0 ? void 0 : _a.toDate()) || new Date());
            // Only update if score changed significantly
            const currentScore = data.popularityScore || 0;
            if (Math.abs(newPopularityScore - currentScore) > 0.1) {
                batch.update(doc.ref, {
                    popularityScore: newPopularityScore,
                    lastIndexed: firebase_1.FieldValue.serverTimestamp(),
                });
                updateCount++;
            }
        });
        if (updateCount > 0) {
            await batch.commit();
            console.log(`Updated ${updateCount} popularity scores`);
        }
        else {
            console.log('No popularity scores needed updating');
        }
    }
    catch (error) {
        console.error('Error updating popularity scores:', error);
    }
});
//# sourceMappingURL=popularity.js.map