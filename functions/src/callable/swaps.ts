/**
 * Swap callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';

/**
 * Get active swap party info for homepage
 */
export const getActiveSwapPartyInfo = onCall(
  { invoker: 'public', memory: '512MiB' },
  async () => {
  try {
    // Get currently active party
    const activeSnapshot = await db
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
          endDate: partyData.endDate?.toDate().toISOString(),
          participantsCount: partyData.participantsCount || 0,
          itemsCount: partyData.itemsCount || 0,
          swapsCount: partyData.swapsCount || 0,
        },
        nextParty: null,
      };
    }

    // No active party, get next upcoming
    const upcomingSnapshot = await db
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
          startDate: partyData.startDate?.toDate().toISOString(),
          endDate: partyData.endDate?.toDate().toISOString(),
        },
      };
    }

    return {
      hasActiveParty: false,
      party: null,
      nextParty: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting active swap party info:', error);
    throw new HttpsError('internal', 'Failed to get swap party info: ' + message);
  }
});

/**
 * Get swap party leaderboard (top swappers)
 */
export const getSwapPartyLeaderboard = onCall(
  { invoker: 'public', memory: '512MiB' },
  async (request) => {
  const { partyId, limit: limitParam = 10 } = request.data;

  if (!partyId) {
    throw new HttpsError('invalid-argument', 'partyId is required');
  }

  try {
    // Get all completed swaps for this party
    const swapsSnapshot = await db
      .collection('swaps')
      .where('partyId', '==', partyId)
      .where('status', '==', 'completed')
      .get();

    // Count swaps per user
    const userSwapCounts: Record<
      string,
      { count: number; name: string; image?: string }
    > = {};

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
      .map(([userId, data]) => ({
        userId,
        ...data,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limitParam);

    return { leaderboard };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting swap party leaderboard:', error);
    throw new HttpsError('internal', 'Failed to get leaderboard: ' + message);
  }
});
