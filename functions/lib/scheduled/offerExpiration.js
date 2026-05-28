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
exports.expireStaleOffers = void 0;
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
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/** Firestore batch limit is 500; use 450 for safety margin */
const BATCH_SIZE = 450;
/**
 * Find all offer messages that are still pending but past their
 * expiresAt timestamp and flip them to 'expired'.
 */
exports.expireStaleOffers = (0, scheduler_1.onSchedule)({
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
}, async () => {
    const now = new Date();
    try {
        // Query all offer messages still pending past their expiry
        // Requires composite index: type ASC, offer.status ASC, offer.expiresAt ASC
        const pendingOffersSnap = await firebase_1.db
            .collection('messages')
            .where('type', '==', 'offer')
            .where('offer.status', '==', 'pending')
            .where('offer.expiresAt', '<', now)
            .get();
        if (pendingOffersSnap.empty) {
            logger.info('[expireStaleOffers] No stale offers found');
            return;
        }
        // Batch update in chunks to respect Firestore 500-op limit
        let batch = firebase_1.db.batch();
        let count = 0;
        let totalExpired = 0;
        for (const doc of pendingOffersSnap.docs) {
            batch.update(doc.ref, { 'offer.status': 'expired' });
            count++;
            totalExpired++;
            if (count >= BATCH_SIZE) {
                await batch.commit();
                batch = firebase_1.db.batch();
                count = 0;
            }
        }
        if (count > 0) {
            await batch.commit();
        }
        logger.info(`[expireStaleOffers] Expired ${totalExpired} stale offers`);
    }
    catch (error) {
        logger.error('[expireStaleOffers] Error expiring stale offers', {
            error: error instanceof Error ? error.message : error,
        });
    }
});
//# sourceMappingURL=offerExpiration.js.map