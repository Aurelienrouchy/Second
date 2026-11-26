import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { LateCommercialRecourseService } from '@/services/lateCommercialRecourseService';
import type { LateCommercialEntry, LateCommercialHistoryItem, LateCommercialNoticeReference } from '@/types/lateCommercialRecourse';

export const LATE_COMMERCIAL_DECISION_LABELS = {admit_examination: 'Demande admise à l’examen documentaire', retain_review: 'Examen conservé en attente', refuse_admission: 'Admission à l’examen refusée'} as const;
const itemKey = (item: LateCommercialHistoryItem) => item.qualification === 'native_admission' ? item.entry.reference.admissionId : item.entryId;
export function LateCommercialHistory({uid, transactionId, scope = 'own', refreshKey = 0, noticeReference, onSelect, claimReview = false, assertSelection}: {
  uid: string; transactionId: string; scope?: 'own' | 'admin'; refreshKey?: number; noticeReference?: LateCommercialNoticeReference;
  onSelect?: (entry: LateCommercialEntry) => void; claimReview?: boolean; assertSelection?: () => void;
}) {
  const router = useRouter(), context = useLabelLifecycleContext(JSON.stringify(['late-commercial-history', transactionId, scope, noticeReference, refreshKey, claimReview]), uid);
  const key = JSON.stringify([uid, transactionId, scope, noticeReference, refreshKey, claimReview, context.focusRevision]);
  const read = useInfiniteQuery({queryKey: ['late-commercial-history', key], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: null as {lastId: string} | null, queryFn: ({pageParam}) => {
      const op = context.capture(); return LateCommercialRecourseService.history(uid, transactionId, scope, pageParam, () => {context.assertCurrent(op); assertSelection?.();}, noticeReference, claimReview);
    }, getNextPageParam: page => page.nextCursor ?? undefined});
  const rows = context.focused && read.isSuccess && !read.isFetching && !read.isError ? read.data.pages.flatMap(page => page.items) : [];
  const notice = context.focused && read.isSuccess && !read.isFetching && !read.isError ? read.data.pages[0]?.notice : null;
  const renderItem = useCallback(({item}: ListRenderItemInfo<LateCommercialHistoryItem>) => item.qualification === 'unknown' ? <Text style={styles.caption}>
    Une entrée historique ne peut pas être qualifiée. Aucun droit actuel ou résultat financier n’en est déduit.
  </Text> : <View style={styles.section}>
    <Text style={styles.body}>{LATE_COMMERCIAL_DECISION_LABELS[item.entry.decision]}</Text>
    <Text selectable style={styles.body}>{item.entry.partyMessage}</Text>
    {scope === 'admin' && item.entry.reason ? <Text selectable style={styles.caption}>Motivation privée : {item.entry.reason}</Text> : null}
    <Text style={styles.caption}>Réception initiale suivie : {new Date(item.entry.initialReceivedAt).toLocaleString(APP_LOCALE)}. Instruction du {new Date(item.entry.recordedAt).toLocaleString(APP_LOCALE)}.</Text>
    <Text selectable style={styles.caption}>Référence historique : {item.entry.reference.admissionId} · {item.entry.reference.contentHash}</Text>
    <Text style={styles.caption}>Cette instruction historique ne prouve ni défaut, responsabilité, remboursement, récupération de fonds ou autorisation de remise en vente. Une admission antérieure ne suffit pas à une nouvelle décision.</Text>
    {onSelect ? <Button variant="secondary" onPress={() => {try {context.capture(); assertSelection?.(); onSelect(item.entry);} catch { /* Stale history. */ }}}>Choisir cette référence pour un examen distinct</Button> : null}
  </View>, [scope, onSelect, context, assertSelection]);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Suivi de l’examen commercial tardif</Text>
    {notice ? <View style={styles.section}><Text style={styles.body}>Votre avis personnel a été rapproché de l’instruction native.</Text>
      <Text selectable style={styles.body}>{notice.entry.partyMessage}</Text></View> : null}
    <View style={styles.list}><FlashList data={rows} keyExtractor={itemKey} renderItem={renderItem} nestedScrollEnabled
      ListEmptyComponent={<Text style={styles.caption}>{read.isPending ? 'Lecture des instructions…' : read.isError ? 'L’historique ne peut pas être qualifié actuellement.' : 'Aucune instruction visible dans cette page.'}</Text>}
      ListFooterComponent={read.hasNextPage ? <Button variant="secondary" disabled={read.isFetchingNextPage} onPress={() => {try {context.capture(); assertSelection?.(); void read.fetchNextPage({cancelRefetch: false});} catch { /* Old selection. */ }}}>Lire la suite de l’historique</Button> : null} /></View>
    <Button variant="secondary" disabled={!context.focused || read.isFetching} onPress={() => {try {context.capture(); assertSelection?.(); void read.refetch();} catch { /* App inactive. */ }}}>Relire cet historique</Button>
    {scope === 'own' ? <><Text style={styles.caption}>Acheteur et vendeur peuvent consigner leurs observations contradictoires dans l’examen de l’article. La déclaration d’un vendeur n’accorde pas un veto à l’examen. Les avis ne certifient pas leur lecture par le destinataire.</Text>
      <Button variant="secondary" disabled={!context.focused} onPress={() => {try {context.capture(); router.push({pathname: '/product-review', params: {contextKind: 'order', contextId: transactionId}} as never);} catch { /* Stale session. */ }}}>Consulter l’article et ajouter ma déclaration</Button></> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 8}});
