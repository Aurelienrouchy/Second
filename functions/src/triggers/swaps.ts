/**
 * Swap Firestore triggers
 * Firebase Functions v7 - using onDocumentCreated/onDocumentUpdated
 */
import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { db } from '../config/firebase';
import { sendSwapNotification } from '../utils/notifications';

/**
 * Send notification when a swap is proposed
 */
export const onSwapCreated = onDocumentCreated(
  { document: 'swaps/{swapId}', memory: '512MiB' },
  async (event) => {
    try {
      const snapshot = event.data;
      if (!snapshot) return;

      const swap = snapshot.data();
      const swapId = event.params.swapId;

      if (!swap.receiverId) {
        console.log('No receiver for swap notification');
        return;
      }

      // Get receiver's FCM tokens
      const receiverDoc = await db.collection('users').doc(swap.receiverId).get();
      if (!receiverDoc.exists) {
        console.log(`Receiver user ${swap.receiverId} not found`);
        return;
      }

      const receiverData = receiverDoc.data()!;
      const fcmTokens = receiverData.fcmTokens || [];

      if (fcmTokens.length === 0) {
        console.log(`No FCM tokens for user ${swap.receiverId}`);
        return;
      }

      // Build notification
      const title = "🔄 Nouvelle proposition d'échange";
      const body = `${swap.initiatorName} te propose un échange pour "${swap.receiverItem?.title}"`;

      const messages = fcmTokens.map((token: string) => ({
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

      const results = await admin.messaging().sendEach(messages);

      let successCount = 0;
      results.responses.forEach((response, index) => {
        if (response.success) {
          successCount++;
        } else {
          console.error(`Failed to send swap notification:`, response.error);
          // Remove invalid tokens
          if (
            response.error?.code === 'messaging/invalid-registration-token' ||
            response.error?.code === 'messaging/registration-token-not-registered'
          ) {
            db.collection('users')
              .doc(swap.receiverId)
              .update({
                fcmTokens: admin.firestore.FieldValue.arrayRemove(
                  fcmTokens[index]
                ),
              })
              .catch((err) => console.error('Error removing invalid token:', err));
          }
        }
      });

      console.log(`Swap proposal notification sent: ${successCount} successful`);
    } catch (error) {
      console.error('Error sending swap proposal notification:', error);
    }
  }
);

/**
 * Send notification when swap status changes
 */
export const onSwapStatusUpdated = onDocumentUpdated(
  { document: 'swaps/{swapId}', memory: '512MiB' },
  async (event) => {
    try {
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();
      const swapId = event.params.swapId;

      if (!before || !after) return;

      // Only process if status changed
      if (before.status === after.status) {
        return;
      }

      const newStatus = after.status;
      let targetUserId: string;
      let title: string;
      let body: string;

      switch (newStatus) {
        case 'accepted':
          targetUserId = after.initiatorId;
          title = '✅ Échange accepté !';
          body = `${after.receiverName} a accepté ton échange`;
          break;

        case 'declined':
          targetUserId = after.initiatorId;
          title = '❌ Échange refusé';
          body = `${after.receiverName} a refusé ton échange`;
          break;

        case 'cancelled':
          targetUserId = after.receiverId;
          title = '🚫 Échange annulé';
          body = `${after.initiatorName} a annulé l'échange`;
          break;

        case 'photos_pending':
          // Notify both parties
          await sendSwapNotification(
            after.initiatorId,
            swapId,
            '📸 Photos requises',
            "N'oublie pas d'envoyer les photos de ton article",
            after
          );
          await sendSwapNotification(
            after.receiverId,
            swapId,
            '📸 Photos requises',
            "N'oublie pas d'envoyer les photos de ton article",
            after
          );
          return;

        case 'shipping':
          // Notify both parties
          await sendSwapNotification(
            after.initiatorId,
            swapId,
            '📦 Prêt à expédier',
            'Les photos sont validées, tu peux envoyer ton article',
            after
          );
          await sendSwapNotification(
            after.receiverId,
            swapId,
            '📦 Prêt à expédier',
            'Les photos sont validées, tu peux envoyer ton article',
            after
          );
          return;

        case 'completed':
          // Notify both parties
          await sendSwapNotification(
            after.initiatorId,
            swapId,
            '🎉 Échange terminé !',
            "L'échange est complet. N'oublie pas de laisser une note.",
            after
          );
          await sendSwapNotification(
            after.receiverId,
            swapId,
            '🎉 Échange terminé !',
            "L'échange est complet. N'oublie pas de laisser une note.",
            after
          );
          return;

        default:
          return;
      }

      await sendSwapNotification(targetUserId, swapId, title, body, after);
    } catch (error) {
      console.error('Error sending swap status notification:', error);
    }
  }
);
