/**
 * Swap Parties Screen — Liste des Swap Zones
 * Very dark background with cream text, sage filter tabs, and zone cards
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Text as RNText,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { useUser } from '@/contexts/AuthContext';
import {
  getSwapParties,
  getActiveSwapParty,
  isParticipant,
} from '@/services/swapService';
import { queryKeys } from '@/lib/queryKeys';
import { SwapParty } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';
import { ZoneCard, FilterTabs } from '@/features/swap-parties';
import type { FilterTab } from '@/features/swap-parties';

export default function SwapPartiesScreen() {
  const user = useUser();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const {
    data,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: [...queryKeys.swapParties.list(), user?.id ?? 'guest'],
    queryFn: async () => {
      const [activeParty, allParties] = await Promise.all([
        getActiveSwapParty(),
        getSwapParties(),
      ]);

      let participatingIds = new Set<string>();
      if (user) {
        const results = await Promise.all(
          allParties.map((party) => isParticipant(party.id, user.id))
        );
        allParties.forEach((party, i) => {
          if (results[i]) participatingIds.add(party.id);
        });
      }

      return { allParties, activeParty, participatingIds };
    },
    staleTime: 5 * 60 * 1000,
  });

  const allParties = data?.allParties ?? [];
  const participatingIds = data?.participatingIds ?? new Set<string>();

  const handlePartyPress = (partyId: string) => {
    router.push(`/swap-party/${partyId}`);
  };

  const handleBackPress = () => {
    router.back();
  };

  const filteredParties = useMemo((): SwapParty[] => {
    switch (activeFilter) {
      case 'active':
        return allParties.filter((p) => p.status === 'active');
      case 'upcoming':
        return allParties.filter((p) => p.status === 'upcoming');
      case 'my':
        return allParties.filter((p) => participatingIds.has(p.id));
      case 'all':
      default:
        return allParties;
    }
  }, [activeFilter, allParties, participatingIds]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header skeleton */}
        <View style={styles.header}>
          <Skeleton width={36} height={36} borderRadius={50} style={styles.skeletonDark} />
          <Skeleton width={140} height={24} borderRadius={radius.sm} style={styles.skeletonDark} />
        </View>

        {/* Filter tabs skeleton */}
        <View style={styles.skeletonFilterRow}>
          <Skeleton width={60} height={32} borderRadius={radius.full} style={styles.skeletonDark} />
          <Skeleton width={70} height={32} borderRadius={radius.full} style={styles.skeletonDark} />
          <Skeleton width={80} height={32} borderRadius={radius.full} style={styles.skeletonDark} />
        </View>

        {/* Zone cards skeleton */}
        <View style={styles.skeletonCards}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <Skeleton width="100%" height={200} borderRadius={radius.md} style={styles.skeletonDark} />
              <Skeleton width="60%" height={18} borderRadius={radius.sm} style={styles.skeletonDarkSpaced} />
              <Skeleton width={80} height={24} borderRadius={radius.full} style={styles.skeletonDarkSpaced} />
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={handleBackPress}>
          <Ionicons name="chevron-back" size={24} color={colors.cream} />
        </Pressable>
        <RNText style={styles.headerTitle}>Swap Zones</RNText>
      </View>

      {/* Filter Tabs */}
      <FilterTabs activeFilter={activeFilter} onFilterChange={setActiveFilter} />

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.cream}
          />
        }
      >
        {filteredParties.length > 0 ? (
          <View style={styles.cardsContainer}>
            {filteredParties.map((zone) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                isEnrolled={participatingIds.has(zone.id)}
                onPress={() => handlePartyPress(zone.id)}
                opacity={
                  zone.status === 'active'
                    ? 1
                    : zone.status === 'upcoming'
                      ? 0.9
                      : 0.6
                }
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <RNText style={styles.emptyStateText}>
              Aucune Swap Zone disponible pour ce filtre
            </RNText>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#131510',
  },
  skeletonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  skeletonDarkSpaced: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: spacing.sm,
  },
  skeletonFilterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  skeletonCards: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: 10,
  },
  skeletonCard: {
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
    backgroundColor: '#131510',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    fontWeight: '300',
    color: colors.cream,
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#131510',
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  cardsContainer: {
    gap: 10,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
  },
  emptyStateText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.cream,
    textAlign: 'center',
  },
});
