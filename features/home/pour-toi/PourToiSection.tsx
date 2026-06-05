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
  const handlePress = useCallback(
    () => router.push(`/article/${article.id}`),
    [router, article.id]
  );

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
  const router = useRouter();
  const user = useUser();
  const { articles, isLoading, hasProfile } = usePersonalizedFeed({ user });

  // Don't render if user has no profile or no personalized results
  if (!hasProfile) return null;
  if (!isLoading && articles.length === 0) return null;

  return (
    <View>
      <SectionHeader
        title="Pour toi"
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
    // No paddingBottom: pour-toi sits directly above the SwapZone dark band,
    // whose marginTop xl (32) is the sole, intentional editorial pause. A rail
    // paddingBottom here would stack onto it (8 + 32 = 40) and create the
    // parasitic gap above the SwapZone card. The band owns that space.
  },
  horizontalCardWrapper: {
    width: 160,
  },
});
