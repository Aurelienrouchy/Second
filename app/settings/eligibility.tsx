import React, { useCallback, useState, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Button, Checkbox, Input, ScreenHeader } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { PAYMENTS_ENABLED, SHIPPING_ENABLED } from '@/config/featureFlags';
import { EligibilityDecisionCard, EligibilityDateSection, SellerActivityDeclaration } from '@/features/account';
import { useAuthenticatedSession } from '@/hooks/useAuth';
import { useEligibility, useEligibilityOperation, useMyEligibilityReviews } from '@/hooks/useEligibility';
import {isEligibilityReviewReference} from '@/services/sellerActivityReviewService';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { EligibilityService, parseSellerActivityReceipt } from '@/services/eligibilityService';
import type { AddEligibilityReviewDetailsInput, DeclareSellerActivityInput, EligibilityReview,
  EligibilityReviewKind, EligibilityScope, RequestEligibilityReviewInput, SellerActivityKind, SellerActivityReceipt,
  SellerActivityPageCursors, SellerActivityAdmission } from '@/types/eligibility';
import { declaredDateLabel, ELIGIBILITY_REVIEW_LABELS, ELIGIBILITY_SCOPE_LABELS, eligibilityErrorMessage, isEligibilityConflict } from '@/utils/eligibilityPresentation';
import { computeAgeFromIso, toIsoDate } from '@/utils/age';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';

const keyExtractor = (item: EligibilityReview) => item.id;
const scopes: EligibilityScope[] = ['buy', 'sell', 'new_paid_shipping'];
const captureLabel = (capture: SellerActivityAdmission | undefined) => capture?.qualification === 'native_capture'
  ? `Capture native du ${capture.capturedAt}. Déclaration ${capture.parties[0]?.activity.statementVersion ?? 'de version inconnue'}, enregistrée le ${capture.parties[0]?.activity.recordedAt ?? 'date inconnue'}. ${capture.parties[0]?.activity.qualification === 'native_original' ? 'Reçu déclaratif original lié.' : 'Origine historique de la déclaration inconnue.'}`
  : 'Statut déclaratif au moment de cet accord : inconnu. Aucune déclaration actuelle ne complète rétroactivement cette source.';
const deadlineStateLabels: Record<EligibilityReview['deadlineState'], string> = {
  pending: 'Réponse attendue',
  overdue: 'Délai dépassé',
  answered: 'Réponse enregistrée',
  not_applicable: 'Sans échéance applicable',
};
export default function EligibilityScreen() {
  const { uid, identity } = useAuthenticatedSession();
  const params = useLocalSearchParams<{reviewId?: string | string[]}>(), requestedReviewId = isEligibilityReviewReference(params.reviewId) ? params.reviewId : null;
  const routeKey = JSON.stringify([uid, getAuthSessionGeneration(), requestedReviewId]), [routeBinding, setRouteBinding] = useState(routeKey);
  const eligibility = useEligibility();
  const reviews = useMyEligibilityReviews();
  const [selectedId, setSelectedId] = useState<string | null>(requestedReviewId);
  if (routeBinding !== routeKey) {setRouteBinding(routeKey); setSelectedId(requestedReviewId);}
  const dossierFrame = useLabelLifecycleContext(`owner-eligibility-detail:${selectedId}`, uid);
  const detail = useQuery({queryKey: ['owner-eligibility-detail', uid, getAuthSessionGeneration(), dossierFrame.focusRevision, selectedId], enabled: !!uid && !!selectedId && dossierFrame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = dossierFrame.capture(); return EligibilityService.getReview(uid!, selectedId!, () => dossierFrame.assertCurrent(op));}});
  const [activity, setActivity] = useState<SellerActivityKind | null>(null);
  const [residenceChoice, setResidenceChoice] = useState<'quebec' | 'elsewhere' | null>(null);
  const [residenceAccepted, setResidenceAccepted] = useState(false);
  const declarationRevision = useRef(0);
  const [acceptance, setAcceptance] = useState<{ statementKey: string | null; accepted: boolean }>({ statementKey: null, accepted: false });
  const [kind, setKind] = useState<EligibilityReviewKind>('review');
  const [scope, setScope] = useState<EligibilityScope>('sell');
  const [priorReviewId, setPriorReviewId] = useState<string | undefined>();
  const [day, setDay] = useState(''); const [month, setMonth] = useState(''); const [year, setYear] = useState('');
  const [reason, setReason] = useState(''); const [details, setDetails] = useState('');
  const [message, setMessage] = useState('');
  const activitySession = JSON.stringify([uid, getAuthSessionGeneration()]);
  const [activityPages, setActivityPages] = useState<{session: string; cursors: SellerActivityPageCursors} | null>(null);
  const activityCursors = activityPages?.session === activitySession ? activityPages.cursors : {};
  const activityHistoryContext = useLabelLifecycleContext(JSON.stringify(['seller-activity-history', activityCursors]), uid);
  const [originalReceipt, setOriginalReceipt] = useState<{frame: symbol; focus: string; receipt: SellerActivityReceipt} | null>(null);
  const activityHistory = useQuery({queryKey: ['seller-activity-history', uid, getAuthSessionGeneration(), activityHistoryContext.focusRevision, activityCursors],
    enabled: !!uid && activityHistoryContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = activityHistoryContext.capture(); return EligibilityService.getActivityHistory(uid!, activityCursors, () => activityHistoryContext.assertCurrent(operation));}});
  const activityHistoryData = activityHistoryContext.focused && activityHistory.isSuccess && !activityHistory.isFetching ? activityHistory.data : null;
  const visibleOriginal = activityHistoryContext.focused && originalReceipt?.frame === activityHistoryContext.frame && originalReceipt.focus === activityHistoryContext.focusRevision ? originalReceipt.receipt : null;
  const activityPage = (field: keyof SellerActivityPageCursors, cursor: string | null) => {
    try {activityHistoryContext.capture();} catch {return;}
    if (!cursor || !activityHistoryData) return;
    setActivityPages({session: activitySession, cursors: {...activityCursors, [field]: cursor}});
  };
  const openAgreement = (kind: 'purchase' | 'swap', id: string) => {
    try {activityHistoryContext.capture();} catch {return;}
    const exists = kind === 'purchase' ? activityHistoryData?.relatedSales.items.some(item => item.id === id)
      : [...(activityHistoryData?.relatedSwaps.initiated.items ?? []), ...(activityHistoryData?.relatedSwaps.received.items ?? [])].some(item => item.id === id);
    if (exists) router.push({pathname: kind === 'purchase' ? '/orders/[id]' : '/swap/[id]', params: {id}} as never);
  };
  const declare = useEligibilityOperation<Omit<DeclareSellerActivityInput, 'requestId'>>(EligibilityService.declareActivity, 'declare');
  const request = useEligibilityOperation<Omit<RequestEligibilityReviewInput, 'requestId'>>(EligibilityService.requestReview, 'request');
  const add = useEligibilityOperation<Omit<AddEligibilityReviewDetailsInput, 'requestId'>>(EligibilityService.addDetails, 'details');
  const [formUid, setFormUid] = useState(uid);
  if (formUid !== uid) {
    setFormUid(uid); setSelectedId(requestedReviewId); setActivity(null); setResidenceChoice(null); setResidenceAccepted(false); setAcceptance({ statementKey: null, accepted: false }); setReason(''); setDetails('');
    setDay(''); setMonth(''); setYear(''); setPriorReviewId(undefined); setKind('review'); setScope('sell'); setMessage('');
  }

  useFocusEffect(useCallback(() => { if (uid) { void eligibility.refetch(); void reviews.refetch(); } }, [uid, eligibility.refetch, reviews.refetch]));
  const current = dossierFrame.focused && detail.isSuccess && !detail.isFetching && !detail.isError && detail.data?.request.id === selectedId ? detail.data : undefined;
  const busy = declare.isPending || request.isPending || add.isPending;
  const uncertain = declare.hasPendingOperation || request.hasPendingOperation || add.hasPendingOperation;
  const execute = async (action: () => Promise<unknown>, success: string) => {
    if (!uid) return;
    let operation: ReturnType<typeof activityHistoryContext.capture>;
    try {operation = activityHistoryContext.capture();} catch {return;}
    const currentOperation = () => activityHistoryContext.assertCurrent(operation);
    try { const result = await action(); currentOperation(); if (result) {
      if (typeof result === 'object' && 'declarationReceipt' in result) setOriginalReceipt({frame: activityHistoryContext.frame, focus: activityHistoryContext.focusRevision, receipt: parseSellerActivityReceipt(result.declarationReceipt, uid)});
      setMessage(success); await eligibility.refetch(); currentOperation(); await reviews.refetch(); currentOperation(); await activityHistory.refetch(); currentOperation(); if (selectedId) await detail.refetch();
    } }
    catch (error) { try {currentOperation();} catch {return;} setMessage(eligibilityErrorMessage(error)); if (isEligibilityConflict(error)) { await eligibility.refetch(); if (selectedId) await detail.refetch(); } }
  };
  const renderItem = useCallback(({ item }: { item: EligibilityReview }) => <Button variant="secondary"
    onPress={() => { setSelectedId(item.id); setDetails(''); }} accessibilityLabel={`Ouvrir la demande ${item.id}`}>
    {`${item.kind === 'date_of_birth_correction' ? 'Correction de naissance' : 'Examen'} · ${ELIGIBILITY_REVIEW_LABELS[item.status]} · ${item.id}`}
  </Button>, []);
  const dto = eligibility.data;
  const declarationContext = useLabelLifecycleContext(JSON.stringify(['activity-declaration', dto?.version, dto?.statementVersion,
    dto?.statements, dto?.quebecResidenceStatementVersion, dto?.quebecResidenceStatement, activity, residenceChoice]), uid);
  const replayContext = useLabelLifecycleContext(JSON.stringify(['eligibility-replay', declare.pendingPayload?.requestId,
    request.pendingPayload?.requestId, add.pendingPayload?.requestId]), uid);
  const statementKey = activity && dto ? JSON.stringify([uid, getAuthSessionGeneration(), activity, dto.statementVersion, dto.statements[activity],
    dto.quebecResidenceStatementVersion, dto.quebecResidenceStatement, residenceChoice, declarationContext.focusRevision]) : null;
  const accepted = statementKey !== null && acceptance.statementKey === statementKey && acceptance.accepted;
  if (acceptance.statementKey !== statementKey) { setAcceptance({ statementKey, accepted: false }); setResidenceAccepted(false); }
  const availability = !PAYMENTS_ENABLED && !SHIPPING_ENABLED
    ? 'Les paiements dans l’application et les étiquettes de livraison pour les achats ne sont actuellement pas disponibles.'
    : !PAYMENTS_ENABLED ? 'Les paiements dans l’application ne sont actuellement pas disponibles.'
      : !SHIPPING_ENABLED ? 'Les étiquettes de livraison pour les achats ne sont actuellement pas disponibles.' : null;
  const isoDate = toIsoDate(Number(year), Number(month), Number(day));
  const validDate = !!isoDate && computeAgeFromIso(isoDate) !== null && computeAgeFromIso(isoDate)! >= 0;
  const resume = async () => {
    const operation = replayContext.capture();
    const assertCurrent = () => replayContext.assertCurrent(operation);
    // Read the existing owner records before replaying the frozen operation.
    await eligibility.refetch(); await reviews.refetch();
    assertCurrent();
    if (declare.pendingPayload) await execute(() => declare.send(declare.pendingPayload!, {assertCurrent}), 'Déclaration enregistrée.');
    else if (request.pendingPayload) await execute(() => request.send(request.pendingPayload!), 'Demande enregistrée.');
    else if (add.pendingPayload) {
      await EligibilityService.getReview(uid!, add.pendingPayload.reviewId);
      await execute(() => add.send(add.pendingPayload!), 'Précisions enregistrées.');
    }
  };
  const header = <View style={styles.content}>
    <Text style={styles.body}>Pour les nouveaux achats, ventes et Trocs, vous devez avoir 18 ans. Les nouvelles ventes et les nouveaux Trocs sont réservés aux particuliers.</Text>
    <Text style={styles.body}>Ces renseignements permettent de vérifier les critères pour vos prochains achats et ventes. La disponibilité dépend aussi du statut de votre compte et du parcours choisi.</Text>
    <Button variant="secondary" disabled={!uid} onPress={() => {try {replayContext.capture(); router.push('/settings/decisions' as never);} catch { /* Stale session or activity. */ }}}>Mes vérifications</Button>
    {availability ? <Text style={styles.body}>{availability}</Text> : null}
    <Text style={styles.body}>{identity?.isActive === false ? 'Votre compte nécessite une régularisation. Vous pouvez suivre vos demandes et commandes existantes.' : 'Le statut du compte et les contrôles de chaque opération restent distincts de ces critères.'}</Text>
    {(declare.restoreError || request.restoreError || add.restoreError) ? <><Text style={styles.notice}>Impossible de relire la tentative précédente. Réessayez avant un nouvel envoi.</Text><Button onPress={() => { declare.retryRestore(); request.retryRestore(); add.retryRestore();  }}>Relire la tentative conservée</Button></> : null}
    {message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text> : null}
    {visibleOriginal ? <View style={styles.content}>
      <Text style={styles.title}>Reçu de votre déclaration d’origine</Text>
      <Text selectable style={styles.caption}>Référence : {visibleOriginal.id} · empreinte : {visibleOriginal.receiptHash ?? 'Inconnue'}</Text>
      <Text style={styles.body}>{visibleOriginal.qualification === 'native_original' ? visibleOriginal.statement : 'Énoncé et acceptation d’origine inconnus : ancien historique incomplet.'}</Text>
      <Text style={styles.caption}>Date de l’événement : {visibleOriginal.recordedAt ?? 'Inconnue'} · version de l’énoncé : {visibleOriginal.statementVersion ?? 'Inconnue'}.</Text>
      <Text style={styles.body}>Ce reçu reste celui de la demande initiale lors d’une reprise. Les renseignements actuels et leurs décisions sont relus séparément.</Text>
    </View> : null}
    {!uid ? <Text style={styles.body}>Connectez-vous pour consulter vos renseignements privés.</Text> : eligibility.isPending ? <Text style={styles.body}>Chargement des renseignements…</Text> : eligibility.isError ? <>
      <Text style={styles.notice}>{eligibilityErrorMessage(eligibility.error)}</Text><Button onPress={() => { void eligibility.refetch(); }}>Réessayer</Button>
    </> : dto ? <>
      {scopes.map(value => <EligibilityDecisionCard key={value} decision={dto.decisions[value]} />)}
      <Text style={styles.title}>Le Troc au Québec</Text>
      <Text style={styles.body}>Les nouveaux Trocs sont réservés aux particuliers de 18 ans et plus ayant déclaré résider au Québec. La remise en main propre et l’envoi postal organisé entre les membres sont proposés. Les échanges déjà acceptés restent accessibles.</Text>
      <Text style={styles.body}>{dto.swapLaunch?.messages.join(' ') || 'Les critères du Troc doivent être relus depuis le serveur.'}</Text>
      {dto.quebecResidenceDeclaration ? <Text style={styles.caption}>{dto.quebecResidenceDeclaration.accepted === false ? 'Retrait de la déclaration de résidence au Québec enregistré.' : `Déclaration de résidence enregistrée : ${dto.quebecResidenceDeclaration.statement}`} · {dto.quebecResidenceDeclaration.recordedAt ?? 'date indisponible'}. Cette déclaration ne certifie pas votre résidence.</Text> : null}
      {!dto.decisions.sell.allowed && dto.decisions.sell.reasons.some(value => ['underage', 'review_required'].includes(value)) ? <View style={styles.content}>
        <Text style={styles.body}>Les nouvelles ventes ne sont actuellement pas permises. Si vous avez une vente déjà engagée, ouvrez son dossier dans Mes ventes existantes et contactez notre équipe avec sa référence. Conservez vos échanges et vos preuves.</Text>
        <Button variant="secondary" onPress={() => router.push('/my-sales')}>Ouvrir Mes ventes existantes</Button>
        <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
      </View> : null}
      <EligibilityDateSection eligibility={dto} onFirstDate={() => {
        // This regularization entry never resumes a stale protected-action callback.
        useAuthStore.setState({ pendingConsentOnSuccess: null }); router.push('/complete-profile');
      }} onCorrection={() => { setKind('date_of_birth_correction'); setScope('buy'); setPriorReviewId(undefined); }} />
      <Text style={styles.title}>Votre résidence déclarée pour Le Troc</Text>
      <Checkbox checked={residenceChoice === 'quebec'} disabled={busy || uncertain} onToggle={() => { declarationRevision.current++; setResidenceChoice('quebec'); setResidenceAccepted(false); }} accessibilityLabel="Je réside au Québec"><Text style={styles.body}>Je réside au Québec</Text></Checkbox>
      <Checkbox checked={residenceChoice === 'elsewhere'} disabled={busy || uncertain} onToggle={() => { declarationRevision.current++; setResidenceChoice('elsewhere'); setResidenceAccepted(false); }} accessibilityLabel="Je ne réside pas au Québec"><Text style={styles.body}>Je ne réside pas au Québec</Text></Checkbox>
      {residenceChoice === 'quebec' && dto.quebecResidenceStatementVersion === '2026-10-17.v1' && dto.quebecResidenceStatement ?
        <Checkbox checked={residenceAccepted} disabled={busy || uncertain} onToggle={() => { try { declarationContext.capture(); declarationRevision.current++; setResidenceAccepted(value => !value); } catch { setResidenceAccepted(false); } }} accessibilityLabel={dto.quebecResidenceStatement}><Text style={styles.body}>{dto.quebecResidenceStatement}</Text></Checkbox> : null}
      <Text style={styles.caption}>Ce choix est déclaré par vous. Il n’est jamais déduit de votre adresse d’achat ou de votre compte de paiement.</Text>
      <Text style={styles.caption}>État déclaratif actuel ci-dessous. Enregistrer votre choix est une nouvelle déclaration explicite ; consulter l’historique n’enregistre aucun changement.</Text>
      <SellerActivityDeclaration eligibility={dto} activity={activity} accepted={accepted} busy={busy} uncertain={uncertain}
        isPending={declare.isPending} isRestoring={declare.isRestoring || (residenceChoice === 'quebec' && !residenceAccepted)} onActivity={value => { declarationRevision.current++; setActivity(value); setAcceptance({ statementKey: null, accepted: false }); }}
        onToggleAccepted={() => { declarationRevision.current++; setAcceptance({ statementKey, accepted: !accepted }); }} onSubmit={() => { if (activity && accepted && !busy && !uncertain && !declare.isRestoring) void execute(async () => {
          const operation = declarationContext.capture();
          const revision = declarationRevision.current;
          return declare.send({ kind: activity,
          statementVersion: dto.statementVersion, personalDeclarationAccepted: activity === 'personal' && accepted,
          ...(residenceChoice !== null ? {expectedUid: uid!, quebecResidenceDeclaration: {version: '2026-10-17.v1' as const, country: 'CA' as const, province: 'QC' as const, accepted: residenceChoice === 'quebec' && residenceAccepted}} : {}),
          expectedVersion: dto.version }, {assertCurrent: () => { declarationContext.assertCurrent(operation); if (revision !== declarationRevision.current) throw new Error('Relisez votre déclaration.'); }});
        }, 'Déclaration enregistrée. Consultez la décision ci-dessus.'); }} />
      <Text style={styles.title}>Renseignements vendeur et départ des colis</Text>
      <Text style={styles.body}>{dto.sellerQuebecEvidence?.status === 'observed' ? 'Renseignements du compte de paiement disponibles.' : 'Renseignements du compte de paiement à compléter ou à examiner.'} Ces données observées ne constituent pas une résidence vérifiée.</Text>
      <Text style={styles.body}>Pour une nouvelle expédition payée, le vendeur, le départ du colis et la livraison doivent être au Québec. Les anciennes commandes restent accessibles.</Text>
      <Text style={styles.title}>{kind === 'date_of_birth_correction' ? 'Demande de correction de naissance' : 'Demander un examen de ma situation'}</Text>
      {priorReviewId ? <Text style={styles.body}>Nouvel examen du dossier {priorReviewId}</Text> : null}
      {kind === 'review' ? scopes.map(value => <Checkbox key={value} checked={scope === value} disabled={busy || uncertain}
        onToggle={() => setScope(value)} accessibilityLabel={ELIGIBILITY_SCOPE_LABELS[value]}><Text style={styles.body}>{ELIGIBILITY_SCOPE_LABELS[value]}</Text></Checkbox>) : <>
        <Input label="Jour de naissance demandé" accessibilityLabel="Jour de naissance demandé" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} disabled={busy || uncertain} />
        <Input label="Mois de naissance demandé" accessibilityLabel="Mois de naissance demandé" value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} disabled={busy || uncertain} />
        <Input label="Année de naissance demandée" accessibilityLabel="Année de naissance demandée" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} disabled={busy || uncertain}
          error={day && month && year.length === 4 && !validDate ? 'Vérifiez votre date de naissance.' : undefined} />
        <Text style={styles.body}>La date enregistrée ne sera pas modifiée immédiatement. La correction sera examinée.</Text>
      </>}
      <Input label="Motif de la demande" accessibilityLabel="Motif de la demande" value={reason} onChangeText={setReason} maxLength={2000} multiline disabled={busy || uncertain} />
      <Button disabled={!reason.trim() || (kind === 'date_of_birth_correction' && !validDate) || busy || uncertain || request.isRestoring}
        loading={request.isPending} onPress={() => { void execute(() => request.send({ kind, scope, reason: reason.trim(), expectedVersion: dto.version,
          ...(kind === 'date_of_birth_correction' && isoDate ? { proposedDateOfBirth: isoDate } : {}), ...(priorReviewId ? { priorReviewId } : {}) }), 'Demande enregistrée. Suivez son examen dans Vos demandes.'); }}>Envoyer la demande</Button>
      {kind === 'date_of_birth_correction' || priorReviewId ? <Button variant="ghost" disabled={busy || uncertain} onPress={() => { setKind('review'); setPriorReviewId(undefined); }}>Demander un autre examen</Button> : null}
      {uncertain ? <><Text style={styles.notice}>Une tentative reste à rapprocher. Sa référence et son contenu sont conservés ; relisez vos dossiers avant de la reprendre.</Text>
        <Text selectable style={styles.caption}>{declare.pendingPayload?.requestId ?? request.pendingPayload?.requestId ?? add.pendingPayload?.requestId}</Text>
        <Button disabled={busy} onPress={() => { void resume().catch(error => setMessage(eligibilityErrorMessage(error))); }}>Relire puis reprendre la tentative</Button></> : null}
    </> : null}
    <Text style={styles.title}>Historique de votre activité déclarée</Text>
    <Text style={styles.body}>Les événements d’origine et les captures faites lors des accords restent distincts de votre état actuel. Ils ne déterminent pas un statut juridique ou fiscal ni une date de prise d’effet légale.</Text>
    {uid ? <Button variant="secondary" disabled={activityHistory.isFetching} onPress={() => {try {activityHistoryContext.capture(); void activityHistory.refetch();} catch { /* Stale source or session. */ }}}>Relire mon historique déclaratif</Button> : null}
    {activityHistory.isError ? <Text style={styles.notice}>Historique indisponible. Aucune absence de déclaration n’en est déduite.</Text> : activityHistory.isFetching ? <Text style={styles.body}>Lecture de la page native…</Text> : null}
    {activityHistoryData ? <>
      <Text style={styles.body}>État actuel relu : {activityHistoryData.currentEligibility.activityDeclaration?.statement ?? 'Déclaration actuelle inconnue'} · enregistré le {activityHistoryData.currentEligibility.activityDeclaration?.recordedAt ?? 'date inconnue'}.</Text>
      <Text style={styles.caption}>Page d’audit du compte : elle peut contenir d’autres événements. Une page sans déclaration peut avoir une suite.</Text>
      {activityHistoryData.history.items.length === 0 ? <Text style={styles.body}>Aucune déclaration sur cette page. {activityHistoryData.history.hasMore ? 'La lecture peut continuer.' : 'Fin de cette lecture paginée.'}</Text> : activityHistoryData.history.items.map(receipt => <View key={receipt.id} style={styles.content}>
        <Text selectable style={styles.caption}>Déclaration : {receipt.id} · empreinte {receipt.receiptHash ?? 'inconnue'}</Text>
        <Text style={styles.body}>{receipt.qualification === 'native_original' ? receipt.statement : 'Historique incomplet : énoncé, acceptation et résultat d’origine inconnus.'}</Text>
        <Text style={styles.caption}>Date originale : {receipt.recordedAt ?? 'Inconnue'} · énoncé version {receipt.statementVersion ?? 'Inconnue'} · déclaration version {receipt.resultingDeclaration?.declarationVersion ?? 'Inconnue'} · acceptation {receipt.accepted === true ? 'enregistrée' : 'inconnue'}.</Text>
        <Text style={styles.caption}>Lien antérieur : {receipt.previous?.reference?.id ?? 'Inconnu'} · empreinte antérieure {receipt.previous?.hash ?? 'inconnue'}.</Text>
      </View>)}
      {activityHistoryData.history.hasMore ? <Button variant="secondary" onPress={() => activityPage('cursor', activityHistoryData.history.cursor)}>Déclarations : page d’audit suivante</Button> : null}
      <Text style={styles.title}>Statut capturé dans vos ventes</Text>
      {activityHistoryData.relatedSales.items.length === 0 ? <Text style={styles.body}>Aucune vente sur cette page.</Text> : activityHistoryData.relatedSales.items.map(sale => <View key={sale.id} style={styles.content}>
        <Text style={styles.caption}>Vente {sale.id} · état {sale.status ?? 'inconnu'} · créée le {sale.createdAt ?? 'date inconnue'}.</Text>
        <Text style={styles.body}>{captureLabel(sale.sellerActivityAdmission)}</Text>
        <Button variant="ghost" onPress={() => openAgreement('purchase', sale.id)}>Relire cette commande native</Button>
      </View>)}
      {activityHistoryData.relatedSales.hasMore ? <Button variant="secondary" onPress={() => activityPage('relatedSalesCursor', activityHistoryData.relatedSales.cursor)}>Ventes : page suivante</Button> : null}
      {(['initiated', 'received'] as const).map(side => {
        const swaps = activityHistoryData.relatedSwaps[side];
        return <View key={side} style={styles.content}><Text style={styles.title}>{side === 'initiated' ? 'Vos Trocs proposés' : 'Vos Trocs reçus'}</Text>
          {!swaps.items.length ? <Text style={styles.body}>Aucun Troc sur cette page.</Text> : swaps.items.map(swap => <View key={swap.id} style={styles.content}>
            <Text style={styles.caption}>Troc {swap.id} · état {swap.status ?? 'inconnu'} · accepté le {swap.acceptedAt ?? 'date inconnue'}.</Text>
            <Text style={styles.body}>Votre capture à la proposition : {captureLabel(swap.proposal)}</Text>
            <Text style={styles.body}>Votre capture à l’acceptation : {captureLabel(swap.acceptance)}</Text>
            <Button variant="ghost" onPress={() => openAgreement('swap', swap.id)}>Relire ce Troc natif</Button>
          </View>)}
          {swaps.hasMore ? <Button variant="secondary" onPress={() => activityPage(side === 'initiated' ? 'initiatedSwapsCursor' : 'receivedSwapsCursor', swaps.cursor)}>Trocs : page suivante</Button> : null}
        </View>;
      })}
      {Object.values(activityCursors).some(Boolean) ? <Button variant="ghost" onPress={() => {try {activityHistoryContext.capture(); setActivityPages({session: activitySession, cursors: {}});} catch { /* Stale source. */ }}}>Revenir aux premières pages de l’historique</Button> : null}
    </> : null}
    <Text style={styles.title}>Vos demandes</Text>
    {reviews.isError ? <><Text style={styles.notice}>{eligibilityErrorMessage(reviews.error)}</Text><Button onPress={() => { void reviews.refetch(); }}>Actualiser les demandes</Button></> : reviews.isPending ? <Text style={styles.body}>Chargement des demandes…</Text> : reviews.data?.pages.every(page => page.items.length === 0) ? <Text style={styles.body}>Aucune demande enregistrée.</Text> : null}
    {selectedId && detail.isPending ? <Text style={styles.body}>Chargement du dossier…</Text> : selectedId && detail.isError ? <><Text style={styles.notice}>{eligibilityErrorMessage(detail.error)}</Text><Button onPress={() => { void detail.refetch(); }}>Relire le dossier</Button></> : current ? <>
      <Text selectable style={styles.title}>{current.request.id} · {ELIGIBILITY_REVIEW_LABELS[current.request.status]}</Text>
      <Text style={styles.caption}>Version {current.request.requestVersion} · politique {current.request.policyVersion}</Text>
      <Text style={styles.body}>{current.request.reason}</Text>
      {current.request.kind === 'date_of_birth_correction' ? <Text style={styles.body}>Date enregistrée : {declaredDateLabel(current.request.originalDateOfBirth, current.request.originalDateOfBirthCopy)}. Date demandée : {current.request.proposedDateOfBirth}.</Text> : null}
      <Text style={styles.body}>{current.request.ownerDecisionReason ?? 'Examen en attente.'}</Text>
      {current.request.ownerResponse ? <Text style={styles.body}>{current.request.ownerResponse.text} {current.request.ownerResponse.legalBasis} {current.request.ownerResponse.recourse}</Text> : null}
      {current.request.statutoryDueDate ? <Text style={styles.caption}>Date limite de réponse au dossier : {current.request.statutoryDueDate} · {deadlineStateLabels[current.request.deadlineState] ?? 'État de la réponse à vérifier'}. Une absence de réponse ne constitue pas une permission.</Text> : null}
      {current.request.latestOwnerDetails ? <Text style={styles.body}>{current.request.latestOwnerDetails}</Text> : null}
      {['submitted', 'needs_information'].includes(current.request.status) ? <>
        <Input label="Précisions pour ce dossier" accessibilityLabel="Précisions pour ce dossier" value={details} onChangeText={setDetails} multiline maxLength={2000} disabled={busy || uncertain} />
        <Button disabled={!details.trim() || busy || uncertain || add.isRestoring} loading={add.isPending} onPress={() => { void execute(() => add.send({ reviewId: current.request.id, details: details.trim(), expectedRequestVersion: current.request.requestVersion,
          expectedVersion: current.eligibility.version }), 'Précisions enregistrées.'); }}>Fournir des précisions</Button>
      </> : current.request.status === 'rejected' ? <Button variant="secondary" disabled={busy || uncertain} onPress={() => { setKind(current.request.kind); setScope(current.request.scope); setPriorReviewId(current.request.id); setReason(''); }}>Demander un nouvel examen</Button> : null}
    </> : null}
    <Button variant="ghost" onPress={() => router.push('/my-orders')}>Mes commandes existantes</Button>
    <Button variant="ghost" onPress={() => router.push('/my-sales')}>Mes ventes existantes</Button>
    <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
  </View>;
  return <View style={styles.container}><ScreenHeader title="Achats, ventes et Troc" onBack={() => router.back()} />
    <FlashList data={reviews.data?.pages.flatMap(page => page.items) ?? []} keyExtractor={keyExtractor} renderItem={renderItem}
      ListHeaderComponent={header} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
      ListFooterComponent={reviews.hasNextPage ? <Button disabled={reviews.isFetchingNextPage} loading={reviews.isFetchingNextPage} onPress={() => { void reviews.fetchNextPage(); }}>Afficher les demandes suivantes</Button> : null} />
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background }, list: { paddingBottom: spacing.xl },
  content: { padding: spacing.md, gap: spacing.md }, title: { ...typography.h3, color: colors.foreground },
  body: { ...typography.body, color: colors.foregroundSecondary }, caption: { ...typography.caption, color: colors.muted },
  notice: { ...typography.body, color: colors.danger } });
