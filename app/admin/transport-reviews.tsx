import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button, ScreenHeader } from '@/components/ui';
import { TransportReviewEvidence } from '@/components/TransportReviewEvidence';
import { TransportContactCommandHistory } from '@/components/TransportContactCommandHistory';
import { CarrierCostClaimCommandHistory } from '@/components/CarrierCostClaimCommandHistory';
import { AdminSectionNav, AdminTransportReviewDecision, AdminLabelDepositDeadlineReview, AdminTransportContactReview, AdminCarrierCostClaimReview, AdminReturnDepositDeadlinePanel } from '@/features/admin';
import { colors, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransportReviewService } from '@/services/transportReviewService';
import { createTransportContactInteraction } from '@/utils/transportContactContract';
import { ReturnDepositDeadlineCommandHistory } from '@/components/ReturnDepositDeadlineCommandHistory';
import type { TransportReviewListItem } from '@/types/transportReview';
const itemKey = (item: TransportReviewListItem) => item.reviewId;
export default function AdminTransportReviewsScreen() {
  const router = useRouter(), uid = useAuthenticatedUid(), params = useLocalSearchParams<{transactionId?: string}>();
  const base = useShippingPurchaseContext('admin-transport-command-search', uid);
  const identityKey = JSON.stringify([uid, getAuthSessionGeneration(), base.focusRevision]);
  const [contactInteraction] = useState(createTransportContactInteraction);
  const [contactRevision, setContactRevision] = useState(0);
  const contactChoice = contactInteraction.capture();
  const assertContactSelection = () => {base.capture(); contactChoice();};
  const [inputState, setInput] = useState<{key: string; value: string} | null>(null), input = inputState?.key === identityKey ? inputState.value : ''; 
  const [lookup, setLookup] = useState<{key: string; id: string} | null>(null);
  const transactionId = lookup?.key === identityKey ? lookup.id : typeof params.transactionId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(params.transactionId) ? params.transactionId : null;
  const context = useShippingPurchaseContext(JSON.stringify(['admin-transport-reviews', identityKey, transactionId]), uid);
  const key = JSON.stringify([identityKey, transactionId, context.focusRevision]);
  const [selection, setSelection] = useState<{key: string; id: string} | null>(null), selected = selection?.key === key ? selection.id : null;
  const list = useInfiniteQuery({queryKey: ['admin-transport-reviews', key], enabled: !!uid && !!transactionId && context.focused, staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: null as string | null, queryFn: ({pageParam}) => {const op = context.capture(); if (!transactionId) throw new Error('Commande requise.');
      return TransportReviewService.list(op.session.uid, transactionId, 'admin', pageParam, () => context.assertCurrent(op));}, getNextPageParam: page => page.cursor ?? undefined});
  const detailContext = useShippingPurchaseContext(JSON.stringify(['admin-transport-source', key, selected]), uid);
  const source = useQuery({queryKey: ['admin-transport-source', key, selected], enabled: !!uid && !!transactionId && context.focused && detailContext.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = detailContext.capture(); if (!transactionId) throw new Error('Commande requise.');
      return TransportReviewService.source(op.session.uid, transactionId, 'admin', selected, () => detailContext.assertCurrent(op));}});
  const readable = context.focused && !!transactionId && !list.isError && !list.isFetching;
  const pages = readable ? list.data?.pages ?? [] : [], consistent = pages.every(page => JSON.stringify(page.source.reference) === JSON.stringify(pages[0]?.source.reference));
  const rows = consistent ? pages.flatMap(page => page.items) : [], unique = new Set(rows.map(item => item.reviewId)).size === rows.length;
  const current = readable && consistent && unique && detailContext.focused && !source.isFetching && !source.isError ? source.data ?? null : null;
  const renderItem = useCallback(({item}: ListRenderItemInfo<TransportReviewListItem>) => <View style={styles.block}>
    <Text selectable style={styles.caption}>Dossier : {item.reviewId}</Text><Text style={styles.body}>{item.qualification === 'native_review' ? 'Dossier natif à examiner.' : 'Dossier historique dont la qualification doit être rapprochée.'}</Text>
    <Button variant="secondary" disabled={item.qualification !== 'native_review'} onPress={() => {if (readable && consistent && unique && context.focused) {contactInteraction.invalidate(); setContactRevision(revision => revision + 1); setSelection({key, id: item.reviewId});}}}>Lire le dossier et ses sources actuelles</Button>
  </View>, [readable, consistent, unique, context.focused, key, setSelection, contactInteraction, setContactRevision]);
  return <View style={styles.container}><ScreenHeader title="Enquêtes de transport" onBack={() => router.back()} /><AdminSectionNav />
    <ScrollView contentContainerStyle={styles.content}>
      {uid && !transactionId ? <TransportContactCommandHistory uid={uid} scope="admin" /> : null}
      {uid && !transactionId ? <CarrierCostClaimCommandHistory uid={uid} scope="admin" /> : null}
      {uid && !transactionId ? <ReturnDepositDeadlineCommandHistory uid={uid} /> : null}
      <Text style={styles.body}>Examinez une commande exacte et les démarches de ses dossiers natifs. Les déclarations, estimations et signaux transporteur ne prouvent pas une perte, une faute ou une réception physique.</Text>
      <TextInput value={input} onChangeText={value => setInput({key: identityKey, value})} maxLength={200} autoCapitalize="none" placeholder="Référence exacte de la commande" placeholderTextColor={colors.muted} style={styles.input} />
      <Button variant="secondary" disabled={!uid || !base.focused || !/^[A-Za-z0-9_-]{1,200}$/.test(input.trim())} onPress={() => {try {const op = base.capture(); base.assertCurrent(op); contactInteraction.invalidate(); setContactRevision(revision => revision + 1); setSelection(null); setLookup({key: identityKey, id: input.trim()});} catch { /* Stale operator context. */ }}}>Lire cette commande</Button>
      {uid && transactionId ? <AdminLabelDepositDeadlineReview uid={uid} transactionId={transactionId} /> : null}
      {uid && transactionId ? <AdminReturnDepositDeadlinePanel uid={uid} transactionId={transactionId}
        sourceKey={JSON.stringify([identityKey, transactionId, contactRevision, context.focusRevision])}
        assertSelection={assertContactSelection} /> : null}
      {uid && transactionId ? <AdminTransportContactReview key={JSON.stringify([identityKey, transactionId, contactRevision, context.focusRevision])} uid={uid} transactionId={transactionId} sourceKey={JSON.stringify([identityKey, transactionId, contactRevision, context.focusRevision])} assertSelection={assertContactSelection} /> : null}
      {uid && transactionId ? <AdminCarrierCostClaimReview key={JSON.stringify([identityKey, transactionId, contactRevision, context.focusRevision])} uid={uid} transactionId={transactionId} sourceKey={JSON.stringify([identityKey, transactionId, contactRevision, context.focusRevision])} assertSelection={assertContactSelection} /> : null}
      {list.isError || source.isError || !consistent || !unique ? <Text accessibilityRole="alert" style={styles.caption}>Les données privées ne peuvent pas être qualifiées ou les sources ont changé. Relisez les sources et choisissez à nouveau le dossier ; aucune ancienne donnée n’est présentée comme actuelle.</Text> : null}
      {transactionId ? <Button variant="secondary" disabled={list.isFetching || source.isFetching} onPress={() => {
        try {context.capture(); detailContext.capture();} catch {return;}
        contactInteraction.invalidate(); setContactRevision(revision => revision + 1); setSelection(null); void list.refetch();
        if (!selected) void source.refetch();
      }}>Relire les sources de la commande</Button> : null}
      {readable && consistent && unique ? <><Text style={styles.caption}>Pages parcourues : {pages.length}. Les dossiers natifs accessibles ne certifient pas un historique exhaustif.</Text>
        {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={itemKey} renderItem={renderItem} nestedScrollEnabled /></View> : <Text style={styles.caption}>Aucun dossier sur les pages parcourues.</Text>}
        {list.hasNextPage ? <Button variant="secondary" onPress={() => {void list.fetchNextPage();}}>Lire les dossiers suivants</Button> : null}</> : null}
      {current ? <TransportReviewEvidence source={current} review={current.review} showReferences /> : null}
      {uid && transactionId ? <AdminTransportReviewDecision uid={uid} transactionId={transactionId} observation={current} enabled={!!current?.review}
        onRecorded={() => {void list.refetch(); void source.refetch();}} /> : null}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md}, block: {gap: spacing.sm, paddingVertical: spacing.sm},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 9},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
