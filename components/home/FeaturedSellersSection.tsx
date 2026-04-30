/**
 * FeaturedSellersSection Component
 * Horizontal scrollable seller cards with like functionality
 * Features: profile image avatar, rating, article count, likes count, like button
 */

import React, { useCallback } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, spacing, typography, radius, animations, sizing } from '@/constants/theme';
import { formatDisplayName } from '@/utils/formatName';

// =============================================================================
// TYPES
// =============================================================================

interface FeaturedSeller {
  id: string;
  displayName: string;
  profileImage?: string;
  rating?: number;
  articlesCount: number;
  sellerLikesCount: number;
}

interface FeaturedSellersSectionProps {
  sellers: FeaturedSeller[];
  isLoading?: boolean;
  likedSellerIds: string[];
  onSellerPress: (id: string) => void;
  onToggleSellerLike: (id: string, isLiked: boolean) => void;
  testID?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CARD_WIDTH = 120;
const AVATAR_SIZE = 48;
const CARD_GAP = spacing.md;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Gradient pairs for seller avatars
const SELLER_GRADIENTS = [
  ['#C4603A', '#8B3A1A'],
  ['#7A8C6E', '#4A5C40'],
  ['#D4C4A0', '#A89870'],
  ['#B8847C', '#8B6860'],
  ['#3D9970', '#1A7A4A'],
];

/**
 * Hash a string to a deterministic number
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Get gradient for seller avatar
 */
function getGradientForSeller(sellerId: string): [string, string] {
  const hash = hashString(sellerId);
  const index = hash % SELLER_GRADIENTS.length;
  return SELLER_GRADIENTS[index];
}

// =============================================================================
// SELLER CARD COMPONENT
// =============================================================================

interface SellerCardProps {
  seller: FeaturedSeller;
  isLiked: boolean;
  onPress: () => void;
  onLikePress: () => void;
  index: number;
}

const SellerCard: React.FC<SellerCardProps> = ({
  seller,
  isLiked,
  onPress,
  onLikePress,
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

  const handleLikePress = () => {
    heartScale.value = withSpring(1.3, animations.spring.bouncy);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLikePress();
  };

  const avatarGradient = getGradientForSeller(seller.id);
  const sellerInitial = seller.displayName.charAt(0).toUpperCase();

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
          {/* Like Button - Top Right */}
          <View style={styles.likeButtonContainer}>
            <Animated.View style={heartAnimatedStyle}>
              <Pressable
                style={styles.likeButton}
                onPress={handleLikePress}
                hitSlop={spacing.sm}
              >
                <Ionicons
                  name={isLiked ? 'heart' : 'heart-outline'}
                  size={sizing.iconMD - 2}
                  color={isLiked ? colors.danger : colors.muted}
                />
              </Pressable>
            </Animated.View>
          </View>

          {/* Avatar */}
          <View style={styles.avatarContainer}>
            {seller.profileImage ? (
              <Image
                source={{ uri: seller.profileImage }}
                style={styles.avatar}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <LinearGradient
                colors={avatarGradient}
                style={styles.avatar}
              >
                <Text style={styles.avatarInitial}>{sellerInitial}</Text>
              </LinearGradient>
            )}
          </View>

          {/* Seller Name */}
          <Text
            style={styles.sellerName}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {formatDisplayName(seller.displayName)}
          </Text>

          {/* Rating */}
          {seller.rating && seller.rating > 0 && (
            <View style={styles.ratingContainer}>
              <Ionicons
                name="star"
                size={sizing.iconSM}
                color={colors.warning}
              />
              <Text style={styles.rating}>{seller.rating.toFixed(1)}</Text>
            </View>
          )}

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statNumber}>{seller.articlesCount}</Text>
              <Text style={styles.statLabel}>articles</Text>
            </View>
            <View style={styles.stat}>
              <Ionicons
                name="heart"
                size={sizing.iconSM}
                color={colors.danger}
              />
              <Text style={styles.statLabel}>{seller.sellerLikesCount}</Text>
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

const SellerCardSkeleton: React.FC<{ index: number }> = ({ index }) => (
  <Animated.View
    entering={FadeInDown.duration(400).delay(100 + index * 50)}
    style={styles.cardWrapper}
  >
    <View style={styles.card}>
      <View style={[styles.skeletonAvatar]} />
      <View style={[styles.skeletonBar, { height: 12, marginVertical: spacing.xs }]} />
      <View style={[styles.skeletonBar, { height: 10, marginBottom: spacing.xs, width: '70%' }]} />
      <View style={[styles.skeletonBar, { height: 10, width: '80%' }]} />
    </View>
  </Animated.View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const FeaturedSellersSection: React.FC<FeaturedSellersSectionProps> = ({
  sellers,
  isLoading = false,
  likedSellerIds,
  onSellerPress,
  onToggleSellerLike,
  testID,
}) => {
  const displaySellers = isLoading ? Array(4).fill(null) : sellers;

  const handleToggleLike = useCallback((id: string) => {
    const isCurrentlyLiked = likedSellerIds.includes(id);
    onToggleSellerLike(id, !isCurrentlyLiked);
  }, [likedSellerIds, onToggleSellerLike]);

  return (
    <View style={styles.container} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
      >
        {displaySellers.map((seller, index) => {
          if (isLoading || !seller) {
            return <SellerCardSkeleton key={`skeleton-${index}`} index={index} />;
          }

          const isLiked = likedSellerIds.includes(seller.id);

          return (
            <SellerCard
              key={seller.id}
              seller={seller}
              isLiked={isLiked}
              onPress={() => onSellerPress(seller.id)}
              onLikePress={() => handleToggleLike(seller.id)}
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
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  likeButtonContainer: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 10,
  },
  likeButton: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarContainer: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontFamily: typography.h3.fontFamily,
    fontSize: 20,
    fontWeight: '600',
    color: colors.white,
  },
  sellerName: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    lineHeight: typography.label.lineHeight,
    color: colors.foreground,
    textAlign: 'center',
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  rating: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: colors.foreground,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    width: '100%',
  },
  stat: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  statNumber: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    lineHeight: typography.label.lineHeight,
    color: colors.foreground,
    fontWeight: '600',
  },
  statLabel: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: colors.muted,
  },
  // Skeleton styles
  skeletonAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.borderLight,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  skeletonBar: {
    backgroundColor: colors.borderLight,
    borderRadius: radius.sm,
    width: '100%',
  },
});

export default FeaturedSellersSection;
