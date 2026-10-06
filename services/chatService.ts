import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    increment,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    updateDoc,
    where,
} from 'firebase/firestore';
import type { DocumentData, FieldValue } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { auth, firestore, functions, storage } from '../config/firebaseConfig';
import {
  Chat,
  ChatParticipant,
  Message,
  MessageStatus,
  MessageType,
  MeetupSpot,
  ShippingAddress,
  ShippingEstimate,
} from '../types';
import { ModerationService } from './moderationService';

/** Shape of a new chat document before it is written to Firestore. */
interface NewChatData {
  participants: string[];
  participantsInfo: ChatParticipant[];
  sellerId?: string;
  unreadCount: Record<string, number>;
  createdAt: FieldValue;
  updatedAt: FieldValue;
  articleId?: string;
  articleTitle?: string;
  articleImage?: string;
  articlePrice?: number;
}

/**
 * Recursively remove undefined values from an object.
 * Firestore rejects documents containing undefined fields.
 */
function stripUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        result[key] = stripUndefined(value);
      }
    }
    return result as T;
  }
  return obj;
}

/**
 * Maximum number of recent messages loaded per chat snapshot. Bounds the
 * read so we never pull an entire conversation history at once. Incremental
 * load-more (fetching older messages beyond this window) is not yet wired.
 */
const MESSAGES_WINDOW = 50;

export class ChatService {
  /**
   * Build a deterministic chat ID from a sorted pair of user UIDs,
   * optionally scoped to an article.
   *
   * - With articleId: `${minUid}__${maxUid}__${articleId}` (per-article chat)
   * - Without articleId: `${minUid}__${maxUid}` (general chat from profile)
   *
   * Same inputs → same ID, regardless of who calls or in what order.
   * Eliminates the race where two simultaneous taps create two threads.
   */
  private static chatIdForPair(uid1: string, uid2: string, articleId?: string): string {
    const base = [uid1, uid2].sort().join('__');
    return articleId ? `${base}__${articleId}` : base;
  }

  static async createOrGetChat(
    user1Id: string,
    user2Id: string,
    articleId?: string
  ): Promise<Chat> {
    try {
      // Prevent creating a chat with yourself
      if (user1Id === user2Id) {
        if (__DEV__) console.error('[ChatService] Cannot create chat with same user:', user1Id);
        throw new Error('Impossible de créer une conversation avec vous-même.');
      }

      // Prevent chat creation/access when either user has blocked the other
      const blocked = await ModerationService.areUsersBlocked(user1Id, user2Id);
      if (blocked) {
        throw new Error('Impossible de contacter cet utilisateur');
      }

      const participantIds = [user1Id, user2Id].sort();
      const chatId = this.chatIdForPair(user1Id, user2Id, articleId);
      const chatRef = doc(firestore, 'chats', chatId);

      // Fetch article data up front (needed for both existing-update and
      // new-chat paths).
      let articleTitle: string | undefined;
      let articleImage: string | undefined;
      let articlePrice: number | undefined;
      let articleSellerId: string | undefined;
      if (articleId) {
        const articleDoc = await getDoc(doc(firestore, 'articles', articleId));
        if (articleDoc.exists()) {
          const articleData = articleDoc.data();
          if (articleData) {
            articleTitle = articleData.title;
            articleImage = articleData.images?.[0]?.url;
            articlePrice = articleData.price;
            articleSellerId = articleData.sellerId;
          }
        }
      }

      // Fast path: deterministic-ID lookup. Same pair → same doc, every
      // time. Race-free: two concurrent calls converge on the same docRef
      // and runTransaction below decides who actually creates.
      const existing = await getDoc(chatRef);
      if (existing.exists()) {
        const chatData = existing.data();

        // Return the persisted chat data but overlay the latest article
        // snapshot locally so the caller sees fresh info immediately.
        // Persisting the update is NOT done client-side because Firestore
        // rules restrict chat updates to unreadCount/lastMessage fields.
        // The onArticleInfoUpdated trigger propagates title/image/price
        // changes server-side instead.
        return {
          id: existing.id,
          ...chatData,
          ...(articleTitle !== undefined ? { articleTitle } : {}),
          ...(articleImage !== undefined ? { articleImage } : {}),
          ...(articlePrice !== undefined ? { articlePrice } : {}),
          createdAt: chatData.createdAt?.toDate() || new Date(),
          updatedAt: chatData.updatedAt?.toDate() || new Date(),
          lastMessageTimestamp: chatData.lastMessageTimestamp?.toDate(),
        } as Chat;
      }

      // Legacy path: for general chats (no articleId), this pair may
      // already have ONE OR MORE chats with auto-generated IDs from
      // before the deterministic-ID fix. Return the most recent one.
      // Note: article-scoped chats (with articleId) skip this path
      // because their deterministic ID is different from old-format IDs.
      if (!articleId) {
        const chatsRef = collection(firestore, 'chats');
        const legacySnap = await getDocs(
          query(chatsRef, where('participants', '==', participantIds))
        );
        if (!legacySnap.empty) {
          const sortedLegacy = [...legacySnap.docs].sort((a, b) => {
            const at = a.data().updatedAt?.toMillis?.() ?? 0;
            const bt = b.data().updatedAt?.toMillis?.() ?? 0;
            return bt - at;
          });
          const newest = sortedLegacy[0];
          const newestData = newest.data();
          return {
            id: newest.id,
            ...newestData,
            createdAt: newestData.createdAt?.toDate() || new Date(),
            updatedAt: newestData.updatedAt?.toDate() || new Date(),
            lastMessageTimestamp: newestData.lastMessageTimestamp?.toDate(),
          } as Chat;
        }
      }

      // Brand-new chat path. User lookup, then runTransaction
      // so two concurrent callers can't both win the create.

      // Determine which user is the current (authenticated) user.
      // Security rules restrict user doc reads to isOwner, so we can only
      // read our own doc directly.  For the OTHER user we call the
      // getUserPublicProfile Cloud Function which uses Admin SDK.
      const currentUserId = auth.currentUser?.uid;
      const isUser1Current = currentUserId === user1Id;

      // Current user doc — always readable (isOwner)
      const currentUserDoc = await getDoc(
        doc(firestore, 'users', isUser1Current ? user1Id : user2Id),
      );
      const currentUserData = currentUserDoc.exists() ? currentUserDoc.data() : null;

      // Other user — fetch via callable to bypass security rules
      const otherUserId = isUser1Current ? user2Id : user1Id;
      let otherUserName = 'Utilisateur';
      let otherUserImage: string | undefined;

      try {
        const getUserPublicProfileFn = httpsCallable<
          { userId: string },
          { profile: { displayName: string; profileImage: string | null } }
        >(functions, 'getUserPublicProfile');
        const result = await getUserPublicProfileFn({ userId: otherUserId });
        const profile = result.data.profile;
        otherUserName = profile.displayName || 'Utilisateur';
        otherUserImage = profile.profileImage || undefined;
      } catch (profileError) {
        // Graceful degradation — chat still works, participantsInfo will
        // use the fallback name.  The other user's real name+avatar will
        // appear once their messages trigger a listener update.
        if (__DEV__) console.warn('[ChatService] Could not fetch other user profile via callable:', profileError);
      }

      const pickAvatar = (d: DocumentData | null): string | undefined =>
        d?.profileImage || d?.photoURL || d?.avatarUrl || undefined;

      const currentParticipantInfo: ChatParticipant = {
        userId: isUser1Current ? user1Id : user2Id,
        userName:
          (currentUserData?.displayName || currentUserData?.email || 'Utilisateur') as string,
        ...(pickAvatar(currentUserData) ? { userImage: pickAvatar(currentUserData) } : {}),
      };

      const otherParticipantInfo: ChatParticipant = {
        userId: otherUserId,
        userName: otherUserName,
        ...(otherUserImage ? { userImage: otherUserImage } : {}),
      };

      // Maintain original ordering (user1 first, user2 second)
      const participant1Info: ChatParticipant = isUser1Current
        ? currentParticipantInfo
        : otherParticipantInfo;
      const participant2Info: ChatParticipant = isUser1Current
        ? otherParticipantInfo
        : currentParticipantInfo;

      const newChatData: NewChatData = {
        participants: participantIds,
        participantsInfo: [participant1Info, participant2Info],
        unreadCount: {
          [user1Id]: 0,
          [user2Id]: 0,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // sellerId: the article owner. Critical for the "Ventes" tab filter.
      if (articleSellerId) newChatData.sellerId = articleSellerId;
      if (articleId) newChatData.articleId = articleId;
      if (articleTitle) newChatData.articleTitle = articleTitle;
      if (articleImage) newChatData.articleImage = articleImage;
      if (articlePrice !== undefined) newChatData.articlePrice = articlePrice;

      // Atomic create-if-absent. Two simultaneous callers reach this
      // point → only one wins; the other reads the just-created doc.
      await runTransaction(firestore, async (tx) => {
        const snap = await tx.get(chatRef);
        if (snap.exists()) return;
        tx.set(chatRef, newChatData);
      });

      const created = await getDoc(chatRef);
      const createdData = created.data() as DocumentData | undefined;
      return {
        id: chatId,
        ...(createdData ?? newChatData),
        createdAt: createdData?.createdAt?.toDate?.() || new Date(),
        updatedAt: createdData?.updatedAt?.toDate?.() || new Date(),
        lastMessageTimestamp: createdData?.lastMessageTimestamp?.toDate?.(),
      } as Chat;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors de la création du chat: ${message}`);
    }
  }

  static async sendMessage(
    chatId: string,
    senderId: string,
    receiverId: string,
    content: string
  ): Promise<string> {
    return this.sendMessageWithType(chatId, senderId, receiverId, 'text', content);
  }

  private static async sendMessageWithType(
    chatId: string,
    senderId: string,
    receiverId: string,
    type: MessageType,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    try {
      // Validate that the current Firebase user matches senderId
      const currentUser = auth.currentUser;
      if (!currentUser) {
        if (__DEV__) console.error('[ChatService] No authenticated Firebase user');
        throw new Error('Non authentifié');
      }
      if (currentUser.uid !== senderId) {
        if (__DEV__) console.error('[ChatService] sendMessageWithType auth mismatch - Firebase UID:', currentUser.uid, 'senderId:', senderId);
        throw new Error('Session invalide');
      }

      // Prevent sending messages when either user has blocked the other
      const chatDoc = await getDoc(doc(firestore, 'chats', chatId));
      if (chatDoc.exists()) {
        const chatParticipants = chatDoc.data().participants as string[];
        const otherUserId = chatParticipants.find((id: string) => id !== senderId);
        if (otherUserId) {
          const isBlocked = await ModerationService.areUsersBlocked(senderId, otherUserId);
          if (isBlocked) {
            throw new Error("Impossible d'envoyer un message à cet utilisateur");
          }
        }
      }

      // Sort participants for consistent querying
      const participants = [senderId, receiverId].sort();

      // Strip undefined values from metadata to prevent Firestore rejection
      const cleanMetadata = metadata ? stripUndefined(metadata) : {};

      const messageData = {
        chatId,
        senderId,
        receiverId,
        participants, // Add participants for Firestore rules
        type,
        content,
        timestamp: serverTimestamp(),
        status: 'sent' as MessageStatus,
        isRead: false,
        ...cleanMetadata,
      };

      if (__DEV__) console.log('[ChatService] Creating message with data:', JSON.stringify(messageData, null, 2));

      const messagesRef = collection(firestore, 'messages');
      let docRef;
      try {
        docRef = await addDoc(messagesRef, messageData);
        if (__DEV__) console.log('[ChatService] Message created successfully with ID:', docRef.id);
      } catch (messageError) {
        const errObj = messageError as { code?: string; message?: string };
        if (__DEV__) console.error('[ChatService] Failed to create message:', errObj.code, errObj.message);
        throw new Error(`Erreur création message: ${errObj.code} - ${errObj.message}`);
      }

      // Update chat with last message
      if (__DEV__) console.log('[ChatService] Updating chat:', chatId);
      const chatRef = doc(firestore, 'chats', chatId);

      // SECURITY: atomic increment avoids race condition when multiple messages
      // arrive nearly simultaneously (read+1 pattern would lose updates).
      const updateData: Record<string, unknown> = {
        lastMessage: content || '',
        lastMessageType: type,
        lastMessageTimestamp: serverTimestamp(),
        updatedAt: serverTimestamp(),
        [`unreadCount.${receiverId}`]: increment(1),
      };

      if (__DEV__) console.log('[ChatService] Chat update data:', JSON.stringify(updateData, null, 2));

      try {
        await updateDoc(chatRef, updateData);
        if (__DEV__) console.log('[ChatService] Chat updated successfully');
      } catch (chatError) {
        const errObj = chatError as { code?: string; message?: string };
        if (__DEV__) console.error('[ChatService] Failed to update chat:', errObj.code, errObj.message);
        throw new Error(`Erreur mise à jour chat: ${errObj.code} - ${errObj.message}`);
      }

      return docRef.id;
    } catch (error) {
      if (__DEV__) console.error('[ChatService] sendMessageWithType error:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors de l'envoi du message: ${message}`);
    }
  }

  static async sendImage(
    chatId: string,
    senderId: string,
    receiverId: string,
    imageUri: string
  ): Promise<string> {
    try {
      // Compress and resize image
      const manipulatedImage = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 1024 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );

      // Create thumbnail
      const thumbnail = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 200 } }],
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG }
      );

      // Upload to Firebase Storage using web SDK
      const timestamp = Date.now();
      const imageName = `chat_images/${chatId}/${timestamp}.jpg`;
      const thumbnailName = `chat_images/${chatId}/${timestamp}_thumb.jpg`;

      const imageRef = ref(storage, imageName);
      const thumbnailRef = ref(storage, thumbnailName);

      // Read files as blobs and upload using web SDK
      const [imageResponse, thumbnailResponse] = await Promise.all([
        fetch(manipulatedImage.uri),
        fetch(thumbnail.uri),
      ]);
      const [imageBlob, thumbnailBlob] = await Promise.all([
        imageResponse.blob(),
        thumbnailResponse.blob(),
      ]);
      await Promise.all([
        uploadBytes(imageRef, imageBlob),
        uploadBytes(thumbnailRef, thumbnailBlob),
      ]);

      // Get download URLs
      const [imageUrl, thumbnailUrl] = await Promise.all([
        getDownloadURL(imageRef),
        getDownloadURL(thumbnailRef),
      ]);

      // Send message with image metadata
      return await this.sendMessageWithType(
        chatId,
        senderId,
        receiverId,
        'image',
        'Photo',
        {
          image: {
            url: imageUrl,
            thumbnail: thumbnailUrl,
            width: manipulatedImage.width,
            height: manipulatedImage.height,
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors de l'envoi de l'image: ${message}`);
    }
  }

  static async sendOffer(
    _chatId: string, _senderId: string, _receiverId: string, _amount: number,
    _message?: string, _shippingAddress?: ShippingAddress, _shippingEstimate?: ShippingEstimate
  ): Promise<string> {
    throw new Error('Les offres avec livraison ne sont pas disponibles dans cette phase.');
  }

  static async acceptOffer(chatId: string, messageId: string, _offerId: string, _userId: string): Promise<void> {
    const accept = httpsCallable<{ chatId: string; messageId: string }, { success: boolean; transactionId: string }>(functions, 'acceptMeetupOffer');
    await accept({ chatId, messageId });
  }

  static async rejectOffer(chatId: string, messageId: string, _offerId: string, _userId: string): Promise<void> {
    const reject = httpsCallable(functions, 'rejectMeetupProposal');
    await reject({ chatId, messageId });
  }

  /** All entry points share the same atomic buyer/article replacement policy. */
  static async sendMeetupOffer(
    chatId: string, senderId: string, receiverId: string, amount: number,
    meetupLocation: MeetupSpot, message?: string
  ): Promise<string> {
    if (!auth.currentUser || auth.currentUser.uid !== senderId || !receiverId || receiverId === senderId) {
      throw new Error('Session invalide. Veuillez vous reconnecter.');
    }
    return this.sendMeetupProposal({ chatId, amount, location: stripUndefined(meetupLocation), ...(message ? { message } : {}) });
  }

  private static async sendMeetupProposal(input: Record<string, unknown>): Promise<string> {
    const send = httpsCallable<Record<string, unknown>, { success: boolean; messageId: string }>(functions, 'sendMeetupProposal');
    // A stable id is included in the request so callable retries replay the
    // original result. The server also deduplicates simultaneous equal terms.
    const requestId = doc(collection(firestore, 'messages')).id;
    const result = await send({ ...input, requestId });
    return result.data.messageId;
  }

  static async counterOfferPrice(chatId: string, originalMessageId: string, _userId: string, _receiverId: string, newAmount: number, message?: string): Promise<string> {
    return this.sendMeetupProposal({ chatId, originalMessageId, counterKind: 'price', amount: newAmount, ...(message ? { message } : {}) });
  }

  static async counterOfferLocation(chatId: string, originalMessageId: string, _userId: string, _receiverId: string, newLocation: MeetupSpot, message?: string): Promise<string> {
    return this.sendMeetupProposal({ chatId, originalMessageId, counterKind: 'location', location: stripUndefined(newLocation), ...(message ? { message } : {}) });
  }

  static async counterOfferTime(chatId: string, originalMessageId: string, _userId: string, _receiverId: string, newDateTime: Date, message?: string): Promise<string> {
    return this.sendMeetupProposal({ chatId, originalMessageId, counterKind: 'time', dateTime: newDateTime.toISOString(), ...(message ? { message } : {}) });
  }

  /**
   * Confirmer un meetup (après acceptation de l'offre).
   * Délègue à la callable `confirmMeetupTransaction` (runTransaction) qui, dans
   * une seule transaction atomique : (1) passe la transaction liée de
   * meetup_pending → meetup_confirmed et (2) écrit `offer.meetup.confirmedAt`
   * sur le message. Seul le vendeur (dérivé du doc de transaction côté serveur)
   * peut confirmer.
   *
   * P1-5 / P1-6 : remplace l'ancienne double écriture client non atomique
   * (updateDoc message + updateDoc transaction) qui pouvait diverger si l'une
   * des deux échouait.
   */
  static async confirmMeetup(
    chatId: string,
    messageId: string,
    userId: string
  ): Promise<void> {
    try {
      const messageRef = doc(firestore, 'messages', messageId);
      const messageDoc = await getDoc(messageRef);

      if (!messageDoc.exists()) {
        throw new Error('Message non trouvé');
      }

      const messageData = messageDoc.data();
      const offer = messageData?.offer;

      if (!offer?.meetup) {
        throw new Error('Détails du meetup non trouvés');
      }

      // Résout la transaction meetup_pending pour ce chat (en tant que vendeur :
      // seul le vendeur peut confirmer, et la callable revérifie ce rôle).
      const transactionId = await this.findMeetupTransactionId(chatId, userId, [
        'meetup_pending', 'meetup_confirmed',
      ], messageId);

      if (!transactionId) {
        if (__DEV__) console.warn('[ChatService] confirmMeetup: no meetup_pending transaction found for chatId', chatId);
        throw new Error('Aucune transaction de rencontre à confirmer.');
      }

      // Transition atomique tx + message via la callable server-authoritative.
      const confirmMeetupTransactionFn = httpsCallable<
        { transactionId: string; messageId: string },
        { success: boolean; chatId: string | null }
      >(functions, 'confirmMeetupTransaction');
      await confirmMeetupTransactionFn({ transactionId, messageId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors de la confirmation du meetup: ${message}`);
    }
  }

  /**
   * Résout la transaction meetup liée à ce chat pour le caller (acheteur OU
   * vendeur). Les règles Firestore exigent que chaque doc retourné satisfasse
   * `auth.uid == buyerId || auth.uid == sellerId`, donc on interroge selon le
   * rôle du caller : d'abord en tant qu'acheteur, puis en tant que vendeur.
   * Utilise d'abord le lien exact du message ; le fallback historique vérifie
   * le montant, le lieu et l'éventuel lien avant de proposer un ID au serveur.
   */
  private static async findMeetupTransactionId(
    chatId: string,
    userId: string,
    statuses: string[],
    messageId: string
  ): Promise<string | null> {
    const messageSnap = await getDoc(doc(firestore, 'messages', messageId));
    const message = messageSnap.data();
    if (!message || message.chatId !== chatId || !message.offer?.meetup || message.offer.status !== 'accepted') {
      throw new Error('Cette proposition ne correspond pas à un accord accepté.');
    }
    if (message.offer.transactionId) return message.offer.transactionId;
    const matches = (data: DocumentData) => data.deliveryType === 'meetup' && data.amount === message.offer.amount &&
      data.meetupSpot?.name === message.offer.meetup.location?.name && (!data.offerMessageId || data.offerMessageId === messageId);
    const txCol = collection(firestore, 'transactions');
    // En tant qu'acheteur
    const asBuyer = await getDocs(
      query(
        txCol,
        where('chatId', '==', chatId),
        where('buyerId', '==', userId),
        where('status', 'in', statuses)
      )
    );
    const buyerTransaction = asBuyer.docs.find((snapshot) => matches(snapshot.data()));
    if (buyerTransaction) return buyerTransaction.id;
    // En tant que vendeur
    const asSeller = await getDocs(
      query(
        txCol,
        where('chatId', '==', chatId),
        where('sellerId', '==', userId),
        where('status', 'in', statuses)
      )
    );
    const sellerTransaction = asSeller.docs.find((snapshot) => matches(snapshot.data()));
    if (sellerTransaction) return sellerTransaction.id;
    return null;
  }

  /**
   * Signaler un no-show. Délègue à la Cloud Function `reportMeetupNoShow`
   * (runTransaction) qui gèle la transaction en `disputed` et débloque
   * l'article. Le simple flag cosmétique sur le message ne suffit plus.
   */
  static async reportNoShow(
    chatId: string,
    messageId: string,
    reporterId: string,
    reason?: string,
    details?: string
  ): Promise<void> {
    try {
      const transactionId = await this.findMeetupTransactionId(chatId, reporterId, [
        'meetup_pending',
        'meetup_confirmed',
      ], messageId);

      if (!transactionId) {
        if (__DEV__) {
          console.warn('[ChatService] reportNoShow: no reportable transaction for chatId', chatId);
        }
        throw new Error("Aucune transaction de rencontre à signaler n'a été trouvée.");
      }

      const reportMeetupNoShowFn = httpsCallable(functions, 'reportMeetupNoShow');
      // Pas d'undefined vers la callable : on omet `details` s'il est vide.
      await reportMeetupNoShowFn({
        transactionId,
        ...(reason ? { reason } : {}),
        ...(details && details.trim().length > 0 ? { details: details.trim() } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors du signalement no-show: ${message}`);
    }
  }

  /** Le serveur complète l'accord et son message dans une seule transaction. */
  static async completeMeetup(
    chatId: string,
    messageId: string,
    userId: string
  ): Promise<void> {
    try {
      // Find the transaction linked to this chat FIRST. L'acheteur OU le vendeur
      // peut compléter (les deux étaient présents), donc on résout la
      // transaction selon le rôle du caller. Le backend
      // (`completeMeetupTransaction`) exige le statut `meetup_confirmed`.
      const transactionId = await this.findMeetupTransactionId(chatId, userId, [
        'meetup_confirmed',
      ], messageId);

      if (!transactionId) {
        if (__DEV__) console.warn('[ChatService] completeMeetup: no meetup_confirmed transaction found for chatId', chatId);
        throw new Error('Aucune transaction de rencontre à finaliser.');
      }

      // Appel server-authoritative D'ABORD. En cas d'échec (tx annulée,
      // disputée, statut incompatible…), on propage l'erreur sans toucher au
      // message — le badge « terminée » ne doit jamais précéder le backend.
      const completeMeetupFn = httpsCallable(functions, 'completeMeetupTransaction');
      await completeMeetupFn({ transactionId, messageId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors de la completion du meetup: ${message}`);
    }
  }

  static async getChatById(chatId: string): Promise<Chat> {
    try {
      const chatRef = doc(firestore, 'chats', chatId);
      const chatDoc = await getDoc(chatRef);
      
      if (!chatDoc.exists()) {
        throw new Error('Chat not found');
      }

      const chatData = chatDoc.data();
      if (!chatData) {
        throw new Error('Chat data is undefined');
      }

      return {
        id: chatDoc.id,
        ...chatData,
        createdAt: chatData.createdAt?.toDate() || new Date(),
        updatedAt: chatData.updatedAt?.toDate() || new Date(),
        lastMessageTimestamp: chatData.lastMessageTimestamp?.toDate(),
      } as Chat;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors de la recuperation du chat: ${message}`);
    }
  }

  static listenToMessages(
    chatId: string,
    userId: string,
    onUpdate: (messages: Message[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    // The Firestore read rule requires `request.auth.uid in resource.data.participants`.
    // For query validation, the query MUST include an `array-contains` constraint on
    // `participants` so Firestore can guarantee all returned docs satisfy the rule.
    // Legacy messages without a `participants` field won't appear — but new messages
    // (including system messages) always include it since the fix.
    const messagesRef = collection(firestore, 'messages');
    // Bounded window: load the most recent MESSAGES_WINDOW messages
    // (orderBy timestamp desc + limit), then reverse to ascending order for
    // display. Avoids loading the entire history on every snapshot. Full
    // incremental load-more pagination is tracked separately.
    const q = query(
      messagesRef,
      where('chatId', '==', chatId),
      where('participants', 'array-contains', userId),
      orderBy('timestamp', 'desc'),
      limit(MESSAGES_WINDOW)
    );

    return onSnapshot(
      q,
      (querySnapshot) => {
        const messages: Message[] = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          messages.push({
            id: docSnap.id,
            ...data,
            timestamp: data.timestamp?.toDate() || new Date(),
          } as Message);
        });
        // Query is desc (newest first); reverse to ascending for the UI.
        messages.reverse();
        onUpdate(messages);
      },
      (error) => {
        if (onError) {
          onError(error as Error);
        }
      }
    );
  }

  static listenToChat(
    chatId: string,
    onUpdate: (chat: Chat) => void,
    onError?: (error: Error) => void
  ): () => void {
    const chatRef = doc(firestore, 'chats', chatId);

    return onSnapshot(
      chatRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const chatData = docSnap.data();
          if (chatData) {
            const chat: Chat = {
              id: docSnap.id,
              ...chatData,
              createdAt: chatData.createdAt?.toDate() || new Date(),
              updatedAt: chatData.updatedAt?.toDate() || new Date(),
              lastMessageTimestamp: chatData.lastMessageTimestamp?.toDate(),
            } as Chat;
            onUpdate(chat);
          }
        }
      },
      (error) => {
        if (onError) {
          onError(error as Error);
        }
      }
    );
  }

  static listenToUserChats(
    userId: string,
    onUpdate: (chats: Chat[]) => void,
    onError?: (error: Error) => void
  ): () => void {
      const chatsRef = collection(firestore, 'chats');
      // Sort on `updatedAt`: the only field guaranteed present on every chat
      // (set at creation, before any message exists). Ordering on
      // `lastMessageTimestamp` would drop message-less chats, since Firestore
      // excludes docs missing the orderBy field.
      const q = query(
        chatsRef,
        where('participants', 'array-contains', userId),
      orderBy('updatedAt', 'desc')
      );

    return onSnapshot(
      q,
      (querySnapshot) => {
        const chats: Chat[] = [];
        querySnapshot.forEach((docSnap) => {
          const chatData = docSnap.data();
          if (chatData) {
            const updatedAt = chatData.updatedAt?.toDate() || new Date();
            chats.push({
              id: docSnap.id,
              ...chatData,
              createdAt: chatData.createdAt?.toDate() || new Date(),
              updatedAt,
              // The list is sorted by `updatedAt`, so the displayed timestamp
              // must follow it. Fall back to `updatedAt` when no message has
              // been sent yet, keeping displayed value ↔ sort order coherent.
              lastMessageTimestamp: chatData.lastMessageTimestamp?.toDate() || updatedAt,
            } as Chat);
          }
        });
        onUpdate(chats);
      },
      (error) => {
        if (onError) {
          onError(error as Error);
        }
      }
    );
  }

  static async markMessagesAsRead(chatId: string, userId: string): Promise<void> {
    try {
      const messagesRef = collection(firestore, 'messages');
      const q = query(
        messagesRef,
        where('chatId', '==', chatId),
        where('participants', 'array-contains', userId),
        where('receiverId', '==', userId),
        where('isRead', '==', false)
      );

      const querySnapshot = await getDocs(q);
      const numMarked = querySnapshot.size;
      const updatePromises: Promise<void>[] = [];

      querySnapshot.forEach((docSnap) => {
        // Also flip status → 'read' so the read-receipt state is actually
        // produced. Only these two fields are written; never undefined.
        updatePromises.push(
          updateDoc(doc(firestore, 'messages', docSnap.id), {
            isRead: true,
            status: 'read' as MessageStatus,
          })
        );
      });

      await Promise.all(updatePromises);

      // Decrement the unread counter by the number of messages actually marked
      // read, inside a transaction. A blind `= 0` would clobber any increment(s)
      // from messages that arrived between the read query and this write; the
      // relative decrement (clamped at 0) preserves those concurrent updates.
      if (numMarked > 0) {
        const chatRef = doc(firestore, 'chats', chatId);
        await runTransaction(firestore, async (tx) => {
          const chatSnap = await tx.get(chatRef);
          if (!chatSnap.exists()) return;
          const current = (chatSnap.data()?.unreadCount?.[userId] as number | undefined) ?? 0;
          const next = Math.max(0, current - numMarked);
          tx.update(chatRef, { [`unreadCount.${userId}`]: next });
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors du marquage comme lu: ${message}`);
    }
  }

  static async getUnreadCount(chatId: string, userId: string): Promise<number> {
    try {
      const chatRef = doc(firestore, 'chats', chatId);
      const chatDoc = await getDoc(chatRef);
      if (chatDoc.exists()) {
        const chatData = chatDoc.data();
        return chatData?.unreadCount?.[userId] || 0;
      }
      return 0;
    } catch (error) {
      if (__DEV__) console.error('Erreur lors de la recuperation du count non lu:', error);
      return 0;
    }
  }
}