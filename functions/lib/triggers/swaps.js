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
exports.onSwapStatusUpdated = exports.onSwapCreated = void 0;
/**
 * Swap Firestore triggers
 * Firebase Functions v7 - using onDocumentCreated/onDocumentUpdated
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../config/firebase");
const notifications_1 = require("../utils/notifications");
/** Resolve items arrays with backward compat for legacy single-item swaps */
function getSwapItems(swap, side) {
    if (side === 'initiator') {
        return swap.initiatorItems || (swap.initiatorItem ? [swap.initiatorItem] : []);
    }
    return swap.receiverItems || (swap.receiverItem ? [swap.receiverItem] : []);
}
/**
 * Send notification when a swap is proposed
 */
exports.onSwapCreated = (0, firestore_1.onDocumentCreated)({ document: 'swaps/{swapId}', region: 'northamerica-northeast1', memory: '512MiB' }, async (event) => {
    var _a;
    try {
        const snapshot = event.data;
        if (!snapshot)
            return;
        const swap = snapshot.data();
        const swapId = event.params.swapId;
        if (!swap.receiverId) {
            console.log('No receiver for swap notification');
            return;
        }
        // Get receiver's FCM tokens
        const receiverDoc = await firebase_1.db.collection('users').doc(swap.receiverId).get();
        if (!receiverDoc.exists) {
            console.log(`Receiver user ${swap.receiverId} not found`);
            return;
        }
        const receiverData = receiverDoc.data();
        const fcmTokens = receiverData.fcmTokens || [];
        if (fcmTokens.length === 0) {
            console.log(`No FCM tokens for user ${swap.receiverId}`);
            return;
        }
        // Build notification
        const title = "Nouvelle proposition d'échange";
        // Handle both single-item (legacy) and multi-item formats
        const receiverItemsArray = getSwapItems(swap, 'receiver');
        const initiatorItemsArray = getSwapItems(swap, 'initiator');
        let body;
        if (receiverItemsArray.length === 0) {
            body = `${swap.initiatorName} te propose un échange`;
        }
        else if (receiverItemsArray.length === 1) {
            body = `${swap.initiatorName} te propose un échange pour "${(_a = receiverItemsArray[0]) === null || _a === void 0 ? void 0 : _a.title}"`;
        }
        else {
            // Multiple items: show count
            const receiverCount = receiverItemsArray.length;
            const initiatorCount = initiatorItemsArray.length;
            body = `${initiatorCount} article(s) proposé(s) pour ${receiverCount} article(s)`;
        }
        const messages = fcmTokens.map((token) => ({
            token,
            notification: {
                title,
                body,
            },
            data: {
                type: 'swap_proposed',
                swapId,
                initiatorId: swap.initiatorId,
                initiatorName: swap.initiatorName,
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'swaps',
                    priority: 'high',
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        }));
        const results = await admin.messaging().sendEach(messages);
        let successCount = 0;
        results.responses.forEach((response, index) => {
            var _a, _b;
            if (response.success) {
                successCount++;
            }
            else {
                console.error(`Failed to send swap notification:`, response.error);
                // Remove invalid tokens
                if (((_a = response.error) === null || _a === void 0 ? void 0 : _a.code) === 'messaging/invalid-registration-token' ||
                    ((_b = response.error) === null || _b === void 0 ? void 0 : _b.code) === 'messaging/registration-token-not-registered') {
                    firebase_1.db.collection('users')
                        .doc(swap.receiverId)
                        .update({
                        fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmTokens[index]),
                    })
                        .catch((err) => console.error('Error removing invalid token:', err));
                }
            }
        });
        console.log(`Swap proposal notification sent: ${successCount} successful`);
    }
    catch (error) {
        console.error('Error sending swap proposal notification:', error);
    }
});
/**
 * Helper to get swap description for notifications
 */
function getSwapDescription(swap) {
    var _a;
    const initiatorItems = getSwapItems(swap, 'initiator');
    const receiverItems = getSwapItems(swap, 'receiver');
    if (initiatorItems.length === 0 && receiverItems.length === 0) {
        return 'l\'échange';
    }
    if (initiatorItems.length === 1 && receiverItems.length === 1) {
        return `l'échange de "${((_a = receiverItems[0]) === null || _a === void 0 ? void 0 : _a.title) || 'article'}"`;
    }
    // Multi-article: show count format
    return `l'échange (${initiatorItems.length} article(s) pour ${receiverItems.length} article(s))`;
}
/**
 * Send notification when swap status changes
 */
exports.onSwapStatusUpdated = (0, firestore_1.onDocumentUpdated)({ document: 'swaps/{swapId}', region: 'northamerica-northeast1', memory: '512MiB' }, async (event) => {
    var _a, _b, _c, _d;
    try {
        const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
        const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
        const swapId = event.params.swapId;
        if (!before || !after)
            return;
        // Only process if status changed
        if (before.status === after.status) {
            return;
        }
        const newStatus = after.status;
        let targetUserId;
        let title;
        let body;
        switch (newStatus) {
            case 'accepted':
                targetUserId = after.initiatorId;
                title = 'Échange accepté !';
                body = `${after.receiverName} a accepté ${getSwapDescription(after)}`;
                break;
            case 'declined':
                targetUserId = after.initiatorId;
                title = 'Échange refusé';
                body = `${after.receiverName} a refusé ${getSwapDescription(after)}`;
                break;
            case 'cancelled':
                targetUserId = after.receiverId;
                title = 'Échange annulé';
                body = `${after.initiatorName} a annulé ${getSwapDescription(after)}`;
                break;
            case 'photos_pending':
                // Notify both parties
                await (0, notifications_1.sendSwapNotification)(after.initiatorId, swapId, 'Photos requises', "N'oublie pas d'envoyer les photos de ton article", after);
                await (0, notifications_1.sendSwapNotification)(after.receiverId, swapId, 'Photos requises', "N'oublie pas d'envoyer les photos de ton article", after);
                return;
            case 'shipping':
                // Notify both parties
                await (0, notifications_1.sendSwapNotification)(after.initiatorId, swapId, 'Prêt à expédier', 'Les photos sont validées, tu peux envoyer ton article', after);
                await (0, notifications_1.sendSwapNotification)(after.receiverId, swapId, 'Prêt à expédier', 'Les photos sont validées, tu peux envoyer ton article', after);
                return;
            case 'completed':
                // Notify both parties
                await (0, notifications_1.sendSwapNotification)(after.initiatorId, swapId, 'Échange terminé !', "L'échange est complet. N'oublie pas de laisser une note.", after);
                await (0, notifications_1.sendSwapNotification)(after.receiverId, swapId, 'Échange terminé !', "L'échange est complet. N'oublie pas de laisser une note.", after);
                return;
            default:
                return;
        }
        await (0, notifications_1.sendSwapNotification)(targetUserId, swapId, title, body, after);
    }
    catch (error) {
        console.error('Error sending swap status notification:', error);
    }
});
//# sourceMappingURL=swaps.js.map