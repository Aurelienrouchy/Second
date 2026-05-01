import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import { Chat } from '@/types';

// ─── State ──────────────────────────────────────────────────────────────────

interface ChatState {
  /** All chats the current user is a participant of, kept in sync by useChatListener. */
  chats: Chat[];
  isLoading: boolean;
  error: string | null;
  /**
   * Sum of unreadCount across every chat for the current user, kept up
   * to date by `setChats` so consumers don't recompute O(n) on every
   * render. Reset to 0 when the chats list is empty.
   */
  unreadCountByUser: Record<string, number>;
}

interface ChatActions {
  /** Replace the chats list and recompute unreadCountByUser in one go. */
  setChats: (chats: Chat[]) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState: ChatState = {
  chats: [],
  isLoading: true,
  error: null,
  unreadCountByUser: {},
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeUnreadCountByUser(chats: Chat[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const chat of chats) {
    const map = chat.unreadCount;
    if (!map) continue;
    for (const uid in map) {
      out[uid] = (out[uid] ?? 0) + (map[uid] || 0);
    }
  }
  return out;
}

// ─── Store ──────────────────────────────────────────────────────────────────

/**
 * Chat list store. One global Firestore subscription (via
 * useChatListener), two cheap reader paths (tabs layout badge, messages
 * tab list).
 */
export const useChatStore = create<ChatState & ChatActions>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    setChats: (chats) =>
      set({
        chats,
        unreadCountByUser: computeUnreadCountByUser(chats),
      }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    reset: () => set(initialState),
  }))
);

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectChats = (s: ChatState & ChatActions) => s.chats;
export const selectChatsLoading = (s: ChatState & ChatActions) => s.isLoading;

/**
 * Curried selector: `useChatStore(selectUnreadChatCount(userId))`.
 *
 * Reads the pre-computed `unreadCountByUser[userId]` so the
 * subscription only re-renders when THAT user's total changes — not on
 * every chats-list mutation. Returns 0 when userId is null.
 */
export const selectUnreadChatCount =
  (userId: string | null) =>
  (s: ChatState & ChatActions): number =>
    userId ? s.unreadCountByUser[userId] ?? 0 : 0;
