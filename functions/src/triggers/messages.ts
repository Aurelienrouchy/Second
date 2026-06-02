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
      const { chatId, senderId, type, content } = message;
      // `receiverId` from the message is CLIENT-SUPPLIED and falsifiable; it is
      // used ONLY as a notification routing hint below and is RECONCILED against
      // the authoritative chat participant for any security decision.
      let receiverId: string = message.receiverId;

      if (!senderId || !chatId) {
        console.log('Missing required fields for notification');
        return;
      }

      // SECURITY (M2): server-side enforcement of user blocking — authoritative.
      // Messages are created client->Firestore directly (no send callable), so
      // this trigger is the authoritative server-side guard. The previous
      // implementation trusted the client-supplied `receiverId` to decide who
      // could be blocked, letting a blocked sender forge a bogus receiverId
      // (e.g. an unrelated user who has NOT blocked them) and slip a message to
      // the real victim inside a PRE-EXISTING chat. We now derive the real
      // counterparty from the SERVER chat doc and verify the sender is actually
      // a participant. If the sender isn't a participant, or either side has
      // blocked the other, the message is deleted before any notification.
      if (senderId !== 'system') {
        const counterparty = await resolveChatCounterparty(chatId, senderId);

        if (!counterparty) {
          logger.warn('Message in chat with no resolvable counterparty rejected', {
            messageId: event.params.messageId,
            chatId,
            senderId,
            claimedReceiverId: message.receiverId,
          });
          await snapshot.ref.delete().catch((err) =>
            logger.error('Failed to delete illegitimate message', {
              messageId: event.params.messageId,
              error: err,
            })
          );
          return;
        }

        // Always route the notification to the authoritative participant,
        // ignoring any spoofed receiverId.
        receiverId = counterparty;

        const blocked = await areUsersBlocked(senderId, counterparty);
        if (blocked) {
          logger.warn('Blocked message rejected server-side', {
            messageId: event.params.messageId,
            chatId,
            senderId,
            counterparty,
            claimedReceiverId: message.receiverId,
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

      if (!receiverId) {
        console.log('No receiver resolved for notification');
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

      // Build notification based on message type.
      // `notificationType` uses the CLIENT NotificationType contract (see
      // types/index.ts + app/notifications.tsx) so the in-app notification
      // renders with the correct icon and the bell badge increments.
      let title = '';
      let body = '';
      let notificationType: string;
      let amount = 0;

      switch (type) {
        case 'text':
          title = senderName;
          body = articleTitle
            ? `À propos de "${articleTitle}"`
            : content.substring(0, 100);
          notificationType = 'new_message';
          break;

        case 'image':
          title = senderName;
          body = articleTitle
            ? `Photo - "${articleTitle}"`
            : 'Vous a envoyé une photo';
          notificationType = 'new_message';
          break;

        case 'offer':
          amount = message.offer?.amount || 0;
          title = `Nouvelle offre de ${senderName}`;
          body = articleTitle
            ? `${amount} $ pour "${articleTitle}"`
            : `Offre de ${amount} $`;
          notificationType = 'offer_received';
          break;

        case 'system':
          // Don't send notifications for system messages
          return;

        default:
          title = 'Nouveau message';
          body = senderName;
          notificationType = 'new_message';
      }

      // Route through sendPushNotification so transactional message/offer
      // notifications respect the user's notification preferences
      // (preferences.notifications.push) AND create an in-app notification
      // (required for the bell badge / unread count). It also handles raw
      // APNs token skipping and invalid-token pruning internally.
      const result = await sendPushNotification(
        receiverId,
        title,
        body,
        {
          chatId,
          senderId,
          senderName,
          articleTitle: articleTitle || '',
          ...(type === 'offer' ? { amount: String(amount) } : {}),
        },
        notificationType
      );

      logger.info('Message notification processed', {
        messageId: event.params.messageId,
        recipientId: receiverId,
        notificationType,
        success: result.success,
        sentCount: result.sentCount,
      });
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
