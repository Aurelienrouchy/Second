/**
 * useSellerLikes Hook
 * Manages seller likes - fetches liked sellers for current user and provides toggle functionality.
 * Uses React Query for data fetching + optimistic mutations.
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { functions, auth, firestore } from '@/config/firebaseConfig';
import { queryKeys } from '@/lib/queryKeys';

// =============================================================================
// TYPES
// =============================================================================

export interface UseSellerLikesReturn {
  likedSellerIds: string[];
  toggleLike: (sellerId: string) => void;
  isLoading: boolean;
  isToggling: boolean;
  error: Error | null;
}

// Minimal shape needed to keep the liked-sellers list in sync. The full list
// items carry more fields, but we only need the id to filter on unlike.
interface LikedSellerItem {
  id: string;
}

interface ToggleContext {
  previous: string[] | undefined;
  previousList: LikedSellerItem[] | undefined;
}

// =============================================================================
// DATA LAYER
// =============================================================================

async function fetchLikedSellerIds(userId: string): Promise<string[]> {
  const userDocRef = doc(firestore, 'users', userId);
  const userDocSnap = await getDoc(userDocRef);

  if (userDocSnap.exists()) {
    const userData = userDocSnap.data();
    return Array.isArray(userData?.likedSellers) ? userData.likedSellers : [];
  }

  return [];
}

// =============================================================================
// HOOK
// =============================================================================

export function useSellerLikes(userId?: string): UseSellerLikesReturn {
  const currentUserId = userId || auth.currentUser?.uid;
  const queryClient = useQueryClient();

  const queryKey = currentUserId
    ? queryKeys.sellers.likedIds(currentUserId)
    : queryKeys.sellers.likedIds('');

  // ── Load liked seller IDs ─────────────────────────────────────────────────
  const {
    data: likedSellerIds = [],
    isLoading,
    error: queryError,
  } = useQuery<string[], Error>({
    queryKey,
    queryFn: () => fetchLikedSellerIds(currentUserId!),
    enabled: !!currentUserId,
    staleTime: 5 * 60 * 1000,
  });

  // ── Toggle mutation with optimistic update ────────────────────────────────
  const mutation = useMutation<void, Error, string, ToggleContext>({
    mutationFn: async (sellerId: string) => {
      const isCurrentlyLiked = likedSellerIds.includes(sellerId);
      const toggleSellerLike = httpsCallable(functions, 'toggleSellerLike');
      await toggleSellerLike({
        sellerId,
        isLiked: !isCurrentlyLiked,
      });
    },
    onMutate: async (sellerId: string): Promise<ToggleContext> => {
      // Cancel in-flight fetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<string[]>(queryKey);

      // Optimistic update
      queryClient.setQueryData<string[]>(queryKey, (old = []) =>
        old.includes(sellerId)
          ? old.filter((id) => id !== sellerId)
          : [...old, sellerId]
      );

      return { previous };
    },
    onError: (_err, _sellerId, context) => {
      // Rollback to previous state on error
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      if (__DEV__) console.error('[useSellerLikes] Toggle failed:', _err);
    },
    onSettled: () => {
      // Refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey });
      // Also invalidate the full liked sellers list (used by liked-sellers screen)
      if (currentUserId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.sellers.liked(currentUserId),
        });
      }
    },
  });

  const toggleLike = useCallback(
    (sellerId: string) => {
      if (!currentUserId) {
        if (__DEV__) console.warn('[useSellerLikes] User not authenticated');
        return;
      }
      mutation.mutate(sellerId);
    },
    [currentUserId, mutation]
  );

  return {
    likedSellerIds,
    toggleLike,
    isLoading,
    isToggling: mutation.isPending,
    error: queryError ?? mutation.error ?? null,
  };
}
