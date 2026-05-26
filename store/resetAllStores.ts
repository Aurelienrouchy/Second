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
 * or chat state. The CLAUDE.md convention requires this — `signOut`
 * previously only reset notificationStore, leaving the rest intact.
 *
 * Note: authStore.signOut already calls this via dynamic import to
 * avoid the circular `authStore -> resetAllStores -> authStore`. Adding
 * authStore.reset() here is still correct because every other entry
 * point (e.g. account deletion, force-logout-on-401) goes through
 * resetAllStores directly.
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
