/**
 * useFavorites — React Query-based favorites system
 *
 * Single hook that replaces both the old Context and Zustand store.
 * Uses React Query for all state management:
 * - useQuery for loading favorites (with AsyncStorage fallback for guests)
 * - useMutation + onMutate for optimistic toggle with rollback
 * - select option for fine-grained subscriptions (prevents re-render cascades)
 *
 * Migration from local → Firebase happens automatically on login.
 */

import { useCallback } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClient,
} from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  arrayRemove,
  arrayUnion,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { firestore } from '@/config/firebaseConfig';
import { useAuth } from '@/contexts/AuthContext';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'user_favorites';

export const favoritesKeys = {
  all: ['favorites'] as const,
  ids: (userId: string | null) => [...favoritesKeys.all, 'ids', userId] as const,
  list: (userId: string) => [...favoritesKeys.all, 'list', userId] as const,
};

// ---------------------------------------------------------------------------
// Data layer (same logic as before, extracted as pure functions)
// ---------------------------------------------------------------------------

async function loadLocal(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveLocal(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (e) {
    console.warn('[useFavorites] Failed to save local favorites:', e);
  }
}

async function clearLocal(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}

async function loadFirebase(userId: string): Promise<string[]> {
  const ref = doc(firestore, 'favorites', userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  const data = snap.data() as Record<string, unknown>;
  return Array.isArray(data?.articleIds) ? (data.articleIds as string[]) : [];
}

/**
 * Migrate guest favorites to Firebase on login.
 * De-duplicates, writes new IDs to server, clears local storage.
 */
async function migrateLocalToFirebase(
  userId: string,
  serverIds: string[]
): Promise<string[]> {
  const localIds = await loadLocal();
  if (localIds.length === 0) return serverIds;

  const serverSet = new Set(serverIds);
  const newIds = localIds.filter((id) => !serverSet.has(id));

  if (newIds.length > 0) {
    const ref = doc(firestore, 'favorites', userId);
    await setDoc(
      ref,
      {
        userId,
        articleIds: arrayUnion(...newIds),
        updatedAt: new Date(),
      },
      { merge: true }
    );
  }

  await clearLocal();
  return [...serverIds, ...newIds];
}

// ---------------------------------------------------------------------------
// Query function — loads favorites based on auth state + migrates
// ---------------------------------------------------------------------------

async function fetchFavoriteIds(userId: string | null): Promise<string[]> {
  if (!userId) {
    return loadLocal();
  }

  try {
    const serverIds = await loadFirebase(userId);
    return migrateLocalToFirebase(userId, serverIds);
  } catch (error) {
    console.warn('[useFavorites] Firebase load failed, falling back to local:', error);
    return loadLocal();
  }
}

// ---------------------------------------------------------------------------
// Mutation — toggle with optimistic update
// ---------------------------------------------------------------------------

interface ToggleContext {
  previousIds: string[] | undefined;
}

async function toggleFavoriteMutation({
  articleId,
  isCurrentlyFav,
  userId,
}: {
  articleId: string;
  isCurrentlyFav: boolean;
  userId: string | null;
}): Promise<void> {
  if (userId) {
    const ref = doc(firestore, 'favorites', userId);
    if (isCurrentlyFav) {
      await updateDoc(ref, {
        articleIds: arrayRemove(articleId),
        updatedAt: new Date(),
      });
    } else {
      await setDoc(
        ref,
        {
          userId,
          articleIds: arrayUnion(articleId),
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }
  } else {
    // Guest: compute and save locally
    const current = await loadLocal();
    const next = isCurrentlyFav
      ? current.filter((id) => id !== articleId)
      : [...current, articleId];
    await saveLocal(next);
  }
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

/**
 * Full favorites hook — use in screens that need toggle + list.
 * For card-level usage prefer `useIsFavorite(articleId)` to avoid re-renders.
 */
export function useFavorites() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  // ── Load favorites ─────────────────────────────────────────────────────
  const { data: favoriteIds = [], isLoading } = useQuery({
    queryKey: favoritesKeys.ids(userId),
    queryFn: () => fetchFavoriteIds(userId),
    staleTime: 10 * 60 * 1000, // 10 min — same as other home queries
  });

  // ── Toggle mutation with optimistic update ─────────────────────────────
  const mutation = useMutation<void, Error, string, ToggleContext>({
    mutationFn: (articleId: string) => {
      const isCurrentlyFav = favoriteIds.includes(articleId);
      return toggleFavoriteMutation({ articleId, isCurrentlyFav, userId });
    },
    onMutate: async (articleId: string): Promise<ToggleContext> => {
      // Cancel in-flight fetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: favoritesKeys.ids(userId) });

      const previousIds = queryClient.getQueryData<string[]>(
        favoritesKeys.ids(userId)
      );

      // Optimistic update
      queryClient.setQueryData<string[]>(
        favoritesKeys.ids(userId),
        (old = []) =>
          old.includes(articleId)
            ? old.filter((id) => id !== articleId)
            : [...old, articleId]
      );

      return { previousIds };
    },
    onError: (_err, _articleId, context) => {
      // Rollback on error
      if (context?.previousIds) {
        queryClient.setQueryData(
          favoritesKeys.ids(userId),
          context.previousIds
        );
      }
    },
    onSettled: () => {
      // Invalidate the favorites list so the Favorites screen refreshes
      if (userId) {
        queryClient.invalidateQueries({ queryKey: favoritesKeys.list(userId) });
      }
    },
  });

  const toggleFavorite = useCallback(
    (articleId: string) => mutation.mutate(articleId),
    [mutation]
  );

  const isFavorite = useCallback(
    (articleId: string) => favoriteIds.includes(articleId),
    [favoriteIds]
  );

  return {
    favoriteIds,
    isFavorite,
    toggleFavorite,
    isLoading,
    count: favoriteIds.length,
  };
}

// ---------------------------------------------------------------------------
// Fine-grained hook — for cards (prevents re-render cascades)
// ---------------------------------------------------------------------------

/**
 * Returns only a boolean for a single article.
 * Thanks to `select`, the component re-renders ONLY when this specific
 * article's favorite status flips — not when other favorites change.
 */
export function useIsFavorite(articleId: string): boolean {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data: isLiked = false } = useQuery({
    queryKey: favoritesKeys.ids(userId),
    queryFn: () => fetchFavoriteIds(userId),
    staleTime: 10 * 60 * 1000,
    select: (ids) => ids.includes(articleId),
  });

  return isLiked;
}

/**
 * Returns just the toggle function — stable reference, no re-render impact.
 * Pair with useIsFavorite for card-level usage.
 */
export function useToggleFavorite(): (articleId: string) => void {
  const { toggleFavorite } = useFavorites();
  return toggleFavorite;
}
