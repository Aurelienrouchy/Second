/**
 * useSellerLike
 * Thin wrapper around the global useSellerLikes hook.
 * Provides per-seller `isLiked` state and a `toggleLike` callback.
 * Reads initial state from React Query cache (no longer always false).
 */

import { useCallback } from 'react';
import { useSellerLikes } from '@/hooks/useSellerLikes';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { AUTH_MESSAGES } from '@/constants/authMessages';

export function useSellerLike(sellerId: string) {
  const { likedSellerIds, toggleLike: globalToggle } = useSellerLikes();
  const { requireAuth, isLoggedIn } = useAuthRequired();

  const isLiked = likedSellerIds.includes(sellerId);

  const toggleLike = useCallback(() => {
    requireAuth(() => {
      globalToggle(sellerId);
    }, AUTH_MESSAGES.follow);
  }, [requireAuth, globalToggle, sellerId]);

  return { isLiked, toggleLike, isLoggedIn };
}
