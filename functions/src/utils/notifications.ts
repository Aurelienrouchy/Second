/**
 * Notification utilities
 * Firebase Functions v7
 *
 * Handles FCM push notifications + in-app notifications.
 * Each notification includes a `deepLink` field for client-side routing.
 */
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

// ─── Token classification ─────────────────────────────────────────────────────

/**
 * Detect a raw APNs device token.
 *
 * `Notifications.getDevicePushTokenAsync()` returns the *native* token: on
 * Android that is an FCM registration token (long, contains a ':' separator),
 * but on iOS it is a RAW APNs device token (typically 64 hex chars, no ':').
 * A raw APNs token is NOT a valid FCM registration token — feeding it to
 * `admin.messaging().sendEach()` always fails, and the failure code
 * (`invalid-registration-token`) would otherwise cause us to delete a token
 * that is perfectly valid for APNs. We therefore detect and skip these here
 * instead of sending them or pruning them.
 *
 * The proper fix (registering a real FCM registration token on iOS) lives in
 * the client; this guard keeps the server from breaking iOS push and from
 * wiping good tokens in the meantime.
 */
function isRawApnsToken(token: string): boolean {
  // FCM registration tokens always contain ':' (e.g. "xxxx:APA91b...").
  // Raw APNs tokens are pure hex (32 bytes = 64 chars, some variants 64-200).
  return !token.includes(':') && /^[0-9a-fA-F]{64,}$/.test(token);
}

/**
 * Split a token list into FCM registration tokens (sendable via FCM) and
 * raw APNs tokens (must NOT be sent through FCM as-is, nor pruned on failure).
 */
export function partitionTokens(tokens: string[]): {
  fcmTokens: string[];
  apnsTokens: string[];
} {
  const fcmTokens: string[] = [];
  const apnsTokens: string[] = [];
  for (const token of tokens) {
    if (isRawApnsToken(token)) {
      apnsTokens.push(token);
    } else {
      fcmTokens.push(token);
    }
  }
  return { fcmTokens, apnsTokens };
}

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
    case 'new_message':
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
    case 'funds_released':
      return data.transactionId
        ? `https://${DEEP_LINK_HOST}/my-orders?transactionId=${data.transactionId}`
        : `https://${DEEP_LINK_HOST}/my-orders`;

    case 'review_received':
      return `https://${DEEP_LINK_HOST}/notifications`;

    case 'privacy_incident':
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

// ─── Notification preferences ─────────────────────────────────────────────────

/**
 * Map a server notification type to the matching key in
 * `users/{uid}.preferences.notifications` (see UserPreferences in types/index.ts).
 *
 * Returns `null` for types that have NO dedicated per-type toggle — those are
 * treated as ALWAYS-ON (default allow). This deliberately covers transactional
 * / safety-critical notifications (review_received, privacy_incident, and any
 * unmapped type): a missing toggle must never silently drop a notification the
 * user can't re-enable.
 */
function getPreferenceKey(notificationType: string): string | null {
  switch (notificationType) {
    case 'chat':
    case 'message':
    case 'new_message':
      return 'newMessages';

    case 'offer':
    case 'offer_received':
      return 'offerReceived';

    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_counter':
      return 'offerResponse';

    case 'new_sale':
    case 'order_shipped':
    case 'order_delivered':
    case 'order_cancelled':
    case 'order_refunded':
    case 'funds_released':
      return 'newOrders';

    case 'article_favorited':
      return 'articleFavorited';

    case 'price_drop':
      return 'priceDrops';

    case 'swap_zone_reminder':
      return 'swapZoneReminder';

    default:
      // review_received, privacy_incident, shop_*, swap_update, and any unknown
      // type → no dedicated toggle → always delivered.
      return null;
  }
}

/**
 * Whether the user opted OUT of a given notification type.
 *
 * A type is suppressed ONLY when it maps to a known preference key AND that key
 * is explicitly `false`. Absent prefs, absent key, or unmapped types default to
 * ALLOW (privacy-by-default opt-outs are encoded in the client defaults, not by
 * silently swallowing notifications here).
 */
function isNotificationTypeDisabled(
  prefs: Record<string, unknown> | undefined,
  notificationType: string
): boolean {
  if (!prefs) return false;
  const key = getPreferenceKey(notificationType);
  if (!key) return false;
  return prefs[key] === false;
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
    case 'order_refunded':
      return 'orders';

    case 'review_received':
      return 'notifications';

    case 'privacy_incident':
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
    const storedTokens: string[] = userData.fcmTokens || [];

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

    if (storedTokens.length === 0) {
      console.log(`No FCM tokens for user ${userId}`);
      return { success: true, sentCount: 0 };
    }

    // Only FCM registration tokens can be sent through FCM. Raw APNs device
    // tokens (iOS, current client) must be skipped — sending them fails and
    // would otherwise trigger deletion of valid tokens.
    const { fcmTokens, apnsTokens } = partitionTokens(storedTokens);
    if (apnsTokens.length > 0) {
      logger.warn('Skipping raw APNs tokens not sendable via FCM', {
        userId,
        notificationType,
        skippedCount: apnsTokens.length,
      });
    }

    if (fcmTokens.length === 0) {
      console.log(`No FCM-routable tokens for user ${userId}`);
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
  const storedTokens: string[] = userData.fcmTokens || [];

  if (storedTokens.length === 0) return;

  // Skip raw APNs tokens (iOS native tokens) — not sendable via FCM.
  const { fcmTokens, apnsTokens } = partitionTokens(storedTokens);
  if (apnsTokens.length > 0) {
    logger.warn('Skipping raw APNs tokens not sendable via FCM', {
      userId,
      notificationType: 'swap_update',
      skippedCount: apnsTokens.length,
    });
  }
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
