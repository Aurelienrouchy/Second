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
exports.onUserProfileUpdated = void 0;
/**
 * User profile Firestore triggers
 * Firebase Functions v7 - using onDocumentUpdated
 *
 * Propagates displayName and profileImage changes to denormalized data:
 * - articles.sellerName / articles.sellerImage
 * - chats.participantsInfo[].userName / .userImage (array format)
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/**
 * When a user updates their displayName or profileImage, propagate
 * the change to all articles they own and all chats they participate in.
 *
 * Uses batch writes for efficiency (max 500 ops per batch).
 */
exports.onUserProfileUpdated = (0, firestore_1.onDocumentUpdated)({ document: 'users/{uid}', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120 }, async (event) => {
    var _a, _b;
    const uid = event.params.uid;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!before || !after)
        return;
    const nameChanged = before.displayName !== after.displayName;
    const imageChanged = before.profileImage !== after.profileImage;
    if (!nameChanged && !imageChanged)
        return;
    const newName = after.displayName || 'Utilisateur';
    const newImage = after.profileImage || null;
    logger.info('[onUserProfileUpdated] Propagating profile changes', {
        uid,
        nameChanged,
        imageChanged,
        newName,
    });
    let articlesUpdated = 0;
    let chatsUpdated = 0;
    // 1. Update sellerName / sellerImage on all articles owned by this user
    const articlesSnap = await firebase_1.db
        .collection('articles')
        .where('sellerId', '==', uid)
        .get();
    if (!articlesSnap.empty) {
        const articleUpdates = {};
        if (nameChanged)
            articleUpdates.sellerName = newName;
        if (imageChanged)
            articleUpdates.sellerImage = newImage;
        // Batch writes (max 500 per batch)
        let batch = firebase_1.db.batch();
        let batchCount = 0;
        for (const doc of articlesSnap.docs) {
            batch.update(doc.ref, articleUpdates);
            batchCount++;
            articlesUpdated++;
            if (batchCount >= 499) {
                await batch.commit();
                batch = firebase_1.db.batch();
                batchCount = 0;
            }
        }
        if (batchCount > 0)
            await batch.commit();
    }
    // 2. Update participantsInfo[uid] in all chats where user participates.
    //    participantsInfo is always an array of { userId, userName, userImage }
    //    (chatService writes only this shape; the client reads it with .find).
    const chatsSnap = await firebase_1.db
        .collection('chats')
        .where('participants', 'array-contains', uid)
        .get();
    if (!chatsSnap.empty) {
        let batch = firebase_1.db.batch();
        let batchCount = 0;
        for (const doc of chatsSnap.docs) {
            const chatData = doc.data();
            const info = chatData.participantsInfo;
            if (Array.isArray(info)) {
                const idx = info.findIndex((p) => p.userId === uid);
                if (idx >= 0) {
                    const updated = [...info];
                    if (nameChanged)
                        updated[idx] = Object.assign(Object.assign({}, updated[idx]), { userName: newName });
                    if (imageChanged)
                        updated[idx] = Object.assign(Object.assign({}, updated[idx]), { userImage: newImage });
                    batch.update(doc.ref, {
                        participantsInfo: updated,
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    batchCount++;
                    chatsUpdated++;
                }
            }
            if (batchCount >= 499) {
                await batch.commit();
                batch = firebase_1.db.batch();
                batchCount = 0;
            }
        }
        if (batchCount > 0)
            await batch.commit();
    }
    // 3. Update reviewerName / reviewerImage on all reviews written by this user
    let avisUpdated = 0;
    const avisSnap = await firebase_1.db
        .collection('avis')
        .where('reviewerId', '==', uid)
        .get();
    if (!avisSnap.empty) {
        const avisUpdateData = {};
        if (nameChanged)
            avisUpdateData.reviewerName = newName;
        if (imageChanged)
            avisUpdateData.reviewerImage = newImage;
        let batch = firebase_1.db.batch();
        let batchCount = 0;
        for (const doc of avisSnap.docs) {
            batch.update(doc.ref, avisUpdateData);
            batchCount++;
            avisUpdated++;
            if (batchCount >= 499) {
                await batch.commit();
                batch = firebase_1.db.batch();
                batchCount = 0;
            }
        }
        if (batchCount > 0)
            await batch.commit();
    }
    // 4. (Removed) swapPartyParticipants propagation — the Swap Zone is open to
    //    all with no participant docs anymore.
    // 5. Update swapPartyItems where sellerId == uid
    let swapItemsUpdated = 0;
    const swapItemsSnap = await firebase_1.db
        .collection('swapPartyItems')
        .where('sellerId', '==', uid)
        .get();
    if (!swapItemsSnap.empty) {
        const itemUpdates = {};
        if (nameChanged)
            itemUpdates.sellerName = newName;
        if (imageChanged)
            itemUpdates.sellerImage = newImage;
        let batch = firebase_1.db.batch();
        let batchCount = 0;
        for (const doc of swapItemsSnap.docs) {
            batch.update(doc.ref, itemUpdates);
            batchCount++;
            swapItemsUpdated++;
            if (batchCount >= 499) {
                await batch.commit();
                batch = firebase_1.db.batch();
                batchCount = 0;
            }
        }
        if (batchCount > 0)
            await batch.commit();
    }
    logger.info('[onUserProfileUpdated] Propagation complete', {
        uid,
        articlesUpdated,
        chatsUpdated,
        avisUpdated,
        swapItemsUpdated,
    });
});
//# sourceMappingURL=users.js.map