import {collection, doc, getCountFromServer, getDocFromServer, getDocsFromServer, onSnapshot, query, runTransaction, where, writeBatch, type DocumentData, type QueryDocumentSnapshot} from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import {auth, firestore} from '@/config/firebaseConfig';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import {useNotificationStore} from '@/store/notificationStore';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';

const CONVERSATION_TYPES = new Set(['chat', 'message', 'new_message', 'offer', 'offer_received', 'offer_counter', 'offer_accepted', 'offer_rejected', 'offer_expired']);
export const isConversationNotification = (type: unknown): boolean => typeof type === 'string' && CONVERSATION_TYPES.has(type);

const chatBarrier = (value: DocumentData, userId: string) => JSON.stringify([
  value.participants, value.unreadCount?.[userId], value.lastMessageTimestamp ?? null, value.updatedAt ?? null,
  value.lastMessage ?? null, value.lastMessageType ?? null,
]);

/** Repairs a late producer's stale count only when every server unread source
 * is empty and the chat has not changed during those reads. */
export async function reconcileReadChatCounter(chatId: string, userId: string, assertContext: () => void): Promise<void> {
  const session = captureTradeSession(userId);
  const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
  const chatRef = doc(firestore, 'chats', chatId);
  assertCurrent();
  const before = await getDocFromServer(chatRef); assertCurrent();
  if (!before.exists()) return;
  const source = before.data(), count = source.unreadCount?.[userId];
  const participant = (value: DocumentData) => Array.isArray(value.participants) && value.participants.length === 2 &&
    new Set(value.participants).size === 2 && value.participants.every((id: unknown) => typeof id === 'string' && !!id && !id.includes('/')) && value.participants.includes(userId);
  if (!participant(source) || !Number.isSafeInteger(count) || count <= 0) return;
  const [messages, notices] = await Promise.all([
    getDocsFromServer(query(collection(firestore, 'messages'), where('chatId', '==', chatId), where('participants', 'array-contains', userId),
      where('receiverId', '==', userId), where('isRead', '==', false))),
    getDocsFromServer(query(collection(firestore, 'notifications'), where('userId', '==', userId), where('isRead', '==', false))),
  ]);
  assertCurrent();
  if (!messages.empty || notices.docs.some(notice => {const value = notice.data(); return value.userId === userId && value.isRead === false &&
    isConversationNotification(value.type) && value.data?.chatId === chatId;})) return;
  const barrier = chatBarrier(source, userId);
  await runTransaction(firestore, async tx => {
    const latest = await tx.get(chatRef); assertCurrent();
    if (!latest.exists() || !participant(latest.data()) || chatBarrier(latest.data(), userId) !== barrier) return;
    tx.update(chatRef, {[`unreadCount.${userId}`]: 0});
  });
}

let latestBadgeRead: symbol | null = null;
let badgeWrite = Promise.resolve();

/** Recounts the owner's real unread notices; an older read cannot restore a stale badge. */
export async function synchronizeNotificationBadge(userId: string, assertContext: () => void = () => undefined,
  countUnread: () => Promise<number> = async () => (await getCountFromServer(query(collection(firestore, 'notifications'),
    where('userId', '==', userId), where('isRead', '==', false)))).data().count): Promise<void> {
  const owner = auth.currentUser, generation = getAuthSessionGeneration(), request = Symbol();
  const ownerCurrent = () => {
    try {assertContext();} catch {return false;}
    return !!owner && auth.currentUser === owner && owner.uid === userId && useAuthStore.getState().authenticatedUid === userId &&
      getAuthSessionGeneration() === generation;
  };
  if (!ownerCurrent()) return;
  latestBadgeRead = request;
  const current = () => ownerCurrent() && latestBadgeRead === request;
  try {
    const count = await countUnread();
    if (!current() || !Number.isSafeInteger(count) || count < 0) return;
    badgeWrite = badgeWrite.catch(() => undefined).then(async () => {
      if (!current()) return;
      useNotificationStore.getState().setUnreadCount(count);
      await Notifications.setBadgeCountAsync(count);
    });
    await badgeWrite;
  } catch (error) {
    if (current() && __DEV__) console.warn('Le nombre de notifications ne peut pas être actualisé.', error);
  }
}

/** A qualified, loaded conversation is a visit for legacy conversation notices.
 * Modern notices carrying messageId are read only once that exact message is loaded. */
export function subscribeToReadChatNotifications(chatId: string, userId: string, loadedMessageIds: readonly string[],
  assertContext: () => void, onRead: (ids: readonly string[]) => void = () => undefined): () => void {
  const session = captureTradeSession(userId), ids = new Set(loadedMessageIds);
  if (!ids.size) return () => undefined;
  let stopped = false, working = false;
  let queued: QueryDocumentSnapshot<DocumentData>[] | null = null;
  const assertCurrent = () => {
    if (stopped) throw new Error('La conversation n’est plus affichée.');
    assertTradeSessionCurrent(session); assertContext();
  };
  const drain = async () => {
    if (working) return;
    working = true;
    try {
      while (queued) {
        assertCurrent();
        const notices = queued; queued = null;
        const targets = notices.filter(notice => {
          const value = notice.data(), data = value.data;
          return value.userId === userId && value.isRead === false && isConversationNotification(value.type) &&
            data && data.chatId === chatId && (data.ownerId === undefined || data.ownerId === userId) &&
            (!Object.hasOwn(data, 'messageId') || typeof data.messageId === 'string' && ids.has(data.messageId));
        });
        for (let offset = 0; offset < targets.length; offset += 400) {
          const selected = targets.slice(offset, offset + 400), batch = writeBatch(firestore);
          selected.forEach(notice => batch.update(notice.ref, {isRead: true}));
          assertCurrent(); await batch.commit(); assertCurrent();
          onRead(selected.map(notice => notice.id));
        }
        await reconcileReadChatCounter(chatId, userId, assertCurrent);
        await synchronizeNotificationBadge(userId, assertCurrent);
      }
    } catch (error) {
      try {assertCurrent(); if (__DEV__) console.warn('La lecture des notifications de cette conversation doit être actualisée.', error);} catch { /* Old screen/account: no further acknowledgement. */ }
    } finally {working = false;}
  };
  assertCurrent();
  const unsubscribe = onSnapshot(query(collection(firestore, 'notifications'), where('userId', '==', userId), where('isRead', '==', false)),
    snapshot => {try {assertCurrent();} catch {return;} queued = snapshot.docs; void drain();},
    error => {try {assertCurrent(); if (__DEV__) console.warn('Les notifications de cette conversation ne peuvent pas être actualisées.', error);} catch { /* Old context. */ }});
  return () => {stopped = true; queued = null; unsubscribe();};
}
