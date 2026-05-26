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
exports.updatePopularityScores = (0, scheduler_1.onSchedule)({ schedule: 'every 6 hours', region: 'northamerica-northeast1', memory: '512MiB' }, async () => {
    try {
        console.log('Starting popularity scores update...');
        // Get all active products from search index
        const searchIndexSnapshot = await firebase_1.db
            .collection('search_index')
            .where('isActive', '==', true)
            .where('isSold', '==', false)
            .get();
        // Collect updates first, then chunk into batches of 499 ops max
        // (Firestore batch limit is 500 operations)
        const MAX_BATCH_OPS = 499;
        const updates = [];
        searchIndexSnapshot.forEach((doc) => {
            var _a;
            const data = doc.data();
            const newPopularityScore = (0, search_1.calculatePopularityScore)(data.views || 0, data.likes || 0, ((_a = data.createdAt) === null || _a === void 0 ? void 0 : _a.toDate()) || new Date());
            // Only update if score changed significantly
            const currentScore = data.popularityScore || 0;
            if (Math.abs(newPopularityScore - currentScore) > 0.1) {
                updates.push({ ref: doc.ref, score: newPopularityScore });
            }
        });
        if (updates.length > 0) {
            let batch = firebase_1.db.batch();
            let opCount = 0;
            for (const { ref, score } of updates) {
                if (opCount >= MAX_BATCH_OPS) {
                    await batch.commit();
                    batch = firebase_1.db.batch();
                    opCount = 0;
                }
                batch.update(ref, {
                    popularityScore: score,
                    lastIndexed: firebase_1.FieldValue.serverTimestamp(),
                });
                opCount++;
            }
            if (opCount > 0) {
                await batch.commit();
            }
            console.log(`Updated ${updates.length} popularity scores`);
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