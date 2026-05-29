/**
 * HorizontalProductSection Component
 * Design: Curated Editorial — Bulletin-Inspired
 *
 * Features:
 * - Editorial section headers with Sora typography
 * - Horizontal scrolling product cards
 * - Refined spacing and animations
 * - Distance badges for nearby items
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, spacing, fonts, radius, shadows } from '@/constants/theme';
import { SectionHeader } from '@/components/home/SectionHeader';
import { Article, ArticleWithLocation } from '@/types';

import ProductCard from './ProductCard';
import { COMPACT_CARD_WIDTH } from './ProductCard.constants';

// =============================================================================
// TYPES
// =============================================================================

interface HorizontalProductSectionProps {
  title: string;
  subtitle?: string;
  articles: (Article | ArticleWithLocation)[];
  isLoading?: boolean;
  showDistance?: boolean;
  onSeeAll?: () => void;
  onProductPress?: (article: Article | ArticleWithLocation) => void;
  emptyMessage?: string;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CARD_WIDTH = COMPACT_CARD_WIDTH;
const IMAGE_HEIGHT = CARD_WIDTH * 1.35;

// =============================================================================
// COMPONENT
// =============================================================================

export default function HorizontalProductSection({
  title,
  subtitle,
  articles,
  isLoading = false,
  showDistance = false,
  onSeeAll,
  onProductPress,
  emptyMessage = 'Aucun article disponible',
  emptyIcon = 'basket-outline',
  testID,
}: HorizontalProductSectionProps) {
  const handleProductPress = (article: Article | ArticleWithLocation) => {
    if (onProductPress) {
      onProductPress(article);
    } else {
      router.push(`/article/${article.id}`);
    }
  };

  // Don't render section if no articles and not loading
  if (!isLoading && articles.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} testID={testID}>
      {/* Section Header */}
      <SectionHeader
        title={title}
        action={articles.length > 0 && onSeeAll ? 'Voir tout' : undefined}
        onActionPress={articles.length > 0 ? onSeeAll : undefined}
      />

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : articles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Ionicons name={emptyIcon} size={28} color={colors.muted} />
          </View>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          decelerationRate="fast"
          snapToInterval={CARD_WIDTH + spacing.md}
        >
          {articles.map((article) => {
            const distance =
              showDistance && 'location' in article
                ? (article as ArticleWithLocation).location?.distance
                : undefined;

            return (
              <View key={article.id} style={styles.cardContainer}>
                <ProductCard
                  product={{
                    id: article.id,
                    title: article.title,
                    price: article.price,
                    images: article.images,
                    brand: article.brand,
                    size: article.size?.value,
                    condition: article.condition,
                    location:
                      distance !== undefined ? { distance } : undefined,
                  }}
                  onPress={() => handleProductPress(article)}
                  compact
                  testID={`horizontal-product-${article.id}`}
                />
                {/* Distance Badge */}
                {distance !== undefined && (
                  <View style={styles.distanceBadge}>
                    <Ionicons name="location" size={11} color={colors.primary} />
                    <Text style={styles.distanceText}>
                      {distance < 1
                        ? `${Math.round(distance * 1000)}m`
                        : `${distance.toFixed(1)}km`}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.sm,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  cardContainer: {
    width: CARD_WIDTH,
    position: 'relative',
  },

  // Loading & Empty States
  loadingContainer: {
    height: IMAGE_HEIGHT + 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    letterSpacing: 0.1,
  },

  // Distance Badge
  distanceBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    gap: 3,
    ...shadows.card,
  },
  distanceText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.foreground,
    letterSpacing: 0.1,
  },
});
