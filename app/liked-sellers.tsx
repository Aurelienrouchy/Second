/**
 * Liked Sellers Screen
 * Shows list of sellers the user has liked, with ability to unlike
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import React, { useCallback } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { formatDisplayName } from '@/utils/formatName';
import { httpsCallable } from 'firebase/functions';
import { useQuery } from '@tanstack/react-query';

// Design System
import { colors, fonts, spacing, radius, animations, typography } from '@/constants/theme';

// Hooks & Services
import { useUser } from '@/hooks/useAuth';
import { useSellerLikes } from '@/hooks/useSellerLikes';
import { queryKeys } from '@/lib/queryKeys';
import { functions } from '@/config/firebaseConfig';

// =============================================================================
// TYPES
// =============================================================================

interface LikedSeller {
  id: string;
  displayName: string;
  profileImage?: string;
  rating?: number;
  articlesCount: number;
  sellerLikesCount: number;
}

// =============================================================================
// SELLER CARD
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface SellerCardProps {
  seller: LikedSeller;
  isLiked: boolean;
  onPress: () => void;
  onToggleLike: () => void;
  index: number;
}

const SellerCard: React.FC<SellerCardProps> = ({
  seller,
  isLiked,
  onPress,
  onToggleLike,
  index,
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(animations.scale.pressed, {
      duration: animations.duration.fast,
      easing: Easing.out(Easing.ease),
    });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withTiming(1, {
      duration: animations.duration.normal,
      easing: Easing.out(Easing.ease),
    });
  }, [scale]);

  // Generate gradient for avatar fallback
  const initial = seller.displayName?.[0]?.toUpperCase() || '?';

  return (
    <AnimatedPressable
      testID="seller-card"
      entering={FadeInDown.duration(300).delay(index * 60)}
      style={[styles.sellerCard, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
    >
      {/* Avatar */}
      {seller.profileImage ? (
        <Image
          source={{ uri: seller.profileImage }}
          style={styles.avatar}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
      )}

      {/* Info */}
      <View style={styles.sellerInfo}>
        <Text style={styles.sellerName} numberOfLines={1}>{formatDisplayName(seller.displayName)}</Text>
        <View style={styles.sellerStats}>
          {seller.rating != null && (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={12} color="#E09F3E" />
              <Text style={styles.ratingText}>{seller.rating.toFixed(1)}</Text>
            </View>
          )}
          <Text style={styles.statText}>{seller.articlesCount} articles</Text>
          <Text style={styles.statDot}>·</Text>
          <View style={styles.likesRow}>
            <Ionicons name="heart" size={10} color={colors.muted} />
            <Text style={styles.statText}>{seller.sellerLikesCount}</Text>
          </View>
        </View>
      </View>

      {/* Like button */}
      <Pressable
        testID="seller-card-like"
        style={styles.likeButton}
        onPress={(e) => {
          e.stopPropagation?.();
          onToggleLike();
        }}
        hitSlop={12}
      >
        <Ionicons
          name={isLiked ? 'heart' : 'heart-outline'}
          size={20}
          color={isLiked ? colors.danger : colors.muted}
        />
      </Pressable>

      {/* Chevron */}
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </AnimatedPressable>
  );
};

// =============================================================================
// MAIN SCREEN
// =============================================================================

export default function LikedSellersScreen() {
  const user = useUser();
  const { likedSellerIds, toggleLike } = useSellerLikes(user?.id);

  const { data: sellers = [], isLoading } = useQuery<LikedSeller[]>({
    queryKey: queryKeys.sellers.liked(user?.id ?? ''),
    queryFn: async () => {
      const getLikedSellers = httpsCallable(functions, 'getLikedSellers');
      const result = await getLikedSellers({});
      const data = result.data as { sellers: LikedSeller[] };
      return data.sellers || [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const handleSellerPress = useCallback((sellerId: string) => {
    router.push(`/user/${sellerId}` as any);
  }, []);

  const handleToggleLike = useCallback((sellerId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    toggleLike(sellerId);
  }, [toggleLike]);

  const renderSeller = useCallback(({ item, index }: { item: LikedSeller; index: number }) => (
    <SellerCard
      seller={item}
      isLiked={likedSellerIds.includes(item.id)}
      onPress={() => handleSellerPress(item.id)}
      onToggleLike={() => handleToggleLike(item.id)}
      index={index}
    />
  ), [likedSellerIds, handleSellerPress, handleToggleLike]);

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyState}>
        <Ionicons name="heart-outline" size={48} color={colors.muted} />
        <Text style={styles.emptyTitle}>Aucun vendeur suivi</Text>
        <Text style={styles.emptySubtitle}>
          Explorez les vendeurs et abonnez-vous pour les retrouver ici
        </Text>
      </View>
    );
  }, [isLoading]);

  return (
    <View testID="liked-sellers-screen" style={styles.container}>
      <ScreenHeader
        title="Vendeurs suivis"
        onBack={() => router.back()}
        rightContent={
          <View style={styles.headerRight}>
            <Text style={styles.headerCount}>{likedSellerIds.length}</Text>
          </View>
        }
      />

      {/* List */}
      {isLoading ? (
        <View style={styles.listContent}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i}>
              <View style={styles.sellerCard}>
                <Skeleton width={48} height={48} borderRadius={24} />
                <View style={[styles.sellerInfo, { gap: 6 }]}>
                  <Skeleton width="55%" height={15} />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Skeleton width={40} height={12} />
                    <Skeleton width={60} height={12} />
                    <Skeleton width={30} height={12} />
                  </View>
                </View>
                <Skeleton width={36} height={36} borderRadius={radius.full} />
              </View>
              {i < 4 && <View style={styles.separator} />}
            </View>
          ))}
        </View>
      ) : (
        <FlashList
          data={sellers}
          renderItem={renderSeller}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '300',
    color: colors.foreground,
    letterSpacing: -0.3,
  },
  headerRight: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
  },
  headerCount: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },

  // List
  listContent: {
    padding: spacing.md,
    flexGrow: 1,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },

  // Seller Card
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarFallback: {
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '600',
    color: colors.white,
  },
  sellerInfo: {
    flex: 1,
    minWidth: 0,
  },
  sellerName: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.foreground,
    marginBottom: 4,
  },
  sellerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.foreground,
    fontWeight: '600',
  },
  statText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  statDot: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  likesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  likeButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['3xl'],
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '300',
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },

});
