import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    increment,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { auth, firestore, storage } from '../config/firebaseConfig';
import {
  Chat,
  Message,
  MessageStatus,
  MessageType,
  MeetupDetails,
  MeetupSpot,
  OfferHistoryEntry,
  OfferStatus,
} from '../types';

/**
 * Recursively remove undefined values from an object.
 * Firestore rejects documents containing undefined fields.
 */
function stripUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
  if (typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj as Record<string, any>)) {
      if (value !== undefined) {
        result[key] = stripUndefined(value);
      }
    }
    return result as T;
  }
  return obj;
}

export class ChatService {
  static async createOrGetChat(
    user1Id: string,
    user2Id: string,
    articleId?: string
  ): Promise<Chat> {
    try {
      // Prevent creating a chat with yourself
      if (user1Id === user2Id) {
        console.error('[ChatService] Cannot create chat with same user:', user1Id);
        throw new Error('Impossible de créer une conversation avec vous-même.');
      }

      const participantIds = [user1Id, user2Id].sort();
      console.log('[ChatService] createOrGetChat - user1Id:', user1Id, 'user2Id:', user2Id, 'articleId:', articleId);
      console.log('[ChatService] Sorted participants:', participantIds);

      // Check if chat already exists between these two participants.
      // We deduplicate by participants pair only — one thread per user pair,
      // regardless of the article (avoids creating multiple threads for the same user).
      const chatsRef = collection(firestore, 'chats');
      const q = query(
        chatsRef,
        where('participants', '==', participantIds)
      );

      const querySnapshot = await getDocs(q);
      console.log('[ChatService] Existing chat query returned:', querySnapshot.size, 'results');

      if (!querySnapshot.empty) {
        // Pick the most recently updated chat (defensive against existing duplicates)
        const sortedDocs = [...querySnapshot.docs].sort((a, b) => {
          const aTime = a.data().updatedAt?.toMillis?.() ?? 0;
          const bTime = b.data().updatedAt?.toMillis?.() ?? 0;
          return bTime - aTime;
        });
        const chatDoc = sortedDocs[0];
        const chatData = chatDoc.data();
        return {
          id: chatDoc.id,
          ...chatData,
          createdAt: chatData.createdAt?.toDate() || new Date(),
          updatedAt: chatData.updatedAt?.toDate() || new Date(),
          lastMessageTimestamp: chatData.lastMessageTimestamp?.toDate(),
        } as Chat;
      }

      // Get article info if provided
      let articleTitle, articleImage, articlePrice;
      if (articleId) {
        const articleRef = doc(firestore, 'articles', articleId);
        const articleDoc = await getDoc(articleRef);
        if (articleDoc.exists()) {
          const articleData = articleDoc.data();
          if (articleData) {
            articleTitle = articleData.title;
            articleImage = articleData.images?.[0]?.url;
            articlePrice = articleData.price;
          }
        }
      }

      // Get users info
      const user1Ref = doc(firestore, 'users', user1Id);
      const user2Ref = doc(firestore, 'users', user2Id);
      const [user1Doc, user2Doc] = await Promise.all([
        getDoc(user1Ref),
        getDoc(user2Ref),
      ]);

      const user1Data = user1Doc.exists() ? user1Doc.data() : null;
      const user2Data = user2Doc.exists() ? user2Doc.data() : null;

      // Prepare participant info, ensuring no undefined values
      const participant1Info: any = {
        userId: user1Id,
        userName: (user1Data?.displayName || user1Data?.email || 'Utilisateur') as string,
      };
      if (user1Data?.profileImage) {
        participant1Info.userImage = user1Data.profileImage;
      }

      const participant2Info: any = {
        userId: user2Id,
        userName: (user2Data?.displayName || user2Data?.email || 'Utilisateur') as string,
      };
      if (user2Data?.profileImage) {
        participant2Info.userImage = user2Data.profileImage;
      }

      // Create new chat
      console.log('[ChatService] Creating new chat...');
      const now = serverTimestamp();
      const newChatData: any = {
        participants: participantIds,
        participantsInfo: [participant1Info, participant2Info],
        unreadCount: {
          [user1Id]: 0,
          [user2Id]: 0,
        },
        createdAt: now,
        updatedAt: now,
      };

      // Add optional fields only if they exist
      if (articleId) {
        newChatData.articleId = articleId;
      }
      if (articleTitle) {
        newChatData.articleTitle = articleTitle;
      }
      if (articleImage) {
        newChatData.articleImage = articleImage;
      }
      if (articlePrice !== undefined) {
        newChatData.articlePrice = articlePrice;
      }

      console.log('[ChatService] New chat data:', JSON.stringify(newChatData, null, 2));

      let docRef;
      try {
        docRef = await addDoc(chatsRef, newChatData);
        console.log('[ChatService] Chat created successfully with ID:', docRef.id);
      } catch (chatCreateError: any) {
        console.error('[ChatService] Failed to create chat:', chatCreateError.code, chatCreateError.message);
        throw chatCreateError;
      }
      
      return {
        id: docRef.id,
        participants: participantIds,
        participantsInfo: newChatData.participantsInfo,
        articleId: articleId || undefined,
        articleTitle: articleTitle || undefined,
        articleImage: articleImage || undefined,
        articlePrice: articlePrice || undefined,
        lastMessage: undefined,
        lastMessageType: undefined,
        lastMessageTimestamp: undefined,
        unreadCount: newChatData.unreadCount,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Chat;
    } catch (error: any) {
      throw new Error(`Erreur lors de la création du chat: ${error.message}`);
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
    metadata?: any
  ): Promise<string> {
    try {
      // Validate that the current Firebase user matches senderId
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error('[ChatService] No authenticated Firebase user');
        throw new Error('Non authentifié');
      }
      if (currentUser.uid !== senderId) {
        console.error('[ChatService] sendMessageWithType auth mismatch - Firebase UID:', currentUser.uid, 'senderId:', senderId);
        throw new Error('Session invalide');
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

      console.log('[ChatService] Creating message with data:', JSON.stringify(messageData, null, 2));

      const messagesRef = collection(firestore, 'messages');
      let docRef;
      try {
        docRef = await addDoc(messagesRef, messageData);
        console.log('[ChatService] Message created successfully with ID:', docRef.id);
      } catch (messageError: any) {
        console.error('[ChatService] Failed to create message:', messageError.code, messageError.message);
        throw new Error(`Erreur création message: ${messageError.code} - ${messageError.message}`);
      }

      // Update chat with last message
      console.log('[ChatService] Updating chat:', chatId);
      const chatRef = doc(firestore, 'chats', chatId);

      // SECURITY: atomic increment avoids race condition when multiple messages
      // arrive nearly simultaneously (read+1 pattern would lose updates).
      const updateData: any = {
        lastMessage: content || '',
        lastMessageType: type,
        lastMessageTimestamp: serverTimestamp(),
        updatedAt: serverTimestamp(),
        [`unreadCount.${receiverId}`]: increment(1),
      };

      console.log('[ChatService] Chat update data:', JSON.stringify(updateData, null, 2));

      try {
        await updateDoc(chatRef, updateData);
        console.log('[ChatService] Chat updated successfully');
      } catch (chatError: any) {
        console.error('[ChatService] Failed to update chat:', chatError.code, chatError.message);
        throw new Error(`Erreur mise à jour chat: ${chatError.code} - ${chatError.message}`);
      }

      return docRef.id;
    } catch (error: any) {
      console.error('[ChatService] sendMessageWithType error:', error);
      throw new Error(`Erreur lors de l'envoi du message: ${error.message}`);
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
    } catch (error: any) {
      throw new Error(`Erreur lors de l'envoi de l'image: ${error.message}`);
    }
  }

  static async sendOffer(
    chatId: string,
    senderId: string,
    receiverId: string,
    amount: number,
    message?: string,
    shippingAddress?: any,
    shippingEstimate?: any
  ): Promise<string> {
    try {
      const totalAmount = shippingEstimate 
        ? amount + shippingEstimate.amount 
        : amount;
      
      let content = `Offre de ${amount}€`;
      if (shippingEstimate) {
        content += ` + ${shippingEstimate.amount}€ de livraison (${shippingEstimate.carrier})`;
      }
      if (message) {
        content += '\n' + message;
      }
      
      const offerData: any = {
        amount,
        status: 'pending',
        totalAmount,
      };
      
      // Only add optional fields if they exist
      if (message) {
        offerData.message = message;
      }
      if (shippingAddress) {
        offerData.shippingAddress = shippingAddress;
      }
      if (shippingEstimate) {
        offerData.shippingEstimate = shippingEstimate;
      }
      
      return await this.sendMessageWithType(
        chatId,
        senderId,
        receiverId,
        'offer',
        content,
        {
          offer: offerData,
        }
      );
    } catch (error: any) {
      throw new Error(`Erreur lors de l'envoi de l'offre: ${error.message}`);
    }
  }

  static async sendShippingLabel(
    chatId: string,
    labelUrl: string,
    trackingNumber: string,
    trackingUrl?: string
  ): Promise<string> {
    try {
      let content = `📦 Étiquette d'expédition générée\n\n`;
      content += `Numéro de suivi: ${trackingNumber}\n`;
      if (trackingUrl) {
        content += `Lien de suivi: ${trackingUrl}`;
      }

      // Fetch participants from the chat for proper rule/listener inclusion.
      let participants: string[] = [];
      try {
        const chatDoc = await getDoc(doc(firestore, 'chats', chatId));
        if (chatDoc.exists()) {
          participants = (chatDoc.data().participants as string[]) || [];
        }
      } catch (lookupError) {
        console.warn('[ChatService] Could not load chat participants for shipping label:', lookupError);
      }

      const messageData = {
        chatId,
        senderId: 'system',
        receiverId: 'system',
        type: 'system' as const,
        content,
        participants,
        timestamp: serverTimestamp(),
        status: 'sent' as const,
        isRead: true,
        shippingLabel: {
          labelUrl,
          trackingNumber,
          trackingUrl: trackingUrl || '',
        },
      };

      const messagesRef = collection(firestore, 'messages');
      const docRef = await addDoc(messagesRef, messageData);

      return docRef.id;
    } catch (error: any) {
      throw new Error(`Erreur lors de l'envoi de l'étiquette: ${error.message}`);
    }
  }

  static async acceptOffer(
    chatId: string,
    messageId: string,
    offerId: string,
    userId: string
  ): Promise<void> {
    try {
      const messageRef = doc(firestore, 'messages', messageId);
      await updateDoc(messageRef, {
        'offer.status': 'accepted',
      });

      // Send system message
      const messageDoc = await getDoc(messageRef);
      if (messageDoc.exists()) {
        const messageData = messageDoc.data();
        if (messageData?.offer) {
          await this.sendSystemMessage(
            chatId,
            `Offre de ${messageData.offer.amount}€ acceptée 🎉`
          );
        }
      }
    } catch (error: any) {
      throw new Error(`Erreur lors de l'acceptation de l'offre: ${error.message}`);
    }
  }

  static async rejectOffer(
    chatId: string,
    messageId: string,
    offerId: string,
    userId: string
  ): Promise<void> {
    try {
      const messageRef = doc(firestore, 'messages', messageId);
      await updateDoc(messageRef, {
        'offer.status': 'rejected',
      });

      // Send system message
      const messageDoc = await getDoc(messageRef);
      if (messageDoc.exists()) {
        const messageData = messageDoc.data();
        if (messageData?.offer) {
          await this.sendSystemMessage(
            chatId,
            `Offre de ${messageData.offer.amount}$ refusée ❌`
          );
        }
      }
    } catch (error: any) {
      throw new Error(`Erreur lors du refus de l'offre: ${error.message}`);
    }
  }

  // ============================================
  // MEETUP OFFER METHODS
  // ============================================

  /**
   * Envoie une offre avec détails de meetup
   */
  static async sendMeetupOffer(
    chatId: string,
    senderId: string,
    receiverId: string,
    amount: number,
    meetupLocation: MeetupSpot,
    message?: string
  ): Promise<string> {
    try {
      // Validate authentication - ensure Firebase user matches senderId
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié. Veuillez vous reconnecter.');
      }
      if (currentUser.uid !== senderId) {
        console.error('[ChatService] Auth mismatch - Firebase UID:', currentUser.uid, 'senderId:', senderId);
        throw new Error('Session expirée. Veuillez vous reconnecter.');
      }
      if (!receiverId || receiverId === senderId) {
        console.error('[ChatService] Invalid receiverId:', receiverId, 'senderId:', senderId);
        throw new Error('Destinataire invalide.');
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48h

      // Strip undefined values from meetupLocation to avoid Firestore rejection
      const cleanLocation = stripUndefined(meetupLocation);

      const meetupDetails: MeetupDetails = {
        location: cleanLocation,
        proposedBy: 'buyer',
      };

      const historyEntry: OfferHistoryEntry = {
        action: 'created',
        by: senderId,
        timestamp: now,
        newValue: { amount, meetup: meetupDetails },
      };

      // Format readable content for chat display
      let content = `Offre de ${amount}$\n`;
      content += meetupLocation.name;
      if (message) {
        content += `\n${message}`;
      }

      // Build offerData without undefined fields (Firestore rejects undefined)
      const offerData: Record<string, any> = {
        amount,
        status: 'pending' as OfferStatus,
        meetup: stripUndefined(meetupDetails),
        history: [stripUndefined(historyEntry)],
        expiresAt,
        offerId: `offer_${Date.now()}_${senderId}`,
      };
      if (message) {
        offerData.message = message;
      }

      return await this.sendMessageWithType(
        chatId,
        senderId,
        receiverId,
        'offer',
        content,
        { offer: offerData }
      );
    } catch (error: any) {
      throw new Error(`Erreur lors de l'envoi de l'offre meetup: ${error.message}`);
    }
  }

  /**
   * Contre-offre sur le prix
   */
  static async counterOfferPrice(
    chatId: string,
    originalMessageId: string,
    userId: string,
    receiverId: string,
    newAmount: number,
    message?: string
  ): Promise<string> {
    try {
      // Get original offer
      const messageRef = doc(firestore, 'messages', originalMessageId);
      const messageDoc = await getDoc(messageRef);

      if (!messageDoc.exists()) {
        throw new Error('Message original non trouvé');
      }

      const originalData = messageDoc.data();
      const originalOffer = originalData?.offer;

      if (!originalOffer) {
        throw new Error('Offre originale non trouvée');
      }

      // Update original offer status
      await updateDoc(messageRef, {
        'offer.status': 'counter_price',
      });

      // Create new counter-offer with same meetup details
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      const historyEntry: OfferHistoryEntry = {
        action: 'counter_price',
        by: userId,
        timestamp: now,
        previousValue: originalOffer.amount,
        newValue: newAmount,
        message,
      };

      const newHistory = [...(originalOffer.history || []), historyEntry];

      const meetupDetails = originalOffer.meetup;
      const formattedDate = new Date(meetupDetails.dateTime).toLocaleDateString('fr-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      const formattedTime = new Date(meetupDetails.dateTime).toLocaleTimeString('fr-CA', {
        hour: '2-digit',
        minute: '2-digit',
      });

      let content = `🔄 Contre-offre: ${newAmount}$\n`;
      content += `📍 ${meetupDetails.location.name}\n`;
      content += `📅 ${formattedDate} à ${formattedTime}`;
      if (message) {
        content += `\n💬 ${message}`;
      }

      const counterOfferData: Record<string, any> = {
        amount: newAmount,
        status: 'pending' as OfferStatus,
        meetup: stripUndefined(meetupDetails),
        history: stripUndefined(newHistory),
        expiresAt,
        offerId: `offer_${Date.now()}_${userId}`,
        originalOfferId: originalOffer.offerId,
      };
      if (message) {
        counterOfferData.message = message;
      }

      // Send system message about counter-offer
      await this.sendSystemMessage(
        chatId,
        `Contre-offre: ${originalOffer.amount}$ → ${newAmount}$`
      );

      return await this.sendMessageWithType(
        chatId,
        userId,
        receiverId,
        'offer',
        content,
        { offer: counterOfferData }
      );
    } catch (error: any) {
      throw new Error(`Erreur lors de la contre-offre prix: ${error.message}`);
    }
  }

  /**
   * Contre-offre sur le lieu de rencontre
   */
  static async counterOfferLocation(
    chatId: string,
    originalMessageId: string,
    userId: string,
    receiverId: string,
    newLocation: MeetupSpot,
    message?: string
  ): Promise<string> {
    try {
      const messageRef = doc(firestore, 'messages', originalMessageId);
      const messageDoc = await getDoc(messageRef);

      if (!messageDoc.exists()) {
        throw new Error('Message original non trouvé');
      }

      const originalData = messageDoc.data();
      const originalOffer = originalData?.offer;

      if (!originalOffer) {
        throw new Error('Offre originale non trouvée');
      }

      // Update original offer status
      await updateDoc(messageRef, {
        'offer.status': 'counter_location',
      });

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      const historyEntry: OfferHistoryEntry = {
        action: 'counter_location',
        by: userId,
        timestamp: now,
        previousValue: originalOffer.meetup.location,
        newValue: newLocation,
        message,
      };

      const newHistory = [...(originalOffer.history || []), historyEntry];

      const newMeetupDetails: MeetupDetails = {
        ...originalOffer.meetup,
        location: newLocation,
        proposedBy: userId === originalData.senderId ? 'buyer' : 'seller',
      };

      const meetupDateTime = new Date(originalOffer.meetup.dateTime);
      const formattedDate = meetupDateTime.toLocaleDateString('fr-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      const formattedTime = meetupDateTime.toLocaleTimeString('fr-CA', {
        hour: '2-digit',
        minute: '2-digit',
      });

      let content = `📍 Nouveau lieu proposé\n`;
      content += `💰 ${originalOffer.amount}$\n`;
      content += `📍 ${newLocation.name}\n`;
      content += `📅 ${formattedDate} à ${formattedTime}`;
      if (message) {
        content += `\n💬 ${message}`;
      }

      const counterOfferData: Record<string, any> = {
        amount: originalOffer.amount,
        status: 'pending' as OfferStatus,
        meetup: stripUndefined(newMeetupDetails),
        history: stripUndefined(newHistory),
        expiresAt,
        offerId: `offer_${Date.now()}_${userId}`,
        originalOfferId: originalOffer.offerId,
      };
      if (message) {
        counterOfferData.message = message;
      }

      await this.sendSystemMessage(
        chatId,
        `Nouveau lieu proposé: ${newLocation.name}`
      );

      return await this.sendMessageWithType(
        chatId,
        userId,
        receiverId,
        'offer',
        content,
        { offer: counterOfferData }
      );
    } catch (error: any) {
      throw new Error(`Erreur lors de la contre-offre lieu: ${error.message}`);
    }
  }

  /**
   * Contre-offre sur l'horaire
   */
  static async counterOfferTime(
    chatId: string,
    originalMessageId: string,
    userId: string,
    receiverId: string,
    newDateTime: Date,
    message?: string
  ): Promise<string> {
    try {
      const messageRef = doc(firestore, 'messages', originalMessageId);
      const messageDoc = await getDoc(messageRef);

      if (!messageDoc.exists()) {
        throw new Error('Message original non trouvé');
      }

      const originalData = messageDoc.data();
      const originalOffer = originalData?.offer;

      if (!originalOffer) {
        throw new Error('Offre originale non trouvée');
      }

      // Update original offer status
      await updateDoc(messageRef, {
        'offer.status': 'counter_time',
      });

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      const historyEntry: OfferHistoryEntry = {
        action: 'counter_time',
        by: userId,
        timestamp: now,
        previousValue: originalOffer.meetup.dateTime,
        newValue: newDateTime,
        message,
      };

      const newHistory = [...(originalOffer.history || []), historyEntry];

      const newMeetupDetails: MeetupDetails = {
        ...originalOffer.meetup,
        dateTime: newDateTime,
        proposedBy: userId === originalData.senderId ? 'buyer' : 'seller',
      };

      const formattedDate = newDateTime.toLocaleDateString('fr-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      const formattedTime = newDateTime.toLocaleTimeString('fr-CA', {
        hour: '2-digit',
        minute: '2-digit',
      });

      let content = `📅 Nouvel horaire proposé\n`;
      content += `💰 ${originalOffer.amount}$\n`;
      content += `📍 ${originalOffer.meetup.location.name}\n`;
      content += `📅 ${formattedDate} à ${formattedTime}`;
      if (message) {
        content += `\n💬 ${message}`;
      }

      const counterOfferData: Record<string, any> = {
        amount: originalOffer.amount,
        status: 'pending' as OfferStatus,
        meetup: stripUndefined(newMeetupDetails),
        history: stripUndefined(newHistory),
        expiresAt,
        offerId: `offer_${Date.now()}_${userId}`,
        originalOfferId: originalOffer.offerId,
      };
      if (message) {
        counterOfferData.message = message;
      }

      await this.sendSystemMessage(
        chatId,
        `Nouvel horaire proposé: ${formattedDate} à ${formattedTime}`
      );

      return await this.sendMessageWithType(
        chatId,
        userId,
        receiverId,
        'offer',
        content,
        { offer: counterOfferData }
      );
    } catch (error: any) {
      throw new Error(`Erreur lors de la contre-offre horaire: ${error.message}`);
    }
  }

  /**
   * Confirmer un meetup (après acceptation de l'offre)
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

      await updateDoc(messageRef, {
        'offer.meetup.confirmedAt': new Date(),
      });

      const meetupDateTime = new Date(offer.meetup.dateTime);
      const formattedDate = meetupDateTime.toLocaleDateString('fr-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      const formattedTime = meetupDateTime.toLocaleTimeString('fr-CA', {
        hour: '2-digit',
        minute: '2-digit',
      });

      await this.sendSystemMessage(
        chatId,
        `✅ Meetup confirmé!\n📍 ${offer.meetup.location.name}\n📅 ${formattedDate} à ${formattedTime}`
      );
    } catch (error: any) {
      throw new Error(`Erreur lors de la confirmation du meetup: ${error.message}`);
    }
  }

  /**
   * Signaler un no-show
   */
  static async reportNoShow(
    chatId: string,
    messageId: string,
    reporterId: string,
    reason?: string
  ): Promise<void> {
    try {
      const messageRef = doc(firestore, 'messages', messageId);
      await updateDoc(messageRef, {
        'offer.meetup.noShow': {
          reportedBy: reporterId,
          reportedAt: new Date(),
          reason: reason || '',
        },
      });

      await this.sendSystemMessage(
        chatId,
        `⚠️ No-show signalé. Notre équipe va examiner la situation.`
      );
    } catch (error: any) {
      throw new Error(`Erreur lors du signalement no-show: ${error.message}`);
    }
  }

  /**
   * Marquer un meetup comme complété
   */
  static async completeMeetup(
    chatId: string,
    messageId: string,
    userId: string
  ): Promise<void> {
    try {
      const messageRef = doc(firestore, 'messages', messageId);
      await updateDoc(messageRef, {
        'offer.meetup.completedAt': new Date(),
        'offer.status': 'accepted',
      });

      await this.sendSystemMessage(
        chatId,
        `🎉 Transaction complétée avec succès! Merci d'utiliser Freepe.`
      );
    } catch (error: any) {
      throw new Error(`Erreur lors de la complétion du meetup: ${error.message}`);
    }
  }

  static async sendSystemMessage(chatId: string, content: string): Promise<string> {
    try {
      // Fetch participants from the chat so the message is included in
      // listeners/rules that filter by `participants`.
      let participants: string[] = [];
      try {
        const chatDoc = await getDoc(doc(firestore, 'chats', chatId));
        if (chatDoc.exists()) {
          participants = (chatDoc.data().participants as string[]) || [];
        }
      } catch (lookupError) {
        console.warn('[ChatService] Could not load chat participants for system message:', lookupError);
      }

      const messageData = {
        chatId,
        senderId: 'system',
        receiverId: 'system',
        type: 'system' as MessageType,
        content,
        participants,
        timestamp: serverTimestamp(),
        status: 'sent' as MessageStatus,
        isRead: true,
      };

      const messagesRef = collection(firestore, 'messages');
      const docRef = await addDoc(messagesRef, messageData);

      return docRef.id;
    } catch (error: any) {
      throw new Error(`Erreur lors de l'envoi du message système: ${error.message}`);
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
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération du chat: ${error.message}`);
    }
  }

  static listenToMessages(
    chatId: string,
    _userId: string,
    onUpdate: (messages: Message[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    // Filter only by chatId — including legacy messages and system messages
    // (which don't have a `participants` field). Authorization is enforced by
    // Firestore rules on the `chats` document containing the user.
    const messagesRef = collection(firestore, 'messages');
    const q = query(
      messagesRef,
      where('chatId', '==', chatId),
      orderBy('timestamp', 'asc')
    );

    return onSnapshot(
      q,
      (querySnapshot) => {
      const messages: Message[] = [];
        querySnapshot.forEach((docSnap: any) => {
          const data = docSnap.data();
        messages.push({
          id: docSnap.id,
            ...data,
            timestamp: data.timestamp?.toDate() || new Date(),
        } as Message);
      });
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
      const q = query(
        chatsRef,
        where('participants', 'array-contains', userId),
      orderBy('updatedAt', 'desc')
      );

    return onSnapshot(
      q,
      (querySnapshot) => {
      const chats: Chat[] = [];
        querySnapshot.forEach((docSnap: any) => {
        const chatData = docSnap.data();
          if (chatData) {
        chats.push({
          id: docSnap.id,
          ...chatData,
              createdAt: chatData.createdAt?.toDate() || new Date(),
              updatedAt: chatData.updatedAt?.toDate() || new Date(),
          lastMessageTimestamp: chatData.lastMessageTimestamp?.toDate(),
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
      const updatePromises: Promise<void>[] = [];

      querySnapshot.forEach((docSnap: any) => {
        updatePromises.push(
          updateDoc(doc(firestore, 'messages', docSnap.id), {
            isRead: true,
            status: 'read',
          })
        );
      });

      await Promise.all(updatePromises);

      // Reset unread count
      const chatRef = doc(firestore, 'chats', chatId);
      await updateDoc(chatRef, {
        [`unreadCount.${userId}`]: 0,
      });
    } catch (error: any) {
      throw new Error(`Erreur lors du marquage comme lu: ${error.message}`);
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
    } catch (error: any) {
      console.error('Erreur lors de la récupération du count non lu:', error);
      return 0;
    }
  }
}