import { create } from 'zustand';

import { Chat } from '@/types';

// ─── State ──────────────────────────────────────────────────────────────────

interface ChatState {
  /** All chats the current user is a participant of, kept in sync by useChatListener. */
  chats: Chat[];
  isLoading: boolean;
  error: string | null;
}

interface ChatActions {
  setChats: (chats: Chat[]) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState: ChatState = {
  chats: [],
  isLoading: true,
  error: null,
};

// ─── Store ──────────────────────────────────────────────────────────────────

/**
 * Chat list store. Replaces both ChatContext (only consumed by the tabs
 * layout for the unread badge) and the standalone `useChats` hook
 * (consumed by the messages tab) — both used to instantiate their own
 * Firestore listener for the SAME collection. Now there's exactly one
 * `listenToUserChats` subscription, mounted by `useChatListener` from
 * the root layout.
 *
 * Per-chat state (current chat, messages, send actions) is intentionally
 * NOT here: those are local to a single screen lifecycle and are owned
 * by the existing `useChat(chatId, userId)` hook.
 */
export const useChatStore = create<ChatState & ChatActions>()((set) => ({
  ...initialState,

  setChats: (chats) => set({ chats }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectChats = (s: ChatState & ChatActions) => s.chats;
export const selectChatsLoading = (s: ChatState & ChatActions) => s.isLoading;
export const selectUnreadChatCount = (
  s: ChatState & ChatActions,
  userId: string | null
): number => {
  if (!userId) return 0;
  return s.chats.reduce((total, chat) => {
    return total + (chat.unreadCount?.[userId] || 0);
  }, 0);
};
