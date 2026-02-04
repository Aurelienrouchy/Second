"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSwapZoneReminders = exports.updateSwapPartyStatuses = void 0;
/**
 * Scheduled swap functions
 * Firebase Functions v7 - using onSchedule
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_1 = require("../config/firebase");
const notifications_1 = require("../utils/notifications");
/**
 * Update swap party statuses automatically
 * Runs every 5 minutes to transition parties: upcoming -> active -> ended
 */
exports.updateSwapPartyStatuses = (0, scheduler_1.onSchedule)({ schedule: 'every 5 minutes', memory: '512MiB' }, async () => {
    var _a, _b;
    console.log('Checking swap party statuses...');
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
                console.log(`Updated party ${partyDoc.id} status to ${newStatus}`);
            }
        }
        console.log(`Swap party status check complete. Updated ${updatedCount} parties.`);
    }
    catch (error) {
        console.error('Error updating swap party statuses:', error);
    }
});
/**
 * Send swap zone reminders 3 days before start
 * Runs daily at 10:00 AM Paris time
 */
exports.sendSwapZoneReminders = (0, scheduler_1.onSchedule)({
    schedule: '0 10 * * *',
    timeZone: 'Europe/Paris',
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
        console.log(`Looking for swap parties starting between ${startOfDay.toISOString()} and ${endOfDay.toISOString()}`);
        // Find swap parties starting in 3 days
        const partiesSnapshot = await firebase_1.db
            .collection('swapParties')
            .where('startDate', '>=', startOfDay)
            .where('startDate', '<=', endOfDay)
            .where('status', '==', 'upcoming')
            .get();
        if (partiesSnapshot.empty) {
            console.log('No swap parties starting in 3 days');
            return;
        }
        console.log(`Found ${partiesSnapshot.docs.length} swap parties to notify about`);
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
                console.log(`No participants for party ${partyId}`);
                continue;
            }
            const userIds = participantsSnapshot.docs.map((doc) => doc.data().userId);
            console.log(`Notifying ${userIds.length} participants for party ${partyName}`);
            // Send notifications to all participants
            await Promise.all(userIds.map(async (userId) => {
                var _a, _b;
                // Check user's notification preferences
                const userDoc = await firebase_1.db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userPrefs = (_b = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.preferences) === null || _b === void 0 ? void 0 : _b.notifications;
                    if ((userPrefs === null || userPrefs === void 0 ? void 0 : userPrefs.swapZoneReminder) === false) {
                        console.log(`User ${userId} has swap zone reminder notifications disabled`);
                        return;
                    }
                }
                await (0, notifications_1.sendPushNotification)(userId, '📦 Swap Zone dans 3 jours !', `N'oubliez pas d'ajouter vos articles à "${partyName}"`, {
                    partyId,
                    partyName,
                    daysUntil: '3',
                }, 'swap_zone_reminder');
            }));
            console.log(`Sent reminders for party ${partyName}`);
        }
    }
    catch (error) {
        console.error('Error in sendSwapZoneReminders:', error);
    }
});
//# sourceMappingURL=swaps.js.map