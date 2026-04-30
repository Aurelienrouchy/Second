/**
 * PriceDropsSection Component
 * Horizontal scrollable product cards with price drop badges
 * Features: price drop badge, heart/favorite toggle, flat card design (radius: 0)
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, spacing, typography, radius, animations, sizing } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface PriceDropArticle {
  id: string;
  title: string;
  brand?: string;
  price: number;
  originalPrice: number;
  reduction: string; // "-35%"
  images: { url: string; blurhash?: string }[];
  sellerId: string;
  sellerName: string;
}

interface PriceDropsSectionProps {
  articles: PriceDropArticle[];
  isLoading?: boolean;
  onArticlePress: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  favoriteIds?: string[];
  testID?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CARD_WIDTH = 140;
const CARD_HEIGHT = CARD_WIDTH * 1.25; // 4:5 aspect ratio for image
const IMAGE_HEIGHT = CARD_HEIGHT * 0.75;
const CARD_GAP = spacing.md;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// =============================================================================
// PRICE DROP CARD COMPONENT
// =============================================================================

interface PriceDropCardProps {
  article: PriceDropArticle;
  isFavorite: boolean;
  onPress: () => void;
  onFavoritePress: () => void;
  index: number;
}

const PriceDropCard: React.FC<PriceDropCardProps> = ({
  article,
  isFavorite,
  onPress,
  onFavoritePress,
  index,
}) => {
  const scale = useSharedValue(1);
  const heartScale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.95, animations.spring.snappy);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, animations.spring.bouncy);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const handleFavoritePress = () => {
    heartScale.value = withSpring(1.2, animations.spring.bouncy);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onFavoritePress();
  };

  const image = article.images[0];
  const priceReduction = parseFloat(article.reduction);
  const displayReduction = `${Math.round(priceReduction)}%`;

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(100 + index * 50)}
      style={styles.cardWrapper}
    >
      <Animated.View style={animatedStyle}>
        <Pressable
          style={[styles.card]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
        >
          {/* Image Container */}
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: image.url }}
              style={styles.image}
              contentFit="cover"
              placeholder={image.blurhash}
              cachePolicy="memory-disk"
              transition={200}
            />

            {/* Price Drop Badge - Top Left */}
            <View style={styles.badgeContainer}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{displayReduction}</Text>
              </View>
            </View>

            {/* Heart Button - Top Right */}
            <View style={styles.heartButtonContainer}>
              <Animated.View style={heartAnimatedStyle}>
                <Pressable
                  style={styles.heartButton}
                  onPress={handleFavoritePress}
                  hitSlop={spacing.sm}
                >
                  <Ionicons
                    name={isFavorite ? 'heart' : 'heart-outline'}
                    size={sizing.iconMD}
                    color={isFavorite ? colors.danger : colors.foreground}
                  />
                </Pressable>
              </Animated.View>
            </View>
          </View>

          {/* Text Content */}
          <View style={styles.content}>
            {article.brand && (
              <Text
                style={styles.brand}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {article.brand.toUpperCase()}
              </Text>
            )}

            <Text
              style={styles.title}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {article.title}
            </Text>

            {/* Price Row */}
            <View style={styles.priceRow}>
              <Text style={styles.price}>
                {article.price.toFixed(2)}€
              </Text>
              <Text
                style={styles.originalPrice}
                numberOfLines={1}
              >
                {article.originalPrice.toFixed(2)}€
              </Text>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
};

// =============================================================================
// SKELETON COMPONENT
// =============================================================================

const PriceDropCardSkeleton: React.FC<{ index: number }> = ({ index }) => (
  <Animated.View
    entering={FadeInDown.duration(400).delay(100 + index * 50)}
    style={styles.cardWrapper}
  >
    <View style={styles.card}>
      <View style={[styles.image, styles.skeletonImage]} />
      <View style={styles.content}>
        <View style={[styles.skeletonBar, { height: 10, marginBottom: spacing.xs }]} />
        <View style={[styles.skeletonBar, { height: 12, marginBottom: spacing.xs, width: '90%' }]} />
        <View style={[styles.skeletonBar, { height: 12, width: '70%' }]} />
      </View>
    </View>
  </Animated.View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const PriceDropsSection: React.FC<PriceDropsSectionProps> = ({
  articles,
  isLoading = false,
  onArticlePress,
  onToggleFavorite,
  favoriteIds = [],
  testID,
}) => {
  const displayArticles = isLoading ? Array(3).fill(null) : articles;

  const handleToggleFavorite = useCallback((id: string) => {
    if (onToggleFavorite) {
      onToggleFavorite(id);
    }
  }, [onToggleFavorite]);

  return (
    <View style={styles.container} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
      >
        {displayArticles.map((article, index) => {
          if (isLoading || !article) {
            return <PriceDropCardSkeleton key={`skeleton-${index}`} index={index} />;
          }

          const isFavorite = favoriteIds.includes(article.id);

          return (
            <PriceDropCard
              key={article.id}
              article={article}
              isFavorite={isFavorite}
              onPress={() => onArticlePress(article.id)}
              onFavoritePress={() => handleToggleFavorite(article.id)}
              index={index}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    gap: CARD_GAP,
  },
  cardWrapper: {
    width: CARD_WIDTH,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: radius.none, // Seconde flat design
    overflow: 'hidden',
  },
  imageContainer: {
    width: CARD_WIDTH,
    height: IMAGE_HEIGHT,
    position: 'relative',
  },
  image: {
    width: CARD_WIDTH,
    height: IMAGE_HEIGHT,
    backgroundColor: colors.borderLight,
  },
  badgeContainer: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
  },
  badge: {
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  badgeText: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    color: colors.white,
    fontWeight: '600',
  },
  heartButtonContainer: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  heartButton: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.full,
  },
  content: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  brand: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: colors.muted,
    marginBottom: spacing.xs,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: typography.body.fontFamily,
    fontSize: 12,
    lineHeight: 16,
    color: colors.foreground,
    marginBottom: spacing.xs,
    fontWeight: '500',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  price: {
    fontFamily: typography.priceSmall.fontFamily,
    fontSize: typography.priceSmall.fontSize,
    lineHeight: typography.priceSmall.lineHeight,
    color: colors.danger,
    fontWeight: '600',
  },
  originalPrice: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  // Skeleton styles
  skeletonImage: {
    backgroundColor: colors.borderLight,
  },
  skeletonBar: {
    backgroundColor: colors.borderLight,
    borderRadius: radius.sm,
  },
});

export default PriceDropsSection;
