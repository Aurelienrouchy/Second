import {useEffect, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {Button, ScreenHeader, Skeleton} from '@/components/ui';
import {ObservedTrackingHistory} from '@/features/orders';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {TransactionService} from '@/services/transactionService';
import {getAuthSessionGeneration} from '@/store/authStore';
import {readScopedQuery} from '@/utils/readScopedQuery';
import {colors, components, fonts, sizing, spacing, typography} from '@/constants/theme';
import type {TrackingHistoryLeg} from '@/types/trackingHistory';

/** Existing-party tracking access is independent from new purchase admission. */
export default function OrderTrackingScreen() {
  const params = useLocalSearchParams<{id?: string | string[]; leg?: string | string[]}>();
  const router = useRouter(), uid = useAuthenticatedUid(), generation = getAuthSessionGeneration();
  const id = typeof params.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(params.id) ? params.id : null;
  const requestedLeg = params.leg === undefined ? 'forward' : params.leg;
  const validLeg = requestedLeg === 'forward' || requestedLeg === 'return';
  const context = useShippingPurchaseContext(JSON.stringify(['order-tracking', id, requestedLeg]), uid);
  const selectionKey = JSON.stringify([uid, generation, id, requestedLeg]);
  const [selection, setSelection] = useState<{key: string; leg: TrackingHistoryLeg} | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const orderQuery = useQuery({
    queryKey: ['native-order-tracking', uid, generation, id, context.focusRevision, refreshRevision],
    enabled: !!uid && !!id && validLeg && context.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture();
      return () => context.assertCurrent(operation);
    }, async current => {
      const order = await TransactionService.getTransaction(id!, {expectedUid: uid!, assertCurrent: current});
      current();
      if (!order || order.id !== id || ![order.buyerId, order.sellerId].includes(uid!) || order.deliveryType !== 'shipping') {
        throw new Error('Cette livraison est indisponible.');
      }
      return order;
    }),
  });
  // Firestore observation only: an update re-reads the order and its exact capture.
  useEffect(() => {
    if (!uid || !id || !validLeg || !context.focused) return;
    let current: () => void;
    try {const operation = context.capture(); current = () => context.assertCurrent(operation);} catch {return;}
    const updated = () => {
      try {current(); void orderQuery.refetch();} catch { /* Previous session/page cannot refresh. */ }
    };
    return TransactionService.subscribeToTransaction(id, updated, updated);
  // The captured methods belong to this frame. The returned object changes on
  // every read, so depending on it would reconnect the listener repeatedly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, id, validLeg, context.frame, context.focusRevision, context.focused, orderQuery.refetch]);
  const order = context.focused && !orderQuery.isFetching && !orderQuery.isError && orderQuery.data?.id === id &&
    [orderQuery.data.buyerId, orderQuery.data.sellerId].includes(uid ?? '') ? orderQuery.data : null;
  const hasReturn = !!order && (!!order.returnLabelId || !!order.returnRequest || order.status === 'return_requested');
  const leg: TrackingHistoryLeg = selection?.key === selectionKey ? selection.leg : requestedLeg === 'return' ? 'return' : 'forward';
  const back = () => {
    if (router.canGoBack()) router.back();
    else if (id) router.replace({pathname: '/orders/[id]', params: {id}});
    else router.replace('/my-orders');
  };
  const refreshing = orderQuery.isFetching;
  const refresh = () => {
    try {context.capture(); if (!refreshing) setRefreshRevision(value => value + 1);} catch { /* Original owner only. */ }
  };
  const selectLeg = (next: TrackingHistoryLeg) => {
    try {context.capture(); if (id) setSelection({key: selectionKey, leg: next});} catch { /* Original owner only. */ }
  };
  return <View style={styles.container}>
    <ScreenHeader title={leg === 'return' ? 'Suivi du retour' : 'Suivi du colis'} onBack={back} showBorder={false}
      rightContent={!!uid && !!id && validLeg ? <Pressable accessibilityRole="button" accessibilityLabel="Actualiser le suivi"
        accessibilityState={{busy: refreshing, disabled: refreshing || !context.focused}}
        disabled={refreshing || !context.focused} onPress={refresh} style={styles.headerAction}>
        {refreshing ? <ActivityIndicator size="small" color={colors.foreground}/> : <Ionicons name="refresh-outline" size={spacing.lg} color={colors.foreground}/>}
      </Pressable> : null}/>
    {order ? <>
      {hasReturn ? <View style={styles.tabs} accessibilityRole="tablist">
        {(['forward', 'return'] as const).map(value => <Pressable key={value} accessibilityRole="tab"
          accessibilityState={{selected: leg === value}} onPress={() => selectLeg(value)}
          style={[styles.tab, leg === value && styles.tabSelected]}>
          <Text style={[styles.tabText, leg === value && styles.tabTextSelected]}>{value === 'forward' ? 'Envoi' : 'Retour'}</Text>
        </Pressable>)}
      </View> : null}
      <ObservedTrackingHistory key={`${id}:${leg}:${refreshRevision}`} transaction={order} leg={leg} fullPage/>
    </> : !!uid && !!id && validLeg && !orderQuery.isError && (orderQuery.isPending || refreshing) ? <View style={styles.state}>
      <Skeleton width="100%" height={spacing['4xl']}/><Skeleton width="100%" height={spacing['4xl']}/>
    </View> : <View style={styles.state}>
      <Text style={styles.title}>{!uid ? 'Connectez-vous pour voir le suivi' : 'Ce suivi est indisponible'}</Text>
      {uid && id && validLeg ? <Button variant="secondary" onPress={refresh}>Réessayer</Button> : null}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  headerAction: {width: sizing.minTouchTarget, height: sizing.minTouchTarget, alignItems: 'center', justifyContent: 'center'},
  state: {padding: spacing.lg, gap: spacing.lg},
  title: {...typography.h2, color: colors.foreground},
  tabs: {flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md},
  tab: {...components.button.container, ...components.button.secondary, flex: 1},
  tabSelected: {...components.button.primary},
  tabText: {...typography.bodySmall, fontFamily: fonts.sansMedium, color: colors.muted},
  tabTextSelected: {color: colors.foreground},
});
