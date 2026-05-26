/**
 * Swap callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { updateUserRating } from './reviews';
import { sendPushNotification } from '../utils/notifications';

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

    // Reject cashTopUp — feature not yet implemented (no Stripe payment initiated)
    if (cashTopUp) {
      throw new HttpsError(
        'unimplemented',
        'Le complément monétaire n\'est pas encore disponible.'
      );
    }

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

      // Mark party items as pending (NOT swapped yet — isSwapped only on completed reception)
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
            await d.ref.update({ isPending: true });
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
            await d.ref.update({ isPending: true });
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

// ============================================================
// SWAP PARTY MANAGEMENT CALLABLES
// ============================================================
// These use runTransaction with FieldValue.increment() for atomic
// counter updates on swapParties (participantsCount, itemsCount).
// Client-side rules block direct writes to these counter fields.
// ============================================================

/**
 * Join a swap party securely -- atomic participant creation + counter increment.
 * Uses runTransaction to prevent race conditions on participantsCount.
 */
export const joinSwapPartySecure = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { partyId, userName, userImage } = request.data;

    if (!partyId || typeof partyId !== 'string') {
      throw new HttpsError('invalid-argument', 'partyId requis');
    }
    if (!userName || typeof userName !== 'string') {
      throw new HttpsError('invalid-argument', 'userName requis');
    }

    const userId = request.auth.uid;

    try {
      const participantId = await db.runTransaction(async (tx) => {
        // Check the party exists and is joinable
        const partyRef = db.collection('swapParties').doc(partyId);
        const partySnap = await tx.get(partyRef);
        if (!partySnap.exists) {
          throw new HttpsError('not-found', 'Swap party introuvable');
        }
        const partyData = partySnap.data()!;
        if (!['upcoming', 'active'].includes(partyData.status)) {
          throw new HttpsError('failed-precondition', 'Cette swap party n\'est plus ouverte');
        }

        // Check maxParticipants limit
        if (
          partyData.maxParticipants != null &&
          typeof partyData.maxParticipants === 'number' &&
          (partyData.participantsCount || 0) >= partyData.maxParticipants
        ) {
          throw new HttpsError(
            'resource-exhausted',
            'Cette Swap Zone a atteint le nombre maximum de participants'
          );
        }

        // Check if already joined
        const existingQuery = await db
          .collection('swapPartyParticipants')
          .where('partyId', '==', partyId)
          .where('userId', '==', userId)
          .get();

        if (!existingQuery.empty) {
          // Already joined -- return existing ID without modifying counters
          return existingQuery.docs[0].id;
        }

        // Create participant document
        const participantRef = db.collection('swapPartyParticipants').doc();
        const participantData: Record<string, any> = {
          partyId,
          userId,
          userName,
          itemIds: [],
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (userImage && typeof userImage === 'string') {
          participantData.userImage = userImage;
        }
        tx.set(participantRef, participantData);

        // Atomically increment participantsCount
        tx.update(partyRef, {
          participantsCount: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return participantRef.id;
      });

      logger.info('User joined swap party', { partyId, userId });
      return { participantId, success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error joining swap party', { error: errMsg, partyId, userId });
      throw new HttpsError('internal', 'Erreur lors de l\'inscription: ' + errMsg);
    }
  }
);

/**
 * Leave a swap party securely -- atomic participant removal + item cleanup + counter decrements.
 * Uses runTransaction to prevent race conditions on counters.
 */
export const leaveSwapPartySecure = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { partyId } = request.data;

    if (!partyId || typeof partyId !== 'string') {
      throw new HttpsError('invalid-argument', 'partyId requis');
    }

    const userId = request.auth.uid;

    try {
      // Pre-check: reject if user has active swaps in this party
      // (query outside transaction because it uses 'in' operator which is read-only check)
      const activeSwapsInitiator = await db
        .collection('swaps')
        .where('partyId', '==', partyId)
        .where('initiatorId', '==', userId)
        .where('status', 'in', ['proposed', 'accepted', 'photos_pending', 'shipping'])
        .get();

      const activeSwapsReceiver = await db
        .collection('swaps')
        .where('partyId', '==', partyId)
        .where('receiverId', '==', userId)
        .where('status', 'in', ['proposed', 'accepted', 'photos_pending', 'shipping'])
        .get();

      if (!activeSwapsInitiator.empty || !activeSwapsReceiver.empty) {
        throw new HttpsError(
          'failed-precondition',
          'Vous avez des échanges en cours dans cette Swap Zone. Terminez-les avant de quitter.'
        );
      }

      await db.runTransaction(async (tx) => {
        // Check the party exists
        const partyRef = db.collection('swapParties').doc(partyId);
        const partySnap = await tx.get(partyRef);
        if (!partySnap.exists) {
          throw new HttpsError('not-found', 'Swap party introuvable');
        }

        // Find the participant doc
        const participantQuery = await db
          .collection('swapPartyParticipants')
          .where('partyId', '==', partyId)
          .where('userId', '==', userId)
          .get();

        if (participantQuery.empty) {
          // Not a participant -- no-op
          return;
        }

        // Find all items this user has in the party
        const itemsQuery = await db
          .collection('swapPartyItems')
          .where('partyId', '==', partyId)
          .where('sellerId', '==', userId)
          .get();

        const itemCount = itemsQuery.size;

        // Delete all user's items from the party
        for (const itemDoc of itemsQuery.docs) {
          tx.delete(itemDoc.ref);
        }

        // Delete the participant doc
        tx.delete(participantQuery.docs[0].ref);

        // Atomically decrement counters
        const updates: Record<string, any> = {
          participantsCount: admin.firestore.FieldValue.increment(-1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (itemCount > 0) {
          updates.itemsCount = admin.firestore.FieldValue.increment(-itemCount);
        }
        tx.update(partyRef, updates);
      });

      logger.info('User left swap party', { partyId, userId });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error leaving swap party', { error: errMsg, partyId, userId });
      throw new HttpsError('internal', 'Erreur lors du depart: ' + errMsg);
    }
  }
);

/**
 * Add an item to a swap party securely -- atomic item creation + counter increment.
 * Uses runTransaction to prevent race conditions on itemsCount.
 */
export const addItemToPartySecure = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { partyId, articleId, title, price, imageUrl, userName, userImage } = request.data;

    if (!partyId || typeof partyId !== 'string') {
      throw new HttpsError('invalid-argument', 'partyId requis');
    }
    if (!articleId || typeof articleId !== 'string') {
      throw new HttpsError('invalid-argument', 'articleId requis');
    }
    if (!title || typeof title !== 'string') {
      throw new HttpsError('invalid-argument', 'title requis');
    }
    if (typeof price !== 'number' || price < 0) {
      throw new HttpsError('invalid-argument', 'price invalide');
    }

    const userId = request.auth.uid;

    try {
      const itemId = await db.runTransaction(async (tx) => {
        // Check the party exists and is active/upcoming
        const partyRef = db.collection('swapParties').doc(partyId);
        const partySnap = await tx.get(partyRef);
        if (!partySnap.exists) {
          throw new HttpsError('not-found', 'Swap party introuvable');
        }
        const partyData = partySnap.data()!;
        if (!['upcoming', 'active'].includes(partyData.status)) {
          throw new HttpsError('failed-precondition', 'Cette swap party n\'est plus ouverte');
        }

        // Verify user is a participant
        const participantQuery = await db
          .collection('swapPartyParticipants')
          .where('partyId', '==', partyId)
          .where('userId', '==', userId)
          .get();

        if (participantQuery.empty) {
          throw new HttpsError('failed-precondition', 'Vous devez rejoindre la party avant d\'ajouter un article');
        }

        // Verify the article exists and belongs to the user
        const articleRef = db.collection('articles').doc(articleId);
        const articleSnap = await tx.get(articleRef);
        if (!articleSnap.exists) {
          throw new HttpsError('not-found', 'Article introuvable');
        }
        const articleData = articleSnap.data()!;
        if (articleData.sellerId !== userId) {
          throw new HttpsError('permission-denied', 'Cet article ne vous appartient pas');
        }

        // Validate article is still available (not sold, not deactivated)
        if (articleData.isSold === true || articleData.isActive === false) {
          throw new HttpsError('failed-precondition', 'Cet article n\'est plus disponible.');
        }

        // Check for duplicate: article already in this party (inside tx to prevent race conditions)
        const duplicateQuery = await db
          .collection('swapPartyItems')
          .where('partyId', '==', partyId)
          .where('articleId', '==', articleId)
          .get();

        if (!duplicateQuery.empty) {
          throw new HttpsError('already-exists', 'Cet article est déjà dans cette Swap Zone.');
        }

        // Create the party item
        const itemRef = db.collection('swapPartyItems').doc();
        const itemData: Record<string, any> = {
          partyId,
          articleId,
          sellerId: userId,
          sellerName: userName || articleData.sellerName || '',
          title,
          price,
          isSwapped: false,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (userImage && typeof userImage === 'string') {
          itemData.sellerImage = userImage;
        }
        if (imageUrl && typeof imageUrl === 'string') {
          itemData.imageUrl = imageUrl;
        }
        tx.set(itemRef, itemData);

        // Update participant's itemIds
        const participantDoc = participantQuery.docs[0];
        const currentItems = participantDoc.data().itemIds || [];
        tx.update(participantDoc.ref, {
          itemIds: [...currentItems, articleId],
        });

        // Atomically increment itemsCount on the party
        tx.update(partyRef, {
          itemsCount: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return itemRef.id;
      });

      logger.info('Item added to swap party', { partyId, articleId, userId });
      return { itemId, success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error adding item to party', { error: errMsg, partyId, articleId, userId });
      throw new HttpsError('internal', 'Erreur lors de l\'ajout: ' + errMsg);
    }
  }
);

/**
 * Remove an item from a swap party securely -- atomic item deletion + counter decrement.
 * Uses runTransaction to prevent race conditions on itemsCount.
 */
export const removeItemFromPartySecure = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { partyId, articleId } = request.data;

    if (!partyId || typeof partyId !== 'string') {
      throw new HttpsError('invalid-argument', 'partyId requis');
    }
    if (!articleId || typeof articleId !== 'string') {
      throw new HttpsError('invalid-argument', 'articleId requis');
    }

    const userId = request.auth.uid;

    try {
      await db.runTransaction(async (tx) => {
        // Check the party exists
        const partyRef = db.collection('swapParties').doc(partyId);
        const partySnap = await tx.get(partyRef);
        if (!partySnap.exists) {
          throw new HttpsError('not-found', 'Swap party introuvable');
        }

        // Find the item
        const itemQuery = await db
          .collection('swapPartyItems')
          .where('partyId', '==', partyId)
          .where('articleId', '==', articleId)
          .where('sellerId', '==', userId)
          .get();

        if (itemQuery.empty) {
          // Item not found -- no-op
          return;
        }

        // Delete the item
        tx.delete(itemQuery.docs[0].ref);

        // Update participant's itemIds
        const participantQuery = await db
          .collection('swapPartyParticipants')
          .where('partyId', '==', partyId)
          .where('userId', '==', userId)
          .get();

        if (!participantQuery.empty) {
          const participantDoc = participantQuery.docs[0];
          const currentItems = participantDoc.data().itemIds || [];
          tx.update(participantDoc.ref, {
            itemIds: currentItems.filter((id: string) => id !== articleId),
          });
        }

        // Atomically decrement itemsCount on the party
        tx.update(partyRef, {
          itemsCount: admin.firestore.FieldValue.increment(-1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      logger.info('Item removed from swap party', { partyId, articleId, userId });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error removing item from party', { error: errMsg, partyId, articleId, userId });
      throw new HttpsError('internal', 'Erreur lors du retrait: ' + errMsg);
    }
  }
);

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

// ============================================================
// POST-ACCEPTANCE SWAP LIFECYCLE CALLABLES
// ============================================================
// These operations MUST run server-side because firestore.rules
// only allows ['status','updatedAt','declinedBy','declinedAt','completedAt']
// for client writes on swaps. All other field writes (exchangeMode,
// photos, shipping, reception, rating) go through Admin SDK here.
// ============================================================

/**
 * Helper: release all party items (isPending = false) for both sides of a swap.
 * Called after decline/cancel when the swap has a partyId.
 */
async function releasePartyItems(swap: FirebaseFirestore.DocumentData): Promise<void> {
  if (!swap.partyId) return;

  const partyItemsRef = db.collection('swapPartyItems');

  const initiatorItems = getSwapItems(swap, 'initiator');
  for (const item of initiatorItems) {
    const q = await partyItemsRef
      .where('partyId', '==', swap.partyId)
      .where('articleId', '==', item.articleId)
      .where('sellerId', '==', swap.initiatorId)
      .get();
    for (const d of q.docs) {
      await d.ref.update({ isPending: false });
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
      await d.ref.update({ isPending: false });
    }
  }
}

/**
 * Decline a swap — either participant can decline while status is 'proposed'.
 * Uses runTransaction to guard the status transition.
 * Releases party items if the swap belongs to a party.
 */
export const declineSwap = onCall(
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
      const swapData = await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        // Auth: must be a participant
        if (swap.initiatorId !== request.auth!.uid && swap.receiverId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        // Status must be 'proposed'
        if (swap.status !== 'proposed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de décliner un échange en statut "${swap.status}"`
          );
        }

        tx.update(swapRef, {
          status: 'declined',
          declinedBy: request.auth!.uid,
          declinedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return swap;
      });

      // Release party items AFTER transaction (non-critical side-effect)
      await releasePartyItems(swapData);

      logger.info('Swap declined', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error declining swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors du refus: ' + errMsg);
    }
  }
);

/**
 * Cancel a swap — ONLY the initiator can cancel while status is 'proposed'.
 * Uses runTransaction to guard the status transition.
 * Releases party items if the swap belongs to a party.
 */
export const cancelSwap = onCall(
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
      const swapData = await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        // Auth: ONLY the initiator can cancel
        if (swap.initiatorId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Seul l\'initiateur peut annuler cet échange');
        }

        // Status must be 'proposed'
        if (swap.status !== 'proposed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'annuler un échange en statut "${swap.status}"`
          );
        }

        tx.update(swapRef, {
          status: 'cancelled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return swap;
      });

      // Release party items AFTER transaction (non-critical side-effect)
      await releasePartyItems(swapData);

      logger.info('Swap cancelled', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error cancelling swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'annulation: ' + errMsg);
    }
  }
);

/**
 * Set exchange mode for an accepted swap.
 * Transitions status from 'accepted' to 'photos_pending'.
 * Uses runTransaction to guard the status transition.
 */
export const setSwapExchangeMode = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, exchangeMode } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (!exchangeMode || typeof exchangeMode !== 'string') {
      throw new HttpsError('invalid-argument', 'exchangeMode requis');
    }

    try {
      await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        // Auth: must be a participant
        if (swap.initiatorId !== request.auth!.uid && swap.receiverId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        // Status must be 'accepted'
        if (swap.status !== 'accepted') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de définir le mode d'échange en statut "${swap.status}"`
          );
        }

        tx.update(swapRef, {
          exchangeMode,
          status: 'photos_pending',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      logger.info('Swap exchange mode set', { swapId, exchangeMode, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error setting swap exchange mode', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la définition du mode: ' + errMsg);
    }
  }
);

/**
 * Upload photo proof for a swap.
 * Writes initiatorPhotos or receiverPhotos depending on the caller.
 * If BOTH sides have uploaded, transitions to status 'shipping'.
 * Uses runTransaction to safely check the "both uploaded" condition.
 */
export const uploadSwapPhotos = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, photoUrls } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
      throw new HttpsError('invalid-argument', 'photoUrls requis (tableau non vide)');
    }

    try {
      await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        // Auth: must be a participant
        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        // Status must be 'photos_pending'
        if (swap.status !== 'photos_pending') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'uploader des photos en statut "${swap.status}"`
          );
        }

        const photoProof = {
          userId: uid,
          photos: photoUrls,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
          isValidated: false,
        };

        const updateData: Record<string, any> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const isInitiator = swap.initiatorId === uid;

        if (isInitiator) {
          updateData.initiatorPhotos = photoProof;
        } else {
          updateData.receiverPhotos = photoProof;
        }

        // Check if BOTH sides will have photos after this write
        const otherSideHasPhotos = isInitiator ? !!swap.receiverPhotos : !!swap.initiatorPhotos;
        if (otherSideHasPhotos) {
          updateData.status = 'shipping';
        }

        tx.update(swapRef, updateData);
      });

      logger.info('Swap photos uploaded', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error uploading swap photos', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'upload des photos: ' + errMsg);
    }
  }
);

/**
 * Confirm shipping for a swap — participant confirms they sent their package.
 * Writes initiatorShippedAt or receiverShippedAt.
 * Uses runTransaction for consistency.
 */
export const confirmSwapShipping = onCall(
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
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        // Auth: must be a participant
        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        // Status guard: shipping confirmation only valid during shipping or photos_pending phase
        if (!['shipping', 'photos_pending'].includes(swap.status)) {
          throw new HttpsError('failed-precondition', 'Le swap n\'est pas en cours d\'expédition.');
        }

        const updateData: Record<string, any> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (swap.initiatorId === uid) {
          updateData.initiatorShippedAt = admin.firestore.FieldValue.serverTimestamp();
        } else {
          updateData.receiverShippedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        tx.update(swapRef, updateData);
      });

      logger.info('Swap shipping confirmed', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error confirming swap shipping', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la confirmation d\'envoi: ' + errMsg);
    }
  }
);

/**
 * Confirm reception for a swap — participant confirms they received the other's package.
 * Writes initiatorReceivedAt or receiverReceivedAt.
 * If BOTH sides have received, transitions to 'completed' + sets completedAt.
 * Also marks party items as isSwapped and increments party swapsCount if applicable.
 * Uses runTransaction for the status transition check.
 */
export const confirmSwapReception = onCall(
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
      const swapData = await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        // Auth: must be a participant
        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        // Status guard: reception only valid during shipping
        if (swap.status !== 'shipping') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de confirmer la réception en statut "${swap.status}"`
          );
        }

        const updateData: Record<string, any> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const isInitiator = swap.initiatorId === uid;

        if (isInitiator) {
          updateData.initiatorReceivedAt = admin.firestore.FieldValue.serverTimestamp();
        } else {
          updateData.receiverReceivedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        // Check if BOTH sides will have received after this write
        const otherSideReceived = isInitiator ? !!swap.receiverReceivedAt : !!swap.initiatorReceivedAt;
        if (otherSideReceived) {
          updateData.status = 'completed';
          updateData.completedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        tx.update(swapRef, updateData);

        return {
          bothReceived: otherSideReceived,
          partyId: swap.partyId as string | undefined,
          initiatorId: swap.initiatorId as string,
          receiverId: swap.receiverId as string,
          swap,
        };
      });

      // If completed, mark ALL articles on both sides as sold + inactive
      if (swapData.bothReceived) {
        const allArticleIds: string[] = [];
        const initiatorArticles = getSwapItems(swapData.swap, 'initiator');
        const receiverArticles = getSwapItems(swapData.swap, 'receiver');

        for (const item of [...initiatorArticles, ...receiverArticles]) {
          if (item.articleId) allArticleIds.push(item.articleId);
        }

        for (const articleId of allArticleIds) {
          try {
            await db.collection('articles').doc(articleId).update({
              isSold: true,
              isActive: false,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } catch (err) {
            // Non-critical: article may have been deleted since swap was proposed
            logger.warn('Failed to mark article as sold after swap completion', {
              articleId,
              swapId,
              error: err instanceof Error ? err.message : 'Unknown',
            });
          }
        }
      }

      // If completed and has a partyId, mark items as swapped + increment count
      if (swapData.bothReceived && swapData.partyId) {
        const partyItemsRef = db.collection('swapPartyItems');

        // Mark initiator items as swapped
        const initiatorItems = getSwapItems(swapData.swap, 'initiator');
        for (const item of initiatorItems) {
          const q = await partyItemsRef
            .where('partyId', '==', swapData.partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', swapData.initiatorId)
            .get();
          for (const d of q.docs) {
            await d.ref.update({ isSwapped: true });
          }
        }

        // Mark receiver items as swapped
        const receiverItems = getSwapItems(swapData.swap, 'receiver');
        for (const item of receiverItems) {
          const q = await partyItemsRef
            .where('partyId', '==', swapData.partyId)
            .where('articleId', '==', item.articleId)
            .where('sellerId', '==', swapData.receiverId)
            .get();
          for (const d of q.docs) {
            await d.ref.update({ isSwapped: true });
          }
        }

        // Atomically increment swapsCount on the party (no read-then-write race condition)
        const partyRef = db.collection('swapParties').doc(swapData.partyId);
        await partyRef.update({
          swapsCount: admin.firestore.FieldValue.increment(1),
        });
      }

      logger.info('Swap reception confirmed', {
        swapId,
        userId: request.auth.uid,
        completed: swapData.bothReceived,
      });
      return { success: true, completed: swapData.bothReceived };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error confirming swap reception', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la confirmation de réception: ' + errMsg);
    }
  }
);

/**
 * Rate a completed swap — participant rates the exchange.
 * Writes initiatorRating or receiverRating.
 * Uses runTransaction to verify status == 'completed'.
 */
export const rateSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, score, comment } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (typeof score !== 'number' || score < 1 || score > 5) {
      throw new HttpsError('invalid-argument', 'score requis (1-5)');
    }

    try {
      // We need swap data outside the transaction for the avis creation
      let targetUserId = '';
      let reviewerName = '';
      let reviewerImage: string | null = null;
      let articleTitle: string | null = null;
      const trimmedComment = (comment != null && typeof comment === 'string' && comment.trim().length > 0)
        ? comment.trim()
        : null;

      await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        // Auth: must be a participant
        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        // Status must be 'completed'
        if (swap.status !== 'completed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de noter un échange en statut "${swap.status}"`
          );
        }

        const isInitiator = swap.initiatorId === uid;

        // Determine the target user (the OTHER participant)
        targetUserId = isInitiator ? swap.receiverId : swap.initiatorId;
        reviewerName = isInitiator ? swap.initiatorName : swap.receiverName;
        reviewerImage = isInitiator ? (swap.initiatorImage || null) : (swap.receiverImage || null);

        // Get article title from the first item of the swap (for the avis record)
        const items = getSwapItems(swap, isInitiator ? 'initiator' : 'receiver');
        articleTitle = items.length > 0 ? (items[0].title || null) : null;

        // Build rating object, excluding comment if not provided
        const rating: Record<string, any> = { score };
        if (trimmedComment) {
          rating.comment = trimmedComment;
        }

        const updateData: Record<string, any> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (isInitiator) {
          updateData.initiatorRating = rating;
        } else {
          updateData.receiverRating = rating;
        }

        tx.update(swapRef, updateData);

        // Create a review document in avis/ (deterministic ID prevents duplicates)
        const reviewDocId = `${uid}_swap_${swapId}`;
        const reviewRef = db.collection('avis').doc(reviewDocId);

        // Check if review already exists (idempotence)
        const existingReview = await tx.get(reviewRef);
        if (!existingReview.exists) {
          tx.set(reviewRef, {
            id: reviewDocId,
            reviewerId: uid,
            reviewerName: reviewerName || 'Utilisateur',
            reviewerImage: reviewerImage,
            // TODO: rename vendeurId to targetUserId in next schema migration
            vendeurId: targetUserId,
            transactionId: swapId,
            transactionType: 'swap',
            articleId: null,
            articleTitle: articleTitle,
            note: score,
            text: trimmedComment || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      });

      // Update target user's aggregate rating (outside transaction, non-critical)
      if (targetUserId) {
        await updateUserRating(targetUserId);

        // Send push notification for the review
        try {
          await sendPushNotification(
            targetUserId,
            'Nouvel avis reçu',
            `${reviewerName || 'Un utilisateur'} vous a laissé un avis ${score}/5`,
            { reviewId: `${request.auth.uid}_swap_${swapId}`, reviewerId: request.auth.uid },
            'review_received',
          );
        } catch (notifError) {
          logger.warn('Failed to send swap review notification', { error: notifError });
        }
      }

      logger.info('Swap rated', { swapId, score, userId: request.auth.uid, targetUserId });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error rating swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la notation: ' + errMsg);
    }
  }
);

/**
 * Open a dispute on a swap — participant can dispute during shipping or after completion.
 * Transitions swap status to 'disputed'.
 * Uses runTransaction to guard the status transition.
 */
export const openSwapDispute = onCall(
  { region: 'northamerica-northeast1', invoker: 'private', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, reason } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'reason requis (texte non vide)');
    }

    const trimmedReason = reason.trim();

    try {
      await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        // Auth: must be a participant
        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'etes pas participant de cet echange');
        }

        // Status must be 'shipping' or 'completed'
        if (!['shipping', 'completed'].includes(swap.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'ouvrir un litige sur un echange en statut "${swap.status}"`
          );
        }

        tx.update(swapRef, {
          status: 'disputed',
          disputeReason: trimmedReason,
          disputeOpenedBy: uid,
          disputeOpenedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      logger.info('Swap dispute opened', { swapId, userId: request.auth.uid, reason: trimmedReason });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error opening swap dispute', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'ouverture du litige: ' + errMsg);
    }
  }
);
