/**
 * NewArrivalsSection — Feature Component
 * Horizontal scroll of recent products using ProductCardWithFavorite.
 * Each card manages its own favorite state → no section-level re-render.
 */

import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { SectionHeader } from '@/components/home/SectionHeader';
import ProductCard, { SkeletonCard } from '@/components/ProductCard';
import { COMPACT_CARD_WIDTH } from '@/components/ProductCard.constants';
import { spacing } from '@/constants/theme';
import { useNewArrivals } from './useNewArrivals';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const NewArrivalsSectionComponent: React.FC = () => {
  const { data: articles, isLoading } = useNewArrivals();

  if (!isLoading && (!articles || articles.length === 0)) {
    return null;
  }

  return (
    <View>
      <SectionHeader
        title="Nouveautés"
        action="Voir tout"
        onActionPress={() => router.push('/search')}
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
              <View key={item.id} style={styles.horizontalCardWrapper}>
                <ProductCard
                  product={{
                    id: item.id,
                    title: item.title,
                    price: item.price,
                    images: item.images,
                    brand: item.brand,
                    size: item.size,
                    condition: item.condition,
                  }}
                  onPress={() => router.push(`/article/${item.id}`)}
                  compact
                />
              </View>
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
    paddingHorizontal: spacing.md,
    gap: 4,
    paddingBottom: spacing.sm,
  },
  horizontalCardWrapper: {
    width: COMPACT_CARD_WIDTH,
  },
});

export default NewArrivalsSection;
