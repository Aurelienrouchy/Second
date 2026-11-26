/**
 * ShipmentTracking — shipping timeline + buyer recourse entry points.
 * Design System: Editorial Luxe — all tokens from constants/theme.
 *
 * Distinguishes `label_created` (label bought, before first carrier scan) from
 * `shipped` (in transit). Surfaces buyer recourse on `delivery_failed` / `lost`
 * and a return-request entry once delivered.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WholeSetDeclaration } from '@/types/transactionProblem';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefundStatusNotice } from '@/components/RefundStatusNotice';
import { DevShippingControls } from '@/components/DevShippingControls';
import { LabelLifecycleOrderEntry } from '@/components/LabelLifecycleOrderEntry';
import { getFinancialErrorMessage, getRefundPresentation, hasBankObligation, hasUnsettledRefund } from '@/utils/refundPresentation';
import { functions } from '@/config/firebaseConfig';
import { track } from '@/lib/analytics';
import {
  RecourseReasonSheet,
  RecourseReasonSheetRef,
  RecourseReasonOption,
} from '@/components/RecourseReasonSheet';
import { Transaction } from '@/types';
import { APP_LOCALE } from '@/constants/locale';
import { BuyerReceiptDeclaration } from './BuyerReceiptDeclaration';
import { ObservedTrackingHistory } from './ObservedTrackingHistory';
import { LateTransportIncidentNotice } from './LateTransportIncidentNotice';
import { ReturnToSenderNotice } from './ReturnToSenderNotice';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { createReturnDepositInteraction } from '@/utils/returnDepositDeadlineContract';
import { TransactionService, getDeliveryCorrectionReview, hasReturnRequestWitness, readTransactionDate } from '@/services/transactionService';
import { ShippingPurchaseService } from '@/services/shippingPurchaseService';
import {ShippingTransportTerms} from '@/components/ShippingTransportTerms';
import {useOrderLabelDocument} from '../hooks/useOrderLabelDocument';
import { TransportReviewService } from '@/services/transportReviewService';
import { EffectiveDeliveryWindowService } from '@/services/effectiveDeliveryWindowService';
import { TransportReviewEvidence } from '@/components/TransportReviewEvidence';
import {LabelDepositDeadlinePanel} from '@/components/LabelDepositDeadlinePanel';
import { formatPrice } from '@/utils/formatPrice';
import { auth } from '@/config/firebaseConfig';
import { getStatusDescription, fillFundsReleaseAt } from '@/features/orders/lib/transactionStatusMeta';
import {
  useTransactionRecourse,
  getRecourseErrorMessage,
  ReportReasonCode,
  ReturnReasonCode,
} from '@/features/orders/hooks/useTransactionRecourse';
import { useAutomatedDecision } from '@/features/orders/hooks/useAutomatedDecision';
import {
  getDecisionExplanation,
  getDecisionTitle,
  buildCriteriaRows,
  isAutomatedDecisionType,
  type AutomatedDecisionType,
} from '@/features/orders/lib/automatedDecisionMeta';

interface ShipmentTrackingProps {
  transaction: Transaction;
  onStatusUpdate?: () => void;
  /** A single focused member tool; the normal order page never mounts this controller. */
  tool?: 'return' | 'report';
}

interface CarrierStatusInfo {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  description: string;
}
const policyDateLabel = (value: number | null) => value === null ? 'Date indisponible' : new Date(value).toLocaleString(APP_LOCALE, {
  timeZone: 'America/Toronto', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const POLICY_REVIEW_MESSAGES: Readonly<Record<string, string>> = {
  historical_payment_policy_unqualified: 'Notre équipe doit vérifier le délai de cette commande.',
  delivery_policy_time_unqualified: 'La date de livraison doit être vérifiée.',
  historical_delivery_policy_unqualified: 'Les délais de cette ancienne commande doivent être vérifiés.',
  existing_delivery_deadline_preserved: 'La nouvelle information de livraison doit être vérifiée.',
  delivery_scan_recorded_after_window: 'Le transporteur a transmis la livraison tardivement. Notre équipe doit vérifier le délai.',
  policy_source_reconciliation_required: 'Les délais de cette commande doivent être vérifiés.',
};

function preparationRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function preparationText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
}
function preparationUrl(value: unknown): value is string {
  if (!preparationText(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
/** Documentary association from a fresh private order. This does not establish
 * current carrier validity, physical contents or permission to deposit a parcel. */
function forwardPreparation(order: Transaction | null, uid: string | undefined) {
  const raw: unknown = order;
  if (!preparationRecord(raw) || !uid || raw.deliveryType !== 'shipping' ||
      uid !== raw.sellerId || !preparationText(raw.id) || !preparationText(raw.articleId) ||
      !preparationText(raw.buyerId) || raw.buyerId === raw.sellerId ||
      !preparationRecord(raw.articleSnapshot) || !preparationText(raw.articleSnapshot.title) ||
      !preparationRecord(raw.shippingSnapshot) || !preparationRecord(raw.labelPurchase)) return null;
  const snapshot = raw.shippingSnapshot, purchase = raw.labelPurchase;
  if (snapshot.schemaVersion !== 1 || snapshot.provider !== 'shipengine' || snapshot.currency !== 'CAD' ||
      snapshot.priceAcceptedBy !== raw.buyerId || !readTransactionDate(snapshot.validatedAt) ||
      !readTransactionDate(snapshot.acceptanceValidatedAt) || !preparationRecord(snapshot.rate) ||
      !preparationRecord(snapshot.destination) || !preparationText(snapshot.shipmentId) ||
      snapshot.rate.shipmentId !== snapshot.shipmentId || snapshot.rate.rateId !== raw.shipEngineRateId ||
      snapshot.rate.carrierCode !== raw.carrierCode || !preparationText(snapshot.rate.carrierId) || !preparationText(snapshot.rate.serviceCode) ||
      purchase.schemaVersion !== 1 || purchase.state !== 'committed' || purchase.transactionId !== raw.id ||
      purchase.buyerId !== raw.buyerId || purchase.sellerId !== raw.sellerId || purchase.shipmentId !== snapshot.shipmentId ||
      purchase.rateId !== raw.shipEngineRateId || purchase.providerLabelId !== raw.shipEngineLabelId ||
      typeof purchase.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(purchase.sourceHash) ||
      !preparationText(raw.shipEngineLabelId) || !preparationText(purchase.attemptId) ||
      !readTransactionDate(purchase.committedAt) || !readTransactionDate(raw.labelCreatedAt) ||
      !preparationRecord(purchase.qualification) || purchase.qualification.schemaVersion !== 1 ||
      purchase.qualification.currency !== 'CAD' || purchase.qualification.requestedRateId !== raw.shipEngineRateId ||
      !['request_path', 'filtered_lookup'].includes(String(purchase.qualification.rateIdentitySource)) ||
      !preparationUrl(raw.shippingLabelUrl) || !preparationText(raw.trackingNumber)) return null;
  const destination = snapshot.destination;
  if (!['name', 'street', 'city', 'province', 'postalCode', 'country'].every(field => preparationText(destination[field])) ||
      destination.country !== 'CA' || destination.province !== 'QC' ||
      destination.line2 != null && !preparationText(destination.line2)) return null;
  return {order, title: raw.articleSnapshot.title, articleId: raw.articleId, labelId: raw.shipEngineLabelId,
    labelUrl: raw.shippingLabelUrl, trackingNumber: raw.trackingNumber, recipient: String(destination.name),
    address: [destination.street, destination.line2, `${destination.city}, ${destination.province} ${destination.postalCode}`,
      destination.country].filter(preparationText).join('\n')};
}

/**
 * Maps the ShipEngine carrier tracking code to a DS-tokenized presentation.
 *
 * Covers every status the backend can emit via `ShipEngineClient.mapStatus`
 * (UNKNOWN, TRANSIT, IN_TRANSIT, DELIVERED, FAILURE) plus the richer raw
 * ShipEngine codes that can flow straight onto the transaction
 * (LABEL_CREATED/ACCEPTED, OUT_FOR_DELIVERY, EXCEPTION, RETURNED,
 * NOT_YET_IN_SYSTEM). Unknown scans never imply that a terminal or unpaid
 * agreement is still being prepared.
 */
function getCarrierStatusInfo(
  transaction: Transaction,
): CarrierStatusInfo {
  switch (transaction.trackingStatus) {
    case 'LABEL_CREATED':
    case 'ACCEPTED':
      return {
        icon: 'pricetag',
        color: colors.primary,
        label: 'Étiquette créée',
        description:
          'Une étiquette est enregistrée. Relisez son utilisation actuelle avant tout dépôt.',
      };
    case 'TRANSIT':
    case 'IN_TRANSIT':
      return {
        icon: 'airplane',
        color: colors.primary,
        label: 'En transit',
        description: transaction.carrierCode
          ? `Votre colis est en cours d'acheminement via ${transaction.carrierCode}`
          : "Votre colis est en cours d'acheminement",
      };
    case 'OUT_FOR_DELIVERY':
      return {
        icon: 'car',
        color: colors.warning,
        label: 'En cours de livraison',
        description: "Votre colis est en livraison aujourd'hui",
      };
    case 'DELIVERED':
      return {
        icon: 'checkmark-circle',
        color: colors.success,
        label: 'Livré',
        description: 'Le transporteur signale le colis comme livré',
      };
    case 'EXCEPTION':
    case 'FAILURE':
      return {
        icon: 'alert-circle',
        color: colors.danger,
        label: 'Problème de livraison',
        description: 'Un problème est survenu avec la livraison',
      };
    case 'DELIVERY_ATTEMPT':
      return {icon: 'time', color: colors.warning, label: 'Tentative de livraison signalée',
        description: 'Une tentative figure dans le suivi enregistré. Elle ne confirme pas la réception du colis ; relisez les événements fournis et vérifiez la prochaine étape auprès du transporteur.'};
    case 'DELIVERED_TO_SERVICE_POINT':
      return {icon: 'location', color: colors.warning, label: 'Arrivée en point de collecte signalée',
        description: 'Cette indication ne confirme pas la réception par le destinataire. Les coordonnées et modalités de retrait doivent être vérifiées auprès du transporteur.'};
    case 'RETURNED':
      return {
        icon: 'arrow-undo',
        color: colors.warning,
        label: 'Indication de retour à examiner',
        description: 'Cette indication de suivi ne confirme ni direction du retour, réception ou contenu du colis. L’équipe doit examiner le dossier.',
      };
    case 'NOT_YET_IN_SYSTEM':
      return {
        icon: 'cube',
        color: colors.muted,
        label: 'En attente de prise en charge',
        description: "Le transporteur n'a pas encore enregistré le colis",
      };
    case 'UNKNOWN':
    default:
      // Only the current commercial state can establish preparation without
      // a carrier scan; historical/financial state is not transport evidence.
      if (transaction.status === 'label_created') {
        return {
          icon: 'pricetag',
          color: colors.primary,
          label: 'Étiquette créée',
          description:
            'Une étiquette est enregistrée. Relisez son utilisation actuelle avant tout dépôt.',
        };
      }
      if (transaction.status === 'paid') return {
        icon: 'cube',
        color: colors.muted,
        label: 'En préparation',
        description: 'Le vendeur prépare votre colis',
      };
      return {
        icon: 'cube',
        color: colors.muted,
        label: 'Suivi du transport indisponible',
        description: 'Aucun état de transport confirmé n’est disponible pour cet accord.',
      };
  }
}

/** "Signaler un problème" options → backend report reason codes. */
const REPORT_REASON_OPTIONS: readonly RecourseReasonOption<ReportReasonCode>[] = [
  { code: 'not_received_despite_delivered', label: 'Colis non reçu' },
  { code: 'not_as_described', label: 'Article non conforme à l’annonce' },
  { code: 'damaged', label: 'Article endommagé' },
  { code: 'other', label: 'Autre' },
];

/** "Demander un retour" options → backend return reason codes. */
const RETURN_REASON_OPTIONS: readonly RecourseReasonOption<ReturnReasonCode>[] = [
  { code: 'not_as_described', label: 'Article non conforme à l’annonce' },
  { code: 'damaged', label: 'Article endommagé' },
  { code: 'wrong_item', label: 'Mauvais article reçu' },
  { code: 'other', label: 'Autre problème avec l’article' },
];

/** Loi 25 art. 12.1 — motifs prédéfinis pour contester une décision automatisée. */
type ContestReasonCode =
  | 'disagree_decision'
  | 'incorrect_information'
  | 'special_circumstances'
  | 'other';

const CONTEST_REASON_OPTIONS: readonly RecourseReasonOption<ContestReasonCode>[] = [
  { code: 'disagree_decision', label: 'Je ne suis pas d’accord avec cette décision' },
  { code: 'incorrect_information', label: 'Les informations utilisées sont incorrectes' },
  { code: 'special_circumstances', label: 'Ma situation présente des circonstances particulières' },
  { code: 'other', label: 'Autre' },
];

const CONTEST_REASON_LABELS: Record<ContestReasonCode, string> = {
  disagree_decision: 'Je ne suis pas d’accord avec cette décision',
  incorrect_information: 'Les informations utilisées sont incorrectes',
  special_circumstances: 'Ma situation présente des circonstances particulières',
  other: 'Autre',
};

const ShipmentTracking: React.FC<ShipmentTrackingProps> = ({
  transaction,
  onStatusUpdate,
  tool,
}) => {
  const uid = useAuthenticatedUid();
  const generation = getAuthSessionGeneration();
  const router = useRouter();
  const viewport = useWindowDimensions(), queryClient = useQueryClient();
  const returnContext = useLabelLifecycleContext(JSON.stringify(['return-request', transaction.id, viewport.width, viewport.height, viewport.fontScale]), uid ?? null);
  const mutationScope = useMemo(() => ({key: `${uid ?? ''}/${generation}/${transaction.id}`}), [uid, generation, transaction.id]);
  const currentMutationScope = useRef<typeof mutationScope | null>(mutationScope);
  const isCurrent = useCallback(() => {
    if (currentMutationScope.current !== mutationScope || !uid || auth.currentUser?.uid !== uid ||
      useAuthStore.getState().authenticatedUid !== uid || getAuthSessionGeneration() !== generation ||
      uid !== transaction.buyerId && uid !== transaction.sellerId) return false;
    try {returnContext.capture(); return true;} catch {return false;}
  }, [mutationScope, uid, generation, transaction.buyerId, transaction.sellerId, returnContext.frame, returnContext.focusRevision]);
  useLayoutEffect(() => {
    currentMutationScope.current = mutationScope;
    return () => {currentMutationScope.current = null;};
  }, [mutationScope]);
  const openHumanRecourse = () => {
    if (!isCurrent()) return;
    try { returnContext.capture(); } catch { return; }
    router.push({pathname: '/settings/support', params: {transactionId: transaction.id, kind: 'commercial_late'}} as never);
  };
  const [now, setNow] = useState(Date.now);
  const obligation = hasUnsettledRefund(transaction) || hasBankObligation(transaction);
  const refundPresentation = getRefundPresentation(transaction, uid === transaction.buyerId ? 'buyer' : 'seller');
  const [refreshingState, setRefreshingState] = useState({scope: mutationScope, focusRevision: returnContext.focusRevision, value: false});
  const isRefreshing = refreshingState.scope === mutationScope && refreshingState.focusRevision === returnContext.focusRevision && refreshingState.value;
  const setIsRefreshing = (value: boolean) => setRefreshingState({scope: mutationScope, focusRevision: returnContext.focusRevision, value});

  const isBuyer = !!uid && uid === transaction.buyerId;
  const isDelivered = transaction.status === 'delivered';
  const commercialStatus = transaction.bankDispute?.statusBeforeOpen ?? (hasUnsettledRefund(transaction) ? transaction.refund?.originalStatus : undefined) ?? transaction.status;
  const isRecourse =
    transaction.status === 'delivery_failed' || transaction.status === 'lost';
  const returnRequestQueryKey = ['return-request', uid ?? '', generation, transaction.id, returnContext.focusRevision, viewport.width, viewport.height, viewport.fontScale];
  const returnQuery = useQuery({
    queryKey: returnRequestQueryKey,
    enabled: returnContext.focused && !!uid && transaction.deliveryType === 'shipping' &&
      (uid === transaction.buyerId || uid === transaction.sellerId), staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {
      const operation = returnContext.capture();
      return TransactionService.readReturnRequest(transaction.id, operation.base.session.uid, () => returnContext.assertCurrent(operation));
    },
  });
  const returnLocalQueryKey = [...returnRequestQueryKey, 'local-intention', returnQuery.dataUpdatedAt];
  const returnLocalQuery = useQuery({queryKey: returnLocalQueryKey, enabled: tool !== 'report' && returnContext.focused && !!uid && uid === transaction.buyerId,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = returnContext.capture(); return TransactionService.readLocalReturnAttempt(transaction.id, op.base.session.uid, () => returnContext.assertCurrent(op));}});
  const localReturnReady = returnContext.focused && returnLocalQuery.isSuccess && returnLocalQuery.fetchStatus === 'idle' && !returnLocalQuery.isError && queryClient.getQueryState(returnLocalQueryKey)?.isInvalidated === false;
  const localReturnAttempt = localReturnReady ? returnLocalQuery.data : null;
  const localReturnFrameKey = JSON.stringify(returnRequestQueryKey), [neutralizationResult, setNeutralizationResult] = useState<{key: string; receipt: Awaited<ReturnType<typeof TransactionService.neutralizePendingConvenienceReturn>>} | null>(null);
  const currentNeutralization = neutralizationResult?.key === localReturnFrameKey ? neutralizationResult.receipt : null;
  const policyQuery = useQuery({queryKey: ['shipping-purchase-policy', uid, generation, transaction.id, returnContext.focusRevision],
    enabled: !!uid && returnContext.focused && transaction.deliveryType === 'shipping' && (uid === transaction.buyerId || uid === transaction.sellerId),
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {
      const operation = returnContext.capture(); return ShippingPurchaseService.readPolicyTimeline(operation.base.session.uid, transaction.id,
        () => returnContext.assertCurrent(operation));
    }});
  const policySourceReady = returnContext.focused && policyQuery.isSuccess && !policyQuery.isFetching && !policyQuery.error;
  const policyTimeline = policySourceReady ? policyQuery.data.purchasePolicy : null;
  const transportSourceKey = JSON.stringify([transaction.id, transaction.articleId, transaction.buyerId, transaction.sellerId,
    transaction.deliveryType, transaction.status, transaction.shipEngineLabelId, transaction.shipEngineRateId]);
  const transportContext = useLabelLifecycleContext(transportSourceKey, uid ?? null);
  const transportQueryKey = ['shipping-transport-terms', uid ?? '', generation, transportSourceKey, transportContext.focusRevision];
  const transportQuery = useQuery({queryKey: transportQueryKey,
    enabled: !tool && !!uid && transportContext.focused && transaction.deliveryType === 'shipping' && (uid === transaction.buyerId || uid === transaction.sellerId),
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const operation = transportContext.capture(); return ShippingPurchaseService.readTransportTerms(operation.base.session.uid, transaction.id,
      () => transportContext.assertCurrent(operation));}});
  const transportReady = transportContext.focused && transportQuery.isSuccess && transportQuery.fetchStatus === 'idle' && !transportQuery.isError &&
    queryClient.getQueryState(transportQueryKey)?.isInvalidated === false;
  const transportObservation = transportReady ? transportQuery.data : null;
  let transportRenderOperation: ReturnType<typeof transportContext.capture> | null = null;
  try {transportRenderOperation = transportContext.capture();} catch {/* An inactive render cannot authorize a later callback. */}
  const assertTransportFrame = () => {
    if (!transportRenderOperation) throw new Error('Relisez les conditions dans la session active.');
    transportContext.assertCurrent(transportRenderOperation);
  };
  const assertTransportSource = () => {
    assertTransportFrame();
    const state = queryClient.getQueryState(transportQueryKey);
    if (!transportReady || !state || state.data !== transportQuery.data || state.status !== 'success' || state.error !== null ||
      state.dataUpdatedAt !== transportQuery.dataUpdatedAt || state.fetchStatus !== 'idle' || state.isInvalidated !== false)
      throw new Error('Les conditions de transport ont changé. Relisez cette commande.');
  };
  useEffect(() => {
    if (!returnContext.focused || policyTimeline?.fundsReleaseAtMs == null) return;
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {clearTimeout(initial); clearInterval(timer);};
  }, [policyTimeline?.fundsReleaseAtMs, returnContext.frame, returnContext.focusRevision, returnContext.focused]);
  const reportQuery = useQuery({queryKey: ['transaction-problem', uid, generation, transaction.id, returnContext.focusRevision],
    enabled: tool !== 'return' && !!uid && uid === transaction.buyerId && returnContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = returnContext.capture(); return TransactionService.readTransactionProblem(transaction.id,
      operation.base.session.uid, () => returnContext.assertCurrent(operation));} });
  const reportSourceReady = returnContext.focused && reportQuery.isSuccess && !reportQuery.isFetching;
  const pendingReport = reportSourceReady ? reportQuery.data?.attempt ?? null : null;
  const returnObservation = returnQuery.data;
  const preparationQuery = useQuery({
    queryKey: ['forward-shipping-document', uid ?? '', generation, transaction.id, returnContext.focusRevision],
    enabled: !tool && returnContext.focused && !!uid && uid === transaction.sellerId && transaction.deliveryType === 'shipping',
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {
      const operation = returnContext.capture();
      return TransactionService.getTransaction(transaction.id, {expectedUid: operation.base.session.uid,
        assertCurrent: () => returnContext.assertCurrent(operation)});
    },
  });
  const preparation = returnContext.focused && preparationQuery.isSuccess && !preparationQuery.isFetching && !preparationQuery.error
    ? forwardPreparation(preparationQuery.data, uid ?? undefined) : null;
  const returnReceipt = returnObservation?.result;
  const closedReturn = returnReceipt?.status === 'closed' ? returnReceipt.terminalCapture : currentNeutralization?.status === 'closed' ? currentNeutralization.terminalCapture : null;
  const returnQuote = returnReceipt?.quote ?? null;
  const convenienceQuote = returnQuote?.protocol === 'return_quote_v2' ? returnQuote.convenienceReturnFinancialTerms : null;
  const returnQuoteKey = returnQuote ? JSON.stringify([returnQuote.protocol, returnQuote.requestId, returnQuote.quoteId, returnQuote.rateId,
    returnQuote.version, returnQuote.costCents, returnQuote.issuedAtMs, returnQuote.depositTerms ?? null, returnQuote.depositTermsHash ?? null,
    returnQuote.convenienceReturnFinancialTerms ?? null, returnQuote.convenienceReturnFinancialTermsHash ?? null]) : null;
  const historicalReturnDocument = returnObservation?.historicalDocument;
  const returnRecordedAndFrozen = returnReceipt?.requestRecorded === true && returnReceipt.fundsFrozen === true;
  const returnLabelCommitted = returnReceipt?.labelCommitted === true && returnReceipt.status === 'committed' &&
    returnReceipt.success === true && !!returnReceipt.requestId && returnReceipt.version !== null;
  const returnAlreadyExposed = !!localReturnAttempt || !!returnObservation?.attempt || !!returnReceipt || hasReturnRequestWitness(transaction);
  const freshReturnOrder = returnObservation?.transaction;
  const anotherNativeReturn = !!closedReturn && !!freshReturnOrder?.returnRequest?.requestId && freshReturnOrder.returnRequest.requestId !== closedReturn.returnRequestId;
  const wholeSetContext = useShippingPurchaseContext(JSON.stringify(['whole-set-report', transaction.id, transaction.articleSnapshot ?? null, transaction.articleId]), uid);
  const wholeSetQuery = useQuery({queryKey: ['whole-set-report-source', uid, generation, transaction.id, wholeSetContext.focusRevision, transaction.articleSnapshot ?? null],
    enabled: tool !== 'return' && !!uid && isBuyer && returnContext.focused && wholeSetContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = wholeSetContext.capture(); return TransactionService.readWholeSetReportSource(transaction.id, op.session.uid, () => wholeSetContext.assertCurrent(op));}});
  const wholeSetSource = returnContext.focused && wholeSetContext.focused && wholeSetQuery.isSuccess && !wholeSetQuery.isFetching && !wholeSetQuery.isError ? wholeSetQuery.data : null;
  const labelDocument = useOrderLabelDocument(transaction, freshReturnOrder, () => {
    if (!isCurrent()) throw new Error('La commande a changé.');
  });
  const labelContext = labelDocument.context;
  const currentLabelDocumentState = labelDocument.current;
  const isReadingLabelDocument = labelDocument.loading;
  const labelDocumentMessage = labelDocument.message;
  const correctionSourceKey = JSON.stringify(['shipment-correction', transaction, freshReturnOrder ?? null]);
  const correctionContext = useShippingPurchaseContext(correctionSourceKey, uid);
  const correctionQuery = useQuery({queryKey: ['shipment-delivery-correction', uid, generation, transaction.id, correctionContext.focusRevision, correctionSourceKey],
    enabled: !!uid && returnContext.focused && correctionContext.focused && (!!getDeliveryCorrectionReview(transaction) || !!freshReturnOrder && !!getDeliveryCorrectionReview(freshReturnOrder)),
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false, queryFn: () => {const operation = correctionContext.capture();
      return TransportReviewService.source(operation.session.uid, transaction.id, 'owner', null, () => correctionContext.assertCurrent(operation));}});
  const correctionObservation = correctionContext.focused && !returnQuery.isFetching && !returnQuery.isError && correctionQuery.isSuccess && !correctionQuery.isFetching && !correctionQuery.isError ? correctionQuery.data : null;
  const effectivePolicyQuery = useQuery({queryKey: ['shipment-effective-policy', uid, generation, transaction.id, correctionContext.focusRevision, correctionSourceKey],
    enabled: !!uid && correctionContext.focused && returnContext.focused && (!!getDeliveryCorrectionReview(transaction) || !!freshReturnOrder && !!getDeliveryCorrectionReview(freshReturnOrder)),
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const operation = correctionContext.capture();
      return EffectiveDeliveryWindowService.observe(operation.session.uid, transaction.id, () => correctionContext.assertCurrent(operation));}});
  const effectivePolicy = correctionContext.focused && !returnQuery.isFetching && !returnQuery.isError && effectivePolicyQuery.isSuccess && !effectivePolicyQuery.isFetching && !effectivePolicyQuery.isError ? effectivePolicyQuery.data : null;
  const correctedPolicy = effectivePolicy?.qualification === 'native_corrected_window' &&
    correctionObservation?.correctionResolution.state === 'resolved_current' && effectivePolicy.sourceRevision === correctionObservation.reference.orderRevision &&
    effectivePolicy.window?.correctionId === correctionObservation.correctionResolution.correctionId &&
    effectivePolicy.window.effectiveFundsReleaseAt === correctionObservation.correctionResolution.effectiveFundsReleaseAt &&
    effectivePolicy.window.effectiveProtectionEndsAt === correctionObservation.correctionResolution.effectiveProtectionEndsAt ? effectivePolicy : null;
  const deliveryCorrection = (freshReturnOrder ? getDeliveryCorrectionReview(freshReturnOrder, correctionObservation) : null) ?? getDeliveryCorrectionReview(transaction, correctionObservation);
  const deliveryStateUnread = transaction.deliveryType === 'shipping' && (!returnContext.focused || !returnQuery.isSuccess ||
    returnQuery.isFetching || !!returnQuery.error || !freshReturnOrder);
  const effectiveCorrectionWindow = correctionObservation?.correctionResolution.state === 'resolved_current' &&
    correctionObservation.correctionResolution.resolutionQualified && correctionObservation.correctionResolution.protectionQualification === 'native_policy_window'
    ? correctionObservation.correctionResolution : null;
  const deadlineMatchesOrder = policyTimeline?.fundsReleaseAtMs !== null && policyTimeline?.fundsReleaseAtMs !== undefined &&
    (effectiveCorrectionWindow ? !!effectiveCorrectionWindow.effectiveFundsReleaseAt && !!effectiveCorrectionWindow.effectiveProtectionEndsAt &&
      Date.parse(effectiveCorrectionWindow.effectiveFundsReleaseAt) === policyTimeline.fundsReleaseAtMs &&
      Date.parse(effectiveCorrectionWindow.effectiveProtectionEndsAt) === policyTimeline.deliveryProtectionEndsAtMs :
      freshReturnOrder?.fundsReleaseAt instanceof Date && Number.isFinite(freshReturnOrder.fundsReleaseAt.getTime()) && freshReturnOrder.fundsReleaseAt.getTime() === policyTimeline.fundsReleaseAtMs);
  const qualifiedDeadline = !deliveryStateUnread && !deliveryCorrection && correctedPolicy?.window ? Date.parse(correctedPolicy.window.effectiveFundsReleaseAt) :
    !deliveryStateUnread && !deliveryCorrection && policyTimeline && !policyTimeline.reviewRequired && deadlineMatchesOrder ? policyTimeline.fundsReleaseAtMs : null;
  const automaticWindowOpen = qualifiedDeadline !== null && qualifiedDeadline > now;
  const correctedWindowRequired = correctionObservation?.correctionResolution.protectionQualification === 'native_policy_window';
  const reportWindowPermission = correctedWindowRequired ? correctedPolicy?.canReportProblemNow === true : automaticWindowOpen;
  const returnWindowPermission = correctedWindowRequired ? correctedPolicy?.canPrepareReturnNow === true : automaticWindowOpen;
  const isReportable = commercialStatus === 'delivered' && !transaction.fundsReleasedAt && !freshReturnOrder?.fundsReleasedAt && automaticWindowOpen && reportWindowPermission;
  const canRequestReturn = isBuyer && returnContext.focused && returnQuery.isSuccess && !returnQuery.isFetching && !returnQuery.error &&
    !returnAlreadyExposed && !deliveryCorrection && !!freshReturnOrder && freshReturnOrder.buyerId === uid && freshReturnOrder.status === 'delivered' &&
    freshReturnOrder.deliveryType === 'shipping' && !freshReturnOrder.fundsReleasedAt && !obligation &&
    !hasUnsettledRefund(freshReturnOrder) && !hasBankObligation(freshReturnOrder) && automaticWindowOpen && returnWindowPermission;
  const canConfirmReturnQuote = isBuyer && returnContext.focused && !!returnQuote && returnRecordedAndFrozen &&
    returnReceipt?.status === 'quoted' && returnQuery.isSuccess && !returnQuery.isFetching && !returnQuery.error &&
    returnObservation?.attempt?.phase !== 'confirm_submitted' && !deliveryCorrection && !obligation && !!freshReturnOrder &&
    !hasBankObligation(freshReturnOrder) && !hasUnsettledRefund(freshReturnOrder) && !freshReturnOrder.fundsReleasedAt &&
    freshReturnOrder.status === 'delivered' && freshReturnOrder.buyerId === uid && (!localReturnAttempt || localReturnAttempt.requestId === returnQuote.requestId);
  const quoteSourceKey = JSON.stringify([uid, generation, transaction.id, returnContext.focusRevision,
    viewport.width, viewport.height, viewport.fontScale, returnQuery.dataUpdatedAt, returnQuery.status, returnQuery.fetchStatus, returnQuoteKey, canConfirmReturnQuote]);
  const [quoteConsent, setQuoteConsent] = useState<{sourceKey: string; accepted: boolean; revision: number} | null>(null);
  const quoteAccepted = quoteConsent?.sourceKey === quoteSourceKey && quoteConsent.accepted === true;
  const quoteFormKey = JSON.stringify([quoteSourceKey, quoteConsent]);
  const [quoteFrame, setQuoteFrame] = useState(() => ({key: quoteFormKey, parent: transaction, source: returnObservation, interaction: createReturnDepositInteraction()}));
  let liveQuoteFrame = quoteFrame;
  if (quoteFrame.key !== quoteFormKey || quoteFrame.parent !== transaction || quoteFrame.source !== returnObservation) {
    quoteFrame.interaction.invalidate(); liveQuoteFrame = {key: quoteFormKey, parent: transaction, source: returnObservation, interaction: createReturnDepositInteraction()}; setQuoteFrame(liveQuoteFrame);
  }
  const quoteChoice = liveQuoteFrame.interaction.capture();
  let quoteRenderScope: ReturnType<typeof returnContext.capture> | null = null;
  try {quoteRenderScope = returnContext.capture();} catch { /* An inactive render cannot grant a later focus admission. */ }
  const assertReturnQuoteSource = () => {
    if (!isCurrent() || !canConfirmReturnQuote || !returnQuote) throw new Error('Le devis et son consentement doivent être relus.');
    if (!quoteRenderScope) throw new Error('Le devis doit être relu dans la session active.');
    returnContext.assertCurrent(quoteRenderScope); quoteChoice(); const state = queryClient.getQueryState(returnRequestQueryKey);
    if (!state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.error !== null || state.isInvalidated ||
        state.data !== returnObservation || state.dataUpdatedAt !== returnQuery.dataUpdatedAt) throw new Error('La source du devis a changé. Relisez ce retour.');
  };
  // Revoke synchronously before any re-read or checkbox update. Old arrows
  // retain a revoked immutable capture even when their booleans were true.
  const revokeReturnQuoteConsent = () => {if (!quoteRenderScope) throw new Error('Relisez ce retour dans la session active.'); returnContext.assertCurrent(quoteRenderScope); quoteChoice(); liveQuoteFrame.interaction.invalidate(); setQuoteConsent(null);};
  const actionRef = useRef({report: false, return: false});
  useLayoutEffect(() => {actionRef.current = {
    report: isBuyer && isReportable && reportSourceReady && !pendingReport,
    return: canRequestReturn,
  };}, [isBuyer, isReportable, reportSourceReady, pendingReport, canRequestReturn, mutationScope]);

  const releaseDate = qualifiedDeadline !== null
    ? new Date(qualifiedDeadline).toLocaleDateString(APP_LOCALE, {
        day: 'numeric',
        month: 'long',
      })
    : undefined;

  const perspectiveDescription = deliveryCorrection?.message ?? (deliveryStateUnread ?
    'Actualisez le suivi pour vérifier l’état de cette commande.' : refundPresentation?.message ?? (returnAlreadyExposed ?
    returnRecordedAndFrozen ? 'Un retour est en cours. Les fonds restent bloqués pendant son traitement.' : 'Le retour et les fonds doivent être vérifiés.' :
    hasBankObligation(transaction) ? 'Un dossier bancaire reste à examiner. La disponibilité des fonds doit être vérifiée.' : isDelivered ?
      qualifiedDeadline === null ? 'La date de disponibilité des fonds doit être vérifiée. Contactez notre équipe.' :
        `Fonds retenus jusqu’au ${policyDateLabel(qualifiedDeadline)}, selon l’état de la commande.` : fillFundsReleaseAt(
    getStatusDescription(transaction.status, isBuyer ? 'buyer' : 'seller'),
    releaseDate,
  )));

  const handleRefresh = useCallback(async () => {
    if (!isCurrent()) return;
    let operation: ReturnType<typeof returnContext.capture>;
    try { operation = returnContext.capture(); revokeReturnQuoteConsent(); } catch { return; }
    try {
      setIsRefreshing(true);
      await Promise.all([returnQuery.refetch(), policyQuery.refetch()]);
      returnContext.assertCurrent(operation);
      if (obligation) {onStatusUpdate?.(); return;}
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const checkTracking = httpsCallable<{ transactionId: string }, { success: boolean }>(
        functions,
        'checkTrackingStatus',
      );
      const result = await checkTracking({ transactionId: transaction.id });
      returnContext.assertCurrent(operation);
      if (!isCurrent()) return;
      // The callable's success/absence of a correction field is no clearance.
      // Re-read the private native marker under the same owner/focus fence.
      await Promise.all([returnQuery.refetch(), policyQuery.refetch()]);
      returnContext.assertCurrent(operation);

      track('tracking_refreshed', {
        transaction_id: transaction.id,
        tracking_status: transaction.trackingStatus ?? '',
        success: !!result.data?.success,
      });

      if (result.data?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onStatusUpdate?.();
      }
    } catch (error: unknown) {
      if (!returnContext.isCurrent(operation) || !isCurrent()) return;
      if (__DEV__) console.error('Error refreshing tracking:', error);
      track('tracking_refreshed', {
        transaction_id: transaction.id,
        tracking_status: transaction.trackingStatus ?? '',
        success: false,
      });
      Alert.alert('Erreur', 'Impossible de mettre à jour le suivi');
    } finally {
      if (returnContext.isCurrent(operation) && isCurrent()) setIsRefreshing(false);
    }
  }, [transaction.id, transaction.trackingStatus, onStatusUpdate, obligation, isCurrent,
    returnContext.frame, returnContext.focusRevision, returnQuery.refetch, policyQuery.refetch, revokeReturnQuoteConsent]);

  const handleOpenTracking = useCallback(() => {
    if (!isCurrent() || transaction.carrierCode === 'seconde_dev') return;
    if (transaction.trackingUrl) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      track('tracking_link_opened', {
        transaction_id: transaction.id,
        carrier_code: transaction.carrierCode ?? '',
        tracking_status: transaction.trackingStatus ?? '',
      });
      Linking.openURL(transaction.trackingUrl).catch(() => {if (isCurrent()) Alert.alert('Suivi inaccessible', "Impossible d’ouvrir le suivi. Vous pouvez réessayer ou contacter notre équipe.");});
    }
  }, [transaction.trackingUrl, transaction.id, transaction.carrierCode, transaction.trackingStatus, isCurrent]);

  const handleOpenLabelDocument = labelDocument.open;
  const handleDownloadLabel = useCallback(() => handleOpenLabelDocument('forward', transaction.shipEngineLabelId ?? null), [handleOpenLabelDocument, transaction.shipEngineLabelId]);

  // ---------------------------------------------------------------------------
  // BUYER RECOURSE — wired to the buyer-facing callables
  // (functions/src/callable/recourse.ts): reportTransactionProblem / requestReturn.
  // Transport incidents lead to human review, not a new refund intention.
  // The transaction doc is the source of truth — after a
  // successful call we trigger onStatusUpdate() so the parent refetches and the
  // UI reflects the new status (refund_in_progress / disputed / return_requested).
  // ---------------------------------------------------------------------------

  const { reportProblem, requestReturn } = useTransactionRecourse();
  const mutationLocks = useRef(new Set<string>());
  const reportSheetRef = useRef<RecourseReasonSheetRef>(null);
  const returnSheetRef = useRef<RecourseReasonSheetRef>(null);
  const returnSheetScope = useRef<ReturnType<typeof returnContext.capture> | null>(null);
  const [reportingState, setReportingState] = useState({frame: returnContext.frame, focusRevision: returnContext.focusRevision, value: false});
  const isReporting = reportingState.frame === returnContext.frame && reportingState.focusRevision === returnContext.focusRevision && reportingState.value;
  const setIsReporting = (value: boolean) => setReportingState({frame: returnContext.frame, focusRevision: returnContext.focusRevision, value});
  const [returningState, setReturningState] = useState({frame: returnContext.frame, focusRevision: returnContext.focusRevision, value: false});
  const isReturning = returningState.frame === returnContext.frame && returningState.focusRevision === returnContext.focusRevision && returningState.value;
  const setIsReturning = (value: boolean) => setReturningState({frame: returnContext.frame, focusRevision: returnContext.focusRevision, value});
  const [returnNotice, setReturnNotice] = useState<{frame: symbol; focusRevision: string; message: string} | null>(null);
  const returnMessage = returnNotice?.frame === returnContext.frame && returnNotice.focusRevision === returnContext.focusRevision ? returnNotice.message : null;
  useLayoutEffect(() => {
    returnSheetScope.current = null; returnSheetRef.current?.dismiss();
  }, [returnContext.frame, returnContext.focusRevision]);

  const openReportSheet = useCallback(() => {
    if (!isCurrent() || !actionRef.current.report) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    reportSheetRef.current?.present();
  }, [isCurrent]);

  const openReturnSheet = useCallback(() => {
    if (!isCurrent() || !actionRef.current.return) return;
    try {returnSheetScope.current = returnContext.capture();} catch {return;}
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    returnSheetRef.current?.present();
  }, [isCurrent, returnContext.frame, returnContext.focusRevision]);

  const handleSubmitReport = useCallback(
    async (reason: ReportReasonCode, details: string, setDeclaration?: WholeSetDeclaration) => {
      if (!isCurrent() || !actionRef.current.report) return;
      let operation: ReturnType<typeof returnContext.capture>;
      try {operation = returnContext.capture();} catch {return;}
      let setOperation: ReturnType<typeof wholeSetContext.capture> | null = null;
      if (reason === 'not_as_described') {
        if (!wholeSetSource || wholeSetSource.qualification === 'unknown' || wholeSetSource.qualification === 'native_whole_set_snapshot' &&
          (!setDeclaration || setDeclaration.snapshotHash !== wholeSetSource.source?.snapshotHash) || wholeSetSource.qualification !== 'native_whole_set_snapshot' && setDeclaration) {
          Alert.alert('Contenu promis à relire', 'Examinez le contenu enregistré, puis déclarez explicitement ce qui a été reçu ou manque, ou ce qui reste inconnu.'); return;
        }
        try {setOperation = wholeSetContext.capture();} catch {return;}
      } else if (setDeclaration) return;
      const lock = 'report/' + transaction.id;
      if (mutationLocks.current.has(lock)) return;
      mutationLocks.current.add(lock);
      try {
        setIsReporting(true);
        const result = await reportProblem(transaction.id, reason, details, operation.base.session.uid, () => {returnContext.assertCurrent(operation); if (setOperation) wholeSetContext.assertCurrent(setOperation);}, setDeclaration);
        returnContext.assertCurrent(operation);
        if (result.state !== 'committed') {
          Alert.alert('Signalement à relire', result.state === 'not_executed' ?
            'Le délai de signalement est dépassé. Contactez notre équipe pour examiner votre demande.' :
            'Impossible de confirmer l’envoi. Actualisez ce signalement avant de poursuivre.');
          return;
        }
        track('transaction_problem_reported', {
          transaction_id: transaction.id,
          status: transaction.status,
          reason_code: reason,
          details_length: details.trim().length,
          success: true,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        reportSheetRef.current?.dismiss();
        onStatusUpdate?.();
        Alert.alert(
          'Signalement envoyé',
          'Nous avons reçu votre signalement. Notre équipe vous tiendra informé.',
          [{ text: 'Compris' }],
        );
      } catch (error: unknown) {
        if (!returnContext.isCurrent(operation)) return;
        if (__DEV__) console.error('reportTransactionProblem failed:', error);
        track('transaction_problem_reported', {
          transaction_id: transaction.id,
          status: transaction.status,
          reason_code: reason,
          details_length: details.trim().length,
          success: false,
          error_code:
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code)
              : undefined,
        });
        Alert.alert('Signalement impossible', getRecourseErrorMessage(error), [
          { text: 'Compris' },
        ]);
      } finally {
        mutationLocks.current.delete(lock);
        if (returnContext.isCurrent(operation)) {
          onStatusUpdate?.();
          void reportQuery.refetch();
          setIsReporting(false);
        }
      }
    },
    [reportProblem, transaction.id, transaction.status, onStatusUpdate, mutationScope, isCurrent, returnContext.frame, returnContext.focusRevision, reportQuery.refetch, wholeSetSource, wholeSetContext.frame, wholeSetContext.focusRevision],
  );
  const handleReportRecovery = async (acknowledge: boolean, resume = false) => {
    if (!isCurrent() || !pendingReport || isReporting) return;
    const operation = returnContext.start(); if (!operation) return; setIsReporting(true);
    try {
      if (resume) {
        await TransactionService.resumeTransactionProblem(transaction.id, operation.base.session.uid, () => returnContext.assertCurrent(operation));
        returnContext.assertCurrent(operation);
      } else if (acknowledge) {
        const receipt = await TransactionService.acknowledgeTransactionProblem(transaction.id, operation.base.session.uid, () => returnContext.assertCurrent(operation));
        returnContext.assertCurrent(operation);
        if (receipt.state === 'unrecorded') throw new Error('Le reçu demeure inconnu.');
        await reportSheetRef.current?.clearAcknowledgedDraft(); returnContext.assertCurrent(operation);
      }
      await reportQuery.refetch(); returnContext.assertCurrent(operation);
    } catch (error) {if (returnContext.isCurrent(operation)) Alert.alert('Signalement à vérifier', getRecourseErrorMessage(error));}
    finally {if (returnContext.isCurrent(operation)) setIsReporting(false); returnContext.finish(operation);}
  };
  const reportRecovery = isBuyer && (pendingReport || reportQuery.isError) ? <View style={styles.recourseBox}>
    <Text style={styles.recourseTitle}>Signalement conservé</Text>
    {pendingReport ? <>
      <Text selectable style={styles.recourseBody}>{pendingReport.details || pendingReport.reason}</Text>
      <Text style={styles.recourseBody}>{reportQuery.data?.receipt?.state === 'committed' ?
        'Votre signalement a été reçu. Consultez la commande pour suivre son traitement.' :
        reportQuery.data?.receipt?.state === 'not_executed' ? 'Ce signalement n’a pas été envoyé.' :
        'L’envoi de ce signalement reste à vérifier.'}</Text>
      <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={isReporting || reportQuery.isFetching} onPress={() => {void handleReportRecovery(false);}}>
        <Text style={styles.outlineButtonText}>Actualiser le signalement</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={isReporting || reportQuery.isFetching} onPress={() => {void handleReportRecovery(false, true);}}>
        <Text style={styles.outlineButtonText}>Renvoyer le signalement</Text>
      </Pressable>
      {reportQuery.data?.receipt && reportQuery.data.receipt.state !== 'unrecorded' ?
        <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={isReporting || reportQuery.isFetching} onPress={() => {void handleReportRecovery(true);}}>
          <Text style={styles.outlineButtonText}>Terminer ce suivi</Text>
        </Pressable> : null}
    </> : <Text style={styles.recourseBody}>Impossible de vérifier votre dernier signalement. Réessayez avant d’en envoyer un autre.</Text>}
    <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={openHumanRecourse}><Text style={styles.outlineButtonText}>Contacter notre équipe</Text></Pressable>
  </View> : null;

  const handleSubmitReturn = useCallback(
    async (reason: ReturnReasonCode) => {
      if (!isCurrent() || !actionRef.current.return) return;
      const opened = returnSheetScope.current;
      if (!opened || !returnContext.isCurrent(opened)) return;
      let operation: ReturnType<typeof returnContext.capture>;
      try {const started = returnContext.start(); if (!started) return; operation = started;} catch {return;}
      const lock = 'return/' + transaction.id;
      if (mutationLocks.current.has(lock)) {returnContext.finish(operation); return;}
      mutationLocks.current.add(lock);
      try {
        setIsReturning(true);
        const result = await requestReturn(transaction.id, reason, operation.base.session.uid, () => {
          returnContext.assertCurrent(operation);
          if (!isCurrent()) throw new Error('La commande ou la session a changé.');
        });
        returnContext.assertCurrent(operation);
        if (!isCurrent()) return;
        track('return_requested', {
          transaction_id: transaction.id,
          reason_code: reason,
          success: result.labelCommitted,
        });
        if (result.requestRecorded && result.fundsFrozen) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        returnSheetRef.current?.dismiss();
        setReturnNotice({frame: operation.base.frame, focusRevision: returnContext.focusRevision, message:
          result.labelCommitted ? 'L’étiquette de retour est enregistrée. Consultez les documents de cette commande.' :
          result.quote ? 'Votre demande est déposée et les fonds sont gelés. Vérifiez le devis avant d’accepter la création de l’étiquette.' :
          result.requestRecorded && result.fundsFrozen ? 'Le dépôt de votre demande et le gel ont été confirmés. Consultez leur état dans ce même retour ; ne déposez pas de nouvelle demande.' :
          'Le résultat du retour et le gel des fonds restent à vérifier. Relisez cette même demande ou contactez notre équipe.'});
        onStatusUpdate?.();
        await returnQuery.refetch();
      } catch (error: unknown) {
        if (!returnContext.isCurrent(operation) || !isCurrent()) return;
        returnSheetRef.current?.dismiss();
        track('return_requested', {
          transaction_id: transaction.id,
          reason_code: reason,
          success: false,
          error_code:
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code)
              : undefined,
        });
        setReturnNotice({frame: operation.base.frame, focusRevision: returnContext.focusRevision,
          message: `${getFinancialErrorMessage(error)} Le résultat de cette même demande reste à vérifier ; aucune nouvelle demande ne sera envoyée.`});
        await returnQuery.refetch();
      } finally {
        mutationLocks.current.delete(lock);
        if (returnContext.isCurrent(operation) && isCurrent()) {
          onStatusUpdate?.();
          setIsReturning(false);
        }
        returnContext.finish(operation);
      }
    },
    [requestReturn, transaction.id, onStatusUpdate, mutationScope, isCurrent, returnContext.frame, returnContext.focusRevision, returnQuery.refetch],
  );

  const handleConfirmReturnQuote = useCallback(async () => {
    if (!isCurrent() || !canConfirmReturnQuote || !returnQuote || !quoteAccepted || isReturning) return;
    let operation: ReturnType<typeof returnContext.capture>;
    try {assertReturnQuoteSource(); const started = returnContext.start(); if (!started) return; operation = started;} catch {return;}
    const current = () => {returnContext.assertCurrent(operation); assertReturnQuoteSource(); if (!quoteAccepted) throw new Error('Le consentement du devis a été retiré.');};
    try {
      current();
      setIsReturning(true);
      const result = await TransactionService.confirmReturn(transaction.id, returnQuote, operation.base.session.uid, current);
      current(); revokeReturnQuoteConsent();
      setReturnNotice({frame: operation.base.frame, focusRevision: returnContext.focusRevision, message: result.labelCommitted ?
        'L’étiquette correspondant au devis accepté est enregistrée. La réception, le contenu et la décision de remboursement restent à vérifier séparément.' :
        'La création de l’étiquette reste à vérifier. Relisez cette même demande ; son acceptation ne sera pas envoyée une seconde fois.'});
      onStatusUpdate?.();
      await returnQuery.refetch();
    } catch (error: unknown) {
      if (!returnContext.isCurrent(operation) || !isCurrent()) return;
      try {quoteChoice(); revokeReturnQuoteConsent();} catch {return;}
      setReturnNotice({frame: operation.base.frame, focusRevision: returnContext.focusRevision,
        message: `${getFinancialErrorMessage(error)} Relisez cette même demande ou contactez notre équipe. Aucune nouvelle création d’étiquette ne sera envoyée.`});
      await returnQuery.refetch();
    } finally {
      if (returnContext.isCurrent(operation) && isCurrent()) setIsReturning(false);
      returnContext.finish(operation);
    }
  }, [isCurrent, canConfirmReturnQuote, returnQuote, quoteAccepted, isReturning, transaction.id,
    returnContext.frame, returnContext.focusRevision, onStatusUpdate, returnQuery.refetch, assertReturnQuoteSource, revokeReturnQuoteConsent, quoteChoice]);

  const handleReadReturn = useCallback(async () => {
    if (!isCurrent() || !returnContext.focused || isReturning) return;
    let operation: ReturnType<typeof returnContext.capture>;
    try {operation = returnContext.capture(); revokeReturnQuoteConsent();} catch {return;}
    await returnQuery.refetch();
    if (!returnContext.isCurrent(operation) || !isCurrent()) return;
    onStatusUpdate?.();
  }, [isCurrent, isReturning, returnContext.frame, returnContext.focusRevision, returnQuery.refetch, onStatusUpdate, revokeReturnQuoteConsent]);
  const handleAcknowledgeClosedReturn = async () => {
    if (!isCurrent() || !uid || !isBuyer || !closedReturn || !localReturnAttempt || isReturning) return;
    let operation; try {operation = returnContext.start();} catch {return;} if (!operation) return;
    const current = () => {returnContext.assertCurrent(operation); const state = queryClient.getQueryState(returnLocalQueryKey);
      if (!isCurrent() || !state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || state.data !== localReturnAttempt || state.dataUpdatedAt !== returnLocalQuery.dataUpdatedAt) throw new Error('Actualisez votre demande de retour avant de poursuivre.');};
    try {setIsReturning(true); current(); await TransactionService.acknowledgeClosedConvenienceReturn(transaction.id, uid, closedReturn, current); current();
      setNeutralizationResult(null); setReturnNotice({frame: operation.base.frame, focusRevision: returnContext.focusRevision, message: 'Le suivi de cette demande est terminé. Consultez le retour actuel de la commande.'}); onStatusUpdate?.();
    } catch (e) {if (returnContext.isCurrent(operation) && isCurrent()) setReturnNotice({frame: operation.base.frame, focusRevision: returnContext.focusRevision, message: e instanceof Error ? e.message : 'Votre demande est conservée. Réessayez.'});}
    finally {if (returnContext.isCurrent(operation) && isCurrent()) {setIsReturning(false); void returnLocalQuery.refetch(); void returnQuery.refetch();} returnContext.finish(operation);}
  };
  const handleNeutralizePendingReturn = async () => {
    if (!isCurrent() || !uid || !localReturnAttempt || localReturnAttempt.capability !== 'convenience_return_shipping_v1' || localReturnAttempt.phase !== 'prepare_submitted' || isReturning) return;
    let operation; try {operation = returnContext.start();} catch {return;} if (!operation) return;
    const current = () => {returnContext.assertCurrent(operation); const state = queryClient.getQueryState(returnLocalQueryKey);
      if (!isCurrent() || !state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || state.data !== localReturnAttempt || state.dataUpdatedAt !== returnLocalQuery.dataUpdatedAt) throw new Error('Actualisez votre demande de retour avant de poursuivre.');};
    try {setIsReturning(true); current(); const receipt = await TransactionService.neutralizePendingConvenienceReturn(localReturnAttempt, uid, current); current(); setNeutralizationResult({key: localReturnFrameKey, receipt});
      setReturnNotice({frame: operation.base.frame, focusRevision: returnContext.focusRevision, message: receipt.status === 'closed' ? 'Cet envoi a été annulé. Terminez son suivi pour préparer une autre demande.' : `Une demande de retour existe déjà (${receipt.requestId ?? 'référence à vérifier'}). Consultez son suivi avant de poursuivre.`}); onStatusUpdate?.();
    } catch (e) {if (returnContext.isCurrent(operation) && isCurrent()) setReturnNotice({frame: operation.base.frame, focusRevision: returnContext.focusRevision, message: `${e instanceof Error ? e.message : 'Résultat inconnu.'} Votre demande est conservée.`});}
    finally {if (returnContext.isCurrent(operation) && isCurrent()) {setIsReturning(false); void returnQuery.refetch(); void returnLocalQuery.refetch();} returnContext.finish(operation);}
  };

  const handleOpenReturnLabel = useCallback(() => {
    if (!returnLabelCommitted || returnQuery.isFetching || returnQuery.isError || !returnContext.focused) return;
    return handleOpenLabelDocument('return', freshReturnOrder?.returnLabelId ?? transaction.returnLabelId ?? null);
  }, [returnLabelCommitted, returnQuery.isFetching, returnQuery.isError, returnContext.focused, freshReturnOrder?.returnLabelId, transaction.returnLabelId, handleOpenLabelDocument]);

  const handleOpenHistoricalReturnDocument = useCallback(() => {
    if (!historicalReturnDocument || returnQuery.isFetching || returnQuery.isError || !returnContext.focused) return;
    return handleOpenLabelDocument('return', freshReturnOrder?.returnLabelId ?? transaction.returnLabelId ?? null);
  }, [historicalReturnDocument, returnQuery.isFetching, returnQuery.isError, returnContext.focused, freshReturnOrder?.returnLabelId, transaction.returnLabelId, handleOpenLabelDocument]);

  // ---------------------------------------------------------------------------
  // AUTOMATED DECISIONS (Loi 25, art. 12.1)
  //
  // The transparent log (getAutomatedDecisionLog) is the source of truth: the
  // presence of an entry means an automated decision (funds released / order
  // expired / label refund) was applied to this transaction. We then surface
  // (a) the juriste notification text, (b) an accessible "Pourquoi cette
  // décision ?" explanation, and (c) the "Contester cette décision" button.
  // Contesting opens a human-review request and REVERSES NOTHING.
  // ---------------------------------------------------------------------------

  // Only query the automated-decision log when an automated decision is
  // PLAUSIBLE for this transaction (avoids a callable per chat view). The three
  // automated decisions land the transaction in a terminal/post-decision state
  // or release the held funds. The log entries themselves remain the source of
  // truth for what is actually displayed.
  const couldHaveAutomatedDecision =
    !!transaction.fundsReleasedAt ||
    transaction.status === 'completed' ||
    transaction.status === 'cancelled' ||
    transaction.status === 'refunded' ||
    transaction.status === 'refund_in_progress' || transaction.status === 'refund_action_required';

  const {
    latestDecision,
    hasAutomatedDecision,
    contest,
    isContesting,
    sourceReady: decisionSourceReady,
    pendingContest,
    receipt: contestReceipt,
    otherIntentionPending,
    journalError: decisionJournalError,
    observeContest,
    acknowledgeContest,
    resumeContest,
  } = useAutomatedDecision(transaction.id, !tool && couldHaveAutomatedDecision, {readJournal: !tool});

  const contestSheetRef = useRef<RecourseReasonSheetRef>(null);
  const contestSheetSource = useRef<{id: string; revision: string; sourceHash: string} | null>(null);
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);

  const decisionType: AutomatedDecisionType | null =
    latestDecision && isAutomatedDecisionType(latestDecision.decisionType)
      ? latestDecision.decisionType
      : null;

  const decisionDateLabel = latestDecision?.executedAt
    ? new Date(latestDecision.executedAt).toLocaleDateString(APP_LOCALE, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const criteriaRows = useMemo(
    () =>
      latestDecision ? buildCriteriaRows(latestDecision.criteria, APP_LOCALE) : [],
    [latestDecision],
  );

  const toggleExplanation = useCallback(() => {
    if (!isCurrent()) return;
    Haptics.selectionAsync();
    setIsExplanationOpen((prev) => {
      const next = !prev;
      track('automated_decision_explained', {
        transaction_id: transaction.id,
        decision_type: decisionType ?? '',
        opened: next,
      });
      return next;
    });
  }, [transaction.id, decisionType, isCurrent]);

  const openContestSheet = useCallback(() => {
    if (!isCurrent() || !decisionSourceReady || pendingContest || otherIntentionPending) return;
    if (!latestDecision) return;
    contestSheetSource.current = {id: latestDecision.id, revision: latestDecision.revision, sourceHash: latestDecision.sourceHash};
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    contestSheetRef.current?.present();
  }, [isCurrent, decisionSourceReady, latestDecision, pendingContest, otherIntentionPending]);

  const handleSubmitContest = useCallback(
    async (reason: ContestReasonCode, details: string) => {
      if (!isCurrent() || isContesting || !decisionType || !latestDecision || !decisionSourceReady || pendingContest || otherIntentionPending) return;
      let operation: ReturnType<typeof returnContext.capture>;
      try {operation = returnContext.capture();} catch {return;}
      const source = contestSheetSource.current;
      if (!source || source.id !== latestDecision.id || source.revision !== latestDecision.revision || source.sourceHash !== latestDecision.sourceHash) {
        Alert.alert('Source à relire', 'La source sélectionnée a changé. Relisez puis ouvrez explicitement la demande pour l’entrée actuelle.'); return;
      }
      // Combine the predefined motive with the optional free-text so the human
      // reviewer gets the full context in a single `reason` string.
      const label = CONTEST_REASON_LABELS[reason];
      const composed = details.trim().length > 0 ? `${label} — ${details.trim()}` : label;
      try {
        const result = await contest({
          transactionId: transaction.id,
          decision: source,
          reason: composed,
        });
        returnContext.assertCurrent(operation);
        if (result.state !== 'committed') {
          Alert.alert('Révision à vérifier', result.state === 'not_executed' ?
            'La source exacte n’a pas pu être acceptée. Cette intention n’a pas été exécutée. Relisez son reçu et le journal actuel.' :
            'Le dépôt reste inconnu. Relisez cette intention conservée sans créer une nouvelle contestation.');
          return;
        }
        track('automated_decision_contested', {
          transaction_id: transaction.id,
          decision_type: decisionType,
          reason_code: reason,
          success: true,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        contestSheetRef.current?.dismiss();
        Alert.alert(
          'Demande de révision enregistrée',
          'Votre demande a été reçue. Notre équipe va l’examiner.',
          [{ text: 'Compris' }],
        );
      } catch (error: unknown) {
        if (!returnContext.isCurrent(operation)) return;
        if (__DEV__) console.error('contestAutomatedDecision failed:', error);
        track('automated_decision_contested', {
          transaction_id: transaction.id,
          decision_type: decisionType,
          reason_code: reason,
          success: false,
        });
        Alert.alert('Contestation impossible', getRecourseErrorMessage(error), [
          { text: 'Compris' },
        ]);
      }
    },
    [isContesting, decisionType, latestDecision, decisionSourceReady, pendingContest, otherIntentionPending, contest, transaction.id, isCurrent, returnContext.frame, returnContext.focusRevision],
  );
  const handleContestRecovery = async (acknowledge: boolean, resume = false) => {
    if (!isCurrent() || isContesting || !pendingContest) return;
    let operation: ReturnType<typeof returnContext.capture>;
    try {operation = returnContext.capture();} catch {return;}
    try {
      const result = resume ? await resumeContest() : acknowledge ? await acknowledgeContest() : await observeContest();
      returnContext.assertCurrent(operation);
      if (acknowledge && result.state !== 'unrecorded' && pendingContest.command.action === 'submit' &&
        pendingContest.command.decision?.id === latestDecision?.id) {
        await contestSheetRef.current?.clearAcknowledgedDraft(); returnContext.assertCurrent(operation);
      }
    } catch (error) {if (returnContext.isCurrent(operation)) Alert.alert('Révision à vérifier', getRecourseErrorMessage(error));}
  };
  const contestRecovery = pendingContest || otherIntentionPending || decisionJournalError ? <View style={styles.recourseBox}>
    <Text style={styles.recourseTitle}>Suivi de votre demande</Text>
    {pendingContest ? <>
      <Text selectable style={styles.recourseBody}>Référence : {pendingContest.requestId}</Text>
      {pendingContest.command.action === 'submit' ? <Text selectable style={styles.recourseBody}>Récit conservé : {pendingContest.command.narrative}</Text> : null}
      <Text style={styles.recourseBody}>{contestReceipt?.state === 'committed' ? 'Votre demande a été reçue et attend son examen.' :
        contestReceipt?.state === 'not_executed' ? 'Cette demande n’a pas été envoyée.' : 'L’envoi de cette demande reste à vérifier.'}</Text>
      <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={isContesting} onPress={() => {void handleContestRecovery(false);}}>
        <Text style={styles.outlineButtonText}>Actualiser la demande</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={isContesting} onPress={() => {void handleContestRecovery(false, true);}}>
        <Text style={styles.outlineButtonText}>Renvoyer la demande</Text>
      </Pressable>
      {contestReceipt && contestReceipt.state !== 'unrecorded' ? <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={isContesting} onPress={() => {void handleContestRecovery(true);}}>
        <Text style={styles.outlineButtonText}>Terminer le suivi</Text>
      </Pressable> : null}
    </> : <Text style={styles.recourseBody}>{otherIntentionPending ? 'Une autre demande est à vérifier dans Mes demandes et recours.' :
      'Impossible de retrouver votre dernière demande.'}</Text>}
    <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={openHumanRecourse}><Text style={styles.outlineButtonText}>Ouvrir mes demandes et recours</Text></Pressable>
  </View> : null;

  const returnState = (returnAlreadyExposed || !!returnMessage || !!returnQuery.error || !!returnLocalQuery.error || isReturning) && (
        <View style={styles.returnStateBox}>
          <View style={styles.recourseHeader}>
            <Ionicons name="arrow-undo" size={20} color={colors.warning} />
            <Text style={styles.recourseTitle}>{closedReturn ? 'Ancienne demande de retour clôturée' : returnLabelCommitted ? 'Étiquette de retour enregistrée' : returnRecordedAndFrozen ? 'Demande de retour enregistrée' : 'Retour à vérifier'}</Text>
          </View>
          <Text style={styles.recourseBody}>
            {closedReturn ? 'Cette demande de retour est terminée.' : returnRecordedAndFrozen ? 'Votre retour a été enregistré.' :
              returnReceipt?.requestRecorded ? 'Votre demande a été reçue. Son traitement reste à vérifier.' :
              'Vérifiez l’envoi de cette demande ou contactez notre équipe.'}
          </Text>
          {localReturnAttempt?.capability === 'convenience_return_shipping_v1' ? <><Text selectable style={styles.recourseBody}>Envoi à vérifier</Text>
            {localReturnAttempt.phase === 'prepare_submitted' && !closedReturn ? <Pressable accessibilityRole="button" disabled={isReturning} style={styles.outlineButton} onPress={() => void handleNeutralizePendingReturn()}><Text style={styles.outlineButtonText}>Annuler cet envoi</Text></Pressable> : null}
            {returnReceipt?.requestRecorded && returnReceipt.status !== 'closed' && returnReceipt.requestId !== localReturnAttempt.requestId ? <Text style={styles.recourseBody}>Une autre demande de retour existe pour cette commande. Vérifiez cet envoi séparément.</Text> : null}
          </> : null}
          {closedReturn ? <><Text style={styles.recourseBody}>{closedReturn.providerOutcome === 'purchased_unfurnished' ? 'L’étiquette n’a pas pu être fournie. Seconde prend en charge son coût. Contactez notre équipe pour la suite.' : closedReturn.providerOutcome === 'unknown' ? 'L’achat de l’étiquette reste à vérifier. Seconde prend en charge son coût éventuel. Contactez notre équipe pour la suite.' : closedReturn.providerOutcome === 'validation_rejected' ? 'La création de cette étiquette a été refusée.' : 'Cette demande a été annulée avant l’achat de l’étiquette.'}</Text>
            {anotherNativeReturn ? <Text style={styles.recourseBody}>Une autre demande de retour est en cours. Consultez-la après avoir terminé ce suivi.</Text> : null}
            {isBuyer && localReturnAttempt ? <Pressable accessibilityRole="button" disabled={isReturning} style={styles.returnButton} onPress={() => void handleAcknowledgeClosedReturn()}><Text style={styles.returnButtonText}>Terminer ce suivi</Text></Pressable> : null}</> : null}
          {returnLocalQuery.isError ? <Text accessibilityRole="alert" style={styles.recourseBody}>Impossible de retrouver votre dernière demande. Réessayez avant de poursuivre.</Text> : null}
          {!!returnMessage && <Text accessibilityRole="alert" style={styles.recourseBody}>{returnMessage}</Text>}
          {!!returnQuery.error && <Text accessibilityRole="alert" style={styles.recourseBody}>Impossible d’actualiser ce retour pour le moment. Réessayez.</Text>}
          {isReturning && <Text style={styles.recourseBody}>Mise à jour du retour…</Text>}
          {returnQuote && <View style={styles.returnQuoteBox}>
            <Text style={styles.recourseTitle}>Devis de l’étiquette de retour</Text>
            <Text style={styles.recourseBody}>Coût à accepter : {formatPrice(returnQuote.costCents / 100)} CAD.</Text>
            {convenienceQuote ? <>
              <Text style={styles.recourseBody}>Prix de l’article : {formatPrice(convenienceQuote.grossArticleCents / 100)} CAD.</Text>
              <Text style={styles.recourseBody}>Frais de retour déduits du remboursement : {formatPrice(convenienceQuote.returnLabelCostCents / 100)} CAD.</Text>
              <Text style={styles.recourseBody}>{isBuyer ? 'Montant net prévu pour vous' : 'Montant net prévu pour l’acheteur'} : {formatPrice(convenienceQuote.netRefundCents / 100)} CAD. {isBuyer ? 'Débit prévu du vendeur' : 'Débit prévu pour votre vente'} : {formatPrice(convenienceQuote.grossArticleCents / 100)} CAD.</Text>
              <Text style={styles.recourseBody}>Le retour sera déduit du remboursement de l’article. La livraison initiale et les frais de service ne sont pas remboursés.</Text>
            </> : null}
            <Text style={styles.recourseBody}>Transporteur : {returnQuote.carrierName}. Service : {returnQuote.serviceName}.</Text>
            <Text style={styles.recourseBody}>Colis prévu : {returnQuote.parcel.weight.value} kg ; {returnQuote.parcel.dimensions.length} × {returnQuote.parcel.dimensions.width} × {returnQuote.parcel.dimensions.height} cm.</Text>
            <Text style={styles.recourseBody}>Contactez-nous si le format prévu ne convient pas à votre colis de retour.</Text>
            <Text style={styles.recourseBody}>{convenienceQuote ? 'La déduction ne dépassera pas le prix accepté. Si l’étiquette coûte moins cher, la déduction sera réduite.' : 'Ce prix concerne l’étiquette de retour. Le remboursement de l’article sera suivi séparément.'}</Text>
            <Text style={styles.recourseBody}>Une imprimante est nécessaire pour l’étiquette PDF au format 4 × 6 pouces.</Text>
            {returnQuote.depositTerms ? <Text style={styles.recourseBody}>Déposez le retour sous 7 jours calendaires à compter de la mise à disposition de l’étiquette. Une prolongation motivée peut être demandée à notre équipe.</Text> : <Text style={styles.recourseBody}>Contactez notre équipe pour connaître le délai de dépôt de ce retour.</Text>}
            {canConfirmReturnQuote && <>
              <Pressable accessibilityRole="checkbox" accessibilityLabel={`${convenienceQuote ? `J’accepte la déduction de ${formatPrice(convenienceQuote.returnLabelCostCents / 100)} CAD et le remboursement net prévu de ${formatPrice(convenienceQuote.netRefundCents / 100)} CAD` : `J’accepte le devis de retour de ${formatPrice(returnQuote.costCents / 100)} CAD`} et les mesures affichées${returnQuote.depositTerms ? ', ainsi que les conditions affichées de dépôt de sept jours calendaires et de prolongation motivée' : ''}`}
                accessibilityState={{checked: quoteAccepted, disabled: isReturning}} style={styles.returnQuoteConsent}
                disabled={isReturning} onPress={() => {
                  if (!isCurrent() || !returnContext.focused || !canConfirmReturnQuote || isReturning) return;
                  try {assertReturnQuoteSource(); liveQuoteFrame.interaction.invalidate();
                    setQuoteConsent({sourceKey: quoteSourceKey, accepted: !quoteAccepted, revision: (quoteConsent?.revision ?? 0) + 1});
                  } catch { /* An old checkbox cannot grant consent to a changed source. */ }
                }}>
                <Ionicons name={quoteAccepted ? 'checkbox' : 'square-outline'} size={22} color={colors.foreground} />
                <Text style={styles.returnQuoteConsentText}>{convenienceQuote ? `J’accepte les frais de retour de ${formatPrice(convenienceQuote.returnLabelCostCents / 100)} CAD déduits du prix article, pour un remboursement net prévu de ${formatPrice(convenienceQuote.netRefundCents / 100)} CAD, et les mesures affichées.` : 'J’accepte ce devis et les mesures affichées pour la création de cette étiquette.'}{returnQuote.depositTerms ? ' J’accepte aussi les conditions de dépôt de sept jours calendaires et de prolongation motivée affichées.' : ''}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{disabled: !quoteAccepted || isReturning, busy: isReturning}}
                style={[styles.returnButton, (!quoteAccepted || isReturning) && styles.buttonDisabled]}
                disabled={!quoteAccepted || isReturning} onPress={() => {void handleConfirmReturnQuote();}}>
                <Text style={styles.returnButtonText}>Accepter et créer l’étiquette</Text>
              </Pressable>
            </>}
            {returnObservation?.attempt?.phase === 'confirm_submitted' && <Text accessibilityRole="alert" style={styles.recourseBody}>Votre confirmation a été envoyée. Actualisez pour retrouver votre étiquette.</Text>}
          </View>}
          {!returnLabelCommitted && !closedReturn && <Text style={styles.recourseBody}>Votre étiquette n’est pas encore confirmée. Actualisez ce retour.</Text>}
          {returnReceipt?.costResolution ? <><Text style={styles.recourseTitle}>Frais de retour</Text><Text style={styles.recourseBody}>Prix article : {formatPrice(returnReceipt.costResolution.grossArticleCents / 100)} · plafond accepté : {formatPrice(returnReceipt.costResolution.acceptedCostCents / 100)} · coût réel : {formatPrice(returnReceipt.costResolution.actualCostCents / 100)}.</Text><Text style={styles.recourseBody}>Déduction effective : {formatPrice(returnReceipt.costResolution.deductionCents / 100)} · net prévu acheteur : {formatPrice(returnReceipt.costResolution.netRefundCents / 100)} · débit prévu vendeur : {formatPrice(returnReceipt.costResolution.grossArticleCents / 100)} · écart pris en charge par Seconde : {formatPrice(returnReceipt.costResolution.platformVarianceCents / 100)}. Le remboursement est suivi séparément.</Text></> : null}
          {returnLabelCommitted && <>
            <Text style={styles.recourseBody}>{deliveryCorrection || obligation ? 'Contactez notre équipe avant de déposer ce retour.' : returnReceipt?.shippingPermissionGranted === true && returnReceipt?.currentOrderStatus === 'return_requested' && returnRecordedAndFrozen ?
              'Votre étiquette de retour est disponible.' :
              'Étiquette du retour précédent.'}</Text>
            <Text style={styles.recourseBody}>Coût de l’étiquette créée : {formatPrice(returnReceipt!.returnLabelCost!)}. Le remboursement éventuel doit être confirmé séparément dans le suivi.</Text>
          </>}
          {transaction.returnDeliveredAt && <Text style={styles.recourseBody}>Le transporteur a signalé la livraison du retour.</Text>}
          {returnLabelCommitted && returnReceipt?.returnTrackingNumber && (
            <View style={styles.trackingNumberContainer}>
              <Text style={styles.trackingNumberLabel}>Suivi du retour :</Text>
              <Text style={styles.trackingNumber}>{returnReceipt.returnTrackingNumber}</Text>
            </View>
          )}

          {isBuyer && returnLabelCommitted && (
            <Pressable accessibilityRole="button" accessibilityState={{disabled: isReadingLabelDocument || returnQuery.isFetching || isReturning, busy: isReadingLabelDocument}}
              disabled={isReadingLabelDocument || returnQuery.isFetching || isReturning} style={styles.returnLabelButton} onPress={() => {void handleOpenReturnLabel();}}>
              <Ionicons name="download-outline" size={18} color={colors.cream} />
              <Text style={styles.returnLabelButtonText}>{isReadingLabelDocument && currentLabelDocumentState?.direction === 'return' ? 'Lecture du document…' : 'Voir l’étiquette de retour'}</Text>
            </Pressable>
          )}
          {historicalReturnDocument && <>
            <Text style={styles.recourseBody}>Étiquette d’un retour précédent.</Text>
            {historicalReturnDocument.trackingNumber ? <Text style={styles.recourseBody}>Suivi enregistré : {historicalReturnDocument.trackingNumber}</Text> : null}
            {isBuyer ? <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={() => {void handleOpenHistoricalReturnDocument();}}
              accessibilityState={{disabled: isReturning || returnQuery.isFetching || isReadingLabelDocument, busy: isReadingLabelDocument}}
              disabled={isReturning || returnQuery.isFetching || isReadingLabelDocument}>
              <Text style={styles.outlineButtonText}>Ouvrir l’ancienne étiquette</Text>
            </Pressable> : null}
          </>}
          {labelDocumentMessage && currentLabelDocumentState?.direction === 'return' ? <Text accessibilityRole="alert" style={styles.recourseBody}>{labelDocumentMessage}</Text> : null}
          <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={isReturning || returnQuery.isFetching} onPress={() => {void handleReadReturn();}}>
            <Text style={styles.outlineButtonText}>{returnQuery.isFetching ? 'Actualisation…' : 'Actualiser le retour'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={() => {if (isCurrent() && returnContext.focused) openHumanRecourse();}}>
            <Text style={styles.outlineButtonText}>Contacter l’équipe pour ce retour</Text>
          </Pressable>
        </View>
      );

  const reportReasonSheet = (<RecourseReasonSheet<ReportReasonCode>
        ref={reportSheetRef}
        draftScope={uid ? {uid, transactionId: transaction.id, purpose: 'report'} : undefined}
        title="Signaler un problème"
        intro="Que s’est-il passé ?"
        reasons={REPORT_REASON_OPTIONS}
        showDetailsField
        wholeSetSource={wholeSetSource}
        detailsMaxLength={1000}
        submitLabel="Envoyer le signalement"
        isSubmitting={isReporting}
        locked={!!pendingReport}
        onSubmit={handleSubmitReport}
      />);
  const returnReasonSheet = (<RecourseReasonSheet<ReturnReasonCode>
        ref={returnSheetRef}
        title="Demander un retour"
        intro="Choisissez le motif. Vous pourrez consulter et accepter le prix de l’étiquette avant sa création."
        reasons={RETURN_REASON_OPTIONS}
        footerNote={{
          title: 'Frais et remboursement du retour',
          body: 'Le prix de l’étiquette sera affiché avant votre confirmation.',
        }}
        submitLabel="Déposer la demande et voir le devis"
        isSubmitting={isReturning}
        onSubmit={handleSubmitReturn}
      />);
  if (tool === 'report') return <View style={styles.container}>
    {reportRecovery}
    {!pendingReport && (returnQuery.isFetching || policyQuery.isFetching || reportQuery.isFetching) ? <Text style={styles.recourseBody}>Chargement du signalement…</Text> : null}
    {isBuyer && isReportable && reportSourceReady && !pendingReport ? <Pressable accessibilityRole="button" style={styles.returnButton}
      disabled={isReporting} onPress={openReportSheet}><Text style={styles.returnButtonText}>Décrire le problème</Text></Pressable> : null}
    <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={openHumanRecourse}><Text style={styles.outlineButtonText}>Contacter notre équipe</Text></Pressable>
    {reportReasonSheet}
  </View>;
  if (tool === 'return') return <View style={styles.container}>
    {returnState}
    {canRequestReturn ? <Pressable accessibilityRole="button" style={styles.returnButton} disabled={isReturning} onPress={openReturnSheet}>
      <Text style={styles.returnButtonText}>Choisir le motif du retour</Text></Pressable> : null}
    {!returnState && !canRequestReturn ? <Text style={styles.recourseBody}>{returnQuery.isFetching || returnLocalQuery.isFetching || policyQuery.isFetching ? 'Chargement du retour…' : 'Contactez notre équipe pour organiser ce retour.'}</Text> : null}
    <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={openHumanRecourse}><Text style={styles.outlineButtonText}>Contacter notre équipe</Text></Pressable>
    {returnReasonSheet}
  </View>;

  const carrierInfo = getCarrierStatusInfo(transaction);

  // ---------------------------------------------------------------------------
  // MEETUP transactions (deliveryType !== 'shipping')
  //
  // There is no carrier shipment to track, but a meetup order CAN still be hit
  // by an automated decision — typically `transaction_expired` (annulation
  // automatique du meetup) or `funds_released`. Loi 25 art. 12.1 requires the
  // contestation path to be reachable here too. We therefore render ONLY the
  // automated-decision transparency + contestation block (never the shipping
  // timeline / carrier card / label buttons, which would be meaningless), plus
  // the contest reason sheet it drives. When no automated decision applies, we
  // render nothing so the chat header stays clean.
  // ---------------------------------------------------------------------------
  if (transaction.deliveryType !== 'shipping') {
    if (!hasAutomatedDecision || !decisionType) {
      return <View style={styles.container}>
        {reportRecovery}
        {contestRecovery}
        <RefundStatusNotice transaction={transaction} perspective={isBuyer ? 'buyer' : 'seller'} />
        <Text style={styles.statusDescriptionLine}>{perspectiveDescription}</Text>
        <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={() => openHumanRecourse()}>
          <Text style={styles.outlineButtonText}>Contacter l’équipe</Text>
        </Pressable>
      </View>;
    }
    return (
      <View style={styles.container}>
        {reportRecovery}
        {contestRecovery}
        <View style={styles.automatedBox}>
          <View style={styles.recourseHeader}>
            <Ionicons name="hardware-chip-outline" size={20} color={colors.foreground} />
            <Text style={styles.recourseTitle}>{getDecisionTitle(decisionType)}</Text>
          </View>

          <Text style={styles.recourseBody}>{latestDecision?.result || 'Une décision concerne cette commande.'}</Text>
          {decisionDateLabel ? <Text style={styles.recourseBody}>Date consignée : {decisionDateLabel}.</Text> : null}
          <Text style={styles.recourseBody}>Vous pouvez demander à notre équipe de réexaminer cette décision.</Text>

          {/* Accessible explanation — "Pourquoi cette décision ?" */}
          <Pressable
            style={styles.explanationToggle}
            onPress={toggleExplanation}
            hitSlop={6}
          >
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={colors.primary}
            />
            <Text style={styles.explanationToggleText}>Pourquoi cette décision ?</Text>
            <Ionicons
              name={isExplanationOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.primary}
            />
          </Pressable>

          {isExplanationOpen && (
            <View style={styles.explanationContent}>
              <Text style={styles.explanationText}>
                {getDecisionExplanation(decisionType)}
              </Text>
              {criteriaRows.length > 0 && (
                <View style={styles.criteriaList}>
                  {criteriaRows.map((row) => (
                    <View key={row.key} style={styles.criteriaRow}>
                      <Text style={styles.criteriaLabel}>{row.label}</Text>
                      <Text style={styles.criteriaValue}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Contester cette décision — opens a human-review request */}
          <Pressable
            style={[styles.outlineButton, isContesting && styles.buttonDisabled]}
            onPress={openContestSheet}
            disabled={isContesting}
          >
            {isContesting ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <>
                <Ionicons name="flag-outline" size={16} color={colors.foreground} />
                <Text style={styles.outlineButtonText}>Contester cette décision</Text>
              </>
            )}
          </Pressable>
        </View>

        <RecourseReasonSheet<ContestReasonCode>
          ref={contestSheetRef}
          key={latestDecision ? JSON.stringify([uid, generation, latestDecision.id, latestDecision.revision, latestDecision.sourceHash]) : 'no-decision'}
          draftScope={uid && latestDecision?.id ? {uid, transactionId: transaction.id, purpose: `contest_${latestDecision.id}`} : undefined}
          title="Contester cette décision"
          intro="Expliquez pourquoi vous souhaitez faire réexaminer cette décision."
          reasons={CONTEST_REASON_OPTIONS}
          showDetailsField
          detailsMaxLength={3800}
          submitLabel="Demander une révision humaine"
          isSubmitting={isContesting}
          locked={!!pendingContest || otherIntentionPending}
          onSubmit={handleSubmitContest}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cube-outline" size={24} color={colors.foreground} />
          <Text style={styles.headerTitle}>Suivi de livraison</Text>
        </View>
        <Pressable
          onPress={handleRefresh}
          disabled={isRefreshing}
          style={styles.refreshButton}
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons
              name="refresh"
              size={20}
              color={colors.primary}
            />
          )}
        </Pressable>
      </View>

      {/* Perspective-aware status line (buyer/seller) */}
      <Text style={styles.statusDescriptionLine}>{perspectiveDescription}</Text>
      {/* Carrier status card */}
      <View style={[styles.statusCard, { borderLeftColor: carrierInfo.color }]}>
        <View style={styles.statusIconContainer}>
          <View style={[styles.statusIconBg, { backgroundColor: colors.surfaceWarm }]}>
            <Ionicons name={carrierInfo.icon} size={28} color={carrierInfo.color} />
          </View>
        </View>

        <View style={styles.statusContent}>
          <Text style={[styles.statusLabel, { color: carrierInfo.color }]}>
            {deliveryCorrection ? 'Suivi corrigé · réexamen' : carrierInfo.label}
          </Text>
          <Text style={styles.statusDescription}>{deliveryCorrection ? 'La livraison enregistrée reste dans l’historique. Le suivi actuel et la situation des fonds doivent être examinés.' : carrierInfo.description}</Text>

          {transaction.trackingNumber && (
            <View style={styles.trackingNumberContainer}>
              <Text style={styles.trackingNumberLabel}>Numéro de suivi :</Text>
              <Text style={styles.trackingNumber}>{transaction.trackingNumber}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        {transaction.trackingUrl && transaction.carrierCode !== 'seconde_dev' && (
          <Pressable accessibilityRole="button" accessibilityLabel="Ouvrir le suivi du transporteur" style={styles.actionButton} onPress={handleOpenTracking}>
            <Ionicons name="open-outline" size={18} color={colors.primary} />
            <Text style={styles.actionButtonText}>Suivre en ligne</Text>
          </Pressable>
        )}

        {uid === transaction.sellerId && (transaction.shipEngineLabelId || transaction.shippingLabelUrl) && (
          <Pressable accessibilityRole="button" accessibilityLabel="Consulter le document actuel de l’étiquette aller" accessibilityHint="La consultation du document ne confirme pas une autorisation d’expédier"
            accessibilityState={{disabled: isReadingLabelDocument || !labelContext.focused, busy: isReadingLabelDocument}}
            disabled={isReadingLabelDocument || !labelContext.focused} style={styles.actionButton} onPress={() => {void handleDownloadLabel();}}>
            <Ionicons name="download-outline" size={18} color={colors.primary} />
            <Text style={styles.actionButtonText}>{isReadingLabelDocument && currentLabelDocumentState?.direction === 'forward' ? 'Lecture du document…' : 'Consulter l’étiquette aller'}</Text>
          </Pressable>
        )}
      </View>
      {labelDocumentMessage && currentLabelDocumentState?.direction === 'forward' ? <Text accessibilityRole="alert" style={styles.recourseBody}>{labelDocumentMessage}</Text> : null}

      {/* Timeline */}
      <View style={styles.timeline}>
        {(!!transaction.paidAt || (transaction.capturedCardCents ?? 0) > 0 || (transaction.walletPaidAmount ?? 0) > 0) && <View style={styles.timelineItem}>
          <View style={[styles.timelineDot, styles.timelineDotCompleted]} />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Paiement confirmé</Text>
            {transaction.paidAt && (
              <Text style={styles.timelineDate}>
                {transaction.paidAt.toLocaleDateString(APP_LOCALE)}
              </Text>
            )}
          </View>
        </View>}

        {/* Label created — distinct from shipping (before first carrier scan) */}
        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.labelCreatedAt || transaction.shippedAt
                ? styles.timelineDotCompleted
                : transaction.status === 'label_created'
                  ? styles.timelineDotActive
                  : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Étiquette créée</Text>
            {transaction.labelCreatedAt && (
              <Text style={styles.timelineDate}>
                {transaction.labelCreatedAt.toLocaleDateString(APP_LOCALE)}
              </Text>
            )}
            {!transaction.labelCreatedAt && transaction.status === 'label_created' && (
              <Text style={styles.timelineActive}>Bientôt en route</Text>
            )}
          </View>
        </View>

        {/* Shipped — first carrier scan */}
        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.shippedAt
                ? styles.timelineDotCompleted
                : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Expédition enregistrée dans l’app</Text>
            {transaction.shippedAt && (
              <Text style={styles.timelineDate}>
                Enregistrée le {transaction.shippedAt.toLocaleDateString(APP_LOCALE)}
              </Text>
            )}
          </View>
        </View>

        {/* In transit */}
        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.trackingStatus === 'IN_TRANSIT' ||
              transaction.trackingStatus === 'TRANSIT'
                ? styles.timelineDotActive
                : transaction.deliveredAt
                  ? styles.timelineDotCompleted
                  : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>En transit</Text>
            {(transaction.trackingStatus === 'IN_TRANSIT' ||
              transaction.trackingStatus === 'TRANSIT') && (
              <Text style={styles.timelineActive}>En cours</Text>
            )}
          </View>
        </View>

        {/* Delivered */}
        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.deliveredAt
                ? styles.timelineDotCompleted
                : transaction.trackingStatus === 'OUT_FOR_DELIVERY'
                  ? styles.timelineDotActive
                  : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>{deliveryCorrection ? 'Livraison enregistrée dans l’historique' : 'Livré'}</Text>
            {transaction.deliveredAt && (
              <Text style={styles.timelineDate}>
                {transaction.deliveredAt.toLocaleDateString(APP_LOCALE)}
              </Text>
            )}
          </View>
        </View>
      </View>

      <DevShippingControls transaction={transaction} onStatusUpdate={() => { onStatusUpdate?.(); void returnQuery.refetch(); }} />

      <View style={styles.recourseBox}>
      <Text accessibilityRole="header" style={styles.recourseTitle}>Dates clés</Text>
        {!policySourceReady ? <Text style={styles.recourseBody}>{policyQuery.isError ? 'Impossible de vérifier les délais de cette commande.' : 'Chargement des délais…'}</Text> : policyTimeline ? <>
          {policyTimeline.parameters ? <Text style={styles.recourseBody}>Protection acheteur : {policyTimeline.parameters.deliveryProtectionMs / 86400000} jours après la livraison. Fonds retenus pendant {policyTimeline.parameters.fundsHoldMs / 86400000} jours.</Text> : null}
          {policyTimeline.paymentClockBasis === 'qualified_payment_recorded_at' ? <>
            <Text style={styles.recourseBody}>Expédition prévue avant le {policyDateLabel(policyTimeline.nonShipmentExpiresAtMs)}, heure du Québec.</Text>
          </> : null}
          {policyTimeline.deliveryEventAtMs !== null ? <>
            <Text style={styles.recourseBody}>Livraison signalée le {policyDateLabel(policyTimeline.deliveryEventAtMs)}.</Text>
            <Text style={styles.recourseBody}>Protection jusqu’au {policyDateLabel(policyTimeline.deliveryProtectionEndsAtMs)}, heure du Québec.</Text>
          </> : null}
          {policyTimeline.fundsReleaseAtMs !== null ? <Text style={styles.recourseBody}>Libération des fonds prévue à partir du {policyDateLabel(policyTimeline.fundsReleaseAtMs)}, selon l’état de la commande.</Text> : null}
          {policyTimeline.fundsReleaseAtMs !== null && !deliveryStateUnread && !deadlineMatchesOrder ? <Text style={styles.recourseBody}>La date de disponibilité des fonds doit être vérifiée.</Text> : null}
          {policyTimeline.reviewRequired ? <Text style={styles.recourseBody}>{POLICY_REVIEW_MESSAGES[policyTimeline.reviewReason ?? ''] ?? 'Notre équipe doit vérifier les délais de cette commande.'}</Text> : null}
        </> : null}
        <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={policyQuery.isFetching || returnQuery.isFetching}
          onPress={() => {if (!isCurrent()) return; try {returnContext.capture(); revokeReturnQuoteConsent();} catch {return;} void policyQuery.refetch(); void returnQuery.refetch();}}>
          <Text style={styles.outlineButtonText}>Actualiser les délais</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={() => {if (isCurrent()) openHumanRecourse();}}>
          <Text style={styles.outlineButtonText}>Demander un examen à notre équipe</Text>
        </Pressable>
      </View>

      {uid ? <LabelDepositDeadlinePanel uid={uid} transactionId={transaction.id} scope="owner"
        sourceKey={JSON.stringify([transaction.status, transaction.shipEngineLabelId, transaction.trackingStatus, policyTimeline?.nonShipmentExpiresAtMs ?? null])} /> : null}
      <RefundStatusNotice transaction={transaction} perspective={isBuyer ? 'buyer' : 'seller'} />
      <LateTransportIncidentNotice transactionId={transaction.id} sourceKey={JSON.stringify([transaction.status, transaction.trackingStatus,
        transaction.refund?.state ?? null, transaction.shipEngineLabelId ?? null])} showEmpty={transaction.refund != null || transaction.refundedAt != null ||
        ['refunded', 'refund_in_progress', 'refund_action_required'].includes(transaction.status)} />
      <BuyerReceiptDeclaration transactionId={transaction.id} onHumanRecourse={openHumanRecourse} />
      <ReturnToSenderNotice transactionId={transaction.id} sourceKey={JSON.stringify([transaction.status, transaction.trackingStatus, transaction.refund?.state ?? null, transaction.shipEngineLabelId ?? null])} />
      {correctionObservation?.correctionResolution.state === 'resolved_current' ? <><TransportReviewEvidence source={correctionObservation} />
        <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={effectivePolicyQuery.isFetching || correctionQuery.isFetching} onPress={() => {void correctionQuery.refetch(); void effectivePolicyQuery.refetch();}}><Text style={styles.outlineButtonText}>Relire la politique et les gardes actuelles</Text></Pressable>
        {correctedWindowRequired && !correctedPolicy ? <Text style={styles.recourseBody}>Contactez notre équipe avant de faire une nouvelle demande de retour.</Text> : null}
        {correctedPolicy && (!correctedPolicy.canReportProblemNow || !correctedPolicy.canPrepareReturnNow) ? <Text style={styles.recourseBody}>Certaines actions sont indisponibles pendant l’examen de cette commande.</Text> : null}
      </> : null}
      <ObservedTrackingHistory transaction={transaction} leg="forward" />
      {returnAlreadyExposed || transaction.returnLabelId ? <ObservedTrackingHistory transaction={freshReturnOrder ?? transaction} leg="return" /> : null}
      <LabelLifecycleOrderEntry transactionId={transaction.id} leg="forward" sourceKey={JSON.stringify([transaction.status, transaction.trackingStatus, transaction.shipEngineLabelId, transaction.refund?.state])} />
      <LabelLifecycleOrderEntry transactionId={transaction.id} leg="return" sourceKey={JSON.stringify([transaction.status, transaction.returnLabelId, transaction.refund?.state])} />
      {deliveryCorrection ? <View style={styles.recourseBox}>
        <View style={styles.recourseHeader}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
          <Text style={styles.recourseTitle}>Correction de livraison à examiner</Text>
        </View>
        <Text style={styles.recourseBody}>{deliveryCorrection.message}</Text>
        <Pressable accessibilityRole="button" style={styles.outlineButton} disabled={correctionQuery.isFetching} onPress={() => {void correctionQuery.refetch(); void effectivePolicyQuery.refetch();}}><Text style={styles.outlineButtonText}>Relire la résolution actuelle</Text></Pressable>
        {!deliveryCorrection.qualified ? <Text style={styles.recourseBody}>La correction du suivi doit encore être vérifiée par notre équipe.</Text> : null}
        {deliveryCorrection.detectedAt ? <Text style={styles.recourseBody}>Correction enregistrée le {deliveryCorrection.detectedAt.toLocaleDateString(APP_LOCALE)}.</Text> : null}
        <Text style={styles.recourseBody}>Les dates et documents précédents restent dans l’historique. La correction ne confirme pas un remboursement, une reprise des fonds ou une autorisation d’expédier à nouveau.</Text>
        <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={() => { if (isCurrent() && returnContext.focused) openHumanRecourse(); }}>
          <Text style={styles.outlineButtonText}>Contacter l’équipe pour cette correction</Text>
        </Pressable>
      </View> : null}
      <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={() => openHumanRecourse()}>
        <Text style={styles.outlineButtonText}>Contacter l’équipe</Text>
      </Pressable>
      {transaction.deliveryType === 'shipping' && !!uid && (uid === transaction.buyerId || uid === transaction.sellerId) ? <View style={styles.preparationBox}>
        {transportObservation?.qualification === 'accepted_snapshot' && transportObservation.terms ? <ShippingTransportTerms
          terms={transportObservation.terms} historical assertCurrent={assertTransportSource} onSupport={openHumanRecourse}/>
          : <><Text style={styles.recourseTitle}>Informations de livraison</Text>
            <Text style={styles.recourseBody}>{transportQuery.isFetching ? 'Chargement des informations de livraison…' :
              transportObservation?.qualification === 'historical_terms_not_recorded' ? 'Contactez notre équipe pour connaître les modalités de cette ancienne commande.' :
                'Les modalités de livraison sont indisponibles. Contactez notre équipe avant d’expédier.'}</Text>
            <Pressable accessibilityRole="button" style={styles.outlineButton} onPress={() => {try {assertTransportFrame(); openHumanRecourse();} catch {/* Old instruction cannot navigate. */}}}><Text style={styles.outlineButtonText}>Demander une instruction pour ce transport</Text></Pressable>
          </>}
        <Pressable accessibilityRole="button" disabled={transportQuery.isFetching || !transportContext.focused}
          accessibilityState={{disabled: transportQuery.isFetching || !transportContext.focused, busy: transportQuery.isFetching}}
          style={styles.outlineButton} onPress={() => {try {assertTransportFrame(); void transportQuery.refetch();} catch {/* Old context cannot refresh. */}}}>
          <Text style={styles.outlineButtonText}>Actualiser la livraison</Text>
        </Pressable>
      </View> : null}

      {uid === transaction.sellerId && <View style={styles.preparationBox}>
        <Text accessibilityRole="header" style={styles.recourseTitle}>Préparer le colis</Text>
        {preparation ? <>
          <Text selectable style={styles.recourseBody}>Commande : {transaction.id}</Text>
          <Text selectable style={styles.recourseBody}>{preparation.title}</Text>
          <Text selectable style={styles.recourseBody}>Destinataire prévu : {preparation.recipient}</Text>
          <Text selectable style={styles.recourseBody}>{preparation.address}</Text>
          <Text selectable style={styles.recourseBody}>Suivi enregistré : {preparation.trackingNumber}</Text>
        </> : <Text style={styles.recourseBody}>{preparationQuery.isFetching ? 'Chargement du colis…' :
          'Impossible de vérifier les informations du colis. Contactez notre équipe avant d’expédier.'}</Text>}
        <Text style={styles.recourseBody}>Utilisez un colis propre et sec, avec une protection adaptée à l’article. Retirez les anciennes étiquettes. Comparez l’article prévu, le destinataire et le suivi avant d’associer cette étiquette au colis.</Text>
        <Text style={styles.recourseBody}>Un colis et une étiquette par commande. Imprimez l’étiquette au format 4 × 6 pouces.</Text>
        <Text style={styles.recourseBody}>Si la commande est suspendue, retournée ou annulée, contactez notre équipe avant d’expédier.</Text>
        <Pressable accessibilityRole="button" accessibilityState={{disabled: preparationQuery.isFetching, busy: preparationQuery.isFetching}}
          disabled={preparationQuery.isFetching} style={styles.outlineButton} onPress={() => {
            if (isCurrent() && returnContext.focused) void preparationQuery.refetch();
          }}>
          <Text style={styles.outlineButtonText}>Actualiser le colis</Text>
        </Pressable>
      </View>}
      <View style={styles.preparationBox}>
        <Text accessibilityRole="header" style={styles.recourseTitle}>Si le colis ou l’article est endommagé</Text>
        <Text style={styles.recourseBody}>Conservez l’emballage et prenez des photos du colis, de l’étiquette et de l’article. Signalez le problème depuis cette commande.</Text>
      </View>

      {/* Delivered — funds-protection note (held 7 days) */}
      {isDelivered && !obligation && !returnAlreadyExposed && !deliveryCorrection && !deliveryStateUnread && (
        <View style={styles.protectionNote}>
          <Ionicons name="shield-checkmark" size={20} color={colors.success} />
          <Text style={styles.protectionNoteText}>
            {qualifiedDeadline !== null
              ? `Libération des fonds prévue à partir du ${policyDateLabel(qualifiedDeadline)}, selon l’état de la commande.`
              : 'La date de disponibilité des fonds doit être vérifiée. Contactez notre équipe.'}
          </Text>
        </View>
      )}

      {/* Automated decision (Loi 25, art. 12.1) — transparency + contestation */}
      {hasAutomatedDecision && decisionType && (
        <View style={styles.automatedBox}>
          <View style={styles.recourseHeader}>
            <Ionicons name="hardware-chip-outline" size={20} color={colors.foreground} />
            <Text style={styles.recourseTitle}>{getDecisionTitle(decisionType)}</Text>
          </View>

          {/* Juriste notification text (decision moment) */}
          <Text style={styles.recourseBody}>{latestDecision?.result || 'Une décision concerne cette commande.'}</Text>
          {decisionDateLabel ? <Text style={styles.recourseBody}>Date consignée : {decisionDateLabel}.</Text> : null}
          <Text style={styles.recourseBody}>Vous pouvez demander à notre équipe de réexaminer cette décision.</Text>

          {/* Accessible explanation — "Pourquoi cette décision ?" */}
          <Pressable
            style={styles.explanationToggle}
            onPress={toggleExplanation}
            hitSlop={6}
          >
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={colors.primary}
            />
            <Text style={styles.explanationToggleText}>Pourquoi cette décision ?</Text>
            <Ionicons
              name={isExplanationOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.primary}
            />
          </Pressable>

          {isExplanationOpen && (
            <View style={styles.explanationContent}>
              <Text style={styles.explanationText}>
                {getDecisionExplanation(decisionType)}
              </Text>
              {criteriaRows.length > 0 && (
                <View style={styles.criteriaList}>
                  {criteriaRows.map((row) => (
                    <View key={row.key} style={styles.criteriaRow}>
                      <Text style={styles.criteriaLabel}>{row.label}</Text>
                      <Text style={styles.criteriaValue}>{row.value}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Contester cette décision — opens a human-review request */}
          <Pressable
            style={[styles.outlineButton, isContesting && styles.buttonDisabled]}
            onPress={openContestSheet}
            disabled={isContesting}
          >
            {isContesting ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <>
                <Ionicons name="flag-outline" size={16} color={colors.foreground} />
                <Text style={styles.outlineButtonText}>Contester cette décision</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      {/* Commercial delivered context + buyer — report a problem. */}
      {isReportable && isBuyer && (
        <Pressable
          style={[styles.outlineButton, isReporting && styles.buttonDisabled]}
          onPress={openReportSheet}
          disabled={isReporting}
        >
          <Ionicons name="flag-outline" size={16} color={colors.foreground} />
          <Text style={styles.outlineButtonText}>Signaler un problème</Text>
        </Pressable>
      )}

      {/* Delivered + buyer — return-request entry (return fees on buyer) */}
      {canRequestReturn && (
        <Pressable
          style={[styles.returnButton, isReturning && styles.buttonDisabled]}
          onPress={openReturnSheet}
          disabled={isReturning}
        >
          <Ionicons name="arrow-undo-outline" size={16} color={colors.foreground} />
          <Text style={styles.returnButtonText}>Demander un retour</Text>
        </Pressable>
      )}

      {returnState}

      {/* delivery_failed / lost — buyer recourse encart */}
      {isRecourse && isBuyer && !obligation && !deliveryCorrection && (
        <View style={styles.recourseBox}>
          <View style={styles.recourseHeader}>
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={styles.recourseTitle}>
              Incident de livraison à examiner
            </Text>
          </View>
          <Text style={styles.recourseBody}>
            Le suivi signale un incident. Ce statut seul ne confirme pas une perte définitive, un gel des fonds ou un remboursement. Déposez une demande liée à cette commande pour que l’équipe examine la livraison et les faits.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={[styles.recourseButton, styles.recourseButtonSecondary, (isReporting || isReturning || !returnContext.focused) && styles.buttonDisabled]}
            onPress={openHumanRecourse}
            disabled={isReporting || isReturning || !returnContext.focused}
          >
            <Text style={styles.recourseButtonSecondaryText}>Contacter notre équipe</Text>
          </Pressable>
        </View>
      )}

      {/* Reason sheets — mounted only while open (handled internally) */}
      {reportRecovery}
      {contestRecovery}
      {reportReasonSheet}
      {returnReasonSheet}
      <RecourseReasonSheet<ContestReasonCode>
        ref={contestSheetRef}
          key={latestDecision ? JSON.stringify([uid, generation, latestDecision.id, latestDecision.revision, latestDecision.sourceHash]) : 'no-decision'}
          draftScope={uid && latestDecision?.id ? {uid, transactionId: transaction.id, purpose: `contest_${latestDecision.id}`} : undefined}
        title="Contester cette décision"
        intro="Expliquez pourquoi vous souhaitez faire réexaminer cette décision."
        reasons={CONTEST_REASON_OPTIONS}
        showDetailsField
        detailsMaxLength={3800}
        submitLabel="Demander une révision humaine"
        isSubmitting={isContesting}
          locked={!!pendingContest || otherIntentionPending}
        onSubmit={handleSubmitContest}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  preparationBox: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  returnQuoteBox: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  returnQuoteConsent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  returnQuoteConsentText: {
    flex: 1,
    fontFamily: fonts.sans,
    color: colors.foreground,
  },
  container: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  refreshButton: {
    padding: spacing.xs,
  },
  statusDescriptionLine: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.foregroundSecondary,
    marginBottom: spacing.md,
  },
  statusCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 4,
  },
  statusIconContainer: {
    marginRight: spacing.md,
  },
  statusIconBg: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContent: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 18,
    fontFamily: fonts.sansBold,
    marginBottom: spacing.xs,
  },
  statusDescription: {
    fontSize: 14,
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
  },
  trackingNumberContainer: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  trackingNumberLabel: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  trackingNumber: {
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  timeline: {
    marginBottom: spacing.md,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
    marginTop: spacing.xs,
    marginRight: spacing.md,
  },
  timelineDotCompleted: {
    backgroundColor: colors.success,
  },
  timelineDotActive: {
    backgroundColor: colors.primary,
  },
  timelineDotPending: {
    backgroundColor: colors.border,
  },
  timelineContent: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginBottom: 2,
  },
  timelineDate: {
    fontSize: 12,
    color: colors.muted,
  },
  timelineActive: {
    fontSize: 12,
    color: colors.primary,
    fontFamily: fonts.sansMedium,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionButtonText: {
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
  protectionNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    gap: spacing.sm,
  },
  protectionNoteText: {
    flex: 1,
    fontSize: 13,
    color: colors.success,
    fontFamily: fonts.sansMedium,
    lineHeight: 18,
  },
  returnButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
  },
  returnButtonText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
  },
  outlineButtonText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  returnStateBox: {
    backgroundColor: colors.warningLight,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  returnLabelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.rust,
  },
  returnLabelButtonText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.cream,
    letterSpacing: 0.3,
  },
  recourseBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  automatedBox: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  explanationToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  explanationToggleText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.primary,
  },
  explanationContent: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  explanationText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.foregroundSecondary,
  },
  criteriaList: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  criteriaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  criteriaLabel: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
  },
  criteriaValue: {
    flexShrink: 0,
    maxWidth: '50%',
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.foreground,
    textAlign: 'right',
  },
  recourseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recourseTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  recourseBody: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.foregroundSecondary,
    fontFamily: fonts.sans,
  },
  recourseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
  },
  recourseButtonPrimary: {
    backgroundColor: colors.danger,
  },
  recourseButtonPrimaryText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.white,
    letterSpacing: 0.3,
  },
  recourseButtonSecondary: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  recourseButtonSecondaryText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.danger,
    letterSpacing: 0.3,
  },
});

export default ShipmentTracking;
