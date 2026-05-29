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
exports.buildDeepLink = buildDeepLink;
exports.createInAppNotification = createInAppNotification;
exports.sendPushNotification = sendPushNotification;
exports.sendSwapNotification = sendSwapNotification;
/**
 * Notification utilities
 * Firebase Functions v7
 *
 * Handles FCM push notifications + in-app notifications.
 * Each notification includes a `deepLink` field for client-side routing.
 */
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../config/firebase");
// ─── Deep link builder ──────────────────────────────────────────────────────
const DEEP_LINK_HOST = 'seconde.app';
/**
 * Build a deep link URL from notification type and data.
 * Produces both scheme (seconde://) and universal (https://seconde.app/) links.
 */
function buildDeepLink(notificationType, data) {
    switch (notificationType) {
        case 'chat':
        case 'message':
            return data.chatId ? `https://${DEEP_LINK_HOST}/chat/${data.chatId}` : '';
        case 'offer':
        case 'offer_received':
        case 'offer_accepted':
        case 'offer_rejected':
        case 'offer_counter':
            return data.chatId ? `https://${DEEP_LINK_HOST}/chat/${data.chatId}` : '';
        case 'article_favorited':
        case 'price_drop':
            return data.articleId
                ? `https://${DEEP_LINK_HOST}/article/${data.articleId}`
                : '';
        case 'swap_zone_reminder':
            return data.partyId
                ? `https://${DEEP_LINK_HOST}/swap-party/${data.partyId}`
                : '';
        case 'swap_update':
            return data.swapId
                ? `https://${DEEP_LINK_HOST}/swap/${data.swapId}`
                : '';
        case 'saved_search':
            return data.savedSearchId
                ? `https://${DEEP_LINK_HOST}/search?savedSearchId=${data.savedSearchId}`
                : '';
        case 'new_sale':
        case 'order_shipped':
        case 'order_delivered':
        case 'order_cancelled':
        case 'order_refunded':
            return data.transactionId
                ? `https://${DEEP_LINK_HOST}/my-orders`
                : '';
        case 'review_received':
            return `https://${DEEP_LINK_HOST}/notifications`;
        case 'shop_approved':
        case 'shop_rejected':
        case 'shop_created':
            return `https://${DEEP_LINK_HOST}/notifications`;
        default:
            return '';
    }
}
// ─── In-app notification ────────────────────────────────────────────────────
/**
 * Create in-app notification in Firestore
 */
async function createInAppNotification(userId, type, title, message, data) {
    const deepLink = buildDeepLink(type, data);
    const notificationData = {
        userId,
        type,
        title,
        message,
        data: Object.assign(Object.assign({}, data), { deepLink }),
        isRead: false,
        createdAt: firebase_1.FieldValue.serverTimestamp(),
    };
    const docRef = await firebase_1.db.collection('notifications').add(notificationData);
    await docRef.update({ id: docRef.id });
    return docRef.id;
}
// ─── FCM push notification ──────────────────────────────────────────────────
/**
 * Resolve Android notification channel from notification type
 */
function getAndroidChannel(notificationType) {
    switch (notificationType) {
        case 'chat':
        case 'message':
            return 'messages';
        case 'offer':
        case 'offer_received':
        case 'offer_accepted':
        case 'offer_rejected':
        case 'offer_counter':
            return 'offers';
        case 'swap_zone_reminder':
        case 'swap_update':
            return 'swaps';
        case 'new_sale':
        case 'order_shipped':
        case 'order_delivered':
        case 'order_cancelled':
        case 'order_refunded':
            return 'orders';
        case 'review_received':
            return 'notifications';
        default:
            return 'notifications';
    }
}
/**
 * Send FCM push notification and create in-app notification
 */
async function sendPushNotification(userId, title, body, data, notificationType) {
    var _a;
    try {
        // Get user's FCM tokens
        const userDoc = await firebase_1.db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            console.log(`User ${userId} not found`);
            return { success: false, sentCount: 0 };
        }
        const userData = userDoc.data();
        const fcmTokens = userData.fcmTokens || [];
        // Check notification preferences
        const prefs = (_a = userData.preferences) === null || _a === void 0 ? void 0 : _a.notifications;
        if ((prefs === null || prefs === void 0 ? void 0 : prefs.push) === false) {
            console.log(`User ${userId} has push notifications disabled`);
            // Still create in-app notification
            await createInAppNotification(userId, notificationType, title, body, data);
            return { success: true, sentCount: 0 };
        }
        // Create in-app notification regardless of push
        await createInAppNotification(userId, notificationType, title, body, data);
        if (fcmTokens.length === 0) {
            console.log(`No FCM tokens for user ${userId}`);
            return { success: true, sentCount: 0 };
        }
        // Build deep link for this notification
        const deepLink = buildDeepLink(notificationType, data);
        const channelId = getAndroidChannel(notificationType);
        // Build FCM messages
        const messages = fcmTokens.map((token) => ({
            token,
            notification: { title, body },
            data: Object.assign(Object.assign({}, data), { type: notificationType, deepLink }),
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId,
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
        // Send notifications
        const results = await admin.messaging().sendEach(messages);
        let successCount = 0;
        results.responses.forEach((response, index) => {
            var _a, _b;
            if (response.success) {
                successCount++;
            }
            else {
                console.error(`Failed to send to token ${index}:`, response.error);
                // Remove invalid tokens
                if (((_a = response.error) === null || _a === void 0 ? void 0 : _a.code) === 'messaging/invalid-registration-token' ||
                    ((_b = response.error) === null || _b === void 0 ? void 0 : _b.code) === 'messaging/registration-token-not-registered') {
                    firebase_1.db.collection('users')
                        .doc(userId)
                        .update({
                        fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmTokens[index]),
                    })
                        .catch((err) => console.error('Error removing invalid token:', err));
                }
            }
        });
        return { success: true, sentCount: successCount };
    }
    catch (error) {
        console.error('Error sending push notification:', error);
        return { success: false, sentCount: 0 };
    }
}
// ─── Swap notification ──────────────────────────────────────────────────────
/**
 * Send swap notification helper
 */
async function sendSwapNotification(userId, swapId, title, body, swapData) {
    const userDoc = await firebase_1.db.collection('users').doc(userId).get();
    if (!userDoc.exists)
        return;
    const userData = userDoc.data();
    const fcmTokens = userData.fcmTokens || [];
    if (fcmTokens.length === 0)
        return;
    const deepLink = `https://${DEEP_LINK_HOST}/swap/${swapId}`;
    const messages = fcmTokens.map((token) => ({
        token,
        notification: {
            title,
            body,
        },
        data: {
            type: 'swap_update',
            swapId,
            status: String(swapData.status || ''),
            deepLink,
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
    try {
        await admin.messaging().sendEach(messages);
    }
    catch (error) {
        console.error(`Failed to send swap notification to ${userId}:`, error);
    }
}
//# sourceMappingURL=notifications.js.map