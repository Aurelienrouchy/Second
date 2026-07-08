/**
 * DiscoverGrid — Feature Component
 * 2-column grid with "Charger plus" button for pagination.
 *
 * Note: this section sits inside the home ScrollView, so we can't drop
 * a FlashList here without flattening the whole home page. Mitigations
 * applied: per-item component is memoised and its onPress is stable per
 * article id, so adding/removing one article doesn't re-render the
 * other ~40 cards.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SectionHeader } from '@/components/home/SectionHeader';
import ProductCard from '@/components/ProductCard';
import { colors, fonts, spacing, typography } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useDiscoverArticles } from './useDiscoverArticles';

// =============================================================================
// ITEM (memoised so siblings don't re-render on store/data churn)
// =============================================================================

interface DiscoverItemProps {
  id: string;
  title: string;
  price: number;
  images: { url: string; blurhash?: string }[];
  brand?: string;
  size?: string;
  condition?: string;
}

const DiscoverItemComponent: React.FC<DiscoverItemProps> = (article) => {
  const onPress = useCallback(() => {
    track('article_card_tapped', {
      article_id: article.id,
      source: 'home_discover',
      price_cents: Math.round(article.price * 100),
      brand: article.brand,
      condition: article.condition,
      is_sold: false,
    });
    router.push(`/article/${article.id}`);
  }, [article.id, article.price, article.brand, article.condition]);

  return (
    <View style={styles.gridItem}>
      <ProductCard
        product={{
          id: article.id,
          title: article.title,
          price: article.price,
          images: article.images,
          brand: article.brand,
          size: article.size,
          condition: article.condition,
        }}
        onPress={onPress}
        fillWidth
      />
    </View>
  );
};

const DiscoverItem = React.memo(DiscoverItemComponent);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const DiscoverGridComponent: React.FC = () => {
  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useDiscoverArticles();

  const allArticles = useMemo(
    () => data?.pages.flatMap((page) => page.articles) ?? [],
    [data]
  );

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  const handleRetry = useCallback(() => {
    track('error_retry_tapped', { screen: 'home', error_context: 'home_discover' });
    refetch();
  }, [refetch]);

  return (
    <View>
      <SectionHeader title="Découvrez" />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      ) : isError && allArticles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyText}>Impossible de charger les articles</Text>
          <Pressable style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : allArticles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyText}>Aucun article trouvé</Text>
        </View>
      ) : (
        <>
          <View style={styles.grid}>
            {allArticles.map((article) => (
              <DiscoverItem
                key={article.id}
                id={article.id}
                title={article.title}
                price={article.price}
                images={article.images}
                brand={article.brand}
                size={article.size}
                condition={article.condition}
              />
            ))}
          </View>

          {hasNextPage && (
            <Pressable
              style={styles.loadMoreButton}
              onPress={handleLoadMore}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.loadMoreText}>Charger plus</Text>
              )}
            </Pressable>
          )}
        </>
      )}
    </View>
  );
};

export const DiscoverGrid = React.memo(DiscoverGridComponent);

// 2-col grid sizing derived from DS tokens (home gutter + inter-column gap),
// so a lone last item stays half-width and left-aligned (flexGrow would
// stretch an orphan to full width).
const GRID_H_PADDING = spacing.lg;
const GRID_COLUMN_GAP = spacing.sm;
const GRID_ITEM_WIDTH =
  (Dimensions.get('window').width - GRID_H_PADDING * 2 - GRID_COLUMN_GAP) / 2;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Inset to the home gutter so the grid aligns with its SectionHeader and
    // the loadMoreButton (both inset by spacing.lg).
    paddingHorizontal: GRID_H_PADDING,
    // Same inter-element gap as the "Nouveautés" rail (spacing.sm).
    columnGap: GRID_COLUMN_GAP,
    rowGap: spacing.sm,
  },
  gridItem: {
    width: GRID_ITEM_WIDTH,
    backgroundColor: colors.background,
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  loadMoreText: {
    fontFamily: fonts.sans,
    // Aligned to the button scale (13) — was a magic 13.
    fontSize: typography.button.fontSize,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.foreground,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.sans,
    // Aligned to the body scale (14) — was a magic 14.
    fontSize: typography.body.fontSize,
    color: colors.muted,
  },
  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyText: {
    fontFamily: fonts.sans,
    // Aligned to the body scale (14) — was a magic 14.
    fontSize: typography.body.fontSize,
    color: colors.muted,
  },
  retryButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  retryText: {
    fontFamily: fonts.sans,
    // Aligned to the button scale (13) — was a magic 13.
    fontSize: typography.button.fontSize,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.foreground,
  },
});

export default DiscoverGrid;
