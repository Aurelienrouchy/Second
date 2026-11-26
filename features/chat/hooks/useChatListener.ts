import { useEffect } from 'react';

import { ChatService } from '@/services/chatService';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';

/**
 * Single global subscription to the user's chats.
 *
 * Mount once from the root layout. Previously both ChatContext and the
 * `useChats` hook each spun up their own `listenToUserChats`
 * subscription on the same Firestore collection — doubled cost for the
 * same data.
 */
export function useChatListener(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    const store = useChatStore.getState();

    if (!userId) {
      store.setChats([]);
      store.setLoading(false);
      return;
    }

    store.setLoading(true);
    store.setError(null);

    let cancelled = false;
    const unsubscribe = ChatService.listenToUserChats(
      userId,
      (chats) => {
        if (!cancelled) {
          store.setChats(chats);
          store.setLoading(false);
        }
      },
      (error) => {
        if (!cancelled) {
          console.error('[useChatListener] error:', error);
          store.setError('Erreur lors du chargement des conversations');
          store.setLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);
}
