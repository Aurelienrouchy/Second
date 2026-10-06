import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, RefreshControl, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { useUser, useIsLoading } from '@/hooks/useAuth';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { getUserSwaps, getSwapItems } from '@/services/swapService';
import { getSwapStatusLabel, getSwapNextStep } from '@/features/swap';
import { queryKeys } from '@/lib/queryKeys';
import { track } from '@/lib/analytics';
import { Swap, SwapItemInfo } from '@/types';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { Text, Button, ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDisplayName } from '@/utils/formatName';
import { formatPriceWithCurrency } from '@/utils/formatPrice';

type FilterType = 'all' | 'pending' | 'active' | 'completed';
const FILTERS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'Tous' }, { value: 'pending', label: 'En attente' },
  { value: 'active', label: 'En cours' }, { value: 'completed', label: 'Historique' },
];
function matchesFilter(swap: Swap, filter: FilterType): boolean {
  if (filter === 'pending') return swap.status === 'proposed';
  if (filter === 'active') return ['payment_pending', 'accepted', 'photos_pending', 'shipping', 'disputed'].includes(swap.status);
  if (filter === 'completed') return ['completed', 'declined', 'cancelled', 'expired'].includes(swap.status);
  return true;
}
const backToExchanges = () => router.canGoBack() ? router.back() : router.replace('/swap-zone');
const browseExchanges = () => router.push({ pathname: '/swap-zone', params: { source: 'my_swaps_empty' } });

export default function MySwapsScreen() {
  const user = useUser();
  const isAuthLoading = useIsLoading();
  const showAuth = useAuthSheetStore(state => state.show);
  const [filter, setFilter] = useState<FilterType>('all');
  const { data: swaps = [], isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.swaps.userList(user?.id || ''),
    queryFn: () => getUserSwaps(user!.id),
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });
  const filteredSwaps = useMemo(() => swaps.filter(swap => matchesFilter(swap, filter)), [swaps, filter]);
  const selectFilter = useCallback((next: FilterType) => {
    setFilter(next);
    track('list_filtered', { screen: 'my_swaps', filter: next, filtered_count: swaps.filter(swap => matchesFilter(swap, next)).length });
  }, [swaps]);
  const refresh = useCallback(() => {
    track('list_refreshed', { screen: 'my_swaps', items_count: filteredSwaps.length });
    void refetch();
  }, [refetch, filteredSwaps.length]);
  const renderSwap = useCallback(({ item }: { item: Swap }) => <SwapCard swap={item} currentUserId={user?.id || ''} />, [user?.id]);

  const header = <ScreenHeader title="Mes échanges" onBack={backToExchanges} backgroundColor={colors.background} topContent={<Text style={styles.eyebrow}>Espace échanges</Text>} />;
  if (!user && !isAuthLoading) return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {header}
      <ScrollView contentContainerStyle={styles.stateContainer}>
        <Ionicons name="swap-horizontal-outline" size={44} color={colors.primary} />
        <Text style={styles.stateTitle}>Vos échanges, au même endroit</Text>
        <Text style={styles.stateBody}>Connectez-vous pour retrouver vos propositions et suivre la remise de vos articles.</Text>
        <Button style={styles.cta} onPress={() => showAuth('Connectez-vous pour retrouver vos échanges', undefined, { source: 'my_swaps', gateKey: 'my_swaps' })}>Se connecter</Button>
        <Button variant="ghost" style={styles.cta} onPress={browseExchanges}>Découvrir les articles</Button>
      </ScrollView>
    </SafeAreaView>
  );
  if (isAuthLoading || isLoading) return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {header}
      <ScrollView contentContainerStyle={styles.listContent} accessibilityLabel="Chargement des échanges">
        {[0, 1, 2].map(index => <View key={index} style={styles.skeletonCard}><Skeleton width="65%" height={22} /><Skeleton width="85%" height={17} /><View style={styles.previewRow}><Skeleton width="45%" height={120} borderRadius={radius.lg} /><Skeleton width="45%" height={120} borderRadius={radius.lg} /></View></View>)}
      </ScrollView>
    </SafeAreaView>
  );
  if (isError) return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {header}
      <ScrollView contentContainerStyle={styles.stateContainer}>
        <Ionicons name="cloud-offline-outline" size={44} color={colors.primary} />
        <Text style={styles.stateTitle}>Vos échanges n’ont pas pu être chargés</Text>
        <Text style={styles.stateBody}>Vérifiez votre connexion, puis réessayez.</Text>
        <Button style={styles.cta} loading={isRefetching} onPress={() => { track('error_retry_tapped', { screen: 'my_swaps', error_context: 'my_swaps_load' }); void refetch(); }}>Réessayer</Button>
      </ScrollView>
    </SafeAreaView>
  );
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {header}
      <ScrollView testID="swap-filters" horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
        {FILTERS.map(({ value, label }) => {
          const count = swaps.filter(swap => matchesFilter(swap, value)).length;
          return <Pressable key={value} style={({ pressed }) => [styles.filter, filter === value && styles.filterActive, pressed && styles.pressed]} onPress={() => selectFilter(value)} accessibilityRole="button" accessibilityLabel={`${label}, ${count} échange${count > 1 ? 's' : ''}`} accessibilityState={{ selected: filter === value }}><Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{label}</Text></Pressable>;
        })}
      </ScrollView>
      <FlashList
        data={filteredSwaps}
        keyExtractor={item => item.id}
        renderItem={renderSwap}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refresh} tintColor={colors.primary} />}
        ListEmptyComponent={<View style={styles.emptyContainer}>
          <Ionicons name="swap-horizontal-outline" size={44} color={colors.primary} />
          <Text style={styles.stateTitle}>{filter === 'all' ? 'Votre premier échange commence ici' : 'Aucun échange dans cette catégorie'}</Text>
          <Text style={styles.stateBody}>{filter === 'all' ? 'Découvrez les articles disponibles et proposez un échange avec un membre.' : 'Vos autres échanges restent disponibles dans Tous.'}</Text>
          <Button style={styles.cta} onPress={filter === 'all' ? browseExchanges : () => selectFilter('all')}>{filter === 'all' ? 'Découvrir les articles' : 'Voir tous mes échanges'}</Button>
        </View>}
      />
    </SafeAreaView>
  );
}

function ItemPreview({ items, label }: { items: SwapItemInfo[]; label: string }) {
  const first = items[0];
  return <View style={styles.preview}>
    <Text style={styles.previewLabel}>{label}</Text>
    <View style={styles.imageFrame}>{first?.imageUrl ? <Image source={{ uri: first.imageUrl }} style={styles.itemImage} contentFit="cover" accessibilityLabel={first.title} /> : <Ionicons name="image-outline" size={28} color={colors.muted} />}</View>
    <Text style={styles.itemTitle} numberOfLines={2}>{first?.title || 'Article indisponible'}</Text>
    {items.length > 1 && <Text style={styles.caption}>+ {items.length - 1} autre{items.length > 2 ? 's' : ''} article{items.length > 2 ? 's' : ''}</Text>}
    {!!items.length && <Text style={styles.caption}>{formatPriceWithCurrency(items.reduce((sum, item) => sum + (item.price || 0), 0)).replace(/ /g, '\u00A0')}</Text>}
  </View>;
}

const SwapCard = React.memo(function SwapCard({ swap, currentUserId }: { swap: Swap; currentUserId: string }) {
  const isInitiator = swap.initiatorId === currentUserId;
  const name = formatDisplayName(isInitiator ? swap.receiverName : swap.initiatorName);
  const image = isInitiator ? swap.receiverImage : swap.initiatorImage;
  const myItems = getSwapItems(swap, isInitiator ? 'initiator' : 'receiver');
  const theirItems = getSwapItems(swap, isInitiator ? 'receiver' : 'initiator');
  const label = getSwapStatusLabel(swap.status, isInitiator);
  const nextStep = getSwapNextStep(swap, currentUserId);
  const otherId = isInitiator ? swap.receiverId : swap.initiatorId;
  const payer = swap.cashTopUp?.payerId === currentUserId ? 'Vous' : swap.cashTopUp?.payerId === otherId ? name : 'Payeur à confirmer';
  const date = swap.createdAt instanceof Date && Number.isFinite(swap.createdAt.getTime()) ? swap.createdAt.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' }) : '';
  return (
    <Pressable style={({ pressed }) => [styles.swapCard, pressed && styles.pressed]} onPress={() => router.push({ pathname: '/swap/[id]', params: { id: swap.id, source: 'my_swaps' } })} accessibilityRole="button" accessibilityLabel={`Échange avec ${name.replace(/\.+$/, '')}. ${label}. ${nextStep}`}>
      <View style={styles.memberRow}>
        {image ? <Image source={{ uri: image }} style={styles.avatar} contentFit="cover" /> : <View style={styles.avatar}><Ionicons name="person-outline" size={20} color={colors.foregroundSecondary} /></View>}
        <View style={styles.memberInfo}><Text style={styles.memberName}>{name}</Text>{!!date && <Text style={styles.caption}>Proposé le {date}</Text>}</View>
        <Ionicons name="chevron-forward" size={20} color={colors.foregroundSecondary} />
      </View>
      <View style={styles.status}><Text style={styles.statusText}>{label}</Text></View>
      <Text style={styles.nextStep}>{nextStep}</Text>
      <View style={styles.previewRow}><ItemPreview items={myItems} label="Vous donnez" /><ItemPreview items={theirItems} label="Vous recevez" /></View>
      {!!swap.cashTopUp?.amount && <Text style={styles.caption}>Complément historique : {formatPriceWithCurrency(swap.cashTopUp.amount / 100).replace(/ /g, '\u00A0')} · Payeur prévu : {payer.replace(/\.+$/, '')}.</Text>}
    </Pressable>
  );
});
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 17, color: colors.foregroundSecondary, marginHorizontal: spacing.md },
  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  filter: { minHeight: sizing.minTouchTarget, paddingHorizontal: spacing.md - spacing.xs, paddingVertical: spacing.sm, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceWarm },
  filterActive: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  filterText: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 20, color: colors.foregroundSecondary },
  filterTextActive: { color: colors.cream },
  listContent: { padding: spacing.md, paddingBottom: spacing.xl },
  swapCard: { backgroundColor: colors.surfaceWarm, borderRadius: radius.xl, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 23, color: colors.foreground },
  status: { alignSelf: 'flex-start', borderRadius: radius.full, backgroundColor: colors.background, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  statusText: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 18, color: colors.primaryDark },
  nextStep: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, color: colors.foregroundSecondary },
  previewRow: { flexDirection: 'row', gap: spacing.md },
  preview: { flex: 1, minWidth: 0, gap: spacing.xs },
  previewLabel: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 18, color: colors.foreground },
  imageFrame: { width: '100%', height: 120, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  itemImage: { width: '100%', height: '100%' },
  itemTitle: { fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 19, color: colors.foreground },
  caption: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.foregroundSecondary },
  skeletonCard: { padding: spacing.md, gap: spacing.md, marginBottom: spacing.md, backgroundColor: colors.surfaceWarm, borderRadius: radius.xl },
  stateContainer: { flexGrow: 1, alignItems: 'center', padding: spacing.lg, justifyContent: 'center', gap: spacing.md },
  emptyContainer: { alignItems: 'center', padding: spacing.md, paddingTop: spacing.xl, gap: spacing.md },
  stateTitle: { fontFamily: fonts.displayMedium, fontSize: 29, lineHeight: 34, color: colors.foreground, textAlign: 'center' },
  stateBody: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 22, color: colors.foregroundSecondary, textAlign: 'center' },
  cta: { height: 'auto', minHeight: sizing.buttonHeight, paddingVertical: spacing.md, maxWidth: '100%', borderRadius: radius.xl },
  pressed: { opacity: 0.7 },
});
