import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button, Checkbox } from '@/components/ui';
import { TransportReviewEvidence } from '@/components/TransportReviewEvidence';
import { TransportReviewCommandPanel } from '@/components/TransportReviewCommandPanel';
import { colors, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransportReviewService } from '@/services/transportReviewService';
import type { TransportReviewListItem } from '@/types/transportReview';
const itemKey = (item: TransportReviewListItem) => item.reviewId;
export function TransportReviewNotice({transactionId, sourceKey}: {transactionId: string; sourceKey: string}) {
  const uid = useAuthenticatedUid(), router = useRouter();
  const context = useShippingPurchaseContext(JSON.stringify(['owner-transport-review', transactionId, sourceKey]), uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, sourceKey, context.focusRevision]);
  const [selection, setSelection] = useState<{key: string; id: string} | null>(null), selected = selection?.key === key ? selection.id : null;
  const [draft, setDraft] = useState<{key: string; source: string; listReadAt: number; narrative: string; confirmed: boolean} | null>(null);
  const list = useInfiniteQuery({queryKey: ['owner-transport-reviews', key], enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: null as string | null, queryFn: ({pageParam}) => {const op = context.capture(); return TransportReviewService.list(op.session.uid, transactionId, 'owner', pageParam, () => context.assertCurrent(op));},
    getNextPageParam: page => page.cursor ?? undefined});
  const detailContext = useShippingPurchaseContext(JSON.stringify(['owner-transport-source', key, selected]), uid);
  const source = useQuery({queryKey: ['owner-transport-source', key, selected], enabled: !!uid && context.focused && detailContext.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = detailContext.capture(); return TransportReviewService.source(op.session.uid, transactionId, 'owner', selected, () => detailContext.assertCurrent(op));}});
  const readable = context.focused && !list.isError && !list.isFetching;
  const pages = readable ? list.data?.pages ?? [] : [];
  const consistent = pages.every(page => JSON.stringify(page.source.reference) === JSON.stringify(pages[0]?.source.reference));
  const rows = consistent ? pages.flatMap(page => page.items) : [];
  const unique = new Set(rows.map(item => item.reviewId)).size === rows.length;
  const current = readable && list.isSuccess && consistent && unique && detailContext.focused && !source.isFetching && !source.isError ? source.data : null;
  const currentSourceKey = current ? JSON.stringify(current.reference) : null;
  const currentDraft = current && selected === null && draft?.key === key && draft.source === currentSourceKey && draft.listReadAt === list.dataUpdatedAt ? draft : null;
  const renderItem = useCallback(({item}: ListRenderItemInfo<TransportReviewListItem>) => <View style={styles.block}>
    <Text style={styles.body}>{item.qualification === 'historical_unknown' ? 'Dossier historique dont la qualification doit être rapprochée.' :
      item.kind === 'participant_transit' ? 'Déclaration de colis en transit.' : item.kind === 'delivery_correction' ? 'Dossier de correction de livraison.' : 'Dossier d’exception du transporteur.'}</Text>
    <Button variant="secondary" disabled={item.qualification !== 'native_review'} onPress={() => {if (context.focused && readable && consistent && unique) {setSelection({key, id: item.reviewId}); setDraft(null);}}}>Lire le dossier et ses sources actuelles</Button>
  </View>, [context.focused, readable, consistent, unique, key, setSelection, setDraft]);
  if (!uid || !context.focused) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Enquête de transport</Text>
    <Text style={styles.caption}>Un retard, une estimation ou une exception appelle un examen ; ils ne prouvent ni perte, faute ou réception. Les recours et la situation financière restent distincts.</Text>
    {list.isError || !consistent || !unique ? <Text accessibilityRole="alert" style={styles.caption}>Les sources ont changé ou cette lecture ne peut pas être qualifiée. Relisez toutes les pages avant de poursuivre.</Text> : null}
    <Button variant="secondary" disabled={list.isFetching} onPress={() => {
      try {context.capture(); detailContext.capture();} catch {return;}
      setSelection(null); setDraft(null); void list.refetch();
      // Clearing a selected review mounts the current-source query itself.
      // Refetching the old observer here would start a now-obsolete read.
      if (!selected) void source.refetch();
    }}>Relire les dossiers</Button>
    {readable && consistent && unique ? <><Text style={styles.caption}>Pages parcourues : {pages.length}. Cette projection des dossiers natifs n’est pas un historique exhaustif du transport.</Text>
      {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={itemKey} renderItem={renderItem} nestedScrollEnabled /></View> : <Text style={styles.caption}>Aucun dossier sur les pages parcourues.</Text>}
      {list.hasNextPage ? <Button variant="secondary" onPress={() => {void list.fetchNextPage();}}>Lire les dossiers suivants</Button> : null}</> : null}
    {source.isError ? <Text accessibilityRole="alert" style={styles.caption}>Les sources actuelles ne peuvent pas être confirmées. Les anciennes données sont masquées.</Text> : null}
    <Button variant="secondary" disabled={source.isFetching} onPress={() => {setDraft(null); void source.refetch();}}>Relire la source actuelle</Button>
    {current ? <TransportReviewEvidence source={current} review={current.review} /> : null}
    {selected ? <Button variant="secondary" onPress={() => {setSelection(null); setDraft(null);}}>Préparer une déclaration participante distincte</Button> : null}
    {current && selected === null && current.transportContext ? <>
      <Text style={styles.body}>Signaler un colis encore en transit</Text>
      <TextInput value={currentDraft?.narrative ?? ''} onChangeText={narrative => setDraft({key, source: currentSourceKey!, listReadAt: list.dataUpdatedAt, narrative, confirmed: false})} maxLength={4000} multiline
        placeholder="Décrivez les faits et vos démarches" placeholderTextColor={colors.muted} style={styles.input} />
      <Checkbox checked={currentDraft?.confirmed ?? false} disabled={!currentDraft?.narrative.trim()} onToggle={() => {if (currentDraft) setDraft({...currentDraft, confirmed: !currentDraft.confirmed});}}>
        <Text style={styles.caption}>Je signale un colis en transit. Mon récit est une déclaration à vérifier par l’équipe ; il ne certifie pas une perte, une faute ou une réception.</Text>
      </Checkbox>
    </> : null}
    <TransportReviewCommandPanel uid={uid} transactionId={transactionId} sourceKey={JSON.stringify([key, currentSourceKey])}
      command={current && currentDraft?.confirmed && currentDraft.narrative.trim() && selected === null ? {action: 'report_transit', transactionId, source: {...current.reference}, narrative: currentDraft.narrative.trim()} : null}
      enabled={!!current && selected === null && current.transportContext && !!currentDraft?.confirmed} onSubmitted={() => setDraft(null)} onRecorded={() => {void list.refetch(); void source.refetch();}} />
    <Button variant="secondary" onPress={() => {try {const op = context.capture(); context.assertCurrent(op); router.push({pathname: '/settings/support', params: {kind: 'commercial_late', transactionId}} as never);} catch { /* Stale identity cannot open a private support context. */ }}}>Contacter l’équipe pour cette commande</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, block: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 6},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md, minHeight: spacing['4xl']}});
