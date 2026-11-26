/**
 * Chat — Abonnements temps réel Firestore (messages, conversation, liste).
 *
 * Éclaté depuis services/chatService.ts (1554 lignes). `ChatService`
 * reste la façade publique : les appels ChatService.x() sont inchangés.
 */

import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { auth, firestore } from '../../config/firebaseConfig';
import { Chat, Message } from '../../types';
import { MESSAGES_WINDOW } from './internal';

export function listenToMessages(
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


export function listenToChat(
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


export function listenToUserChats(
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


/**
 * Offres encore ACTIVES d'une conversation, quelle que soit leur position dans
 * l'historique.
 *
 * `listenToMessages` ne charge que les 50 derniers messages et il n'existe pas
 * de « charger plus ». Une rencontre convenue puis suivie d'une cinquantaine de
 * messages sortait donc de la fenêtre : sa bulle disparaissait de l'écran, et
 * avec elle « Confirmer le rendez-vous », « Signaler une absence », « Finaliser »
 * et « Annuler la rencontre » — c'est-à-dire TOUTE action sur une transaction
 * bien vivante. La rencontre restait bloquée et l'article invendable jusqu'au
 * balayage automatique, sans qu'aucune des deux parties ne puisse rien y faire.
 *
 * Ce second abonnement épingle ces offres. Il ÉCHOUE EN SILENCE : un index
 * manquant ou une règle qui refuse ne doit jamais faire disparaître la
 * conversation elle-même, qui reste servie par le listener principal.
 */
export function listenToActiveOffers(
  chatId: string,
  userId: string,
  onUpdate: (messages: Message[]) => void
): () => void {
  const messagesRef = collection(firestore, 'messages');
  // `participants array-contains` est requis par la règle de lecture ; l'index
  // composite correspondant est déclaré dans firestore.indexes.json.
  const q = query(
    messagesRef,
    where('participants', 'array-contains', userId),
    where('chatId', '==', chatId),
    where('type', '==', 'offer'),
    where('offer.status', 'in', ['pending', 'accepted'])
  );

  return onSnapshot(
    q,
    (snap) => {
      const messages: Message[] = [];
      snap.forEach((docSnap) => {
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
      // Volontairement silencieux : voir l'en-tête.
      if (__DEV__) console.warn('[ChatService] listenToActiveOffers failed:', error);
      onUpdate([]);
    }
  );
}
