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
import { partitionTokens, sendPushNotification } from '../utils/notifications';

/**
 * Check if either user has blocked the other.
 *
 * Reads BOTH the canonical flat `blockedUserIds` list (plain UIDs, the source
 * of truth consumed by the Firestore rules) AND the legacy `blockedUsers`
 * array of objects `{ userId, userName, blockedAt }` (written by the client
 * moderationService for the UI). A flat-string shape on `blockedUsers` is
 * tolerated too so the check stays correct if the data model is ever migrated
 * to plain UIDs. The block is SYMMETRIC: if EITHER side blocks the other, the
 * pair is considered blocked (matches services/moderationService.ts +
 * firestore.rules chat-create semantics).
 */
async function areUsersBlocked(
  userId1: string,
  userId2: string
): Promise<boolean> {
  const [user1Snap, user2Snap] = await Promise.all([
    db.collection('users').doc(userId1).get(),
    db.collection('users').doc(userId2).get(),
  ]);

  const matches = (data: FirebaseFirestore.DocumentData | undefined, target: string) => {
    const flat = (data?.blockedUserIds || []) as string[];
    if (Array.isArray(flat) && flat.includes(target)) return true;
    const legacy = (data?.blockedUsers || []) as Array<
      { userId?: string } | string
    >;
    return (
      Array.isArray(legacy) &&
      legacy.some((u) =>
        typeof u === 'string' ? u === target : u.userId === target
      )
    );
  };

  return matches(user1Snap.data(), userId2) || matches(user2Snap.data(), userId1);
}

/**
 * Resolve the authoritative "other participant" of a chat from the SERVER chat
 * doc — never from the client-supplied `receiverId` on the message. Returns
 * null if the chat is missing, malformed, or the sender is not actually a
 * participant of it (in which case the message is illegitimate and must be
 * neutralised regardless of any block relationship).
 */
async function resolveChatCounterparty(
  chatId: string,
  senderId: string
): Promise<string | null> {
  const chatSnap = await db.collection('chats').doc(chatId).get();
  if (!chatSnap.exists) return null;

  const participants = chatSnap.data()?.participants;
  if (!Array.isArray(participants) || participants.length !== 2) return null;

  // The sender MUST be a participant of the chat it writes into.
  if (!participants.includes(senderId)) return null;

  const other = participants.find((p: string) => p !== senderId);
  return typeof other === 'string' ? other : null;
}

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

      // SECURITY (M2): server-side enforcement of user blocking.
      // Messages are created client->Firestore directly (no send callable),
      // so this trigger is the authoritative server-side guard: if either
      // participant has blocked the other, delete the message and abort
      // before any notification is computed. This guarantees the victim
      // never receives the blocker's message even if the client bypasses
      // its own (one-directional) block check.
      if (senderId !== 'system') {
        const blocked = await areUsersBlocked(senderId, receiverId);
        if (blocked) {
          logger.warn('Blocked message rejected server-side', {
            messageId: event.params.messageId,
            chatId,
            senderId,
            receiverId,
          });
          await snapshot.ref.delete().catch((err) =>
            logger.error('Failed to delete blocked message', {
              messageId: event.params.messageId,
              error: err,
            })
          );
          return;
        }
      }

      // Get receiver's FCM tokens
      const receiverDoc = await db.collection('users').doc(receiverId).get();
      if (!receiverDoc.exists) {
        console.log(`Receiver user ${receiverId} not found`);
        return;
      }

      const receiverData = receiverDoc.data()!;
      const storedTokens: string[] = receiverData.fcmTokens || [];

      if (storedTokens.length === 0) {
        console.log(`No FCM tokens found for user ${receiverId}`);
        return;
      }

      // Raw APNs tokens (iOS native tokens) are not sendable via FCM and must
      // not be pruned on send failure — partition them out before sending.
      const { fcmTokens, apnsTokens } = partitionTokens(storedTokens);
      if (apnsTokens.length > 0) {
        logger.warn('Skipping raw APNs tokens not sendable via FCM', {
          receiverId,
          skippedCount: apnsTokens.length,
        });
      }
      if (fcmTokens.length === 0) {
        console.log(`No FCM-routable tokens for user ${receiverId}`);
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
