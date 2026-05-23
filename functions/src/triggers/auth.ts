/**
 * Firebase Auth triggers
 * Firebase Functions v1 auth triggers (onCreate / onDelete)
 *
 * - onUserCreated: Creates a minimal user document in Firestore
 * - onUserDeleted: GDPR Art. 17 — exhaustive data cleanup
 */
import * as functions from 'firebase-functions';
import { db, FieldValue, storage } from '../config/firebase';

const REGION = 'northamerica-northeast1';

// =============================================================================
// ON USER CREATED — Ensure Firestore user doc exists
// =============================================================================

/**
 * When a user is created in Firebase Auth, create a minimal
 * Firestore document at /users/{uid} if it does not already exist.
 *
 * The client may have already created this document during the
 * sign-up flow — in that case we skip to avoid overwriting.
 */
export const onUserCreated = functions
  .region(REGION)
  .auth.user()
  .onCreate(async (user) => {
    const userRef = db.collection('users').doc(user.uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      await userRef.set({
        id: user.uid,
        email: user.email || '',
        displayName: user.displayName || `user${user.uid.slice(-6)}`,
        createdAt: FieldValue.serverTimestamp(),
        isActive: true,
      });
      functions.logger.info('[onUserCreated] Created user doc', { uid: user.uid });
    } else {
      functions.logger.info('[onUserCreated] User doc already exists, skipping', { uid: user.uid });
    }
  });

// =============================================================================
// ON USER DELETED — GDPR Art. 17 exhaustive cleanup
// =============================================================================

/**
 * When an account is deleted from Firebase Auth, clean up ALL
 * user data across Firestore collections and Storage.
 *
 * Uses bulkWriter instead of writeBatch to avoid the 500-op limit.
 *
 * Cleanup covers:
 *  1. /users/{uid} + sub-collections (savedSearches, searchHistory)
 *  2. /articles where sellerId == uid (soft-delete)
 *  3. /favorites/{uid}
 *  4. /notifications where userId == uid
 *  5. /chats where participants array-contains uid (anonymise)
 *  6. /swaps where initiatorId == uid OR receiverId == uid
 *  7. /swapPartyParticipants where userId == uid
 *  8. /swapPartyItems where sellerId == uid
 *  9. /transactions where buyerId or sellerId == uid (anonymise)
 * 10. /seller_balances/{uid}
 * 11. /withdrawal_requests where userId == uid
 * 12. Storage: avatars/{uid}, users/{uid}/, articles/{articleId}/
 */
export const onUserDeleted = functions
  .region(REGION)
  .auth.user()
  .onDelete(async (user) => {
    const uid = user.uid;
    functions.logger.info('[onUserDeleted] Starting cleanup', { uid });

    const bulkWriter = db.bulkWriter();
    // Collect article IDs for storage cleanup later
    const articleIds: string[] = [];

    // ---------------------------------------------------------------
    // 1. Delete /users/{uid} sub-collections then the doc itself
    // ---------------------------------------------------------------
    const subCollections = ['savedSearches', 'searchHistory'];
    for (const subCol of subCollections) {
      const subSnap = await db.collection('users').doc(uid).collection(subCol).get();
      for (const doc of subSnap.docs) {
        bulkWriter.delete(doc.ref);
      }
    }
    bulkWriter.delete(db.collection('users').doc(uid));

    // ---------------------------------------------------------------
    // 2. Soft-delete articles (sellerId == uid)
    // ---------------------------------------------------------------
    const articlesSnap = await db
      .collection('articles')
      .where('sellerId', '==', uid)
      .get();
    for (const doc of articlesSnap.docs) {
      articleIds.push(doc.id);
      bulkWriter.update(doc.ref, {
        isActive: false,
        isSold: false,
        deletedAt: FieldValue.serverTimestamp(),
        sellerName: 'Compte supprime',
        sellerId: `deleted_${uid.slice(0, 8)}`,
      });
    }

    // Also deactivate corresponding embeddings
    for (const articleId of articleIds) {
      const embeddingRef = db.collection('embeddings').doc(articleId);
      const embeddingSnap = await embeddingRef.get();
      if (embeddingSnap.exists) {
        bulkWriter.update(embeddingRef, { isActive: false });
      }
    }

    // ---------------------------------------------------------------
    // 3. Delete /favorites/{uid}
    // ---------------------------------------------------------------
    const favoritesRef = db.collection('favorites').doc(uid);
    const favoritesSnap = await favoritesRef.get();
    if (favoritesSnap.exists) {
      bulkWriter.delete(favoritesRef);
    }

    // ---------------------------------------------------------------
    // 4. Delete notifications where userId == uid
    // ---------------------------------------------------------------
    const notificationsSnap = await db
      .collection('notifications')
      .where('userId', '==', uid)
      .get();
    for (const doc of notificationsSnap.docs) {
      bulkWriter.delete(doc.ref);
    }

    // ---------------------------------------------------------------
    // 5. Anonymise chats (participants array-contains uid)
    // ---------------------------------------------------------------
    const chatsSnap = await db
      .collection('chats')
      .where('participants', 'array-contains', uid)
      .get();
    for (const doc of chatsSnap.docs) {
      const chatData = doc.data();
      const participantsInfo = chatData.participantsInfo || {};

      // Anonymise the deleted user's entry in participantsInfo
      if (participantsInfo[uid]) {
        participantsInfo[uid] = {
          ...participantsInfo[uid],
          userName: 'Compte supprime',
          profileImage: null,
        };
      }

      bulkWriter.update(doc.ref, {
        participantsInfo,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // ---------------------------------------------------------------
    // 6. Delete swaps (initiatorId or receiverId == uid)
    // ---------------------------------------------------------------
    const [swapsAsInitiator, swapsAsReceiver] = await Promise.all([
      db.collection('swaps').where('initiatorId', '==', uid).get(),
      db.collection('swaps').where('receiverId', '==', uid).get(),
    ]);
    const deletedSwapIds = new Set<string>();
    for (const doc of swapsAsInitiator.docs) {
      if (!deletedSwapIds.has(doc.id)) {
        bulkWriter.delete(doc.ref);
        deletedSwapIds.add(doc.id);
      }
    }
    for (const doc of swapsAsReceiver.docs) {
      if (!deletedSwapIds.has(doc.id)) {
        bulkWriter.delete(doc.ref);
        deletedSwapIds.add(doc.id);
      }
    }

    // ---------------------------------------------------------------
    // 7. Delete swapPartyParticipants (userId == uid)
    // ---------------------------------------------------------------
    const partyParticipantsSnap = await db
      .collection('swapPartyParticipants')
      .where('userId', '==', uid)
      .get();
    for (const doc of partyParticipantsSnap.docs) {
      bulkWriter.delete(doc.ref);
    }

    // ---------------------------------------------------------------
    // 8. Delete swapPartyItems (sellerId == uid)
    // ---------------------------------------------------------------
    const partyItemsSnap = await db
      .collection('swapPartyItems')
      .where('sellerId', '==', uid)
      .get();
    for (const doc of partyItemsSnap.docs) {
      bulkWriter.delete(doc.ref);
    }

    // ---------------------------------------------------------------
    // 9. Anonymise transactions (buyerId or sellerId == uid)
    // ---------------------------------------------------------------
    const [txAsBuyer, txAsSeller] = await Promise.all([
      db.collection('transactions').where('buyerId', '==', uid).get(),
      db.collection('transactions').where('sellerId', '==', uid).get(),
    ]);
    const anonymisedTxIds = new Set<string>();
    for (const doc of txAsBuyer.docs) {
      if (!anonymisedTxIds.has(doc.id)) {
        bulkWriter.update(doc.ref, {
          buyerName: 'Compte supprime',
          buyerEmail: '',
          updatedAt: FieldValue.serverTimestamp(),
        });
        anonymisedTxIds.add(doc.id);
      }
    }
    for (const doc of txAsSeller.docs) {
      if (!anonymisedTxIds.has(doc.id)) {
        bulkWriter.update(doc.ref, {
          sellerName: 'Compte supprime',
          updatedAt: FieldValue.serverTimestamp(),
        });
        anonymisedTxIds.add(doc.id);
      } else {
        // Already anonymised as buyer, also anonymise seller fields
        bulkWriter.update(doc.ref, {
          sellerName: 'Compte supprime',
        });
      }
    }

    // ---------------------------------------------------------------
    // 10. Delete seller_balances/{uid}
    // ---------------------------------------------------------------
    const balanceRef = db.collection('seller_balances').doc(uid);
    const balanceSnap = await balanceRef.get();
    if (balanceSnap.exists) {
      bulkWriter.delete(balanceRef);
    }

    // ---------------------------------------------------------------
    // 11. Delete withdrawal_requests (userId == uid)
    // ---------------------------------------------------------------
    const withdrawalsSnap = await db
      .collection('withdrawal_requests')
      .where('userId', '==', uid)
      .get();
    for (const doc of withdrawalsSnap.docs) {
      bulkWriter.delete(doc.ref);
    }

    // ---------------------------------------------------------------
    // Flush all Firestore writes
    // ---------------------------------------------------------------
    await bulkWriter.close();
    functions.logger.info('[onUserDeleted] Firestore cleanup complete', {
      uid,
      articlesDeactivated: articleIds.length,
      swapsDeleted: deletedSwapIds.size,
      transactionsAnonymised: anonymisedTxIds.size,
    });

    // ---------------------------------------------------------------
    // 12. Storage cleanup
    // ---------------------------------------------------------------
    try {
      const bucket = storage.bucket();

      // Delete avatar files
      await bucket.deleteFiles({ prefix: `avatars/${uid}` });

      // Delete user-scoped files
      await bucket.deleteFiles({ prefix: `users/${uid}/` });

      // Delete article images for this user's articles
      for (const articleId of articleIds) {
        try {
          await bucket.deleteFiles({ prefix: `articles/${articleId}/` });
        } catch (e) {
          functions.logger.warn('[onUserDeleted] Failed to delete article images', {
            articleId,
            error: e,
          });
        }
      }

      functions.logger.info('[onUserDeleted] Storage cleanup complete', { uid });
    } catch (e) {
      functions.logger.error('[onUserDeleted] Storage cleanup error', { uid, error: e });
    }

    functions.logger.info('[onUserDeleted] Full cleanup done', { uid });
  });
