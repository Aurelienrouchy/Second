/**
 * PourToiSection -- Personalized "Pour toi" feed section on the home screen.
 * Shows articles matching the user's style profile or manual preferences.
 * Only renders when the user has a profile (styleProfile or preferences).
 */

import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { SectionHeader } from '@/components/home/SectionHeader';
import ProductCard, { SkeletonCard, type ProductCardProduct } from '@/components/ProductCard';
import { COMPACT_CARD_WIDTH } from '@/components/ProductCard.constants';
import { spacing } from '@/constants/theme';
import { useUser } from '@/hooks/useAuth';
import { usePersonalizedFeed } from '@/hooks/usePersonalizedFeed';
import { track } from '@/lib/analytics';
import type { Article } from '@/types';

/** Map Article to the subset ProductCard expects (location type differs). */
function toCardProduct(article: Article): ProductCardProduct {
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
// POUR TOI ITEM -- memoised to avoid re-renders on scroll
// =============================================================================

const PourToiItem = React.memo<{ article: Article }>(({ article }) => {
  const router = useRouter();
  const handlePress = useCallback(() => {
    track('article_card_tapped', {
      article_id: article.id,
      source: 'home_pour_toi',
      price_cents: Math.round(article.price * 100),
      brand: article.brand,
      condition: article.condition,
      is_sold: !!article.isSold,
    });
    router.push(`/article/${article.id}`);
  }, [router, article.id, article.price, article.brand, article.condition, article.isSold]);

  return (
    <View style={styles.horizontalCardWrapper}>
      <ProductCard product={toCardProduct(article)} onPress={handlePress} compact />
    </View>
  );
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const PourToiSectionComponent: React.FC = () => {
  const user = useUser();
  const { articles, isLoading, hasProfile } = usePersonalizedFeed({ user });

  // Don't render if user has no profile or no personalized results
  if (!hasProfile) return null;
  if (!isLoading && articles.length === 0) return null;

  return (
    <View>
      <SectionHeader title="Pour toi" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScrollContent}
      >
        {isLoading
          ? Array(4)
              .fill(null)
              .map((_, index) => (
                <View key={`skeleton-pour-toi-${index}`} style={styles.horizontalCardWrapper}>
                  <SkeletonCard compact />
                </View>
              ))
          : articles.map((item) => (
              <PourToiItem key={item.id} article={item} />
            ))}
      </ScrollView>
    </View>
  );
};

export const PourToiSection = React.memo(PourToiSectionComponent);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  horizontalScrollContent: {
    // Home gutter on the left only; the last card bleeds to the screen edge
    // like the other rails (consistency).
    paddingLeft: spacing.lg,
    paddingRight: 0,
    gap: spacing.sm,
    // No paddingBottom: the next section's SectionHeader (paddingTop 28) is the
    // sole owner of the inter-section vertical space. A rail paddingBottom here
    // would stack onto it and double the gap below "Pour toi".
  },
  horizontalCardWrapper: {
    width: COMPACT_CARD_WIDTH,
  },
});
