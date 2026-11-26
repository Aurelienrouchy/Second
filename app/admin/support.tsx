import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, ScreenHeader } from '@/components/ui';
import {SupportAccountReviewPanel, SUPPORT_ACCOUNT_FINDING_V2_LABELS} from '@/components/SupportAccountReviewPanel';
import {SupportPrivacyOperationsPanel} from '@/components/SupportPrivacyOperationsPanel';
import {PrivacyOperationsJournal} from '@/components/PrivacyOperationsJournal';
import { SupportRequestSummary } from '@/components/SupportRequestSummary';
import {ConnectIdentityRecoveryPanel} from '@/components/ConnectIdentityRecoveryPanel';
import { SupportDataMinimizationNotice } from '@/components/SupportDataMinimizationNotice';
import { SupportStoredIntentSummary } from '@/components/SupportStoredIntentSummary';
import { SupportTransportInstruction, TRANSPORT_INSTRUCTION_LABELS } from '@/components/SupportTransportInstruction';
import { SupportSwapHoldNotice } from '@/components/SupportSwapHoldNotice';
import { SupportWithdrawalTimingNotice } from '@/components/SupportWithdrawalTimingNotice';
import { SupportPrivacyRetentionNotice } from '@/components/SupportPrivacyRetentionNotice';
import { ReturnToSenderReportSummary } from '@/components/ReturnToSenderReportSummary';
import { AdminFinancialReauthentication, AdminLateCommercialReview, AdminLateTransportRecoveryReview, AdminSectionNav, AdminSupportConfidentialityReview, AdminSupportDeadlineQueue, AdminAuthorityRequestPanel, AdminAuthorityRequestJournal, AdminFinancialRecoveryStatus, AdminGlobalFinancialReconciliation, AdminSellerActivityReviewJournal, AdminExceptionalRestitutionSupportEntry, AdminExceptionalRestitutionHistory, AdminBusinessCessationPanel } from '@/features/admin';
import { LateTransportIncidentNotice } from '@/features/orders';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useSupportProjectionGeneration } from '@/hooks/useSupportProjectionGeneration';
import { areSupportProjectionPagesCurrent, assertSupportProjectionGeneration, isSupportProjectionCurrent } from '@/services/supportProjectionGuard';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ACCOUNT_SUPPORT_KINDS, SupportRequestService, newSupportRequestId, supportError, supportAttemptCanNeutralize, isSupportOpaqueAttempt, supportReceiptRequestId } from '@/services/supportRequestService';
import { supportRequestLabel, SUPPORT_STATUS_LABELS } from '@/utils/supportPresentation';
import {isDeclaredSupportAccountId} from '@/utils/supportAccountIdentity';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { LateTransportRecoveryJournal } from '@/components/LateTransportRecoveryJournal';
import { LateCommercialLinkSummary } from '@/components/LateCommercialLinkSummary';
import { AccountRelationshipPanel } from '@/components/AccountRelationshipPanel';
import { AccountRelationshipJournal } from '@/components/AccountRelationshipJournal';
import { AccountRelationshipPurchasePanel } from '@/components/AccountRelationshipPurchasePanel';
import { AccountRelationshipPurchaseJournal } from '@/components/AccountRelationshipPurchaseJournal';
import { SwapTopUpCheckoutJournal } from '@/components/SwapTopUpCheckoutJournal';
import { SwapTopUpCheckoutPanel } from '@/components/SwapTopUpCheckoutPanel';
import { createRelationshipInteraction } from '@/utils/accountRelationshipPresentation';
import type { SupportAccountFinding, SupportAdminCommand, SupportAttempt, SupportEvent, SupportEventsCursor, SupportListCursor, SupportServicingReceipt, SupportRequest, SupportJournalEntry, TransportInstructionType, SupportTransportInstructionInput } from '@/types/supportRequest';

type Row = { kind: 'request'; request: SupportRequest } | {kind: 'event'; event: SupportEvent};
const keyExtractor = (row: Row) => row.kind === 'request' ? `request/${row.request.id}` : `event/${row.event.id}`;
const actions: SupportAdminCommand['action'][] = ['assign', 'request_details', 'respond', 'internal_note', 'record_account_review', 'record_transport_instruction'];
const actionLabels: Record<SupportAdminCommand['action'], string> = {assign: 'Affecter un administrateur', request_details: 'Demander des précisions', respond: 'Consigner une réponse motivée', internal_note: 'Ajouter une note interne', record_account_review: 'Consigner un examen des comptes déclarés', record_transport_instruction: 'Consigner une instruction documentaire de transport'};
const accountFindingLabels: Record<SupportAccountFinding, string> = {unresolved: 'Rapprochement non résolu', no_link_established: 'Aucun lien établi par les pièces examinées',
  link_requires_manual_action: 'Lien nécessitant une intervention manuelle', representation_not_verified: 'Pouvoir de représentation non vérifié',
  representation_requires_manual_verification: 'Représentation nécessitant une vérification manuelle'};
export default function AdminSupportScreen() {
  const router = useRouter(), uid = useAuthenticatedUid(), generation = getAuthSessionGeneration();
  const {deadlineLane} = useLocalSearchParams<{deadlineLane?: string}>();
  const initialDeadlineLane = deadlineLane === 'bank' || deadlineLane === 'unknown' ? deadlineLane : 'dated';
  const projectionGeneration = useSupportProjectionGeneration(), queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null), [lookup, setLookup] = useState('');
  const scope = JSON.stringify([uid, generation, selectedId]), context = useLabelLifecycleContext(`support-admin:${scope}`, uid);
  const nativeSelection = useShippingPurchaseContext(`support-admin-native:${scope}`, uid);
  const [relationshipSelection] = useState(createRelationshipInteraction);
  const [relationshipRevision, setRelationshipRevision] = useState(0);
  const relationshipChoice = relationshipSelection.capture();
  const assertRelationshipSelection = () => {context.capture(); relationshipChoice(); assertSupportProjectionGeneration(projectionGeneration);};
  const [action, setAction] = useState<SupportAdminCommand['action']>('request_details');
  const [message, setMessage] = useState(''), [assigned, setAssigned] = useState(''), [legalBasis, setLegalBasis] = useState(''), [recourse, setRecourse] = useState('');
  const [accountFinding, setAccountFinding] = useState<SupportAccountFinding>('unresolved');
  const [transportType, setTransportType] = useState<TransportInstructionType | null>(null), [transportMessage, setTransportMessage] = useState('');
  const [transportDraftSource, setTransportDraftSource] = useState<{version: number; reference: SupportTransportInstructionInput['source']} | null>(null);
  const [privacyReauthenticatedKey, setPrivacyReauthenticatedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState(''), [receipt, setReceipt] = useState<SupportServicingReceipt | null>(null);
  const [workingState, setWorkingState] = useState({frame: context.frame, focusRevision: context.focusRevision, value: false});
  const working = workingState.frame === context.frame && workingState.focusRevision === context.focusRevision && workingState.value;
  const setWorking = (value: boolean) => setWorkingState({frame: context.frame, focusRevision: context.focusRevision, value});
  const [formScope, setFormScope] = useState(scope);
  if (formScope !== scope) {setFormScope(scope); setAction('request_details'); setMessage(''); setAssigned(''); setLegalBasis(''); setRecourse(''); setNotice(''); setReceipt(null); setWorking(false); setAccountFinding('unresolved'); setTransportType(null); setTransportMessage(''); setTransportDraftSource(null);}
  const journal = useQuery({queryKey: ['support-admin-journal', uid, generation, context.focusRevision],
    enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return SupportRequestService.journal(operation.base.session.uid, 'admin', () => context.assertCurrent(operation));} });
  const listKey = ['support-admin-list', uid, generation, context.focusRevision, projectionGeneration] as const;
  const detailKey = ['support-admin-detail', uid, generation, selectedId, context.focusRevision, projectionGeneration] as const;
  const list = useInfiniteQuery({queryKey: listKey, structuralSharing: false,
    enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: undefined as SupportListCursor | undefined,
    queryFn: ({pageParam}) => {const operation = context.capture(); return SupportRequestService.list(operation.base.session.uid, 'admin', pageParam, () => context.assertCurrent(operation));},
    getNextPageParam: last => last.cursor ?? undefined });
  const detail = useInfiniteQuery({queryKey: detailKey, structuralSharing: false,
    enabled: !!uid && !!selectedId && context.focused && list.isSuccess && !list.isFetching && areSupportProjectionPagesCurrent(list.data?.pages), staleTime: 0, gcTime: 0, retry: false,
    initialPageParam: undefined as SupportEventsCursor | undefined,
    queryFn: ({pageParam}) => {const operation = context.capture(); return SupportRequestService.detail(operation.base.session.uid, 'admin', selectedId!, pageParam, () => context.assertCurrent(operation));},
    getNextPageParam: last => last.events.cursor ?? undefined });
  const ready = context.focused && list.isSuccess && !list.isFetching && areSupportProjectionPagesCurrent(list.data?.pages) && journal.isSuccess && !journal.isFetching;
  const journalReady = context.focused && journal.isSuccess && !journal.isFetching;
  const pending = journalReady ? journal.data : null;
  const legalSelectionKey = JSON.stringify([scope, relationshipRevision, projectionGeneration, nativeSelection.focusRevision]);
  const [legalPendingAnchor, setLegalPendingAnchor] = useState<{key: string; pending: SupportJournalEntry | null}>({key: legalSelectionKey, pending: null});
  if (legalPendingAnchor.key !== legalSelectionKey) setLegalPendingAnchor({key: legalSelectionKey, pending: null});
  else if (journalReady && legalPendingAnchor.pending !== pending) setLegalPendingAnchor({key: legalSelectionKey, pending});
  const request = ready && selectedId && detail.isSuccess && !detail.isFetching && !detail.isError && areSupportProjectionPagesCurrent(detail.data?.pages) ? detail.data.pages[0]?.request ?? null : null;
  // Native OAuth/pickers may make AppState inactive. Preserve only this
  // selected dossier's volatile anchor while fresh projections remain gated.
  const accountAnchorKey = JSON.stringify([scope, projectionGeneration]);
  const [accountAnchor, setAccountAnchor] = useState<{key: string; request: SupportRequest | null}>({key: accountAnchorKey, request: null});
  if (accountAnchor.key !== accountAnchorKey) setAccountAnchor({key: accountAnchorKey, request: null});
  else if (request && accountAnchor.request !== request) setAccountAnchor({key: accountAnchorKey, request});
  const privacyAnchor = accountAnchor.key === accountAnchorKey ? accountAnchor.request : null;
  const privacyOperationKind = privacyAnchor?.kind === 'personal_data_access' || privacyAnchor?.kind === 'personal_data_correction' ? privacyAnchor.kind : null;
  const privacy = request?.kind === 'personal_data_access' || request?.kind === 'personal_data_correction';
  const privacyRetention = request ? detail.data?.pages[0]?.privacyRetention : null;
  const lateCommercial = request ? detail.data?.pages[0]?.lateCommercial : null;
  const privacyAuthKey = JSON.stringify([scope, request?.version, context.focusRevision, projectionGeneration]);
  const privacyAuthenticated = privacyReauthenticatedKey === privacyAuthKey;
  const isAccountRequest = (ACCOUNT_SUPPORT_KINDS as readonly string[]).includes(request?.kind ?? '');
  const accountSources = request && isAccountRequest ? detail.data?.pages[0]?.accountSources ?? null : null;
  const transportSource = request && detail.data?.pages.every(page => page.request.id === request.id && page.request.version === request.version &&
    JSON.stringify(page.transportSource?.reference ?? null) === JSON.stringify(detail.data.pages[0]?.transportSource?.reference ?? null)) ? detail.data.pages[0]?.transportSource ?? null : null;
  const returnToSenderSource = request && detail.data?.pages.every(page => page.request.id === request.id && page.request.version === request.version &&
    JSON.stringify(page.returnToSenderSource?.reference ?? null) === JSON.stringify(detail.data.pages[0]?.returnToSenderSource?.reference ?? null)) ? detail.data.pages[0]?.returnToSenderSource ?? null : null;
  const instructionSource = returnToSenderSource?.reference ?? transportSource?.reference ?? null;
  const transportDraftCurrent = !!request && !!instructionSource && transportDraftSource?.version === request.version &&
    JSON.stringify(transportDraftSource.reference) === JSON.stringify(instructionSource);
  const withdrawalTimingSource = request && detail.data?.pages.every(page => page.request.id === request.id && page.request.version === request.version &&
    page.withdrawalTimingSource?.sourceRevision === detail.data.pages[0]?.withdrawalTimingSource?.sourceRevision &&
    page.withdrawalTimingSource?.sourceHash === detail.data.pages[0]?.withdrawalTimingSource?.sourceHash) ? detail.data.pages[0]?.withdrawalTimingSource ?? null : null;
  const accountFindings: SupportAccountFinding[] = request?.kind === 'representation_review' ?
    ['unresolved', 'representation_not_verified', 'representation_requires_manual_verification'] : ['unresolved', 'no_link_established', 'link_requires_manual_action'];
  const rows: Row[] = !ready ? [] : selectedId ? request && detail.isSuccess && areSupportProjectionPagesCurrent(detail.data.pages) ? detail.data.pages.flatMap(page => page.events.items.map(event => ({kind: 'event' as const, event}))) : [] :
    list.data.pages.flatMap(page => page.items.map(request => ({kind: 'request' as const, request})));
  const refresh = async () => {await Promise.all([journal.refetch(), list.refetch(), ...(selectedId ? [detail.refetch()] : [])]);};
  const assertCurrentProjection = () => {
    assertSupportProjectionGeneration(projectionGeneration);
    const currentList = queryClient.getQueryData<{pages: unknown[]}>(listKey);
    const currentDetail = selectedId ? queryClient.getQueryData<{pages: unknown[]}>(detailKey) : null;
    if (currentList !== list.data || !areSupportProjectionPagesCurrent(currentList?.pages) ||
      selectedId && (currentDetail !== detail.data || !areSupportProjectionPagesCurrent(currentDetail?.pages))) {
      throw new Error('Relisez la projection confidentielle actuelle avant une nouvelle instruction.');
    }
  };
  const perform = async (mode: 'execute' | 'observe' | 'resume' | 'acknowledge' | 'neutralize') => {
    if (!journalReady || working || mode === 'execute' && (!ready || !request || pending || privacy && !privacyAuthenticated) || mode !== 'execute' && !pending) return;
    let operation;
    try {operation = context.start();} catch {return;}
    if (!operation) return; setWorking(true); setNotice('');
    try {
      let result: SupportServicingReceipt;
      if (mode === 'execute') {
        assertCurrentProjection();
        if (action === 'assign' && !isDeclaredSupportAccountId(assigned)) throw new Error('Saisissez l’UID natif exact de l’administrateur habilité.');
        if (action === 'record_account_review' && (!isAccountRequest || !accountSources?.length || !accountFindings.includes(accountFinding))) return;
        if (action === 'record_transport_instruction' && (!transportDraftCurrent || !transportType || !transportDraftSource)) throw new Error('Examinez la source actuelle avant une nouvelle instruction.');
        const base = {supportRequestId: request!.id, expectedVersion: request!.version};
        const command: SupportAdminCommand = action === 'assign' ? {action, ...base, assignedAdminId: assigned} :
          action === 'request_details' ? {action, ...base, ownerMessage: message.trim()} :
          action === 'internal_note' ? {action, ...base, internalNote: message.trim()} :
          action === 'record_transport_instruction' ? {action, ...base, transportInstruction: {type: transportType!, reason: message.trim(), ownerMessage: transportMessage.trim(), source: transportDraftSource!.reference}} :
          action === 'record_account_review' ? {action, ...base, accountReview: {finding: accountFinding, reason: message.trim(),
            expectedSources: accountSources!.map(source => ({declaredAccountId: source.declaredAccountId, sourceHash: source.sourceHash,
              userRevision: source.userRevision, eligibilityRevision: source.eligibilityRevision}))}} :
          {action: 'respond', ...base, response: {text: message.trim(), ...(legalBasis.trim() ? {legalBasis: legalBasis.trim()} : {}), ...(recourse.trim() ? {recourse: recourse.trim()} : {})}};
        const attempt: SupportAttempt = {version: 1, uid: operation.base.session.uid, scope: 'admin', requestId: newSupportRequestId(), command,
          ...(privacy ? {privacyRetentionCapability: 'privacy_retention_v1' as const} : {})};
        result = await SupportRequestService.execute(attempt, () => {context.assertCurrent(operation); assertCurrentProjection();});
      } else if (mode === 'resume') {
        if (!pending || isSupportOpaqueAttempt(pending)) throw new Error('Cette référence confidentielle peut être observée ou arrêtée, sans renvoyer le texte.');
        result = await SupportRequestService.execute(pending, () => context.assertCurrent(operation), true);
      } else result = mode === 'observe' ? await SupportRequestService.observe(pending!, () => context.assertCurrent(operation)) :
        mode === 'neutralize' ? await SupportRequestService.neutralize(pending!, () => context.assertCurrent(operation)) :
        await SupportRequestService.acknowledge(pending!, () => context.assertCurrent(operation));
      context.assertCurrent(operation); setReceipt(result); setNotice(result.state === 'committed' ?
        'La commande administrative est enregistrée. Ce reçu ne certifie ni l’examen humain ni la suffisance juridique de la réponse.' :
        result.state === 'not_executed' ? 'Cette commande n’a pas été exécutée. Relisez la version actuelle avant une autre instruction.' :
        'Le reçu exact est encore inconnu. Conservez cette intention et observez-la sans lancer une autre commande.');
      await refresh(); context.assertCurrent(operation);
    } catch (error) {if (context.isCurrent(operation)) {setNotice(supportError(error)); await journal.refetch();}}
    finally {if (context.isCurrent(operation)) setWorking(false); context.finish(operation);}
  };
  const renderItem = useCallback(({item}: {item: Row}) => item.kind === 'request' ? <View style={styles.card}>
    <Text style={styles.title}>{supportRequestLabel(item.request)}</Text><Text style={styles.body}>{SUPPORT_STATUS_LABELS[item.request.status]}</Text>
    <Text selectable style={styles.caption}>{item.request.id}</Text><Text style={styles.caption}>Réception app : {item.request.receivedAt}</Text>
    <Button variant="secondary" disabled={working} onPress={() => {try {context.capture(); assertSupportProjectionGeneration(projectionGeneration); if (!isSupportProjectionCurrent(item.request)) return; relationshipSelection.invalidate(); setRelationshipRevision(value => value + 1); setSelectedId(item.request.id);} catch { /* Stale session. */ }}}>Examiner le dossier</Button>
  </View> : <View style={styles.card}>
    <Text style={styles.body}>{actionLabels[item.event.action as SupportAdminCommand['action']] ?? item.event.action} · {item.event.state} · Version {item.event.resultVersion}</Text>
    <Text selectable style={styles.caption}>{item.event.recordedAt} · Acteur : {item.event.actorId}</Text>
    {item.event.narrative ? <Text selectable style={styles.body}>{item.event.narrative}</Text> : null}
    {item.event.ownerMessage ? <Text selectable style={styles.body}>{item.event.ownerMessage}</Text> : null}
    {item.event.internalNote ? <Text selectable style={styles.body}>Note interne : {item.event.internalNote}</Text> : null}
    {item.event.response ? <Text selectable style={styles.body}>{item.event.response.text}</Text> : null}
    {item.event.transportInstruction ? <SupportTransportInstruction instruction={item.event.transportInstruction} /> : null}
    {item.event.accountReview ? <>
      <Text style={styles.body}>Observation consignée : {'protocol' in item.event.accountReview ? SUPPORT_ACCOUNT_FINDING_V2_LABELS[item.event.accountReview.finding] : accountFindingLabels[item.event.accountReview.finding]}</Text>
      <Text selectable style={styles.body}>{item.event.accountReview.reason}</Text>
      <Text style={styles.caption}>{'protocol' in item.event.accountReview ? 'La décision conserve sa portée motivée. Aucun accès au compte tiers, fusion ou mouvement de fonds n’est accordé.' : 'Cet enregistrement historique ne donne aucun accès à un autre compte ou paiement et ne lève aucune restriction.'}</Text>
    </> : null}
  </View>, [context, projectionGeneration, relationshipSelection, working]);
  const closed = request?.status === 'withdrawn' || request?.status === 'answered';
  return <View style={styles.container}><ScreenHeader title="Support et recours humains" onBack={() => router.back()} /><AdminSectionNav />
    <FlashList data={rows} renderItem={renderItem} keyExtractor={keyExtractor} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.section}>
        {uid ? <AdminSupportDeadlineQueue key={`deadline-lane:${initialDeadlineLane}`} uid={uid} initialLane={initialDeadlineLane} sourceKey={JSON.stringify([scope, relationshipRevision, context.focusRevision, projectionGeneration])}
          assertSelection={assertRelationshipSelection} onSelect={id => {assertRelationshipSelection(); relationshipSelection.invalidate(); setRelationshipRevision(value => value + 1); setSelectedId(id);}} /> : null}
        {uid ? <SupportAccountReviewPanel uid={uid}
          request={accountAnchor.key === accountAnchorKey ? accountAnchor.request : null}
          sourceKey={JSON.stringify([selectedId, relationshipRevision, projectionGeneration])} disabled={!ready || !!pending || working}
          assertSelection={() => {context.capture(); assertCurrentProjection(); assertRelationshipSelection();}}
          onRecorded={() => {void refresh();}}
          renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="account_review"/>}/>: null}
        {uid ? <AdminFinancialRecoveryStatus uid={uid} /> : null}
        {uid ? <AdminBusinessCessationPanel uid={uid} /> : null}
        {uid ? <PrivacyOperationsJournal uid={uid} /> : null}
        {uid ? <SupportPrivacyOperationsPanel uid={uid} caseId={privacyOperationKind ? privacyAnchor!.id : null}
          kind={privacyOperationKind} sourceKey={legalSelectionKey}
          assertSelection={() => {nativeSelection.capture(); relationshipChoice(); assertSupportProjectionGeneration(projectionGeneration);}}
          renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="privacy_operations"/>}/> : null}
        {uid ? <AdminExceptionalRestitutionHistory uid={uid} /> : null}
        {uid && accountAnchor.key === accountAnchorKey && accountAnchor.request ? <AdminExceptionalRestitutionSupportEntry uid={uid}
          request={accountAnchor.request} onRecorded={() => {void refresh();}} /> : null}
        {uid ? <AdminGlobalFinancialReconciliation uid={uid} /> : null}
        {uid ? <ConnectIdentityRecoveryPanel uid={uid}/> : null}
        {uid ? <AdminSellerActivityReviewJournal uid={uid}/> : null}
        {uid && request ? <ConnectIdentityRecoveryPanel uid={uid} scope="admin" ownerId={request.ownerId} sourceKey={JSON.stringify([selectedId, relationshipRevision, projectionGeneration, request.ownerId])} assertSelection={assertRelationshipSelection}/> : null}
        {uid ? <AdminAuthorityRequestJournal uid={uid} /> : null}
        {uid ? <AdminAuthorityRequestPanel uid={uid} /> : null}
        <Text style={styles.body}>Les demandes, notes et réponses restent distinctes des mutations financières et des droits commerciaux. Cette file couvre les dossiers natifs de support ; elle n’atteste pas l’exhaustivité des anciens litiges ou journaux.</Text>
        <Input label="Référence exacte d’un dossier" value={lookup} onChangeText={setLookup} maxLength={128} disabled={working} autoCapitalize="none" />
        <Button variant="secondary" disabled={!ready || working || !lookup.trim()} onPress={() => {try {context.capture(); assertSupportProjectionGeneration(projectionGeneration); relationshipSelection.invalidate(); setRelationshipRevision(value => value + 1); setSelectedId(lookup.trim());} catch { /* Stale selection. */ }}}>Lire cette référence privée</Button>
        {selectedId ? <Button variant="secondary" disabled={working} onPress={() => {try {context.capture(); relationshipSelection.invalidate(); setRelationshipRevision(value => value + 1); setSelectedId(null);} catch { /* Stale selection. */ }}}>Revenir à la file</Button> : null}
        {notice ? <Text selectable style={styles.body}>{notice}</Text> : null}
        {list.isError || journal.isError ? <Text style={styles.body}>L’accès actuel ou le journal ne peut pas être confirmé. Aucune nouvelle instruction n’est proposée.</Text> : null}
        {pending ? <View style={styles.card}><Text style={styles.title}>Intention administrative conservée</Text>
          <SupportStoredIntentSummary attempt={pending} />
          <Button disabled={working} onPress={() => {void perform('observe');}}>Relire exactement cette intention</Button>
          {!isSupportOpaqueAttempt(pending) ? <Button variant="secondary" disabled={working} onPress={() => {void perform('resume');}}>Reprendre cette intention avec la même référence</Button> : null}
          {supportAttemptCanNeutralize(pending) ? <Button variant="secondary" disabled={working} onPress={() => {void perform('neutralize');}}>Demander l’arrêt de cette intention non exécutée</Button> : null}
          {receipt && supportReceiptRequestId(receipt) === pending.requestId && receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={working} onPress={() => {void perform('acknowledge');}}>Reconnaître le reçu relu</Button> : null}
        </View> : null}
        {uid ? <AdminSupportConfidentialityReview uid={uid} supportRequestId={selectedId}
          pending={legalPendingAnchor.key === legalSelectionKey ? legalPendingAnchor.pending : null}
          sourceKey={legalSelectionKey} assertSelection={assertRelationshipSelection} /> : null}
        {uid ? <LateTransportRecoveryJournal uid={uid} scope="admin" renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="commercial" parcel />} /> : null}
        {uid ? <AccountRelationshipJournal uid={uid} scope="admin" renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="relationship" />} /> : null}
        {uid ? <AccountRelationshipPurchaseJournal uid={uid} renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="relationship" />} /> : null}
        {uid ? <SwapTopUpCheckoutJournal uid={uid} scope="admin" /> : null}
        {uid && request && (request.kind === 'account_reconciliation' || request.kind === 'restriction_circumvention') ? <AccountRelationshipPanel key={JSON.stringify([uid, generation, selectedId, relationshipRevision, context.focusRevision])} uid={uid} scope="admin" supportRequestId={request.id}
          initialOrder={request.transactionId ? {kind: 'purchase', id: request.transactionId} : null} assertSelection={assertRelationshipSelection}
          renderLegacySwapTopUp={state => <SwapTopUpCheckoutPanel uid={uid} swapId={state.swapId} scope="admin" relationshipReference={state.relationshipReference}
            assertSelection={() => {assertRelationshipSelection(); state.assertCurrent();}} renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="relationship" />} />}
          renderLegacyPurchase={state => <AccountRelationshipPurchasePanel uid={uid} transactionId={state.transactionId} relationshipReference={state.relationshipReference} sourceKey={state.sourceKey}
            assertSelection={() => {assertRelationshipSelection(); state.assertCurrent();}} renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="relationship" />} />}
          renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="relationship" />} /> : null}
        {uid ? <AdminLateCommercialReview uid={uid} supportRequestId={request?.kind === 'commercial_late' && lateCommercial?.link ? request.id : null} /> : null}
        {request ? <View style={styles.section}><SupportRequestSummary request={request} />
          {privacyRetention ? <SupportPrivacyRetentionNotice retention={privacyRetention} /> : null}
          {lateCommercial ? lateCommercial.link ? <LateCommercialLinkSummary link={lateCommercial.link} /> : <Text style={styles.caption}>La liaison historique de ce constat doit être rapprochée avant un examen commercial tardif.</Text> : null}
          {request.swapHoldContext ? <SupportSwapHoldNotice context={request.swapHoldContext} source={detail.data?.pages[0]?.swapHoldSource} /> : null}
          {request.withdrawalTimingContext ? <SupportWithdrawalTimingNotice context={request.withdrawalTimingContext} source={withdrawalTimingSource} /> : null}
          {request.transportInstruction ? <SupportTransportInstruction instruction={request.transportInstruction} /> : null}
          {request.returnToSender ? <View style={styles.card}>
            <Text style={styles.title}>Signalement de retour à l’expéditeur : sources pour examen</Text>
            {returnToSenderSource ? <>
              <ReturnToSenderReportSummary report={returnToSenderSource.report} />
              <Text style={styles.caption}>Les sources actuelles de la commande et des écritures financières sont liées séparément au récit d’origine.</Text>
              <Text style={styles.body}>Remboursement dans la source lue : {returnToSenderSource.financialRecording.refundSource === 'absent' ? 'aucun enregistrement dans cette source' : 'enregistrement présent, résultat non vérifié'}. Libération : {returnToSenderSource.financialRecording.releaseSource === 'native_timestamp_recorded' ? 'date native enregistrée' : returnToSenderSource.financialRecording.releaseSource === 'absent' ? 'aucune date dans cette source' : 'historique à rapprocher'}.</Text>
              <Text style={styles.caption}>Aucun argent restitué, crédit bancaire, coût, faute, réception, contenu ou droit d’interception n’est qualifié par cette consultation. L’instruction documentaire ne lève aucune garde et n’autorise aucun remboursement ou remise en vente.</Text>
            </> : <Text style={styles.body}>Les sources exactes de ce signalement ne peuvent pas être qualifiées. Aucune nouvelle instruction documentaire de transport n’est proposée depuis une ancienne source.</Text>}
          </View> : null}
          {request.transactionId ? <LateTransportIncidentNotice key={request.transactionId} transactionId={request.transactionId}
            scope="admin" sourceKey={JSON.stringify([request.id, request.version])} showEmpty RecoveryComponent={AdminLateTransportRecoveryReview} /> : null}
          {isAccountRequest ? <View style={styles.card}>
            <Text style={styles.title}>Sources privées minimales des comptes déclarés</Text>
            <Text style={styles.body}>Les états enregistrés ci-dessous servent au rapprochement. Ils ne prouvent ni identité, lien entre comptes, contournement ou pouvoir de représentation. Aucun nom, date de naissance, compte bancaire ou commande tiers n’est exposé.</Text>
            {accountSources?.map(source => <View key={source.declaredAccountId} style={styles.section}>
              <Text selectable style={styles.caption}>Référence déclarée : {source.declaredAccountId}</Text>
              <Text style={styles.body}>Document utilisateur : {source.userDocumentState === 'present' ? 'présent' : 'absent'} · Admission : {source.eligibilityDocumentState === 'present' ? 'document présent' : 'document absent'}.</Text>
              <Text style={styles.body}>Activation consignée : {source.activeFieldState === 'active_recorded' ? 'active' : source.activeFieldState === 'inactive_recorded' ? 'inactive' : 'inconnue'} · Fermeture : {source.closureRecordState === 'recorded' ? 'enregistrement présent' : source.closureRecordState === 'absent' ? 'aucun enregistrement dans cette source' : 'source à vérifier'}.</Text>
              <Text selectable style={styles.caption}>Empreinte : {source.sourceHash}{'\n'}Révisions : {source.userRevision ?? 'absente'} · {source.eligibilityRevision ?? 'absente'}</Text>
            </View>) ?? <Text style={styles.body}>Les sources actuelles ne peuvent pas être qualifiées.</Text>}
            {request.accountReview?.protocol === 'support_account_review_v1' ? <>
              <Text style={styles.title}>Examen privé consigné</Text><Text style={styles.body}>{accountFindingLabels[request.accountReview.finding]}</Text>
              <Text selectable style={styles.body}>{request.accountReview.reason}</Text>
              <Text style={styles.caption}>Consigné le {request.accountReview.recordedAt}. Aucune fusion, récupération de compte, levée de restriction ou autorité de paiement n’a été accordée par cet examen.</Text>
            </> : null}
          </View> : null}
          {request.accountReview?.protocol === 'support_account_review_v2' ? <View style={styles.card}>
            <Text style={styles.title}>{SUPPORT_ACCOUNT_FINDING_V2_LABELS[request.accountReview.finding]}</Text>
            <Text selectable style={styles.body}>{request.accountReview.ownerMessage}</Text>
            <Text selectable style={styles.body}>Recours : {request.accountReview.recourse}</Text>
            <Text style={styles.caption}>Révision prévue : {request.accountReview.reviewDueAt}. Aucun accès au compte tiers, fusion ou mouvement de fonds.</Text>
          </View> : null}
          <Text style={styles.caption}>Affectation actuelle : {request.assignedAdminId ?? 'Aucune affectation enregistrée'}</Text>
          {request.internalNote ? <Text selectable style={styles.body}>Dernière note interne : {request.internalNote}</Text> : null}
          {request.lateTransport ? <View style={styles.card}>
            <Text style={styles.title}>Source actuelle pour une instruction documentaire</Text>
            {transportSource ? <>
              <Text style={styles.body}>{transportSource.providerStatusCode === 'DE' ? 'Livraison signalée' : 'Transit signalé'} · Lecture : {transportSource.providerObservedAt} · Occurrence : {transportSource.providerOccurredAt ?? 'non qualifiée'}.</Text>
              <Text style={styles.caption}>{transportSource.temporalRelation === 'after_refund_request' ? 'Occurrence qualifiée après la demande de remboursement enregistrée.' : transportSource.temporalRelation === 'before_or_at_refund_request' ? 'Occurrence avant ou à la demande ; aucune nouvelle réception après remboursement n’est prouvée.' : 'Ordre temporel non qualifié.'}</Text>
              <Text style={styles.body}>Dossier financier qualifié lors de cette lecture : {transportSource.refundCurrentlyRecorded.qualification === 'historical_unknown' ? 'historique inconnu' : transportSource.refundCurrentlyRecorded.state === 'confirmed' ? 'remboursement enregistré dans les écritures' : transportSource.refundCurrentlyRecorded.state === 'engaged' ? 'demande engagée' : 'résultat inconnu'}.</Text>
              <Text style={styles.caption}>{transportSource.financialSourceCurrent ? 'La source financière concorde avec l’observation conservée.' : 'La source financière a changé depuis cette observation ; son ancien état n’atteste aucune somme reçue actuellement.'} Aucun crédit bancaire ni possession ne sont vérifiés.</Text>
            </> : <Text style={styles.body}>La source actuelle ne peut pas être qualifiée. Aucune instruction de transport ne peut être enregistrée.</Text>}
          </View> : null}
          <View accessibilityRole="radiogroup" accessibilityLabel="Instruction administrative" style={styles.section}>{actions.filter(value => value !== 'record_account_review' && (value !== 'record_transport_instruction' || !!request.lateTransport || !!request.returnToSender)).map(value =>
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: value === action, disabled: working || !!pending || !!closed && value !== 'internal_note'}}
              disabled={working || !!pending || !!closed && value !== 'internal_note'} style={[styles.choice, action === value && styles.selected]} onPress={() => {setAction(value); if (value === 'record_transport_instruction') {setTransportDraftSource(instructionSource ? {version: request.version, reference: instructionSource} : null); setTransportType(null); setTransportMessage(''); setMessage('');}}}>
              <Text style={styles.body}>{actionLabels[value]}</Text>
            </Pressable>)}</View>
          <SupportDataMinimizationNotice />
          {action === 'assign' ? <Input label="UID exact de l’administrateur déjà habilité" value={assigned} onChangeText={setAssigned} maxLength={128} autoCapitalize="none" autoCorrect={false} disabled={working || !!pending} /> :
            <Input label={action === 'internal_note' ? 'Note interne privée' : action === 'record_account_review' ? 'Motivation privée de cet examen' : action === 'record_transport_instruction' ? 'Motivation de l’instruction documentaire' : action === 'respond' ? 'Réponse motivée pour le propriétaire' : 'Précisions demandées au propriétaire'} value={message} onChangeText={setMessage} maxLength={4000} multiline disabled={working || !!pending} />}
          {action === 'record_account_review' && isAccountRequest ? <>
            <View accessibilityRole="radiogroup" accessibilityLabel="Observation sur les comptes ou la représentation" style={styles.section}>{accountFindings.map(finding =>
              <Pressable key={finding} accessibilityRole="radio" accessibilityState={{checked: accountFinding === finding, disabled: working || !!pending}}
                disabled={working || !!pending} style={[styles.choice, accountFinding === finding && styles.selected]} onPress={() => setAccountFinding(finding)}>
                <Text style={styles.body}>{accountFindingLabels[finding]}</Text>
              </Pressable>)}</View>
            <Text style={styles.caption}>L’enregistrement conserve ces sources exactes et leur version. Un changement de source empêchera l’exécution ; aucune action sur les comptes ou les fonds n’est déclenchée.</Text>
          </> : null}
          {action === 'record_transport_instruction' ? <>
            {!transportDraftCurrent ? <Text style={styles.body}>La source de cette intention a changé ou n’est pas qualifiée. Relisez les sources, puis choisissez de nouveau cette action pour un nouvel examen explicite.</Text> : null}
            <View accessibilityRole="radiogroup" accessibilityLabel="Type d’instruction documentaire" style={styles.section}>{(Object.keys(TRANSPORT_INSTRUCTION_LABELS) as TransportInstructionType[]).map(value =>
              <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: value === transportType, disabled: working || !!pending || !transportDraftCurrent}}
                disabled={working || !!pending || !transportDraftCurrent} style={[styles.choice, transportType === value && styles.selected]} onPress={() => setTransportType(value)}><Text style={styles.body}>{TRANSPORT_INSTRUCTION_LABELS[value]}</Text></Pressable>)}</View>
            <Input label="Instruction documentaire pour le propriétaire" value={transportMessage} onChangeText={setTransportMessage} multiline maxLength={4000} disabled={working || !!pending || !transportDraftCurrent} />
            <Text style={styles.caption}>Retour ou conservation restent une instruction, sans certifier un acte physique. L’examen d’une régularisation n’autorise ni somme à repayer, redébit, remboursement ou remise en vente. Le dossier demeure ouvert aux précisions.</Text>
          </> : null}
          {action === 'respond' ? <><Input label={privacy ? 'Fondement légal requis' : 'Fondement communiqué, facultatif'} value={legalBasis} onChangeText={setLegalBasis} multiline maxLength={4000} disabled={working || !!pending} />
            <Input label={privacy ? 'Recours communiqué requis' : 'Recours communiqué, facultatif'} value={recourse} onChangeText={setRecourse} multiline maxLength={4000} disabled={working || !!pending} />
            <Text style={styles.caption}>Consigner un texte ne certifie ni la qualité du répondant, ni une recherche exhaustive, ni la validité juridique. Les délais de recours externes ne sont pas prolongés par cette réponse.</Text></> : null}
          {privacy && uid ? <AdminFinancialReauthentication key={privacyAuthKey} uid={uid} sourceKey={`support-privacy:${privacyAuthKey}`} purpose="privacy"
            disabled={working || !!pending || !ready} onVerified={() => {try {context.capture(); assertCurrentProjection(); setPrivacyReauthenticatedKey(privacyAuthKey);} catch { /* Superseded projection. */ }}} /> : null}
          <Button disabled={!ready || working || !!pending || privacy && !privacyAuthenticated || !!closed && action !== 'internal_note' || (action === 'assign' ? !isDeclaredSupportAccountId(assigned) : !message.trim()) ||
            action === 'respond' && privacy && (!legalBasis.trim() || !recourse.trim()) || action === 'record_account_review' && (!isAccountRequest || !accountSources?.length || !accountFindings.includes(accountFinding)) ||
            action === 'record_transport_instruction' && (!transportDraftCurrent || !transportType || !transportMessage.trim())} onPress={() => {void perform('execute');}}>Enregistrer cette instruction</Button>
          <Text style={styles.title}>Historique privé</Text>
        </View> : selectedId ? <Text style={styles.body}>{detail.isError ? 'Ce dossier ne peut pas être confirmé.' : 'Relecture du dossier…'}</Text> : null}
        <Button variant="secondary" disabled={working || !uid} onPress={() => {void refresh();}}>Relire les sources actuelles</Button>
      </View>}
      ListFooterComponent={selectedId ? detail.hasNextPage ? <Button variant="secondary" disabled={detail.isFetchingNextPage} onPress={() => {void detail.fetchNextPage();}}>Lire les intentions plus anciennes</Button> : null :
        list.hasNextPage ? <Button variant="secondary" disabled={list.isFetchingNextPage} onPress={() => {void list.fetchNextPage();}}>Lire les dossiers plus anciens</Button> : null} />
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md}, section: {gap: spacing.md, marginBottom: spacing.md},
  card: {gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  choice: {padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm}, selected: {backgroundColor: colors.surfaceSubtle, borderColor: colors.primary} });
