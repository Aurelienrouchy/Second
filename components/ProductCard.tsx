/**
 * ProductCard Component
 * Design System: Luxe Français + Street Energy + Revolut Polish
 *
 * Features:
 * - 4:5 portrait ratio with subtle bottom gradient
 * - Bleu Klein price accent (Satoshi Bold)
 * - Glass-effect like button
 * - Smooth press animations with haptic feedback
 * - Bounce animation on like
 * - Animated pulse skeleton
 * - Compact mode for horizontal sections
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState, useCallback, useEffect, memo } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';

import { colors, radius, spacing, shadows, typography, fonts, animations, components } from '@/constants/theme';
import type { Article } from '@/types';

// =============================================================================
// CONSTANTS
// =============================================================================

const { width: screenWidth } = Dimensions.get('window');
const CONTAINER_PADDING = spacing.md;
const GRID_GAP = spacing.sm;
export const CARD_WIDTH = (screenWidth - CONTAINER_PADDING * 2 - GRID_GAP) / 2;
export const COMPACT_CARD_WIDTH = 160;

const getImageHeight = (cardWidth: number) => cardWidth * (5 / 4); // 4:5 portrait

// =============================================================================
// TYPES
// =============================================================================

export interface ProductCardProduct {
  id: string;
  title: string;
  price: number;
  images: Array<{
    url: string;
    blurhash?: string;
  }>;
  sellerName: string;
  sellerImage?: string;
  location?: {
    distance?: number;
  };
  size?: string;
  brand?: string;
  condition?: Article['condition'];
  likes?: number;
  isLiked?: boolean;
  isSponsored?: boolean;
}

export interface ProductCardProps {
  product: ProductCardProduct;
  onPress: () => void;
  onToggleLike?: () => void;
  isLoading?: boolean;
  compact?: boolean;
  testID?: string;
}

interface SkeletonCardProps {
  compact?: boolean;
  testID?: string;
}

// =============================================================================
// SKELETON COMPONENT (Animated Pulse)
// =============================================================================

export const SkeletonCard: React.FC<SkeletonCardProps> = ({ compact = false, testID }) => {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const animatedOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.4, 1]),
  }));

  const cardWidth = compact ? COMPACT_CARD_WIDTH : CARD_WIDTH;
  const imageHeight = getImageHeight(cardWidth);

  return (
    <View style={[styles.cardWrapper, { width: cardWidth }]} testID={testID}>
      <View style={styles.card}>
        <Animated.View style={[{ width: '100%', height: imageHeight, backgroundColor: colors.borderLight, borderRadius: radius.sm }, animatedOpacity]} />
        <View style={styles.content}>
          <Animated.View style={[styles.skeletonPrice, animatedOpacity]} />
          <Animated.View style={[styles.skeletonTitle, animatedOpacity]} />
          <Animated.View style={[styles.skeletonMeta, animatedOpacity]} />
          <View style={styles.skeletonSellerRow}>
            <Animated.View style={[styles.skeletonAvatar, animatedOpacity]} />
            <Animated.View style={[styles.skeletonSellerName, animatedOpacity]} />
          </View>
        </View>
      </View>
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onPress,
  onToggleLike,
  isLoading = false,
  compact = false,
  testID,
}) => {
  // Early return for invalid product
  if (!product || !product.id) {
    return <SkeletonCard compact={compact} testID={testID} />;
  }

  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  const cardWidth = compact ? COMPACT_CARD_WIDTH : CARD_WIDTH;
  const imageHeight = getImageHeight(cardWidth);

  // Animation values
  const scale = useSharedValue(1);
  const likeScale = useSharedValue(1);

  // Animated card style
  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Animated like button style
  const animatedLikeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeScale.value }],
  }));

  // Press handlers
  const handlePressIn = useCallback(() => {
    scale.value = withSpring(animations.scale.pressedCard, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.snappy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  // Like handler with bounce animation
  const handleLikePress = useCallback(() => {
    if (!onToggleLike) return;

    likeScale.value = withSpring(animations.scale.bounce, animations.spring.bouncy, () => {
      likeScale.value = withSpring(1, animations.spring.gentle);
    });

    Haptics.notificationAsync(
      product.isLiked
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success,
    );

    onToggleLike();
  }, [onToggleLike, product.isLiked, likeScale]);

  // Format price
  const formatPrice = (price: number) => `${price.toFixed(0)} \u20AC`;

  // Format condition
  const conditionLabel = (() => {
    if (!product.condition) return null;
    const map: Record<string, string> = {
      neuf: 'Neuf',
      'très bon état': 'Très bon',
      'bon état': 'Bon',
      satisfaisant: 'Satisfaisant',
    };
    return map[product.condition] || product.condition;
  })();

  const primaryImage = product.images?.[0];

  // Build meta parts
  const metaParts: string[] = [];
  if (product.brand) metaParts.push(product.brand);
  if (product.size) metaParts.push(product.size);
  if (conditionLabel) metaParts.push(conditionLabel);
  const metaText = metaParts.join(' \u2022 ');

  return (
    <Animated.View style={[styles.cardWrapper, { width: cardWidth }, animatedCardStyle]}>
      <Pressable
        style={styles.card}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        testID={testID || `product-card-${product.id}`}
        accessibilityLabel={`${product.title}, ${formatPrice(product.price)}`}
        accessibilityRole="button"
        disabled={isLoading}
      >
        {/* ── Image Container ── */}
        <View style={[styles.imageContainer, { height: imageHeight }]}>
          {primaryImage && !imageError ? (
            <Image
              source={{ uri: primaryImage.url }}
              style={styles.image}
              contentFit="cover"
              placeholder={primaryImage.blurhash}
              placeholderContentFit="cover"
              transition={200}
              onLoadStart={() => setImageLoading(true)}
              onLoadEnd={() => setImageLoading(false)}
              onError={() => {
                setImageError(true);
                setImageLoading(false);
              }}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="image-outline" size={28} color={colors.muted} />
            </View>
          )}

          {/* Subtle bottom gradient for readability */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.03)']}
            style={styles.imageGradient}
            pointerEvents="none"
          />

          {/* Loading overlay */}
          {imageLoading && primaryImage && !imageError && (
            <View style={styles.imageLoadingOverlay}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}

          {/* Like Button — Glass effect */}
          {onToggleLike && (
            <Animated.View style={[styles.likeButtonContainer, animatedLikeStyle]}>
              <Pressable
                style={styles.likeButton}
                onPress={handleLikePress}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID={`like-button-${product.id}`}
              >
                <Ionicons
                  name={product.isLiked ? 'heart' : 'heart-outline'}
                  size={16}
                  color={product.isLiked ? colors.danger : colors.foreground}
                />
              </Pressable>
            </Animated.View>
          )}

          {/* Sponsored badge */}
          {product.isSponsored && (
            <View style={styles.sponsoredBadge}>
              <Text style={styles.sponsoredText}>Sponsorisé</Text>
            </View>
          )}
        </View>

        {/* ── Content ── */}
        <View style={styles.content}>
          {/* Price — Bleu Klein, Satoshi Bold */}
          <Text style={styles.price} numberOfLines={1} testID={`price-${product.id}`}>
            {formatPrice(product.price)}
          </Text>

          {/* Title */}
          <Text style={styles.title} numberOfLines={2} testID={`title-${product.id}`}>
            {product.title}
          </Text>

          {/* Meta: brand • size • condition */}
          {metaText.length > 0 && (
            <Text style={styles.meta} numberOfLines={1}>
              {metaText}
            </Text>
          )}

          {/* Seller Row */}
          <View style={styles.sellerRow}>
            {product.sellerImage ? (
              <Image
                source={{ uri: product.sellerImage }}
                style={styles.sellerAvatar}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.sellerAvatar, styles.sellerAvatarPlaceholder]}>
                <Ionicons name="person" size={10} color={colors.muted} />
              </View>
            )}
            <Text style={styles.sellerName} numberOfLines={1}>
              {product.sellerName}
            </Text>

            {/* Likes count */}
            {product.likes !== undefined && product.likes > 0 && (
              <View style={styles.likesCount}>
                <Ionicons name="heart" size={10} color={colors.danger} />
                <Text style={styles.likesText}>{product.likes}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  // ── Card Wrapper ──
  cardWrapper: {
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadows.card,
  },

  // ── Image ──
  imageContainer: {
    position: 'relative',
    width: '100%',
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.borderLight,
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
  },
  imageLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Like Button (Glass) ──
  likeButtonContainer: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  likeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.card,
  },

  // ── Sponsored Badge ──
  sponsoredBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.foreground,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.xs,
  },
  sponsoredText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // ── Content ──
  content: {
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm + 2,
  },
  price: {
    fontFamily: fonts.sansBold,
    fontSize: 16,
    lineHeight: 20,
    color: colors.primary, // Bleu Klein
    marginBottom: 2,
  },
  title: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.foreground,
    marginBottom: 3,
  },
  meta: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    marginBottom: spacing.sm,
  },

  // ── Seller Row ──
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sellerAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.borderLight,
  },
  sellerAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  sellerName: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginLeft: spacing.xs + 2,
    flex: 1,
  },
  likesCount: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
  },
  likesText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.danger,
    marginLeft: 2,
  },

  // ── Skeleton ──
  skeletonPrice: {
    width: 56,
    height: 18,
    backgroundColor: colors.borderLight,
    borderRadius: radius.xs,
    marginBottom: spacing.xs,
  },
  skeletonTitle: {
    width: '90%',
    height: 13,
    backgroundColor: colors.borderLight,
    borderRadius: radius.xs,
    marginBottom: spacing.xs,
  },
  skeletonMeta: {
    width: '60%',
    height: 11,
    backgroundColor: colors.borderLight,
    borderRadius: radius.xs,
    marginBottom: spacing.sm,
  },
  skeletonSellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  skeletonAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.borderLight,
  },
  skeletonSellerName: {
    width: 50,
    height: 10,
    backgroundColor: colors.borderLight,
    borderRadius: radius.xs,
    marginLeft: spacing.xs + 2,
  },
});

// Memoize to prevent re-renders when parent context changes
export default memo(ProductCard, (prevProps, nextProps) => {
  return (
    prevProps.product.id === nextProps.product.id &&
    prevProps.product.isLiked === nextProps.product.isLiked &&
    prevProps.product.price === nextProps.product.price &&
    prevProps.product.title === nextProps.product.title &&
    prevProps.product.images?.[0]?.url === nextProps.product.images?.[0]?.url &&
    prevProps.product.likes === nextProps.product.likes &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.compact === nextProps.compact
  );
});
