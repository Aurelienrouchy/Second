"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteUserAccount = void 0;
/**
 * User account management callables
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * - deleteUserAccount: GDPR Art. 17 / Loi 25 (PIPEDA) exhaustive data cleanup
 *   Replaces the v1 auth.user().onDelete() trigger with a v2 callable
 *   that runs all cleanup server-side and deletes the Auth user via Admin SDK.
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
// =============================================================================
// DELETE USER ACCOUNT — GDPR Art. 17 / Loi 25 exhaustive cleanup
// =============================================================================
exports.deleteUserAccount = (0, https_1.onCall)({
    region: 'northamerica-northeast1',
    memory: '512MiB',
    timeoutSeconds: 120,
}, async (request) => {
    var _a, _b, _c, _d;
    // 1. Auth check — only the authenticated user can delete their own account
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = request.auth.uid;
    const DELETED_NAME = 'Utilisateur supprime';
    logger.info('[deleteUserAccount] Starting cleanup', { uid });
    // 0. Pre-check: reject if the seller has a remaining balance
    const balanceDoc = await firebase_1.db.collection('seller_balances').doc(uid).get();
    if (balanceDoc.exists) {
        const balData = balanceDoc.data();
        const available = (_a = balData === null || balData === void 0 ? void 0 : balData.availableBalance) !== null && _a !== void 0 ? _a : 0;
        const pending = (_b = balData === null || balData === void 0 ? void 0 : balData.pendingBalance) !== null && _b !== void 0 ? _b : 0;
        if (available > 0 || pending > 0) {
            const total = (available + pending).toFixed(2);
            throw new https_1.HttpsError('failed-precondition', `Vous avez un solde de ${total} $. Veuillez effectuer un retrait avant de supprimer votre compte.`);
        }
    }
    // 0a. Pre-check: reject if the wallet has a remaining balance (W3 — Loi 25 compliance)
    const walletDoc = await firebase_1.db.collection('wallets').doc(uid).get();
    if (walletDoc.exists) {
        const walletData = walletDoc.data();
        const walletBalance = (_c = walletData === null || walletData === void 0 ? void 0 : walletData.balance) !== null && _c !== void 0 ? _c : 0;
        const walletPending = (_d = walletData === null || walletData === void 0 ? void 0 : walletData.pendingBalance) !== null && _d !== void 0 ? _d : 0;
        if (walletBalance > 0 || walletPending > 0) {
            // Wallet amounts are in cents — convert to dollars for the message
            const walletTotal = ((walletBalance + walletPending) / 100).toFixed(2);
            throw new https_1.HttpsError('failed-precondition', `Votre porte-monnaie contient ${walletTotal} $. Veuillez effectuer un retrait avant de supprimer votre compte.`);
        }
    }
    const bulkWriter = firebase_1.db.bulkWriter();
    const articleIds = [];
    // 0b. Decrement sellerLikesCount for all sellers this user liked
    const userDoc = await firebase_1.db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
        // User doc already deleted — still delete Auth user if it exists
        try {
            await firebase_1.auth.deleteUser(uid);
            logger.info('[deleteUserAccount] Auth user deleted (no Firestore doc)', { uid });
        }
        catch (e) {
            if (e.code !== 'auth/user-not-found') {
                logger.error('[deleteUserAccount] Failed to delete Auth user', { uid, error: e });
                throw new https_1.HttpsError('internal', 'Erreur lors de la suppression du compte');
            }
        }
        return { success: true };
    }
    const userData = userDoc.data();
    if ((userData === null || userData === void 0 ? void 0 : userData.likedSellers) && Array.isArray(userData.likedSellers) && userData.likedSellers.length > 0) {
        const likeBatch = firebase_1.db.batch();
        for (const sellerId of userData.likedSellers) {
            const sellerRef = firebase_1.db.collection('users').doc(sellerId);
            likeBatch.update(sellerRef, { sellerLikesCount: firebase_1.FieldValue.increment(-1) });
        }
        await likeBatch.commit();
        logger.info('[deleteUserAccount] Decremented sellerLikesCount', {
            uid,
            sellersCount: userData.likedSellers.length,
        });
    }
    // 1. Delete /users/{uid} sub-collections then the doc itself
    for (const subCol of ['savedSearches', 'searchHistory']) {
        const subSnap = await firebase_1.db.collection('users').doc(uid).collection(subCol).get();
        for (const d of subSnap.docs)
            bulkWriter.delete(d.ref);
    }
    bulkWriter.delete(firebase_1.db.collection('users').doc(uid));
    // 2. Soft-delete articles (sellerId == uid)
    const articlesSnap = await firebase_1.db.collection('articles').where('sellerId', '==', uid).get();
    for (const d of articlesSnap.docs) {
        articleIds.push(d.id);
        bulkWriter.update(d.ref, {
            isActive: false,
            isSold: false,
            deletedAt: firebase_1.FieldValue.serverTimestamp(),
            sellerName: DELETED_NAME,
            sellerImage: null,
            sellerId: `deleted_${uid.slice(0, 8)}`,
        });
    }
    // 3. Cleanup search_index entries for the user's articles
    for (const articleId of articleIds) {
        const siRef = firebase_1.db.collection('search_index').doc(articleId);
        const siSnap = await siRef.get();
        if (siSnap.exists)
            bulkWriter.delete(siRef);
    }
    // 4. Deactivate corresponding embeddings
    for (const articleId of articleIds) {
        const embRef = firebase_1.db.collection('embeddings').doc(articleId);
        const embSnap = await embRef.get();
        if (embSnap.exists)
            bulkWriter.update(embRef, { isActive: false });
    }
    // 5. Delete /favorites/{uid}
    const favRef = firebase_1.db.collection('favorites').doc(uid);
    const favSnap = await favRef.get();
    if (favSnap.exists)
        bulkWriter.delete(favRef);
    // 6. Delete notifications
    const notifsSnap = await firebase_1.db.collection('notifications').where('userId', '==', uid).get();
    for (const d of notifsSnap.docs)
        bulkWriter.delete(d.ref);
    // 7. Anonymise chats
    const chatsSnap = await firebase_1.db.collection('chats').where('participants', 'array-contains', uid).get();
    for (const d of chatsSnap.docs) {
        const info = d.data().participantsInfo;
        if (Array.isArray(info)) {
            const updated = info.map((p) => p.userId === uid ? Object.assign(Object.assign({}, p), { userName: DELETED_NAME, userImage: null }) : p);
            bulkWriter.update(d.ref, { participantsInfo: updated, updatedAt: firebase_1.FieldValue.serverTimestamp() });
        }
        else if (info && typeof info === 'object') {
            if (info[uid]) {
                info[uid] = Object.assign(Object.assign({}, info[uid]), { userName: DELETED_NAME, profileImage: null });
            }
            bulkWriter.update(d.ref, { participantsInfo: info, updatedAt: firebase_1.FieldValue.serverTimestamp() });
        }
    }
    // 7b. Anonymise messages sent by the user (batch 500)
    let msgQuery = firebase_1.db.collection('messages').where('senderId', '==', uid).limit(500);
    let msgSnap = await msgQuery.get();
    while (!msgSnap.empty) {
        for (const d of msgSnap.docs) {
            bulkWriter.update(d.ref, {
                senderName: DELETED_NAME,
                senderImage: null,
            });
        }
        if (msgSnap.size < 500)
            break;
        msgQuery = firebase_1.db.collection('messages').where('senderId', '==', uid).startAfter(msgSnap.docs[msgSnap.docs.length - 1]).limit(500);
        msgSnap = await msgQuery.get();
    }
    // 8a. Anonymise reviews -- reviews written BY the user
    const reviewsByUser = await firebase_1.db.collection('avis').where('reviewerId', '==', uid).get();
    for (const d of reviewsByUser.docs) {
        bulkWriter.update(d.ref, {
            reviewerName: DELETED_NAME,
            reviewerImage: null,
        });
    }
    // 8b. Anonymise reviews -- reviews received BY the user (vendeurId == uid)
    const reviewsForUser = await firebase_1.db.collection('avis').where('vendeurId', '==', uid).get();
    for (const d of reviewsForUser.docs) {
        // Keep the review content but anonymise the target identity
        bulkWriter.update(d.ref, {
            vendeurId: `deleted_${uid.slice(0, 8)}`,
        });
    }
    // 9. Delete swaps
    const [swapsInit, swapsRecv] = await Promise.all([
        firebase_1.db.collection('swaps').where('initiatorId', '==', uid).get(),
        firebase_1.db.collection('swaps').where('receiverId', '==', uid).get(),
    ]);
    const deletedSwapIds = new Set();
    for (const d of [...swapsInit.docs, ...swapsRecv.docs]) {
        if (!deletedSwapIds.has(d.id)) {
            bulkWriter.delete(d.ref);
            deletedSwapIds.add(d.id);
        }
    }
    // 10. Delete swapPartyParticipants + decrement party counters
    const ppSnap = await firebase_1.db.collection('swapPartyParticipants').where('userId', '==', uid).get();
    const piSnap = await firebase_1.db.collection('swapPartyItems').where('sellerId', '==', uid).get();
    // Group items by partyId to compute counter decrements
    const partyDecrements = {};
    for (const d of ppSnap.docs) {
        const partyId = d.data().partyId;
        if (partyId) {
            if (!partyDecrements[partyId])
                partyDecrements[partyId] = { participants: 0, items: 0 };
            partyDecrements[partyId].participants += 1;
        }
        bulkWriter.delete(d.ref);
    }
    // 11. Delete swapPartyItems + count items per party
    for (const d of piSnap.docs) {
        const partyId = d.data().partyId;
        if (partyId) {
            if (!partyDecrements[partyId])
                partyDecrements[partyId] = { participants: 0, items: 0 };
            partyDecrements[partyId].items += 1;
        }
        bulkWriter.delete(d.ref);
    }
    // Decrement counters on affected parties
    for (const [partyId, counts] of Object.entries(partyDecrements)) {
        const partyRef = firebase_1.db.collection('swapParties').doc(partyId);
        const updates = {};
        if (counts.participants > 0) {
            updates.participantsCount = firebase_1.FieldValue.increment(-counts.participants);
        }
        if (counts.items > 0) {
            updates.itemsCount = firebase_1.FieldValue.increment(-counts.items);
        }
        if (Object.keys(updates).length > 0) {
            updates.updatedAt = firebase_1.FieldValue.serverTimestamp();
            bulkWriter.update(partyRef, updates);
        }
    }
    // 12. Anonymise transactions
    const [txBuyer, txSeller] = await Promise.all([
        firebase_1.db.collection('transactions').where('buyerId', '==', uid).get(),
        firebase_1.db.collection('transactions').where('sellerId', '==', uid).get(),
    ]);
    const anonTxIds = new Set();
    for (const d of txBuyer.docs) {
        if (!anonTxIds.has(d.id)) {
            bulkWriter.update(d.ref, { buyerName: DELETED_NAME, buyerEmail: '', updatedAt: firebase_1.FieldValue.serverTimestamp() });
            anonTxIds.add(d.id);
        }
    }
    for (const d of txSeller.docs) {
        bulkWriter.update(d.ref, { sellerName: DELETED_NAME, updatedAt: firebase_1.FieldValue.serverTimestamp() });
    }
    // 13. Delete seller_balances/{uid}
    const balRef = firebase_1.db.collection('seller_balances').doc(uid);
    const balSnap = await balRef.get();
    if (balSnap.exists)
        bulkWriter.delete(balRef);
    // 13b. Delete wallets/{uid} and its ledger subcollection (W3 — Loi 25 / RGPD)
    const walletRef = firebase_1.db.collection('wallets').doc(uid);
    const walletSnap = await walletRef.get();
    if (walletSnap.exists) {
        // Delete all ledger entries first (subcollection)
        const ledgerSnap = await walletRef.collection('ledger').get();
        for (const d of ledgerSnap.docs)
            bulkWriter.delete(d.ref);
        // Delete the wallet doc itself
        bulkWriter.delete(walletRef);
    }
    // 14. Delete withdrawal_requests
    const wdSnap = await firebase_1.db.collection('withdrawal_requests').where('userId', '==', uid).get();
    for (const d of wdSnap.docs)
        bulkWriter.delete(d.ref);
    // 15. Delete drafts
    const draftsSnap = await firebase_1.db.collection('drafts').where('userId', '==', uid).get();
    for (const d of draftsSnap.docs)
        bulkWriter.delete(d.ref);
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
        const bucket = firebase_1.storage.bucket();
        await bucket.deleteFiles({ prefix: `avatars/${uid}` });
        await bucket.deleteFiles({ prefix: `users/${uid}/` });
        for (const articleId of articleIds) {
            try {
                await bucket.deleteFiles({ prefix: `articles/${articleId}/` });
            }
            catch ( /* ignore individual article cleanup errors */_e) { /* ignore individual article cleanup errors */ }
        }
    }
    catch (e) {
        logger.error('[deleteUserAccount] Storage cleanup error', { uid, error: e });
    }
    // 17. Delete Firebase Auth user (last step — after all data is cleaned up)
    try {
        await firebase_1.auth.deleteUser(uid);
        logger.info('[deleteUserAccount] Auth user deleted', { uid });
    }
    catch (e) {
        if (e.code !== 'auth/user-not-found') {
            logger.error('[deleteUserAccount] Failed to delete Auth user', { uid, error: e });
            // Don't throw — Firestore cleanup is done, this is best-effort
        }
    }
    logger.info('[deleteUserAccount] Full cleanup done', { uid });
    return { success: true };
});
//# sourceMappingURL=users.js.map