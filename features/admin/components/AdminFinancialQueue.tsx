import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { SkeletonText } from '@/components/ui/Skeleton';
import { getAdminCapturePage, getAdminRefundPage, type AdminPaymentAnomaly } from '@/services/adminFinancialService';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { auth } from '@/config/firebaseConfig';
import type { Transaction } from '@/types/transaction';
import { colors, fonts, spacing } from '@/constants/theme';
import { AdminCaptureCard } from './AdminCaptureCard';
import { AdminRefundCard } from './AdminRefundCard';
import { AdminOrphanCaptureRefundHistory } from './AdminOrphanCaptureRefundHistory';

type QueueItem = {id: string; refund?: Transaction; capture?: AdminPaymentAnomaly};
const key = (item: QueueItem) => item.id;
export function AdminFinancialQueue({mode, userId}: {mode: 'refunds' | 'captures'; userId: string}) {
  const uid = useAuthenticatedUid();
  const renderOwner = auth.currentUser;
  const generation = getAuthSessionGeneration();
  const context = useShippingPurchaseContext(`admin-financial-queue:${mode}`, uid);
  const active = uid === userId && context.focused;
  const query = useInfiniteQuery({
    queryKey: ['admin', userId, generation, 'financial-queue', mode, context.focusRevision], initialPageParam: null as string | null,
    enabled: active, refetchOnWindowFocus: false, gcTime: 0,
    queryFn: async ({pageParam}) => {
      const operation = context.capture(), owner = auth.currentUser;
      const assertContext = () => {context.assertCurrent(operation); if (auth.currentUser !== owner) throw new Error('La connexion Firebase a changé.');};
      if (mode === 'refunds') {
        const page = await getAdminRefundPage(userId, pageParam, assertContext);
        assertContext(); return {...page, owner, items: page.items.map(refund => ({id: refund.id, refund}) as QueueItem)};
      }
      const page = await getAdminCapturePage(userId, pageParam, assertContext);
      assertContext(); return {...page, owner, items: page.items.map(capture => ({id: capture.id, capture}) as QueueItem)};
    },
    getNextPageParam: page => page.hasMore ? page.cursor : undefined, staleTime: 30_000,
  });
  const {refetch} = query;
  const refresh = useCallback(() => {if (active && auth.currentUser === renderOwner) void refetch();}, [active, refetch, renderOwner]);
  const render = useCallback(({item}: {item: QueueItem}) => item.refund ?
    <AdminRefundCard transaction={item.refund} onRefresh={refresh} /> : item.capture ?
      <AdminCaptureCard anomaly={item.capture} userId={userId} onRefresh={refresh} /> : null, [refresh, userId]);
  const items = [...new Map((query.data?.pages.flatMap(page => page.owner === auth.currentUser ? page.items : []) ?? []).map(item => [item.id, item])).values()];
  if (!active) return null;
  if (query.isLoading) return <View style={styles.loading}><SkeletonText lines={3} /></View>;
  return <View style={styles.container}>
    {mode === 'captures' ? <AdminOrphanCaptureRefundHistory uid={userId} onRecorded={refresh} /> : null}
    <Pressable accessibilityRole="button" style={styles.button} onPress={refresh}><Text style={styles.body}>Actualiser</Text></Pressable>
    {!!query.error && <Text accessibilityRole="alert" style={styles.body}>Impossible de charger les dossiers. Réessayez ; les dernières données connues restent affichées.</Text>}
    <FlashList data={items} renderItem={render} keyExtractor={key} contentContainerStyle={styles.content}
      ListEmptyComponent={!query.error ? <Text style={styles.body}>{query.hasNextPage ? 'Aucun dossier sur les pages parcourues. Poursuivez la recherche avec « Voir les suivants ».' : mode === 'refunds' ? 'Aucun remboursement à traiter sur cette file.' : 'Aucun paiement à rapprocher sur cette file.'}</Text> : null}
      ListFooterComponent={query.hasNextPage ? <Pressable accessibilityRole="button" accessibilityState={{disabled: query.isFetchingNextPage, busy: query.isFetchingNextPage}} disabled={query.isFetchingNextPage} style={styles.button} onPress={() => {void query.fetchNextPage();}}><Text style={styles.body}>Voir les suivants</Text></Pressable> : null}
    />
  </View>;
}
const styles = StyleSheet.create({
  container: {flex: 1}, loading: {padding: spacing.md}, content: {padding: spacing.md},
  button: {padding: spacing.md}, body: {fontFamily: fonts.sans, color: colors.foreground},
});
