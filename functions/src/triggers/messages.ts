/**
 * Message Firestore triggers
 * Firebase Functions v7 - using onDocumentCreated/onDocumentUpdated
 */
import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { db } from '../config/firebase';

/**
 * Send push notification when a message is created
 */
export const sendMessageNotification = onDocumentCreated(
  { document: 'messages/{messageId}', memory: '512MiB' },
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
            ? `📷 Photo - "${articleTitle}"`
            : '📷 Vous a envoyé une photo';
          notificationType = 'message';
          break;

        case 'offer':
          const amount = message.offer?.amount || 0;
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
 * Send notification when offer status changes
 */
export const sendOfferStatusNotification = onDocumentUpdated(
  { document: 'messages/{messageId}', memory: '512MiB' },
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

      // Only send notification for accepted/rejected offers
      if (offerStatus !== 'accepted' && offerStatus !== 'rejected') {
        return;
      }

      // Get offer sender's (original buyer) FCM tokens
      const buyerDoc = await db.collection('users').doc(senderId).get();
      if (!buyerDoc.exists) {
        console.log(`Buyer user ${senderId} not found`);
        return;
      }

      const buyerData = buyerDoc.data()!;
      const fcmTokens = buyerData.fcmTokens || [];

      if (fcmTokens.length === 0) {
        console.log(`No FCM tokens found for user ${senderId}`);
        return;
      }

      // Get seller info
      const sellerDoc = await db.collection('users').doc(receiverId).get();
      const sellerName = sellerDoc.exists
        ? sellerDoc.data()!.displayName || 'Le vendeur'
        : 'Le vendeur';

      // Build notification
      const title =
        offerStatus === 'accepted' ? 'Offre acceptée ! 🎉' : 'Offre refusée';
      const body =
        offerStatus === 'accepted'
          ? `${sellerName} a accepté votre offre de ${amount}€`
          : `${sellerName} a refusé votre offre de ${amount}€`;

      // Send notification to all buyer's devices
      const messages = fcmTokens.map((token: string) => ({
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
          priority: 'high' as const,
          notification: {
            sound: 'default',
            channelId: 'offers',
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
        }
      });

      console.log(
        `Offer status notifications sent: ${successCount} successful, ${failureCount} failed`
      );
    } catch (error) {
      console.error('Error sending offer status notification:', error);
    }
  }
);
