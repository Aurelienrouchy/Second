import { ChatService } from '@/services/chatService';
import { Chat, Message, ShippingAddress, ShippingEstimate } from '@/types';
import { useEffect, useState } from 'react';

export const useChat = (chatId: string | null, userId: string | null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId || !userId) {
      setIsLoading(false);
      return;
    }

    let unsubscribeMessages: (() => void) | undefined;
    let unsubscribeChat: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load chat info
        const chatData = await ChatService.getChatById(chatId);
        setChat(chatData);

        // Listen to messages in real-time
        unsubscribeMessages = ChatService.listenToMessages(
          chatId,
          userId,
          (updatedMessages) => {
            setMessages(updatedMessages);
            setIsLoading(false);
          },
          (err) => {
            console.error('Error listening to messages:', err);
            setError('Erreur lors du chargement des messages');
            setIsLoading(false);
          }
        );

        // Listen to chat updates (for last message, etc.)
        unsubscribeChat = ChatService.listenToChat(
          chatId,
          (updatedChat) => {
            setChat(updatedChat);
          }
        );

        // Mark messages as read
        await ChatService.markMessagesAsRead(chatId, userId);
      } catch (err) {
        console.error('Error setting up chat:', err);
        setError('Erreur lors du chargement du chat');
        setIsLoading(false);
      }
    };

    setupListeners();

    // Cleanup listeners on unmount
    return () => {
      if (unsubscribeMessages) unsubscribeMessages();
      if (unsubscribeChat) unsubscribeChat();
    };
  }, [chatId, userId]);

  const sendMessage = async (content: string) => {
    if (!chatId || !userId || !chat) return;

    const receiverId = chat.participants.find((id) => id !== userId);
    if (!receiverId) return;

    try {
      await ChatService.sendMessage(chatId, userId, receiverId, content);
    } catch (err) {
      console.error('Error sending message:', err);
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
      console.error('Error sending image:', err);
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
      console.error('Error sending offer:', err);
      throw err;
    }
  };

  const acceptOffer = async (messageId: string, offerId: string) => {
    if (!chatId || !userId) return;

    try {
      await ChatService.acceptOffer(chatId, messageId, offerId, userId);
    } catch (err) {
      console.error('Error accepting offer:', err);
      throw err;
    }
  };

  const rejectOffer = async (messageId: string, offerId: string) => {
    if (!chatId || !userId) return;

    try {
      await ChatService.rejectOffer(chatId, messageId, offerId, userId);
    } catch (err) {
      console.error('Error rejecting offer:', err);
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

export const useChats = (userId: string | null) => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Listen to user's chats in real-time
    const unsubscribe = ChatService.listenToUserChats(
      userId,
      (updatedChats) => {
        setChats(updatedChats);
        setIsLoading(false);
      },
      (err) => {
        console.error('Error listening to chats:', err);
        setError('Erreur lors du chargement des conversations');
        setIsLoading(false);
      }
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [userId]);

  return {
    chats,
    isLoading,
    error,
  };
};

