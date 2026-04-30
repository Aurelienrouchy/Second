/**
 * useSellerLike
 * Calls toggleSellerLike Cloud Function with optimistic update.
 * Uses a ref to avoid stale closure — toggleLike never recreates on isLiked change.
 */

import { useState, useCallback, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { AUTH_MESSAGES } from '@/constants/authMessages';

interface ToggleSellerLikeRequest {
  sellerId: string;
  isLiked: boolean;
}

export function useSellerLike(sellerId: string, initialLiked = false) {
  const [isLiked, setIsLiked] = useState(initialLiked);
  // Ref always holds current value — avoids stale closure in toggleLike
  const isLikedRef = useRef(initialLiked);
  const { requireAuth } = useAuthRequired();

  const toggleLike = useCallback(() => {
    requireAuth(async () => {
      const newLiked = !isLikedRef.current;
      isLikedRef.current = newLiked;
      setIsLiked(newLiked);

      try {
        const fn = httpsCallable<ToggleSellerLikeRequest, { success: boolean }>(
          functions,
          'toggleSellerLike'
        );
        await fn({ sellerId, isLiked: newLiked });
      } catch (err) {
        console.warn('[useSellerLike] Error, reverting:', err);
        isLikedRef.current = !newLiked;
        setIsLiked(!newLiked);
      }
    }, AUTH_MESSAGES.like);
  }, [requireAuth, sellerId]); // stable — no longer depends on isLiked

  return { isLiked, toggleLike };
}
