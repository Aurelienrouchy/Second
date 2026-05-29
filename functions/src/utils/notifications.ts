/**
 * Notification utilities
 * Firebase Functions v7
 *
 * Handles FCM push notifications + in-app notifications.
 * Each notification includes a `deepLink` field for client-side routing.
 */
import * as admin from 'firebase-admin';
import { db, FieldValue } from '../config/firebase';

// ─── Deep link builder ──────────────────────────────────────────────────────

const DEEP_LINK_HOST = 'seconde.app';

/**
 * Build a deep link URL from notification type and data.
 * Produces both scheme (seconde://) and universal (https://seconde.app/) links.
 */
export function buildDeepLink(
  notificationType: string,
  data: Record<string, string>
): string {
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
export async function createInAppNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data: Record<string, string>
): Promise<string> {
  const deepLink = buildDeepLink(type, data);

  const notificationData = {
    userId,
    type,
    title,
    message,
    data: { ...data, deepLink },
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('notifications').add(notificationData);
  await docRef.update({ id: docRef.id });
  return docRef.id;
}

// ─── FCM push notification ──────────────────────────────────────────────────

/**
 * Resolve Android notification channel from notification type
 */
function getAndroidChannel(notificationType: string): string {
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
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data: Record<string, string>,
  notificationType: string
): Promise<{ success: boolean; sentCount: number }> {
  try {
    // Get user's FCM tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`User ${userId} not found`);
      return { success: false, sentCount: 0 };
    }

    const userData = userDoc.data()!;
    const fcmTokens: string[] = userData.fcmTokens || [];

    // Check notification preferences
    const prefs = userData.preferences?.notifications;
    if (prefs?.push === false) {
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
    const messages = fcmTokens.map((token: string) => ({
      token,
      notification: { title, body },
      data: { ...data, type: notificationType, deepLink },
      android: {
        priority: 'high' as const,
        notification: {
          sound: 'default',
          channelId,
          priority: 'high' as const,
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
      if (response.success) {
        successCount++;
      } else {
        console.error(`Failed to send to token ${index}:`, response.error);
        // Remove invalid tokens
        if (
          response.error?.code === 'messaging/invalid-registration-token' ||
          response.error?.code === 'messaging/registration-token-not-registered'
        ) {
          db.collection('users')
            .doc(userId)
            .update({
              fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmTokens[index]),
            })
            .catch((err) => console.error('Error removing invalid token:', err));
        }
      }
    });

    return { success: true, sentCount: successCount };
  } catch (error) {
    console.error('Error sending push notification:', error);
    return { success: false, sentCount: 0 };
  }
}

// ─── Swap notification ──────────────────────────────────────────────────────

/**
 * Send swap notification helper
 */
export async function sendSwapNotification(
  userId: string,
  swapId: string,
  title: string,
  body: string,
  swapData: Record<string, unknown>
): Promise<void> {
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) return;

  const userData = userDoc.data()!;
  const fcmTokens = userData.fcmTokens || [];

  if (fcmTokens.length === 0) return;

  const deepLink = `https://${DEEP_LINK_HOST}/swap/${swapId}`;

  const messages = fcmTokens.map((token: string) => ({
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
      priority: 'high' as const,
      notification: {
        sound: 'default',
        channelId: 'swaps',
        priority: 'high' as const,
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
  } catch (error) {
    console.error(`Failed to send swap notification to ${userId}:`, error);
  }
}
