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
exports.sendOfferStatusNotification = exports.sendMessageNotification = void 0;
/**
 * Message Firestore triggers
 * Firebase Functions v7 - using onDocumentCreated/onDocumentUpdated
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../config/firebase");
/**
 * Send push notification when a message is created
 */
exports.sendMessageNotification = (0, firestore_1.onDocumentCreated)({ document: 'messages/{messageId}', memory: '512MiB' }, async (event) => {
    var _a;
    try {
        const snapshot = event.data;
        if (!snapshot)
            return;
        const message = snapshot.data();
        const { chatId, senderId, receiverId, type, content } = message;
        if (!receiverId || !senderId || !chatId) {
            console.log('Missing required fields for notification');
            return;
        }
        // Get receiver's FCM tokens
        const receiverDoc = await firebase_1.db.collection('users').doc(receiverId).get();
        if (!receiverDoc.exists) {
            console.log(`Receiver user ${receiverId} not found`);
            return;
        }
        const receiverData = receiverDoc.data();
        const fcmTokens = receiverData.fcmTokens || [];
        if (fcmTokens.length === 0) {
            console.log(`No FCM tokens found for user ${receiverId}`);
            return;
        }
        // Get sender info
        const senderDoc = await firebase_1.db.collection('users').doc(senderId).get();
        const senderName = senderDoc.exists
            ? senderDoc.data().displayName || 'Un utilisateur'
            : 'Un utilisateur';
        // Get chat info for article title
        const chatDoc = await firebase_1.db.collection('chats').doc(chatId).get();
        const chatData = chatDoc.exists ? chatDoc.data() : null;
        const articleTitle = chatData === null || chatData === void 0 ? void 0 : chatData.articleTitle;
        // Build notification based on message type
        let title = '';
        let body = '';
        let notificationType = type;
        switch (type) {
            case 'text':
                title = senderName;
                body = articleTitle
                    ? `À propos de "${articleTitle}"`
                    : content.substring(0, 100);
                notificationType = 'message';
                break;
            case 'image':
                title = senderName;
                body = articleTitle
                    ? `📷 Photo - "${articleTitle}"`
                    : '📷 Vous a envoyé une photo';
                notificationType = 'message';
                break;
            case 'offer':
                const amount = ((_a = message.offer) === null || _a === void 0 ? void 0 : _a.amount) || 0;
                title = `Nouvelle offre de ${senderName}`;
                body = articleTitle
                    ? `${amount}€ pour "${articleTitle}"`
                    : `Offre de ${amount}€`;
                notificationType = 'offer';
                break;
            case 'system':
                // Don't send notifications for system messages
                return;
            default:
                title = 'Nouveau message';
                body = senderName;
        }
        // Send notification to all user's devices
        const messages = fcmTokens.map((token) => ({
            token,
            notification: {
                title,
                body,
            },
            data: {
                type: notificationType,
                chatId,
                senderId,
                senderName,
                articleTitle: articleTitle || '',
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'messages',
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
        // Send all notifications
        const results = await admin.messaging().sendEach(messages);
        let successCount = 0;
        let failureCount = 0;
        results.responses.forEach((response, index) => {
            var _a, _b;
            if (response.success) {
                successCount++;
            }
            else {
                failureCount++;
                console.error(`Failed to send to token ${fcmTokens[index]}:`, response.error);
                // Remove invalid tokens
                if (((_a = response.error) === null || _a === void 0 ? void 0 : _a.code) === 'messaging/invalid-registration-token' ||
                    ((_b = response.error) === null || _b === void 0 ? void 0 : _b.code) === 'messaging/registration-token-not-registered') {
                    firebase_1.db.collection('users')
                        .doc(receiverId)
                        .update({
                        fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmTokens[index]),
                    })
                        .catch((err) => console.error('Error removing invalid token:', err));
                }
            }
        });
        console.log(`Notifications sent: ${successCount} successful, ${failureCount} failed`);
    }
    catch (error) {
        console.error('Error sending message notification:', error);
    }
});
/**
 * Send notification when offer status changes
 */
exports.sendOfferStatusNotification = (0, firestore_1.onDocumentUpdated)({ document: 'messages/{messageId}', memory: '512MiB' }, async (event) => {
    var _a, _b, _c, _d;
    try {
        const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
        const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
        if (!before || !after)
            return;
        // Check if offer status changed
        if (!before.offer ||
            !after.offer ||
            before.offer.status === after.offer.status) {
            return;
        }
        const { chatId, senderId, receiverId } = after;
        const offerStatus = after.offer.status;
        const amount = after.offer.amount;
        // Only send notification for accepted/rejected offers
        if (offerStatus !== 'accepted' && offerStatus !== 'rejected') {
            return;
        }
        // Get offer sender's (original buyer) FCM tokens
        const buyerDoc = await firebase_1.db.collection('users').doc(senderId).get();
        if (!buyerDoc.exists) {
            console.log(`Buyer user ${senderId} not found`);
            return;
        }
        const buyerData = buyerDoc.data();
        const fcmTokens = buyerData.fcmTokens || [];
        if (fcmTokens.length === 0) {
            console.log(`No FCM tokens found for user ${senderId}`);
            return;
        }
        // Get seller info
        const sellerDoc = await firebase_1.db.collection('users').doc(receiverId).get();
        const sellerName = sellerDoc.exists
            ? sellerDoc.data().displayName || 'Le vendeur'
            : 'Le vendeur';
        // Build notification
        const title = offerStatus === 'accepted' ? 'Offre acceptée ! 🎉' : 'Offre refusée';
        const body = offerStatus === 'accepted'
            ? `${sellerName} a accepté votre offre de ${amount}€`
            : `${sellerName} a refusé votre offre de ${amount}€`;
        // Send notification to all buyer's devices
        const messages = fcmTokens.map((token) => ({
            token,
            notification: {
                title,
                body,
            },
            data: {
                type: `offer_${offerStatus}`,
                chatId,
                senderId: receiverId,
                senderName: sellerName,
                amount: amount.toString(),
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'offers',
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
        // Send all notifications
        const results = await admin.messaging().sendEach(messages);
        let successCount = 0;
        let failureCount = 0;
        results.responses.forEach((response, index) => {
            if (response.success) {
                successCount++;
            }
            else {
                failureCount++;
                console.error(`Failed to send to token ${fcmTokens[index]}:`, response.error);
            }
        });
        console.log(`Offer status notifications sent: ${successCount} successful, ${failureCount} failed`);
    }
    catch (error) {
        console.error('Error sending offer status notification:', error);
    }
});
//# sourceMappingURL=messages.js.map