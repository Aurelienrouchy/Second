/**
 * useSellerLikes Hook
 * Manages seller likes - fetches liked sellers for current user and provides toggle functionality
 */

import { useState, useEffect, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { functions, auth, firestore } from '@/config/firebaseConfig';
import * as Haptics from 'expo-haptics';

// =============================================================================
// TYPES
// =============================================================================

export interface UseSellerLikesReturn {
  likedSellerIds: string[];
  toggleLike: (sellerId: string) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

// =============================================================================
// HOOK
// =============================================================================

export function useSellerLikes(userId?: string): UseSellerLikesReturn {
  const [likedSellerIds, setLikedSellerIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const currentUserId = userId || auth.currentUser?.uid;

  // Fetch liked sellers on mount
  useEffect(() => {
    const fetchLikedSellers = async () => {
      if (!currentUserId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const userDocRef = doc(firestore, 'users', currentUserId);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          const liked = userData?.likedSellers || [];
          setLikedSellerIds(liked);
        } else {
          setLikedSellerIds([]);
        }
      } catch (err) {
        if (__DEV__) console.error('Error fetching liked sellers:', err);
        setError(err instanceof Error ? err : new Error('Failed to fetch liked sellers'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchLikedSellers();
  }, [currentUserId]);

  const toggleLike = useCallback(
    async (sellerId: string) => {
      if (!currentUserId) {
        if (__DEV__) console.warn('User not authenticated');
        return;
      }

      try {
        const isCurrentlyLiked = likedSellerIds.includes(sellerId);

        // Optimistic update
        setLikedSellerIds((prev) =>
          isCurrentlyLiked
            ? prev.filter((id) => id !== sellerId)
            : [...prev, sellerId]
        );

        // Haptic feedback
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        // Call cloud function to toggle like
        const toggleSellerLike = httpsCallable(functions, 'toggleSellerLike');
        await toggleSellerLike({
          sellerId,
          isLiked: !isCurrentlyLiked,
        });
      } catch (err) {
        if (__DEV__) console.error('Error toggling seller like:', err);
        // Revert optimistic update on error
        setLikedSellerIds((prev) =>
          likedSellerIds.includes(sellerId)
            ? prev.filter((id) => id !== sellerId)
            : [...prev, sellerId]
        );
        setError(err instanceof Error ? err : new Error('Failed to toggle like'));
      }
    },
    [currentUserId, likedSellerIds]
  );

  return {
    likedSellerIds,
    toggleLike,
    isLoading,
    error,
  };
}

