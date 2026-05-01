/**
 * Backwards-compatibility shim. Prefer `useChatStore` selectors and the
 * standalone `ChatService` calls in new code.
 */
import React, { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { ChatService } from '@/services/chatService';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { Chat } from '@/types';

export interface ChatContextType {
  chats: Chat[];
  isLoading: boolean;
  error: string | null;
  createOrGetChat: (
    user1Id: string,
    user2Id: string,
    articleId?: string
  ) => Promise<Chat>;
  markMessagesAsRead: (chatId: string) => Promise<void>;
}

/**
 * Module-level stable references — these don't depend on render state,
 * they read auth via getState(). Hoisted so React.memo'd consumers
 * receiving them as props don't bust on every render.
 */
const createOrGetChat = (
  user1Id: string,
  user2Id: string,
  articleId?: string
): Promise<Chat> => ChatService.createOrGetChat(user1Id, user2Id, articleId);

const markMessagesAsRead = async (chatId: string): Promise<void> => {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  await ChatService.markMessagesAsRead(chatId, userId);
};

export function useChatContext(): ChatContextType {
  const { chats, isLoading, error } = useChatStore(
    useShallow((s) => ({
      chats: s.chats,
      isLoading: s.isLoading,
      error: s.error,
    }))
  );

  return { chats, isLoading, error, createOrGetChat, markMessagesAsRead };
}

/** No-op for backwards compatibility — listener now lives in useChatListener. */
export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return <>{children}</>;
};
