/**
 * User account management callables
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * - deleteUserAccount: GDPR Art. 17 / Loi 25 (PIPEDA) exhaustive data cleanup
 *   Replaces the v1 auth.user().onDelete() trigger with a v2 callable
 *   that runs all cleanup server-side and deletes the Auth user via Admin SDK.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, auth, storage, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { recordPrivacyIncident } from './privacyIncidents';

// =============================================================================
// DELETE USER ACCOUNT — GDPR Art. 17 / Loi 25 exhaustive cleanup
// =============================================================================

export const deleteUserAccount = onCall(
  {
    region: 'northamerica-northeast1',
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: ['STRIPE_SECRET_KEY'],
  },
  async (request) => {
    // 1. Auth check — only the authenticated user can delete their own account
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const uid = request.auth.uid;
    const DELETED_NAME = 'Utilisateur supprime';

    logger.info('[deleteUserAccount] Starting cleanup', { uid });

    // 0. Pre-check: reject if the wallet has a remaining balance (W3 — Loi 25 compliance)
    const walletDoc = await db.collection('wallets').doc(uid).get();
    if (walletDoc.exists) {
      const walletData = walletDoc.data();
      const walletBalance = walletData?.balance ?? 0;
      const walletPending = walletData?.pendingBalance ?? 0;
      if (walletBalance > 0 || walletPending > 0) {
        // Wallet amounts are in cents — convert to dollars for the message
        const walletTotal = ((walletBalance + walletPending) / 100).toFixed(2);
        throw new HttpsError(
          'failed-precondition',
          `Votre porte-monnaie contient ${walletTotal} $. Veuillez effectuer un retrait avant de supprimer votre compte.`,
        );
      }
    }

    const bulkWriter = db.bulkWriter();
    const articleIds: string[] = [];

    // 0b. Decrement sellerLikesCount for all sellers this user liked
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      // User doc already deleted — still delete Auth user if it exists
      try {
        await auth.deleteUser(uid);
        logger.info('[deleteUserAccount] Auth user deleted (no Firestore doc)', { uid });
      } catch (e: any) {
        if (e.code !== 'auth/user-not-found') {
          logger.error('[deleteUserAccount] Failed to delete Auth user', { uid, error: e });
          throw new HttpsError('internal', 'Erreur lors de la suppression du compte');
        }
      }
      return { success: true };
    }

    const userData = userDoc.data();
    if (userData?.likedSellers && Array.isArray(userData.likedSellers) && userData.likedSellers.length > 0) {
      const likeBatch = db.batch();
      for (const sellerId of userData.likedSellers) {
        const sellerRef = db.collection('users').doc(sellerId);
        likeBatch.update(sellerRef, { sellerLikesCount: FieldValue.increment(-1) });
      }
      await likeBatch.commit();
      logger.info('[deleteUserAccount] Decremented sellerLikesCount', {
        uid,
        sellersCount: userData.likedSellers.length,
      });
    }

    // 1. Delete /users/{uid} sub-collections then the doc itself
    for (const subCol of ['savedSearches', 'searchHistory', 'consents']) {
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

    // 8a. Anonymise reviews -- reviews written BY the user
    const reviewsByUser = await db.collection('avis').where('reviewerId', '==', uid).get();
    for (const d of reviewsByUser.docs) {
      bulkWriter.update(d.ref, {
        reviewerName: DELETED_NAME,
        reviewerImage: null,
      });
    }

    // 8b. Anonymise reviews -- reviews received BY the user (vendeurId == uid)
    const reviewsForUser = await db.collection('avis').where('vendeurId', '==', uid).get();
    for (const d of reviewsForUser.docs) {
      // Keep the review content but anonymise the target identity
      bulkWriter.update(d.ref, {
        vendeurId: `deleted_${uid.slice(0, 8)}`,
      });
    }

    // 9. Delete swaps
    const [swapsInit, swapsRecv] = await Promise.all([
      db.collection('swaps').where('initiatorId', '==', uid).get(),
      db.collection('swaps').where('receiverId', '==', uid).get(),
    ]);
    const deletedSwapIds = new Set<string>();
    for (const d of [...swapsInit.docs, ...swapsRecv.docs]) {
      if (!deletedSwapIds.has(d.id)) { bulkWriter.delete(d.ref); deletedSwapIds.add(d.id); }
    }

    // 10. Delete the user's Swap Zone items + decrement itemsCount per zone.
    // (No more swapPartyParticipants — the Swap Zone is open to all, no join.)
    const piSnap = await db.collection('swapPartyItems').where('sellerId', '==', uid).get();

    const partyDecrements: Record<string, { items: number }> = {};
    for (const d of piSnap.docs) {
      const partyId = d.data().partyId;
      if (partyId) {
        if (!partyDecrements[partyId]) partyDecrements[partyId] = { items: 0 };
        partyDecrements[partyId].items += 1;
      }
      bulkWriter.delete(d.ref);
    }

    // Decrement itemsCount on affected zones
    for (const [partyId, counts] of Object.entries(partyDecrements)) {
      if (counts.items > 0) {
        const partyRef = db.collection('swapParties').doc(partyId);
        bulkWriter.update(partyRef, {
          itemsCount: FieldValue.increment(-counts.items),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

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

    // 13. Delete seller_balances/{uid} (legacy cleanup — collection removed)
    const balRef = db.collection('seller_balances').doc(uid);
    const balSnap = await balRef.get();
    if (balSnap.exists) bulkWriter.delete(balRef);

    // 13b. Delete wallets/{uid} and its ledger subcollection (W3 — Loi 25 / RGPD)
    const walletRef = db.collection('wallets').doc(uid);
    const walletSnap = await walletRef.get();
    if (walletSnap.exists) {
      // Delete all ledger entries first (subcollection)
      const ledgerSnap = await walletRef.collection('ledger').get();
      for (const d of ledgerSnap.docs) bulkWriter.delete(d.ref);
      // Delete the wallet doc itself
      bulkWriter.delete(walletRef);
    }

    // 14. Delete withdrawal_requests
    const wdSnap = await db.collection('withdrawal_requests').where('userId', '==', uid).get();
    for (const d of wdSnap.docs) bulkWriter.delete(d.ref);

    // 15. Delete drafts
    const draftsSnap = await db.collection('drafts').where('userId', '==', uid).get();
    for (const d of draftsSnap.docs) bulkWriter.delete(d.ref);

    // Flush all Firestore writes
    await bulkWriter.close();
    logger.info('[deleteUserAccount] Firestore cleanup complete', {
      uid,
      articlesDeactivated: articleIds.length,
      searchIndexDeleted: articleIds.length,
      reviewsAnonymised: reviewsByUser.size,
      swapsDeleted: deletedSwapIds.size,
      transactionsAnonymised: anonTxIds.size,
      walletDeleted: walletSnap.exists,
    });

    // 16. Storage cleanup
    try {
      const bucket = storage.bucket();
      await bucket.deleteFiles({ prefix: `avatars/${uid}` });
      await bucket.deleteFiles({ prefix: `users/${uid}/` });
      for (const articleId of articleIds) {
        try { await bucket.deleteFiles({ prefix: `articles/${articleId}/` }); } catch { /* ignore individual article cleanup errors */ }
      }
    } catch (e) {
      logger.error('[deleteUserAccount] Storage cleanup error', { uid, error: e });
    }

    // 16b. Delete the Stripe Connect Custom account (white-label — the platform
    //      owns/controls the account, so accounts.del is the correct teardown for
    //      a Custom connected account). Best-effort: never blocks the rest of the
    //      deletion. On failure we log AND record a privacy_incidents entry
    //      (type: deletion_failed) so the dangling Stripe account is tracked for
    //      manual reconciliation (Loi 25 / RGPD accountability).
    const stripeAccountId = userData?.stripeAccountId;
    if (typeof stripeAccountId === 'string' && stripeAccountId.length > 0) {
      try {
        const stripe = getStripe();
        if (!stripe) {
          throw new Error('Stripe client unavailable (missing STRIPE_SECRET_KEY)');
        }
        await stripe.accounts.del(stripeAccountId);
        logger.info('[deleteUserAccount] Stripe Connect account deleted', {
          uid,
          stripeAccountId,
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        logger.error('[deleteUserAccount] Failed to delete Stripe Connect account', {
          uid,
          stripeAccountId,
          error: message,
        });
        // Record an incident so the orphaned Stripe account can be reconciled manually.
        await recordPrivacyIncident({
          type: 'deletion_failed',
          severity: 'high',
          description: `Échec de la suppression du compte Stripe Connect lors de la suppression du compte utilisateur. Compte Stripe orphelin à supprimer manuellement. Erreur: ${message}`,
          affectedUserIds: [uid],
          affectedDataFields: ['stripeAccountId'],
          measures: 'Suppression manuelle du compte Stripe Connect requise.',
          notifiedCAI: false,
          status: 'open',
        });
        // Don't throw — the rest of the user data is already cleaned up.
      }
    }

    // 17. Delete Firebase Auth user (last step — after all data is cleaned up)
    try {
      await auth.deleteUser(uid);
      logger.info('[deleteUserAccount] Auth user deleted', { uid });
    } catch (e: any) {
      if (e.code !== 'auth/user-not-found') {
        logger.error('[deleteUserAccount] Failed to delete Auth user', { uid, error: e });
        // Don't throw — Firestore cleanup is done, this is best-effort
      }
    }

    logger.info('[deleteUserAccount] Full cleanup done', { uid });
    return { success: true };
  }
);
