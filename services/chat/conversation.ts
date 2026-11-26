/**
 * Chat — Cycle de vie d'une conversation : création/récupération, lecture, compteur non-lus.
 *
 * Éclaté depuis services/chatService.ts (1554 lignes). `ChatService`
 * reste la façade publique : les appels ChatService.x() sont inchangés.
 */

import { collection, doc, getDoc, getDocFromServer, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestore, functions } from '../../config/firebaseConfig';
import { Chat, ChatParticipant, MessageStatus } from '../../types';
import { ModerationService } from '../moderationService';
import { NewChatData } from './internal';
import { chatIdForPair } from './primitives';
import { assertTradeSessionCurrent, captureTradeSession, staleTradeOperation } from '../tradeOperation';

export async function createOrGetChat(
  user1Id: string,
  user2Id: string,
  articleId?: string,
  options?: {expectedUid?: string; assertCurrent?: () => void}
): Promise<Chat> {
  const session = captureTradeSession(options?.expectedUid);
  const current = () => {assertTradeSessionCurrent(session); options?.assertCurrent?.();};
  current();
  if (![user1Id, user2Id].includes(session.uid)) throw staleTradeOperation();
  const matchingPair = (data: DocumentData) => Array.isArray(data.participants) && data.participants.length === 2 &&
    data.participants.includes(user1Id) && data.participants.includes(user2Id);
  try {
    // Prevent creating a chat with yourself
    if (user1Id === user2Id) {
      if (__DEV__) console.error('[ChatService] Cannot create chat with same user:', user1Id);
      throw new Error('Impossible de créer une conversation avec vous-même.');
    }

    // Prevent chat creation/access when either user has blocked the other
    const blocked = await ModerationService.areUsersBlocked(user1Id, user2Id); current();
    if (blocked) {
      throw new Error('Impossible de contacter cet utilisateur');
    }

    const participantIds = [user1Id, user2Id].sort();
    const chatId = chatIdForPair(user1Id, user2Id, articleId);
    const chatRef = doc(firestore, 'chats', chatId);

    // Fetch article data up front (needed for both existing-update and
    // new-chat paths).
    let articleTitle: string | undefined;
    let articleImage: string | undefined;
    let articlePrice: number | undefined;
    let articleSellerId: string | undefined;
    if (articleId) {
      const articleDoc = await getDoc(doc(firestore, 'articles', articleId)); current();
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
    const existing = await getDoc(chatRef); current();
    if (existing.exists()) {
      const chatData = existing.data();
      if (!matchingPair(chatData)) throw staleTradeOperation();

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
      ); current();
      // Une conversation liée à un ARTICLE porte les MÊMES `participants` : la
      // requête ci-dessus les remonte donc aussi. Sans ce filtre, demander une
      // conversation générale — depuis un profil public ou une fiche de swap —
      // pouvait rendre le fil d'un article, avec sa barre de contexte, son
      // bouton d'offre et son classement dans l'onglet VENTES ou ACHATS. Les
      // deux personnes se retrouvaient à parler d'autre chose sous l'en-tête
      // d'un vêtement.
      const generalDocs = legacySnap.docs.filter((d) => matchingPair(d.data()) && !d.data().articleId);
      if (generalDocs.length > 0) {
        const sortedLegacy = [...generalDocs].sort((a, b) => {
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
    const currentUserId = session.uid;
    const isUser1Current = currentUserId === user1Id;

    // Current user doc — always readable (isOwner)
    const currentUserDoc = await getDoc(
      doc(firestore, 'users', isUser1Current ? user1Id : user2Id),
    ); current();
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
      const result = await getUserPublicProfileFn({ userId: otherUserId }); current();
      const profile = result.data.profile;
      otherUserName = profile.displayName || 'Utilisateur';
      otherUserImage = profile.profileImage || undefined;
    } catch (profileError) {
      current();
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
    current();
    await runTransaction(firestore, async (tx) => {
      current();
      const snap = await tx.get(chatRef); current();
      if (snap.exists()) {if (!matchingPair(snap.data())) throw staleTradeOperation(); return;}
      current(); tx.set(chatRef, newChatData);
    }); current();

    const created = await getDoc(chatRef); current();
    if (!created.exists() || !matchingPair(created.data())) throw staleTradeOperation();
    const createdData = created.data() as DocumentData | undefined;
    return {
      id: chatId,
      ...(createdData ?? newChatData),
      createdAt: createdData?.createdAt?.toDate?.() || new Date(),
      updatedAt: createdData?.updatedAt?.toDate?.() || new Date(),
      lastMessageTimestamp: createdData?.lastMessageTimestamp?.toDate?.(),
    } as Chat;
  } catch (error) {
    current();
    if ((error as {code?: string} | null)?.code === 'client/stale-operation') throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Erreur lors de la création du chat: ${message}`);
  }
}


export async function getChatById(chatId: string, servicing?: {expectedUid: string; assertCurrent: () => void}): Promise<Chat> {
  try {
    const session = servicing ? captureTradeSession(servicing.expectedUid) : null;
    const assertCurrent = () => {if (session) assertTradeSessionCurrent(session); servicing?.assertCurrent();};
    assertCurrent();
    const chatRef = doc(firestore, 'chats', chatId);
    const chatDoc = await (servicing ? getDocFromServer(chatRef) : getDoc(chatRef));
    assertCurrent();
    
    if (!chatDoc.exists()) {
      throw new Error('Chat not found');
    }

    const chatData = chatDoc.data();
    if (!chatData) {
      throw new Error('Chat data is undefined');
    }
    if (session && (!Array.isArray(chatData.participants) || chatData.participants.length !== 2 ||
      new Set(chatData.participants).size !== 2 || !chatData.participants.every((id: unknown) => typeof id === 'string' && !!id && !id.includes('/')) ||
      !chatData.participants.includes(session.uid))) throw staleTradeOperation();

    return {
      ...chatData,
      id: chatDoc.id,
      createdAt: chatData.createdAt?.toDate() || new Date(),
      updatedAt: chatData.updatedAt?.toDate() || new Date(),
      lastMessageTimestamp: chatData.lastMessageTimestamp?.toDate(),
    } as Chat;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Erreur lors de la recuperation du chat: ${message}`);
  }
}


export async function markMessagesAsRead(chatId: string, userId: string, assertContext: () => void = () => undefined, loadedMessageIds?: readonly string[]): Promise<void> {
  try {
    const session = captureTradeSession(userId);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    assertCurrent();
    let messageIds = loadedMessageIds;
    if (!messageIds) {
      const snapshot = await getDocs(query(collection(firestore, 'messages'), where('chatId', '==', chatId),
        where('participants', 'array-contains', userId), where('receiverId', '==', userId), where('isRead', '==', false)));
      assertCurrent(); messageIds = snapshot.docs.map(message => message.id);
    }
    const ids = [...new Set(messageIds)].filter(id => !!id && !id.includes('/') && !id.startsWith('optimistic:'));
    for (let offset = 0; offset < ids.length; offset += 400) {
      assertCurrent();
      const chatRef = doc(firestore, 'chats', chatId), refs = ids.slice(offset, offset + 400).map(id => doc(firestore, 'messages', id));
      await runTransaction(firestore, async (tx) => {
        const chatSnap = await tx.get(chatRef);
        const messages = await Promise.all(refs.map(ref => tx.get(ref)));
        assertCurrent();
        if (!chatSnap.exists() || !chatSnap.data().participants?.includes(userId)) throw staleTradeOperation();
        let numMarked = 0;
        for (const message of messages) {
          if (!message.exists()) continue;
          const value = message.data();
          if (value.chatId !== chatId || value.receiverId !== userId || !value.participants?.includes(userId) || value.isRead !== false) continue;
          tx.update(message.ref, {isRead: true, status: 'read' as MessageStatus});
          numMarked++;
        }
        // Reading and changing the same message under this transaction makes
        // echoes and another device's acknowledgement count only once.
        if (numMarked > 0) {
          const count = chatSnap.data().unreadCount?.[userId];
          const current = typeof count === 'number' && Number.isFinite(count) ? count : 0;
          tx.update(chatRef, { [`unreadCount.${userId}`]: Math.max(0, current - numMarked) });
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Erreur lors du marquage comme lu: ${message}`);
  }
}


export async function getUnreadCount(chatId: string, userId: string): Promise<number> {
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
