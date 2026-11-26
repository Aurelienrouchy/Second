import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button, ScreenHeader } from '@/components/ui';
import { FraudReviewEvidence } from '@/components/FraudReviewEvidence';
import { AdminSectionNav, AdminFraudReviewDecision } from '@/features/admin';
import { AdminSellerActivityFacts } from '@/features/admin';
import { colors, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { FraudReviewService } from '@/services/fraudReviewService';
import type { FraudReviewCaseSummary, FraudReviewCursor } from '@/types/fraudReview';

const keyExtractor = (item: FraudReviewCaseSummary) => item.caseId;
export default function AdminFraudReviewsScreen() {
  const router = useRouter(), uid = useAuthenticatedUid();
  const context = useShippingPurchaseContext('admin-fraud-review', uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision]);
  const [selection, setSelection] = useState<{key: string; item: Pick<FraudReviewCaseSummary, 'caseId' | 'transactionId' | 'source'>} | null>(null);
  const selected = selection?.key === key ? selection.item : null;
  const cases = useInfiniteQuery({queryKey: ['admin-fraud-cases', key], enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: null as FraudReviewCursor | null,
    queryFn: ({pageParam}) => {const operation = context.capture(); return FraudReviewService.list(operation.session.uid, 'admin', null, pageParam, () => context.assertCurrent(operation));},
    getNextPageParam: page => page.pagination.hasMore ? page.pagination.nextCursor ?? undefined : undefined});
  const detailContext = useShippingPurchaseContext(JSON.stringify(['admin-fraud-detail', key, selected?.caseId, selected?.source]), uid);
  const details = useInfiniteQuery({queryKey: ['admin-fraud-detail', key, selected?.caseId, selected?.source],
    enabled: !!uid && !!selected && context.focused && detailContext.focused && !cases.isError && !cases.isFetching,
    staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as FraudReviewCursor | null,
    queryFn: ({pageParam}) => {const operation = detailContext.capture(); if (!selected) throw new Error('Le dossier doit être relu.');
      return FraudReviewService.detail(operation.session.uid, 'admin', selected.transactionId, selected.caseId, selected.source, pageParam, () => detailContext.assertCurrent(operation));},
    getNextPageParam: page => page.pagination.hasMore ? page.pagination.nextCursor ?? undefined : undefined});
  const readable = !!uid && context.focused && !cases.isError && !cases.isFetching;
  const rows = readable ? cases.data?.pages.flatMap(page => page.items) ?? [] : [];
  const detail = readable && detailContext.focused && !details.isError && !details.isFetching ? details.data?.pages[0] : null;
  const observations = detail ? details.data!.pages.flatMap(page => page.items) : [];
  const unique = new Set(rows.map(item => item.caseId)).size === rows.length && new Set(observations.map(item => item.observationId)).size === observations.length;
  const renderItem = useCallback(({item}: ListRenderItemInfo<FraudReviewCaseSummary>) => <View style={styles.case}>
    <Text selectable style={styles.caption}>Dossier : {item.caseId} · commande : {item.transactionId ?? 'attribution inconnue'}</Text>
    <Text style={styles.body}>{item.qualification === 'native_case' ? 'Dossier natif à examiner' : 'Qualification du dossier inconnue'}.</Text>
    <Button variant="secondary" disabled={item.source.caseRevision === null}
      onPress={() => {if (readable && unique && context.focused && uid) setSelection({key, item});}}>Lire les observations et sources exactes</Button>
  </View>, [readable, unique, context.focused, uid, key, setSelection]);
  return <View style={styles.container}>
    <ScreenHeader title="Paiements à examiner" onBack={() => router.back()} />
    <AdminSectionNav />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.body}>Les signaux du prestataire appellent un examen humain. Ils ne constituent pas une fraude prouvée, une décision d’identité ou une autorisation financière.</Text>
      {uid ? <AdminSellerActivityFacts uid={uid} suggestedTransactionId={detail?.transactionId ?? null} /> : null}
      {!uid || !context.focused ? <Text style={styles.caption}>Une session opérateur actuelle est requise.</Text> : null}
      {cases.isFetching ? <Text style={styles.caption}>Lecture native actuelle des dossiers…</Text> : null}
      {cases.isError || !unique ? <Text accessibilityRole="alert" style={styles.caption}>Impossible de qualifier cette lecture privée. Les anciennes données ne sont pas présentées comme actuelles.</Text> : null}
      <Button variant="secondary" disabled={!uid || !context.focused || cases.isFetching} onPress={() => {setSelection(null); void cases.refetch();}}>Relire les dossiers</Button>
      {readable && unique ? <>
        <Text style={styles.caption}>Pages lues : {cases.data?.pages.length ?? 0}. Chaque page est une lecture native distincte ; l’historique des risques n’est pas déclaré exhaustif.</Text>
        {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled /></View> :
          <Text style={styles.caption}>Aucun dossier sur les pages parcourues. Poursuivez la lecture si des pages restent disponibles.</Text>}
        {cases.hasNextPage ? <Button variant="secondary" onPress={() => {void cases.fetchNextPage();}}>Voir les dossiers suivants</Button> : null}
      </> : null}
      {details.isFetching && selected ? <Text style={styles.caption}>Lecture native actuelle des observations…</Text> : null}
      {details.isError && selected ? <Text accessibilityRole="alert" style={styles.caption}>Les sources ont changé ou doivent être rapprochées. Relisez la liste et choisissez explicitement le dossier à nouveau.</Text> : null}
      {detail && unique ? <FraudReviewEvidence detail={detail} observations={observations} showSource /> : null}
      {details.hasNextPage && detail && unique ? <Button variant="secondary" onPress={() => {void details.fetchNextPage();}}>Lire les observations suivantes</Button> : null}
      {uid ? <AdminFraudReviewDecision uid={uid} enabled={readable && unique} transactionId={detail?.transactionId ?? null}
        sourceKey={detail ? JSON.stringify(detail.source) : 'no_detail'}
        onInspectCase={(caseId, transactionId, source) => {try {const operation = context.capture(); context.assertCurrent(operation);
          setSelection({key, item: {caseId, transactionId, source}});} catch { /* Native reads still require the current operator session. */ }}}
        onRecorded={() => {setSelection(null); void cases.refetch();}} /> : null}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md},
  case: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 10}});
