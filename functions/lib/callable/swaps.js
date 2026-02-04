"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSwapPartyLeaderboard = exports.getActiveSwapPartyInfo = void 0;
/**
 * Swap callable functions
 * Firebase Functions v7 - using onCall
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
/**
 * Get active swap party info for homepage
 */
exports.getActiveSwapPartyInfo = (0, https_1.onCall)({ invoker: 'public', memory: '512MiB' }, async () => {
    var _a, _b, _c;
    try {
        // Get currently active party
        const activeSnapshot = await firebase_1.db
            .collection('swapParties')
            .where('status', '==', 'active')
            .limit(1)
            .get();
        if (!activeSnapshot.empty) {
            const party = activeSnapshot.docs[0];
            const partyData = party.data();
            return {
                hasActiveParty: true,
                party: {
                    id: party.id,
                    name: partyData.name,
                    emoji: partyData.emoji,
                    description: partyData.description,
                    theme: partyData.theme,
                    isGeneralist: partyData.isGeneralist,
                    endDate: (_a = partyData.endDate) === null || _a === void 0 ? void 0 : _a.toDate().toISOString(),
                    participantsCount: partyData.participantsCount || 0,
                    itemsCount: partyData.itemsCount || 0,
                    swapsCount: partyData.swapsCount || 0,
                },
                nextParty: null,
            };
        }
        // No active party, get next upcoming
        const upcomingSnapshot = await firebase_1.db
            .collection('swapParties')
            .where('status', '==', 'upcoming')
            .orderBy('startDate', 'asc')
            .limit(1)
            .get();
        if (!upcomingSnapshot.empty) {
            const party = upcomingSnapshot.docs[0];
            const partyData = party.data();
            return {
                hasActiveParty: false,
                party: null,
                nextParty: {
                    id: party.id,
                    name: partyData.name,
                    emoji: partyData.emoji,
                    description: partyData.description,
                    theme: partyData.theme,
                    isGeneralist: partyData.isGeneralist,
                    startDate: (_b = partyData.startDate) === null || _b === void 0 ? void 0 : _b.toDate().toISOString(),
                    endDate: (_c = partyData.endDate) === null || _c === void 0 ? void 0 : _c.toDate().toISOString(),
                },
            };
        }
        return {
            hasActiveParty: false,
            party: null,
            nextParty: null,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error getting active swap party info:', error);
        throw new https_1.HttpsError('internal', 'Failed to get swap party info: ' + message);
    }
});
/**
 * Get swap party leaderboard (top swappers)
 */
exports.getSwapPartyLeaderboard = (0, https_1.onCall)({ invoker: 'public', memory: '512MiB' }, async (request) => {
    const { partyId, limit: limitParam = 10 } = request.data;
    if (!partyId) {
        throw new https_1.HttpsError('invalid-argument', 'partyId is required');
    }
    try {
        // Get all completed swaps for this party
        const swapsSnapshot = await firebase_1.db
            .collection('swaps')
            .where('partyId', '==', partyId)
            .where('status', '==', 'completed')
            .get();
        // Count swaps per user
        const userSwapCounts = {};
        swapsSnapshot.docs.forEach((doc) => {
            const swap = doc.data();
            // Count initiator
            if (!userSwapCounts[swap.initiatorId]) {
                userSwapCounts[swap.initiatorId] = {
                    count: 0,
                    name: swap.initiatorName,
                    image: swap.initiatorImage,
                };
            }
            userSwapCounts[swap.initiatorId].count++;
            // Count receiver
            if (!userSwapCounts[swap.receiverId]) {
                userSwapCounts[swap.receiverId] = {
                    count: 0,
                    name: swap.receiverName,
                    image: swap.receiverImage,
                };
            }
            userSwapCounts[swap.receiverId].count++;
        });
        // Sort by count and take top N
        const leaderboard = Object.entries(userSwapCounts)
            .map(([userId, data]) => (Object.assign({ userId }, data)))
            .sort((a, b) => b.count - a.count)
            .slice(0, limitParam);
        return { leaderboard };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error getting swap party leaderboard:', error);
        throw new https_1.HttpsError('internal', 'Failed to get leaderboard: ' + message);
    }
});
//# sourceMappingURL=swaps.js.map