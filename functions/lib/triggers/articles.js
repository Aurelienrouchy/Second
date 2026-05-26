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
exports.onArticleSold = exports.onArticleSoftDeleted = void 0;
/**
 * Article Firestore triggers
 * Firebase Functions v7 - using onDocumentUpdated
 *
 * Handles search_index cleanup when an article is soft-deleted
 * (isActive transitions from true to false).
 *
 * Note: The embeddings trigger (embeddings.ts) already handles
 * deactivating embeddings when isActive changes. This trigger
 * focuses on the search_index collection.
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/**
 * When an article's isActive changes from true to false (soft-delete),
 * remove its corresponding search_index entry so it no longer appears
 * in search results.
 *
 * When isActive changes from false to true (reactivation), we do NOT
 * recreate the search_index entry here — that is the responsibility of
 * the products.ts trigger on the `products` collection, or a manual
 * reindex.
 */
exports.onArticleSoftDeleted = (0, firestore_1.onDocumentUpdated)({ document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' }, async (event) => {
    var _a, _b;
    const articleId = event.params.articleId;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!before || !after)
        return;
    // Only act when isActive transitions from true to false
    if (before.isActive === true && after.isActive === false) {
        try {
            const siRef = firebase_1.db.collection('search_index').doc(articleId);
            const siSnap = await siRef.get();
            if (siSnap.exists) {
                await siRef.delete();
                logger.info('[onArticleSoftDeleted] Removed search_index entry', { articleId });
            }
        }
        catch (error) {
            logger.error('[onArticleSoftDeleted] Failed to remove search_index', {
                articleId,
                error: error instanceof Error ? error.message : error,
            });
        }
    }
});
/**
 * When an article is sold (isSold transitions from false to true),
 * expire all pending offers in related chats and notify participants
 * via a system message.
 *
 * This prevents buyers from seeing stale "pending" offers on articles
 * that are no longer available.
 */
exports.onArticleSold = (0, firestore_1.onDocumentUpdated)({ document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' }, async (event) => {
    var _a, _b, _c, _d, _e;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    if (!before || !after)
        return;
    // Only fire when isSold changes from false to true
    if (before.isSold === true || after.isSold !== true)
        return;
    const articleId = event.params.articleId;
    // Find all chats related to this article
    const chatsSnap = await firebase_1.db.collection('chats')
        .where('articleId', '==', articleId)
        .get();
    if (chatsSnap.empty) {
        logger.info('[onArticleSold] No chats found for article', { articleId });
        return;
    }
    const chatIds = chatsSnap.docs.map((d) => d.id);
    let totalExpired = 0;
    // For each chat, find pending offer messages and expire them
    for (const chatId of chatIds) {
        const pendingOffers = await firebase_1.db.collection('messages')
            .where('chatId', '==', chatId)
            .where('type', '==', 'offer')
            .where('offer.status', '==', 'pending')
            .get();
        const batch = firebase_1.db.batch();
        let count = 0;
        for (const msgDoc of pendingOffers.docs) {
            batch.update(msgDoc.ref, {
                'offer.status': 'expired',
            });
            count++;
        }
        if (count > 0) {
            await batch.commit();
            totalExpired += count;
            // Send system message to inform participants
            const chatDoc = await firebase_1.db.collection('chats').doc(chatId).get();
            const participants = chatDoc.exists ? (((_e = chatDoc.data()) === null || _e === void 0 ? void 0 : _e.participants) || []) : [];
            await firebase_1.db.collection('messages').add({
                chatId,
                senderId: 'system',
                receiverId: 'system',
                type: 'system',
                content: 'Cet article a été vendu. Les offres en attente ont été annulées.',
                participants,
                timestamp: firebase_1.FieldValue.serverTimestamp(),
                status: 'sent',
                isRead: true,
            });
        }
    }
    logger.info(`[onArticleSold] Expired ${totalExpired} pending offers across ${chatIds.length} chats for article ${articleId}`);
});
//# sourceMappingURL=articles.js.map