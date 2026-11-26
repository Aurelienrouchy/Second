/**
 * Chat — Primitives internes du chat : écriture de message, message système, résolution de la transaction meetup.
 *
 * Éclaté depuis services/chatService.ts (1554 lignes). `ChatService`
 * reste la façade publique : les appels ChatService.x() sont inchangés.
 */

import { addDoc, collection, doc, getDoc, getDocs, increment, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { auth, firestore, functions } from '../../config/firebaseConfig';
import { Chat, Message, MessageStatus, MessageType } from '../../types';
import { ModerationService } from '../moderationService';
import { CHAT_PREVIEW_MAX_LENGTH, stripUndefined } from './internal';
import { assertTradeSessionCurrent, captureTradeSession, isTradeSessionCurrent } from '../tradeOperation';

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

export function chatIdForPair(uid1: string, uid2: string, articleId?: string): string {
  const base = [uid1, uid2].sort().join('__');
  return articleId ? `${base}__${articleId}` : base;
}


export async function sendMessageWithType(
  chatId: string,
  senderId: string,
  receiverId: string,
  type: MessageType,
  content: string,
  metadata?: Record<string, unknown>,
  assertContext: () => void = () => undefined
): Promise<string> {
  try {
    const session = captureTradeSession(senderId);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    assertCurrent();
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
    assertCurrent();
    if (chatDoc.exists()) {
      const chatParticipants = chatDoc.data().participants as string[];
      const otherUserId = chatParticipants.find((id: string) => id !== senderId);
      if (otherUserId) {
        const isBlocked = await ModerationService.areUsersBlocked(senderId, otherUserId);
        assertCurrent();
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
      assertCurrent();
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
    // The message can already be committed when its screen/session changes.
    // Keep that native result; do not dispatch a later preview from an old actor.
    if (!isTradeSessionCurrent(session)) return docRef.id;
    try {assertContext();} catch {return docRef.id;}

    // SECURITY: atomic increment avoids race condition when multiple messages
    // arrive nearly simultaneously (read+1 pattern would lose updates).
    // L'aperçu est TRONQUÉ. Il s'affiche sur une seule ligne dans la liste des
    // conversations, et son contenu n'est lu nulle part ailleurs. Surtout, le
    // contenu d'une offre est CONSTRUIT par le code (« Nouveau lieu proposé\n…
    // »), et les champs de contre-offre n'ont aucun plafond de saisie : un
    // message collé pouvait produire un aperçu de plusieurs milliers de
    // caractères, écrit tel quel dans un document que les deux parties lisent en
    // permanence.
    const updateData: Record<string, unknown> = {
      lastMessage: (content || '').slice(0, CHAT_PREVIEW_MAX_LENGTH),
      lastMessageType: type,
      lastMessageTimestamp: serverTimestamp(),
      updatedAt: serverTimestamp(),
      [`unreadCount.${receiverId}`]: increment(1),
    };
    if (chatDoc.data()?.contentPreviewRestricted === true) {
      delete updateData.lastMessage;delete updateData.lastMessageType;
    }

    if (__DEV__) console.log('[ChatService] Chat update data:', JSON.stringify(updateData, null, 2));

    // Le message EST créé à ce stade. L'échec de la mise à jour du fil —
    // aperçu, horodatage, compteur de non-lus — ne doit donc PAS faire échouer
    // l'envoi : la levée marquait la bulle « échec » alors que le message est
    // bel et bien parti et visible chez le destinataire. L'utilisateur le
    // renvoyait, créant un doublon réel.
    //
    // Les deux écritures ne peuvent pas être rendues atomiques ici : les règles
    // Firestore exigent que le message soit créé par le client, et une
    // transaction cliente ne peut pas porter la vérification de blocage qui
    // conditionne la seconde. Le dommage résiduel est borné et rattrapable — la
    // conversation ne remonte pas dans la liste et la pastille ne s'incrémente
    // pas jusqu'au message suivant — là où la levée, elle, induisait
    // l'utilisateur en erreur.
    try {
      await updateDoc(chatRef, updateData);
      if (__DEV__) console.log('[ChatService] Chat updated successfully');
    } catch (chatError) {
      const errObj = chatError as { code?: string; message?: string };
      // The message already exists. A newly applied content restriction may
      // reject its late preview atomically; never resend the message/body.
      if (errObj.code === 'permission-denied' || errObj.code === 'firestore/permission-denied') {
        try {assertCurrent();await updateDoc(chatRef,{[`unreadCount.${receiverId}`]:increment(1)});}
        catch {/* The server message trigger can repair its fixed preview. */}
      }
      if (__DEV__) {
        console.warn(
          '[ChatService] Message sent but chat preview not updated:',
          errObj.code,
          errObj.message,
        );
      }
    }

    return docRef.id;
  } catch (error) {
    if (__DEV__) console.error('[ChatService] sendMessageWithType error:', error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Erreur lors de l'envoi du message: ${message}`);
  }
}


/**
 * Types de messages système que le client peut demander. Le TEXTE est rendu par
 * le serveur : les règles Firestore n'autorisent plus la création cliente d'un
 * message `senderId: 'system'`, un participant pouvant sinon forger un message
 * de la plateforme au contenu arbitraire — indiscernable d'une confirmation
 * officielle sur un échange comptant sans séquestre.
 */
export type SystemMessageKind =
  | 'offer_accepted'
  | 'offer_rejected'
  | 'counter_price'
  | 'counter_location'
  | 'counter_time'
  | 'meetup_confirmed'
  | 'no_show_reported'
  | 'meetup_completed'
  | 'meetup_cancelled';

export async function sendSystemMessage(
  chatId: string,
  kind: SystemMessageKind,
  params?: Record<string, string | number>
): Promise<string> {
  try {
    const postFn = httpsCallable<
      { chatId: string; kind: SystemMessageKind; params?: Record<string, string | number> },
      { success: boolean; messageId: string }
    >(functions, 'postChatSystemMessage');
    const res = await postFn({ chatId, kind, ...(params ? { params } : {}) });
    return res.data.messageId;
  } catch (error) {
    if (__DEV__) console.error('[ChatService] sendSystemMessage failed:', error);
    // Un message d'information ne doit jamais faire échouer l'action métier qui
    // vient de réussir côté serveur.
    return '';
  }
}


/**
 * Résout la transaction meetup liée à ce chat pour le caller (acheteur OU
 * vendeur). Les règles Firestore exigent que chaque doc retourné satisfasse
 * `auth.uid == buyerId || auth.uid == sellerId`, donc on interroge selon le
 * rôle du caller : d'abord en tant qu'acheteur, puis en tant que vendeur.
 * Renvoie l'ID de la première transaction trouvée dans un des statuts donnés.
 */

export async function findMeetupTransactionId(
  chatId: string,
  userId: string,
  statuses: string[]
): Promise<string | null> {
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
  if (!asBuyer.empty) {
    return asBuyer.docs[0].id;
  }
  // En tant que vendeur
  const asSeller = await getDocs(
    query(
      txCol,
      where('chatId', '==', chatId),
      where('sellerId', '==', userId),
      where('status', 'in', statuses)
    )
  );
  if (!asSeller.empty) {
    return asSeller.docs[0].id;
  }
  return null;
}

/**
 * Signaler un no-show. Délègue à la Cloud Function `reportMeetupNoShow`
 * (runTransaction) qui gèle la transaction en `disputed` et débloque
 * l'article. Le simple flag cosmétique sur le message ne suffit plus.
 */
