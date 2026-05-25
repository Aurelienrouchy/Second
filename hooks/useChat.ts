import { ChatService } from '@/services/chatService';
import { useChatStore } from '@/store/chatStore';
import { Chat, Message, ShippingAddress, ShippingEstimate } from '@/types';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

export const useChat = (chatId: string | null, userId: string | null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId || !userId) {
      setIsLoading(false);
      setMessages([]);
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
        setMessages([]);
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
            setMessages(updatedMessages);
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
  }, [chatId, userId]);

  const sendMessage = async (content: string) => {
    if (!chatId || !userId || !chat) return;

    const receiverId = chat.participants.find((id) => id !== userId);
    if (!receiverId) return;

    try {
      await ChatService.sendMessage(chatId, userId, receiverId, content);
    } catch (err) {
      if (__DEV__) console.error('Error sending message:', err);
      throw err;
    }
  };

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

  return {
    messages,
    chat,
    isLoading,
    error,
    sendMessage,
    sendImage,
    sendOffer,
    acceptOffer,
    rejectOffer,
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

