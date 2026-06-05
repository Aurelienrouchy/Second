/**
 * useSellerLike
 * Thin wrapper around the global useSellerLikes hook.
 * Provides per-seller `isLiked` state and a `toggleLike` callback.
 * Reads initial state from React Query cache (no longer always false).
 */

import { useCallback } from 'react';
import { useSellerLikes } from '@/hooks/useSellerLikes';
import { useRequireAuth } from '@/hooks/useAuthRequired';
import { AUTH_MESSAGES } from '@/constants/authMessages';

export function useSellerLike(sellerId: string) {
  const { likedSellerIds, toggleLike: globalToggle } = useSellerLikes();
  const { requireAuth } = useRequireAuth();

  const isLiked = likedSellerIds.includes(sellerId);

  // `onConfirmed` runs only when the like actually registers: immediately when
  // signed in, or after a successful auth when signed out. Lets the caller gate
  // side effects (e.g. the heart bounce) on a confirmed action.
  const toggleLike = useCallback(
    (onConfirmed?: () => void) => {
      requireAuth(() => {
        globalToggle(sellerId);
        onConfirmed?.();
      }, AUTH_MESSAGES.follow);
    },
    [requireAuth, globalToggle, sellerId]
  );

  return { isLiked, toggleLike };
}
