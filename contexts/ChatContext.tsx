import { ChatService } from '@/services/chatService';
import { Chat, Message } from '@/types';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';

interface ChatContextType {
  chats: Chat[];
  currentChat: Chat | null;
  messages: Message[];
  isLoading: boolean;
  sendMessage: (chatId: string, receiverId: string, content: string) => Promise<void>;
  createOrGetChat: (user1Id: string, user2Id: string, articleId?: string) => Promise<Chat>;
  selectChat: (chatId: string) => Promise<void>;
  markMessagesAsRead: (chatId: string) => Promise<void>;
  loadUserChats: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
};

interface ChatProviderProps {
  children: ReactNode;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({ children }) => {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();

  // Subscribe to user's chats
  useEffect(() => {
    if (user) {
      const unsubscribe = ChatService.listenToUserChats(
        user.id,
        (userChats) => {
          setChats(userChats);
        },
        (error) => {
          console.error('Error listening to chats:', error);
        }
      );

      return () => unsubscribe();
    } else {
      setChats([]);
    }
  }, [user]);

  // Subscribe to current chat messages
  useEffect(() => {
    if (currentChat && user) {
      const unsubscribe = ChatService.listenToMessages(
        currentChat.id,
        user.id,
        (chatMessages) => {
          setMessages(chatMessages);
        },
        (error) => {
          console.error('Error listening to messages:', error);
        }
      );

      return () => unsubscribe();
    } else {
      setMessages([]);
    }
  }, [currentChat, user]);

  const sendMessage = async (chatId: string, receiverId: string, content: string) => {
    if (!user) throw new Error('User not authenticated');
    
    try {
      await ChatService.sendMessage(chatId, user.id, receiverId, content);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  };

  const createOrGetChat = async (user1Id: string, user2Id: string, articleId?: string): Promise<Chat> => {
    if (!user) throw new Error('User not authenticated');
    
    try {
      return await ChatService.createOrGetChat(user1Id, user2Id, articleId);
    } catch (error) {
      console.error('Error creating/getting chat:', error);
      throw error;
    }
  };

  const selectChat = async (chatId: string) => {
    setIsLoading(true);
    try {
      const chat = chats.find(c => c.id === chatId);
      if (chat) {
        setCurrentChat(chat);
        if (user) {
          await markMessagesAsRead(chatId);
        }
      }
    } catch (error) {
      console.error('Error selecting chat:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const markMessagesAsRead = async (chatId: string) => {
    if (!user) return;
    
    try {
      await ChatService.markMessagesAsRead(chatId, user.id);
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  };

  const loadUserChats = async () => {
    // This is now handled automatically by the real-time listener
    // But we keep this method for backward compatibility
    return Promise.resolve();
  };

  return (
    <ChatContext.Provider value={{
      chats,
      currentChat,
      messages,
      isLoading,
      sendMessage,
      createOrGetChat,
      selectChat,
      markMessagesAsRead,
      loadUserChats
    }}>
      {children}
    </ChatContext.Provider>
  );
};