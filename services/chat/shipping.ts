/**
 * Chat — Étiquette d'expédition postée dans le fil.
 *
 * Éclaté depuis services/chatService.ts (1554 lignes). `ChatService`
 * reste la façade publique : les appels ChatService.x() sont inchangés.
 */

import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { firestore } from '../../config/firebaseConfig';
import { Chat } from '../../types';

export async function sendShippingLabel(
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
      if (__DEV__) console.warn('[ChatService] Could not load chat participants for shipping label:', lookupError);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Erreur lors de l'envoi de l'étiquette: ${message}`);
  }
}
