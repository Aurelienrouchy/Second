/**
 * Swap callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { db } from '../config/firebase';

/**
 * Propose a multi-article swap
 * Supports swapping multiple items on each side with validation
 */
export const proposeMultiSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    const {
      initiatorId,
      initiatorName,
      initiatorImage,
      initiatorItems,
      receiverItems,
      receiverId,
      receiverName,
      receiverImage,
      message,
      cashTopUp,
      partyId,
    } = request.data;

    // Validate required fields
    if (!initiatorId || !initiatorName || !receiverId || !receiverName) {
      throw new HttpsError(
        'invalid-argument',
        'Missing required user information'
      );
    }

    if (!Array.isArray(initiatorItems) || initiatorItems.length === 0) {
      throw new HttpsError('invalid-argument', 'Initiator must provide at least one item');
    }

    if (!Array.isArray(receiverItems) || receiverItems.length === 0) {
      throw new HttpsError('invalid-argument', 'Receiver must provide at least one item');
    }

    try {
      // Validate all items exist in articles collection
      const articlesRef = admin.firestore().collection('articles');

      for (const item of initiatorItems) {
        const articleDoc = await articlesRef.doc(item.articleId).get();
        if (!articleDoc.exists) {
          throw new HttpsError(
            'not-found',
            `Initiator item ${item.articleId} not found`
          );
        }
        // Verify article is active and not already swapped
        const articleData = articleDoc.data()!;
        if (!articleData.isActive) {
          throw new HttpsError(
            'failed-precondition',
            `Initiator item "${item.title}" is no longer active`
          );
        }
      }

      for (const item of receiverItems) {
        const articleDoc = await articlesRef.doc(item.articleId).get();
        if (!articleDoc.exists) {
          throw new HttpsError(
            'not-found',
            `Receiver item ${item.articleId} not found`
          );
        }
        // Verify article is active and not already swapped
        const articleData = articleDoc.data()!;
        if (!articleData.isActive) {
          throw new HttpsError(
            'failed-precondition',
            `Receiver item "${item.title}" is no longer active`
          );
        }
      }

      // Calculate total values
      const initiatorTotalValue = initiatorItems.reduce(
        (sum, item) => sum + (item.price || 0),
        0
      );
      const receiverTotalValue = receiverItems.reduce(
        (sum, item) => sum + (item.price || 0),
        0
      );

      /** Strip undefined values (Firestore rejects undefined) */
      const stripUndefined = <T extends Record<string, any>>(obj: T): T =>
        Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

      // Build swap document
      const swapData = stripUndefined({
        initiatorId,
        initiatorName,
        initiatorImage,
        initiatorItems: initiatorItems.map(stripUndefined),
        initiatorTotalValue,
        receiverId,
        receiverName,
        receiverImage,
        receiverItems: receiverItems.map(stripUndefined),
        receiverTotalValue,
        status: 'proposed',
        message,
        cashTopUp: cashTopUp ? { amount: cashTopUp.amount, payerId: cashTopUp.payerId } : undefined,
        partyId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Create swap document
      const swapsRef = admin.firestore().collection('swaps');
      const newSwapRef = await swapsRef.add(swapData);

      // Mark all items as isPending in party if partyId is provided
      if (partyId) {
        const partyItemsRef = admin.firestore().collection('swapPartyItems');

        // Mark initiator items as pending
        for (const item of initiatorItems) {
          const partyItemQuery = await partyItemsRef
            .where('partyId', '==', partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', initiatorId)
            .get();

          for (const doc of partyItemQuery.docs) {
            await doc.ref.update({ isPending: true });
          }
        }

        // Mark receiver items as pending
        for (const item of receiverItems) {
          const partyItemQuery = await partyItemsRef
            .where('partyId', '==', partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', receiverId)
            .get();

          for (const doc of partyItemQuery.docs) {
            await doc.ref.update({ isPending: true });
          }
        }
      }

      return {
        swapId: newSwapRef.id,
        success: true,
        message: 'Swap proposal created successfully',
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error proposing multi-swap:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', 'Failed to propose swap: ' + message);
    }
  }
);

/**
 * Get active swap party info for homepage
 */
export const getActiveSwapPartyInfo = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
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
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
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
