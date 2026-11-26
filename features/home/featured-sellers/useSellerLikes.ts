/**
 * useSellerLikes Hook
 * Manages seller likes - fetches liked sellers for current user and provides toggle functionality.
 * Uses React Query for data fetching + optimistic mutations.
 */

import { useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { functions, auth, firestore } from '@/config/firebaseConfig';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { assertTradeSessionCurrent, captureTradeSession, isTradeSessionCurrent, type TradeSession } from '@/services/tradeOperation';

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
  willBeLiked: boolean;
  applied: string[];
  appliedList: LikedSellerItem[] | undefined;
}

interface ToggleVariables {
  sellerId: string;
  source: SellerFollowSource;
  session: TradeSession;
  isLiked: boolean;
  slot: string;
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
  const pending = useRef(new Set<string>());

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
  const mutation = useMutation<void, Error, ToggleVariables, ToggleContext>({
    mutationFn: async ({ sellerId, session, isLiked }: ToggleVariables) => {
      assertTradeSessionCurrent(session);
      const toggleSellerLike = httpsCallable(functions, 'toggleSellerLike');
      await toggleSellerLike({
        sellerId,
        isLiked,
      });
    },
    onMutate: async ({ sellerId, session, isLiked }: ToggleVariables): Promise<ToggleContext> => {
      assertTradeSessionCurrent(session);
      const idsKey = queryKeys.sellers.likedIds(session.uid);
      const listKey = queryKeys.sellers.liked(session.uid);

      // Cancel in-flight fetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: idsKey });
      assertTradeSessionCurrent(session);
      await queryClient.cancelQueries({ queryKey: listKey });
      assertTradeSessionCurrent(session);

      const previous = queryClient.getQueryData<string[]>(idsKey);
      const previousList = queryClient.getQueryData<LikedSellerItem[]>(listKey);

      const willBeLiked = isLiked;
      const applied = isLiked ? [...new Set([...(previous ?? []), sellerId])] : (previous ?? []).filter(id => id !== sellerId);

      // Optimistic update of the id set (drives badges / heart state)
      const appliedIds = queryClient.setQueryData<string[]>(idsKey, applied) ?? applied;

      // Keep the liked-sellers list in sync to avoid badge/list desync.
      // On unlike we remove the row; re-liking is reconciled by onSettled refetch.
      const nextList = !willBeLiked && previousList ? previousList.filter(seller => seller.id !== sellerId) : previousList;
      const appliedList = !willBeLiked && nextList ? queryClient.setQueryData<LikedSellerItem[]>(listKey, nextList) : nextList;

      return { previous, previousList, willBeLiked, applied: appliedIds, appliedList };
    },
    onSuccess: (_data, { sellerId, source, session }, context) => {
      if (!isTradeSessionCurrent(session)) return;
      const nowFollowing = context?.willBeLiked ?? false;
      const countAfter = queryClient.getQueryData<string[]>(queryKeys.sellers.likedIds(session.uid))?.length ?? 0;
      track(nowFollowing ? 'seller_followed' : 'seller_unfollowed', {
        seller_id: sellerId,
        source,
        liked_sellers_count_after: countAfter,
      });
    },
    onError: (_err, {session}, context) => {
      if (!isTradeSessionCurrent(session)) return;
      const idsKey = queryKeys.sellers.likedIds(session.uid), listKey = queryKeys.sellers.liked(session.uid);
      // Rollback to previous state on error
      if (context?.previous !== undefined && queryClient.getQueryData(idsKey) === context.applied) {
        queryClient.setQueryData(idsKey, context.previous);
      }
      if (context?.previousList !== undefined && queryClient.getQueryData(listKey) === context.appliedList) {
        queryClient.setQueryData(listKey, context.previousList);
      }
      if (__DEV__) console.warn('[useSellerLikes] Toggle failed:', _err);
    },
    onSettled: (_data, _err, { sellerId, session, slot }) => {
      pending.current.delete(slot);
      if (!isTradeSessionCurrent(session)) return;
      // Refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: queryKeys.sellers.likedIds(session.uid) });
      // Also invalidate the full liked sellers list (used by liked-sellers screen)
      queryClient.invalidateQueries({queryKey: queryKeys.sellers.liked(session.uid)});
      // Refresh the seller's public profile so its followers counter reflects the toggle
      queryClient.invalidateQueries({ queryKey: ['users', 'publicProfile', sellerId] });
    },
  });

  const toggleLike = useCallback(
    (sellerId: string, source: SellerFollowSource = 'public_profile') => {
      if (!currentUserId) {
        if (__DEV__) console.warn('[useSellerLikes] User not authenticated');
        return;
      }
      let session: TradeSession;
      try {session = captureTradeSession(currentUserId);} catch {return;}
      const slot = JSON.stringify([session.uid, session.generation, sellerId]);
      if (pending.current.has(slot)) return;
      pending.current.add(slot);
      const ids = queryClient.getQueryData<string[]>(queryKeys.sellers.likedIds(session.uid)) ?? likedSellerIds;
      mutation.mutate({ sellerId, source, session, isLiked: !ids.includes(sellerId), slot });
    },
    [currentUserId, mutation, queryClient, likedSellerIds]
  );

  return {
    likedSellerIds,
    toggleLike,
    isLoading,
    isToggling: mutation.isPending,
    error: queryError ?? mutation.error ?? null,
  };
}
