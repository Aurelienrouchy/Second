/**
 * Favorites Screen
 * Design System: Luxe Français + Street
 *
 * Refactored:
 * - Uses Zustand store instead of Context
 * - Paginated with useInfiniteQuery (20 articles per page)
 * - FlashList-ready rendering
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import {
  Dimensions,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery } from '@tanstack/react-query';

// Design System
import { colors, spacing, radius } from '@/constants/theme';
import { Button, H1, H2, Body, Caption, ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';

// Components
import ProductGrid from '@/components/ProductGrid';

// Hooks & Services
import { useFavorites, favoritesKeys } from '@/hooks/useFavorites';
import { useUser } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { FavoritesService } from '@/services/favoritesService';
import { Article, ArticleWithLocation } from '@/types';

// =============================================================================
// EMPTY STATE COMPONENT
// =============================================================================

const EmptyState: React.FC<{ onBrowse: () => void }> = ({ onBrowse }) => (
  <Animated.View
    entering={FadeInDown.duration(400).delay(100)}
    style={styles.emptyState}
  >
    <View style={styles.emptyIconContainer}>
      <Ionicons name="heart-outline" size={64} color={colors.primary} />
    </View>
    <H2 style={styles.emptyTitle}>Aucun favori</H2>
    <Body color="muted" center style={styles.emptyText}>
      Les articles que vous aimez apparaîtront ici
    </Body>
    <Button
      variant="primary"
      onPress={onBrowse}
      style={styles.browseButton}
    >
      Parcourir les articles
    </Button>
  </Animated.View>
);

// =============================================================================
// LOADING SKELETON COMPONENT
// =============================================================================

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 1;
const SKELETON_CARD_WIDTH = (SCREEN_WIDTH - GRID_GAP) / 2;
const SKELETON_IMAGE_HEIGHT = SKELETON_CARD_WIDTH * (4 / 3);

const SkeletonCard: React.FC = () => (
  <View style={styles.skeletonCard}>
    <Skeleton
      width={SKELETON_CARD_WIDTH}
      height={SKELETON_IMAGE_HEIGHT}
      borderRadius={radius.none}
    />
    <View style={styles.skeletonCardContent}>
      <Skeleton width="60%" height={10} borderRadius={radius.xs} />
      <Skeleton
        width="80%"
        height={12}
        borderRadius={radius.xs}
        style={{ marginTop: spacing.xs }}
      />
      <Skeleton
        width="40%"
        height={14}
        borderRadius={radius.xs}
        style={{ marginTop: spacing.sm }}
      />
    </View>
  </View>
);

const LoadingSkeleton: React.FC = () => (
  <View style={styles.skeletonGrid}>
    {Array.from({ length: 6 }).map((_, i) => (
      <SkeletonCard key={`fav-skeleton-${i}`} />
    ))}
  </View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const PAGE_SIZE = 20;

export default function FavoritesScreen() {
  const router = useRouter();
  const user = useUser();
  const { requireAuth } = useAuthRequired();
  const { toggleFavorite, favoriteIds: articleIds } = useFavorites();

  // ── Paginated query ──────────────────────────────────────────────────────
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: favoritesKeys.list(user?.id ?? 'guest'),
    queryFn: async ({ pageParam = 0 }) => {
      if (!user) return { articles: [], nextCursor: null };
      return FavoritesService.getUserFavoriteArticlesPaginated(
        user.id,
        pageParam,
        PAGE_SIZE
      );
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Flatten pages into a single array
  const favoriteArticles = data?.pages.flatMap((p) => p.articles) ?? [];

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleRemoveFavorite = useCallback(
    (articleId: string) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      toggleFavorite(articleId);
    },
    [toggleFavorite]
  );

  const handleArticlePress = useCallback(
    (article: Article | ArticleWithLocation) => {
      router.push(`/article/${article.id}`);
    },
    [router]
  );

  const handleBrowse = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)');
  }, [router]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ── Guard: not logged in ─────────────────────────────────────────────────
  const handleAuthCheck = useCallback(() => {
    requireAuth(() => {}, 'Vous devez être connecté pour voir vos favoris.');
  }, [requireAuth]);

  // Show empty or auth if no user
  if (!user) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mes favoris" showBack={false} />
        <EmptyState onBrowse={handleAuthCheck} />
      </View>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const isEmpty = !isLoading && favoriteArticles.length === 0 && articleIds.length === 0;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Mes favoris"
        showBack={false}
        rightContent={
          articleIds.length > 0 ? (
            <Caption style={styles.count}>
              {articleIds.length} article{articleIds.length > 1 ? 's' : ''}
            </Caption>
          ) : undefined
        }
      />

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : isEmpty ? (
        <EmptyState onBrowse={handleBrowse} />
      ) : (
        <ProductGrid
          articles={favoriteArticles}
          isLoading={false}
          onProductPress={handleArticlePress}
          emptyMessage="Aucun favori trouvé"
          emptyIcon="heart-outline"
          testID="favorites-grid"
          onLoadMore={handleLoadMore}
          isPaginating={isFetchingNextPage
          }
        />
      )}
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  count: {
    marginTop: spacing.xs,
  },

  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    marginBottom: spacing.sm,
  },
  emptyText: {
    marginBottom: spacing.lg,
  },
  browseButton: {
    minWidth: 200,
  },

  // Skeleton Grid
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  skeletonCard: {
    width: SKELETON_CARD_WIDTH,
  },
  skeletonCardContent: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
});
