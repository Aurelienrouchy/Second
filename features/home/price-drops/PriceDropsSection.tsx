/**
 * PriceDropsSection — Feature Component
 * Self-contained: fetches data via usePriceDrops().
 * Each card manages its own favorite state via useFavorites() at card level.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, spacing, typography, radius, animations, sizing } from '@/constants/theme';
import { SectionHeader } from '@/components/home/SectionHeader';
import { useIsFavorite, useToggleFavorite } from '@/hooks/useFavorites';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { formatPrice } from '@/utils/formatPrice';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { usePriceDrops, PriceDropArticle } from './usePriceDrops';
import { fixStorageUrl } from '@/utils/fixStorageUrl';

// =============================================================================
// HELPERS
// =============================================================================

// fixStorageUrl moved to @/utils/fixStorageUrl.

// =============================================================================
// CONSTANTS
// =============================================================================

const CARD_WIDTH = 140;
const CARD_HEIGHT = CARD_WIDTH * 1.25;
const IMAGE_HEIGHT = CARD_HEIGHT * 0.75;
const CARD_GAP = spacing.md;

// =============================================================================
// PRICE DROP CARD — consumes favorites at card level
// =============================================================================

interface PriceDropCardProps {
  article: PriceDropArticle;
  index: number;
}

const PriceDropCard = React.memo<PriceDropCardProps>(({ article, index }) => {
  const isFav = useIsFavorite(article.id);
  const toggleFavorite = useToggleFavorite();
  const { requireAuth } = useAuthRequired();

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
    router.push(`/article/${article.id}`);
  };
  const handleFavoritePress = () => {
    heartScale.value = withSpring(1.2, animations.spring.bouncy);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    requireAuth(() => toggleFavorite(article.id), AUTH_MESSAGES.like);
  };

  const rawImage = article.images[0];
  // Fix un-encoded Firebase Storage URLs that cause 400 errors
  const image = rawImage?.url
    ? { ...rawImage, url: fixStorageUrl(rawImage.url) }
    : rawImage;
  const displayReduction = article.reduction;

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(100 + index * 50)}
      style={styles.cardWrapper}
    >
      <Animated.View style={animatedStyle}>
        <Pressable
          style={styles.card}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
        >
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: image?.url }}
              style={styles.image}
              contentFit="cover"
              placeholder={image?.blurhash}
              cachePolicy="memory-disk"
              transition={200}
            />

            {/* Price Drop Badge */}
            <View style={styles.badgeContainer}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{displayReduction}</Text>
              </View>
            </View>

            {/* Heart Button */}
            <View style={styles.heartButtonContainer}>
              <Animated.View style={heartAnimatedStyle}>
                <Pressable
                  style={styles.heartButton}
                  onPress={handleFavoritePress}
                  hitSlop={spacing.sm}
                >
                  <Ionicons
                    name={isFav ? 'heart' : 'heart-outline'}
                    size={sizing.iconMD}
                    color={isFav ? colors.danger : colors.foreground}
                  />
                </Pressable>
              </Animated.View>
            </View>
          </View>

          <View style={styles.content}>
            {article.brand && (
              <Text style={styles.brand} numberOfLines={1} ellipsizeMode="tail">
                {article.brand.toUpperCase()}
              </Text>
            )}
            <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
              {article.title}
            </Text>
            <View style={styles.priceRow}>
              <Text style={styles.price}>{formatPrice(article.price)}</Text>
              <Text style={styles.originalPrice} numberOfLines={1}>
                {formatPrice(article.originalPrice)}
              </Text>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
});

// =============================================================================
// SKELETON
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

const PriceDropsSectionComponent: React.FC = () => {
  const { data: articles, isLoading } = usePriceDrops();

  if (!isLoading && (!articles || articles.length === 0)) {
    return null;
  }

  return (
    <View>
      <SectionHeader
        title="Baisses de prix"
        action="Voir tout"
        onActionPress={() => router.push('/search')}
      />
      <View style={styles.container}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          contentContainerStyle={styles.scrollContent}
        >
          {isLoading
            ? Array(3)
                .fill(null)
                .map((_, index) => (
                  <PriceDropCardSkeleton key={`skeleton-${index}`} index={index} />
                ))
            : articles!.map((article, index) => (
                <PriceDropCard key={article.id} article={article} index={index} />
              ))}
        </ScrollView>
      </View>
    </View>
  );
};

export const PriceDropsSection = React.memo(PriceDropsSectionComponent);

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
    borderRadius: radius.none,
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
  skeletonImage: {
    backgroundColor: colors.borderLight,
  },
  skeletonBar: {
    backgroundColor: colors.borderLight,
    borderRadius: radius.sm,
  },
});

export default PriceDropsSection;
