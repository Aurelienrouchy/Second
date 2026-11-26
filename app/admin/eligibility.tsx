import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Checkbox, Input, ScreenHeader } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { AdminSectionNav, AdminEligibilityEvidence, AdminSellerActivityReview } from '@/features/admin';
import {isEligibilityReviewReference} from '@/services/sellerActivityReviewService';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useAdminEligibility, useEligibilityOperation } from '@/hooks/useEligibility';
import { getAuthSessionGeneration } from '@/store/authStore';
import { EligibilityService } from '@/services/eligibilityService';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import type { AdminEligibilityReviewSummary, DecideEligibilityReviewInput, EligibilityOutcome, EligibilityReviewStatus,
  EligibilityScope, FlagEligibilityInput, AdminEligibilitySalesPage, SellerActivityPageCursors, SellerActivityAdmission } from '@/types/eligibility';
import { ELIGIBILITY_REVIEW_LABELS, ELIGIBILITY_SCOPE_LABELS, eligibilityErrorMessage } from '@/utils/eligibilityPresentation';
const keyExtractor = (item: AdminEligibilityReviewSummary) => item.id;
const statuses: EligibilityReviewStatus[] = ['submitted', 'needs_information', 'approved', 'rejected'];
const scopes: EligibilityScope[] = ['buy', 'sell', 'new_paid_shipping'];
const activityCaptureLabel = (capture: SellerActivityAdmission | undefined) => capture?.qualification === 'native_capture'
  ? `Capture native du ${capture.capturedAt}. Déclaration version ${capture.parties[0]?.activity.statementVersion ?? 'inconnue'}, enregistrée le ${capture.parties[0]?.activity.recordedAt ?? 'date inconnue'}. ${capture.parties[0]?.activity.qualification === 'native_original' ? 'Reçu original lié.' : 'Origine historique inconnue.'}`
  : 'Historique incomplet : statut déclaratif lors de cet accord inconnu. Le profil courant ne le remplace pas.';
const outcomeLabels: Record<EligibilityOutcome, string> = {
  request_information: 'Demander des précisions', reject: 'Maintenir le refus',
  approve_correction: 'Enregistrer la correction', complete_review: 'Terminer cet examen',
};
type Decision = Omit<DecideEligibilityReviewInput, 'requestId'>;
type Signal = Omit<FlagEligibilityInput, 'requestId'>;
export default function AdminEligibilityScreen() {
  const uid = useAuthenticatedUid();
  const params = useLocalSearchParams<{reviewId?: string | string[]}>(), requestedReviewId = isEligibilityReviewReference(params.reviewId) ? params.reviewId : null;
  const routeKey = JSON.stringify([uid, getAuthSessionGeneration(), requestedReviewId]);
  const [routeBinding, setRouteBinding] = useState(routeKey);
  const [status, setStatus] = useState<EligibilityReviewStatus | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(requestedReviewId);
  if (routeBinding !== routeKey) {setRouteBinding(routeKey); setSelectedId(requestedReviewId);}
  const sessionKey = JSON.stringify([uid, getAuthSessionGeneration()]);
  const [relatedSalesPage, setRelatedSalesPage] = useState<(AdminEligibilitySalesPage & { reviewId: string; sessionKey: string }) | null>(null);
  const currentSalesPage = relatedSalesPage?.reviewId === selectedId && relatedSalesPage.sessionKey === sessionKey ? relatedSalesPage : undefined;
  const { permission, queue, detail } = useAdminEligibility(status, selectedId, currentSalesPage);
  const [outcome, setOutcome] = useState<EligibilityOutcome>('request_information');
  const [ownerReason, setOwnerReason] = useState(''); const [internalNote, setInternalNote] = useState('');
  const [legalBasis, setLegalBasis] = useState(''); const [recourse, setRecourse] = useState('');
  const [clearSignalIds, setClearSignalIds] = useState<string[]>([]);
  const [flagNote, setFlagNote] = useState('');
  const [signalScope, setSignalScope] = useState<EligibilityScope>('sell');
  const [confirmation, setConfirmation] = useState<Decision | Signal | null>(null);
  const [message, setMessage] = useState('');
  const permitted = permission.data === true && !permission.isFetching && !permission.isError;
  const decide = useEligibilityOperation<Decision>(EligibilityService.decide, 'admin_decision', true, permitted);
  const flag = useEligibilityOperation<Signal>(EligibilityService.flag, 'admin_signal', true, permitted);
  const resetForm = useCallback(() => { setOwnerReason(''); setInternalNote(''); setFlagNote(''); setLegalBasis(''); setRecourse('');
    setClearSignalIds([]); setConfirmation(null); setOutcome('request_information'); setMessage(''); }, []);
  const [formUid, setFormUid] = useState(uid);
  if (formUid !== uid) { setFormUid(uid); setSelectedId(requestedReviewId); setStatus(undefined); resetForm(); }
  const current = !detail.isFetching && detail.data?.request.id === selectedId ? detail.data : undefined;
  const activityScope = JSON.stringify([uid, getAuthSessionGeneration(), current?.request.id, current?.request.ownerId, current?.request.requestVersion, current?.eligibility.version]);
  const [activityPages, setActivityPages] = useState<{scope: string; cursors: SellerActivityPageCursors} | null>(null);
  const activityCursors = activityPages?.scope === activityScope ? activityPages.cursors : {};
  const activityContext = useLabelLifecycleContext(JSON.stringify(['admin-seller-activity', activityScope, activityCursors]), uid);
  const activityHistory = useQuery({queryKey: ['admin-seller-activity', activityScope, activityContext.focusRevision, activityCursors],
    enabled: !!uid && !!current && permitted && activityContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = activityContext.capture(); if (!current) throw new Error('Rouvrez le dossier actuel.');
      return EligibilityService.getAdminActivityHistory(uid!, current.request.id, current.request.ownerId, current.eligibility.version,
        current.request.requestVersion, activityCursors, () => activityContext.assertCurrent(operation));}});
  const activityData = permitted && !!current && activityContext.focused && activityHistory.isSuccess && !activityHistory.isFetching ? activityHistory.data : null;
  const activityPage = (field: keyof SellerActivityPageCursors, cursor: string | null) => {
    try {activityContext.capture();} catch {return;}
    if (cursor && activityData) setActivityPages({scope: activityScope, cursors: {...activityCursors, [field]: cursor}});
  };
  const rereadActivitySource = () => {try {activityContext.capture(); void activityHistory.refetch();} catch { /* Stale role/source/session. */ }};
  const busy = decide.isPending || flag.isPending;
  const uncertain = decide.hasPendingOperation || flag.hasPendingOperation;
  const renderItem = useCallback(({ item }: { item: AdminEligibilityReviewSummary }) => <Button variant="secondary"
    onPress={() => { resetForm(); setRelatedSalesPage(null); setSelectedId(item.id); }} disabled={busy}>
    {`${item.id} · ${ELIGIBILITY_REVIEW_LABELS[item.status]} · ${ELIGIBILITY_SCOPE_LABELS[item.scope]}`}
  </Button>, [busy, uncertain, resetForm]);
  const execute = async (action: () => Promise<unknown>, success = 'Décision enregistrée. Consultez l’état relu du dossier.') => {
    try { const result = await action(); if (result) { setMessage(success); setConfirmation(null); } }
    catch (error) { setMessage(eligibilityErrorMessage(error)); setConfirmation(null); }
    await queue.refetch(); if (selectedId) await detail.refetch();
  };
  const prepareDecision = () => {
    if (!current) return;
    setConfirmation({ reviewId: current.request.id, outcome, ownerReason: ownerReason.trim(),
      expectedVersion: current.eligibility.version, expectedRequestVersion: current.request.requestVersion,
      ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
      ...(['approve_correction', 'complete_review'].includes(outcome) ? { clearSignalIds } : {}),
      ...(current.request.kind === 'date_of_birth_correction' && outcome === 'reject' ? { legalBasis: legalBasis.trim(), recourse: recourse.trim() } : {}) });
  };
  const resume = async () => {
    const pending = decide.pendingPayload ?? flag.pendingPayload;
    if (!pending) return;
    const checked = await permission.refetch();
    if (checked.data !== true || checked.isError) { setMessage('Accès réservé aux administrateurs autorisés.'); return; }
    if (decide.pendingPayload) {
      const response = await EligibilityService.getAdminReview(uid!, decide.pendingPayload.reviewId);
      setSelectedId(response.request.id);
      await execute(() => decide.send(decide.pendingPayload!));
    } else if (flag.pendingPayload) {
      // Re-read the selected owner's evidence, never use another selected owner.
      if (!current || current.request.ownerId !== flag.pendingPayload.ownerId) {
        setMessage('Rouvrez un dossier de ce propriétaire pour rapprocher le signal.'); return;
      }
      await detail.refetch(); await execute(() => flag.send(flag.pendingPayload!), 'Signal d’examen enregistré.');
    }
  };
  if (!uid || permission.isPending || permission.isFetching) return <View style={styles.container}><ScreenHeader title="Admissibilité" onBack={() => router.back()} /><Text style={styles.body}>Vérification des permissions…</Text></View>;
  if (permission.isError) return <View style={styles.content}><Text style={styles.notice}>Impossible de vérifier les permissions.</Text><Button onPress={() => { void permission.refetch(); }}>Réessayer</Button></View>;
  if (!permitted) return <View style={styles.content}><Text style={styles.notice}>Accès réservé aux administrateurs autorisés.</Text><Button onPress={() => router.back()}>Retour</Button></View>;
  const open = !!current && ['submitted', 'needs_information'].includes(current.request.status);
  const rejectCorrection = current?.request.kind === 'date_of_birth_correction' && outcome === 'reject';
  const compatibleOutcomes: EligibilityOutcome[] = ['request_information', 'reject', current?.request.kind === 'date_of_birth_correction' ? 'approve_correction' : 'complete_review'];
  const confirmationStale = !current || (confirmation && (confirmation.expectedVersion !== current.eligibility.version ||
    ('reviewId' in confirmation && (confirmation.reviewId !== current.request.id || confirmation.expectedRequestVersion !== current.request.requestVersion)) ||
    ('ownerId' in confirmation && confirmation.ownerId !== current.request.ownerId)));
  const header = <View style={styles.content}>
    <AdminSellerActivityReview uid={uid} onOpenReview={id => {setSelectedId(id); setRelatedSalesPage(null); resetForm(); void queue.refetch();}}/>
    <Text style={styles.body}>Dossiers privés. Une correction ou un examen ne remplace jamais les contrôles d’âge, d’activité et de territoire d’une nouvelle opération.</Text>
    <Button variant="secondary" disabled={busy || uncertain} onPress={() => { setStatus(undefined); setSelectedId(null); resetForm(); }}>À examiner</Button>
    {statuses.map(value => <Checkbox key={value} checked={status === value} disabled={busy || uncertain} onToggle={() => { setStatus(value); setSelectedId(null); resetForm(); }}
      accessibilityLabel={`Filtrer ${ELIGIBILITY_REVIEW_LABELS[value]}`}><Text style={styles.body}>{ELIGIBILITY_REVIEW_LABELS[value]}</Text></Checkbox>)}
    <Button variant="ghost" disabled={busy} onPress={() => { void permission.refetch(); void queue.refetch(); if (selectedId) void detail.refetch(); }}>Actualiser les dossiers</Button>
    {(decide.restoreError || flag.restoreError) ? <><Text style={styles.notice}>Impossible de relire la tentative précédente. Réessayez avant un nouvel envoi.</Text><Button onPress={() => { decide.retryRestore(); flag.retryRestore();  }}>Relire la tentative conservée</Button></> : null}
    {message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text> : null}
    {queue.isError ? <Text style={styles.notice}>{eligibilityErrorMessage(queue.error)}</Text> : queue.isPending ? <Text style={styles.body}>Chargement de la file…</Text> : queue.data?.pages.every(page => page.items.length === 0) ? <Text style={styles.body}>Aucun dossier dans cette file.</Text> : null}
    {currentSalesPage ? <Button variant="ghost" disabled={detail.isFetching} onPress={() => setRelatedSalesPage(null)}>Revenir à la première page des ventes et relire le dossier</Button> : null}
    {selectedId && (detail.isPending || detail.isFetching) ? <Text style={styles.body}>Chargement du dossier privé…</Text> : selectedId && detail.isError ? <Text style={styles.notice}>{eligibilityErrorMessage(detail.error)}</Text> : current ? <>
      <AdminEligibilityEvidence detail={current} open={open} busy={busy} uncertain={uncertain} outcome={outcome}
        clearSignalIds={clearSignalIds} onToggleSignal={id => { setConfirmation(null); setClearSignalIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]); }} />
      {current.request.sellerActivityReview ? <><Text style={styles.body}>Examen d’activité ouvert sur source native : {current.request.sellerActivityReview.sourceHash}.</Text>
        <Text style={styles.caption}>Critères humains : {current.request.sellerActivityReview.criteriaCodes.join(' · ')}. Aucun seuil automatique, qualification professionnelle ou constat fiscal.</Text>
        <Text style={styles.caption}>Pour terminer cet examen, sélectionnez explicitement les signaux liés encore actifs : {current.request.sellerActivityReview.signalIds.join(', ')}. Les autres signaux gardent leur traitement distinct.</Text></> : null}
      <Text style={styles.title}>Historique déclaratif original du propriétaire</Text>
      <Text style={styles.body}>Les événements d’origine et les captures des accords ci-dessous sont relus depuis leurs sources natives. L’état courant affiché dans le dossier reste distinct. Aucune qualification fiscale ou date d’effet légale n’est déterminée ici.</Text>
      <Button variant="secondary" disabled={activityHistory.isFetching} onPress={rereadActivitySource}>Relire l’historique et les captures natives</Button>
      {activityHistory.isFetching ? <Text style={styles.body}>Lecture de la page privée…</Text> : activityHistory.isError ? <Text style={styles.notice}>Historique indisponible ou dossier modifié. Relisez le dossier avant de poursuivre.</Text> : null}
      {activityData ? <>
        <Text style={styles.caption}>Page d’audit du propriétaire. Une page vide peut conserver un curseur de suite.</Text>
        {activityData.history.items.length === 0 ? <Text style={styles.body}>Aucune déclaration sur cette page. {activityData.history.hasMore ? 'La lecture peut continuer.' : 'Fin de cette lecture paginée.'}</Text> : activityData.history.items.map(receipt => <View key={receipt.id} style={styles.signal}>
          <Text selectable style={styles.caption}>Reçu original : {receipt.id} · empreinte : {receipt.receiptHash ?? 'Inconnue'}</Text>
          <Text style={styles.body}>{receipt.qualification === 'native_original' ? receipt.statement : 'Historique incomplet : énoncé, acceptation et déclaration résultante inconnus.'}</Text>
          <Text style={styles.caption}>Date originale : {receipt.recordedAt ?? 'Inconnue'} · énoncé version {receipt.statementVersion ?? 'Inconnue'} · déclaration version {receipt.resultingDeclaration?.declarationVersion ?? 'Inconnue'} · acceptation {receipt.accepted === true ? 'enregistrée' : 'inconnue'}.</Text>
          <Text style={styles.caption}>Référence antérieure : {receipt.previous?.reference?.id ?? 'Inconnue'} · empreinte antérieure : {receipt.previous?.hash ?? 'Inconnue'}.</Text>
        </View>)}
        {activityData.history.hasMore ? <Button variant="secondary" onPress={() => activityPage('cursor', activityData.history.cursor)}>Déclarations : page d’audit suivante</Button> : null}
        <Text style={styles.title}>Captures déclaratives des ventes</Text>
        {!activityData.relatedSales.items.length ? <Text style={styles.body}>Aucune vente sur cette page.</Text> : activityData.relatedSales.items.map(sale => <View key={sale.id} style={styles.signal}>
          <Text selectable style={styles.caption}>Commande native : {sale.id} · état {sale.status ?? 'inconnu'} · créée le {sale.createdAt ?? 'date inconnue'}.</Text>
          <Text style={styles.body}>{activityCaptureLabel(sale.sellerActivityAdmission)}</Text>
          <Button variant="ghost" onPress={rereadActivitySource}>Relire la capture native de cette commande</Button>
        </View>)}
        {activityData.relatedSales.hasMore ? <Button variant="secondary" onPress={() => activityPage('relatedSalesCursor', activityData.relatedSales.cursor)}>Captures de ventes : page suivante</Button> : null}
        {(['initiated','received'] as const).map(side => {
          const swaps = activityData.relatedSwaps[side];
          return <View key={side} style={styles.signal}><Text style={styles.title}>{side === 'initiated' ? 'Trocs proposés par le propriétaire' : 'Trocs reçus par le propriétaire'}</Text>
            {!swaps.items.length ? <Text style={styles.body}>Aucun Troc sur cette page.</Text> : swaps.items.map(swap => <View key={swap.id} style={styles.signal}>
              <Text selectable style={styles.caption}>Troc natif : {swap.id} · état {swap.status ?? 'inconnu'} · accepté le {swap.acceptedAt ?? 'date inconnue'}.</Text>
              <Text style={styles.body}>Capture du propriétaire à la proposition : {activityCaptureLabel(swap.proposal)}</Text>
              <Text style={styles.body}>Capture du propriétaire à l’acceptation : {activityCaptureLabel(swap.acceptance)}</Text>
              <Button variant="ghost" onPress={rereadActivitySource}>Relire les captures natives de ce Troc</Button>
            </View>)}
            {swaps.hasMore ? <Button variant="secondary" onPress={() => activityPage(side === 'initiated' ? 'initiatedSwapsCursor' : 'receivedSwapsCursor', swaps.cursor)}>Captures de Trocs : page suivante</Button> : null}
          </View>;
        })}
        {Object.values(activityCursors).some(Boolean) ? <Button variant="ghost" onPress={() => {try {activityContext.capture(); setActivityPages({scope: activityScope, cursors: {}});} catch { /* Stale source. */ }}}>Revenir aux premières pages déclaratives</Button> : null}
      </> : null}
      {current.relatedSales?.hasMore && current.relatedSales.cursor ? <Button variant="secondary" disabled={busy || uncertain || detail.isFetching}
        loading={detail.isFetching} onPress={() => {
          if (!uid || current.request.id !== selectedId || sessionKey !== JSON.stringify([uid, getAuthSessionGeneration()]) || !current.relatedSales.cursor) return;
          setConfirmation(null);
          setRelatedSalesPage({ reviewId: current.request.id, sessionKey, cursor: current.relatedSales.cursor,
            ownerId: current.request.ownerId, expectedVersion: current.eligibility.version, expectedRequestVersion: current.request.requestVersion });
        }}>Afficher les ventes liées suivantes</Button> : null}
      {open ? <>
        {compatibleOutcomes.map(value => <Checkbox key={value} checked={outcome === value} disabled={busy || uncertain}
          onToggle={() => { setOutcome(value); setClearSignalIds([]); setConfirmation(null); }} accessibilityLabel={outcomeLabels[value]}><Text style={styles.body}>{outcomeLabels[value]}</Text></Checkbox>)}
        <Input label="Motif visible par le propriétaire" accessibilityLabel="Motif visible par le propriétaire" value={ownerReason} onChangeText={value => { setOwnerReason(value); setConfirmation(null); }} maxLength={2000} multiline disabled={busy || uncertain} />
        <Input label="Note interne privée" accessibilityLabel="Note interne privée" value={internalNote} onChangeText={value => { setInternalNote(value); setConfirmation(null); }} maxLength={2000} multiline disabled={busy || uncertain} />
        {rejectCorrection ? <>
          <Input label="Fondement légal communiqué du refus" accessibilityLabel="Fondement légal communiqué du refus" value={legalBasis} onChangeText={value => { setLegalBasis(value); setConfirmation(null); }} multiline maxLength={2000} disabled={busy || uncertain} />
          <Input label="Recours communiqué au propriétaire" accessibilityLabel="Recours communiqué au propriétaire" value={recourse} onChangeText={value => { setRecourse(value); setConfirmation(null); }} multiline maxLength={2000} disabled={busy || uncertain} />
        </> : null}
        <Button disabled={!ownerReason.trim() || (rejectCorrection && (!legalBasis.trim() || !recourse.trim())) || busy || uncertain || decide.isRestoring} onPress={prepareDecision}>Vérifier la décision</Button>
      </> : <Text style={styles.body}>Ce dossier est clos. Une nouvelle demande du propriétaire garde sa trace.</Text>}
      <Input label="Note privée du nouveau signal" accessibilityLabel="Note privée du nouveau signal" value={flagNote}
        onChangeText={value => { setFlagNote(value); setConfirmation(null); }} multiline maxLength={2000} disabled={busy || uncertain} />
        {scopes.map(value => <Checkbox key={value} checked={signalScope === value} disabled={busy || uncertain}
          onToggle={() => { setSignalScope(value); setConfirmation(null); }} accessibilityLabel={`Signaler ${ELIGIBILITY_SCOPE_LABELS[value]}`}><Text style={styles.body}>Signal : {ELIGIBILITY_SCOPE_LABELS[value]}</Text></Checkbox>)}
        <Button variant="secondary" disabled={!flagNote.trim() || busy || uncertain || flag.isRestoring} onPress={() => setConfirmation({ ownerId: current.request.ownerId, scope: signalScope,
          internalNote: flagNote.trim(), expectedVersion: current.eligibility.version })}>Vérifier le signal d’examen</Button>
      {confirmation ? <View style={styles.signal}>
        <Text style={styles.title}>Confirmer l’enregistrement</Text>
        <Text selectable style={styles.caption}>Version du profil : {confirmation.expectedVersion}</Text>
        <Text style={styles.body}>{'reviewId' in confirmation ? `${outcomeLabels[confirmation.outcome]} · dossier ${confirmation.reviewId} version ${confirmation.expectedRequestVersion} · motif propriétaire : ${confirmation.ownerReason}` : `Signal privé ${ELIGIBILITY_SCOPE_LABELS[confirmation.scope]} pour ${confirmation.ownerId}`}</Text>
        {'reviewId' in confirmation && confirmation.clearSignalIds?.length ? <Text style={styles.body}>Signaux à clore : {confirmation.clearSignalIds.join(', ')}</Text> : null}
        {confirmationStale ? <Text style={styles.notice}>Ce dossier a changé. Relisez-le et vérifiez de nouveau votre décision.</Text> : null}
        <Button disabled={!!confirmationStale || busy || uncertain} loading={busy} onPress={() => { void execute(() => 'reviewId' in confirmation ? decide.send(confirmation) : flag.send(confirmation), 'reviewId' in confirmation ? 'Décision enregistrée. Consultez l’état relu du dossier.' : 'Signal d’examen enregistré.'); }}>Enregistrer la décision</Button>
      </View> : null}
    </> : null}
    {uncertain ? <><Text style={styles.notice}>Une tentative doit être rapprochée avant une nouvelle décision. La même référence et le même contenu seront repris.</Text>
      <Text selectable style={styles.caption}>{decide.pendingPayload?.requestId ?? flag.pendingPayload?.requestId}</Text>
      <Button disabled={busy} onPress={() => { void resume().catch(error => setMessage(eligibilityErrorMessage(error))); }}>Relire puis reprendre la tentative</Button></> : null}
  </View>;
  return <View style={styles.container}><ScreenHeader title="Admissibilité" onBack={() => router.back()} /><AdminSectionNav />
    <FlashList data={queue.data?.pages.flatMap(page => page.items) ?? []} keyExtractor={keyExtractor} renderItem={renderItem}
      ListHeaderComponent={header} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
      ListFooterComponent={queue.hasNextPage ? <Button disabled={queue.isFetchingNextPage} loading={queue.isFetchingNextPage} onPress={() => { void queue.fetchNextPage(); }}>Afficher les dossiers suivants</Button> : null} />
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.md, gap: spacing.md },
  list: { paddingBottom: spacing.xl }, title: { ...typography.h3, color: colors.foreground }, body: { ...typography.body, color: colors.foregroundSecondary },
  caption: { ...typography.caption, color: colors.muted }, notice: { ...typography.body, color: colors.danger }, signal: { padding: spacing.md, backgroundColor: colors.surface, gap: spacing.sm } });
