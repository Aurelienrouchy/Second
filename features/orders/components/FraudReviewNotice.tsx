import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui';
import { FraudReviewEvidence } from '@/components/FraudReviewEvidence';
import { colors, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { FraudReviewService } from '@/services/fraudReviewService';
import type { FraudReviewCaseSummary, FraudReviewCursor } from '@/types/fraudReview';

const keyExtractor = (item: FraudReviewCaseSummary) => item.caseId;
export function FraudReviewNotice({transactionId, sourceKey}: {transactionId: string; sourceKey: string}) {
  const uid = useAuthenticatedUid(), router = useRouter();
  const context = useShippingPurchaseContext(JSON.stringify(['owner-fraud-review', transactionId, sourceKey]), uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, sourceKey, context.focusRevision]);
  const [selection, setSelection] = useState<{key: string; item: FraudReviewCaseSummary} | null>(null);
  const selected = selection?.key === key ? selection.item : null;
  const cases = useInfiniteQuery({queryKey: ['owner-fraud-review', key], enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: null as FraudReviewCursor | null,
    queryFn: ({pageParam}) => {const operation = context.capture(); return FraudReviewService.list(operation.session.uid, 'owner', transactionId, pageParam, () => context.assertCurrent(operation));},
    getNextPageParam: page => page.pagination.hasMore ? page.pagination.nextCursor ?? undefined : undefined});
  const detailContext = useShippingPurchaseContext(JSON.stringify(['owner-fraud-detail', key, selected?.caseId, selected?.source]), uid);
  const details = useInfiniteQuery({queryKey: ['owner-fraud-review-detail', key, selected?.caseId, selected?.source],
    enabled: !!uid && !!selected && context.focused && detailContext.focused && !cases.isError && !cases.isFetching,
    staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as FraudReviewCursor | null,
    queryFn: ({pageParam}) => {const operation = detailContext.capture(); if (!selected) throw new Error('Le dossier doit être relu.');
      return FraudReviewService.detail(operation.session.uid, 'owner', transactionId, selected.caseId, selected.source, pageParam, () => detailContext.assertCurrent(operation));},
    getNextPageParam: page => page.pagination.hasMore ? page.pagination.nextCursor ?? undefined : undefined});
  const readable = !!uid && context.focused && !cases.isError && !cases.isFetching;
  const rows = readable ? cases.data?.pages.flatMap(page => page.items) ?? [] : [];
  const detail = readable && detailContext.focused && !details.isError && !details.isFetching ? details.data?.pages[0] : null;
  const observations = detail ? details.data!.pages.flatMap(page => page.items) : [];
  const unique = new Set(rows.map(item => item.caseId)).size === rows.length && new Set(observations.map(item => item.observationId)).size === observations.length;
  const renderItem = useCallback(({item}: ListRenderItemInfo<FraudReviewCaseSummary>) => <View style={styles.case}>
    <Text style={styles.body}>{item.publicState === 'review_closed_for_sources' ? 'Revue close pour les sources examinées ; les autres obligations restent distinctes' :
      item.qualification === 'native_case' ? 'Dossier de contrôle à examiner' : 'Dossier dont la qualification reste à examiner'}.</Text>
    <Button variant="secondary" disabled={item.source.caseRevision === null}
      onPress={() => {if (context.focused && uid && readable && unique) setSelection({key, item});}}>Consulter ce dossier</Button>
  </View>, [context.focused, uid, readable, unique, key, setSelection]);
  if (!uid || !context.focused || readable && !rows.length && !cases.hasNextPage) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Examen du paiement</Text>
    {cases.isFetching ? <Text style={styles.caption}>Lecture actuelle des dossiers…</Text> : null}
    {cases.isError || !unique ? <Text accessibilityRole="alert" style={styles.caption}>Cette lecture ne peut pas être qualifiée. Relisez les dossiers ; aucune ancienne source n’est présentée comme actuelle.</Text> : null}
    <Button variant="secondary" disabled={cases.isFetching} onPress={() => {setSelection(null); void cases.refetch();}}>Relire les dossiers de cette commande</Button>
    {readable && unique && rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled /></View> : null}
    {cases.hasNextPage && readable && unique ? <Button variant="secondary" onPress={() => {void cases.fetchNextPage();}}>Voir les dossiers suivants</Button> : null}
    {details.isFetching && selected ? <Text style={styles.caption}>Lecture actuelle des observations…</Text> : null}
    {details.isError && selected ? <Text accessibilityRole="alert" style={styles.caption}>Les sources ont changé ou ne peuvent plus être qualifiées. Relisez la liste et choisissez à nouveau le dossier avant de poursuivre.</Text> : null}
    {detail && unique ? <FraudReviewEvidence detail={detail} observations={observations} /> : null}
    {details.hasNextPage && detail && unique ? <Button variant="secondary" onPress={() => {void details.fetchNextPage();}}>Lire les observations suivantes</Button> : null}
    <Text style={styles.caption}>Cette lecture couvre les dossiers natifs accessibles, sans garantir un historique exhaustif des risques. Conservez les documents et demandez un examen humain avant une nouvelle remise du colis.</Text>
    <Button variant="secondary" onPress={() => {try {const operation = context.capture(); context.assertCurrent(operation);
      router.push({pathname: '/settings/support', params: {transactionId, kind: 'commercial_late'}} as never);} catch { /* A stale session cannot open private support context. */ }}}>Contacter l’équipe pour cette commande</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, case: {gap: spacing.sm, paddingVertical: spacing.sm},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 6}});
