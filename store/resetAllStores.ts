import { useNotificationStore } from '@/store/notificationStore';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useImmersiveOverlayStore } from '@/store/immersiveOverlayStore';
import { queryClient } from '@/lib/queryClient';

/**
 * Reset every Zustand store + clear the React Query cache.
 *
 * Call from the logout flow so a re-login as a different user doesn't
 * inherit the previous user's badge counts, cached queries, FCM token,
 * or chat state. The CLAUDE.md convention requires this.
 *
 * Note: authStore.signOut resets its siblings inline (notification,
 * chat, immersive overlay) + clears the query cache, then calls its own
 * local `set` — it does NOT call resetAllStores, to avoid the circular
 * module graph `authStore -> resetAllStores -> authStore`. This helper
 * stays the single entry point for every OTHER logout path (e.g. account
 * deletion, force-logout-on-401) and must mirror that same set of resets.
 *
 * Add new stores here as they are created (chatStore, …).
 */
export function resetAllStores(): void {
  useNotificationStore.getState().reset();
  useAuthStore.getState().reset();
  useChatStore.getState().reset();
  useImmersiveOverlayStore.getState().reset();
  queryClient.clear();
}
