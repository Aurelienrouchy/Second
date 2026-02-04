/**
 * Notification utilities
 * Firebase Functions v7
 */
import * as admin from 'firebase-admin';
import { db, FieldValue } from '../config/firebase';

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
  const notificationData = {
    userId,
    type,
    title,
    message,
    data,
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('notifications').add(notificationData);
  await docRef.update({ id: docRef.id });
  return docRef.id;
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

    // Build FCM messages
    const messages = fcmTokens.map((token: string) => ({
      token,
      notification: { title, body },
      data: { ...data, type: notificationType },
      android: {
        priority: 'high' as const,
        notification: {
          sound: 'default',
          channelId: 'notifications',
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
