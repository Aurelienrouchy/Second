/**
 * ProductGrid Component
 * Design System: Luxe Français + Street Energy + Revolut Polish
 *
 * Reusable 2-column product grid built on FlashList.
 * Handles loading skeletons, empty state, pagination footer.
 * Each ProductCard manages its own favorite state internally.
 *
 * Usage:
 *   <ProductGrid
 *     articles={articles}
 *     isLoading={isLoading}
 *     onProductPress={(article) => router.push(`/article/${article.id}`)}
 *     onLoadMore={loadMore}
 *     isPaginating={isPaginating}
 *     ListHeaderComponent={<MyHeader />}
 *   />
 */

import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import ProductCard, { SkeletonCard } from '@/components/ProductCard';
import { colors, fonts, spacing, typography } from '@/constants/theme';
import type { Article, ArticleWithLocation } from '@/types';

// =============================================================================
// TYPES
// =============================================================================

export interface ProductGridProps {
  /** Articles to display */
  articles: (Article | ArticleWithLocation)[];
  /** Loading state — shows skeleton grid */
  isLoading?: boolean;
  /** Paginating — shows footer spinner */
  isPaginating?: boolean;
  /** Pull-to-refresh handler */
  onRefresh?: () => void;
  /** Infinite scroll handler */
  onLoadMore?: () => void;
  /** Product tap handler */
  onProductPress: (article: Article | ArticleWithLocation) => void;
  /** Long-press handler (e.g. remove from favorites). Optional. */
  onProductLongPress?: (article: Article | ArticleWithLocation) => void;
  /** Custom list header */
  ListHeaderComponent?: React.ReactElement | (() => React.ReactElement);
  /** Extra data to trigger re-render */
  extraData?: any;
  /** Custom empty message */
  emptyMessage?: string;
  /** Custom empty icon */
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  /** Number of skeleton cards to show */
  skeletonCount?: number;
  testID?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Convert an Article/ArticleWithLocation to ProductCard product shape */
function toProductCardProduct(article: Article | ArticleWithLocation) {
  return {
    id: article.id,
    title: article.title,
    price: article.price,
    images: article.images,
    size: article.size?.value,
    brand: article.brand,
    condition: article.condition,
    likes: article.likes,
    isSold: article.isSold,
  };
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

const SkeletonGrid: React.FC<{ count: number }> = ({ count }) => (
  <View style={styles.skeletonGrid}>
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={`skeleton-${i}`} />
    ))}
  </View>
);

const EmptyState: React.FC<{
  message: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = ({ message, icon }) => (
  <View style={styles.emptyContainer}>
    <Ionicons name={icon} size={48} color={colors.muted} />
    <Text style={styles.emptyTitle}>Aucun résultat</Text>
    <Text style={styles.emptyText}>{message}</Text>
  </View>
);

const PaginationFooter: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  return (
    <View style={styles.paginationFooter}>
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function ProductGridComponent({
  articles,
  isLoading = false,
  isPaginating = false,
  onRefresh,
  onLoadMore,
  onProductPress,
  onProductLongPress,
  ListHeaderComponent,
  extraData,
  emptyMessage = 'Aucun article trouvé',
  emptyIcon = 'search-outline',
  skeletonCount = 6,
  testID,
}: ProductGridProps) {
  const renderItem = useCallback(
    ({ item }: { item: Article | ArticleWithLocation }) => (
      <ProductCard
        product={toProductCardProduct(item)}
        onPress={() => onProductPress(item)}
        testID={`product-card-${item.id}`}
      />
    ),
    [onProductPress],
  );

  const keyExtractor = useCallback(
    (item: Article | ArticleWithLocation) => item.id,
    [],
  );

  const handleEndReached = useCallback(() => {
    if (!isPaginating && !isLoading && onLoadMore) {
      onLoadMore();
    }
  }, [isPaginating, isLoading, onLoadMore]);

  // Show skeleton grid inside ListHeader while loading with no data
  const showSkeletons = isLoading && articles.length === 0;

  const listHeaderElement = useCallback(() => {
    const header =
      typeof ListHeaderComponent === 'function'
        ? ListHeaderComponent()
        : ListHeaderComponent;

    return (
      <View>
        {header}
        {showSkeletons && <SkeletonGrid count={skeletonCount} />}
      </View>
    );
  }, [ListHeaderComponent, showSkeletons, skeletonCount]);

  return (
    <View style={styles.container} testID={testID}>
      <FlashList
        data={showSkeletons ? [] : articles}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={2}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.8}
        extraData={extraData}
        ListHeaderComponent={listHeaderElement}
        ListEmptyComponent={
          !isLoading && !showSkeletons ? (
            <EmptyState message={emptyMessage} icon={emptyIcon} />
          ) : null
        }
        ListFooterComponent={<PaginationFooter visible={isPaginating} />}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={isLoading && articles.length > 0}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          ) : undefined
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        testID={testID ? `${testID}-flash-list` : 'product-grid-flash-list'}
      />
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 0,               // Edge-to-edge grid (Seconde)
    paddingBottom: 100,
  },

  // Skeleton grid
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1,                              // 1px gap (Seconde editorial grid)
  },

  // Empty state
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: typography.bodySmall.fontSize,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Pagination footer
  paginationFooter: {
    paddingVertical: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default React.memo(ProductGridComponent);
