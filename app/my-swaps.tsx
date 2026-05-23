/**
 * My Swaps Screen
 * Design System: Seconde UI Kit — Editorial Luxe
 * Supports multi-article swaps with stacked image previews
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { useUser } from '@/contexts/AuthContext';
import { getUserSwaps, getSwapItems } from '@/services/swapService';
import { queryKeys } from '@/lib/queryKeys';
import { Swap, SwapStatus, SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, Button } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDisplayName } from '@/utils/formatName';
import { formatPrice } from '@/utils/formatPrice';

const STATUS_LABELS: Record<SwapStatus, string> = {
  proposed: 'En attente',
  accepted: 'Accepté',
  declined: 'Refusé',
  cancelled: 'Annulé',
  photos_pending: 'Photos',
  shipping: 'Envoi',
  completed: 'Terminé',
  disputed: 'Litige',
};

const STATUS_COLORS: Record<SwapStatus, string> = {
  proposed: colors.warning,
  accepted: colors.sage,
  declined: colors.danger,
  cancelled: colors.muted,
  photos_pending: colors.primary,
  shipping: colors.secondary,
  completed: colors.sage,
  disputed: colors.danger,
};


const getTotalValue = (items: SwapItemInfo[]): number => {
  return items.reduce((sum, item) => sum + (item.price || 0), 0);
};

type FilterType = 'all' | 'pending' | 'active' | 'completed';

export default function MySwapsScreen() {
  const user = useUser();
  const [filter, setFilter] = useState<FilterType>('all');

  const {
    data: swaps = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: queryKeys.swaps.userList(user?.id || ''),
    queryFn: () => getUserSwaps(user!.id),
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });

  const filteredSwaps = swaps.filter((swap) => {
    switch (filter) {
      case 'pending':
        return swap.status === 'proposed';
      case 'active':
        return ['accepted', 'photos_pending', 'shipping'].includes(swap.status);
      case 'completed':
        return ['completed', 'declined', 'cancelled'].includes(swap.status);
      default:
        return true;
    }
  });

  const pendingCount = swaps.filter((s) => s.status === 'proposed').length;
  const activeCount = swaps.filter((s) =>
    ['accepted', 'photos_pending', 'shipping'].includes(s.status)
  ).length;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Mes échanges' }} />
        {/* Filter tabs skeleton */}
        <View style={styles.filterContainer}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width="22%" height={28} borderRadius={radius.full} />
          ))}
        </View>
        {/* Swap cards skeleton */}
        <View style={styles.skeletonList}>
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} style={styles.skeletonSwapCard}>
              {/* Header: avatar + name + status */}
              <View style={styles.skeletonSwapHeader}>
                <View style={styles.skeletonSwapUser}>
                  <Skeleton width={32} height={32} borderRadius={16} />
                  <Skeleton width={90} height={14} />
                </View>
                <Skeleton width={64} height={22} borderRadius={radius.full} />
              </View>
              {/* Two images + swap icon */}
              <View style={styles.skeletonSwapImages}>
                <Skeleton width={80} height={80} borderRadius={0} />
                <Skeleton width={36} height={36} borderRadius={18} />
                <Skeleton width={80} height={80} borderRadius={0} />
              </View>
              {/* Footer: prices + date */}
              <View style={styles.skeletonSwapFooter}>
                <Skeleton width="50%" height={13} />
                <Skeleton width={50} height={11} />
              </View>
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Mes échanges',
          headerBackTitle: 'Retour',
        }}
      />

      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        <FilterTab
          label="Tous"
          isActive={filter === 'all'}
          onPress={() => setFilter('all')}
        />
        <FilterTab
          label="En attente"
          isActive={filter === 'pending'}
          onPress={() => setFilter('pending')}
          badge={pendingCount > 0 ? pendingCount : undefined}
        />
        <FilterTab
          label="En cours"
          isActive={filter === 'active'}
          onPress={() => setFilter('active')}
          badge={activeCount > 0 ? activeCount : undefined}
        />
        <FilterTab
          label="Historique"
          isActive={filter === 'completed'}
          onPress={() => setFilter('completed')}
        />
      </View>

      <FlashList
        data={filteredSwaps}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SwapCard swap={item} currentUserId={user?.id || ''} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="swap-horizontal-outline" size={60} color={colors.muted} />
            <Text variant="h3" style={styles.emptyTitle}>Aucun échange</Text>
            <Caption style={styles.emptyText}>
              {filter === 'all'
                ? "Tu n'as pas encore d'échanges. Participe à une Swap Party pour commencer !"
                : 'Aucun échange dans cette catégorie.'}
            </Caption>
            {filter === 'all' && (
              <Button
                variant="primary"
                onPress={() => router.push('/swap-parties')}
                style={styles.ctaButton}
              >
                Voir les Swap Parties
              </Button>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}

/**
 * Filter Tab Component
 */
function FilterTab({
  label,
  isActive,
  onPress,
  badge,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.filterTab, isActive && styles.filterTabActive, pressed && { opacity: 0.7 }]}
      onPress={onPress}
    >
      <Text
        variant="caption"
        style={[styles.filterTabText, isActive && styles.filterTabTextActive]}
      >
        {label}
      </Text>
      {badge !== undefined && (
        <View style={styles.badge}>
          <Text variant="caption" style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Stacked Images Component for Multi-Article Display
 */
function StackedImages({ items, maxDisplay = 3 }: { items: SwapItemInfo[]; maxDisplay?: number }) {
  const displayCount = Math.min(items.length, maxDisplay);
  const overflowCount = items.length - displayCount;

  return (
    <View style={styles.stackedImagesContainer}>
      {items.slice(0, displayCount).map((item, index) => (
        <View
          key={`${item.articleId}-${index}`}
          style={[
            styles.stackedImage,
            {
              transform: [
                { translateX: index * 20 },
              ],
              zIndex: displayCount - index,
              marginRight: index === displayCount - 1 ? 0 : -20,
            },
          ]}
        >
          <Image
            source={{ uri: item.imageUrl || '' }}
            style={styles.itemImage}
          />
        </View>
      ))}
      {overflowCount > 0 && (
        <View style={[styles.stackedImage, styles.overflowBadge]}>
          <Text variant="caption" style={styles.overflowText}>
            +{overflowCount}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * Swap Card Component
 * Supports both single and multi-article swaps
 */
function SwapCard({
  swap,
  currentUserId,
}: {
  swap: Swap;
  currentUserId: string;
}) {
  const isInitiator = swap.initiatorId === currentUserId;
  const otherUser = isInitiator
    ? { name: swap.receiverName, image: swap.receiverImage }
    : { name: swap.initiatorName, image: swap.initiatorImage };

  // Support both multi-article and legacy single-article format
  const myItems = isInitiator ? getSwapItems(swap, 'initiator') : getSwapItems(swap, 'receiver');
  const theirItems = isInitiator ? getSwapItems(swap, 'receiver') : getSwapItems(swap, 'initiator');

  const myTotal = getTotalValue(myItems);
  const theirTotal = getTotalValue(theirItems);

  const isMultiArticle = myItems.length > 1 || theirItems.length > 1;

  const handlePress = () => {
    router.push(`/swap/${swap.id}`);
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return "Aujourd'hui";
    } else if (days === 1) {
      return 'Hier';
    } else if (days < 7) {
      return `Il y a ${days} jours`;
    } else {
      return date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
      });
    }
  };

  return (
    <Pressable style={({ pressed }) => [styles.swapCard, pressed && { opacity: 0.7 }]} onPress={handlePress}>
      <View style={styles.swapHeader}>
        <View style={styles.userInfo}>
          {otherUser.image ? (
            <Image source={{ uri: otherUser.image }} style={styles.userAvatar} />
          ) : (
            <View style={styles.userAvatarPlaceholder}>
              <Ionicons name="person" size={16} color={colors.muted} />
            </View>
          )}
          <Text variant="body" style={styles.userName}>{formatDisplayName(otherUser.name)}</Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: STATUS_COLORS[swap.status] + '20' },
          ]}
        >
          <Text
            variant="caption"
            style={[styles.statusBadgeText, { color: STATUS_COLORS[swap.status] }]}
          >
            {STATUS_LABELS[swap.status]}
          </Text>
        </View>
      </View>

      <View style={styles.itemsRow}>
        {isMultiArticle ? (
          <>
            <StackedImages items={myItems} />
            <View style={styles.swapIconSmall}>
              <Ionicons name="swap-horizontal" size={14} color={colors.cream} />
            </View>
            <StackedImages items={theirItems} />
          </>
        ) : (
          <>
            <Image
              source={{ uri: myItems[0]?.imageUrl || '' }}
              style={styles.itemImage}
            />
            <View style={styles.swapIconSmall}>
              <Ionicons name="swap-horizontal" size={14} color={colors.cream} />
            </View>
            <Image
              source={{ uri: theirItems[0]?.imageUrl || '' }}
              style={styles.itemImage}
            />
          </>
        )}
      </View>

      <View style={styles.swapFooter}>
        <Text variant="body" style={styles.itemPrices}>
          {isMultiArticle
            ? `${myItems.length} article${myItems.length > 1 ? 's' : ''} · ${formatPrice(myTotal)} ↔ ${theirItems.length} article${theirItems.length > 1 ? 's' : ''} · ${formatPrice(theirTotal)}`
            : `${formatPrice(myTotal)} ↔ ${formatPrice(theirTotal)}`}
        </Text>
        <Caption style={styles.swapDate}>{formatDate(swap.createdAt)}</Caption>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skeletonList: {
    padding: spacing.md,
  },
  skeletonSwapCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  skeletonSwapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  skeletonSwapUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  skeletonSwapImages: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  skeletonSwapFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  filterTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  filterTabActive: {
    backgroundColor: colors.secondaryLight,
  },
  filterTabText: {
    fontFamily: fonts.sansMedium,
    color: colors.foregroundSecondary,
    fontSize: 13,
  },
  filterTabTextActive: {
    color: colors.secondary,
  },
  badge: {
    backgroundColor: colors.danger,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  badgeText: {
    fontFamily: fonts.sansMedium,
    color: colors.white,
    fontSize: 10,
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing['3xl'],
    paddingHorizontal: spacing['2xl'],
  },
  emptyTitle: {
    fontFamily: fonts.displayMedium,
    color: colors.foreground,
    marginTop: spacing.md,
  },
  emptyText: {
    fontFamily: fonts.sans,
    color: colors.foregroundSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  ctaButton: {
    marginTop: spacing.lg,
  },
  swapCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.none,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  swapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceWarm,
  },
  userAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userName: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    fontSize: 14,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  statusBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
  },
  itemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  stackedImagesContainer: {
    position: 'relative',
    width: 100,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackedImage: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: radius.none,
    backgroundColor: colors.surfaceWarm,
  },
  overflowBadge: {
    width: 80,
    height: 80,
    borderRadius: radius.none,
    backgroundColor: colors.surfaceWarm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overflowText: {
    fontFamily: fonts.sansMedium,
    color: colors.foregroundSecondary,
    fontSize: 12,
  },
  swapIconSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.charcoal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swapFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemPrices: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    fontSize: 13,
    flex: 1,
  },
  swapDate: {
    fontFamily: fonts.sans,
    color: colors.foregroundSecondary,
    fontSize: 11,
  },
});
