import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { CommercialClaimReviewForm } from '@/components/CommercialClaimReviewForm';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { CommercialClaimReviewService as Service, commercialClaimReviewFailure } from '@/services/commercialClaimReviewService';
import { productReviewEqual } from '@/services/productReviewService';
import { COMMERCIAL_CLAIM_ACTION_LABELS, COMMERCIAL_CLAIM_LIMITS, createCommercialClaimInteraction } from '@/utils/commercialClaimReviewPresentation';
import type { CommercialClaimReauthentication, CommercialClaimReviewReference, CommercialClaimSelection, CommercialClaimReviewHistoryItem } from '@/types/commercialClaimReview';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import type { ProductReviewContributionEntry } from '@/types/productReview';
import { colors, spacing, typography } from '@/constants/theme';

type ClaimRow = {claim: CommercialClaimSelection; choose: (claimId: string) => void};
const claimKey = (row: ClaimRow) => row.claim.claimId;
const renderClaim = ({item}: {item: ClaimRow}) => <View style={styles.section}>{item.claim.qualification === 'unknown' ? <Text style={styles.caption}>Une plainte historique ne peut pas être qualifiée ; aucun propriétaire ou droit n’est déduit.</Text> : <><Text selectable style={styles.body}>Plainte {item.claim.claimId} · {item.claim.status === 'open' ? 'ouverte' : 'résolue'} · reçue {item.claim.createdAt}.</Text><Button variant="secondary" onPress={() => item.choose(item.claim.claimId)}>Choisir cette plainte d’origine native</Button></>}</View>;
type HistoryRow = {item: CommercialClaimReviewHistoryItem};
const historyKey = (row: HistoryRow) => row.item.qualification === 'unknown' ? row.item.entryId : row.item.entry.reference.entryId;
const renderHistory = ({item: row}: {item: HistoryRow}) => <View style={styles.section}>{row.item.qualification === 'unknown' ? <Text style={styles.caption}>Entrée documentaire historique inconnue ; aucune absence de démarche n’est déduite.</Text> : <><Text style={styles.body}>{COMMERCIAL_CLAIM_ACTION_LABELS[row.item.entry.action]}</Text><Text selectable style={styles.body}>{row.item.entry.narrative}</Text><Text selectable style={styles.caption}>Plainte {row.item.entry.claimId} · reçu {row.item.entry.recordedAt} · référence {row.item.entry.reference.entryId}.</Text><Text style={styles.caption}>Cette déclaration historique ne vaut ni clôture, admission actuelle, réouverture ou remboursement.</Text></>}</View>;

export function CommercialClaimReviewPanel({uid, transactionId, scope = 'own', contributions = [], nativeAdmission = null, assertSelection, renderReauthentication, renderReexamination}: {
  uid: string; transactionId: string; scope?: 'own' | 'admin'; contributions?: ProductReviewContributionEntry[]; nativeAdmission?: ProductPhysicalDocumentaryAdmission | null;
  assertSelection?: () => void; renderReauthentication?: CommercialClaimReauthentication;
  renderReexamination?: (state: {transactionId: string; claimId: string; reference: CommercialClaimReviewReference; assertCurrent: () => void}) => ReactNode;
}) {
  const frame = useLabelLifecycleContext(`commercial-claim-panel:${scope}:${transactionId}`, uid), [interaction] = useState(createCommercialClaimInteraction);
  const [revision, setRevision] = useState(0), [authenticated, setAuthenticated] = useState<string | null>(null);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, scope, frame.focusRevision, revision, ...(scope === 'admin' ? [nativeAdmission?.key] : [])]);
  const [selected, setSelected] = useState<{key: string; claimId: string} | null>(null), choice = interaction.capture();
  const adminAdmission = !!nativeAdmission && nativeAdmission.uid === uid && nativeAdmission.scope === 'admin' && nativeAdmission.context.id === transactionId && nativeAdmission.materialCapability === 'product_review_material_v1' && nativeAdmission.parcelCapability === 'product_review_parcel_v1';
  const currentChoice = () => {frame.capture(); assertSelection?.(); choice(); if (scope === 'admin') {if (!adminAdmission || !nativeAdmission) throw commercialClaimReviewFailure(); nativeAdmission.assertCurrent();}};
  const allowed = frame.focused && (scope === 'own' || adminAdmission && authenticated === key);
  const claims = useInfiniteQuery({queryKey: ['commercial-claim-selection', key], enabled: allowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    initialPageParam: null as {lastId: string} | null, queryFn: ({pageParam}) => {const op = frame.capture(); return Service.claims(uid, transactionId, scope, pageParam, () => {frame.assertCurrent(op); currentChoice();});}, getNextPageParam: page => page.nextCursor ?? undefined});
  const history = useInfiniteQuery({queryKey: ['commercial-claim-history', key], enabled: allowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    initialPageParam: null as {lastId: string} | null, queryFn: ({pageParam}) => {const op = frame.capture(); return Service.history(uid, transactionId, scope, pageParam, () => {frame.assertCurrent(op); currentChoice();});}, getNextPageParam: page => page.nextCursor ?? undefined});
  const [selectionInteraction] = useState(createCommercialClaimInteraction), [selectionRevision, setSelectionRevision] = useState(0);
  const claimId = selected?.key === key ? selected.claimId : null, selectionChoice = selectionInteraction.capture();
  const selectedCurrent = () => {currentChoice(); selectionChoice();};
  const sourceKey = JSON.stringify([key, claimId, selectionRevision]);
  const source = useQuery({queryKey: ['commercial-claim-source', sourceKey], enabled: allowed && !!claimId, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {if (!claimId) throw commercialClaimReviewFailure(); const op = frame.capture(); return Service.source(uid, transactionId, claimId, scope, () => {frame.assertCurrent(op); selectedCurrent();});}});
  const current = allowed && source.isSuccess && !source.isFetching && !source.isError ? source.data : null;
  const s = current?.qualification === 'native_original_claim' ? current.source : null;
  const choose = (id: string) => {try {currentChoice(); selectionInteraction.invalidate(); setSelectionRevision(value => value + 1); setSelected({key, claimId: id});} catch { /* A native row from an old selection cannot choose a new claim. */ }};
  const rows = allowed && claims.isSuccess && !claims.isFetching && !claims.isError ? claims.data.pages.flatMap(page => page.items).map(claim => ({claim, choose})) : [];
  const entries = allowed && history.isSuccess && !history.isFetching && !history.isError ? history.data.pages.flatMap(page => page.items) : [];
  const latestRequest = s?.reviewState === 'reexamination_requested' ? entries.find(row => row.qualification === 'native_recorded_entry' && row.entry.claimId === claimId && row.entry.action === 'request_reexamination' && productReviewEqual(row.entry.reference, s.latestReference)) : null;
  const refresh = () => {try {currentChoice(); interaction.invalidate(); selectionInteraction.invalidate(); setAuthenticated(null); setSelected(null); setRevision(value => value + 1);} catch { /* No stale callback resets a replacement claim. */ }};
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>Retrait documentaire et demande de réexamen d’une plainte</Text><Text style={styles.caption}>{COMMERCIAL_CLAIM_LIMITS}</Text>
    {scope === 'admin' ? renderReauthentication?.({uid, sourceKey: `commercial-claim-reader:${key}`, parcel: true, disabled: !frame.focused || !adminAdmission || claims.isFetching || history.isFetching, onVerified: () => {try {currentChoice(); setAuthenticated(key);} catch { /* No stale reauthentication. */ }}}) : null}
    {rows.length ? <View style={styles.viewport}><FlashList data={rows} keyExtractor={claimKey} renderItem={renderClaim} nestedScrollEnabled/></View> : <Text style={styles.caption}>{claims.isError ? 'Les plaintes natives ne peuvent pas être qualifiées.' : claims.isFetching ? 'Lecture des plaintes natives…' : 'Aucune plainte native visible dans ces pages ; aucune absence ou exhaustivité n’en est déduite.'}</Text>}
    {allowed && claims.hasNextPage ? <Button variant="secondary" disabled={claims.isFetching} onPress={() => {try {currentChoice(); void claims.fetchNextPage({cancelRefetch: false});} catch { /* Old page. */ }}}>Lire les plaintes suivantes, même après une page visible vide</Button> : null}
    {s && current ? <>
      <Text selectable style={styles.body}>Plainte initiale {s.originalDisputeId} · réception initiale {s.originalCreatedAt} · statut documentaire {s.currentStatus === 'open' ? 'ouvert' : 'résolu'}.</Text>
      {s.initialResolution ? <Text style={styles.caption}>Résolution antérieure conservée : {s.initialResolution.resolution === 'dismissed' ? 'classement' : s.initialResolution.resolution === 'refunded' ? 'remboursement enregistré dans la résolution' : s.initialResolution.resolution === 'buyer_upheld' ? 'demande acheteur retenue' : 'inconnue'} · date {s.initialResolution.resolvedAt ?? 'inconnue'}. Aucun nouvel effet n’est déduit de cette mention.</Text> : null}
      <Text style={styles.caption}>Suivi documentaire actuel : {s.reviewState === 'withdrawn' ? 'retrait enregistré' : s.reviewState === 'reexamination_requested' ? 'réexamen demandé, admission distincte requise' : 'aucune démarche native enregistrée dans cette source'}.</Text>
      {scope === 'own' ? <CommercialClaimReviewForm key={sourceKey} uid={uid} source={current} contributions={contributions} nativeAdmission={nativeAdmission} assertSelection={selectedCurrent} onRecorded={refresh}/> : latestRequest?.qualification === 'native_recorded_entry' ? renderReexamination?.({transactionId, claimId: s.originalDisputeId, reference: latestRequest.entry.reference, assertCurrent: selectedCurrent}) : <Text style={styles.caption}>Une demande native de réexamen courante doit être retrouvée dans les pages d’historique avant l’examen opérateur. Les anciens actes ne donnent aucune permission actuelle.</Text>}
    </> : claimId ? <Text accessibilityRole="alert" style={styles.caption}>{source.isFetching ? 'Lecture de cette plainte, de son retrait et du corpus actuels…' : 'La plainte d’origine et ses sources ne peuvent pas être qualifiées.'}</Text> : null}
    <Text accessibilityRole="header" style={styles.body}>Historique documentaire distinct des décisions et des fonds</Text>
    {entries.length ? <View style={styles.viewport}><FlashList data={entries.map(item => ({item}))} keyExtractor={historyKey} renderItem={renderHistory} nestedScrollEnabled/></View> : <Text style={styles.caption}>{history.isError ? 'L’historique ne peut pas être qualifié.' : 'Aucune entrée native visible ; aucune exhaustivité ou absence de droit n’est déduite.'}</Text>}
    {allowed && history.hasNextPage ? <Button variant="secondary" disabled={history.isFetching} onPress={() => {try {currentChoice(); void history.fetchNextPage({cancelRefetch: false});} catch { /* Old page. */ }}}>Lire les démarches documentaires suivantes</Button> : null}
    <Button variant="secondary" disabled={!frame.focused} onPress={refresh}>Relire les plaintes, retraits et sources actuels</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, viewport: {height: spacing['4xl'] * 6}});
