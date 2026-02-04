"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupSearchIndex = void 0;
/**
 * Scheduled cleanup functions
 * Firebase Functions v7 - using onSchedule
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_1 = require("../config/firebase");
/**
 * Clean up old search index entries
 * Runs every 24 hours
 */
exports.cleanupSearchIndex = (0, scheduler_1.onSchedule)({ schedule: 'every 24 hours', memory: '512MiB' }, async () => {
    try {
        console.log('Starting search index cleanup...');
        const batch = firebase_1.db.batch();
        let deleteCount = 0;
        // Find search index entries for inactive products
        const searchIndexSnapshot = await firebase_1.db
            .collection('search_index')
            .where('isActive', '==', false)
            .get();
        searchIndexSnapshot.forEach((doc) => {
            batch.delete(doc.ref);
            deleteCount++;
        });
        // Find search index entries for sold products
        const soldSearchIndexSnapshot = await firebase_1.db
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
        }
        else {
            console.log('No search index entries to clean up');
        }
    }
    catch (error) {
        console.error('Error cleaning up search index:', error);
    }
});
//# sourceMappingURL=cleanup.js.map