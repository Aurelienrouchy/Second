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
exports.sendSwapZoneReminders = exports.updateSwapPartyStatuses = void 0;
/**
 * Scheduled swap functions
 * Firebase Functions v7 - using onSchedule
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const notifications_1 = require("../utils/notifications");
/**
 * Cleanup pending swaps and items when a swap party ends.
 * - Cancels all swaps in status 'proposed' linked to this party
 * - Resets isPending on swapPartyItems that were pending
 * - Notifies affected participants whose swaps were cancelled
 */
async function cleanupEndedParty(partyId, partyName) {
    // 1. Cancel all 'proposed' swaps linked to this party
    const proposedSwapsSnapshot = await firebase_1.db
        .collection('swaps')
        .where('partyId', '==', partyId)
        .where('status', '==', 'proposed')
        .get();
    if (proposedSwapsSnapshot.empty) {
        logger.info('[swapPartyCleanup] No proposed swaps to cancel', { partyId });
    }
    else {
        logger.info('[swapPartyCleanup] Cancelling proposed swaps', {
            partyId,
            count: proposedSwapsSnapshot.docs.length,
        });
        // Collect unique user IDs to notify
        const usersToNotify = new Set();
        const batch = firebase_1.db.batch();
        for (const swapDoc of proposedSwapsSnapshot.docs) {
            const swap = swapDoc.data();
            batch.update(swapDoc.ref, {
                status: 'cancelled',
                cancelReason: 'party_ended',
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
            if (swap.initiatorId)
                usersToNotify.add(swap.initiatorId);
            if (swap.receiverId)
                usersToNotify.add(swap.receiverId);
        }
        await batch.commit();
        // Notify affected users
        for (const userId of usersToNotify) {
            try {
                await (0, notifications_1.sendPushNotification)(userId, 'Swap Zone terminee', `La Swap Zone "${partyName}" est terminee. Tes propositions en attente ont ete annulees.`, { partyId, partyName }, 'swap_update');
            }
            catch (notifError) {
                logger.error('[swapPartyCleanup] Failed to notify user', { userId, error: notifError });
            }
        }
    }
    // 2. Reset isPending on all pending items in this party
    const pendingItemsSnapshot = await firebase_1.db
        .collection('swapPartyItems')
        .where('partyId', '==', partyId)
        .where('isPending', '==', true)
        .get();
    if (!pendingItemsSnapshot.empty) {
        logger.info('[swapPartyCleanup] Resetting pending items', {
            partyId,
            count: pendingItemsSnapshot.docs.length,
        });
        const itemsBatch = firebase_1.db.batch();
        for (const itemDoc of pendingItemsSnapshot.docs) {
            itemsBatch.update(itemDoc.ref, { isPending: false });
        }
        await itemsBatch.commit();
    }
}
/**
 * Update swap party statuses automatically
 * Runs every 5 minutes to transition parties: upcoming -> active -> ended
 * When a party transitions to 'ended', cleanup pending swaps and items.
 */
exports.updateSwapPartyStatuses = (0, scheduler_1.onSchedule)({ schedule: 'every 5 minutes', region: 'northamerica-northeast1', memory: '512MiB' }, async () => {
    var _a, _b;
    logger.info('Checking swap party statuses...');
    const now = new Date();
    try {
        // Get all non-ended parties
        const partiesSnapshot = await firebase_1.db
            .collection('swapParties')
            .where('status', 'in', ['upcoming', 'active'])
            .get();
        let updatedCount = 0;
        for (const partyDoc of partiesSnapshot.docs) {
            const party = partyDoc.data();
            const startDate = (_a = party.startDate) === null || _a === void 0 ? void 0 : _a.toDate();
            const endDate = (_b = party.endDate) === null || _b === void 0 ? void 0 : _b.toDate();
            let newStatus = null;
            if (party.status === 'upcoming' && startDate && now >= startDate) {
                newStatus = 'active';
            }
            else if (party.status === 'active' && endDate && now >= endDate) {
                newStatus = 'ended';
            }
            if (newStatus) {
                await firebase_1.db.collection('swapParties').doc(partyDoc.id).update({
                    status: newStatus,
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
                updatedCount++;
                logger.info(`Updated party ${partyDoc.id} status to ${newStatus}`);
                // Cleanup when a party ends: cancel proposed swaps, reset pending items
                if (newStatus === 'ended') {
                    await cleanupEndedParty(partyDoc.id, party.name || 'Swap Zone');
                }
            }
        }
        logger.info('Swap party status check complete', { updatedCount });
    }
    catch (error) {
        logger.error('Error updating swap party statuses', { error });
    }
});
/**
 * Send swap zone reminders 3 days before start
 * Runs daily at 10:00 AM Montreal time
 */
exports.sendSwapZoneReminders = (0, scheduler_1.onSchedule)({
    schedule: '0 10 * * *',
    region: 'northamerica-northeast1',
    timeZone: 'America/Montreal',
    memory: '512MiB',
}, async () => {
    try {
        // Calculate the target date (3 days from now)
        const now = new Date();
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + 3);
        // Set to start of day
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        // Set to end of day
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);
        logger.info('Looking for swap parties starting soon', {
            startOfDay: startOfDay.toISOString(),
            endOfDay: endOfDay.toISOString(),
        });
        // Find swap parties starting in 3 days
        const partiesSnapshot = await firebase_1.db
            .collection('swapParties')
            .where('startDate', '>=', startOfDay)
            .where('startDate', '<=', endOfDay)
            .where('status', '==', 'upcoming')
            .get();
        if (partiesSnapshot.empty) {
            logger.info('No swap parties starting in 3 days');
            return;
        }
        logger.info('Found swap parties to notify about', { count: partiesSnapshot.docs.length });
        // Process each party
        for (const partyDoc of partiesSnapshot.docs) {
            const partyData = partyDoc.data();
            const partyId = partyDoc.id;
            const partyName = partyData.name || 'Swap Zone';
            // Get all participants
            const participantsSnapshot = await firebase_1.db
                .collection('swapPartyParticipants')
                .where('partyId', '==', partyId)
                .get();
            if (participantsSnapshot.empty) {
                logger.info('No participants for party', { partyId });
                continue;
            }
            const userIds = participantsSnapshot.docs.map((doc) => doc.data().userId);
            logger.info('Notifying participants for party', { partyName, participantCount: userIds.length });
            // Send notifications to all participants
            await Promise.all(userIds.map(async (userId) => {
                var _a, _b;
                // Check user's notification preferences
                const userDoc = await firebase_1.db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userPrefs = (_b = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.preferences) === null || _b === void 0 ? void 0 : _b.notifications;
                    if ((userPrefs === null || userPrefs === void 0 ? void 0 : userPrefs.swapZoneReminder) === false) {
                        logger.info('User has swap zone reminder notifications disabled', { userId });
                        return;
                    }
                }
                await (0, notifications_1.sendPushNotification)(userId, 'Swap Zone dans 3 jours !', `N'oubliez pas d'ajouter vos articles à "${partyName}"`, {
                    partyId,
                    partyName,
                    daysUntil: '3',
                }, 'swap_zone_reminder');
            }));
            logger.info('Sent reminders for party', { partyName });
        }
    }
    catch (error) {
        logger.error('Error in sendSwapZoneReminders', { error });
    }
});
//# sourceMappingURL=swaps.js.map