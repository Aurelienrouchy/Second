import { useTradeOperation } from '@/hooks/useTradeOperation';
import { staleTradeOperation } from '@/services/tradeOperation';
import { ChatService } from '@/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { Chat, Message, Notification, ShippingAddress, ShippingEstimate } from '@/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CancelledError, useQuery, useQueryClient } from '@tanstack/react-query';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import {reconcileReadChatCounter, subscribeToReadChatNotifications, synchronizeNotificationBadge} from '@/services/chatNotificationReadService';
import {queryKeys} from '@/lib/queryKeys';

/** Temp prefix for optimistic (not-yet-confirmed) messages. */
const OPTIMISTIC_ID_PREFIX = 'optimistic:';

/**
 * Optimistic messages carry two extra local-only fields:
 * - `serverId`: the Firestore doc id once the write resolves, used to drop the
 *   optimistic copy as soon as the real-time listener echoes it back.
 * - `failed`: flips to true when the write rejects so the bubble can show a
 *   retryable error state instead of staying stuck in 'sending'.
 */
type OptimisticMessage = Message & { serverId?: string; failed?: boolean };

/**
 * Fenêtre de tolérance pour reconnaître l'écho serveur d'un message optimiste.
 * L'horloge de l'appareil et `serverTimestamp()` ne coïncident jamais
 * exactement ; cinq minutes couvrent largement l'écart sans risquer de
 * confondre deux envois distincts, qui devraient de toute façon différer par
 * leur contenu.
 */
const ECHO_WINDOW_MS = 5 * 60 * 1000;

/**
 * Le serveur a-t-il déjà renvoyé cette copie optimiste ?
 *
 * La réconciliation ne se faisait QUE sur `serverId`, posé après la résolution
 * de `ChatService.sendMessage`. Or le listener Firestore renvoie l'écriture
 * locale bien avant : le message s'affichait donc en double pendant tout
 * l'aller-retour — et indéfiniment hors ligne, où la promesse ne se résout
 * jamais, où le doublon reste à l'écran et où `isSending` verrouille le bouton
 * d'envoi. On reconnaît donc aussi l'écho au contenu.
 *
 * Un message marqué `failed` est comparé comme les autres : `sendMessageWithType`
 * peut lever APRÈS avoir créé le message (l'échec vient alors de la mise à jour
 * du fil), auquel cas le message existe bel et bien côté serveur.
 */
function isEchoOf(server: Message, optimistic: OptimisticMessage): boolean {
  if (optimistic.serverId) return server.id === optimistic.serverId;
  return (
    server.senderId === optimistic.senderId &&
    server.type === optimistic.type &&
    server.content === optimistic.content &&
    Math.abs(server.timestamp.getTime() - optimistic.timestamp.getTime()) < ECHO_WINDOW_MS
  );
}

/**
 * Retire les copies optimistes que le serveur a confirmées. Chaque message
 * serveur ne peut absorber QU'UNE copie : deux envois du même texte restent
 * donc deux messages.
 */
function dropEchoed(
  optimistic: OptimisticMessage[],
  serverMessages: Message[]
): OptimisticMessage[] {
  const consumed = new Set<string>();
  return optimistic.filter((o) => {
    const match = serverMessages.find((m) => !consumed.has(m.id) && isEchoOf(m, o));
    if (match) {
      consumed.add(match.id);
      return false;
    }
    return true;
  });
}

export const useChat = (chatId: string | null, userId: string | null) => {
  const queryClient = useQueryClient();
  const offerContext = useTradeOperation(JSON.stringify(['chat-offers', chatId]), userId);
  const [serverMessages, setServerMessages] = useState<Message[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  // Offres encore actives, épinglées quelle que soit leur place dans
  // l'historique — voir `listenToActiveOffers`.
  const [pinnedOffers, setPinnedOffers] = useState<Message[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by retry() to force the listener-setup effect to re-run (tears down
  // the previous subscription and re-registers a fresh one).
  const [reloadKey, setReloadKey] = useState(0);
  const servicing = useShippingPurchaseContext(JSON.stringify(['existing-chat', chatId, reloadKey]), userId);
  const generation = useAuthStore(getAuthSessionGeneration);
  const scopeKey = JSON.stringify([chatId, userId, generation, servicing.focusRevision, reloadKey]);
  const [renderScope, setRenderScope] = useState(scopeKey);
  if (renderScope !== scopeKey) {
    setRenderScope(scopeKey); setServerMessages([]); setOptimisticMessages([]); setPinnedOffers([]); setChat(null); setError(null);
    setIsLoading(!!chatId && !!userId && servicing.focused);
  }
  const admission = useQuery({queryKey: ['chat-participant-source', chatId, userId, generation, servicing.focusRevision, reloadKey],
    enabled: !!chatId && !!userId && servicing.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async ({signal}) => {
      try {
        if (signal.aborted) throw new CancelledError({revert: true});
        const operation = servicing.capture();
        return await ChatService.getChatById(chatId!, {expectedUid: operation.session.uid,
          assertCurrent: () => {if (signal.aborted) throw new CancelledError({revert: true}); servicing.assertCurrent(operation);}});
      } catch (error) {
        if (signal.aborted || error && typeof error === 'object' && 'code' in error && error.code === 'client/stale-operation') {
          throw new CancelledError({revert: true});
        }
        throw error;
      }
    } });
  const readReady = servicing.focused && admission.isSuccess && !admission.isFetching;

  /** Re-subscribe to the chat after an error (re-runs the listener effect). */
  const retry = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  // Reset local state while inactive (no chat / signed out) — state adjustment
  // during render (https://react.dev/learn/you-might-not-need-an-effect).
  const isInactive = !chatId || !userId || !servicing.focused;
  if (isInactive && (isLoading || chat || serverMessages.length > 0 || optimisticMessages.length > 0)) {
    setIsLoading(false);
    setServerMessages([]);
    setOptimisticMessages([]);
    setPinnedOffers([]);
    setChat(null);
  }

  useEffect(() => {
    if (!chatId || !userId || !readReady) return;
    let operation: ReturnType<typeof servicing.capture>;
    try {operation = servicing.capture();} catch {return;}

    let cancelled = false;
    let unsubMessages: (() => void) | undefined;
    let unsubChat: (() => void) | undefined;
    let unsubOffers: (() => void) | undefined;
    const current = () => !cancelled && servicing.isCurrent(operation);
    const participant = (value: Chat) => value.id === chatId && Array.isArray(value.participants) && value.participants.length === 2 &&
      new Set(value.participants).size === 2 && value.participants.every(id => typeof id === 'string' && !!id && !id.includes('/')) && value.participants.includes(userId);

    const setupListeners = async () => {
      try {
        setIsLoading(true);
        setError(null);
        // Reset messages/chat to avoid showing previous chat's data while loading
        setServerMessages([]);
        setOptimisticMessages([]);
        setPinnedOffers([]);
        setChat(null);

        // Load chat info
        const chatData = admission.data!;
        if (!current()) return;
        if (!participant(chatData)) {
          setIsLoading(false);
          setError('La participation à cette conversation ne peut pas être confirmée.');
          return;
        }
        setChat(chatData);

        // Listen to messages in real-time
        unsubMessages = ChatService.listenToMessages(
          chatId,
          userId,
          (updatedMessages) => {
            if (!current()) return;
            setServerMessages(updatedMessages);
            // Reconcile: drop any optimistic message now confirmed by the server.
            setOptimisticMessages((prev) => dropEchoed(prev, updatedMessages));
            setIsLoading(false);
          },
          (err) => {
            if (!current()) return;
            if (__DEV__) console.error('Error listening to messages:', err);
            setError('Erreur lors du chargement des messages');
            setIsLoading(false);
          }
        );

        // Épingle les offres encore actives, même sorties de la fenêtre de 50.
        unsubOffers = ChatService.listenToActiveOffers(chatId, userId, (offers) => {
          if (!current()) return;
          setPinnedOffers(offers);
        });

        // Listen to chat updates (for last message, etc.)
        unsubChat = ChatService.listenToChat(
          chatId,
          (updatedChat) => {
            if (!current()) return;
            if (!participant(updatedChat)) {setChat(null); setServerMessages([]); setPinnedOffers([]); setOptimisticMessages([]);
              setIsLoading(false); setError('Vous ne participez plus à cette conversation.'); return;}
            setChat(updatedChat);
          },
          () => {if (current()) {setChat(null); setIsLoading(false); setError('La participation à cette conversation ne peut pas être confirmée.');}}
        );

      } catch (err) {
        if (!current()) return;
        if (__DEV__) console.error('Error setting up chat:', err);
        setError('Erreur lors du chargement du chat');
        setIsLoading(false);
      }
    };

    setupListeners();

    // Cleanup listeners on unmount
    return () => {
      cancelled = true;
      unsubMessages?.();
      unsubOffers?.();
      unsubChat?.();
    };
  }, [chatId, userId, reloadKey, servicing.frame, servicing.focusRevision, readReady, admission.data]);

  // A listener being installed does not mean the thread was seen. Acknowledge
  // only committed, loaded messages; keep observing notices produced later.
  useEffect(() => {
    if (!chatId || !userId || !readReady || isLoading || error || chat?.id !== chatId || !chat.participants.includes(userId)) return;
    const loaded = [...serverMessages, ...pinnedOffers].filter(message => message.chatId === chatId && !message.id.startsWith(OPTIMISTIC_ID_PREFIX));
    if (!loaded.length) return;
    let operation: ReturnType<typeof servicing.capture>;
    try {operation = servicing.capture();} catch {return;}
    let cancelled = false;
    const assertCurrent = () => {if (cancelled) throw staleTradeOperation(); servicing.assertCurrent(operation);};
    const unsubscribe = subscribeToReadChatNotifications(chatId, userId, loaded.map(message => message.id), assertCurrent, ids => {
      assertCurrent();
      const marked = new Set(ids), key = queryKeys.notifications.list(userId);
      queryClient.setQueriesData<Notification[]>({queryKey: key}, old => old?.map(notice => marked.has(notice.id) ? {...notice, isRead: true} : notice));
      void queryClient.invalidateQueries({queryKey: key, refetchType: 'none'});
    });
    const incoming = loaded.filter(message => message.receiverId === userId && message.isRead !== true).map(message => message.id);
    void ChatService.markMessagesAsRead(chatId, userId, assertCurrent, incoming).then(async () => {
      await reconcileReadChatCounter(chatId, userId, assertCurrent);
      await synchronizeNotificationBadge(userId, assertCurrent);
    })
      .catch(markError => {try {assertCurrent(); if (__DEV__) console.warn('[useChat] markMessagesAsRead failed:', markError);} catch { /* Previous screen/session. */ }});
    return () => {cancelled = true; unsubscribe();};
  }, [chatId, userId, readReady, isLoading, error, chat, serverMessages, pinnedOffers, servicing.frame, servicing.focusRevision, queryClient]);

  const sendMessage = useCallback(async (content: string, assertContext: () => void = () => undefined) => {
    if (!chatId || !userId || !chat || chat.id !== chatId || !chat.participants.includes(userId) || !readReady || error) throw staleTradeOperation();
    const operation = servicing.start(); if (!operation) throw new Error('Un échange est déjà en cours dans cette conversation.');
    const assertCurrent = () => {servicing.assertCurrent(operation); assertContext();};

    const receiverId = chat.participants.find((id) => id !== userId);
    if (!receiverId) {servicing.finish(operation); throw staleTradeOperation();}

    // Optimistic insert: show the message immediately with a 'sending' status.
    const tempId = `${OPTIMISTIC_ID_PREFIX}${Date.now()}`;
    const optimistic: OptimisticMessage = {
      id: tempId,
      chatId,
      senderId: userId,
      receiverId,
      type: 'text',
      content,
      timestamp: new Date(),
      status: 'sending',
      isRead: false,
    };
    setOptimisticMessages((prev) => [...prev, optimistic]);

    try {
      assertCurrent();
      const serverId = await ChatService.sendMessage(chatId, userId, receiverId, content, assertCurrent);
      assertCurrent();
      // Tag the optimistic copy with its server id so the listener echo can
      // reconcile (drop) it. If the listener already delivered it, the next
      // reconcile pass removes it; otherwise we keep showing 'sent' meanwhile.
      setOptimisticMessages((prev) =>
        prev.map((o) => (o.id === tempId ? { ...o, serverId, status: 'sent' } : o))
      );
    } catch (err) {
      if (__DEV__) console.error('Error sending message:', err);
      // Rollback: mark the optimistic message as failed so the UI can react.
      if (servicing.isCurrent(operation)) setOptimisticMessages((prev) => prev.map((o) => (o.id === tempId ? { ...o, failed: true } : o)));
      throw err;
    } finally {servicing.finish(operation);}
  }, [chatId, userId, chat, servicing.frame, servicing.focusRevision, readReady, error]);

  const sendImage = async (imageUri: string, assertContext: () => void = () => undefined) => {
    if (!chatId || !userId || !chat || chat.id !== chatId || !chat.participants.includes(userId) || !readReady || error) throw staleTradeOperation();
    const operation = servicing.start(); if (!operation) throw new Error('Un échange est déjà en cours dans cette conversation.');
    const assertCurrent = () => {servicing.assertCurrent(operation); assertContext();};

    const receiverId = chat.participants.find((id) => id !== userId);
    if (!receiverId) {servicing.finish(operation); throw staleTradeOperation();}

    try {
      assertCurrent(); await ChatService.sendImage(chatId, userId, receiverId, imageUri, assertCurrent); assertCurrent();
    } catch (err) {
      if (__DEV__) console.error('Error sending image:', err);
      throw err;
    } finally {servicing.finish(operation);}
  };

  const runOffer = async (slot: string, action: (assertCurrent: () => void) => Promise<unknown>, assertIntention?: () => void) => {
    const operation = offerContext.start(slot);
    if (!operation) throw Object.assign(new Error('Une action est déjà en cours pour cette conversation.'), { code: 'client/operation-pending' });
    try {
      if (!chatId || !userId) throw staleTradeOperation();
      const assertCurrent = () => { offerContext.assertCurrent(operation); assertIntention?.(); };
      assertCurrent();
      await action(assertCurrent);
      assertCurrent();
    } finally { offerContext.finish(operation); }
  };
  const sendOffer = async (amount: number, message?: string, shippingAddress?: ShippingAddress, shippingEstimate?: ShippingEstimate) =>
    runOffer('new-offer', assertCurrent => {
      const receiverId = chat?.participants.find(id => id !== userId);
      if (!receiverId) throw staleTradeOperation();
      return ChatService.sendOffer(chatId!, userId!, receiverId, amount, message, shippingAddress, shippingEstimate, assertCurrent);
    });
  const acceptOffer = (messageId: string, offerId: string, assertIntention?: () => void) =>
    runOffer(messageId, assertCurrent => ChatService.acceptOffer(chatId!, messageId, offerId, userId!, assertCurrent), assertIntention);
  const rejectOffer = async (messageId: string, offerId: string) => {
    if (!chatId || !userId || !chat?.participants.includes(userId)) throw staleTradeOperation();
    const operation = servicing.start(); if (!operation) throw new Error('Une action est déjà en cours dans cette conversation.');
    try {servicing.assertCurrent(operation); await ChatService.rejectOffer(chatId, messageId, offerId, userId, () => servicing.assertCurrent(operation)); servicing.assertCurrent(operation);}
    finally {servicing.finish(operation);}
  };

  // Merge confirmed server messages with still-pending optimistic ones.
  // Guard against the brief window where the listener has echoed a message
  // back but the reconcile setState hasn't flushed yet (dedupe by serverId).
  const messages = useMemo<Message[]>(() => {
    // Les offres épinglées peuvent déjà être dans la fenêtre : on déduplique par
    // identifiant, et on retrie par horodatage puisqu'une offre repêchée est
    // plus ANCIENNE que tout ce que porte la fenêtre.
    const missingOffers = pinnedOffers.filter(
      (o) => !serverMessages.some((m) => m.id === o.id),
    );
    const base =
      missingOffers.length === 0
        ? serverMessages
        : [...serverMessages, ...missingOffers].sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
          );
    if (optimisticMessages.length === 0) return base;
    const pending = dropEchoed(optimisticMessages, base);
    return pending.length === 0 ? base : [...base, ...pending];
  }, [serverMessages, optimisticMessages, pinnedOffers]);

  // True while at least one message is mid-flight (not yet confirmed/failed).
  const isSending = optimisticMessages.some((o) => o.status === 'sending' && !o.failed);

  return {
    messages: readReady ? messages : [],
    chat: readReady ? chat : null,
    isLoading: !isInactive && !admission.isError && (admission.isPending || admission.isFetching || isLoading),
    error: admission.error instanceof Error ? 'La conversation et votre participation ne peuvent pas être confirmées actuellement.' : error,
    isSending,
    sendMessage,
    sendImage,
    sendOffer,
    acceptOffer,
    rejectOffer,
    retry,
  };
};

/**
 * Read the user's chat list from chatStore. Subscribes to the global
 * listener mounted once in the root layout via useChatListener — does
 * NOT spin up its own Firestore subscription anymore (that was the
 * "double listener" issue flagged in the audit perf #3).
 *
 * The `userId` param is kept for API compatibility with the old hook
 * but is unused: chatStore is already keyed off the authenticated user
 * via the shared listener.
 */
export const useChats = (_userId?: string | null) => {
  const { chats, isLoading, error } = useChatStore(
    useShallow((s) => ({ chats: s.chats, isLoading: s.isLoading, error: s.error }))
  );

  return { chats, isLoading, error };
};

