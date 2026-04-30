/**
 * DiscoverGrid — Feature Component
 * 2-column grid with "Charger plus" button for pagination.
 * Each ProductCard manages its own favorite state.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
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

  const allArticles = data?.pages.flatMap((page) => page.articles) ?? [];

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
          {/* 2-column grid using flexWrap */}
          <View style={styles.grid}>
            {allArticles.map((article) => (
              <View key={article.id} style={styles.gridItem}>
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
                  onPress={() => router.push(`/article/${article.id}`)}
                  fillWidth
                />
              </View>
            ))}
          </View>

          {/* Load More button */}
          {hasNextPage && (
            <Pressable
              style={styles.loadMoreButton}
              onPress={() => fetchNextPage()}
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

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Edge-to-edge, no horizontal padding
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
