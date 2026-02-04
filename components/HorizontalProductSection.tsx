/**
 * HorizontalProductSection Component
 * Design System: Luxe Français + Street
 *
 * Horizontal scrolling product section for homepage.
 * Used for "Pour Toi", "Près de toi", and similar sections.
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

import { colors, spacing, typography, radius, shadows } from '@/constants/theme';
import { SectionHeader } from '@/components/ui';
import { Article, ArticleWithLocation } from '@/types';

import ProductCard, { COMPACT_CARD_WIDTH } from './ProductCard';

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
const IMAGE_HEIGHT = CARD_WIDTH * (5 / 4); // 4:5 ratio

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
        subtitle={subtitle}
        onSeeAll={articles.length > 0 ? onSeeAll : undefined}
      />

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : articles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name={emptyIcon} size={32} color={colors.muted} />
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
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
                    sellerName: article.sellerName,
                    sellerImage: article.sellerImage,
                    isLiked: false,
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
                    <Ionicons name="location" size={12} color={colors.primary} />
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
    // No extra vertical padding - SectionHeader handles top padding
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  cardContainer: {
    width: CARD_WIDTH,
    position: 'relative',
  },

  // Loading & Empty States
  loadingContainer: {
    height: IMAGE_HEIGHT + 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: typography.bodySmall.fontSize,
    color: colors.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
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
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    ...shadows.card,
  },
  distanceText: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: colors.foreground,
    marginLeft: spacing.xs,
  },
});
