/**
 * Backwards-compatibility shim.
 *
 * The chat list state previously lived in a Context. It now lives in
 * `store/chatStore.ts` (Zustand) with the listener mounted once via
 * `useChatListener` in the root layout. The shim preserves the
 * `useChatContext()` API for the single existing consumer
 * (app/(tabs)/_layout.tsx) so no consumer has to change today.
 *
 * The other methods that used to live on the Context (sendMessage,
 * selectChat, markMessagesAsRead, ...) had no consumers and have been
 * removed. The per-chat state (current chat, messages) was — and still
 * is — owned by `hooks/useChat.ts` for individual chat screens.
 */
import React, { ReactNode } from 'react';

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

export function useChatContext(): ChatContextType {
  const chats = useChatStore((s) => s.chats);
  const isLoading = useChatStore((s) => s.isLoading);
  const error = useChatStore((s) => s.error);

  const createOrGetChat = async (
    user1Id: string,
    user2Id: string,
    articleId?: string
  ): Promise<Chat> => {
    return ChatService.createOrGetChat(user1Id, user2Id, articleId);
  };

  const markMessagesAsRead = async (chatId: string): Promise<void> => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    await ChatService.markMessagesAsRead(chatId, userId);
  };

  return {
    chats,
    isLoading,
    error,
    createOrGetChat,
    markMessagesAsRead,
  };
}

/** No-op for backwards compatibility — listener now lives in useChatListener. */
export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return <>{children}</>;
};
