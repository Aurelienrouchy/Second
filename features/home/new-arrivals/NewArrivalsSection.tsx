/**
 * NewArrivalsSection — Feature Component
 * Horizontal scroll of recent products using ProductCardWithFavorite.
 * Each card manages its own favorite state → no section-level re-render.
 */

import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { SectionHeader } from '@/components/home/SectionHeader';
import ProductCard, { SkeletonCard } from '@/components/ProductCard';
import { COMPACT_CARD_WIDTH } from '@/components/ProductCard.constants';
import { spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { HomeArticle, useNewArrivals } from './useNewArrivals';

// =============================================================================
// NEW ARRIVAL ITEM — memoised to avoid re-renders on scroll
// =============================================================================

const NewArrivalItem = React.memo<{ article: HomeArticle }>(({ article }) => {
  const router = useRouter();
  const handlePress = useCallback(() => {
    track('article_card_tapped', {
      article_id: article.id,
      source: 'home_new_arrivals',
      price_cents: Math.round(article.price * 100),
      brand: article.brand,
      condition: article.condition,
      is_sold: false,
    });
    router.push(`/article/${article.id}`);
  }, [router, article.id, article.price, article.brand, article.condition]);

  return (
    <View style={styles.horizontalCardWrapper}>
      <ProductCard product={article} onPress={handlePress} compact />
    </View>
  );
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const NewArrivalsSectionComponent: React.FC = () => {
  const router = useRouter();
  const { data: articles, isLoading } = useNewArrivals();

  if (!isLoading && (!articles || articles.length === 0)) {
    return null;
  }

  return (
    <View>
      <SectionHeader
        title="Nouveautés"
        action="Voir tout"
        onActionPress={() =>
          router.push({
            pathname: '/search',
            params: { browse: '1', filters: JSON.stringify({ sortBy: 'recent' }) },
          })
        }
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScrollContent}
      >
        {isLoading
          ? Array(4)
              .fill(null)
              .map((_, index) => (
                <View key={`skeleton-${index}`} style={styles.horizontalCardWrapper}>
                  <SkeletonCard compact />
                </View>
              ))
          : articles?.map((item) => (
              <NewArrivalItem key={item.id} article={item} />
            ))}
      </ScrollView>
    </View>
  );
};

export const NewArrivalsSection = React.memo(NewArrivalsSectionComponent);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  horizontalScrollContent: {
    // Home gutter on the left only; the last card bleeds to the screen edge
    // (the canonical HomeHeader.categoriesContent rail convention).
    // No paddingBottom: the next section's SectionHeader (paddingTop 28) is the
    // sole owner of the inter-section vertical space; a rail paddingBottom would
    // double it.
    paddingLeft: spacing.lg,
    paddingRight: 0,
    gap: spacing.sm,
  },
  horizontalCardWrapper: {
    width: COMPACT_CARD_WIDTH,
  },
});

export default NewArrivalsSection;
