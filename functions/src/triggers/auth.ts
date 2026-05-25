/**
 * Firebase Auth triggers
 *
 * Auth lifecycle triggers (onCreate / onDelete) remain on the v1 API
 * because Firebase Functions v2 only exposes blocking auth triggers
 * (beforeUserCreated / beforeUserSignedIn) — not post-event triggers.
 * This is the official Firebase recommendation.
 *
 * - onUserCreated: Creates a minimal user document in Firestore
 * - onUserDeleted: GDPR Art. 17 — exhaustive data cleanup
 */
import * as functions from 'firebase-functions/v1';
import { db, FieldValue, storage } from '../config/firebase';

// =============================================================================
// ON USER CREATED — Ensure Firestore user doc exists
// =============================================================================

export const onUserCreated = functions.auth
  .user()
  .onCreate(async (user: functions.auth.UserRecord) => {
    const userRef = db.collection('users').doc(user.uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      // Detect auth provider from providerData
      const providerData = user.providerData;
      let authProvider = 'password';
      if (providerData?.some(p => p.providerId === 'google.com')) authProvider = 'google';
      else if (providerData?.some(p => p.providerId === 'apple.com')) authProvider = 'apple';

      await userRef.set({
        id: user.uid,
        email: user.email || '',
        displayName: user.displayName || `user${user.uid.slice(-6)}`,
        authProvider,
        createdAt: FieldValue.serverTimestamp(),
        isActive: true,
      });
      functions.logger.info('[onUserCreated] Created user doc', { uid: user.uid, authProvider });
    }
  });

// =============================================================================
// ON USER DELETED — GDPR Art. 17 exhaustive cleanup
// =============================================================================

export const onUserDeleted = functions.auth
  .user()
  .onDelete(async (user: functions.auth.UserRecord) => {
    const uid = user.uid;
    const DELETED_NAME = 'Utilisateur supprimé';
    functions.logger.info('[onUserDeleted] Starting cleanup', { uid });

    const bulkWriter = db.bulkWriter();
    const articleIds: string[] = [];

    // 0. Decrement sellerLikesCount for all sellers this user liked
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    if (userData?.likedSellers && Array.isArray(userData.likedSellers) && userData.likedSellers.length > 0) {
      const likeBatch = db.batch();
      for (const sellerId of userData.likedSellers) {
        const sellerRef = db.collection('users').doc(sellerId);
        likeBatch.update(sellerRef, { sellerLikesCount: FieldValue.increment(-1) });
      }
      await likeBatch.commit();
      functions.logger.info('[onUserDeleted] Decremented sellerLikesCount', {
        uid,
        sellersCount: userData.likedSellers.length,
      });
    }

    // 1. Delete /users/{uid} sub-collections then the doc itself
    for (const subCol of ['savedSearches', 'searchHistory']) {
      const subSnap = await db.collection('users').doc(uid).collection(subCol).get();
      for (const d of subSnap.docs) bulkWriter.delete(d.ref);
    }
    bulkWriter.delete(db.collection('users').doc(uid));

    // 2. Soft-delete articles (sellerId == uid)
    const articlesSnap = await db.collection('articles').where('sellerId', '==', uid).get();
    for (const d of articlesSnap.docs) {
      articleIds.push(d.id);
      bulkWriter.update(d.ref, {
        isActive: false,
        isSold: false,
        deletedAt: FieldValue.serverTimestamp(),
        sellerName: DELETED_NAME,
        sellerImage: null,
        sellerId: `deleted_${uid.slice(0, 8)}`,
      });
    }

    // 3. Cleanup search_index entries for the user's articles
    for (const articleId of articleIds) {
      const siRef = db.collection('search_index').doc(articleId);
      const siSnap = await siRef.get();
      if (siSnap.exists) bulkWriter.delete(siRef);
    }

    // 4. Deactivate corresponding embeddings
    for (const articleId of articleIds) {
      const embRef = db.collection('embeddings').doc(articleId);
      const embSnap = await embRef.get();
      if (embSnap.exists) bulkWriter.update(embRef, { isActive: false });
    }

    // 5. Delete /favorites/{uid}
    const favRef = db.collection('favorites').doc(uid);
    const favSnap = await favRef.get();
    if (favSnap.exists) bulkWriter.delete(favRef);

    // 6. Delete notifications
    const notifsSnap = await db.collection('notifications').where('userId', '==', uid).get();
    for (const d of notifsSnap.docs) bulkWriter.delete(d.ref);

    // 7. Anonymise chats
    const chatsSnap = await db.collection('chats').where('participants', 'array-contains', uid).get();
    for (const d of chatsSnap.docs) {
      const info = d.data().participantsInfo;
      if (Array.isArray(info)) {
        const updated = info.map((p: any) =>
          p.userId === uid ? { ...p, userName: DELETED_NAME, userImage: null } : p
        );
        bulkWriter.update(d.ref, { participantsInfo: updated, updatedAt: FieldValue.serverTimestamp() });
      } else if (info && typeof info === 'object') {
        if (info[uid]) {
          info[uid] = { ...info[uid], userName: DELETED_NAME, profileImage: null };
        }
        bulkWriter.update(d.ref, { participantsInfo: info, updatedAt: FieldValue.serverTimestamp() });
      }
    }

    // 7b. Anonymise messages sent by the user (batch 500)
    let msgQuery = db.collection('messages').where('senderId', '==', uid).limit(500);
    let msgSnap = await msgQuery.get();
    while (!msgSnap.empty) {
      for (const d of msgSnap.docs) {
        bulkWriter.update(d.ref, {
          senderName: DELETED_NAME,
          senderImage: null,
        });
      }
      if (msgSnap.size < 500) break;
      msgQuery = db.collection('messages').where('senderId', '==', uid).startAfter(msgSnap.docs[msgSnap.docs.length - 1]).limit(500);
      msgSnap = await msgQuery.get();
    }

    // 8. Anonymise reviews — reviews written BY the user
    const reviewsByUser = await db.collection('avis').where('reviewerId', '==', uid).get();
    for (const d of reviewsByUser.docs) {
      bulkWriter.update(d.ref, {
        reviewerName: DELETED_NAME,
        reviewerImage: null,
      });
    }
    // Reviews received BY the user (vendeurId) — keep the review but anonymise the target
    // Note: we do NOT delete reviews. The vendeurId now points to a deleted user,
    // but the review content is preserved for platform integrity.

    // 9. Delete swaps
    const [swapsInit, swapsRecv] = await Promise.all([
      db.collection('swaps').where('initiatorId', '==', uid).get(),
      db.collection('swaps').where('receiverId', '==', uid).get(),
    ]);
    const deletedSwapIds = new Set<string>();
    for (const d of [...swapsInit.docs, ...swapsRecv.docs]) {
      if (!deletedSwapIds.has(d.id)) { bulkWriter.delete(d.ref); deletedSwapIds.add(d.id); }
    }

    // 10. Delete swapPartyParticipants
    const ppSnap = await db.collection('swapPartyParticipants').where('userId', '==', uid).get();
    for (const d of ppSnap.docs) bulkWriter.delete(d.ref);

    // 11. Delete swapPartyItems
    const piSnap = await db.collection('swapPartyItems').where('sellerId', '==', uid).get();
    for (const d of piSnap.docs) bulkWriter.delete(d.ref);

    // 12. Anonymise transactions
    const [txBuyer, txSeller] = await Promise.all([
      db.collection('transactions').where('buyerId', '==', uid).get(),
      db.collection('transactions').where('sellerId', '==', uid).get(),
    ]);
    const anonTxIds = new Set<string>();
    for (const d of txBuyer.docs) {
      if (!anonTxIds.has(d.id)) {
        bulkWriter.update(d.ref, { buyerName: DELETED_NAME, buyerEmail: '', updatedAt: FieldValue.serverTimestamp() });
        anonTxIds.add(d.id);
      }
    }
    for (const d of txSeller.docs) {
      bulkWriter.update(d.ref, { sellerName: DELETED_NAME, updatedAt: FieldValue.serverTimestamp() });
    }

    // 13. Delete seller_balances/{uid}
    const balRef = db.collection('seller_balances').doc(uid);
    const balSnap = await balRef.get();
    if (balSnap.exists) bulkWriter.delete(balRef);

    // 14. Delete withdrawal_requests
    const wdSnap = await db.collection('withdrawal_requests').where('userId', '==', uid).get();
    for (const d of wdSnap.docs) bulkWriter.delete(d.ref);

    // 15. Delete drafts
    const draftsSnap = await db.collection('drafts').where('userId', '==', uid).get();
    for (const d of draftsSnap.docs) bulkWriter.delete(d.ref);

    // Flush
    await bulkWriter.close();
    functions.logger.info('[onUserDeleted] Firestore cleanup complete', {
      uid,
      articlesDeactivated: articleIds.length,
      searchIndexDeleted: articleIds.length,
      reviewsAnonymised: reviewsByUser.size,
      swapsDeleted: deletedSwapIds.size,
      transactionsAnonymised: anonTxIds.size,
    });

    // 16. Storage cleanup
    try {
      const bucket = storage.bucket();
      await bucket.deleteFiles({ prefix: `avatars/${uid}` });
      await bucket.deleteFiles({ prefix: `users/${uid}/` });
      for (const articleId of articleIds) {
        try { await bucket.deleteFiles({ prefix: `articles/${articleId}/` }); } catch {}
      }
    } catch (e) {
      functions.logger.error('[onUserDeleted] Storage cleanup error', { uid, error: e });
    }

    functions.logger.info('[onUserDeleted] Full cleanup done', { uid });
  });
