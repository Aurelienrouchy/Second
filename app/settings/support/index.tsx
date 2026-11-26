import {declaredSupportAccountInput, isDeclaredSupportAccountList} from '@/utils/supportAccountIdentity';
import {useSupportProjectionGeneration} from '@/hooks/useSupportProjectionGeneration';
import {areSupportProjectionPagesCurrent,isSupportProjectionCurrent} from '@/services/supportProjectionGuard';
import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, ScreenHeader } from '@/components/ui';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { ACCOUNT_SUPPORT_KINDS, SupportRequestService, newSupportRequestId, supportError, isLateTransportReference, supportAttemptCanNeutralize, supportCommandHash, isSupportOpaqueAttempt, supportReceiptRequestId } from '@/services/supportRequestService';
import { LateTransportIncidentService } from '@/services/lateTransportIncidentService';
import { ReturnToSenderService, isReturnToSenderSupportReference } from '@/services/returnToSenderService';
import {SupportConfidentialityPanel} from '@/components/SupportConfidentialityPanel';
import { SupportLegalReviewJournal } from '@/components/SupportLegalReviewJournal';
import {PrivacyOperationsJournal} from '@/components/PrivacyOperationsJournal';
import {BusinessCessationHistory} from '@/components/BusinessCessationHistory';
import { SupportPrivacyScopeFields } from '@/components/SupportPrivacyScopeFields';
import { LateTransportRecoveryJournal } from '@/components/LateTransportRecoveryJournal';
import { AccountRelationshipJournal } from '@/components/AccountRelationshipJournal';
import { isLateCommercialLink, LateCommercialRecourseService } from '@/services/lateCommercialRecourseService';
import { productReviewEqual } from '@/services/productReviewService';
import {readScopedQuery} from '@/utils/readScopedQuery';
import { SwapHoldReviewService } from '@/services/swapHoldReviewService';
import {TransactionService} from '@/services/transactionService';
import {getTransactionArticlePresentation} from '@/utils/transactionArticlePresentation';
import { APP_LOCALE } from '@/constants/locale';
import { colors, radius, sizing, spacing, typography } from '@/constants/theme';
import { SUPPORT_KIND_LABELS, SUPPORT_STATUS_LABELS, MEETUP_SUPPORT_LABELS, supportRequestLabel, declaredSupportDate } from '@/utils/supportPresentation';
import type { MeetupSupportReason, SupportAttempt, SupportKind, SupportListCursor, SupportServicingReceipt, SupportRequest, SupportPrivacyScope } from '@/types/supportRequest';
import type { LateTransportIncidentReference } from '@/types/lateTransportIncident';
import type { ReturnToSenderSupportReference } from '@/types/returnToSender';
import type { LateCommercialLink } from '@/types/lateCommercialRecourse';

const kinds: SupportKind[] = ['commercial_late', 'swap_hold_assistance', 'withdrawal_timing_assistance', 'access_interruption', 'personal_data_access', 'personal_data_correction', ...ACCOUNT_SUPPORT_KINDS];
const followUps = {
  transport: 'Suivi après remboursement', accounts: 'Suivi de mes comptes', confidentiality: 'Confidentialité d’une demande',
  confidentialReview: 'Examen de confidentialité', authority: 'Demandes d’une autorité', privacy: 'Mes renseignements personnels', continuity: 'Continuité du service',
} as const;
type FollowUp = keyof typeof followUps;
const keyExtractor = (item: SupportRequest) => item.id;
interface OrderChoice {id: string; title: string; isBuyer: boolean; onPress: () => void}
const orderKeyExtractor = (item: OrderChoice) => item.id;
const renderOrderChoice = ({item}: {item: OrderChoice}) => <Pressable accessibilityRole="button" accessibilityLabel={`Choisir ${item.title}`} style={styles.requestRow} onPress={item.onPress}>
  <View style={styles.rowContent}><Text style={styles.title}>{item.title}</Text><Text style={styles.caption}>{item.isBuyer ? 'Mon achat' : 'Ma vente'}</Text></View>
  <Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
</Pressable>;
export default function SupportRequestsScreen() {
  const uid = useAuthenticatedUid(), router = useRouter(), client=useQueryClient(), projectionGeneration=useSupportProjectionGeneration();
  const params = useLocalSearchParams<{ kind?: string; accountControl?: string; transactionId?: string; priorSupportRequestId?: string; meetupReason?: string; lateTransport?: string; incidentCursor?: string; swapId?: string; withdrawalRequestId?: string; returnToSender?: string; lateCommercial?: string; decisionId?: string; decisionRevision?: string; decisionHash?: string }>();
  const accountControlPair = params.kind === 'account_reconciliation' && params.accountControl === 'keep_and_pause_v1';
  const hasSwapDecisionContext = params.kind === 'automated_decision_review' && params.swapId !== undefined;
  const swapDecisionReference = hasSwapDecisionContext && typeof params.swapId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(params.swapId) &&
    typeof params.decisionId === 'string' && /^swap_funds_released_[a-f0-9]{64}$/.test(params.decisionId) &&
    typeof params.decisionRevision === 'string' && /^\d+:\d+$/.test(params.decisionRevision) &&
    typeof params.decisionHash === 'string' && /^[a-f0-9]{64}$/.test(params.decisionHash)
    ? {id: params.decisionId, revision: params.decisionRevision, sourceHash: params.decisionHash} : null;
  let lateReference: LateCommercialLink | null = null;
  try {const value: unknown = params.lateCommercial ? JSON.parse(params.lateCommercial) : null;
    if (isLateCommercialLink(value) && value.transactionId === params.transactionId && params.kind === 'commercial_late') lateReference = value;
  } catch { /* Route data alone grants no native admission. */ }
  const hasLateContext = params.lateCommercial !== undefined;
  let incidentReference: LateTransportIncidentReference | null = null;
  try {const value: unknown = params.lateTransport ? JSON.parse(params.lateTransport) : null; if (isLateTransportReference(value) && value.transactionId === params.transactionId && params.kind === 'commercial_late') incidentReference = value;} catch { /* Invalid route references remain closed. */ }
  const hasIncidentContext = params.lateTransport !== undefined;
  let returnReference: ReturnToSenderSupportReference | null = null;
  try {const value: unknown = params.returnToSender ? JSON.parse(params.returnToSender) : null; if (isReturnToSenderSupportReference(value) && value.transactionId === params.transactionId && params.kind === 'commercial_late') returnReference = value;} catch { /* Invalid route reference remains closed. */ }
  const hasReturnContext = params.returnToSender !== undefined;
  const validMeetupReason = typeof params.meetupReason === 'string' && Object.prototype.hasOwnProperty.call(MEETUP_SUPPORT_LABELS, params.meetupReason) ? params.meetupReason as MeetupSupportReason : undefined;
  const generation = useAuthStore(getAuthSessionGeneration);
  const scope = JSON.stringify([uid, generation, params.transactionId, params.priorSupportRequestId, params.kind, params.accountControl, validMeetupReason, params.lateTransport, params.incidentCursor, params.swapId, params.withdrawalRequestId, params.returnToSender, params.lateCommercial, params.decisionId, params.decisionRevision, params.decisionHash]);
  const context = useLabelLifecycleContext(`support-owner:${scope}`, uid);
  const [followUp, setFollowUp] = useState<{scope: string; flow: FollowUp | null} | null>(null);
  const currentFollowUp = context.focused && followUp?.scope === scope ? followUp : null;
  const [subjectScope, setSubjectScope] = useState<string | null>(null);
  const [detailsScope, setDetailsScope] = useState<string | null>(null);
  const interaction = useRef(0);
  const [kind, setKind] = useState<SupportKind | null>(hasSwapDecisionContext ? 'automated_decision_review' : kinds.includes(params.kind as SupportKind) ? params.kind as SupportKind : null);
  const [transactionId, setTransactionId] = useState(params.transactionId ?? '');
  const [orderPickerScope, setOrderPickerScope] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<{scope: string; title: string} | null>(null);
  const [swapId, setSwapId] = useState(params.swapId ?? '');
  const [withdrawalRequestId, setWithdrawalRequestId] = useState(params.withdrawalRequestId ?? '');
  const [meetupReason, setMeetupReason] = useState<MeetupSupportReason | undefined>(validMeetupReason);
  const [narrative, setNarrative] = useState(''), [discovered, setDiscovered] = useState(''), [interrupted, setInterrupted] = useState('');
  const [relatedAccounts, setRelatedAccounts] = useState(''), [relationship, setRelationship] = useState(''), [authorityStatement, setAuthorityStatement] = useState('');
  const [includeCurrentAccount, setIncludeCurrentAccount] = useState(false);
  const [representationReason, setRepresentationReason] = useState<'death' | 'incapacity' | null>(null);
  const [privacyScope, setPrivacyScope] = useState<SupportPrivacyScope | null>(null);
  const isPrivacy = kind === 'personal_data_access' || kind === 'personal_data_correction';
  const isAccountKind = kind !== null && (ACCOUNT_SUPPORT_KINDS as readonly string[]).includes(kind);
  const isSwapAssistance = kind === 'swap_hold_assistance';
  const isWithdrawalAssistance = kind === 'withdrawal_timing_assistance';
  const declaredAccountIds = declaredSupportAccountInput(relatedAccounts, accountControlPair);
  if (!accountControlPair && includeCurrentAccount && uid) declaredAccountIds.push(uid);
  const validDeclaredAccounts = isDeclaredSupportAccountList(declaredAccountIds, accountControlPair ? 1 : 5) && (!accountControlPair || declaredAccountIds[0] !== uid);
  const [notice, setNotice] = useState(''), [receipt, setReceipt] = useState<SupportServicingReceipt | null>(null);
  const [workingState, setWorkingState] = useState({frame: context.frame, focusRevision: context.focusRevision, value: false});
  const working = workingState.frame === context.frame && workingState.focusRevision === context.focusRevision && workingState.value;
  const setWorking = (value: boolean) => setWorkingState({frame: context.frame, focusRevision: context.focusRevision, value});
  const [formScope, setFormScope] = useState(scope);
  if (formScope !== scope) {
    setFormScope(scope); setKind(hasSwapDecisionContext ? 'automated_decision_review' : kinds.includes(params.kind as SupportKind) ? params.kind as SupportKind : null);
    setTransactionId(params.transactionId ?? ''); setSelectedOrder(null); setOrderPickerScope(null); setMeetupReason(validMeetupReason); setNarrative(''); setDiscovered(''); setInterrupted(''); setNotice(''); setReceipt(null); setWorking(false);
    setRelatedAccounts(''); setIncludeCurrentAccount(false); setRelationship(''); setAuthorityStatement(''); setRepresentationReason(null);
    setSwapId(params.swapId ?? '');
    setWithdrawalRequestId(params.withdrawalRequestId ?? '');
    setPrivacyScope(null);
  }
  const journalKey = ['support-owner-journal', uid, generation, scope, context.focusRevision];
  const journal = useQuery({ queryKey: journalKey,
    enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, current => SupportRequestService.journal(uid!, 'owner', current)) });
  const selectionScope = JSON.stringify([scope, context.focusRevision]);
  const orderPickerOpen = orderPickerScope === selectionScope && context.focused && !params.transactionId;
  const orderChoiceKey = ['support-order-selection', uid, generation, scope, context.focusRevision];
  const orderChoices = useQuery({queryKey: orderChoiceKey, enabled: !!uid && orderPickerOpen,
    staleTime: 0, gcTime: 0, retry: false, queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, async current => {
      const orders = await TransactionService.getUserTransactions(uid!); current();
      return [...new Map(orders.filter(order => order.buyerId === uid || order.sellerId === uid).map(order => [order.id, order])).values()];
    })});
  const qualifiedOrderChoices = orderPickerOpen && orderChoices.isSuccess && !orderChoices.isFetching && !orderChoices.isError ? orderChoices.data : [];
  const orderChoiceItems: OrderChoice[] = qualifiedOrderChoices.map(item => {
    const title = getTransactionArticlePresentation(item).title;
    return {id: item.id, title, isBuyer: item.buyerId === uid, onPress: () => {
      try {
        context.capture(); const current = client.getQueryState(orderChoiceKey);
        if (!orderPickerOpen || working || current?.status !== 'success' || current.fetchStatus !== 'idle' || current.isInvalidated || current.error !== null ||
            current.data !== orderChoices.data || !qualifiedOrderChoices.includes(item) || item.buyerId !== uid && item.sellerId !== uid) return;
        interaction.current++; setTransactionId(item.id); setSelectedOrder({scope, title}); setOrderPickerScope(null);
      } catch {/* Old identity, focus or source. */}
    }};
  });
  const incidentRead = useQuery({queryKey: ['support-late-transport-preview', uid, generation, params.lateTransport, params.incidentCursor, context.focusRevision],
    enabled: !!uid && !!incidentReference && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, async currentScope => {
      const expected = incidentReference!;
      const page = await LateTransportIncidentService.read(uid!, expected.transactionId, 'owner', params.incidentCursor, currentScope);
      const incident = page.items.find(item => item.incidentId === expected.incidentId);
      const current = incident ? {kind: 'late_transport_incident', transactionId: page.transactionId, incidentId: incident.incidentId,
        incidentRevision: incident.incidentRevision, incidentHash: incident.incidentHash, financialSourceHash: incident.financialSourceHash, orderRevision: page.sourceRevision} : null;
      if (!incident || !isLateTransportReference(current) || await supportCommandHash(current) !== await supportCommandHash(expected)) throw new Error('La source de cette observation a changé ou ne peut pas être qualifiée. Relisez la commande avant de choisir une observation.');
      currentScope(); return {incident, reference: current};
    })});
  const qualifiedIncident = context.focused && incidentRead.isSuccess && !incidentRead.isFetching && !incidentRead.isError ? incidentRead.data : null;
  const returnRead = useQuery({queryKey: ['support-return-to-sender-preview', uid, generation, params.returnToSender, context.focusRevision],
    enabled: !!uid && !!returnReference && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, async currentScope => {
      const expected = returnReference!;
      const page = await ReturnToSenderService.cases(uid!, expected.transactionId, 'owner', currentScope);
      const report = page.items.find(item => item.caseId === expected.caseId);
      const current = report ? {kind: 'return_to_sender_report', transactionId: page.transactionId, caseId: report.caseId,
        caseRevision: report.caseRevision, caseHash: report.caseHash, financialSourceHash: page.financialSourceHash, orderRevision: page.sourceRevision} : null;
      if (!report || !isReturnToSenderSupportReference(current) || await supportCommandHash(current) !== await supportCommandHash(expected)) throw new Error('Les sources de ce signalement ont changé ou ne peuvent pas être qualifiées. Relisez la commande et sélectionnez explicitement le dossier actuel.');
      currentScope(); return {report, reference: current, financialRecording: page.financialRecording};
    })});
  const qualifiedReturn = context.focused && returnRead.isSuccess && !returnRead.isFetching && !returnRead.isError ? returnRead.data : null;
  const lateRead = useQuery({queryKey: ['support-late-commercial-source', uid, generation, params.lateCommercial, context.focusRevision],
    enabled: !!uid && !!lateReference && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, async current => {
      const expected = lateReference!;
      const result = await LateCommercialRecourseService.source(uid!, expected.transactionId, expected.contributionId, expected.topic,
        current, expected.materialCapability !== undefined, expected.parcelCapability !== undefined);
      current(); if (!productReviewEqual(result.link, expected)) throw new Error('Le constat a changé. Choisissez-le à nouveau depuis l’examen de l’article.');
      return result.link;
    })});
  const qualifiedLate = context.focused && lateRead.isSuccess && !lateRead.isFetching && !lateRead.isError ? lateRead.data : null;
  const swapDecisionKey = ['support-swap-release-decision', uid, generation, scope, context.focusRevision];
  const swapDecisionRead = useQuery({queryKey: swapDecisionKey,
    enabled: !!uid && !!swapDecisionReference && context.focused, staleTime: 0, gcTime: 0, retry: false, placeholderData: undefined,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, current => SwapHoldReviewService.exactReleaseDecision(uid!, params.swapId!, swapDecisionReference!, current))});
  const qualifiedSwapDecision = context.focused && swapDecisionRead.isFetchedAfterMount && swapDecisionRead.isSuccess && !swapDecisionRead.isFetching &&
    !swapDecisionRead.isError && !swapDecisionRead.isPlaceholderData && client.getQueryState(swapDecisionKey)?.isInvalidated !== true ? swapDecisionRead.data : null;
  const list = useInfiniteQuery({ queryKey: ['support-owner-list', uid, generation, scope, context.focusRevision, projectionGeneration],
    enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing:false,
    initialPageParam: undefined as SupportListCursor | undefined,
    queryFn: ({pageParam, signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, current => SupportRequestService.list(uid!, 'owner', pageParam, current)),
    getNextPageParam: last => last.cursor ?? undefined });
  const ready = !!uid && context.focused && journal.isSuccess && !journal.isFetching;
  const pending = ready ? journal.data : null;
  const rows = areSupportProjectionPagesCurrent(list.data?.pages) && context.focused && list.isSuccess && !list.isFetching && !list.isError ? list.data.pages.flatMap(page => page.items) : [];
  const refresh = async () => { await Promise.all([journal.refetch(), list.refetch()]); };
  const assertNewSources=()=>{const check=(queryKey:readonly unknown[],data:unknown,at:number)=>{const q=client.getQueryState(queryKey);if(!q||q.status!=='success'||q.fetchStatus!=='idle'||q.error!==null||q.isInvalidated||q.data!==data||q.dataUpdatedAt!==at)throw new Error('Le journal ou la source sélectionnée a changé. Relisez cette demande avant le dépôt.');};check(journalKey,journal.data,journal.dataUpdatedAt);if(hasIncidentContext)check(['support-late-transport-preview',uid,generation,params.lateTransport,params.incidentCursor,context.focusRevision],incidentRead.data,incidentRead.dataUpdatedAt);if(hasReturnContext)check(['support-return-to-sender-preview',uid,generation,params.returnToSender,context.focusRevision],returnRead.data,returnRead.dataUpdatedAt);if(hasLateContext)check(['support-late-commercial-source',uid,generation,params.lateCommercial,context.focusRevision],lateRead.data,lateRead.dataUpdatedAt);if(hasSwapDecisionContext)check(swapDecisionKey,swapDecisionRead.data,swapDecisionRead.dataUpdatedAt);};
  const perform = async (mode: 'submit' | 'observe' | 'resume' | 'acknowledge' | 'neutralize') => {
    if (!ready || working || mode === 'submit' && pending || mode !== 'submit' && !pending) return;
    let operation;
    try {operation = context.start();} catch {return;}
    if (!operation) return;
    const capturedInteraction = interaction.current;
    const assertCurrent = () => {context.assertCurrent(operation); if(mode==='submit')assertNewSources(); if (mode === 'submit' && capturedInteraction !== interaction.current) throw new Error('Le formulaire a changé. Confirmez à nouveau la demande actuelle.');};
    setWorking(true); setNotice('');
    try {
      let result: SupportServicingReceipt;
      if (mode === 'submit') {
        if (!kind) throw new Error('Choisissez le sujet de votre demande.');
        if (hasIncidentContext && (!qualifiedIncident || kind !== 'commercial_late' || transactionId.trim() !== qualifiedIncident.reference.transactionId || meetupReason)) throw new Error('Relisez l’observation exacte avant de déposer ce récit.');
        if (hasReturnContext && (hasIncidentContext || !qualifiedReturn || kind !== 'commercial_late' || transactionId.trim() !== qualifiedReturn.reference.transactionId || meetupReason)) throw new Error('Relisez ce signalement et ses sources exactes avant une demande d’instruction.');
        if (hasSwapDecisionContext) {
          if (!qualifiedSwapDecision || !swapDecisionReference || kind !== 'automated_decision_review' || params.transactionId !== undefined ||
            hasIncidentContext || hasReturnContext || hasLateContext || meetupReason || params.withdrawalRequestId !== undefined)
            throw new Error('Relisez la décision exacte depuis le Troc avant ce dépôt.');
          await SwapHoldReviewService.exactReleaseDecision(operation.base.session.uid, params.swapId!, swapDecisionReference, assertCurrent); assertCurrent();
        }
        if (kind === 'representation_review' && !representationReason) throw new Error('Choisissez le motif de représentation déclaré.');
        if (isPrivacy && privacyScope && !privacyScope.categories.length) throw new Error('Choisissez au moins une catégorie de données.');
        if (hasLateContext) {
          if (!qualifiedLate || kind !== 'commercial_late' || transactionId.trim() !== qualifiedLate.transactionId || meetupReason || hasIncidentContext || hasReturnContext)
            throw new Error('Relisez le constat exact avant de le joindre à cette demande commerciale.');
          const fresh = await LateCommercialRecourseService.source(uid!, qualifiedLate.transactionId, qualifiedLate.contributionId, qualifiedLate.topic,
            assertCurrent, qualifiedLate.materialCapability !== undefined, qualifiedLate.parcelCapability !== undefined); assertCurrent();
          if (!productReviewEqual(fresh.link, qualifiedLate)) throw new Error('Le constat ou les sources ont changé. Choisissez à nouveau le constat.');
        }
        const discoveredAt = declaredSupportDate(discovered), interruptionAt = declaredSupportDate(interrupted);
        const attempt: SupportAttempt = {version: 1, uid: operation.base.session.uid, scope: 'owner', requestId: newSupportRequestId(),
          ...(isPrivacy ? {privacyRetentionCapability: 'privacy_retention_v1' as const} : {}),
          ...(hasLateContext ? {lateCommercialCapability: 'late_commercial_recourse_v1' as const} : {}),
          command: {action: 'submit', kind, narrative: narrative.trim(), ...(!isAccountKind && !isSwapAssistance && !isWithdrawalAssistance && !hasSwapDecisionContext && transactionId.trim() ? {transactionId: transactionId.trim()} : {}),
            ...(isPrivacy && privacyScope ? {privacyScope: {...privacyScope, description: privacyScope.description?.trim() || null}} : {}),
            ...(hasLateContext && qualifiedLate ? {lateCommercial: qualifiedLate} : {}),
            ...(isSwapAssistance ? {swapId: swapId.trim()} : {}),
            ...(hasSwapDecisionContext && swapDecisionReference ? {transactionId: null, swapId: params.swapId!, decision: swapDecisionReference, evidence: []} : {}),
            ...(isWithdrawalAssistance ? {withdrawalRequestId: withdrawalRequestId.trim()} : {}),
            ...(isAccountKind ? {relatedAccountIds: declaredAccountIds} : {}),
            ...(kind === 'representation_review' && representationReason ? {representation: {reason: representationReason, relationship: relationship.trim(), authorityStatement: authorityStatement.trim()}} : {}),
            ...(discoveredAt ? {discoveredAt} : {}), ...(interruptionAt ? {interruptionAt} : {}),
            ...(kind === 'commercial_late' && meetupReason ? {meetupReason, evidence: [{kind: 'meetup_declaration', id: transactionId.trim()}]} : {}),
            ...(hasIncidentContext && qualifiedIncident ? {lateTransport: qualifiedIncident.reference} : {}),
            ...(hasReturnContext && qualifiedReturn ? {returnToSender: qualifiedReturn.reference} : {}),
            ...(params.priorSupportRequestId ? {priorSupportRequestId: params.priorSupportRequestId} : {})}};
        result = await SupportRequestService.execute(attempt, assertCurrent);
      } else result = mode === 'resume' ? await SupportRequestService.execute((()=>{if(!pending||isSupportOpaqueAttempt(pending))throw new Error('Cette demande doit être vérifiée ou arrêtée avant de pouvoir continuer.');return pending;})(), () => context.assertCurrent(operation), true) :
        mode === 'observe' ? await SupportRequestService.observe(pending!, () => context.assertCurrent(operation)) :
        mode === 'neutralize' ? await SupportRequestService.neutralize(pending!, () => context.assertCurrent(operation)) :
        await SupportRequestService.acknowledge(pending!, () => context.assertCurrent(operation));
      assertCurrent(); setReceipt(result);
      setNotice(result.state === 'committed' ? 'Votre demande a été enregistrée. Vous pourrez suivre la réponse de l’équipe ici.' :
        result.state === 'not_executed' ? result.reason === 'swap_context_not_authorized' ? 'La demande n’a pas été envoyée. Vérifiez le troc sélectionné et le compte utilisé.' :
          result.reason === 'withdrawal_context_not_authorized' ? 'La demande n’a pas été envoyée. Ce retrait ne correspond pas au compte utilisé.' :
          result.reason === 'transport_source_changed' ? 'La commande a changé. Consultez-la avant de renvoyer votre demande.' :
            'La demande n’a pas été envoyée. Consultez le dossier avant de réessayer.' :
        'L’envoi n’est pas encore confirmé. Vérifiez son résultat ci-dessous avant de créer une autre demande.');

      await refresh(); context.assertCurrent(operation);
    } catch (error) { try {assertCurrent(); setNotice(supportError(error)); await journal.refetch();} catch { /* Old activity or edited draft cannot receive this callback. */ } }
    finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const renderItem = useCallback(({item}: {item: SupportRequest}) => <Pressable accessibilityRole="button" style={styles.requestRow}
    onPress={() => {try {context.capture(); if (!isSupportProjectionCurrent(item)) return;
      router.push({pathname: '/settings/support/[id]', params: {id: item.id}} as never);} catch {/* Stale session. */}}}>
    <View style={styles.rowContent}><Text style={styles.title}>{supportRequestLabel(item)}</Text><Text style={styles.body}>{SUPPORT_STATUS_LABELS[item.status]}</Text>
      <Text style={styles.caption}>{Number.isFinite(item.receivedAtMs) ? new Date(item.receivedAtMs).toLocaleDateString(APP_LOCALE, {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Toronto'}) : 'Date à confirmer'}</Text></View>
    <Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
  </Pressable>, [context, router]);
  const subjectLocked = accountControlPair || hasSwapDecisionContext || hasIncidentContext || hasReturnContext || hasLateContext || !!params.swapId || !!params.withdrawalRequestId;
  const openFollowUp = (flow: FollowUp | null) => {try {context.capture(); setFollowUp({scope, flow});} catch {/* Inactive visit. */}};
  return <View style={styles.container}>
    <ScreenHeader title="Mes demandes" onBack={() => router.back()} />
    <FlashList data={rows} keyExtractor={keyExtractor} renderItem={renderItem} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.section}>
        {!uid ? <Text style={styles.body}>Connectez-vous au compte concerné. Si vous ne pouvez plus vous connecter, utilisez le contact indiqué dans Aide.</Text> : null}
        {notice ? <Text selectable style={styles.body}>{notice}</Text> : null}
        {journal.isError ? <Text style={styles.body}>Vos demandes ne sont pas disponibles pour le moment. Réessayez pour pouvoir en envoyer une nouvelle.</Text> : null}
        {pending ? <View style={styles.card}>
          <Text style={styles.title}>Votre demande est en attente</Text>
          <Text style={styles.body}>Actualisez son résultat avant d’en envoyer une autre.</Text>
          <Button disabled={working} onPress={() => {void perform('observe');}}>Actualiser le résultat</Button>
          <Button variant="secondary" disabled={working || isSupportOpaqueAttempt(pending)} onPress={() => {void perform('resume');}}>Reprendre cette demande</Button>
          {supportAttemptCanNeutralize(pending) ? <Button variant="secondary" disabled={working} onPress={() => {void perform('neutralize');}}>Annuler cet envoi en attente</Button> : null}
          {!!receipt && supportReceiptRequestId(receipt) === pending.requestId && receipt.state !== 'unrecorded' &&
            <Button variant="secondary" disabled={working} onPress={() => {void perform('acknowledge');}}>J’ai pris connaissance du résultat</Button>}
        </View> : <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.title}>Contacter Seconde</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Choisir le sujet de ma demande" accessibilityState={{expanded: subjectScope === scope, disabled: working || !ready || subjectLocked}}
            disabled={working || !ready || subjectLocked} style={styles.menuRow} onPress={() => {try {context.capture(); setSubjectScope(subjectScope === scope ? null : scope);} catch {/* Inactive visit. */}}}>
            <View style={styles.rowContent}><Text style={styles.caption}>Sujet</Text><Text style={styles.body}>{kind ? SUPPORT_KIND_LABELS[kind] : 'Choisir un sujet'}</Text></View>
            {!subjectLocked ? <Ionicons name={subjectScope === scope ? 'chevron-up' : 'chevron-down'} size={sizing.iconSM} color={colors.muted}/> : null}
          </Pressable>
          {subjectScope === scope && !subjectLocked ? <View accessibilityRole="radiogroup" accessibilityLabel="Objet de la demande" style={styles.section}>{kinds.map(value =>
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: kind === value, disabled: working || !ready || accountControlPair || hasIncidentContext || hasReturnContext || hasLateContext || !!params.swapId || !!params.withdrawalRequestId}}
              disabled={working || !ready || subjectLocked} style={[styles.choice, value === kind && styles.selected]} onPress={() => {try {context.capture(); interaction.current++; setKind(value); setSubjectScope(null); if (value !== 'commercial_late') setMeetupReason(undefined);} catch {/* Inactive visit. */}}}>
              <Text style={styles.body}>{SUPPORT_KIND_LABELS[value]}</Text>
            </Pressable>)}</View> : null}
          {!isAccountKind && !isSwapAssistance && !isWithdrawalAssistance && !hasSwapDecisionContext ? params.transactionId
            ? <Text style={styles.caption}>Votre commande est jointe à cette demande.</Text>
            : <Pressable accessibilityRole="button" style={styles.menuRow} disabled={!ready || working} onPress={() => {try {context.capture(); setOrderPickerScope(selectionScope);} catch {/* Inactive visit. */}}}>
              <Text style={styles.menuLabel}>{selectedOrder?.scope === scope ? selectedOrder.title : kind === 'commercial_late' ? 'Choisir la commande concernée' : 'Joindre une commande (facultatif)'}</Text>
              <Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
            </Pressable> : null}
          {isSwapAssistance ? <>
            {params.swapId ? <Text style={styles.caption}>Votre troc est joint à cette demande.</Text> :
              <Button variant="ghost" disabled={!ready || working} onPress={() => {try {context.capture(); router.push('/my-swaps');} catch {/* Inactive visit. */}}}>Choisir le troc concerné</Button>}
          </> : null}
          {hasSwapDecisionContext ? <View style={styles.card}>
            <Text style={styles.title}>Décision concernant votre troc</Text>
            {qualifiedSwapDecision ? <>
              <Text selectable style={styles.body}>{qualifiedSwapDecision.result}</Text>
              <Text style={styles.caption}>Décision enregistrée le {new Date(qualifiedSwapDecision.executedAt).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'})} (heure du Québec).</Text>
            </> : <Text accessibilityRole="alert" style={styles.body}>{!swapDecisionReference || swapDecisionRead.isError
              ? 'Cette décision ne peut pas être vérifiée. Revenez à votre troc pour la sélectionner à nouveau.'
              : 'Chargement de la décision…'}</Text>}
            <Button variant="ghost" disabled={!ready || working || !swapDecisionReference || swapDecisionRead.isFetching} onPress={() => {try {context.capture(); void swapDecisionRead.refetch();} catch { /* Stale activity cannot read this source. */ }}}>Actualiser la décision</Button>
          </View> : null}
          {isWithdrawalAssistance ? <>
            {params.withdrawalRequestId ? <Text style={styles.caption}>Votre retrait est joint à cette demande.</Text> :
              <Button variant="ghost" disabled={!ready || working} onPress={() => {try {context.capture(); router.push('/wallet');} catch {/* Inactive visit. */}}}>Choisir le retrait concerné</Button>}
          </> : null}
          {hasIncidentContext ? <View style={styles.card}>
            <Text style={styles.title}>Votre livraison</Text>
            {qualifiedIncident ? <>
              <Text style={styles.body}>{qualifiedIncident.incident.providerStatusCode === 'DE' ? 'Livraison signalée par le transporteur.' : 'Transit signalé par le transporteur.'}</Text>
              <Text style={styles.caption}>Mise à jour du transporteur : {new Date(qualifiedIncident.incident.providerObservedAt).toLocaleString(APP_LOCALE, {day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto'})}.</Text>
            </> : <Text style={styles.body}>{incidentRead.isError ? 'Impossible de vérifier cette livraison. Consultez votre commande avant de réessayer.' : 'Chargement de la livraison…'}</Text>}
            <Button variant="ghost" disabled={working || !uid || !context.focused || incidentRead.isFetching || !incidentReference} onPress={() => {try {context.capture(); void incidentRead.refetch();} catch { /* Stale session. */ }}}>Actualiser la livraison</Button>
          </View> : null}
          {hasReturnContext ? <View style={styles.card}>
            <Text style={styles.body}>{qualifiedReturn ? 'Votre signalement de retour est joint à cette demande.' : returnRead.isError ? 'Impossible de vérifier le signalement. Consultez votre commande avant de réessayer.' : 'Chargement du signalement…'}</Text>
            <Button variant="ghost" disabled={working || !uid || !context.focused || returnRead.isFetching || !returnReference} onPress={() => {try {context.capture(); void returnRead.refetch();} catch { /* Stale session/source. */ }}}>Actualiser le signalement</Button>
          </View> : null}
          {isAccountKind ? <View style={styles.section}>
            <Input label={accountControlPair ? 'Identifiant du compte à mettre en pause' : 'Identifiants des comptes concernés (un par ligne)'} value={relatedAccounts} onChangeText={value=>{interaction.current++; setRelatedAccounts(value);}}
              multiline={!accountControlPair} maxLength={accountControlPair ? 128 : 645} disabled={!ready || working} autoCapitalize="none" autoCorrect={false} />
            {accountControlPair ? <Text style={styles.caption}>Indiquez un seul compte différent de votre compte actuel.</Text> : <Button variant="ghost" disabled={!ready || working || !uid || !includeCurrentAccount && declaredAccountIds.length >= 5} onPress={() => {try {context.capture(); interaction.current++; setIncludeCurrentAccount(value => !value);} catch {/* Inactive visit. */}}}>
              {includeCurrentAccount ? 'Retirer mon compte actuel' : 'Inclure mon compte actuel'}</Button>}
            {includeCurrentAccount && !accountControlPair ? <Text style={styles.caption}>Mon compte actuel est joint à la demande.</Text> : null}
            {kind === 'representation_review' ? <>
              <View accessibilityRole="radiogroup" accessibilityLabel="Motif de représentation déclaré" style={styles.section}>{(['death', 'incapacity'] as const).map(value =>
                <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: representationReason === value, disabled: working || !ready}}
                  disabled={working || !ready} style={[styles.choice, representationReason === value && styles.selected]} onPress={() => {interaction.current++;setRepresentationReason(value);}}>
                  <Text style={styles.body}>{value === 'death' ? 'Décès déclaré' : 'Incapacité déclarée'}</Text>
                </Pressable>)}</View>
              <Input label="Votre lien déclaré avec la personne" value={relationship} onChangeText={value=>{interaction.current++; setRelationship(value);}} multiline maxLength={300} disabled={!ready || working} />
              <Input label="Votre qualité ou pouvoir déclaré pour cette demande" value={authorityStatement} onChangeText={value=>{interaction.current++; setAuthorityStatement(value);}} multiline maxLength={2000} disabled={!ready || working} />
            </> : null}
          </View> : null}
          {kind === 'commercial_late' && !hasIncidentContext && !hasReturnContext && !hasLateContext ? <>
            <Text style={styles.body}>Un problème lors d’une remise en main propre ?</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Cause liée à la rencontre" style={styles.section}>{(Object.keys(MEETUP_SUPPORT_LABELS) as MeetupSupportReason[]).map(value =>
              <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: meetupReason === value, disabled: working || !ready}}
                disabled={working || !ready} style={[styles.choice, meetupReason === value && styles.selected]} onPress={() => {interaction.current++;setMeetupReason(value);}}><Text style={styles.body}>{MEETUP_SUPPORT_LABELS[value]}</Text></Pressable>)}</View>
            {meetupReason ? <>
              <Button variant="ghost" disabled={working || !ready} onPress={() => {interaction.current++;setMeetupReason(undefined);}}>Demande liée à une commande sans cause de rencontre</Button>
            </> : null}
          </> : null}
          {hasLateContext ? <Text accessibilityRole={qualifiedLate ? undefined : 'alert'} style={styles.body}>{qualifiedLate ? 'Votre signalement concernant l’article est joint à cette demande.' : 'Impossible de vérifier le signalement. Revenez à l’article pour le sélectionner à nouveau.'}</Text> : null}
          <Input label="Comment pouvons-nous vous aider ?" value={narrative} onChangeText={value => {interaction.current++; setNarrative(value);}} multiline maxLength={4000} disabled={!ready || working} />
          <Text style={styles.caption}>N’ajoutez pas de coordonnées bancaires ni de pièces d’identité ici.</Text>
          {isPrivacy ? <SupportPrivacyScopeFields key={scope} value={privacyScope} onChange={value=>{try {context.capture(); interaction.current++;setPrivacyScope(value);} catch { /* Superseded owner or route. */ }}} disabled={!ready || working} /> : null}
          <Pressable accessibilityRole="button" accessibilityState={{expanded: detailsScope === scope}} style={styles.menuRow}
            disabled={!ready || working} onPress={() => {try {context.capture(); setDetailsScope(detailsScope === scope ? null : scope);} catch {/* Inactive visit. */}}}>
            <Text style={styles.menuLabel}>Ajouter des dates (facultatif)</Text><Ionicons name={detailsScope === scope ? 'chevron-up' : 'chevron-down'} size={sizing.iconSM} color={colors.muted}/>
          </Pressable>
          {detailsScope === scope ? <View style={styles.section}>
            <Input label="Date de découverte (AAAA-MM-JJ)" value={discovered} onChangeText={value => {interaction.current++; setDiscovered(value);}} maxLength={10} disabled={!ready || working} />
            <Input label="Date d’interruption (AAAA-MM-JJ)" value={interrupted} onChangeText={value => {interaction.current++; setInterrupted(value);}} maxLength={10} disabled={!ready || working} />
          </View> : null}
          <Button disabled={!ready || working || !kind || !narrative.trim() || kind === 'commercial_late' && !transactionId.trim() ||
            isPrivacy && privacyScope !== null && !privacyScope.categories.length ||
            hasSwapDecisionContext && (!qualifiedSwapDecision || !swapDecisionReference || params.transactionId !== undefined || hasIncidentContext || hasReturnContext || hasLateContext || !!meetupReason || params.withdrawalRequestId !== undefined) ||
            hasIncidentContext && !qualifiedIncident ||
            hasLateContext && (!qualifiedLate || hasIncidentContext || hasReturnContext || !!meetupReason) ||
            hasReturnContext && (!qualifiedReturn || hasIncidentContext) ||
            isSwapAssistance && (!swapId.trim() || swapId.trim().includes('/')) ||
            isWithdrawalAssistance && !/^[A-Za-z0-9_-]{1,200}$/.test(withdrawalRequestId.trim()) ||
            isAccountKind && !validDeclaredAccounts || kind === 'representation_review' && (!representationReason || !relationship.trim() || !authorityStatement.trim())}
            loading={working} onPress={() => {void perform('submit');}}>Envoyer ma demande</Button>
        </View>}
        <Pressable accessibilityRole="button" style={styles.menuRow} disabled={!uid || working} onPress={() => openFollowUp(null)}>
          <Text style={styles.menuLabel}>Autres démarches et suivis</Text><Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
        </Pressable>
        <View style={styles.listHeading}><Text accessibilityRole="header" style={styles.title}>Mes demandes</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Actualiser mes demandes" style={styles.iconButton} disabled={!uid || working} onPress={() => {try {context.capture(); void refresh();} catch {/* Inactive visit. */}}}>
            <Ionicons name="refresh-outline" size={sizing.iconSM} color={colors.foreground}/>
          </Pressable>
        </View>
        {list.isError ? <Text style={styles.body}>Impossible de charger vos demandes. Réessayez.</Text> : null}
      </View>}
      ListEmptyComponent={<Text style={styles.body}>{list.isPending || list.isFetching ? 'Chargement…' : list.isError ? '' : 'Aucune demande pour le moment.'}</Text>}
      ListFooterComponent={list.hasNextPage ? <Button variant="ghost" disabled={list.isFetchingNextPage} onPress={() => {try {context.capture(); void list.fetchNextPage();} catch {/* Inactive visit. */}}}>Voir les demandes précédentes</Button> : null} />
    <Modal visible={orderPickerOpen} presentationStyle="pageSheet" animationType="slide" onRequestClose={() => setOrderPickerScope(null)}>
      <SafeAreaProvider><View style={styles.container}><ScreenHeader title="Choisir une commande" onBack={() => setOrderPickerScope(null)}/>
        <FlashList data={orderChoiceItems} keyExtractor={orderKeyExtractor} renderItem={renderOrderChoice} contentContainerStyle={styles.content}
          ListHeaderComponent={<View style={styles.section}><Text style={styles.body}>Vos achats et ventes récents</Text>
            {orderChoices.isError ? <><Text style={styles.body}>Impossible de charger vos commandes.</Text><Button onPress={() => {try {context.capture(); void orderChoices.refetch();} catch {/* Inactive visit. */}}}>Réessayer</Button></> : null}
          </View>}
          ListEmptyComponent={<Text style={styles.body}>{orderChoices.isPending || orderChoices.isFetching ? 'Chargement…' : orderChoices.isError ? '' : 'Aucun achat ni vente récent.'}</Text>}/>
      </View></SafeAreaProvider>
    </Modal>
    <Modal visible={!!uid && currentFollowUp !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={() => setFollowUp(null)}>
      <SafeAreaProvider><View style={styles.container}><ScreenHeader title={currentFollowUp?.flow ? followUps[currentFollowUp.flow] : 'Autres démarches'}
        onBack={() => currentFollowUp?.flow ? openFollowUp(null) : setFollowUp(null)}/>
        <ScrollView contentContainerStyle={styles.content}>
          {currentFollowUp?.flow === null ? (Object.keys(followUps) as FollowUp[]).map(flow => <Pressable key={flow} accessibilityRole="button" style={styles.menuRow} onPress={() => openFollowUp(flow)}>
            <Text style={styles.menuLabel}>{followUps[flow]}</Text><Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
          </Pressable>) : null}
          {uid && currentFollowUp?.flow === 'transport' ? <LateTransportRecoveryJournal uid={uid} scope="owner"/> : null}
          {uid && currentFollowUp?.flow === 'accounts' ? <AccountRelationshipJournal uid={uid} scope="own"/> : null}
          {uid && currentFollowUp?.flow === 'confidentialReview' ? <SupportLegalReviewJournal uid={uid} area="confidential_original"/> : null}
          {uid && currentFollowUp?.flow === 'authority' ? <SupportLegalReviewJournal uid={uid} area="authority_request"/> : null}
          {uid && currentFollowUp?.flow === 'privacy' ? <PrivacyOperationsJournal uid={uid}/> : null}
          {uid && currentFollowUp?.flow === 'continuity' ? <BusinessCessationHistory key={scope} uid={uid} access="owner"/> : null}
          {uid && currentFollowUp?.flow === 'confidentiality' ? <SupportConfidentialityPanel uid={uid} scope="owner" supportRequestId={null} sourceKey={scope} pending={pending}/> : null}
        </ScrollView>
      </View></SafeAreaProvider>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({ container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md}, section: {gap: spacing.md, marginBottom: spacing.md},
  card: {padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  rowContent: {flex: 1, gap: spacing.xs}, menuLabel: {...typography.bodySmall, color: colors.foreground, flex: 1},
  menuRow: {minHeight: sizing.minTouchTarget, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  requestRow: {minHeight: sizing.minTouchTarget, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  listHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  iconButton: {minHeight: sizing.minTouchTarget, minWidth: sizing.minTouchTarget, alignItems: 'center', justifyContent: 'center'},
  choice: {padding: spacing.sm, minHeight: sizing.minTouchTarget, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  selected: {borderBottomColor: colors.primary} });
