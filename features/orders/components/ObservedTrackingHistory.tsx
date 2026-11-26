import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useInfiniteQuery} from '@tanstack/react-query';
import {randomUUID} from 'expo-crypto';
import {Button, Skeleton} from '@/components/ui';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {TrackingHistoryService, nextTrackingHistoryPage} from '@/services/trackingHistoryService';
import {readScopedQuery} from '@/utils/readScopedQuery';
import {colors, spacing, typography} from '@/constants/theme';
import type {Transaction} from '@/types';
import type {TrackingHistoryLeg, TrackingHistoryPageReference} from '@/types/trackingHistory';
import {TrackingTimeline} from './TrackingTimeline';
import {isSimulatedTracking, trackingPresentation, trackingSourceFrame} from '../lib/trackingPresentation';

/** Pure observation: this reader never invokes the provider-refresh mutation. */
export function ObservedTrackingHistory({transaction, leg, fullPage = false}: {transaction: Transaction; leg: TrackingHistoryLeg; fullPage?: boolean}) {
  const uid = useAuthenticatedUid(), generation = getAuthSessionGeneration();
  const simulation = isSimulatedTracking(transaction, leg);
  const scope = trackingSourceFrame(transaction, leg);
  const context = useShippingPurchaseContext(`observed-tracking:${scope}`, uid);
  const [readInstance] = useState(() => randomUUID());
  const participant = !!uid && (uid === transaction.buyerId || uid === transaction.sellerId);
  const history = useInfiniteQuery({
    queryKey: ['observed-tracking-history', readInstance, uid, generation, scope, context.focusRevision],
    enabled: participant && context.focused && transaction.deliveryType === 'shipping',
    staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: undefined as TrackingHistoryPageReference | undefined,
    queryFn: ({pageParam, signal}) => readScopedQuery(signal, () => {
      const operation = context.capture();
      return () => context.assertCurrent(operation);
    }, current => TrackingHistoryService.read(uid!, transaction.id, leg, pageParam, current, simulation)),
    getNextPageParam: nextTrackingHistoryPage,
  });
  const ready = participant && context.focused && !!history.data && !history.isRefetching && !history.isError;
  const pages = ready ? history.data?.pages ?? [] : [];
  const capture = pages[0]?.capture ?? null;
  const events = pages.flatMap(page => page.events.items);
  const sameCapture = !!capture && pages.every(page => page.ownerId === uid && page.transactionId === transaction.id && page.leg === leg &&
    page.capture?.captureId === capture.captureId && page.capture.sourceHash === capture.sourceHash && page.capture.readVersion === capture.readVersion &&
    page.capture.displayHash === capture.displayHash && page.capture.currentCapture === true && page.capture.totalEvents === capture.totalEvents) &&
    events.every((event, index) => event.index === index);
  const unrecorded = pages.length === 1 && pages[0].capture === null && pages[0].reason === 'unrecorded';
  const current = sameCapture && capture?.currentCapture === true;
  const refresh = () => {
    try {context.capture(); if (!history.isFetching) void history.refetch();} catch { /* Departed scope cannot read. */ }
  };
  if (!context.focused || !participant || history.isPending || history.isRefetching) return <View style={styles.state}>
    <Skeleton width="100%" height={spacing['4xl']} />
    <Text style={styles.caption}>Chargement du suivi…</Text>
  </View>;
  if (!ready || !current && !unrecorded) return <View style={styles.state}>
    <Text accessibilityRole="alert" style={styles.body}>{history.isError ? 'Impossible de charger le suivi.' : 'Le suivi doit être actualisé.'}</Text>
    <Button variant="secondary" disabled={history.isFetching} onPress={refresh}>Réessayer</Button>
  </View>;
  return <View style={[styles.container, !fullPage && styles.embedded]}>
    <TrackingTimeline {...trackingPresentation(transaction, leg, current ? capture : null, current ? events : [])}
      hasMore={current && history.hasNextPage} isLoadingMore={history.isFetchingNextPage}
      onLoadMore={() => {
        try {context.capture(); if (!history.isFetching && history.hasNextPage) void history.fetchNextPage();} catch { /* Same native capture only. */ }
      }} />
  </View>;
}

const styles = StyleSheet.create({
  container: {flex: 1},
  embedded: {height: spacing['4xl'] * 6, flex: 0},
  state: {padding: spacing.lg, gap: spacing.lg},
  body: {...typography.body, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted},
});
