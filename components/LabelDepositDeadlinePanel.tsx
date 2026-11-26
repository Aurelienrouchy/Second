import {useCallback, useLayoutEffect, useRef, useState, type ComponentType} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FlashList, type ListRenderItemInfo} from '@shopify/flash-list';
import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {useRouter} from 'expo-router';
import {Button} from '@/components/ui';
import {TransportReviewEvidence} from '@/components/TransportReviewEvidence';
import {TransportReviewCommandPanel} from '@/components/TransportReviewCommandPanel';
import {colors, spacing, typography} from '@/constants/theme';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {TransportReviewService} from '@/services/transportReviewService';
import type {TransportReviewListItem, TransportReviewObservation, TransportReviewScope} from '@/types/transportReview';
const itemKey = (item: TransportReviewListItem) => item.reviewId;
export interface LabelDepositReauthenticationProps {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void}
export function LabelDepositDeadlinePanel({uid, transactionId, sourceKey, scope, ReauthenticationComponent, OperatorComponent, AgreementComponent}: {
  uid: string; transactionId: string; sourceKey: string; scope: TransportReviewScope;
  ReauthenticationComponent?: ComponentType<LabelDepositReauthenticationProps & {parcel?: boolean; purpose?: 'commercial'}>;
  OperatorComponent?: ComponentType<{uid: string; transactionId: string; capability?: 'label_deposit_deadline_v1'; observation: TransportReviewObservation | null; enabled: boolean; onRecorded: () => void}>;
  AgreementComponent?: ComponentType<{uid: string; disabled: boolean; selection: {transactionId: string; disputeId: string}; material?: boolean; parcel?: boolean; onRecorded: () => void}>;
}) {
  const router = useRouter(), frame = useLabelLifecycleContext(JSON.stringify(['label-deposit-deadline', transactionId, sourceKey, scope]), uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, sourceKey, scope, frame.focusRevision]);
  const currentKey = useRef(key); useLayoutEffect(() => {currentKey.current = key;}, [key]);
  const interactions = useRef(0), [epoch, setEpoch] = useState(0), [authenticated, setAuthenticated] = useState<string | null>(null);
  const [selection, setSelection] = useState<{key: string; id: string} | null>(null), selected = selection?.key === key ? selection.id : null;
  const [agreement, setAgreement] = useState<string | null>(null);
  const allowed = frame.focused && (scope === 'owner' || authenticated === key);
  const list = useInfiniteQuery({queryKey: ['label-deposit-deadline-reviews', key], enabled: allowed, staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: null as string | null, queryFn: ({pageParam}) => {const op = frame.capture(); return TransportReviewService.list(uid, transactionId, scope, pageParam, () => frame.assertCurrent(op), 'label_deposit_deadline_v1');}, getNextPageParam: page => page.cursor ?? undefined});
  const detailFrame = useLabelLifecycleContext(JSON.stringify(['label-deposit-deadline-source', key, selected]), uid);
  const source = useQuery({queryKey: ['label-deposit-deadline-source', key, selected], enabled: allowed && detailFrame.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = detailFrame.capture(); return TransportReviewService.source(uid, transactionId, scope, selected, () => detailFrame.assertCurrent(op), 'label_deposit_deadline_v1');}});
  const pages = allowed && list.isSuccess && !list.isFetching && !list.isError ? list.data.pages : [];
  const consistent = pages.every(p => JSON.stringify(p.source.reference) === JSON.stringify(pages[0]?.source.reference));
  const all = consistent ? pages.flatMap(p => p.items) : [], unique = new Set(all.map(item => item.reviewId)).size === all.length;
  const rows = unique ? all.filter(item => item.qualification === 'historical_unknown' || item.kind === 'label_deposit_deadline') : [];
  const observation = allowed && consistent && unique && source.isSuccess && !source.isFetching && !source.isError && !list.isFetching && !list.isError ? source.data : null;
  const current = observation && (observation.review === null || observation.review.kind === 'label_deposit_deadline') ? observation : null;
  const change = useCallback((apply: () => void) => {interactions.current++; setEpoch(interactions.current); setAgreement(null); apply();}, []);
  const renderReview = useCallback(({item}: ListRenderItemInfo<TransportReviewListItem>) => <View style={styles.section}><Text selectable style={styles.caption}>Revue : {item.reviewId}</Text><Text style={styles.body}>{item.qualification === 'historical_unknown' ? 'Référence historique dont la qualification reste inconnue.' : `Enquête documentaire ${item.inquiryState === 'open' ? 'ouverte' : 'close'} pour une échéance après étiquette.`}</Text>
    <Button variant="secondary" disabled={!allowed || list.isFetching || source.isFetching || item.qualification !== 'native_review'} onPress={() => {try {frame.capture(); change(() => setSelection({key, id: item.reviewId}));} catch { /* Native source must be read in the current epoch. */ }}}>Examiner cette revue et son origine</Button></View>, [allowed, list.isFetching, source.isFetching, frame, key, change]);
  const refresh = () => {try {frame.capture(); change(() => setSelection(null)); void list.refetch(); void source.refetch();} catch { /* No new read from old activity. */ }};
  const go = (path: 'product' | 'label') => {
    if (!current?.labelDepositDeadline) return; try {frame.capture(); detailFrame.capture(); change(() => undefined);
      router.push(path === 'product' ? {pathname: scope === 'admin' ? '/admin/product-reviews' : '/product-review', params: {contextKind: 'order', contextId: transactionId}} as never :
        {pathname: scope === 'admin' ? '/admin/label-lifecycle' : '/label-lifecycle', params: {transactionId, leg: 'forward'}} as never);
    } catch { /* Each destination independently requalifies native permission. */ }
  };
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Délai accepté après création d’étiquette</Text>
    <Text style={styles.body}>Le dépassement ouvre une revue documentaire. Il ne crée aucune plainte au nom de l’acheteur et ne déclenche ni remboursement, ni annulation d’étiquette ou remise en vente.</Text>
    {scope === 'admin' && ReauthenticationComponent ? <ReauthenticationComponent uid={uid} sourceKey={key} disabled={!frame.focused || list.isFetching || source.isFetching} parcel purpose="commercial" onVerified={() => {
      if (currentKey.current !== key || interactions.current !== epoch) return; try {frame.capture(); change(() => setAuthenticated(key));} catch { /* Old reauthentication grants no private read. */ }
    }} /> : null}
    <Button variant="secondary" disabled={!allowed || list.isFetching || source.isFetching} onPress={refresh}>Relire le délai et les revues enregistrées</Button>
    {allowed && (list.isError || source.isError || !consistent || !unique) ? <Text accessibilityRole="alert" style={styles.caption}>Le délai ou les dossiers ne peuvent pas être qualifiés dans cette lecture. Aucune ancienne source n’est présentée comme permission actuelle. Le suivi des intentions déjà conservées reste accessible séparément.</Text> : null}
    {allowed && (list.isFetching || source.isFetching) ? <Text style={styles.caption}>Lecture des sources natives du délai…</Text> : null}
    {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={itemKey} renderItem={renderReview} nestedScrollEnabled /></View> : null}
    {allowed && list.isSuccess && !list.isFetching && !rows.length ? <Text style={styles.caption}>Aucune revue de délai sur les pages parcourues. Ce résultat ne prouve ni dépôt du colis, ni absence de dépôt.</Text> : null}
    {allowed && list.hasNextPage ? <Button variant="secondary" disabled={list.isFetching || source.isFetching} onPress={() => {try {frame.capture(); change(() => undefined); void list.fetchNextPage();} catch { /* Pagination cannot borrow an old epoch. */ }}}>Lire les revues suivantes</Button> : null}
    {current ? <><TransportReviewEvidence source={current} review={current.review} showReferences={scope === 'admin'} />
      {current.labelDepositDeadline ? <View style={styles.section}><Text style={styles.title}>Préparer une issue dans son parcours distinct</Text>
        <Text style={styles.body}>Ces accès n’accordent aucune permission depuis le délai seul. Chaque parcours relit ses propres sources, preuves et conditions avant toute nouvelle action.</Text>
        <Button variant="secondary" onPress={() => go('product')}>{scope === 'admin' ? 'Examiner le dossier privé du colis et les recours déposés' : 'Préparer ma déclaration de colis et examiner un éventuel recours'}</Button>
        <Text style={styles.caption}>L’enquête P exige une déclaration explicite du participant, puis un vrai dépôt de recours selon la contribution, l’étiquette et les fonds qualifiés. Ouvrir ce dossier ne dépose aucune plainte.</Text>
        {scope === 'owner' ? <Button variant="secondary" onPress={() => go('product')}>Examiner ou proposer un accord bilatéral exact</Button> : AgreementComponent ? <Button variant="secondary" onPress={() => {try {frame.capture(); detailFrame.capture(); change(() => setAgreement(key));} catch { /* Agreement preparation remains independent. */ }}}>Préparer l’examen d’un accord bilatéral exact</Button> : null}
        <Text style={styles.caption}>Un accord H exige les deux acceptations natives des mêmes conditions et une instruction opérateur distincte. Ce délai ne décide ni des montants, ni du financement ou de l’exécution du remboursement.</Text>
        <Button variant="secondary" onPress={() => go('label')}>Examiner l’arrêt d’utilisation ou le maintien en revue de l’étiquette</Button>
        <Text style={styles.caption}>Le cycle d’étiquette qualifie séparément stop_use, maintain_review et, si ses propres preuves le permettent, void. Aucun nouveau dépôt ou annulation n’est autorisé depuis ce panneau.</Text>
      </View> : null}
    </> : null}
    {agreement === key && current && AgreementComponent ? <AgreementComponent uid={uid} disabled={false} selection={{transactionId, disputeId: ''}} material parcel onRecorded={refresh} /> : null}
    {scope === 'admin' && OperatorComponent ? <OperatorComponent uid={uid} transactionId={transactionId} capability="label_deposit_deadline_v1" observation={current} enabled={!!current?.review && current.review.kind === 'label_deposit_deadline'} onRecorded={refresh} /> :
      <TransportReviewCommandPanel uid={uid} transactionId={transactionId} sourceKey={key} command={null} enabled={false} capability="label_deposit_deadline_v1" onSubmitted={() => undefined} onRecorded={refresh} />}
  </View>;
}
const styles = StyleSheet.create({card: {gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceWarm}, section: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 8}});
