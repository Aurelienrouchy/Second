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
      await userRef.set({
        id: user.uid,
        email: user.email || '',
        displayName: user.displayName || `user${user.uid.slice(-6)}`,
        createdAt: FieldValue.serverTimestamp(),
        isActive: true,
      });
      functions.logger.info('[onUserCreated] Created user doc', { uid: user.uid });
    }
  });

// =============================================================================
// ON USER DELETED — GDPR Art. 17 exhaustive cleanup
// =============================================================================

export const onUserDeleted = functions.auth
  .user()
  .onDelete(async (user: functions.auth.UserRecord) => {
    const uid = user.uid;
    functions.logger.info('[onUserDeleted] Starting cleanup', { uid });

    const bulkWriter = db.bulkWriter();
    const articleIds: string[] = [];

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
        sellerName: 'Compte supprime',
        sellerId: `deleted_${uid.slice(0, 8)}`,
      });
    }

    // Deactivate corresponding embeddings
    for (const articleId of articleIds) {
      const embRef = db.collection('embeddings').doc(articleId);
      const embSnap = await embRef.get();
      if (embSnap.exists) bulkWriter.update(embRef, { isActive: false });
    }

    // 3. Delete /favorites/{uid}
    const favRef = db.collection('favorites').doc(uid);
    const favSnap = await favRef.get();
    if (favSnap.exists) bulkWriter.delete(favRef);

    // 4. Delete notifications
    const notifsSnap = await db.collection('notifications').where('userId', '==', uid).get();
    for (const d of notifsSnap.docs) bulkWriter.delete(d.ref);

    // 5. Anonymise chats
    const chatsSnap = await db.collection('chats').where('participants', 'array-contains', uid).get();
    for (const d of chatsSnap.docs) {
      const info = d.data().participantsInfo || {};
      if (info[uid]) {
        info[uid] = { ...info[uid], userName: 'Compte supprime', profileImage: null };
      }
      bulkWriter.update(d.ref, { participantsInfo: info, updatedAt: FieldValue.serverTimestamp() });
    }

    // 6. Delete swaps
    const [swapsInit, swapsRecv] = await Promise.all([
      db.collection('swaps').where('initiatorId', '==', uid).get(),
      db.collection('swaps').where('receiverId', '==', uid).get(),
    ]);
    const deletedSwapIds = new Set<string>();
    for (const d of [...swapsInit.docs, ...swapsRecv.docs]) {
      if (!deletedSwapIds.has(d.id)) { bulkWriter.delete(d.ref); deletedSwapIds.add(d.id); }
    }

    // 7. Delete swapPartyParticipants
    const ppSnap = await db.collection('swapPartyParticipants').where('userId', '==', uid).get();
    for (const d of ppSnap.docs) bulkWriter.delete(d.ref);

    // 8. Delete swapPartyItems
    const piSnap = await db.collection('swapPartyItems').where('sellerId', '==', uid).get();
    for (const d of piSnap.docs) bulkWriter.delete(d.ref);

    // 9. Anonymise transactions
    const [txBuyer, txSeller] = await Promise.all([
      db.collection('transactions').where('buyerId', '==', uid).get(),
      db.collection('transactions').where('sellerId', '==', uid).get(),
    ]);
    const anonTxIds = new Set<string>();
    for (const d of txBuyer.docs) {
      if (!anonTxIds.has(d.id)) {
        bulkWriter.update(d.ref, { buyerName: 'Compte supprime', buyerEmail: '', updatedAt: FieldValue.serverTimestamp() });
        anonTxIds.add(d.id);
      }
    }
    for (const d of txSeller.docs) {
      bulkWriter.update(d.ref, { sellerName: 'Compte supprime', updatedAt: FieldValue.serverTimestamp() });
    }

    // 10. Delete seller_balances/{uid}
    const balRef = db.collection('seller_balances').doc(uid);
    const balSnap = await balRef.get();
    if (balSnap.exists) bulkWriter.delete(balRef);

    // 11. Delete withdrawal_requests
    const wdSnap = await db.collection('withdrawal_requests').where('userId', '==', uid).get();
    for (const d of wdSnap.docs) bulkWriter.delete(d.ref);

    // Flush
    await bulkWriter.close();
    functions.logger.info('[onUserDeleted] Firestore cleanup complete', {
      uid, articlesDeactivated: articleIds.length,
      swapsDeleted: deletedSwapIds.size, transactionsAnonymised: anonTxIds.size,
    });

    // 12. Storage cleanup
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
