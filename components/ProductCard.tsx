/**
 * ProductCard Component
 * Design: Seconde UI Kit — Tendances MTL style
 *
 * Layout (top → bottom, no border on card body):
 *   Image (aspect 3:4, radius 0, with save button + condition badge)
 *   Brand — uppercase micro label
 *   Title — Cormorant Garamond, single line
 *   Footer row — Price (rust) | Size pill + Condition pill
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { useRequireAuth } from '@/hooks/useAuthRequired';
import { useIsFavorite, useToggleFavorite, type FavoriteSource } from '@/hooks/useFavorites';
import { fixStorageUrl } from '@/utils/fixStorageUrl';
import { formatPrice } from '@/utils/formatPrice';

import { CARD_WIDTH, COMPACT_CARD_WIDTH } from './ProductCard.constants';

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
  size?: string;
  brand?: string;
  condition?: string;
  likes?: number;
  isSold?: boolean;
}

export interface ProductCardProps {
  product: ProductCardProduct;
  onPress: () => void;
  isLoading?: boolean;
  compact?: boolean;
  /** When true the card stretches to fill its parent instead of using a fixed width */
  fillWidth?: boolean;
  testID?: string;
}

interface SkeletonCardProps {
  compact?: boolean;
  testID?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Fix Firebase Storage URLs that have un-encoded paths.
 * The detail page applies this via ArticlesService.fixArticleImageUrls(),
 * but data from Cloud Functions (home feed, discover, etc.) may arrive
 * with raw, un-encoded paths that cause 400 errors on the CDN.
 */
// fixStorageUrl moved to @/utils/fixStorageUrl (single source of truth).

const getConditionLabel = (condition?: string): string | null => {
  if (!condition) return null;
  const map: Record<string, string> = {
    neuf: 'Neuf',
    'très bon état': 'Très bon',
    'bon état': 'Bon',
    satisfaisant: 'Correct',
  };
  return map[condition] || null;
};

// =============================================================================
// SKELETON COMPONENT
// =============================================================================

export const SkeletonCard: React.FC<SkeletonCardProps> = ({ compact = false, testID }) => {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const animatedOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.3, 0.6]),
  }));

  const cardWidth = compact ? COMPACT_CARD_WIDTH : CARD_WIDTH;

  return (
    <View style={[styles.cardWrapper, { width: cardWidth }]} testID={testID}>
      <Animated.View style={[styles.skeletonImage, animatedOpacity]} />
      <View style={styles.skeletonContent}>
        <Animated.View style={[styles.skeletonBrand, animatedOpacity]} />
        <Animated.View style={[styles.skeletonTitle, animatedOpacity]} />
        <Animated.View style={[styles.skeletonFooter, animatedOpacity]} />
      </View>
    </View>
  );
};

// =============================================================================
// SAVE BUTTON — top-right of image
// =============================================================================

const SaveButton: React.FC<{
  isLiked: boolean;
  onPress: () => void;
  testID: string;
}> = memo(({ isLiked, onPress, testID }) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    scale.value = withTiming(1.3, { duration: 200, easing: Easing.out(Easing.ease) }, () => {
      scale.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
    });
    onPress();
  }, [onPress, scale]);

  return (
    <Animated.View style={[styles.saveButtonWrapper, animatedStyle]}>
      <Pressable
        style={styles.saveButton}
        onPress={handlePress}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        testID={testID}
        accessibilityLabel={isLiked ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        accessibilityRole="button"
      >
        <Ionicons
          name={isLiked ? 'heart' : 'heart-outline'}
          size={18}
          color={isLiked ? colors.primary : colors.foreground}
        />
      </Pressable>
    </Animated.View>
  );
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onPress,
  isLoading = false,
  compact = false,
  fillWidth = false,
  testID,
}) => {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const scale = useSharedValue(1);

  const isLiked = useIsFavorite(product?.id ?? '');
  const toggleFavorite = useToggleFavorite();
  const { requireAuth } = useRequireAuth();

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(0.97, { duration: 120, easing: Easing.out(Easing.ease) });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  const handleLikePress = useCallback(() => {
    requireAuth(() => {
      Haptics.notificationAsync(
        isLiked
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
      );
      toggleFavorite(product.id);
    }, AUTH_MESSAGES.like);
  }, [product?.id, isLiked, requireAuth, toggleFavorite]);

  // Early return after all hooks
  if (!product || !product.id) {
    return <SkeletonCard compact={compact} testID={testID} />;
  }

  const cardWidth = fillWidth ? undefined : compact ? COMPACT_CARD_WIDTH : CARD_WIDTH;
  const rawImage = product.images?.[0];
  const primaryImage = rawImage
    ? { ...rawImage, url: fixStorageUrl(rawImage.url) }
    : undefined;
  const conditionLabel = getConditionLabel(product.condition);

  return (
    <Animated.View
      style={[
        styles.cardWrapper,
        fillWidth ? { width: '100%' } : { width: cardWidth },
        animatedCardStyle,
      ]}
      entering={FadeIn.duration(300)}
    >
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        testID={testID || `product-card-${product.id}`}
        accessibilityLabel={`${product.title}, ${formatPrice(product.price)}`}
        accessibilityRole="button"
        disabled={isLoading}
      >
        {/* ── Image ── */}
        <View style={[styles.imageContainer, fillWidth ? { aspectRatio: 3 / 4 } : { height: (cardWidth as number) * (4 / 3) }]}>
          {primaryImage && !imageError ? (
            <Image
              source={{ uri: primaryImage.url }}
              style={styles.image}
              contentFit="cover"
              placeholder={primaryImage.blurhash}
              placeholderContentFit="cover"
              transition={250}
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
              <Ionicons name="image-outline" size={32} color={colors.muted} />
            </View>
          )}

          {imageLoading && primaryImage && !imageError && (
            <View style={styles.imageLoadingOverlay}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}

          {/* Save button — top-right */}
          <SaveButton
            isLiked={isLiked}
            onPress={handleLikePress}
            testID={`like-button-${product.id}`}
          />

          {/* Likes count — bottom-left */}
          {typeof product.likes === 'number' && product.likes > 0 && (
            <View style={styles.likesBadge}>
              <Ionicons name="heart" size={11} color={colors.primary} />
              <Text style={styles.likesText}>{product.likes}</Text>
            </View>
          )}

          {/* Sold overlay */}
          {product.isSold && (
            <View style={styles.soldOverlay}>
              <Text style={styles.soldText}>VENDU</Text>
            </View>
          )}
        </View>

        {/* ── Content below image ── */}
        <View style={styles.content}>
          {/* Brand */}
          <Text style={styles.brand} numberOfLines={1}>
            {product.brand ? product.brand.toUpperCase() : ''}
          </Text>

          {/* Title — single line */}
          <Text style={styles.title} numberOfLines={1}>
            {product.title}
          </Text>

          {/* Footer: Price | Size + Condition */}
          <View style={styles.footer}>
            <Text style={styles.price}>{formatPrice(product.price)}</Text>
            <View style={styles.footerRight}>
              {product.size && (
                <View style={styles.sizePill}>
                  <Text style={styles.sizeText}>{product.size}</Text>
                </View>
              )}
              {conditionLabel && (
                <View style={styles.conditionPill}>
                  <Text style={styles.conditionText}>{conditionLabel}</Text>
                </View>
              )}
            </View>
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
    marginBottom: spacing.sm,
  },

  // ── Image ──
  imageContainer: {
    width: '100%',
    borderRadius: radius.none,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.surfaceWarm,
    marginBottom: 10,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(250, 248, 245, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Sold overlay ──
  soldOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(250, 248, 245, 0.70)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  soldText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 2.4,
    color: colors.charcoal,
    textTransform: 'uppercase',
  },

  // ── Save Button — top-right ──
  saveButtonWrapper: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  saveButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(245, 240, 232, 0.90)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Likes badge — bottom-left ──
  likesBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(245, 240, 232, 0.90)',
  },
  likesText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.foreground,
  },

  // ── Content ──
  content: {
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  brand: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 20,
    color: colors.foreground,
    marginBottom: 6,
  },

  // ── Footer row ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  price: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    fontWeight: '500',
    color: colors.primary, // rust
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sizePill: {
    backgroundColor: 'rgba(26, 24, 20, 0.06)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  sizeText: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: colors.muted,
  },
  conditionPill: {
    backgroundColor: 'rgba(26, 24, 20, 0.06)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  conditionText: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: colors.muted,
  },

  // ── Skeleton ──
  skeletonImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: colors.surfaceWarm,
    marginBottom: 10,
  },
  skeletonContent: {
    paddingHorizontal: 10,
  },
  skeletonBrand: {
    height: 10,
    width: 50,
    backgroundColor: colors.borderLight,
    borderRadius: radius.xs,
    marginBottom: 4,
  },
  skeletonTitle: {
    height: 16,
    width: '75%',
    backgroundColor: colors.borderLight,
    borderRadius: radius.xs,
    marginBottom: 6,
  },
  skeletonFooter: {
    height: 15,
    width: '50%',
    backgroundColor: colors.borderLight,
    borderRadius: radius.xs,
  },
});

// Memoize — isLiked is internal state so the comparison only covers external props
export default memo(ProductCard, (prevProps, nextProps) => {
  return (
    prevProps.product.id === nextProps.product.id &&
    prevProps.product.price === nextProps.product.price &&
    prevProps.product.title === nextProps.product.title &&
    prevProps.product.images?.[0]?.url === nextProps.product.images?.[0]?.url &&
    prevProps.product.size === nextProps.product.size &&
    prevProps.product.condition === nextProps.product.condition &&
    prevProps.product.likes === nextProps.product.likes &&
    prevProps.product.isSold === nextProps.product.isSold &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.compact === nextProps.compact &&
    prevProps.fillWidth === nextProps.fillWidth
  );
});
