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
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SectionHeader } from '@/components/home/SectionHeader';
import ProductCard from '@/components/ProductCard';
import { colors, fonts, spacing } from '@/constants/theme';
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
    router.push(`/article/${article.id}`);
  }, [article.id]);

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

  return (
    <View>
      <SectionHeader title="Découvrez" />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Chargement...</Text>
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

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridItem: {
    width: '50%',
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: colors.border,
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
    fontSize: 13,
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
    fontSize: 14,
    color: colors.muted,
  },
  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
});

export default DiscoverGrid;
