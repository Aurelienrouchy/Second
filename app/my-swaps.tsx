/**
 * My Swaps Screen
 * Design System: Luxe Français + Street Energy
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/contexts/AuthContext';
import { getUserSwaps } from '@/services/swapService';
import { Swap, SwapStatus } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, Button } from '@/components/ui';

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
  accepted: colors.success,
  declined: colors.danger,
  cancelled: colors.muted,
  photos_pending: colors.primary,
  shipping: '#5856D6',
  completed: colors.success,
  disputed: colors.danger,
};

type FilterType = 'all' | 'pending' | 'active' | 'completed';

export default function MySwapsScreen() {
  const { user } = useAuth();
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  const loadSwaps = useCallback(async () => {
    if (!user) return;

    try {
      const allSwaps = await getUserSwaps(user.id);
      setSwaps(allSwaps);
    } catch (error) {
      console.error('Error loading swaps:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    loadSwaps();
  }, [loadSwaps]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadSwaps();
  };

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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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

      <FlatList
        data={filteredSwaps}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SwapCard swap={item} currentUserId={user?.id || ''} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
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
    <TouchableOpacity
      style={[styles.filterTab, isActive && styles.filterTabActive]}
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
    </TouchableOpacity>
  );
}

/**
 * Swap Card Component
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
  const myItem = isInitiator ? swap.initiatorItem : swap.receiverItem;
  const theirItem = isInitiator ? swap.receiverItem : swap.initiatorItem;

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
    <TouchableOpacity style={styles.swapCard} onPress={handlePress}>
      <View style={styles.swapHeader}>
        <View style={styles.userInfo}>
          {otherUser.image ? (
            <Image source={{ uri: otherUser.image }} style={styles.userAvatar} />
          ) : (
            <View style={styles.userAvatarPlaceholder}>
              <Ionicons name="person" size={16} color={colors.muted} />
            </View>
          )}
          <Text variant="body" style={styles.userName}>{otherUser.name}</Text>
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
        <Image source={{ uri: myItem.imageUrl }} style={styles.itemImage} />
        <View style={styles.swapIconSmall}>
          <Ionicons name="swap-horizontal" size={14} color={colors.primary} />
        </View>
        <Image source={{ uri: theirItem.imageUrl }} style={styles.itemImage} />
      </View>

      <View style={styles.swapFooter}>
        <Text variant="body" style={styles.itemPrices}>
          {myItem.price}€ ↔ {theirItem.price}€
        </Text>
        <Caption style={styles.swapDate}>{formatDate(swap.createdAt)}</Caption>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
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
    backgroundColor: colors.primaryLight,
  },
  filterTabText: {
    fontFamily: fonts.sansMedium,
    color: colors.foregroundSecondary,
  },
  filterTabTextActive: {
    color: colors.primary,
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
    color: colors.foreground,
    marginTop: spacing.md,
  },
  emptyText: {
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
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  swapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
  },
  userAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userName: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  statusBadgeText: {
    fontFamily: fonts.sansMedium,
  },
  itemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: radius.sm,
    backgroundColor: colors.backgroundSecondary,
  },
  swapIconSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryLight,
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
  },
  swapDate: {
    color: colors.foregroundSecondary,
  },
});
