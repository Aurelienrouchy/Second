import {useSupportProjectionGeneration} from '@/hooks/useSupportProjectionGeneration';
import {areSupportProjectionPagesCurrent,isSupportProjectionCurrent} from '@/services/supportProjectionGuard';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, ScreenHeader } from '@/components/ui';
import { SupportRequestSummary } from '@/components/SupportRequestSummary';
import { SupportTransportInstruction } from '@/components/SupportTransportInstruction';
import { SupportSwapHoldNotice } from '@/components/SupportSwapHoldNotice';
import { SupportWithdrawalTimingNotice } from '@/components/SupportWithdrawalTimingNotice';
import { ExceptionalRestitutionOwnerPanel } from '@/components/ExceptionalRestitutionOwnerPanel';
import {SupportDataMinimizationNotice} from '@/components/SupportDataMinimizationNotice';
import {SupportConfidentialityPanel} from '@/components/SupportConfidentialityPanel';
import {SupportStoredIntentSummary} from '@/components/SupportStoredIntentSummary';
import {SupportAccountEvidenceUpload} from '@/components/SupportAccountEvidenceUpload';
import {SUPPORT_ACCOUNT_FINDING_V2_LABELS} from '@/components/SupportAccountReviewPanel';
import { SupportPrivacyScopeFields } from '@/components/SupportPrivacyScopeFields';
import { SupportPrivacyRetentionNotice } from '@/components/SupportPrivacyRetentionNotice';
import {SupportPrivacyCopies} from '@/components/SupportPrivacyCopies';
import {BusinessCessationOwnerPanel} from '@/components/BusinessCessationOwnerPanel';
import { LateCommercialLinkSummary } from '@/components/LateCommercialLinkSummary';
import { AccountRelationshipPanel } from '@/components/AccountRelationshipPanel';
import { AccountRelationshipJournal } from '@/components/AccountRelationshipJournal';
import { isRelationshipReference } from '@/services/accountRelationshipReviewService';
import type { RelationshipReference } from '@/types/accountRelationshipReview';
import { isLateCommercialLink, LateCommercialRecourseService } from '@/services/lateCommercialRecourseService';
import { productReviewEqual } from '@/services/productReviewService';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { SupportRequestService, newSupportRequestId, supportError, supportAttemptCanNeutralize, isSupportOpaqueAttempt, supportReceiptRequestId } from '@/services/supportRequestService';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { SupportAttempt, SupportRequest, SupportEvent, SupportEventsCursor, SupportEvidenceKind, SupportServicingReceipt, SupportPrivacyScope } from '@/types/supportRequest';
import type { LateCommercialLink } from '@/types/lateCommercialRecourse';

const keyExtractor = (item: SupportEvent) => item.id;
const evidenceLabels: Record<SupportEvidenceKind, string> = {commercial_dispute: 'Litige commercial', eligibility_request: 'Demande d’admissibilité', support_request: 'Dossier de support', meetup_declaration: 'Accord et déclaration de rencontre'};
export default function SupportRequestScreen() {
  const {id, lateCommercial, accountRelationship} = useLocalSearchParams<{id: string; lateCommercial?: string; accountRelationship?: string | string[]}>(), router = useRouter(), uid = useAuthenticatedUid(), client=useQueryClient(), projectionGeneration=useSupportProjectionGeneration();
  const hasRelationshipNotice = accountRelationship !== undefined;
  let relationshipReference: RelationshipReference | null = null;
  if (typeof accountRelationship === 'string' && accountRelationship.length <= 12000) {
    try {const value: unknown = JSON.parse(accountRelationship); if (isRelationshipReference(value)) relationshipReference = value;} catch { /* Invalid addressed references stay closed. */ }
  }
  const invalidRelationshipNotice = hasRelationshipNotice && !relationshipReference;
  let lateReference: LateCommercialLink | null = null;
  try {const value: unknown = lateCommercial ? JSON.parse(lateCommercial) : null; if (isLateCommercialLink(value)) lateReference = value;} catch { /* Native requalification follows. */ }
  const hasLateContext = lateCommercial !== undefined;
  const generation = useAuthStore(getAuthSessionGeneration), scope = JSON.stringify([uid, generation, id, lateCommercial, accountRelationship]);
  const context = useLabelLifecycleContext(`support-detail:${scope}`, uid);
  const interaction = useRef(0);
  const [action, setAction] = useState<'clarify' | 'withdraw' | 'link_evidence'>('clarify');
  const [narrative, setNarrative] = useState(''), [evidenceId, setEvidenceId] = useState('');
  const [evidenceKind, setEvidenceKind] = useState<SupportEvidenceKind>('commercial_dispute');
  const [privacyScope, setPrivacyScope] = useState<SupportPrivacyScope | null>(null);
  const [notice, setNotice] = useState(''), [receipt, setReceipt] = useState<SupportServicingReceipt | null>(null);
  const [workingState, setWorkingState] = useState({frame: context.frame, focusRevision: context.focusRevision, value: false});
  const working = workingState.frame === context.frame && workingState.focusRevision === context.focusRevision && workingState.value;
  const setWorking = (value: boolean) => setWorkingState({frame: context.frame, focusRevision: context.focusRevision, value});
  const [formScope, setFormScope] = useState(scope);
  if (formScope !== scope) { setFormScope(scope); setNarrative(''); setEvidenceId(''); setEvidenceKind('commercial_dispute'); setAction('clarify'); setNotice(''); setReceipt(null); setWorking(false); setPrivacyScope(null); }
  const validId = typeof id === 'string' && !!id && !id.includes('/');
  const journal = useQuery({queryKey: ['support-owner-journal', uid, generation, context.focusRevision],
    enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return SupportRequestService.journal(operation.base.session.uid, 'owner', () => context.assertCurrent(operation));} });
  const detail = useInfiniteQuery({queryKey: ['support-owner-detail', uid, generation, id, context.focusRevision, projectionGeneration],
    enabled: !!uid && validId && !hasRelationshipNotice && context.focused, staleTime: 0, gcTime: 0, retry: false,structuralSharing:false,
    initialPageParam: undefined as SupportEventsCursor | undefined,
    queryFn: ({pageParam}) => {const operation = context.capture(); return SupportRequestService.detail(operation.base.session.uid, 'owner', id, pageParam, () => context.assertCurrent(operation));},
    getNextPageParam: last => last.events.cursor ?? undefined });
  const ready = areSupportProjectionPagesCurrent(detail.data?.pages) && !hasRelationshipNotice && context.focused && detail.isSuccess && !detail.isFetching && journal.isSuccess && !journal.isFetching;
  const request = ready ? detail.data?.pages[0]?.request ?? null : null, pending = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
  const uploadAnchorKey = JSON.stringify([scope, projectionGeneration]);
  const [uploadAnchor, setUploadAnchor] = useState<{key: string; request: SupportRequest | null}>({key: uploadAnchorKey, request: null});
  if (uploadAnchor.key !== uploadAnchorKey) setUploadAnchor({key: uploadAnchorKey, request: null});
  else if (request && uploadAnchor.request !== request) setUploadAnchor({key: uploadAnchorKey, request});
  const isPrivacy = request?.kind === 'personal_data_access' || request?.kind === 'personal_data_correction';
  const privacyRetention = request ? detail.data?.pages[0]?.privacyRetention : null;
  const recordedLate = request ? detail.data?.pages[0]?.lateCommercial : null;
  const lateRead = useQuery({queryKey: ['support-existing-late-commercial-source', uid, generation, id, lateCommercial, context.focusRevision],
    enabled: !!uid && !!lateReference && !!request && request.kind === 'commercial_late' && request.transactionId === lateReference.transactionId && context.focused,
    staleTime: 0, gcTime: 0, retry: false, queryFn: async () => {
      const operation = context.capture(), expected = lateReference!;
      const fresh = await LateCommercialRecourseService.source(uid!, expected.transactionId, expected.contributionId, expected.topic,
        () => context.assertCurrent(operation), expected.materialCapability !== undefined, expected.parcelCapability !== undefined);
      context.assertCurrent(operation); if (!productReviewEqual(fresh.link, expected)) throw new Error('Choisissez à nouveau le constat actuel.');
      return fresh.link;
    }});
  const qualifiedLate = request && context.focused && lateRead.isSuccess && !lateRead.isFetching && !lateRead.isError ? lateRead.data : null;
  const events = areSupportProjectionPagesCurrent(detail.data?.pages) && !hasRelationshipNotice && context.focused && detail.isSuccess && !detail.isFetching && !detail.isError ? detail.data.pages.flatMap(page => page.events.items) : [];
  const refresh = async () => {await Promise.all([journal.refetch(), ...(!hasRelationshipNotice ? [detail.refetch()] : [])]);};
  const assertNewSources=()=>{const check=(queryKey:readonly unknown[],data:unknown,at:number)=>{const q=client.getQueryState(queryKey);if(!q||q.status!=='success'||q.fetchStatus!=='idle'||q.error!==null||q.isInvalidated||q.data!==data||q.dataUpdatedAt!==at)throw new Error('La demande ou les sources ont changé. Relisez leur version actuelle.');};check(['support-owner-journal',uid,generation,context.focusRevision],journal.data,journal.dataUpdatedAt);if(!areSupportProjectionPagesCurrent(detail.data?.pages))throw new Error('La projection actuelle doit être relue.');check(['support-owner-detail',uid,generation,id,context.focusRevision,projectionGeneration],detail.data,detail.dataUpdatedAt);if(hasLateContext)check(['support-existing-late-commercial-source',uid,generation,id,lateCommercial,context.focusRevision],lateRead.data,lateRead.dataUpdatedAt);};
  const perform = async (mode: 'execute' | 'observe' | 'resume' | 'acknowledge' | 'neutralize') => {
    if (!context.focused || working || !journal.isSuccess || journal.isFetching || mode === 'execute' && (!request || pending) || mode !== 'execute' && !pending) return;
    let operation;
    try {operation = context.start();} catch {return;}
    if (!operation) return;
    const capturedInteraction = interaction.current;
    const assertCurrent = () => {context.assertCurrent(operation); if(mode==='execute')assertNewSources(); if (mode === 'execute' && interaction.current !== capturedInteraction) throw new Error('Les précisions ont changé. Confirmez à nouveau votre choix.');};
    setWorking(true); setNotice('');
    try {
      let result: SupportServicingReceipt;
      if (mode === 'execute') {
        if (isPrivacy && privacyScope && !privacyScope.categories.length) throw new Error('Choisissez au moins une catégorie de données.');
        if (hasLateContext) {
          if (!qualifiedLate || action !== 'clarify' || request!.kind !== 'commercial_late' || request!.transactionId !== qualifiedLate.transactionId || request!.meetupReason || request!.lateTransport || request!.returnToSender)
            throw new Error('Cette liaison nécessite des précisions au ticket commercial exact.');
          const fresh = await LateCommercialRecourseService.source(uid!, qualifiedLate.transactionId, qualifiedLate.contributionId, qualifiedLate.topic,
            assertCurrent, qualifiedLate.materialCapability !== undefined, qualifiedLate.parcelCapability !== undefined); assertCurrent();
          if (!productReviewEqual(fresh.link, qualifiedLate)) throw new Error('Le constat ou les sources ont changé. Choisissez à nouveau le constat.');
        }
        const base = {supportRequestId: request!.id, expectedVersion: request!.version, narrative: narrative.trim(),
          ...(isPrivacy && privacyScope ? {privacyScope: {...privacyScope, description: privacyScope.description?.trim() || null}} : {})};
        const attempt: SupportAttempt = {version: 1, uid: operation.base.session.uid, scope: 'owner', requestId: newSupportRequestId(),
          ...(isPrivacy ? {privacyRetentionCapability: 'privacy_retention_v1' as const} : {}),
          ...(hasLateContext ? {lateCommercialCapability: 'late_commercial_recourse_v1' as const} : {}),
          command: action === 'link_evidence' ? {action, ...base, evidence: [{kind: evidenceKind, id: evidenceId.trim()}]} :
            action === 'clarify' ? {action, ...base, ...(hasLateContext && qualifiedLate ? {lateCommercial: qualifiedLate} : {})} : {action, ...base}};
        result = await SupportRequestService.execute(attempt, assertCurrent);
      } else result = mode === 'resume' ? await SupportRequestService.execute((()=>{if(!pending||isSupportOpaqueAttempt(pending))throw new Error('Cette demande doit être vérifiée ou arrêtée avant de pouvoir continuer.');return pending;})(), () => context.assertCurrent(operation), true) :
        mode === 'observe' ? await SupportRequestService.observe(pending!, () => context.assertCurrent(operation)) :
        mode === 'neutralize' ? await SupportRequestService.neutralize(pending!, () => context.assertCurrent(operation)) :
        await SupportRequestService.acknowledge(pending!, () => context.assertCurrent(operation));
      assertCurrent(); setReceipt(result); setNotice(result.state === 'committed' ?
        'Votre mise à jour a été enregistrée.' :
        result.state === 'not_executed' ? result.reason === 'swap_context_not_authorized' ? 'La demande n’a pas été envoyée. Vérifiez le troc sélectionné et le compte utilisé.' :
          result.reason === 'withdrawal_context_not_authorized' ? 'La demande n’a pas été envoyée. Ce retrait ne correspond pas au compte utilisé.' :
          'La mise à jour n’a pas été envoyée : le dossier a changé ou est clos. Consultez son état actuel.' :
        'L’envoi n’est pas encore confirmé. Vérifiez son résultat ci-dessous avant de créer une autre demande.');
      await refresh(); context.assertCurrent(operation);
    } catch (error) {try {assertCurrent(); setNotice(supportError(error)); await journal.refetch();} catch { /* Edited or inactive draft receives no old callback. */ }}
    finally {if (context.isCurrent(operation)) setWorking(false); context.finish(operation);}
  };
  const renderItem = useCallback(({item}: {item: SupportEvent}) => !isSupportProjectionCurrent(item)?<Text style={styles.caption}>Projection historique à relire.</Text>:<View style={styles.card}>
    <Text style={styles.body}>{item.action === 'record_account_review' ? 'Examen privé de l’équipe' : item.action === 'record_transport_instruction' ? 'Instruction documentaire de transport' : item.action} · {item.state === 'committed' ? 'Enregistré' : 'Non exécuté'} · Version {item.resultVersion}</Text>
    <Text style={styles.caption}>{item.recordedAt} · {item.ownerAction ? 'Votre demande' : 'Action de l’équipe'}</Text>
    {item.narrative ? <Text selectable style={styles.body}>{item.narrative}</Text> : null}
    {item.ownerMessage ? <Text selectable style={styles.body}>{item.ownerMessage}</Text> : null}
    {item.response ? <Text selectable style={styles.body}>{item.response.text}</Text> : null}
    {item.transportInstruction ? <SupportTransportInstruction instruction={item.transportInstruction} /> : null}
  </View>, []);
  const closed = request?.status === 'withdrawn' || request?.status === 'answered';
  return <View style={styles.container}><ScreenHeader title="Demande privée" onBack={() => router.back()} />
    <FlashList data={events} renderItem={renderItem} keyExtractor={keyExtractor} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.section}>
        {uid ? <AccountRelationshipJournal uid={uid} scope="own" /> : null}
        {uid && validId && uploadAnchor.key === uploadAnchorKey &&
          (uploadAnchor.request?.kind === 'personal_data_access' || uploadAnchor.request?.kind === 'personal_data_correction') ? <SupportPrivacyCopies uid={uid} caseId={id}/> : null}
        {uid && validId && uploadAnchor.key === uploadAnchorKey && uploadAnchor.request?.kind === 'access_interruption' ?
          <BusinessCessationOwnerPanel uid={uid} request={uploadAnchor.request}/> : null}
        {uid?<SupportConfidentialityPanel uid={uid} scope="owner" supportRequestId={validId?id:null} sourceKey={scope} pending={pending}/>:null}
        {invalidRelationshipNotice ? <Text accessibilityRole="alert" style={styles.body}>La référence de cette décision est invalide. Reprenez la lecture depuis votre avis exact.</Text> : null}
        {uid && validId && !invalidRelationshipNotice && (relationshipReference || request?.kind === 'account_reconciliation' || request?.kind === 'restriction_circumvention') ? <AccountRelationshipPanel uid={uid} scope="own" supportRequestId={id}
          initialOrder={request?.transactionId ? {kind: 'purchase', id: request.transactionId} : null} decisionReference={relationshipReference} /> : null}
        {request ? <SupportRequestSummary request={request} /> : !hasRelationshipNotice ? <Text style={styles.body}>{detail.isError ? 'Ce dossier ne peut pas être confirmé actuellement.' : 'Relecture du dossier…'}</Text> : null}
        {uid ? <SupportAccountEvidenceUpload uid={uid}
          request={uploadAnchor.key === uploadAnchorKey ? uploadAnchor.request : null}
          sourceKey={JSON.stringify([id, projectionGeneration])} disabled={!ready || working || !!pending}
          assertSelection={() => {context.capture(); assertNewSources();}}
          onUploaded={() => {void refresh();}}/> : null}
        {request?.accountReview?.protocol === 'support_account_review_v2' ? <View style={styles.card}>
          <Text style={styles.title}>{SUPPORT_ACCOUNT_FINDING_V2_LABELS[request.accountReview.finding]}</Text>
          <Text selectable style={styles.body}>{request.accountReview.ownerMessage}</Text>
          <Text selectable style={styles.body}>Pour présenter vos observations : {request.accountReview.recourse}</Text>
          <Text style={styles.caption}>Révision prévue : {request.accountReview.reviewDueAt}. Décision enregistrée : {request.accountReview.recordedAt}. Vos commandes et recours existants restent séparés.</Text>
          {request.accountReview.obligations.map(value => <Text selectable style={styles.caption} key={JSON.stringify(value)}>Portée : {value.kind} · {value.id}</Text>)}
        </View> : null}
        {privacyRetention ? <SupportPrivacyRetentionNotice retention={privacyRetention} /> : null}
        {recordedLate ? recordedLate.link ? <LateCommercialLinkSummary link={recordedLate.link} /> : <Text style={styles.body}>La liaison historique du constat ne peut pas être qualifiée. Aucune admission à l’examen n’est déduite.</Text> : null}
        {request?.kind === 'account_reconciliation' && request.relatedAccountIds?.length === 1 && request.relatedAccountIds[0] !== uid ? <Button variant="secondary" disabled={working || !ready} onPress={() => {try {context.capture(); if (!isSupportProjectionCurrent(request)) return; router.push({pathname: '/settings/account-control', params: {supportRequestId: request.id}} as never);} catch {/* Current owner source only. */}}}>Conserver ce compte et organiser la pause de l’autre</Button> : null}
        {request?.transportInstruction ? <SupportTransportInstruction instruction={request.transportInstruction} /> : null}
        {request?.swapHoldContext ? <SupportSwapHoldNotice context={request.swapHoldContext} /> : null}
        {request?.withdrawalTimingContext ? <SupportWithdrawalTimingNotice context={request.withdrawalTimingContext} /> : null}
        {uid && request?.withdrawalRequestId ? <ExceptionalRestitutionOwnerPanel uid={uid}
          context={{kind: 'withdrawal_misdirection', withdrawalRequestId: request.withdrawalRequestId}} /> : null}
        {uid && request && ['access_interruption', 'payment_account_review', 'account_reconciliation'].includes(request.kind) ? <ExceptionalRestitutionOwnerPanel uid={uid}
          context={{kind: 'wallet_restitution', ownerId: request.ownerId, supportRequestId: request.id}} /> : null}
        {uid && request?.kind === 'representation_review' && request.accountReview && 'protocol' in request.accountReview &&
          request.accountReview.protocol === 'support_account_review_v2' && request.accountReview.finding === 'representation_authority_confirmed' ?
          request.accountReview.obligations.filter(obligation => obligation.kind === 'wallet').map(obligation => <ExceptionalRestitutionOwnerPanel
            key={obligation.id} uid={uid} context={{kind: 'wallet_restitution', ownerId: obligation.id, supportRequestId: request.id}} />) : null}
        {request?.returnToSender && request.transactionId ? <View style={styles.card}>
          <Text style={styles.body}>Cette demande porte sur un récit de retour à l’expéditeur non vérifié. Les sources liées restent distinctes du contenu, de la réception du colis et des écritures financières.</Text>
          <Button variant="secondary" disabled={working} onPress={() => {try {context.capture(); router.push({pathname: '/orders/[id]', params: {id: request.transactionId!}} as never);} catch { /* Stale session. */ }}}>Relire le signalement dans la commande</Button>
        </View> : null}
        {notice ? <Text selectable style={styles.body}>{notice}</Text> : null}
        {journal.isError ? <Text style={styles.body}>Votre demande ne peut pas être actualisée pour le moment. Réessayez avant de la modifier.</Text> : null}
        {pending ? <View style={styles.card}>
          <Text style={styles.title}>Mise à jour en attente de confirmation</Text><Text selectable style={styles.caption}>{pending.requestId}</Text>
          <SupportStoredIntentSummary attempt={pending}/>
          <Button disabled={working} onPress={() => {void perform('observe');}}>Vérifier le résultat</Button>
          <Button variant="secondary" disabled={working || isSupportOpaqueAttempt(pending)} onPress={() => {void perform('resume');}}>Reprendre cette demande</Button>
          {supportAttemptCanNeutralize(pending) ? <Button variant="secondary" disabled={working} onPress={() => {void perform('neutralize');}}>Annuler cet envoi en attente</Button> : null}
          {receipt && supportReceiptRequestId(receipt) === pending.requestId && receipt.state !== 'unrecorded' ?
            <Button variant="secondary" disabled={working} onPress={() => {void perform('acknowledge');}}>J’ai pris connaissance du résultat</Button> : null}
        </View> : request && !closed ? <View style={styles.section}>
          <View accessibilityRole="radiogroup" accessibilityLabel="Action sur la demande" style={styles.section}>
            {(['clarify', 'link_evidence', 'withdraw'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: value === action, disabled: working || hasLateContext && value !== 'clarify'}}
              style={[styles.choice, action === value && styles.selected]} disabled={working || hasLateContext && value !== 'clarify'} onPress={() => {interaction.current++; setAction(value);}}>
              <Text style={styles.body}>{value === 'clarify' ? 'Ajouter des précisions' : value === 'link_evidence' ? 'Lier une référence privée' : 'Retirer cette demande humaine'}</Text>
            </Pressable>)}
          </View>
          {hasLateContext ? qualifiedLate ? <LateCommercialLinkSummary link={qualifiedLate} /> : <Text accessibilityRole="alert" style={styles.body}>Relisez l’examen de l’article pour sélectionner le constat exact avant de lier ces précisions.</Text> : null}
          {!hasLateContext && request.kind === 'commercial_late' && request.transactionId && !request.meetupReason && !request.lateTransport && !request.returnToSender ? <Button variant="secondary" disabled={working || !ready} onPress={() => {
            try {context.capture(); router.push({pathname: '/product-review', params: {contextKind: 'order', contextId: request.transactionId!, supportRequestId: request.id}} as never);} catch { /* Stale account. */ }
          }}>Choisir mon constat dans l’examen de l’article</Button> : null}
          <SupportDataMinimizationNotice/><Input label={action === 'withdraw' ? 'Motif du retrait de cette demande humaine' : 'Vos précisions'} value={narrative} onChangeText={value => {interaction.current++; setNarrative(value);}} multiline maxLength={4000} disabled={working || !ready} />
          {isPrivacy ? <SupportPrivacyScopeFields key={scope} value={privacyScope} onChange={value=>{try {context.capture(); interaction.current++;setPrivacyScope(value);} catch { /* Superseded owner or route. */ }}} disabled={working || !ready} existing /> : null}
          {action === 'link_evidence' ? <>
            <View accessibilityRole="radiogroup" accessibilityLabel="Type de référence" style={styles.section}>{(Object.keys(evidenceLabels) as SupportEvidenceKind[]).map(value =>
              <Pressable accessibilityRole="radio" accessibilityState={{checked: evidenceKind === value, disabled: working}} key={value} disabled={working} style={styles.choice} onPress={() => {interaction.current++;setEvidenceKind(value);}}>
                <Text style={styles.body}>{evidenceLabels[value]}</Text>
              </Pressable>)}</View>
            <Input label={evidenceKind === 'meetup_declaration' ? 'Référence exacte de l’accord (commande)' : 'Identifiant exact du dossier privé'} value={evidenceId} onChangeText={value=>{interaction.current++; setEvidenceId(value);}} maxLength={128} disabled={working} autoCapitalize="none" />
            <Text style={styles.caption}>Le serveur vérifie votre participation et fige la référence avec sa révision. Cette liaison n’importe ni document d’identité ni lien de téléchargement.</Text>
          </> : null}
          {action === 'withdraw' ? <Text style={styles.body}>Ce retrait concerne seulement votre demande d’examen humain. Il ne clôt pas un litige commercial, ne supprime pas ses preuves et ne lève pas le gel des fonds.</Text> : null}
          <Button disabled={working || !ready || !narrative.trim() || hasLateContext && (!qualifiedLate || action !== 'clarify') || isPrivacy && privacyScope !== null && !privacyScope.categories.length || action === 'link_evidence' && !evidenceId.trim()} onPress={() => {void perform('execute');}}>
            {action === 'withdraw' ? 'Retirer la demande humaine' : 'Enregistrer ces éléments'}
          </Button>
        </View> : null}
        {request && closed ? <Button variant="secondary" disabled={working || !!pending} onPress={() => {
          try {
            context.capture();
            if (request.kind === 'automated_decision_review') {
              if (!request.decision) return;
              const swapDecision = request.swapId && 'sourceKind' in request.decision && request.decision.sourceKind === 'swap';
              router.push({pathname: swapDecision ? '/settings/support' : request.transactionId ? '/orders/decisions/[id]' : '/settings/decisions', params: {
                ...(swapDecision ? {kind: 'automated_decision_review', swapId: request.swapId} : request.transactionId ? {id: request.transactionId} : {}), priorSupportRequestId: request.id,
                decisionId: request.decision.id, decisionRevision: request.decision.revision, decisionHash: request.decision.sourceHash}} as never);
            } else router.push({pathname: '/settings/support', params: {kind: request.kind, priorSupportRequestId: request.id,
              ...(request.swapId ? {swapId: request.swapId} : {}),
              ...(request.withdrawalRequestId ? {withdrawalRequestId: request.withdrawalRequestId} : {}),
              ...(request.returnToSender ? {returnToSender: JSON.stringify(request.returnToSender)} : {}),
              ...(request.transactionId ? {transactionId: request.transactionId} : {}), ...(request.meetupReason ? {meetupReason: request.meetupReason} : {})}} as never);
          } catch { /* Stale session. */ }
        }}>Ouvrir une nouvelle demande liée</Button> : null}
        <Button variant="secondary" disabled={working || !uid} onPress={() => {void refresh();}}>{hasRelationshipNotice ? 'Actualiser mes demandes' : 'Actualiser le dossier'}</Button>
        <Text style={styles.title}>Historique de la demande</Text>
      </View>}
      ListFooterComponent={!hasRelationshipNotice && detail.hasNextPage ? <Button variant="secondary" disabled={detail.isFetchingNextPage} onPress={() => {void detail.fetchNextPage();}}>Voir les mises à jour précédentes</Button> : null} />
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md}, section: {gap: spacing.md, marginBottom: spacing.md},
  card: {gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  choice: {padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm}, selected: {backgroundColor: colors.surfaceSubtle, borderColor: colors.primary} });
