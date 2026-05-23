/**
 * Swap callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';

/** Strip undefined values (Firestore rejects undefined) */
const stripUndefined = <T extends Record<string, any>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

/** Resolve items arrays with backward compat for legacy single-item swaps */
function getSwapItems(swap: any, side: 'initiator' | 'receiver'): any[] {
  if (side === 'initiator') {
    return swap.initiatorItems || (swap.initiatorItem ? [swap.initiatorItem] : []);
  }
  return swap.receiverItems || (swap.receiverItem ? [swap.receiverItem] : []);
}

/**
 * Validate that all articles in a list are available (exist, isActive, not isSold).
 * Must be called inside a transaction; reads via the transaction handle.
 */
async function validateArticlesAvailable(
  tx: FirebaseFirestore.Transaction,
  items: { articleId: string; title?: string }[],
  label: string
): Promise<void> {
  for (const item of items) {
    const articleRef = db.collection('articles').doc(item.articleId);
    const articleSnap = await tx.get(articleRef);

    if (!articleSnap.exists) {
      throw new HttpsError(
        'not-found',
        `${label} : l'article "${item.title || item.articleId}" n'existe plus`
      );
    }

    const data = articleSnap.data()!;
    if (data.isActive === false) {
      throw new HttpsError(
        'failed-precondition',
        `${label} : l'article "${item.title || item.articleId}" n'est plus actif`
      );
    }
    if (data.isSold === true) {
      throw new HttpsError(
        'failed-precondition',
        `${label} : l'article "${item.title || item.articleId}" a déjà été vendu`
      );
    }
  }
}

/**
 * Check if either user has blocked the other.
 * Reads user docs to inspect blockedUsers arrays.
 */
async function areUsersBlocked(userId1: string, userId2: string): Promise<boolean> {
  const [user1Snap, user2Snap] = await Promise.all([
    db.collection('users').doc(userId1).get(),
    db.collection('users').doc(userId2).get(),
  ]);

  const blockedBy1 = user1Snap.data()?.blockedUsers || [];
  const blockedBy2 = user2Snap.data()?.blockedUsers || [];

  return (
    blockedBy1.some((u: any) => u.userId === userId2 || u === userId2) ||
    blockedBy2.some((u: any) => u.userId === userId1 || u === userId1)
  );
}

/**
 * Propose a multi-article swap
 * Supports swapping multiple items on each side with validation.
 * Uses runTransaction to atomically verify article availability before creating the swap.
 */
export const proposeMultiSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

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

    // Auth: initiatorId must match the authenticated user
    if (initiatorId !== request.auth.uid) {
      throw new HttpsError(
        'permission-denied',
        'L\'initiateur doit correspondre à l\'utilisateur authentifié'
      );
    }

    // Validate required fields
    if (!initiatorId || !initiatorName || !receiverId || !receiverName) {
      throw new HttpsError(
        'invalid-argument',
        'Missing required user information'
      );
    }

    if (initiatorId === receiverId) {
      throw new HttpsError('invalid-argument', 'Impossible de proposer un échange avec soi-même');
    }

    if (!Array.isArray(initiatorItems) || initiatorItems.length === 0) {
      throw new HttpsError('invalid-argument', 'Initiator must provide at least one item');
    }

    if (!Array.isArray(receiverItems) || receiverItems.length === 0) {
      throw new HttpsError('invalid-argument', 'Receiver must provide at least one item');
    }

    try {
      // Check user blocking BEFORE the transaction (not a transactional read, acceptable here
      // because blocking is a social feature, not a financial invariant)
      const blocked = await areUsersBlocked(initiatorId, receiverId);
      if (blocked) {
        throw new HttpsError(
          'failed-precondition',
          'Impossible de proposer un échange avec cet utilisateur'
        );
      }

      // Use runTransaction to atomically verify all articles and create the swap
      const swapId = await db.runTransaction(async (tx) => {
        // Validate all articles are available (exist + isActive + !isSold)
        await validateArticlesAvailable(tx, initiatorItems, 'Article proposé');
        await validateArticlesAvailable(tx, receiverItems, 'Article demandé');

        // Calculate total values
        const initiatorTotalValue = initiatorItems.reduce(
          (sum: number, item: any) => sum + (item.price || 0),
          0
        );
        const receiverTotalValue = receiverItems.reduce(
          (sum: number, item: any) => sum + (item.price || 0),
          0
        );

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

        // Create swap document inside transaction
        const newSwapRef = db.collection('swaps').doc();
        tx.set(newSwapRef, swapData);

        return newSwapRef.id;
      });

      // Mark party items as pending AFTER transaction succeeds (non-critical, outside tx)
      if (partyId) {
        const partyItemsRef = db.collection('swapPartyItems');

        for (const item of initiatorItems) {
          const partyItemQuery = await partyItemsRef
            .where('partyId', '==', partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', initiatorId)
            .get();

          for (const d of partyItemQuery.docs) {
            await d.ref.update({ isPending: true });
          }
        }

        for (const item of receiverItems) {
          const partyItemQuery = await partyItemsRef
            .where('partyId', '==', partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', receiverId)
            .get();

          for (const d of partyItemQuery.docs) {
            await d.ref.update({ isPending: true });
          }
        }
      }

      logger.info('Swap proposal created', { swapId, initiatorId, receiverId });

      return {
        swapId,
        success: true,
        message: 'Swap proposal created successfully',
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        throw error;
      }

      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error proposing multi-swap', { error: errMsg, initiatorId, receiverId });
      throw new HttpsError('internal', 'Failed to propose swap: ' + errMsg);
    }
  }
);

/**
 * Accept a swap — callable by the receiver only.
 * Uses runTransaction to atomically verify:
 *   1. The swap exists and is still in 'proposed' status
 *   2. ALL articles on both sides are still available (exist + isActive + !isSold)
 * Then transitions the swap to 'accepted'.
 */
export const acceptSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      await db.runTransaction(async (tx) => {
        // 1. Read the swap
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        // 2. Auth: only the receiver can accept
        if (swap.receiverId !== request.auth!.uid) {
          throw new HttpsError(
            'permission-denied',
            'Seul le destinataire peut accepter cet échange'
          );
        }

        // 3. Status must be 'proposed'
        if (swap.status !== 'proposed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'accepter un échange en statut "${swap.status}"`
          );
        }

        // 4. Validate ALL articles on both sides are still available
        const initiatorItems = getSwapItems(swap, 'initiator');
        const receiverItems = getSwapItems(swap, 'receiver');

        await validateArticlesAvailable(tx, initiatorItems, 'Article du proposant');
        await validateArticlesAvailable(tx, receiverItems, 'Votre article');

        // 5. Transition to accepted
        tx.update(swapRef, {
          status: 'accepted',
          acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // Mark party items as swapped AFTER transaction succeeds (non-critical)
      const swapSnap = await db.collection('swaps').doc(swapId).get();
      const swap = swapSnap.data();

      if (swap?.partyId) {
        const partyItemsRef = db.collection('swapPartyItems');

        const initiatorItems = getSwapItems(swap, 'initiator');
        for (const item of initiatorItems) {
          const q = await partyItemsRef
            .where('partyId', '==', swap.partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', swap.initiatorId)
            .get();
          for (const d of q.docs) {
            await d.ref.update({ isSwapped: true });
          }
        }

        const receiverItems = getSwapItems(swap, 'receiver');
        for (const item of receiverItems) {
          const q = await partyItemsRef
            .where('partyId', '==', swap.partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', swap.receiverId)
            .get();
          for (const d of q.docs) {
            await d.ref.update({ isSwapped: true });
          }
        }
      }

      logger.info('Swap accepted', { swapId, receiverId: request.auth.uid });

      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        throw error;
      }

      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error accepting swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'acceptation: ' + errMsg);
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
