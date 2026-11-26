/**
 * Admin Panel — Disputes Review + Resolution (F27/F88 + F10 + F26 + F48)
 *
 * Liste les litiges (`disputes/{id}`) ouverts par les callables serveur
 * (`reportTransactionProblem` / `reportMeetupNoShow`, Admin SDK + runTransaction).
 * Un litige gèle la transaction sous-jacente (`disputed=true`) : sans résolution
 * admin, ces transactions ET la suppression de compte des deux parties restaient
 * gelées indéfiniment. Cet écran RÉSOUT désormais les litiges.
 *
 * SÉCURITÉ / RÔLES : la lecture des `disputes` est autorisée aux admins par
 * firestore.rules (request.auth.token.admin). Aucun write client n'est permis
 * (creation/update/delete: false) — la RÉSOLUTION passe EXCLUSIVEMENT par des
 * callables serveur admin-only (double garde) :
 *   - `adminRefundTransaction` → réserve l'instruction du dossier exact puis
 *                                distingue le règlement financier confirmé,
 *   - `resolveDispute`         → classe le dossier exact, avec ses obligations
 *                                conservées et sans remise en vente,
 *   - `resolveSwapDispute`     → revue documentaire Troc liée aux sources natives,
 *                                avec journal durable et deux avis distincts ;
 *                                aucune permission de règlement, de remise en
 *                                vente ou de clôture ne découle de ce reçu.
 *
 * Suit les conventions de app/admin/reports.tsx (état local, FlashList,
 * Skeleton, tokens DS, useUser, défense en profondeur). L'accès admin est
 * garanti par app/admin/_layout.tsx (vérification re-jouée ici par cohérence).
 */

import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { firestore } from '@/config/firebaseConfig';
import { APP_LOCALE } from '@/constants/locale';
import { useAuthenticatedUid, useUser } from '@/hooks/useAuth';
import { TransactionService } from '@/services/transactionService';
import { requireAdminClaim } from '@/services/adminFinancialService';
import { SupportRequestService, supportCommandHash } from '@/services/supportRequestService';
import { readDisputeResolutionAttempts, acknowledgeDisputeResolution, runDisputeResolution,
  type DisputeResolutionAttempt, type DisputeResolutionOutcome } from '@/services/disputeResolutionJournal';
import { readAdminFinancialAttempts, acknowledgeAdminFinancialAttempt, adminReturnToSenderFinancialReference, adminTransportFinancialReference, type AdminFinancialPreview,
  type AdminFinancialAttempt, type AdminFinancialDecision } from '@/services/adminFinancialDecisionJournal';
import { readCashCaseAttempts, acknowledgeCashCaseAttempt, type CashCasePreview, type CashCaseAttempt, type CashCaseDecision } from '@/services/cashCaseDecisionJournal';
import { formatPrice } from '@/utils/formatPrice';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { randomUUID } from 'expo-crypto';
import { Button, Checkbox } from '@/components/ui';
import { RefundStatusNotice } from '@/components/RefundStatusNotice';
import { BankDisputeCommandHistory } from '@/components/BankDisputeCommandHistory';
import { BankRefundReconciliationCommandHistory } from '@/components/BankRefundReconciliationCommandHistory';
import { SwapDisputeReviewCommandHistory } from '@/components/SwapDisputeReviewCommandHistory';
import { createBankDisputeCaseInteraction } from '@/utils/bankDisputeCaseContract';
import { getFinancialErrorMessage, hasBankObligation, hasUnsettledRefund, refundResultPresentation } from '@/utils/refundPresentation';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  collection,
  getDocsFromServer,
  limit as fbLimit,
  orderBy,
  documentId,
  startAfter,
  where,
  query,
} from 'firebase/firestore';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { AdminSectionNav, AdminFinancialQueue, AdminReturnToSenderFinancialEntry, AdminReturnToSenderFinancialReview,
  AdminExceptionalRestitutionHistory, AdminOrphanCaptureRefundHistory,
  AdminFinancialReauthentication, AdminTransportFinancialEntry, AdminTransportFinancialReview, AdminTransportFinancialHistory,
  AdminParcelClaimHistoryPanel, AdminProductFinancialEntry, AdminProductFinancialHistory, AdminPurchaseRefundEntry, AdminPurchaseRefundHistory, AdminRefundRepairHistory, AdminBankDisputeCases, AdminSwapDisputeReview } from '@/features/admin';
import type { AdminReturnToSenderFinancialResume } from '@/types/adminReturnToSenderFinancial';
import type { WholeSetDeclaration, WholeSetReportSource } from '@/types/transactionProblem';
import { isWholeSetDeclaration } from '@/services/transactionProblemJournal';
import { isProductAuthenticityReportReference } from '@/services/productAuthenticityReportService';
import { isProductParcelReportReference } from '@/utils/productParcelReportReference';
import { productFinancialCaseId } from '@/services/adminProductFinancialSource';
import type { ProductAuthenticityReportReference } from '@/types/productAuthenticityReport';
import type { ProductParcelReportReference } from '@/types/productParcelReport';

// =============================================================================
// TYPES (Firestore `disputes` doc — see functions/src/callable/payments.ts,
// functions/src/callable/recourse.ts)
// =============================================================================

type DisputeStatus = 'open' | 'resolved' | 'dismissed' | string;

interface Dispute {
  id: string;
  transactionId: string | null;
  type: string | null;
  source?: string | null;
  transportReviewId?: string | null;
  buyerId: string | null;
  sellerId: string | null;
  articleId: string | null;
  articleTitle: string | null;
  reportedBy: string | null;
  reportedAgainst: string | null;
  reason: string | null;
  details: string | null;
  status: DisputeStatus;
  statusBeforeDispute: string | null;
  createdAt: Date | null;
  counterReportedBy: string | null;
  counterReason: string | null;
  counterDetails: string | null;
  counterReportedAt: Date | null;
  wholeSetComplaint?: {declaration: WholeSetDeclaration; contract: NonNullable<WholeSetReportSource['source']>} | null;
  authenticityComplaint?: ProductAuthenticityReportReference | ProductParcelReportReference | null;
}

/** Native complaint projection only; no mutable listing or financial authority. */
async function wholeSetComplaint(data: Record<string, unknown>, disputeId: string): Promise<Dispute['wholeSetComplaint']> {
  if (!Object.prototype.hasOwnProperty.call(data, 'setDeclaration') && !Object.prototype.hasOwnProperty.call(data, 'setContract')) return undefined;
  const d = data.setDeclaration, c = data.setContract;
  if (!isWholeSetDeclaration(d) || !c || typeof c !== 'object' || Array.isArray(c) || data.reason !== 'not_as_described' ||
    data.physicalReceiptVerified !== false || data.faultEstablished !== false || data.recourseScope !== 'whole_transaction' ||
    typeof data.buyerId !== 'string' || data.reportOwnerId !== data.buyerId || typeof data.reportRequestId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(data.reportRequestId) || typeof data.transactionId !== 'string') return null;
  const s = c as Record<string, unknown>;
  if (Object.keys(s).length !== 5 || Object.keys(s).some(k => !['snapshotHash', 'articleId', 'saleUnit', 'title', 'description'].includes(k)) ||
    s.snapshotHash !== d.snapshotHash || s.articleId !== data.articleId || s.saleUnit !== 'set_as_one' ||
    typeof s.title !== 'string' || !s.title.trim() || s.title.length > 500 || typeof s.description !== 'string' || !s.description.trim() || s.description.length > 8000 ||
    data.details !== undefined && (typeof data.details !== 'string' || data.details !== data.details.trim() || data.details.length > 1000)) return null;
  const [nativeId, payloadHash] = await Promise.all([supportCommandHash([data.buyerId, data.transactionId, data.reportRequestId]),
    supportCommandHash({reason: data.reason, details: data.details || null, setDeclaration: d,
      ...(isProductAuthenticityReportReference(data.productReview) ? {productReview: data.productReview} : {})})]);
  if (data.productReview !== undefined && !isProductAuthenticityReportReference(data.productReview)) return null;
  if (disputeId !== `problem_${nativeId}` || data.reportPayloadHash !== payloadHash) return null;
  return {declaration: d, contract: s as unknown as NonNullable<WholeSetReportSource['source']>};
}

const DISPUTES_PAGE_SIZE = 50;
const EMPTY_DISMISS_ATTEMPTS: DisputeResolutionAttempt[] = [];
const EMPTY_FINANCIAL_ATTEMPTS: AdminFinancialAttempt[] = [];
const EMPTY_CASH_ATTEMPTS: CashCaseAttempt[] = [];

// =============================================================================
// HELPERS
// =============================================================================

const DISPUTE_TYPE_LABELS: Record<string, string> = {
  meetup_no_show: 'Rencontre manquée',
  transaction_problem: 'Problème de transaction',
  carrier_exception: 'Exception du transporteur',
};

const DISPUTE_REASON_LABELS: Record<string, string> = {
  not_received: 'Article non reçu',
  not_received_despite_delivered: 'Colis indiqué livré mais non reçu',
  not_as_described: 'Non conforme à la description',
  damaged: 'Article endommagé',
  counterfeit: 'Contrefaçon suspectée',
  other_party_no_show: "L'autre partie ne s'est pas présentée",
  cancelled_last_minute: 'Annulation de dernière minute',
  unsafe_situation: 'Situation dangereuse',
  other: 'Autre',
};

function formatDisputeType(type: string | null): string {
  if (type && type in DISPUTE_TYPE_LABELS) return DISPUTE_TYPE_LABELS[type];
  return 'Litige';
}

function formatReason(reason: string | null): string {
  if (reason && reason in DISPUTE_REASON_LABELS) return DISPUTE_REASON_LABELS[reason];
  return 'Raison non précisée';
}

function formatStatus(status: DisputeStatus): string {
  switch (status) {
    case 'open':
      return 'Ouvert';
    case 'resolved':
      return 'Résolu';
    case 'dismissed':
      return 'Rejeté';
    default:
      return status;
  }
}

function formatDate(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(APP_LOCALE, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// =============================================================================
// SCREEN
// =============================================================================

type TabType = 'open' | 'all' | 'swaps' | 'refunds' | 'captures' | 'bank';

export default function AdminDisputesScreen() {
  const router = useRouter();
  const user = useUser();
  const sdkUid = useAuthenticatedUid();
  const actorUid = user?.id === sdkUid ? sdkUid : null;
  const generation = getAuthSessionGeneration();
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState<TabType>('open');
  const bankFrame = useLabelLifecycleContext(`admin-bank-cases:${selectedTab}`, sdkUid);
  const bankNativeFrame = useShippingPurchaseContext(`admin-bank-native:${selectedTab}`, sdkUid);
  const [bankInteraction] = useState(createBankDisputeCaseInteraction);
  const [bankRevision, setBankRevision] = useState(0);
  const bankChoice = bankInteraction.capture();
  const bankSourceKey = JSON.stringify([sdkUid, generation, selectedTab, bankNativeFrame.focusRevision, bankRevision]);
  const assertBankSelection = () => {bankFrame.capture(); bankChoice();};
  const parcelHistoryContext = useLabelLifecycleContext(`admin-parcel-claim-history:${selectedTab}`, actorUid);
  const parcelHistoryEpoch = useRef(0);
  const parcelHistoryScope = JSON.stringify([actorUid, generation, selectedTab, parcelHistoryContext.focusRevision]);
  const parcelHistoryAuthority = useRef({allowed: false, scope: parcelHistoryScope});
  const [parcelHistorySelection, setParcelHistorySelection] = useState<{scope: string; transactionId: string; disputeId: string; nonce: string; assertSelection: () => void} | null>(null);

  const [productSelection, setProductSelection] = useState<{transactionId: string; disputeId: string; nonce: string; topic: 'authenticity' | 'nonconformity' | 'parcel_delivery'} | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const dismissOwnsAction = useRef(false);
  useFocusEffect(useCallback(() => () => {
    if (dismissOwnsAction.current) {
      dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null);
    }
  }, [selectedTab, actorUid]));
  const dismissContext = useShippingPurchaseContext(`admin-dismiss:${selectedTab}`, actorUid);
  const dismissScope = JSON.stringify([actorUid, generation, selectedTab, dismissContext.focusRevision]);
  const admin = useQuery({queryKey: ['admin-access', actorUid, generation, selectedTab, dismissContext.focusRevision],
    queryFn: async () => {const operation = dismissContext.capture(); const allowed = await requireAdminClaim(operation.session.uid, true);
      dismissContext.assertCurrent(operation); if (!allowed) return false;
      await SupportRequestService.list(operation.session.uid, 'admin', undefined, () => dismissContext.assertCurrent(operation));
      dismissContext.assertCurrent(operation); return true;}, enabled: !!actorUid && dismissContext.focused, staleTime: 0, gcTime: 0, retry: false});
  const isAdmin = !!actorUid && dismissContext.focused && !admin.isError && !admin.isFetching && admin.data === true;
  useLayoutEffect(() => {
    parcelHistoryAuthority.current = {allowed: isAdmin, scope: parcelHistoryScope};
    return () => {parcelHistoryAuthority.current = {allowed: false, scope: ''};};
  }, [isAdmin, parcelHistoryScope]);
  const openParcelClaimHistory = useCallback((dispute: Dispute) => {
    if (!isAdmin || !dispute.transactionId || dispute.reason !== 'not_received_despite_delivered') return;
    try {
      const operation = parcelHistoryContext.capture(), epoch = ++parcelHistoryEpoch.current;
      const assertSelection = () => {
        parcelHistoryContext.assertCurrent(operation);
        if (parcelHistoryEpoch.current !== epoch || !parcelHistoryAuthority.current.allowed || parcelHistoryAuthority.current.scope !== parcelHistoryScope)
          throw new Error('Le dossier sélectionné ou l’habilitation ont changé.');
      };
      assertSelection();
      setParcelHistorySelection({scope: parcelHistoryScope, transactionId: dispute.transactionId, disputeId: dispute.id, nonce: randomUUID(), assertSelection});
    } catch { /* A stale card grants no private comparative read. */ }
  }, [isAdmin, parcelHistoryContext, parcelHistoryScope]);

  const pendingDismissQuery = useQuery({ queryKey: ['admin-dispute-decision', actorUid, generation, selectedTab, dismissContext.focusRevision],
    enabled: isAdmin && dismissContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {
      const operation = dismissContext.capture();
      return readDisputeResolutionAttempts(operation.session.uid, () => dismissContext.assertCurrent(operation));
    },
  });
  const pendingFinancialQuery = useQuery({ queryKey: ['admin-financial-decision', actorUid, generation, selectedTab, dismissContext.focusRevision],
    enabled: isAdmin && dismissContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {
      const operation = dismissContext.capture();
      return readAdminFinancialAttempts(operation.session.uid, () => dismissContext.assertCurrent(operation));
    },
  });
  const pendingCashQuery = useQuery({ queryKey: ['admin-cash-case-decision', actorUid, generation, selectedTab, dismissContext.focusRevision],
    enabled: isAdmin && dismissContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {
      const operation = dismissContext.capture();
      return readCashCaseAttempts(operation.session.uid, () => dismissContext.assertCurrent(operation));
    },
  });
  const [cashDraft, setCashDraft] = useState<{ scope: string; dispute: Dispute; requestId: string; note: string; confirmed: boolean; preview: CashCasePreview } | null>(null);
  const [cashResult, setCashResult] = useState<{ scope: string; attempt: CashCaseAttempt; receipt: CashCaseDecision } | null>(null);
  const [dismissDraft, setDismissDraft] = useState<{ scope: string; dispute: Dispute; requestId: string; note: string; confirmed: boolean; preview: AdminFinancialPreview } | null>(null);
  const [financialDraft, setFinancialDraft] = useState<{ scope: string; dispute: Pick<Dispute, 'id' | 'transactionId'>; requestId: string; note: string; cause: string;
    humanExamined: boolean; reauthenticated: boolean; confirmed: boolean; preview: AdminFinancialPreview } | null>(null);
  const [financialResult, setFinancialResult] = useState<{ scope: string; attempt: AdminFinancialAttempt; receipt: AdminFinancialDecision } | null>(null);
  const [dismissResult, setDismissResult] = useState<{ scope: string; attempt: DisputeResolutionAttempt; receipt: DisputeResolutionOutcome } | null>(null);
  const [dismissNotice, setDismissNotice] = useState<{ scope: string; text: string } | null>(null);
  const pendingDismisses = isAdmin && !pendingDismissQuery.isError && !pendingDismissQuery.isFetching ? pendingDismissQuery.data ?? EMPTY_DISMISS_ATTEMPTS : EMPTY_DISMISS_ATTEMPTS;
  const pendingFinancial = isAdmin && !pendingFinancialQuery.isError && !pendingFinancialQuery.isFetching ? pendingFinancialQuery.data ?? EMPTY_FINANCIAL_ATTEMPTS : EMPTY_FINANCIAL_ATTEMPTS;
  const pendingCash = isAdmin && !pendingCashQuery.isError && !pendingCashQuery.isFetching ? pendingCashQuery.data ?? EMPTY_CASH_ATTEMPTS : EMPTY_CASH_ATTEMPTS;
  const journalsUnavailable = !isAdmin || pendingDismissQuery.isPending || pendingDismissQuery.isError || pendingDismissQuery.isFetching ||
    pendingFinancialQuery.isPending || pendingFinancialQuery.isError || pendingFinancialQuery.isFetching || pendingCashQuery.isPending || pendingCashQuery.isError || pendingCashQuery.isFetching;
  const currentDraft = isAdmin && dismissDraft?.scope === dismissScope ? dismissDraft : null;
  const currentResult = isAdmin && dismissResult?.scope === dismissScope ? dismissResult : null;
  const currentFinancialDraft = isAdmin && financialDraft?.scope === dismissScope ? financialDraft : null;
  const currentFinancialResult = isAdmin && financialResult?.scope === dismissScope ? financialResult : null;
  const currentCashDraft = isAdmin && cashDraft?.scope === dismissScope ? cashDraft : null;
  const currentCashResult = isAdmin && cashResult?.scope === dismissScope ? cashResult : null;
  const disputeQuery = useInfiniteQuery({
    queryKey: ['admin', actorUid, generation, dismissContext.focusRevision, 'disputes', selectedTab], initialPageParam: null as string | null,
    enabled: isAdmin && (selectedTab === 'open' || selectedTab === 'all'), staleTime: 0, gcTime: 0, retry: false,
    queryFn: async ({pageParam}) => {
      const operation = dismissContext.capture();
      const snapshot = await getDocsFromServer(query(collection(firestore, 'disputes'),
        ...(selectedTab === 'open' ? [where('status', '==', 'open')] : []),
        // ID order is pagination only; it does not establish creation chronology.
        orderBy(documentId(), selectedTab === 'open' ? 'desc' : 'asc'), ...(pageParam ? [startAfter(pageParam)] : []), fbLimit(DISPUTES_PAGE_SIZE)));
      dismissContext.assertCurrent(operation);
      if (!await requireAdminClaim(operation.session.uid, true)) throw new Error('Accès administrateur requis.');
      dismissContext.assertCurrent(operation);
      const items: Dispute[] = await Promise.all(snapshot.docs.map(async docSnapshot => {
        const data = docSnapshot.data();
        const text = (field: string) => typeof data[field] === 'string' ? data[field] : null;
        return {id: docSnapshot.id, transactionId: text('transactionId'), type: text('type'), source: text('source'), transportReviewId: text('transportReviewId'), buyerId: text('buyerId'), sellerId: text('sellerId'),
          articleId: text('articleId'), articleTitle: text('articleTitle'), reportedBy: text('reportedBy'), reportedAgainst: text('reportedAgainst'),
          reason: text('reason'), details: text('details'), status: text('status') ?? 'open', statusBeforeDispute: text('statusBeforeDispute'), createdAt: data.createdAt?.toDate?.() ?? null,
          counterReportedBy: text('counterReportedBy'), counterReason: text('counterReason'), counterDetails: text('counterDetails'), counterReportedAt: data.counterReportedAt?.toDate?.() ?? null,
          wholeSetComplaint: await wholeSetComplaint(data, docSnapshot.id), authenticityComplaint: data.productReview === undefined ? undefined :
            (isProductAuthenticityReportReference(data.productReview) || isProductParcelReportReference(data.productReview)) && typeof data.transactionId === 'string' && data.productReview.caseId === await productFinancialCaseId(data.transactionId) ? data.productReview : null};
      }));
      dismissContext.assertCurrent(operation);
      return {items, cursor: snapshot.docs.at(-1)?.id ?? null, hasMore: snapshot.docs.length === DISPUTES_PAGE_SIZE};
    }, getNextPageParam: page => page.hasMore ? page.cursor : undefined,
  });
  const disputes = isAdmin && !disputeQuery.isError && !disputeQuery.isFetching ? [...new Map((disputeQuery.data?.pages.flatMap(page => page.items) ?? []).map(d => [d.id, d])).values()] : [];
  const isLoading = disputeQuery.isLoading || disputeQuery.isFetching;
  const loadDisputes = useCallback(async (_tab?: TabType) => {await queryClient.invalidateQueries({queryKey: ['admin']});}, [queryClient]);

  const openDecisionPreview = useCallback(async (dispute: Dispute, decisionType: AdminFinancialPreview['decisionType']) => {
    if (!user || !isAdmin || actionInFlight.current || !dispute.transactionId || journalsUnavailable ||
        pendingDismisses.some(a => a.transactionId === dispute.transactionId) || pendingFinancial.some(a => a.transactionId === dispute.transactionId) ||
        pendingCash.some(a => a.transactionId === dispute.transactionId)) return;
    let operation;
    try { operation = dismissContext.start(); } catch { return; }
    if (!operation) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(dispute.id);
    setDismissDraft(null); setFinancialDraft(null); setDismissResult(null); setFinancialResult(null); setDismissNotice(null);
    try {
      const preview = await TransactionService.previewAdminFinancialDecision(dispute.transactionId, dispute.id, operation.session.uid,
        decisionType, () => dismissContext.assertCurrent(operation!));
      dismissContext.assertCurrent(operation);
      const draft = { scope: dismissScope, dispute, requestId: randomUUID(), note: '', confirmed: false, preview };
      if (decisionType === 'dismissed') setDismissDraft(draft); else setFinancialDraft({...draft, cause: '', humanExamined: false, reauthenticated: false});
    } catch (error) {
      if (dismissContext.isCurrent(operation)) setDismissNotice({ scope: dismissScope, text: getFinancialErrorMessage(error) });
    } finally {
      dismissContext.finish(operation);
      if (dismissContext.isCurrent(operation)) { dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null); }
    }
  }, [user, isAdmin, journalsUnavailable, pendingDismisses, pendingFinancial, pendingCash, dismissContext, dismissScope]);

  const openReturnToSenderFinancialPreview = useCallback(async (transactionId: string, caseId: string, resume?: AdminReturnToSenderFinancialResume) => {
    if (!actorUid || !isAdmin || actionInFlight.current || journalsUnavailable ||
      [...pendingDismisses, ...pendingFinancial, ...pendingCash].some(attempt => attempt.transactionId === transactionId)) return;
    let operation; try {operation = dismissContext.start();} catch {return;} if (!operation) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(caseId);
    setFinancialDraft(null); setFinancialResult(null); setDismissDraft(null); setDismissResult(null); setCashDraft(null); setCashResult(null); setDismissNotice(null);
    try {
      const preview = await TransactionService.previewAdminFinancialDecision(transactionId, caseId, operation.session.uid, 'refund_without_return',
        () => dismissContext.assertCurrent(operation!), 'return_to_sender_cases', resume);
      dismissContext.assertCurrent(operation);
      setFinancialDraft({scope: dismissScope, dispute: {id: caseId, transactionId}, requestId: randomUUID(), note: '', cause: '', humanExamined: false, reauthenticated: false, confirmed: false, preview});
    } catch (error) {
      if (dismissContext.isCurrent(operation)) setDismissNotice({scope: dismissScope, text: getFinancialErrorMessage(error)});
    } finally {
      dismissContext.finish(operation);
      if (dismissContext.isCurrent(operation)) {dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null);}
    }
  }, [actorUid, isAdmin, journalsUnavailable, pendingDismisses, pendingFinancial, pendingCash, dismissContext, dismissScope]);

  const openTransportFinancialPreview = useCallback(async (transactionId: string, reviewId: string, disputeId: string, resume?: AdminReturnToSenderFinancialResume) => {
    if (!actorUid || !isAdmin || actionInFlight.current || journalsUnavailable || [...pendingDismisses, ...pendingFinancial, ...pendingCash].some(a => a.transactionId === transactionId)) return;
    let op; try {op = dismissContext.start();} catch {return;} if (!op) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(reviewId); setFinancialDraft(null); setFinancialResult(null); setDismissDraft(null); setDismissResult(null); setCashDraft(null); setCashResult(null); setDismissNotice(null);
    try {const preview = await TransactionService.previewAdminFinancialDecision(transactionId, disputeId, op.session.uid, 'refund_without_return', () => dismissContext.assertCurrent(op), 'transport_review', resume, reviewId);
      dismissContext.assertCurrent(op); setFinancialDraft({scope: dismissScope, dispute: {id: disputeId, transactionId}, requestId: randomUUID(), note: '', cause: '', humanExamined: false, reauthenticated: false, confirmed: false, preview});
    } catch (error) {if (dismissContext.isCurrent(op)) setDismissNotice({scope: dismissScope, text: getFinancialErrorMessage(error)});}
    finally {dismissContext.finish(op); if (dismissContext.isCurrent(op)) {dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null);}}
  }, [actorUid, isAdmin, journalsUnavailable, pendingDismisses, pendingFinancial, pendingCash, dismissContext, dismissScope]);

  const openCashPreview = useCallback(async (dispute: Dispute) => {
    if (!user || !isAdmin || actionInFlight.current || !dispute.transactionId || journalsUnavailable ||
        pendingDismisses.some(a => a.transactionId === dispute.transactionId) || pendingFinancial.some(a => a.transactionId === dispute.transactionId) ||
        pendingCash.some(a => a.transactionId === dispute.transactionId)) return;
    let operation;
    try { operation = dismissContext.start(); } catch { return; }
    if (!operation) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(dispute.id);
    setCashDraft(null); setCashResult(null); setDismissDraft(null); setFinancialDraft(null); setDismissNotice(null);
    try {
      const preview = await TransactionService.previewCashCase(dispute.transactionId, dispute.id, operation.session.uid, () => dismissContext.assertCurrent(operation!));
      dismissContext.assertCurrent(operation);
      setCashDraft({ scope: dismissScope, dispute, requestId: randomUUID(), note: '', confirmed: false, preview });
    } catch (error) {
      if (dismissContext.isCurrent(operation)) setDismissNotice({ scope: dismissScope, text: getFinancialErrorMessage(error) });
    } finally {
      dismissContext.finish(operation);
      if (dismissContext.isCurrent(operation)) { dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null); }
    }
  }, [user, isAdmin, journalsUnavailable, pendingDismisses, pendingFinancial, pendingCash, dismissContext, dismissScope]);

  // Cash closure has no refund. Paid decisions require a native preview first.
  const handleRefundBuyer = useCallback(
    (dispute: Dispute) => {
      if (!dispute.transactionId) {
        Alert.alert('Action impossible', 'Ce litige n’est lié à aucune transaction.');
        return;
      }
      if (dispute.authenticityComplaint !== undefined) {
        if (dispute.authenticityComplaint) {setProductSelection({transactionId: dispute.transactionId, disputeId: dispute.id, nonce: randomUUID(), topic: dispute.authenticityComplaint.topic});
          Alert.alert('Dossier produit sélectionné', 'La commande et le litige exacts sont préparés dans le bloc financier correspondant au sujet déclaré, en tête de liste. Relisez son aperçu avant toute décision.');}
        else Alert.alert('Liaison à qualifier', 'Cette liaison historique ne peut pas être qualifiée. Relisez le dossier produit et ses sources avant une nouvelle instruction.');
        return;
      }
      if (dispute.source === 'system_transport_review' && dispute.type === 'carrier_exception' && /^case_[a-f0-9]{64}$/.test(dispute.transportReviewId ?? '')) {
        void openTransportFinancialPreview(dispute.transactionId, dispute.transportReviewId!, dispute.id); return;
      }
      if (dispute.type !== 'meetup_no_show') { void openDecisionPreview(dispute, 'refund_without_return'); return; }
      void openCashPreview(dispute);
    },
    [openDecisionPreview, openCashPreview, openTransportFinancialPreview, setProductSelection],
  );

  const handleResolveForSeller = useCallback((dispute: Dispute) => {
    if (dispute.authenticityComplaint !== undefined && dispute.transactionId) {
      if (dispute.authenticityComplaint) {setProductSelection({transactionId: dispute.transactionId, disputeId: dispute.id, nonce: randomUUID(), topic: dispute.authenticityComplaint.topic});
        Alert.alert('Dossier produit sélectionné', 'Examinez le classement distinct dans le bloc financier correspondant au sujet déclaré, en tête de liste.');}
      else Alert.alert('Liaison à qualifier', 'Relisez le dossier produit et ses sources avant une nouvelle instruction.');
      return;
    }
    if (dispute.source === 'system_transport_review' && dispute.transactionId) {router.push({pathname: '/admin/transport-reviews', params: {transactionId: dispute.transactionId}} as never); return;}
    void openDecisionPreview(dispute, 'dismissed');
  }, [openDecisionPreview, router, setProductSelection]);

  const submitDismissDecision = useCallback(async (attempt: DisputeResolutionAttempt, mode: 'confirm' | 'observe' | 'neutralize' = 'observe') => {
    if (!isAdmin || actionInFlight.current || attempt.adminUid !== user?.id) return;
    let operation;
    try { operation = dismissContext.start(); } catch { return; }
    if (!operation) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(attempt.disputeId);
    try {
      const receipt = await TransactionService.resolveDispute(attempt, () => dismissContext.assertCurrent(operation!), mode);
      dismissContext.assertCurrent(operation);
      setDismissResult({ scope: dismissScope, attempt, receipt });
      setDismissDraft(null);
      setDismissNotice({ scope: dismissScope, text: receipt.outcome === 'unrecorded'
        ? 'Aucun reçu propre n’est encore enregistré. L’intention d’origine reste conservée. Vous pouvez la relire ou demander explicitement sa neutralisation ; cette absence n’autorise aucun renvoi de décision.'
        : receipt.outcome === 'not_executed'
        ? receipt.nonExecutionReason === 'intention_neutralized_before_effects'
          ? 'Votre intention a été neutralisée avant ses effets. Aucune instruction du dossier ni clôture n’est attestée ; une requête tardive avec cette référence reste bloquée.'
          : 'Votre intention n’a pas été exécutée : le dossier était fermé ou les faits avaient changé. Elle est neutralisée, y compris en cas de requête tardive. Aucun fonds ni nouveau dossier n’a été modifié par cette intention.'
        : receipt.orderResolutionCommitted
        ? 'Décision enregistrée pour le dossier ciblé. La disponibilité des fonds et les éventuels autres recours restent distincts.'
        : 'Le dossier ciblé est classé. Des dossiers ou obligations restent ouverts : la commande et ses fonds restent conservés.' });
      await pendingDismissQuery.refetch();
      dismissContext.assertCurrent(operation);
      await loadDisputes();
      dismissContext.assertCurrent(operation);
    } catch {
      if (!dismissContext.isCurrent(operation)) return;
      setDismissDraft(null);
      setDismissNotice({ scope: dismissScope, text: 'Le résultat doit être vérifié avec la même référence et la même note. Aucune autre décision n’a été envoyée.' });
      await pendingDismissQuery.refetch();
    } finally {
      dismissContext.finish(operation);
      // Another focus/action must not be unlocked by this late completion.
      if (dismissContext.isCurrent(operation)) { dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null); }
    }
  }, [isAdmin, user?.id, dismissContext, dismissScope, pendingDismissQuery, loadDisputes]);

  const acknowledgeDismissDecision = useCallback(async () => {
    if (!currentResult || actionInFlight.current) return;
    let operation;
    try { operation = dismissContext.start(); } catch { return; }
    if (!operation) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(currentResult.attempt.disputeId);
    try {
      if (!await requireAdminClaim(operation.session.uid)) throw new Error('Accès administrateur requis.');
      dismissContext.assertCurrent(operation);
      const fresh = await TransactionService.resolveDispute(currentResult.attempt, () => dismissContext.assertCurrent(operation!), 'observe');
      dismissContext.assertCurrent(operation);
      await runDisputeResolution(operation.session.uid, currentResult.attempt.transactionId, () => dismissContext.assertCurrent(operation!),
        () => acknowledgeDisputeResolution(currentResult.attempt, fresh, () => dismissContext.assertCurrent(operation!)));
      dismissContext.assertCurrent(operation);
      setDismissResult(null); setDismissDraft(null); setDismissNotice(null);
      await pendingDismissQuery.refetch();
      dismissContext.assertCurrent(operation);
      await loadDisputes();
    } catch {
      if (dismissContext.isCurrent(operation)) setDismissNotice({ scope: dismissScope, text: 'Le reçu doit être relu avant de terminer ce suivi.' });
    } finally {
      dismissContext.finish(operation);
      if (dismissContext.isCurrent(operation)) { dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null); }
    }
  }, [currentResult, dismissContext, dismissScope, pendingDismissQuery, loadDisputes]);

  const submitFinancialDecision = useCallback(async (attempt: AdminFinancialAttempt, mode: 'confirm' | 'observe' | 'neutralize') => {
    if (!isAdmin || actionInFlight.current || attempt.adminUid !== user?.id) return;
    let operation;
    try { operation = dismissContext.start(); } catch { return; }
    if (!operation) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(attempt.disputeId);
    try {
      const receipt = await TransactionService.adminRefundTransaction(attempt, () => dismissContext.assertCurrent(operation!), mode);
      dismissContext.assertCurrent(operation);
      setFinancialResult({ scope: dismissScope, attempt, receipt }); setFinancialDraft(null);
      setDismissNotice({ scope: dismissScope, text: receipt.outcome === 'unrecorded'
        ? 'Aucun reçu propre n’est encore enregistré. La même intention reste conservée. Sa relecture ou sa neutralisation explicite restent distinctes d’une nouvelle instruction de remboursement.'
        : receipt.outcome === 'not_executed'
        ? receipt.reason === 'intention_neutralized_before_effects'
          ? 'Cette intention a été neutralisée avant ses effets, sans examen du dossier ni réservation financière. Sa requête tardive reste bloquée.'
          : 'Cette intention n’a pas été exécutée : les faits ont changé ou une autre réservation existait. Sa requête tardive reste bloquée.'
        : receipt.resume ? receipt.financial.success
          ? 'L’autorisation de reprise et le règlement de l’intention d’origine sont enregistrés séparément. Aucune deuxième réservation ni remise en vente n’en résulte.'
          : 'L’autorisation humaine de reprise est enregistrée pour la même intention. Son résultat financier et les autres gardes restent distincts.'
        : receipt.financial.success
        ? 'Votre décision et son règlement financier sont confirmés séparément. La remise en vente reste interdite par ce reçu.'
        : 'Votre décision opérateur et sa réservation sont enregistrées. Le règlement financier reste à suivre avec son intention d’origine.' });
      await pendingFinancialQuery.refetch(); dismissContext.assertCurrent(operation);
      await loadDisputes(); dismissContext.assertCurrent(operation);
    } catch (error) {
      if (!dismissContext.isCurrent(operation)) return;
      setFinancialDraft(null);
      const reauthRequired = typeof error === 'object' && error !== null && 'code' in error && error.code === 'client/recent-auth-required';
      setDismissNotice({ scope: dismissScope, text: reauthRequired
        ? 'Votre identité doit être confirmée à nouveau. Aucune nouvelle instruction n’a été envoyée par ce contrôle local ; relisez les sources et vérifiez votre session avant de confirmer.'
        : 'Résultat inconnu : conservez la référence, l’aperçu et la note. Relisez cette intention ; aucune nouvelle confirmation n’est proposée.' });
      await pendingFinancialQuery.refetch();
    } finally {
      dismissContext.finish(operation);
      if (dismissContext.isCurrent(operation)) { dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null); }
    }
  }, [isAdmin, user?.id, dismissContext, dismissScope, pendingFinancialQuery, loadDisputes]);

  const acknowledgeFinancialDecision = useCallback(async () => {
    if (!currentFinancialResult || currentFinancialResult.receipt.outcome === 'unrecorded' || actionInFlight.current) return;
    let operation;
    try { operation = dismissContext.start(); } catch { return; }
    if (!operation) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(currentFinancialResult.attempt.disputeId);
    try {
      const fresh = await TransactionService.adminRefundTransaction(currentFinancialResult.attempt, () => dismissContext.assertCurrent(operation!), 'observe');
      dismissContext.assertCurrent(operation);
      await acknowledgeAdminFinancialAttempt(currentFinancialResult.attempt, fresh, () => dismissContext.assertCurrent(operation!));
      dismissContext.assertCurrent(operation);
      setFinancialResult(null); setFinancialDraft(null); setDismissNotice(null);
      await pendingFinancialQuery.refetch(); dismissContext.assertCurrent(operation);
      await loadDisputes(); dismissContext.assertCurrent(operation);
    } catch {
      if (dismissContext.isCurrent(operation)) setDismissNotice({ scope: dismissScope, text: 'Le reçu doit être relu avant de terminer ce suivi local.' });
    } finally {
      dismissContext.finish(operation);
      if (dismissContext.isCurrent(operation)) { dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null); }
    }
  }, [currentFinancialResult, dismissContext, dismissScope, pendingFinancialQuery, loadDisputes]);

  const submitCashDecision = useCallback(async (attempt: CashCaseAttempt, mode: 'confirm' | 'observe' | 'neutralize') => {
    if (!isAdmin || actionInFlight.current || attempt.adminUid !== user?.id) return;
    let operation;
    try { operation = dismissContext.start(); } catch { return; }
    if (!operation) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(attempt.disputeId);
    try {
      const receipt = await TransactionService.closeMeetupNoShow(attempt, () => dismissContext.assertCurrent(operation!), mode);
      dismissContext.assertCurrent(operation);
      setCashResult({ scope: dismissScope, attempt, receipt }); setCashDraft(null);
      setDismissNotice({ scope: dismissScope, text: receipt.outcome === 'unrecorded'
        ? 'Aucun reçu propre enregistré. L’intention est conservée : relisez-la ou neutralisez-la explicitement, sans envoyer une nouvelle clôture.'
        : receipt.outcome === 'not_executed' ? 'Cette intention n’a pas classé le dossier. Sa requête tardive est bloquée ; la plainte reste à examiner selon son état actuel.'
        : 'Le dossier ciblé a été classé. Aucun argent n’a été déplacé et aucune réservation n’a été rétablie. Les autres dossiers restent distincts.' });
      await pendingCashQuery.refetch(); dismissContext.assertCurrent(operation);
      await loadDisputes(); dismissContext.assertCurrent(operation);
    } catch {
      if (!dismissContext.isCurrent(operation)) return;
      setCashDraft(null); setDismissNotice({ scope: dismissScope, text: 'Résultat inconnu : conservez cette référence, cet aperçu et cette note. Aucune nouvelle clôture n’a été envoyée.' });
      await pendingCashQuery.refetch();
    } finally {
      dismissContext.finish(operation);
      if (dismissContext.isCurrent(operation)) { dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null); }
    }
  }, [isAdmin, user?.id, dismissContext, dismissScope, pendingCashQuery, loadDisputes]);
  const acknowledgeCashDecision = useCallback(async () => {
    if (!currentCashResult || currentCashResult.receipt.outcome === 'unrecorded' || actionInFlight.current) return;
    let operation;
    try { operation = dismissContext.start(); } catch { return; }
    if (!operation) return;
    actionInFlight.current = true; dismissOwnsAction.current = true; setResolvingId(currentCashResult.attempt.disputeId);
    try {
      const fresh = await TransactionService.closeMeetupNoShow(currentCashResult.attempt, () => dismissContext.assertCurrent(operation!), 'observe');
      dismissContext.assertCurrent(operation);
      await acknowledgeCashCaseAttempt(currentCashResult.attempt, fresh, () => dismissContext.assertCurrent(operation!));
      dismissContext.assertCurrent(operation); setCashResult(null); setCashDraft(null); setDismissNotice(null);
      await pendingCashQuery.refetch(); dismissContext.assertCurrent(operation);
      await loadDisputes(); dismissContext.assertCurrent(operation);
    } catch {
      if (dismissContext.isCurrent(operation)) setDismissNotice({ scope: dismissScope, text: 'Le reçu propre doit être relu avant de terminer ce suivi local.' });
    } finally {
      dismissContext.finish(operation);
      if (dismissContext.isCurrent(operation)) { dismissOwnsAction.current = false; actionInFlight.current = false; setResolvingId(null); }
    }
  }, [currentCashResult, dismissContext, dismissScope, pendingCashQuery, loadDisputes]);

  const renderDisputeItem = useCallback(
    ({ item }: { item: Dispute }) => (
      <DisputeCard
        dispute={item}
        isResolving={resolvingId === item.id}
        actionsDisabled={resolvingId !== null}
        dismissDisabled={journalsUnavailable || pendingDismisses.some(a => a.transactionId === item.transactionId) ||
          pendingFinancial.some(a => a.transactionId === item.transactionId) || pendingCash.some(a => a.transactionId === item.transactionId)}
        onRefundBuyer={handleRefundBuyer}
        onResolveForSeller={handleResolveForSeller}
        onReadParcelHistory={openParcelClaimHistory}
      />
    ),
    [resolvingId, handleRefundBuyer, handleResolveForSeller, openParcelClaimHistory, journalsUnavailable, pendingDismisses, pendingFinancial, pendingCash],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Ionicons name="shield-checkmark-outline" size={64} color={colors.muted} />
        <Text style={styles.emptyTitle}>Aucun litige</Text>
        <Text style={styles.emptyText}>
          {selectedTab === 'open'
            ? 'Aucun litige en attente de résolution'
            : 'Aucun litige enregistré'}
        </Text>
      </View>
    ),
    [selectedTab],
  );

  if (!isAdmin && sdkUid) return <ScrollView><AdminOrphanCaptureRefundHistory uid={sdkUid} /><AdminExceptionalRestitutionHistory uid={sdkUid} /><AdminTransportFinancialHistory uid={sdkUid} /><AdminProductFinancialHistory uid={sdkUid} /><AdminPurchaseRefundHistory uid={sdkUid} /><AdminRefundRepairHistory uid={sdkUid} /><BankDisputeCommandHistory uid={sdkUid} scope="admin" /><BankRefundReconciliationCommandHistory uid={sdkUid} /><SwapDisputeReviewCommandHistory uid={sdkUid} /></ScrollView>;
  if (!isAdmin && !admin.isLoading) return <SafeAreaView style={styles.container} edges={['top']}>
    <Text style={styles.emptyText}>{admin.error ? 'Impossible de vérifier l’accès administrateur.' : 'Accès administrateur requis.'}</Text>
    <Pressable accessibilityRole="button" style={styles.actionBtn} onPress={() => {void admin.refetch();}}><Text style={styles.metaText}>Réessayer</Text></Pressable>
  </SafeAreaView>;
  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.skeletonContainer}>
          {Array.from({ length: 3 }).map((_, i) => (
            <DisputeCardSkeleton key={i} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Panel Admin</Text>
            <Text style={styles.headerSubtitle}>Litiges et remboursements</Text>
          </View>
        </View>
        <Pressable
          onPress={() => loadDisputes(selectedTab)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="refresh" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <AdminSectionNav />

      <View style={styles.decisionPanel}>
        {pendingDismissQuery.isError || pendingFinancialQuery.isError || pendingCashQuery.isError ? <>
          <Text style={styles.metaText}>Un journal de décision ne peut pas être relu. Les nouvelles décisions sont suspendues.</Text>
          <Button variant="secondary" onPress={() => { void pendingDismissQuery.refetch(); void pendingFinancialQuery.refetch(); void pendingCashQuery.refetch(); }}>Relire les décisions conservées</Button>
        </> : null}
        {pendingDismisses.map(pendingDismiss => <View key={pendingDismiss.transactionId}>
          <Text style={styles.cardReason}>Décision conservée à vérifier</Text>
          <Text selectable style={styles.metaText}>Dossier : {pendingDismiss.disputeId} · commande : {pendingDismiss.transactionId}</Text>
          <Text selectable style={styles.metaText}>Référence : {pendingDismiss.requestId}</Text>
          <Text style={styles.cardDescription}>Note conservée : {pendingDismiss.note}</Text>
          <Text style={styles.metaText}>La reprise conserve ce dossier, cette référence et cette note. Elle ne décide pas d’un nouveau dossier sur la même commande.</Text>
          <Button variant="secondary" disabled={resolvingId !== null} onPress={() => { void submitDismissDecision(pendingDismiss); }}>
            Relire cette intention sans la renvoyer
          </Button>
        </View>)}
        {currentDraft && !pendingDismisses.some(a => a.transactionId === currentDraft.dispute.transactionId) ? <>
          <Text style={styles.cardReason}>Classer le dossier en faveur du vendeur</Text>
          <Text selectable style={styles.metaText}>Dossier : {currentDraft.dispute.id} · commande : {currentDraft.dispute.transactionId}</Text>
          <Text selectable style={styles.metaText}>Acheteur : {currentDraft.preview.buyerId} · vendeur : {currentDraft.preview.sellerId}</Text>
          <Text style={styles.metaText}>État examiné : {currentDraft.preview.sourceStatus}. Aucun remboursement demandé par ce classement.</Text>
          {currentDraft.preview.monetaryContext === 'settled_refund' ? <>
            <Text selectable style={styles.metaText}>Remboursement déjà réglé : {currentDraft.preview.refundIntentId}.</Text>
            <Text style={styles.metaText}>Sommes historiques CAD : total {formatPrice(currentDraft.preview.totalCents / 100)}, carte {formatPrice(currentDraft.preview.cardCents / 100)}, porte-monnaie acheteur {formatPrice(currentDraft.preview.walletCents / 100)}, débit ou dette vendeur {formatPrice(currentDraft.preview.sellerDebitCents / 100)}.</Text>
            <Text style={styles.metaText}>Ces sommes sont déjà réglées et ne seront pas rendues une seconde fois. Ce classement conserve l’état remboursé, l’inventaire et les autres blocages, sans mouvement financier.</Text>
            <Text style={styles.metaText}>Une dette vendeur constatée peut rester due ; ce classement ne l’éteint pas.</Text>
          </> : <Text style={styles.metaText}>Ce classement peut libérer un gel qualifié si les conditions serveur sont remplies. L’aperçu ne prouve pas encore une libération de fonds.</Text>}
          <Text style={styles.metaText}>Autres dossiers ouverts : {currentDraft.preview.remainingOpenDisputeIds.join(', ') || 'aucun'}. Obligations conservées : {currentDraft.preview.retainedObligations.join(', ') || 'aucune'}.</Text>
          <Text style={styles.metaText}>Possession physique inconnue. Ce reçu n’autorisera pas la remise en vente et ne prouvera pas un accord des parties.</Text>
          <Text style={styles.metaText}>Saisissez une note motivant votre décision. Le reçu distingue le classement et les avis enregistrés. Il ne confirme pas un remboursement, une clôture bancaire, la disponibilité des fonds ou la réception sur un appareil.</Text>
          <TextInput style={styles.decisionInput} multiline maxLength={500} value={currentDraft.note} editable={resolvingId === null}
            placeholder="Note opérateur obligatoire" placeholderTextColor={colors.muted}
            onChangeText={note => setDismissDraft({ ...currentDraft, note, confirmed: false })} />
          <Checkbox checked={currentDraft.confirmed} disabled={resolvingId !== null}
            onToggle={() => setDismissDraft({ ...currentDraft, confirmed: !currentDraft.confirmed })}>
            <Text style={styles.metaText}>Je confirme le classement de ce dossier précis avec cette note.</Text>
          </Checkbox>
          <Button variant="secondary" disabled={resolvingId !== null || !currentDraft.confirmed || currentDraft.note.trim().length === 0}
            onPress={() => {
              if (!currentDraft.dispute.transactionId || !user || !currentDraft.confirmed) return;
              void submitDismissDecision({ version: 1, adminUid: user.id, transactionId: currentDraft.dispute.transactionId,
                disputeId: currentDraft.dispute.id, requestId: currentDraft.requestId, note: currentDraft.note.trim(),
                previewId: currentDraft.preview.previewId, expectedSourceHash: currentDraft.preview.sourceHash,
                previewMonetaryContext: currentDraft.preview.monetaryContext,
                expectedSettledRefundIntentId: currentDraft.preview.refundIntentId ?? null }, 'confirm');
            }}>Enregistrer ce classement</Button>
          <Button variant="ghost" disabled={resolvingId !== null} onPress={() => setDismissDraft(null)}>Fermer sans envoyer</Button>
        </> : null}
        {currentResult ? <>
          <Text style={styles.metaText}>Reçu de décision : {currentResult.receipt.decisionId}</Text>
          {currentResult.receipt.outcome === 'unrecorded' ? <>
            <Text style={styles.metaText}>Le serveur ne retrouve pas de reçu propre. Aucune clôture, non-exécution ou permission de renvoi n’est prouvée. Le journal reste conservé.</Text>
            <Button variant="secondary" disabled={resolvingId !== null} onPress={() => {
              const attempt = currentResult.attempt;
              Alert.alert('Neutraliser cette intention de classement',
                `Bloquer les effets de la référence ${attempt.requestId} pour le dossier ${attempt.disputeId} ? La note et l’aperçu d’origine seront conservés. Cette action n’examine ni ne classe le dossier. Si la décision est déjà engagée, elle ne l’annule pas : son reçu sera relu.`,
                [{ text: 'Retour', style: 'cancel' }, { text: 'Neutraliser cette intention', onPress: () => { void submitDismissDecision(attempt, 'neutralize'); } }]);
            }}>Neutraliser explicitement cette intention</Button>
          </> : currentResult.receipt.outcome === 'not_executed' ? <>
            <Text style={styles.metaText}>Intention non exécutée pour le dossier : {currentResult.receipt.expectedDisputeId}.</Text>
            <Text style={styles.metaText}>Le serveur confirme sa neutralisation le {formatDate(new Date(currentResult.receipt.neutralizedAt))}. Une requête tardive avec cette référence reste bloquée.</Text>
            <Text style={styles.metaText}>Ce reçu ne constitue pas votre classement du dossier, ni celui d’un autre admin. Aucun effet financier ou classement d’une nouvelle plainte n’est attribué à votre intention.</Text>
            {currentResult.receipt.nonExecutionReason === 'intention_neutralized_before_effects' ? <Text style={styles.metaText}>La neutralisation précède les effets de cette intention. Le dossier n’a pas été examiné par cette action et aucune modification de ses faits n’est attestée.</Text> : null}
          </> : <>
          <Text style={styles.metaText}>Dossier ciblé fermé : {currentResult.receipt.expectedDisputeId}.</Text>
          <Text style={styles.metaText}>{currentResult.receipt.orderResolutionCommitted
            ? `État restauré au moment de cette décision : ${currentResult.receipt.restored}.`
            : `Autres dossiers ouverts lors de la décision : ${currentResult.receipt.remainingDisputesOpen}. La commande n’a pas été restaurée.`}</Text>
          {currentResult.receipt.retainedObligations.includes('return_request') ? <Text style={styles.metaText}>Une demande de retour restait à examiner lors de cette décision.</Text> : null}
          {currentResult.receipt.retainedObligations.includes('delivery_correction') ? <Text style={styles.metaText}>Une correction du suivi de livraison restait à examiner lors de cette décision.</Text> : null}
          {currentResult.receipt.retainedObligations.includes('bank_hold_reconciliation') ? <Text style={styles.metaText}>Un gel bancaire restait à rapprocher lors de cette décision. Ce classement commercial ne le règle pas et ne libère pas ces fonds.</Text> : null}
          <Text style={styles.metaText}>Ce reçu est historique. Relisez les dossiers actuels ; il ne clôture pas une nouvelle réclamation.</Text>
          {currentResult.receipt.settlementQualification === 'native' && currentResult.receipt.financialSettlementRetained ? <>
            <Text selectable style={styles.metaText}>Remboursement d’origine conservé : {currentResult.receipt.settledRefundIntentId}.</Text>
            <Text style={styles.metaText}>Ce classement n’a effectué aucun mouvement financier. Il conserve l’état remboursé et n’autorise ni stock ni remise en vente ; les autres obligations restent distinctes.</Text>
          </> : currentResult.receipt.settlementQualification === 'historical_unqualified' ? <Text style={styles.metaText}>Ce suivi historique ne qualifie pas une référence de remboursement conservé. Aucun règlement financier supplémentaire n’en est déduit.</Text> : null}
          <Text style={styles.metaText}>{currentResult.receipt.notificationCommitted
            ? 'Les deux avis aux parties ont été enregistrés dans l’application. La réception sur un appareil et la lecture restent non prouvées.'
            : 'Ce reçu historique ne prouve pas l’enregistrement des deux avis aux parties.'}</Text>
          </>}
          <Button variant="secondary" disabled={resolvingId !== null || currentResult.receipt.outcome === 'unrecorded'} onPress={() => { void acknowledgeDismissDecision(); }}>
            {currentResult.receipt.outcome === 'not_executed' ? 'Acquitter cette non-exécution' : 'Terminer le suivi de cette décision'}
          </Button>
        </> : null}
        {pendingFinancial.map(attempt => <View key={attempt.transactionId}>
          <Text style={styles.cardReason}>{attempt.resume ? 'Autorisation de reprise conservée' : 'Instruction de remboursement conservée'}</Text>
          <Text selectable style={styles.metaText}>Dossier : {attempt.disputeId} · commande : {attempt.transactionId}</Text>
          <Text selectable style={styles.metaText}>Référence : {attempt.requestId} · aperçu : {attempt.previewId}</Text>
          <Text style={styles.cardDescription}>Note conservée : {attempt.note}</Text>
          <Text style={styles.metaText}>Somme examinée : {formatPrice(attempt.expectedTotalCents / 100)} CAD. L’instruction reste liée aux montants et aux faits d’origine.</Text>
          {attempt.resume ? <Text selectable style={styles.metaText}>Même intention : {attempt.resume.refundIntentId} · même tentative : {attempt.resume.refundAttemptId}. Aucune nouvelle réservation, clé ou tentative financière n’est demandée.</Text> : null}
          {attempt.transportReview ? <><Text style={styles.metaText}>Cause examinée : {attempt.transportReview.cause}. Dossiers : {attempt.transportReview.caseReferences.length}.</Text><Text selectable style={styles.metaText}>Ensemble : {attempt.transportReview.caseSetHash} · source financière : {attempt.transportReview.financialSourceHash}. Ces sources d’origine ne sont jamais remplacées automatiquement.</Text></> : null}
          {attempt.returnToSender ? <>
            <Text style={styles.metaText}>Cause examinée : {attempt.returnToSender.cause}. Déclarations incluses : {attempt.returnToSender.caseReferences.length}.</Text>
            <Text selectable style={styles.metaText}>Ensemble des cas : {attempt.returnToSender.caseSetHash} · source financière : {attempt.returnToSender.financialSourceHash}</Text>
            <Text style={styles.metaText}>L’intention conserve toutes ses références de cas, leurs révisions et empreintes, ainsi que les options financières d’origine. Aucun nouveau cas ni aucune source actuelle ne remplace ce tuple.</Text>
          </> : null}
          <Button variant="secondary" disabled={resolvingId !== null} onPress={() => { void submitFinancialDecision(attempt, 'observe'); }}>
            Relire cette intention sans la renvoyer
          </Button>
        </View>)}
        {currentFinancialDraft && !pendingFinancial.some(a => a.transactionId === currentFinancialDraft.dispute.transactionId) ? <ScrollView nestedScrollEnabled style={styles.financialReviewScroller}>
          <Text style={styles.cardReason}>{currentFinancialDraft.preview.resume ? 'Autoriser la reprise de l’intention d’origine' : currentFinancialDraft.preview.transportReview ? 'Instruction financière après enquête de transport' : currentFinancialDraft.preview.returnToSender ? 'Remboursement après examen des déclarations' : 'Demander un remboursement sans retour'}</Text>
          <Text selectable style={styles.metaText}>Dossier : {currentFinancialDraft.dispute.id} · commande : {currentFinancialDraft.preview.transactionId}</Text>
          <Text selectable style={styles.metaText}>Acheteur bénéficiaire : {currentFinancialDraft.preview.buyerId} · vendeur débité : {currentFinancialDraft.preview.sellerId}</Text>
          <Text style={styles.metaText}>État examiné : {currentFinancialDraft.preview.sourceStatus}. Total CAD : {formatPrice(currentFinancialDraft.preview.totalCents / 100)}.</Text>
          <Text style={styles.metaText}>Carte d’origine : {formatPrice(currentFinancialDraft.preview.cardCents / 100)} CAD. Porte-monnaie acheteur : {formatPrice(currentFinancialDraft.preview.walletCents / 100)} CAD.</Text>
          <Text style={styles.metaText}>Débit ou dette vendeur : {formatPrice(currentFinancialDraft.preview.sellerDebitCents / 100)} CAD.</Text>
          {currentFinancialDraft.preview.resume ? <>
            <Text selectable style={styles.metaText}>Intention d’origine : {currentFinancialDraft.preview.resume.refundIntentId} · tentative d’origine : {currentFinancialDraft.preview.resume.refundAttemptId}</Text>
            <Text style={styles.metaText}>Les montants, options, clé et tentative de cette intention restent inchangés. Cet aperçu examine une nouvelle autorisation humaine pour sa reprise ; aucune deuxième réservation ni nouvelle intention financière n’est créée. Un mouvement externe déjà réel doit être suivi avec son reçu d’origine.</Text>
          </> : null}
          <Text style={styles.metaText}>Autres dossiers ouverts : {currentFinancialDraft.preview.remainingOpenDisputeIds.join(', ') || 'aucun'}. Obligations conservées : {currentFinancialDraft.preview.retainedObligations.join(', ') || 'aucune'}.</Text>
          <Text style={styles.metaText}>Vous donnez une instruction opérateur de remboursement sans demander de retour. La possession physique est inconnue, l’inventaire reste bloqué et aucun accord bilatéral n’est attesté. Le résultat financier restera distinct de la réservation.</Text>
          {currentFinancialDraft.preview.returnToSender || currentFinancialDraft.preview.transportReview ? <>
            {currentFinancialDraft.preview.returnToSender ? <AdminReturnToSenderFinancialReview source={currentFinancialDraft.preview.returnToSender} /> : null}
            {currentFinancialDraft.preview.transportReview ? <AdminTransportFinancialReview source={currentFinancialDraft.preview.transportReview} /> : null}
            <AdminFinancialReauthentication key={JSON.stringify([dismissScope, currentFinancialDraft.requestId, currentFinancialDraft.preview.previewId])}
              uid={actorUid!} sourceKey={currentFinancialDraft.preview.previewId} disabled={resolvingId !== null}
              onVerified={() => setFinancialDraft(value => value?.scope === dismissScope && value.requestId === currentFinancialDraft.requestId &&
                value.preview.previewId === currentFinancialDraft.preview.previewId ? {...value, reauthenticated: true, confirmed: false} : value)} />
            <TextInput style={styles.decisionInput} multiline maxLength={300} value={currentFinancialDraft.cause} editable={resolvingId === null}
              placeholder="Cause de cette instruction financière" placeholderTextColor={colors.muted}
              onChangeText={cause => setFinancialDraft({...currentFinancialDraft, cause, humanExamined: false, confirmed: false})} />
            <Checkbox checked={currentFinancialDraft.humanExamined} disabled={resolvingId !== null || !currentFinancialDraft.cause.trim()}
              onToggle={() => setFinancialDraft({...currentFinancialDraft, humanExamined: !currentFinancialDraft.humanExamined, confirmed: false})}>
              <Text style={styles.metaText}>J’ai examiné toutes les déclarations de la liste, leurs références, les sources financières et les options de cet aperçu. La cause ci-dessus motive cette instruction ; cet examen ne certifie aucune réception physique.</Text>
            </Checkbox>
          </> : null}
          <TextInput style={styles.decisionInput} multiline maxLength={500} value={currentFinancialDraft.note} editable={resolvingId === null}
            placeholder="Motif opérateur obligatoire" placeholderTextColor={colors.muted}
            onChangeText={note => setFinancialDraft({ ...currentFinancialDraft, note, confirmed: false })} />
          <Checkbox checked={currentFinancialDraft.confirmed} disabled={resolvingId !== null || !!(currentFinancialDraft.preview.returnToSender || currentFinancialDraft.preview.transportReview) &&
            (!currentFinancialDraft.humanExamined || !currentFinancialDraft.reauthenticated)}
            onToggle={() => setFinancialDraft({ ...currentFinancialDraft, confirmed: !currentFinancialDraft.confirmed })}>
            <Text style={styles.metaText}>{currentFinancialDraft.preview.resume
              ? 'Je confirme l’autorisation financière de reprendre cette même intention et tentative, avec leurs montants inchangés, ces cas exacts, cette cause, ces options et cette note.'
              : currentFinancialDraft.preview.returnToSender || currentFinancialDraft.preview.transportReview
              ? 'Je confirme l’instruction financière de remboursement intégral pour ces cas exacts, ces destinataires, ces montants, cette cause, ces options et cette note.'
              : 'Je confirme cette instruction sans retour pour ce dossier, ces destinataires, ces montants et cette note.'}</Text>
          </Checkbox>
          <Button variant="secondary" disabled={resolvingId !== null || !currentFinancialDraft.confirmed || !currentFinancialDraft.note.trim() ||
            !!(currentFinancialDraft.preview.returnToSender || currentFinancialDraft.preview.transportReview) && (!currentFinancialDraft.humanExamined || !currentFinancialDraft.reauthenticated || !currentFinancialDraft.cause.trim())}
            onPress={() => {
              if (!user || actorUid !== user.id || !currentFinancialDraft.confirmed || (currentFinancialDraft.preview.returnToSender || currentFinancialDraft.preview.transportReview) &&
                (!currentFinancialDraft.humanExamined || !currentFinancialDraft.reauthenticated || !currentFinancialDraft.cause.trim())) return;
              const p = currentFinancialDraft.preview;
              void submitFinancialDecision({ version: 1, adminUid: user.id, transactionId: p.transactionId, disputeId: p.expectedDisputeId,
                requestId: currentFinancialDraft.requestId, note: currentFinancialDraft.note.trim(), previewId: p.previewId, expectedSourceHash: p.sourceHash,
                expectedTotalCents: p.totalCents, expectedCardCents: p.cardCents, expectedWalletCents: p.walletCents,
                expectedSellerDebitCents: p.sellerDebitCents, decisionType: 'refund_without_return',
                ...(p.returnToSender ? {returnToSender: adminReturnToSenderFinancialReference(p.returnToSender, currentFinancialDraft.cause)} : {}),
                ...(p.transportReview ? {transportReview: adminTransportFinancialReference(p.transportReview, currentFinancialDraft.cause)} : {}),
                ...(p.resume ? {resume: {...p.resume}} : {}) }, 'confirm');
            }}>Enregistrer cette instruction</Button>
          <Button variant="ghost" disabled={resolvingId !== null} onPress={() => setFinancialDraft(null)}>Fermer sans envoyer</Button>
        </ScrollView> : null}
        {currentFinancialResult ? <>
          <Text selectable style={styles.metaText}>Reçu propre : {currentFinancialResult.receipt.decisionId}</Text>
          {currentFinancialResult.receipt.outcome === 'unrecorded' ? <>
            <Text style={styles.metaText}>Absence de reçu observée. Le journal reste conservé et aucune nouvelle confirmation n’est autorisée.</Text>
            <Button variant="secondary" disabled={resolvingId !== null} onPress={() => {
              const attempt = currentFinancialResult.attempt;
              Alert.alert('Neutraliser cette intention de remboursement',
                `Bloquer les effets de la référence ${attempt.requestId} pour le dossier ${attempt.disputeId} ? Les montants, la note et l’aperçu d’origine seront conservés. Cette action n’examine pas le dossier et ne rembourse personne. Si l’instruction est déjà réservée, elle ne l’annule pas : son reçu sera relu.`,
                [{ text: 'Retour', style: 'cancel' }, { text: 'Neutraliser cette intention', onPress: () => { void submitFinancialDecision(attempt, 'neutralize'); } }]);
            }}>Neutraliser explicitement cette intention</Button>
          </>
            : currentFinancialResult.receipt.outcome === 'not_executed' ? <>
              <Text style={styles.metaText}>Non-exécution native le {formatDate(new Date(currentFinancialResult.receipt.committedAt))}. Cette intention est neutralisée ; elle ne reprend pas la décision d’un autre opérateur.</Text>
              {currentFinancialResult.receipt.reason === 'intention_neutralized_before_effects' ? <Text style={styles.metaText}>Le dossier n’a pas été examiné par cette neutralisation. Aucune réservation financière ni modification de ses faits n’en est déduite.</Text> : null}
              {(currentFinancialResult.receipt.returnToSender || currentFinancialResult.receipt.transportReview) && currentFinancialResult.receipt.reason !== 'intention_neutralized_before_effects' ?
                <Text style={styles.metaText}>Cet aperçu ne peut plus servir à une nouvelle instruction. Après acquittement de cette non-exécution, relisez explicitement les cas et examinez un nouvel aperçu ; aucune source plus récente n’a été adoptée ici.</Text> : null}
            </>
            : <>
              <Text style={styles.metaText}>{currentFinancialResult.receipt.resume ? 'Autorisation de reprise enregistrée' : 'Décision opérateur réservée'} le {formatDate(new Date(currentFinancialResult.receipt.committedAt))}.</Text>
              <Text selectable style={styles.metaText}>Intention financière : {currentFinancialResult.receipt.refundIntentId}</Text>
              <Text style={styles.metaText}>{refundResultPresentation(currentFinancialResult.receipt.financial).message}</Text>
              <Text style={styles.metaText}>Dossiers clos par cette intention : {currentFinancialResult.receipt.disputesClosed}. Autres dossiers conservés : {currentFinancialResult.receipt.remainingOpenDisputeIds.join(', ') || 'aucun'}.</Text>
              <Text style={styles.metaText}>Ce reçu ne prouve aucune réception du retour, ni la possession de l’article et n’autorise aucune remise en vente.</Text>
              {currentFinancialResult.receipt.transportReview ? <Text style={styles.metaText}>La réservation et son éventuelle reprise conservent les dossiers exacts, leurs sources, la cause et les options examinées. La réception physique, les autres obligations et l’inventaire restent distincts ; aucun crédit bancaire n’est certifié.</Text> : null}
              {currentFinancialResult.receipt.returnToSender ? <Text style={styles.metaText}>La réservation reste liée aux déclarations, aux sources financières, à la cause et aux options de l’intention examinée. Elle ne ferme aucun cas de retour à l’expéditeur et ne lève pas la garde d’inventaire. Un règlement enregistré ne prouve pas un crédit reçu sur un compte bancaire.</Text> : null}
            </>}
          <Button variant="secondary" disabled={resolvingId !== null || currentFinancialResult.receipt.outcome === 'unrecorded'} onPress={() => { void acknowledgeFinancialDecision(); }}>
            {currentFinancialResult.receipt.outcome === 'not_executed' ? 'Acquitter cette non-exécution' : 'Terminer ce suivi local de décision'}
          </Button>
        </> : null}
        {pendingCash.map(attempt => <View key={attempt.transactionId}>
          <Text style={styles.cardReason}>Intention conservée sur une rencontre</Text>
          <Text selectable style={styles.metaText}>Dossier : {attempt.disputeId} · commande : {attempt.transactionId}</Text>
          <Text selectable style={styles.metaText}>Référence : {attempt.requestId} · aperçu : {attempt.previewId}</Text>
          <Text style={styles.cardDescription}>Note conservée : {attempt.note}</Text>
          <Button variant="secondary" disabled={resolvingId !== null} onPress={() => { void submitCashDecision(attempt, 'observe'); }}>Relire cette intention sans la renvoyer</Button>
        </View>)}
        {currentCashDraft && !pendingCash.some(a => a.transactionId === currentCashDraft.preview.transactionId) ? <>
          <Text style={styles.cardReason}>Classer le dossier de rencontre en faveur de l’acheteur</Text>
          <Text selectable style={styles.metaText}>Dossier : {currentCashDraft.preview.expectedDisputeId} · commande : {currentCashDraft.preview.transactionId}</Text>
          <Text selectable style={styles.metaText}>Acheteur : {currentCashDraft.preview.buyerId} · vendeur : {currentCashDraft.preview.sellerId}</Text>
          <Text selectable style={styles.metaText}>Accord : {currentCashDraft.preview.cashAgreementId} · libération : {currentCashDraft.preview.reservationReleaseId}</Text>
          <Text style={styles.metaText}>La réservation est déjà libérée. Ce classement vise un seul dossier, conserve les autres plaintes et ne rétablit pas l’ancienne réservation. Aucun argent ne sera déplacé.</Text>
          <Text style={styles.metaText}>Le paiement comptant, la remise physique et une faute ne sont pas certifiés par cette décision. Autres dossiers ouverts : {currentCashDraft.preview.remainingOpenDisputeIds.join(', ') || 'aucun'}.</Text>
          <TextInput style={styles.decisionInput} multiline maxLength={500} value={currentCashDraft.note} editable={resolvingId === null}
            placeholder="Note opérateur obligatoire" placeholderTextColor={colors.muted}
            onChangeText={note => setCashDraft({ ...currentCashDraft, note, confirmed: false })} />
          <Checkbox checked={currentCashDraft.confirmed} disabled={resolvingId !== null}
            onToggle={() => setCashDraft({ ...currentCashDraft, confirmed: !currentCashDraft.confirmed })}>
            <Text style={styles.metaText}>Je confirme le classement de ce dossier précis avec ces faits examinés et cette note.</Text>
          </Checkbox>
          <Button variant="secondary" disabled={resolvingId !== null || !currentCashDraft.confirmed || !currentCashDraft.note.trim()} onPress={() => {
            if (!user || !currentCashDraft.confirmed) return;
            const p = currentCashDraft.preview;
            void submitCashDecision({ version: 1, adminUid: user.id, transactionId: p.transactionId, disputeId: p.expectedDisputeId,
              requestId: currentCashDraft.requestId, previewId: p.previewId, expectedSourceHash: p.sourceHash, note: currentCashDraft.note.trim(),
              decisionType: 'buyer_upheld', cashAgreementId: p.cashAgreementId, reservationReleaseId: p.reservationReleaseId }, 'confirm');
          }}>Enregistrer ce classement</Button>
          <Button variant="ghost" disabled={resolvingId !== null} onPress={() => setCashDraft(null)}>Fermer sans envoyer</Button>
        </> : null}
        {currentCashResult ? <>
          <Text selectable style={styles.metaText}>Reçu propre : {currentCashResult.receipt.decisionId}</Text>
          {currentCashResult.receipt.outcome === 'unrecorded' ? <>
            <Text style={styles.metaText}>Aucun reçu propre n’est enregistré. Le journal reste conservé ; cette absence n’autorise aucune nouvelle clôture.</Text>
            <Button variant="secondary" disabled={resolvingId !== null} onPress={() => {
              const attempt = currentCashResult.attempt;
              Alert.alert('Neutraliser cette intention de rencontre',
                `Bloquer les effets de la référence ${attempt.requestId} pour le dossier ${attempt.disputeId} ? L’aperçu et la note d’origine restent conservés. Cette action n’examine ni ne classe le dossier. Une décision déjà engagée sera relue et ne sera pas annulée.`,
                [{ text: 'Retour', style: 'cancel' }, { text: 'Neutraliser cette intention', onPress: () => { void submitCashDecision(attempt, 'neutralize'); } }]);
            }}>Neutraliser explicitement cette intention</Button>
          </> : currentCashResult.receipt.outcome === 'not_executed' ? <>
            <Text style={styles.metaText}>Intention non exécutée le {formatDate(new Date(currentCashResult.receipt.committedAt))}. Sa requête tardive reste bloquée.</Text>
            <Text style={styles.metaText}>{currentCashResult.receipt.reason === 'intention_neutralized_before_effects'
              ? 'Cette neutralisation n’a pas examiné le dossier.' : 'Les faits ne correspondaient plus à l’aperçu d’origine.'} Aucun classement n’en est déduit.</Text>
          </> : <>
            <Text style={styles.metaText}>Dossier ciblé classé : {currentCashResult.receipt.expectedDisputeId}.</Text>
            <Text style={styles.metaText}>Autres dossiers ouverts lors de la décision : {currentCashResult.receipt.remainingOpenDisputeIds.join(', ') || 'aucun'}. La réservation n’a pas été rétablie.</Text>
            <Text style={styles.metaText}>Les deux avis sont enregistrés dans l’application. La réception sur appareil et la lecture restent non prouvées.</Text>
          </>}
          <Text style={styles.metaText}>Ce reçu ne certifie pas le paiement hors application, la remise physique ou la faute d’une partie. Aucun mouvement financier n’en résulte.</Text>
          <Button variant="secondary" disabled={resolvingId !== null || currentCashResult.receipt.outcome === 'unrecorded'} onPress={() => { void acknowledgeCashDecision(); }}>Terminer ce suivi local après relecture</Button>
        </> : null}
        {dismissNotice?.scope === dismissScope ? <Text accessibilityRole="alert" style={styles.metaText}>{dismissNotice.text}</Text> : null}
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroller}>
        <View style={styles.tabs}>
          {([{id: 'open', label: 'Ouverts'}, {id: 'all', label: 'Tous'}, {id: 'refunds', label: 'Remboursements'}, {id: 'captures', label: 'Paiements à rapprocher'}, {id: 'bank', label: 'Contestations bancaires'}, {id: 'swaps', label: 'Swaps'}] as const).map(tab =>
            <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{selected: selectedTab === tab.id}} style={[styles.tab, selectedTab === tab.id && styles.tabActive]} onPress={() => {bankInteraction.invalidate(); setBankRevision(revision => revision + 1); parcelHistoryEpoch.current++; setParcelHistorySelection(null); setSelectedTab(tab.id);}}>
              <Text style={[styles.tabText, selectedTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>)}
        </View>
      </ScrollView>

      {selectedTab === 'bank' ? (sdkUid ? <AdminBankDisputeCases key={bankSourceKey} uid={sdkUid} sourceKey={bankSourceKey} assertSelection={assertBankSelection} /> : null) : selectedTab === 'refunds' || selectedTab === 'captures' ? (<AdminFinancialQueue mode={selectedTab} userId={user!.id} />) : selectedTab === 'swaps' ? (
        sdkUid ? <AdminSwapDisputeReview uid={sdkUid} /> : null
      ) : isLoading ? (
        <View style={styles.skeletonContainer}>
          {Array.from({ length: 4 }).map((_, i) => (
            <DisputeCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlashList
          data={disputes}
          renderItem={renderDisputeItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={<View style={styles.rtsEntry}>
            {actorUid && parcelHistorySelection?.scope === parcelHistoryScope ? <View style={styles.rtsEntry}>
              <AdminParcelClaimHistoryPanel key={parcelHistorySelection.nonce} uid={actorUid}
                transactionId={parcelHistorySelection.transactionId} disputeId={parcelHistorySelection.disputeId}
                selectionKey={parcelHistorySelection.nonce} assertSelection={parcelHistorySelection.assertSelection} enabled={isAdmin} />
              <Button variant="secondary" onPress={() => {parcelHistoryEpoch.current++; setParcelHistorySelection(null);}}>Fermer cette lecture comparative</Button>
            </View> : null}

            <AdminPurchaseRefundEntry key={productSelection ? `purchase-refund:${productSelection.nonce}` : 'purchase-refund'} uid={actorUid!} material parcel selection={productSelection ?? undefined} disabled={resolvingId !== null || journalsUnavailable}
              blockedTransactions={[...pendingDismisses, ...pendingFinancial, ...pendingCash].map(a => a.transactionId)}
              onRecorded={() => {void pendingFinancialQuery.refetch(); void pendingDismissQuery.refetch(); void loadDisputes();}} />
            <AdminProductFinancialEntry key={productSelection?.topic === 'authenticity' ? productSelection.nonce : 'product-financial-authenticity'} uid={actorUid!} material parcel topic="authenticity" selection={productSelection?.topic === 'authenticity' ? productSelection : undefined} disabled={resolvingId !== null || journalsUnavailable}
              blockedTransactions={[...pendingDismisses, ...pendingFinancial, ...pendingCash].map(a => a.transactionId)}
              onRecorded={() => {void pendingFinancialQuery.refetch(); void pendingDismissQuery.refetch(); void loadDisputes();}} />
            <AdminProductFinancialEntry key={productSelection?.topic === 'nonconformity' ? productSelection.nonce : 'product-financial-nonconformity'} uid={actorUid!} material parcel topic="nonconformity" selection={productSelection?.topic === 'nonconformity' ? productSelection : undefined} showHistory={false} disabled={resolvingId !== null || journalsUnavailable}
              blockedTransactions={[...pendingDismisses, ...pendingFinancial, ...pendingCash].map(a => a.transactionId)}
              onRecorded={() => {void pendingFinancialQuery.refetch(); void pendingDismissQuery.refetch(); void loadDisputes();}} />
            <AdminProductFinancialEntry key={productSelection?.topic === 'parcel_delivery' ? productSelection.nonce : 'product-financial-parcel'} uid={actorUid!} material parcel topic="parcel_delivery" selection={productSelection?.topic === 'parcel_delivery' ? productSelection : undefined} showHistory={false} disabled={resolvingId !== null || journalsUnavailable}
              blockedTransactions={[...pendingDismisses, ...pendingFinancial, ...pendingCash].map(a => a.transactionId)}
              onRecorded={() => {void pendingFinancialQuery.refetch(); void pendingDismissQuery.refetch(); void loadDisputes();}} />
            <AdminTransportFinancialEntry uid={actorUid!} disabled={resolvingId !== null || journalsUnavailable}
              blockedTransactions={[...pendingDismisses, ...pendingFinancial, ...pendingCash].map(a => a.transactionId)}
              onPreview={(transactionId, reviewId, disputeId, resume) => {void openTransportFinancialPreview(transactionId, reviewId, disputeId, resume);}} />
            <AdminReturnToSenderFinancialEntry uid={actorUid!} disabled={resolvingId !== null || journalsUnavailable}
              blockedTransactions={[...pendingDismisses, ...pendingFinancial, ...pendingCash].map(attempt => attempt.transactionId)}
              onPreview={(transactionId, caseId, resume) => {void openReturnToSenderFinancialPreview(transactionId, caseId, resume);}} />
            {disputeQuery.error ? <Text style={styles.emptyText}>Impossible de charger les litiges. Actualisez pour réessayer.</Text> : null}
          </View>}
          ListEmptyComponent={disputeQuery.error ? null : renderEmpty}
          ListFooterComponent={disputeQuery.hasNextPage ? <Pressable accessibilityRole="button" disabled={disputeQuery.isFetchingNextPage} style={styles.actionBtn} onPress={() => {void disputeQuery.fetchNextPage();}}><Text style={styles.metaText}>Voir les suivants</Text></Pressable> : null}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const keyExtractor = (item: Dispute) => item.id;

// =============================================================================
// DISPUTE CARD (read-only)
// =============================================================================

interface DisputeCardProps {
  dispute: Dispute;
  isResolving: boolean;
  actionsDisabled: boolean;
  dismissDisabled: boolean;
  onRefundBuyer: (dispute: Dispute) => void;
  onResolveForSeller: (dispute: Dispute) => void;
  onReadParcelHistory: (dispute: Dispute) => void;
}

const DisputeCard = React.memo(function DisputeCard({
  dispute,
  isResolving,
  actionsDisabled,
  dismissDisabled,
  onRefundBuyer,
  onResolveForSeller,
  onReadParcelHistory,
}: DisputeCardProps) {
  const isOpen = dispute.status === 'open';
  const transaction = useQuery({queryKey: ['admin', 'dispute-transaction', dispute.transactionId], queryFn: () => TransactionService.getTransaction(dispute.transactionId!), enabled: !!dispute.transactionId, staleTime: 30_000});
  const financialBlocked = !!transaction.data && (hasBankObligation(transaction.data) || hasUnsettledRefund(transaction.data));
  const resolutionDisabled = actionsDisabled || transaction.isLoading || !!transaction.error || !transaction.data;
  const counter = transaction.data?.counterReport;
  const showTransactionCounter = !!counter && (!dispute.counterReportedBy ||
    counter.reportedBy !== dispute.counterReportedBy || counter.details !== (dispute.counterDetails ?? undefined) || counter.reason !== dispute.counterReason);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{formatDisputeType(dispute.type)}</Text>
        </View>
        <View style={[styles.statusBadge, !isOpen && styles.statusBadgeClosed]}>
          <Text style={[styles.statusBadgeText, !isOpen && styles.statusBadgeTextClosed]}>
            {formatStatus(dispute.status)}
          </Text>
        </View>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {dispute.articleTitle ?? 'Article inconnu'}
      </Text>
      <Text style={styles.cardReason}>{formatReason(dispute.reason)}</Text>
      {dispute.reason === 'not_received_despite_delivered' && dispute.transactionId ? <Button variant="secondary" disabled={actionsDisabled} onPress={() => onReadParcelHistory(dispute)}>Consulter les non-réceptions déclarées dans leur contexte</Button> : null}

      {!!dispute.details && (
        <Text style={styles.cardDescription}>
          {dispute.details}
        </Text>
      )}

      {dispute.wholeSetComplaint ? <View style={styles.counterStatement}>
        <Text style={styles.cardReason}>Ensemble promis — source conservée avec la plainte</Text>
        <Text style={styles.cardDescription}>{dispute.wholeSetComplaint.contract.title}</Text>
        <Text selectable style={styles.cardDescription}>{dispute.wholeSetComplaint.contract.description}</Text>
        <Text style={styles.cardReason}>{dispute.wholeSetComplaint.declaration.claim === 'incomplete_set' ? 'Ensemble incomplet déclaré' : 'Autre différence déclarée sur cet ensemble'}</Text>
        <Text style={styles.cardDescription}>Contenu reçu déclaré : {dispute.wholeSetComplaint.declaration.received.status === 'described' ? dispute.wholeSetComplaint.declaration.received.description : 'inconnu déclaré'}.</Text>
        <Text style={styles.cardDescription}>Éléments manquants déclarés : {dispute.wholeSetComplaint.declaration.missing.status === 'described' ? dispute.wholeSetComplaint.declaration.missing.description :
          dispute.wholeSetComplaint.declaration.missing.status === 'none_observed' ? 'aucun élément manquant observé selon l’acheteur' : 'inconnus déclarés'}.</Text>
        <Text style={styles.metaText}>Ces observations ne sont pas vérifiées. Le recours porte sur la commande entière ; aucun prix ou retour par composant, réception physique, faute ou droit au remboursement n’est déduit.</Text>
      </View> : dispute.wholeSetComplaint === null ? <Text style={styles.metaText}>La déclaration ou le contenu promis de cet ensemble ne peuvent pas être qualifiés dans cette plainte. Aucun contenu actuel de l’annonce ne les remplace.</Text> : null}

      {dispute.counterReportedBy && <View style={styles.counterStatement}>
        <Text style={styles.cardReason}>Version de l’autre partie — dossier de litige</Text>
        <Text style={styles.metaText}>Déclarée par : {dispute.counterReportedBy}</Text>
        <Text style={styles.cardDescription}>{formatReason(dispute.counterReason)}</Text>
        {!!dispute.counterDetails && <Text style={styles.cardDescription}>{dispute.counterDetails}</Text>}
        {!!dispute.counterReportedAt && <Text style={styles.cardDate}>{formatDate(dispute.counterReportedAt)}</Text>}
      </View>}
      {showTransactionCounter && counter && <View style={styles.counterStatement}>
        <Text style={styles.cardReason}>Version conservée avec la commande</Text>
        <Text style={styles.metaText}>Déclarée par : {counter.reportedBy}</Text>
        <Text style={styles.cardDescription}>{formatReason(counter.reason)}</Text>
        {!!counter.details && <Text style={styles.cardDescription}>{counter.details}</Text>}
        {!!counter.reportedAt && <Text style={styles.cardDate}>{formatDate(counter.reportedAt)}</Text>}
      </View>}
      {!!transaction.error && <Text style={styles.cardDescription}>Impossible de charger les informations de la commande. Actualisez avant de décider.</Text>}

      {!!dispute.transactionId && (
        <View style={styles.metaRow}>
          <Ionicons name="receipt-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            Transaction : {dispute.transactionId}
          </Text>
        </View>
      )}
      {!!dispute.buyerId && (
        <View style={styles.metaRow}>
          <Ionicons name="bag-handle-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            Acheteur : {dispute.buyerId}
          </Text>
        </View>
      )}
      {!!dispute.sellerId && (
        <View style={styles.metaRow}>
          <Ionicons name="storefront-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            Vendeur : {dispute.sellerId}
          </Text>
        </View>
      )}
      {!!dispute.reportedBy && (
        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            Signalé par : {dispute.reportedBy}
          </Text>
        </View>
      )}
      {!!dispute.createdAt && (
        <Text style={styles.cardDate}>{formatDate(dispute.createdAt)}</Text>
      )}

      {transaction.data && <RefundStatusNotice transaction={transaction.data} perspective="admin" />}
      {/* Resolution actions — only on OPEN disputes linked to a transaction. */}
      {isOpen && !!dispute.transactionId && (
        <View style={styles.actionsRow}>
          {isResolving ? (
            <View style={styles.actionsLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <>
              <Pressable
                style={[styles.actionBtn, styles.refundBtn, actionsDisabled && styles.actionBtnDisabled]}
                onPress={() => onRefundBuyer(dispute)}
                disabled={resolutionDisabled || financialBlocked || dismissDisabled}
              >
                <Ionicons
                  name={dispute.type === 'meetup_no_show' ? 'checkmark-done-outline' : 'cash-outline'}
                  size={16}
                  color={colors.white}
                />
                <Text style={styles.refundBtnText}>
                  {dispute.type === 'meetup_no_show'
                    ? 'Clôturer (acheteur)'
                    : dispute.source === 'system_transport_review' ? 'Examiner l’instruction financière' : 'Rembourser l\u2019acheteur'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.dismissBtn, actionsDisabled && styles.actionBtnDisabled]}
                onPress={() => onResolveForSeller(dispute)}
                disabled={resolutionDisabled || financialBlocked || dismissDisabled}
              >
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.foreground} />
                <Text style={styles.dismissBtnText}>{dispute.source === 'system_transport_review' ? 'Examiner l’enquête' : 'Clôturer (vendeur)'}</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
});

// =============================================================================
// SKELETON
// =============================================================================

const DisputeCardSkeleton = React.memo(function DisputeCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Skeleton width={120} height={24} borderRadius={radius.sm} />
        <Skeleton width={70} height={24} borderRadius={radius.sm} />
      </View>
      <Skeleton width={180} height={18} borderRadius={radius.sm} style={styles.skeletonTitle} />
      <Skeleton width={140} height={16} borderRadius={radius.sm} style={styles.skeletonReason} />
      <SkeletonText lines={2} style={styles.skeletonDescription} />
    </View>
  );
});

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  financialReviewScroller: {maxHeight: spacing.xl * 14},
  rtsEntry: {paddingVertical: spacing.md, gap: spacing.md},
  decisionPanel: { paddingHorizontal: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
  decisionInput: { ...typography.bodySmall, color: colors.foreground, minHeight: spacing['4xl'], padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm },
  counterStatement: {paddingVertical: spacing.sm, gap: spacing.xs, borderTopWidth: 1, borderColor: colors.border},
  tabScroller: {flexGrow: 0},
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    flex: 1,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: '700',
    color: colors.foreground,
  },
  headerSubtitle: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.muted,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceWarm,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.white,
  },
  listContent: {
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm + 4,
    borderWidth: 1,
    borderColor: colors.surfaceWarm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm + 4,
  },
  typeBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  typeBadgeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  statusBadge: {
    backgroundColor: colors.warningLight,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    color: colors.warning,
  },
  statusBadgeClosed: {
    backgroundColor: colors.surfaceWarm,
  },
  statusBadgeTextClosed: {
    color: colors.foregroundSecondary,
  },
  cardTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  cardReason: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
  },
  cardDescription: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm + 4,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginBottom: spacing.xs,
  },
  metaText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.muted,
    flex: 1,
  },
  cardDate: {
    fontSize: typography.caption.fontSize,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionsLoading: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  refundBtn: {
    backgroundColor: colors.danger,
  },
  refundBtnText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.white,
  },
  dismissBtn: {
    backgroundColor: colors.surfaceWarm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dismissBtnText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.foreground,
  },
  skeletonContainer: {
    flex: 1,
    padding: spacing.md,
  },
  skeletonTitle: {
    marginBottom: spacing.sm,
  },
  skeletonReason: {
    marginBottom: spacing.sm,
  },
  skeletonDescription: {
    marginBottom: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['4xl'],
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: '700',
    color: colors.foreground,
  },
  emptyText: {
    fontSize: typography.body.fontSize,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing['2xl'],
  },
});
