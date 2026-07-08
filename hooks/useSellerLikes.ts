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
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';

// =============================================================================
// TYPES
// =============================================================================

export type SellerFollowSource = 'public_profile' | 'home_featured' | 'liked_sellers';

export interface UseSellerLikesReturn {
  likedSellerIds: string[];
  toggleLike: (sellerId: string, source?: SellerFollowSource) => void;
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
      const listKey = currentUserId
        ? queryKeys.sellers.liked(currentUserId)
        : undefined;

      // Cancel in-flight fetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey });
      if (listKey) {
        await queryClient.cancelQueries({ queryKey: listKey });
      }

      const previous = queryClient.getQueryData<string[]>(queryKey);
      const previousList = listKey
        ? queryClient.getQueryData<LikedSellerItem[]>(listKey)
        : undefined;

      const willBeLiked = !(previous ?? []).includes(sellerId);

      // Optimistic update of the id set (drives badges / heart state)
      queryClient.setQueryData<string[]>(queryKey, (old = []) =>
        old.includes(sellerId)
          ? old.filter((id) => id !== sellerId)
          : [...old, sellerId]
      );

      // Keep the liked-sellers list in sync to avoid badge/list desync.
      // On unlike we remove the row; re-liking is reconciled by onSettled refetch.
      if (listKey && !willBeLiked) {
        queryClient.setQueryData<LikedSellerItem[]>(listKey, (old = []) =>
          old.filter((seller) => seller.id !== sellerId)
        );
      }

      return { previous, previousList };
    },
    onError: (_err, _sellerId, context) => {
      // Rollback to previous state on error
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      if (context?.previousList !== undefined && currentUserId) {
        queryClient.setQueryData(
          queryKeys.sellers.liked(currentUserId),
          context.previousList
        );
      }
      if (__DEV__) console.error('[useSellerLikes] Toggle failed:', _err);
    },
    onSettled: (_data, _err, sellerId) => {
      // Refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey });
      // Also invalidate the full liked sellers list (used by liked-sellers screen)
      if (currentUserId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.sellers.liked(currentUserId),
        });
      }
      // Refresh the seller's public profile so its followers counter reflects the toggle
      queryClient.invalidateQueries({ queryKey: ['users', 'publicProfile', sellerId] });
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
