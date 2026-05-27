/**
 * Swap Parties Screen — Liste des Swap Zones
 * Very dark background with cream text, sage filter tabs, and zone cards
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  Text as RNText,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useUser } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import {
  getSwapParties,
  getActiveSwapParty,
  getEndedSwapParties,
  getUserParticipatingPartyIds,
  joinSwapParty,
} from '@/services/swapService';
import { queryKeys } from '@/lib/queryKeys';
import { SwapParty } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { ZoneCard, FilterTabs } from '@/features/swap-parties';
import type { FilterTab } from '@/features/swap-parties';

export default function SwapPartiesScreen() {
  const user = useUser();
  const { requireAuth } = useAuthRequired();
  const queryClient = useQueryClient();
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
        participatingIds = await getUserParticipatingPartyIds(user.id);
      }

      return { allParties, activeParty, participatingIds };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Lazy-load ended parties only when the "Terminées" tab is selected
  const {
    data: endedParties = [],
    isLoading: isEndedLoading,
  } = useQuery({
    queryKey: [...queryKeys.swapParties.list(), 'ended'],
    queryFn: () => getEndedSwapParties(20),
    enabled: activeFilter === 'ended',
    staleTime: 10 * 60 * 1000,
  });

  const allParties = data?.allParties ?? [];
  const participatingIds = data?.participatingIds ?? new Set<string>();

  const handlePartyPress = (partyId: string) => {
    router.push(`/swap-party/${partyId}`);
  };

  const handleBackPress = () => {
    router.back();
  };

  const handleJoinParty = useCallback(async (partyId: string) => {
    if (!user) {
      requireAuth(async () => {}, AUTH_MESSAGES.swapParty);
      return;
    }
    try {
      await joinSwapParty(partyId, user.id, user.displayName || 'Utilisateur', user.profileImage);
      queryClient.invalidateQueries({ queryKey: queryKeys.swapParties.list() });
    } catch (error) {
      if (__DEV__) console.error('Error joining party:', error);
      Alert.alert('Erreur', 'Impossible de rejoindre la Swap Zone');
    }
  }, [user, requireAuth, queryClient]);

  const filteredParties = useMemo((): SwapParty[] => {
    switch (activeFilter) {
      case 'active':
        return allParties.filter((p) => p.status === 'active');
      case 'upcoming':
        return allParties.filter((p) => p.status === 'upcoming');
      case 'ended':
        return endedParties;
      case 'my':
        return allParties.filter((p) => participatingIds.has(p.id));
      case 'all':
      default:
        return allParties;
    }
  }, [activeFilter, allParties, endedParties, participatingIds]);

  if (isLoading || (activeFilter === 'ended' && isEndedLoading)) {
    return (
      <View style={styles.container}>
        <ScreenHeader
          title="Swap Parties"
          onBack={handleBackPress}
          backgroundColor="#131510"
          titleColor={colors.cream}
          backButtonColor={colors.cream}
          showBorder={false}
        />

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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Swap Parties"
        onBack={handleBackPress}
        backgroundColor="#131510"
        titleColor={colors.cream}
        backButtonColor={colors.cream}
        showBorder={false}
      />

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
                onJoin={() => handleJoinParty(zone.id)}
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
