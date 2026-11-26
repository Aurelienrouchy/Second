import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { auth } from '@/config/firebaseConfig';

import { ChatService } from '@/services/chatService';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
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
  const {userId, generation} = useAuthStore(useShallow(s => ({userId: s.user?.id ?? null, generation: getAuthSessionGeneration()})));

  useEffect(() => {
    const store = useChatStore.getState();

    if (!userId) {
      store.setChats([]);
      store.setLoading(false);
      return;
    }

    store.setLoading(true);
    store.setError(null);

    const owner = auth.currentUser;
    let cancelled = false;
    const current = () => !cancelled && auth.currentUser === owner && owner?.uid === userId &&
      useAuthStore.getState().authenticatedUid === userId && getAuthSessionGeneration() === generation;
    const unsubscribe = ChatService.listenToUserChats(
      userId,
      (chats) => {
        if (current()) {
          store.setChats(chats);
          store.setLoading(false);
        }
      },
      (error) => {
        if (current()) {
          const code = (error as Error & {code?: unknown}).code;
          if (code === 'permission-denied' || code === 'firestore/permission-denied') store.setChats([]);
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
  }, [userId, generation]);
}
