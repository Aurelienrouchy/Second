import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthenticatedUid, useIsLoading } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { readScopedQuery } from '@/utils/readScopedQuery';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { auth } from '@/config/firebaseConfig';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { getUserSwaps } from '@/services/swapService';
import { SwapListCard } from '@/features/swap';
import { queryKeys } from '@/lib/queryKeys';
import { track } from '@/lib/analytics';
import { Swap } from '@/types';
import {
  colors,
  fonts,
  spacing,
  radius,
  sizing,
  typography,
  components,
} from '@/constants/theme';
import { Text, Button, ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';

type FilterType = 'all' | 'pending' | 'active' | 'completed';
const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'pending', label: 'En attente' },
  { value: 'active', label: 'En cours' },
  { value: 'completed', label: 'Historique' },
];
function matchesFilter(swap: Swap, filter: FilterType): boolean {
  if (filter === 'pending') return swap.status === 'proposed';
  if (filter === 'active')
    return [
      'payment_pending',
      'accepted',
      'photos_pending',
      'shipping',
      'disputed',
    ].includes(swap.status);
  if (filter === 'completed')
    return ['completed', 'declined', 'cancelled', 'expired'].includes(
      swap.status,
    );
  return true;
}
const backToExchanges = () =>
  router.canGoBack() ? router.back() : router.replace('/swap-zone');
const browseExchanges = () =>
  router.push({ pathname: '/swap-zone', params: { source: 'my_swaps_empty' } });
interface OwnerSwapListItem {
  swap: Swap;
  ownerUid: string;
  assertCanOpen: () => void;
}
const renderSwap = ({ item }: { item: OwnerSwapListItem }) => (
  <SwapListCard swap={item.swap} currentUserId={item.ownerUid} assertCanOpen={item.assertCanOpen} />
);
const swapKey = (item: OwnerSwapListItem) => item.swap.id;

export default function MySwapsScreen() {
  const uid = useAuthenticatedUid();
  const generation = useAuthStore(getAuthSessionGeneration);
  const context = useLabelLifecycleContext('historical-owner-swaps', uid);
  const client = useQueryClient();
  const isAuthLoading = useIsLoading();
  const [filter, setFilter] = useState<FilterType>('all');
  const listKey = [...queryKeys.swaps.userList(uid ?? ''), generation, context.focusRevision];
  const list = useQuery({
    queryKey: listKey,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture();
      return () => context.assertCurrent(operation);
    }, assertCurrent => getUserSwaps(uid!, {expectedUid: uid!, assertCurrent})),
    enabled: !!uid && context.focused,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
  });
  const {
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = list;
  // A new UID, SDK generation, focus or activity epoch gets its own server
  // query. Previous private rows are hidden during refresh and after refusal.
  const renderOperation = (() => {
    try {return context.capture();} catch {return null;}
  })();
  const ready = !!renderOperation && !!uid && context.focused && list.isSuccess && list.fetchStatus === 'idle' && !list.isError &&
    client.getQueryState(listKey)?.isInvalidated === false;
  const swaps = ready ? list.data ?? [] : [];
  const currentFrame = () => {
    if (!renderOperation) throw new Error('Relisez vos échanges dans la connexion active.');
    context.assertCurrent(renderOperation);
  };
  const currentList = () => {
    currentFrame();
    const state = client.getQueryState(listKey);
    if (!ready || !state || state.status !== 'success' || state.error !== null || state.fetchStatus !== 'idle' || state.isInvalidated ||
      state.data !== list.data || state.dataUpdatedAt !== list.dataUpdatedAt) throw new Error('La liste des échanges doit être relue.');
  };
  const filteredSwaps = swaps.filter((swap) => matchesFilter(swap, filter));
  const listItems = filteredSwaps.map(swap => ({swap, ownerUid: uid ?? '', assertCanOpen: currentList}));
  const selectFilter = (next: FilterType) => {
    try {currentList();} catch {return;}
    setFilter(next);
    track('list_filtered', {
      screen: 'my_swaps',
      filter: next,
      filtered_count: swaps.filter((swap) => matchesFilter(swap, next))
        .length,
    });
  };
  const refresh = () => {
    try {currentFrame();} catch {return;}
    track('list_refreshed', {
      screen: 'my_swaps',
      items_count: filteredSwaps.length,
    });
    void refetch();
  };
  const header = (
    <ScreenHeader
      title="Mes échanges"
      titleStyle={styles.headerTitle}
      onBack={backToExchanges}
      backgroundColor={colors.background}
    />
  );
  if (!uid && !isAuthLoading)
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {header}
        <ScrollView contentContainerStyle={styles.stateContainer}>
          <Text style={styles.stateTitle}>Vos échanges, au même endroit</Text>
          <Text style={styles.stateBody}>
            Connectez-vous pour retrouver vos propositions et suivre la remise
            de vos articles.
          </Text>
          <Button
            style={styles.cta}
            onPress={() => {
              if (getAuthSessionGeneration() !== generation || auth.currentUser?.uid) return;
              useAuthSheetStore.getState().show(
                'Connectez-vous pour retrouver vos échanges',
                undefined,
                { source: 'my_swaps', gateKey: 'my_swaps' },
              );
            }}
          >
            Se connecter
          </Button>
          <Button variant="ghost" style={styles.cta} onPress={browseExchanges}>
            Découvrir les articles
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  if (!uid || !context.focused || isLoading || !ready && !isError)
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {header}
        <ScrollView
          contentContainerStyle={styles.listContent}
          accessibilityLabel="Chargement des échanges"
        >
          {[0, 1, 2].map((index) => (
            <View key={index} style={styles.skeletonCard}>
              <Skeleton width="65%" height={22} />
              <Skeleton width="85%" height={17} />
              <View style={styles.previewRow}>
                <Skeleton width="45%" height={120} borderRadius={radius.lg} />
                <Skeleton width="45%" height={120} borderRadius={radius.lg} />
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  if (isError)
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {header}
        <ScrollView contentContainerStyle={styles.stateContainer}>
          <Text style={styles.stateTitle}>
            Vos échanges n’ont pas pu être chargés
          </Text>
          <Text style={styles.stateBody}>
            Vérifiez votre connexion, puis réessayez.
          </Text>
          <Button
            style={styles.cta}
            loading={isRefetching}
            onPress={() => {
              try {currentFrame();} catch {return;}
              track('error_retry_tapped', {
                screen: 'my_swaps',
                error_context: 'my_swaps_load',
              });
              void refetch();
            }}
          >
            Réessayer
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {header}
      <ScrollView
        testID="swap-filters"
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map(({ value, label }) => {
          const count = swaps.filter((swap) =>
            matchesFilter(swap, value),
          ).length;
          return (
            <Pressable
              key={value}
              style={({ pressed }) => [
                styles.filter,
                filter === value && styles.filterActive,
                pressed && styles.pressed,
              ]}
              onPress={() => selectFilter(value)}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${count} échange${count > 1 ? 's' : ''}`}
              accessibilityState={{ selected: filter === value }}
            >
              <Text
                style={[
                  styles.filterText,
                  filter === value && styles.filterTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <FlashList
        data={listItems}
        keyExtractor={swapKey}
        renderItem={renderSwap}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.stateTitle}>
              {filter === 'all'
                ? 'Votre premier échange commence ici'
                : 'Aucun échange dans cette catégorie'}
            </Text>
            <Text style={styles.stateBody}>
              {filter === 'all'
                ? 'Découvrez les articles disponibles et proposez un échange avec un membre.'
                : 'Vos autres échanges restent disponibles dans Tous.'}
            </Text>
            <Button
              style={styles.cta}
              onPress={
                filter === 'all' ? browseExchanges : () => selectFilter('all')
              }
            >
              {filter === 'all'
                ? 'Découvrir les articles'
                : 'Voir tous mes échanges'}
            </Button>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerTitle: { ...typography.trocScreenTitle },
  container: { flex: 1, backgroundColor: colors.background },
  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filter: {
    minHeight: sizing.minTouchTarget,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    borderBottomWidth: components.troc.borderWidth,
    borderBottomColor: colors.transparent,
  },
  filterActive: { borderBottomColor: colors.foreground },
  filterText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 20,
    color: colors.foregroundSecondary,
  },
  filterTextActive: { color: colors.foreground, fontFamily: fonts.sansBold },
  listContent: { padding: spacing.md, paddingBottom: spacing.xl },
  previewRow: { flexDirection: 'row', gap: spacing.md },
  skeletonCard: {
    padding: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.none,
  },
  stateContainer: {
    flexGrow: 1,
    alignItems: 'center',
    padding: spacing.lg,
    justifyContent: 'center',
    gap: spacing.md,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: spacing.md,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  stateTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 29,
    lineHeight: 34,
    color: colors.foreground,
    textAlign: 'center',
  },
  stateBody: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.foregroundSecondary,
    textAlign: 'center',
  },
  cta: {
    height: 'auto',
    minHeight: sizing.buttonHeight,
    paddingVertical: spacing.md,
    maxWidth: '100%',
    borderRadius: radius.none,
    backgroundColor: colors.primaryDark,
  },
  pressed: { opacity: 0.7 },
});
