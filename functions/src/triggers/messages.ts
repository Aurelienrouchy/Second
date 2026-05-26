/**
 * Message Firestore triggers
 * Firebase Functions v7 - using onDocumentCreated/onDocumentUpdated
 */
import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';

/**
 * Send push notification when a message is created
 */
export const sendMessageNotification = onDocumentCreated(
  { document: 'messages/{messageId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    try {
      const snapshot = event.data;
      if (!snapshot) return;

      const message = snapshot.data();
      const { chatId, senderId, receiverId, type, content } = message;

      if (!receiverId || !senderId || !chatId) {
        console.log('Missing required fields for notification');
        return;
      }

      // Get receiver's FCM tokens
      const receiverDoc = await db.collection('users').doc(receiverId).get();
      if (!receiverDoc.exists) {
        console.log(`Receiver user ${receiverId} not found`);
        return;
      }

      const receiverData = receiverDoc.data()!;
      const fcmTokens = receiverData.fcmTokens || [];

      if (fcmTokens.length === 0) {
        console.log(`No FCM tokens found for user ${receiverId}`);
        return;
      }

      // Get sender info
      const senderDoc = await db.collection('users').doc(senderId).get();
      const senderName = senderDoc.exists
        ? senderDoc.data()!.displayName || 'Un utilisateur'
        : 'Un utilisateur';

      // Get chat info for article title
      const chatDoc = await db.collection('chats').doc(chatId).get();
      const chatData = chatDoc.exists ? chatDoc.data() : null;
      const articleTitle = chatData?.articleTitle;

      // Build notification based on message type
      let title = '';
      let body = '';
      let notificationType: string = type;

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
            ? `Photo - "${articleTitle}"`
            : 'Vous a envoyé une photo';
          notificationType = 'message';
          break;

        case 'offer':
          const amount = message.offer?.amount || 0;
          title = `Nouvelle offre de ${senderName}`;
          body = articleTitle
            ? `${amount} $ pour "${articleTitle}"`
            : `Offre de ${amount} $`;
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
      const messages = fcmTokens.map((token: string) => ({
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
          priority: 'high' as const,
          notification: {
            sound: 'default',
            channelId: 'messages',
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

      // Send all notifications
      const results = await admin.messaging().sendEach(messages);

      let successCount = 0;
      let failureCount = 0;

      results.responses.forEach((response, index) => {
        if (response.success) {
          successCount++;
        } else {
          failureCount++;
          console.error(
            `Failed to send to token ${fcmTokens[index]}:`,
            response.error
          );

          // Remove invalid tokens
          if (
            response.error?.code === 'messaging/invalid-registration-token' ||
            response.error?.code === 'messaging/registration-token-not-registered'
          ) {
            db.collection('users')
              .doc(receiverId)
              .update({
                fcmTokens: admin.firestore.FieldValue.arrayRemove(
                  fcmTokens[index]
                ),
              })
              .catch((err) => console.error('Error removing invalid token:', err));
          }
        }
      });

      console.log(
        `Notifications sent: ${successCount} successful, ${failureCount} failed`
      );
    } catch (error) {
      console.error('Error sending message notification:', error);
    }
  }
);

/**
 * Send notification when offer status changes (accepted, rejected, counter-offer)
 *
 * The notification goes to the original offer sender (buyer) when the
 * receiver (seller) accepts, rejects, or counter-offers.
 *
 * Handled statuses:
 * - accepted: "Votre offre a ete acceptee !"
 * - rejected: "Offre refusee"
 * - counter_price: "Nouvelle contre-offre" (price)
 * - counter_location: "Nouveau lieu propose"
 * - counter_time: "Nouvel horaire propose"
 */
export const sendOfferStatusNotification = onDocumentUpdated(
  { document: 'messages/{messageId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    try {
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();

      if (!before || !after) return;

      // Check if offer status changed
      if (
        !before.offer ||
        !after.offer ||
        before.offer.status === after.offer.status
      ) {
        return;
      }

      const { chatId, senderId, receiverId } = after;
      const offerStatus = after.offer.status;
      const amount = after.offer.amount;

      // Only send notification for statuses that require buyer notification
      const notifiableStatuses = [
        'accepted',
        'rejected',
        'counter_price',
        'counter_location',
        'counter_time',
      ];

      if (!notifiableStatuses.includes(offerStatus)) {
        return;
      }

      if (!senderId || !receiverId || !chatId) {
        logger.warn('Missing required fields for offer status notification', {
          senderId,
          receiverId,
          chatId,
          offerStatus,
        });
        return;
      }

      // Get seller info (the one who changed the status)
      const sellerDoc = await db.collection('users').doc(receiverId).get();
      const sellerName = sellerDoc.exists
        ? sellerDoc.data()!.displayName || 'Le vendeur'
        : 'Le vendeur';

      // Build notification based on status
      let title: string;
      let body: string;
      let notificationType: string;

      switch (offerStatus) {
        case 'accepted':
          title = 'Votre offre a ete acceptee !';
          body = `${sellerName} a accepte votre offre de ${amount} $`;
          notificationType = 'offer_accepted';
          break;

        case 'rejected':
          title = 'Offre refusee';
          body = `${sellerName} a decline votre offre`;
          notificationType = 'offer_rejected';
          break;

        case 'counter_price':
          title = 'Nouvelle contre-offre';
          body = `${sellerName} vous propose un nouveau prix`;
          notificationType = 'offer_counter';
          break;

        case 'counter_location':
          title = 'Nouveau lieu propose';
          body = `${sellerName} propose un autre lieu de rencontre`;
          notificationType = 'offer_counter';
          break;

        case 'counter_time':
          title = 'Nouvel horaire propose';
          body = `${sellerName} propose un autre horaire`;
          notificationType = 'offer_counter';
          break;

        default:
          return;
      }

      // Send push notification + in-app notification to the original offer sender (buyer)
      const result = await sendPushNotification(
        senderId,
        title,
        body,
        {
          chatId,
          senderId: receiverId,
          senderName: sellerName,
          amount: String(amount || ''),
          offerStatus,
        },
        notificationType
      );

      logger.info('Offer status notification sent', {
        messageId: event.params.messageId,
        recipientId: senderId,
        offerStatus,
        notificationType,
        success: result.success,
        sentCount: result.sentCount,
      });
    } catch (error) {
      logger.error('Error sending offer status notification', { error });
    }
  }
);
