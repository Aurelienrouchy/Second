import { useNotificationStore } from '@/store/notificationStore';
import { queryClient } from '@/lib/queryClient';

/**
 * Reset every Zustand store + clear the React Query cache.
 *
 * Call from the logout flow so a re-login as a different user doesn't
 * inherit the previous user's badge counts, cached queries, FCM token,
 * or chat state. The CLAUDE.md convention requires this — `signOut`
 * previously only reset notificationStore, leaving the rest intact.
 *
 * Add new stores here as they are created (authStore, chatStore, …).
 */
export function resetAllStores(): void {
  useNotificationStore.getState().reset();
  queryClient.clear();
}
