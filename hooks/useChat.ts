import { ChatService } from '@/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { Chat, Message, ShippingAddress, ShippingEstimate } from '@/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

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

export const useChat = (chatId: string | null, userId: string | null) => {
  const [serverMessages, setServerMessages] = useState<Message[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by retry() to force the listener-setup effect to re-run (tears down
  // the previous subscription and re-registers a fresh one).
  const [reloadKey, setReloadKey] = useState(0);

  /** Re-subscribe to the chat after an error (re-runs the listener effect). */
  const retry = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!chatId || !userId) {
      setIsLoading(false);
      setServerMessages([]);
      setOptimisticMessages([]);
      setChat(null);
      return;
    }

    let cancelled = false;
    let unsubMessages: (() => void) | undefined;
    let unsubChat: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        setIsLoading(true);
        setError(null);
        // Reset messages/chat to avoid showing previous chat's data while loading
        setServerMessages([]);
        setOptimisticMessages([]);
        setChat(null);

        // Load chat info
        const chatData = await ChatService.getChatById(chatId);
        if (cancelled) return;
        setChat(chatData);

        // Listen to messages in real-time
        unsubMessages = ChatService.listenToMessages(
          chatId,
          userId,
          (updatedMessages) => {
            if (cancelled) return;
            setServerMessages(updatedMessages);
            // Reconcile: drop any optimistic message now confirmed by the server.
            setOptimisticMessages((prev) =>
              prev.filter((o) => !updatedMessages.some((m) => m.id === o.serverId))
            );
            setIsLoading(false);
          },
          (err) => {
            if (cancelled) return;
            if (__DEV__) console.error('Error listening to messages:', err);
            setError('Erreur lors du chargement des messages');
            setIsLoading(false);
          }
        );

        // Listen to chat updates (for last message, etc.)
        unsubChat = ChatService.listenToChat(
          chatId,
          (updatedChat) => {
            if (cancelled) return;
            setChat(updatedChat);
          }
        );

        // Mark messages as read
        if (!cancelled) {
          await ChatService.markMessagesAsRead(chatId, userId);
        }
      } catch (err) {
        if (cancelled) return;
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
      unsubChat?.();
    };
  }, [chatId, userId, reloadKey]);

  const sendMessage = useCallback(async (content: string) => {
    if (!chatId || !userId || !chat) return;

    const receiverId = chat.participants.find((id) => id !== userId);
    if (!receiverId) return;

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
      const serverId = await ChatService.sendMessage(chatId, userId, receiverId, content);
      // Tag the optimistic copy with its server id so the listener echo can
      // reconcile (drop) it. If the listener already delivered it, the next
      // reconcile pass removes it; otherwise we keep showing 'sent' meanwhile.
      setOptimisticMessages((prev) =>
        prev.map((o) => (o.id === tempId ? { ...o, serverId, status: 'sent' } : o))
      );
    } catch (err) {
      if (__DEV__) console.error('Error sending message:', err);
      // Rollback: mark the optimistic message as failed so the UI can react.
      setOptimisticMessages((prev) =>
        prev.map((o) => (o.id === tempId ? { ...o, failed: true } : o))
      );
      throw err;
    }
  }, [chatId, userId, chat]);

  const sendImage = async (imageUri: string) => {
    if (!chatId || !userId || !chat) return;

    const receiverId = chat.participants.find((id) => id !== userId);
    if (!receiverId) return;

    try {
      await ChatService.sendImage(chatId, userId, receiverId, imageUri);
    } catch (err) {
      if (__DEV__) console.error('Error sending image:', err);
      throw err;
    }
  };

  const sendOffer = async (
    amount: number,
    message?: string,
    shippingAddress?: ShippingAddress,
    shippingEstimate?: ShippingEstimate
  ) => {
    if (!chatId || !userId || !chat) return;

    const receiverId = chat.participants.find((id) => id !== userId);
    if (!receiverId) return;

    try {
      await ChatService.sendOffer(chatId, userId, receiverId, amount, message, shippingAddress, shippingEstimate);
    } catch (err) {
      if (__DEV__) console.error('Error sending offer:', err);
      throw err;
    }
  };

  const acceptOffer = async (messageId: string, offerId: string) => {
    if (!chatId || !userId) return;

    try {
      await ChatService.acceptOffer(chatId, messageId, offerId, userId);
    } catch (err) {
      if (__DEV__) console.error('Error accepting offer:', err);
      throw err;
    }
  };

  const rejectOffer = async (messageId: string, offerId: string) => {
    if (!chatId || !userId) return;

    try {
      await ChatService.rejectOffer(chatId, messageId, offerId, userId);
    } catch (err) {
      if (__DEV__) console.error('Error rejecting offer:', err);
      throw err;
    }
  };

  // Merge confirmed server messages with still-pending optimistic ones.
  // Guard against the brief window where the listener has echoed a message
  // back but the reconcile setState hasn't flushed yet (dedupe by serverId).
  const messages = useMemo<Message[]>(() => {
    if (optimisticMessages.length === 0) return serverMessages;
    const serverIds = new Set(serverMessages.map((m) => m.id));
    const pending = optimisticMessages.filter(
      (o) => !(o.serverId && serverIds.has(o.serverId))
    );
    return pending.length === 0 ? serverMessages : [...serverMessages, ...pending];
  }, [serverMessages, optimisticMessages]);

  // True while at least one message is mid-flight (not yet confirmed/failed).
  const isSending = optimisticMessages.some((o) => o.status === 'sending' && !o.failed);

  return {
    messages,
    chat,
    isLoading,
    error,
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

