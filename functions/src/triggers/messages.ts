/**
 * Message Firestore triggers
 * Firebase Functions v7 - using onDocumentCreated/onDocumentUpdated
 */
import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { prepareOperationalNotices, readOperationalNoticeReceipt, type OperationalNoticeInput } from '../utils/notifications';
import { hasBlockedUser } from '../utils/meetupOffers';
import { Timestamp } from 'firebase-admin/firestore';

/** The event is an invitation to inspect stored source, never payment proof.
 * Read/dismissal and push delivery are separate from the native in-app commit. */
async function commitMessageNotice(messageRef: FirebaseFirestore.DocumentReference,
  source: FirebaseFirestore.DocumentData, input: OperationalNoticeInput, phase: 'created' | 'response',
  sourceTime: Timestamp, legacyInput?: OperationalNoticeInput | null) {
  return db.runTransaction(async tx => {
    if (legacyInput && await readOperationalNoticeReceipt(tx, legacyInput)) return true;
    if (await readOperationalNoticeReceipt(tx, input)) return true;
    const currentSnap = await tx.get(messageRef), current = currentSnap.data();
    if (!current || current.chatId !== source.chatId || current.senderId !== source.senderId || current.type !== source.type) return false;
    if (phase === 'created' && !currentSnap.createTime?.isEqual(sourceTime)) return false;
    const chat = (await tx.get(db.collection('chats').doc(source.chatId))).data();
    const participants = chat?.participants;
    if (!Array.isArray(participants) || participants.length !== 2 || new Set(participants).size !== 2 ||
        participants.some(uid => typeof uid !== 'string' || !uid || uid.includes('/')) ||
        !participants.includes(source.senderId) || (phase === 'created' && !participants.includes(input.userId))) return false;
    const counterparty = participants.find(uid => uid !== source.senderId);
    if (typeof counterparty !== 'string' || !counterparty ||
        (phase === 'created' ? input.userId !== counterparty : input.userId !== source.senderId)) return false;
    const [sender, receiver] = await Promise.all(participants.map(uid => tx.get(db.collection('users').doc(uid))));
    if (hasBlockedUser(sender.data(), participants[1]) || hasBlockedUser(receiver.data(), participants[0])) return false;
    if (source.type === 'offer') {
      if (!current.offer || current.offer.amount !== source.offer?.amount ||
          !(typeof current.offer.amount === 'number' && Number.isFinite(current.offer.amount) && current.offer.amount > 0)) return false;
      if (phase === 'response') {
        const status = source.offer?.status;
        const stamp = status === 'accepted' ? current.offer.acceptedAt : current.offer.respondedAt;
        // Statuses are server-owned; its native transition time must be the
        // captured event's time. A later response cannot become this event.
        if (!(stamp instanceof Timestamp) || !stamp.isEqual(sourceTime) ||
            (status === 'accepted' ? !['accepted', 'completed'].includes(current.offer.status) : current.offer.status !== status)) return false;
        if (status === 'accepted' && current.offer.meetup) {
          const linkedId = current.offer.transactionId;
          if (typeof linkedId !== 'string' || !linkedId || linkedId.includes('/')) return false;
          const order = (await tx.get(db.collection('transactions').doc(linkedId))).data();
          if (!order || order.deliveryType !== 'meetup' || order.chatId !== source.chatId ||
              order.offerMessageId !== messageRef.id || order.amount !== current.offer.amount ||
              !participants.includes(order.buyerId) || !participants.includes(order.sellerId) || order.buyerId === order.sellerId) return false;
        }
        if (status.startsWith('counter_')) {
          const replacementId = current.offer.replacedByMessageId;
          if (typeof replacementId !== 'string' || !replacementId || replacementId.includes('/')) return false;
          const replacement = (await tx.get(db.collection('messages').doc(replacementId))).data();
          if (!replacement || replacement.type !== 'offer' || replacement.chatId !== source.chatId ||
              replacement.senderId !== counterparty || replacement.receiverId !== source.senderId ||
              replacement.offer?.originalOfferId !== (current.offer.offerId ?? messageRef.id)) return false;
        }
      }
    } else if (phase === 'created' && source.type === 'text' && current.content !== source.content) return false;
    else if (phase === 'created' && source.type === 'image' && JSON.stringify(current.image ?? null) !== JSON.stringify(source.image ?? null)) return false;
    const notices = await prepareOperationalNotices(tx, [input]);
    if (source.type === 'offer') {
      // The notice receipt and the counter increment commit together. Redelivery
      // returns above before either; no client/producer updates the same count.
      const unread = chat?.unreadCount && typeof chat.unreadCount === 'object' && !Array.isArray(chat.unreadCount) ? chat.unreadCount : {};
      const count = Number.isSafeInteger(unread[input.userId]) && unread[input.userId] >= 0 ? unread[input.userId] : 0;
      const previousTime = chat?.lastMessageTimestamp;
      const latest = !(previousTime instanceof Timestamp) || previousTime.toMillis() <= sourceTime.toMillis();
      tx.update(db.collection('chats').doc(source.chatId), { unreadCount: { ...unread, [input.userId]: count + 1 },
        ...(latest ? { lastMessage: phase === 'created' ? `Proposition de ${current.offer.amount} $` :
          source.offer?.status === 'accepted' ? 'Proposition acceptée' : source.offer?.status === 'rejected' ? 'Proposition refusée' : 'Nouvelle contre-offre',
          lastMessageType: 'offer', lastMessageTimestamp: sourceTime, updatedAt: sourceTime } : {}) });
    }
    // A delayed client preview must not reintroduce content hidden by an
    // operator. Guarded chats receive only a fixed server preview here.
    if (phase === 'created' && chat?.contentPreviewRestricted === true && ['text','image'].includes(current.type) &&
        current.contentModeration?.state !== 'hidden') tx.update(db.collection('chats').doc(source.chatId), {
      lastMessage:'Nouveau message',lastMessageType:current.type,lastMessageTimestamp:sourceTime,
    });
    notices.commit();
    return true;
  });
}

function nativeNoticeTime(value: unknown): value is Timestamp {
  return value instanceof Timestamp && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds);
}

/** One frozen payload for first commit and redelivery qualification. Candidate
 * recipient IDs only locate native receipts; they never authorize a new notice. */
function creationNoticeInput(snapshot: FirebaseFirestore.QueryDocumentSnapshot, recipientId: string, legacy = false): OperationalNoticeInput | null {
  const message = snapshot.data(), { chatId, senderId, type, content } = message;
  const createdAt = snapshot.createTime;
  if (!nativeNoticeTime(createdAt)) throw new Error('Message notice native creation time unavailable');
  if (type === 'system' || (type === 'offer' && message.offer?.originalOfferId)) return null;
  const senderName = 'Un participant';
  const amount = type === 'offer' ? message.offer?.amount || 0 : 0;
  const title = type === 'image' ? senderName : type === 'offer' ? 'Nouvelle proposition' : 'Nouveau message';
  const body = !legacy && ['text', 'image'].includes(type) ? 'Un membre vous a envoyé un message.' : type === 'text'
    ? typeof content === 'string' && content ? content.substring(0, 100) : 'Un participant vous a envoyé un message.'
    : type === 'image' ? 'Un participant vous a envoyé une photo.'
      : type === 'offer' ? `Une proposition de ${amount} $ est disponible dans votre conversation. Aucun paiement n’a été encaissé par cette proposition.`
        : senderName;
  return { eventKey: `${!legacy && ['text', 'image'].includes(type) ? 'message_notice_v2' : 'message'}:${snapshot.id}:created:${createdAt.seconds}:${createdAt.nanoseconds}`,
    userId: recipientId, title, message: body, type: type === 'offer' ? 'offer_received' : 'new_message',
    data: { ownerId: recipientId, chatId, senderId, senderName, ...(type === 'offer' ? { amount: String(amount) } : {}),
      ...(!legacy && ['text', 'image'].includes(type) ? {noticeSource: 'chat_message_v2', messageId: snapshot.id} : {}) } };
}

/** Delayed redelivery must not delete a new document reusing this ID or a
 * server-owned offer that may already form part of an agreement. */
async function neutralizeClientMessage(snapshot: FirebaseFirestore.QueryDocumentSnapshot, resolvedInput?: OperationalNoticeInput) {
  const original = snapshot.data();
  if (!['text', 'image'].includes(original.type)) return;
  await db.runTransaction(async tx => {
    // Read the exact native creation receipt BEFORE any destructive write.
    // Its event key contains message ID + server createTime; its payload binds
    // the sender, conversation and actual recipient. No notification is read,
    // re-created, or required: its owner may have dismissed it independently.
    const candidateIds = new Set<string>();
    if (resolvedInput) candidateIds.add(resolvedInput.userId);
    if (Array.isArray(original.participants) && original.participants.length === 2 &&
        new Set(original.participants).size === 2 && original.participants.includes(original.senderId)) {
      const other = original.participants.find(uid => uid !== original.senderId);
      if (typeof other === 'string') candidateIds.add(other);
    }
    if (typeof original.receiverId === 'string' && original.receiverId !== original.senderId) candidateIds.add(original.receiverId);
    for (const candidateId of candidateIds) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(candidateId)) continue;
      const legacy = creationNoticeInput(snapshot, candidateId, true);
      if (legacy && await readOperationalNoticeReceipt(tx, legacy)) return;
      const input = creationNoticeInput(snapshot, candidateId);
      if (input && await readOperationalNoticeReceipt(tx, input)) return;
    }
    const current = await tx.get(snapshot.ref);
    if (!current.exists || !current.createTime?.isEqual(snapshot.createTime) ||
        current.data()?.chatId !== original.chatId || current.data()?.senderId !== original.senderId ||
        current.data()?.type !== original.type) return;
    const chat = (await tx.get(db.collection('chats').doc(original.chatId))).data();
    const participants = chat?.participants;
    let reject = !Array.isArray(participants) || participants.length !== 2 || !participants.includes(original.senderId);
    if (!reject) {
      const other = participants.find((uid: unknown) => uid !== original.senderId);
      if (typeof other !== 'string' || !other || other.includes('/')) reject = true;
      else {
        const [sender, receiver] = await Promise.all([tx.get(db.collection('users').doc(original.senderId)),
          tx.get(db.collection('users').doc(other))]);
        reject = hasBlockedUser(sender.data(), other) || hasBlockedUser(receiver.data(), original.senderId);
      }
    }
    if (reject) tx.delete(snapshot.ref);
  });
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
  { document: 'messages/{messageId}', region: 'northamerica-northeast1', memory: '512MiB', retry: true },
  async (event) => {
    try {
      const snapshot = event.data;
      if (!snapshot) return;

      const message = snapshot.data();
      const { chatId, senderId } = message;
      // `receiverId` from the message is CLIENT-SUPPLIED and falsifiable; it is
      // used ONLY as a notification routing hint below and is RECONCILED against
      // the authoritative chat participant for any security decision.
      let receiverId: string = message.receiverId;

      if (typeof senderId !== 'string' || !senderId || senderId.includes('/') ||
          typeof chatId !== 'string' || !chatId || chatId.includes('/')) {
        logger.warn('Missing required fields for notification', { messageId: event.params.messageId });
        return;
      }

      // The chat determines the recipient; blocking is rechecked inside the
      // native commit transaction AFTER its own prior receipt. Late redelivery
      // must preserve an already received message even if this pair is now blocked.
      if (senderId !== 'system') {
        const counterparty = await resolveChatCounterparty(chatId, senderId);

        if (!counterparty) {
          logger.warn('Message in chat with no resolvable counterparty rejected', {
            messageId: event.params.messageId,
            chatId,
            senderId,
            claimedReceiverId: message.receiverId,
          });
          await neutralizeClientMessage(snapshot);
          return;
        }

        // Always route the notification to the authoritative participant,
        // ignoring any spoofed receiverId.
        receiverId = counterparty;
      }

      if (!receiverId) {
        logger.warn('No receiver resolved for notification', { messageId: event.params.messageId });
        return;
      }

      const input = creationNoticeInput(snapshot, receiverId);
      // System messages have their producer's own notice; counter-offers have
      // the response trigger's own event. Neither is duplicated here.
      if (!input) return;

      // Persist once; the existing worker applies optional push preferences
      // and retries transport independently of the stored in-app history.
      const createdAt = snapshot.createTime;
      if (!nativeNoticeTime(createdAt)) throw new Error('Message notice native creation time unavailable');
      const committed = await commitMessageNotice(snapshot.ref, message, input, 'created', createdAt,
        creationNoticeInput(snapshot, receiverId, true));
      if (!committed) await neutralizeClientMessage(snapshot, input);

      logger.info('Message notification processed', {
        messageId: event.params.messageId,
        recipientId: receiverId,
        notificationType: input.type,
        notificationCommitted: committed,
      });
    } catch (error) {
      logger.error('Error committing message notification', { messageId: event.params.messageId, error });
      throw error;
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
  { document: 'messages/{messageId}', region: 'northamerica-northeast1', memory: '512MiB', retry: true },
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

      const { chatId, senderId } = after;
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

      if (typeof senderId !== 'string' || !senderId || senderId.includes('/') ||
          typeof chatId !== 'string' || !chatId || chatId.includes('/')) {
        logger.warn('Missing required fields for offer status notification', {
          senderId,
          chatId,
          offerStatus,
        });
        return;
      }

      // Ce chemin n'avait AUCUN contrôle de blocage. Le filet anti-blocage vit
      // dans `sendMessageNotification`, qui ne se déclenche qu'à la CRÉATION
      // d'un message ; répondre à une offre est une MISE À JOUR. Une personne
      // bloquée pouvait donc faire sonner le téléphone de celle qui l'a
      // bloquée, autant de fois qu'il y a d'offres en attente dans le fil.
      //
      // On revalide sur le document de CONVERSATION, seule source de vérité,
      // et jamais sur les champs figés du message : `senderId` / `receiverId`
      // datent de la création de l'offre et, dès que la vendeuse a émis une
      // contre-offre, ne désignent plus les rôles qu'on croit. C'est
      // exactement la divergence de dérivation acheteur/vendeur de ce dépôt.
      const counterparty = await resolveChatCounterparty(chatId, senderId);
      if (!counterparty) {
        logger.warn('Offer status notification skipped: offer author is not a chat participant', {
          messageId: event.params.messageId,
          chatId,
          senderId,
        });
        return;
      }

      const sellerName = 'L’autre participant';

      // Build notification based on status
      let title: string;
      let body: string;
      let notificationType: string;

      switch (offerStatus) {
        case 'accepted':
          title = 'Proposition acceptée';
          body = `${sellerName} a accepté votre proposition de ${amount} $. Cela ne prouve aucun encaissement ou remise physique.`;
          notificationType = 'offer_accepted';
          break;

        case 'rejected':
          title = 'Offre refusée';
          body = `${sellerName} a décliné votre proposition`;
          notificationType = 'offer_rejected';
          break;

        case 'counter_price':
          title = 'Nouvelle contre-offre';
          body = `${sellerName} vous propose un nouveau prix`;
          notificationType = 'offer_counter';
          break;

        case 'counter_location':
          title = 'Nouveau lieu proposé';
          body = `${sellerName} propose un autre lieu de rencontre`;
          notificationType = 'offer_counter';
          break;

        case 'counter_time':
          title = 'Nouvel horaire proposé';
          body = `${sellerName} propose un autre horaire`;
          notificationType = 'offer_counter';
          break;

        default:
          return;
      }

      // Bind the response to its native transition, then let the worker handle
      // optional transport. The original sender can be buyer or seller.
      const transitionTime = offerStatus === 'accepted' ? after.offer.acceptedAt : after.offer.respondedAt;
      if (!nativeNoticeTime(transitionTime)) {
        logger.warn('Historical offer response lacks a native transition witness', { messageId: event.params.messageId, offerStatus });
        return;
      }
      const committed = await commitMessageNotice(event.data!.after.ref, after, {
        eventKey: `message:${event.params.messageId}:response:${offerStatus}:${transitionTime.seconds}:${transitionTime.nanoseconds}`,
        userId: senderId, type: notificationType, title, message: body, data: {
          ownerId: senderId,
          chatId,
          senderId: counterparty,
          senderName: sellerName,
          amount: String(amount || ''),
          offerStatus,
        },
      }, 'response', transitionTime);

      logger.info('Offer status notification sent', {
        messageId: event.params.messageId,
        recipientId: senderId,
        offerStatus,
        notificationType,
        notificationCommitted: committed,
      });
    } catch (error) {
      logger.error('Error sending offer status notification', { error });
      throw error;
    }
  }
);
