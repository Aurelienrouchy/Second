"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupSearchIndex = void 0;
/**
 * Scheduled cleanup functions
 * Firebase Functions v7 - using onSchedule
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/** Firestore batch limit is 500; use 450 for safety margin */
const BATCH_SIZE = 450;
/**
 * Clean up old search index entries
 * Runs every 24 hours
 */
exports.cleanupSearchIndex = (0, scheduler_1.onSchedule)({ schedule: 'every 24 hours', region: 'northamerica-northeast1', memory: '512MiB' }, async () => {
    try {
        logger.info('Starting search index cleanup...');
        // Collect all refs to delete
        const refsToDelete = [];
        // Find search index entries for inactive products
        const searchIndexSnapshot = await firebase_1.db
            .collection('search_index')
            .where('isActive', '==', false)
            .get();
        searchIndexSnapshot.forEach((doc) => {
            refsToDelete.push(doc.ref);
        });
        // Find search index entries for sold products
        const soldSearchIndexSnapshot = await firebase_1.db
            .collection('search_index')
            .where('isSold', '==', true)
            .get();
        soldSearchIndexSnapshot.forEach((doc) => {
            refsToDelete.push(doc.ref);
        });
        if (refsToDelete.length > 0) {
            // Chunk into batches of BATCH_SIZE to respect Firestore 500-op limit
            let batch = firebase_1.db.batch();
            let count = 0;
            for (const ref of refsToDelete) {
                batch.delete(ref);
                count++;
                if (count >= BATCH_SIZE) {
                    await batch.commit();
                    batch = firebase_1.db.batch();
                    count = 0;
                }
            }
            if (count > 0) {
                await batch.commit();
            }
            logger.info(`Cleaned up ${refsToDelete.length} search index entries`);
        }
        else {
            logger.info('No search index entries to clean up');
        }
    }
    catch (error) {
        logger.error('Error cleaning up search index:', error);
    }
});
//# sourceMappingURL=cleanup.js.map