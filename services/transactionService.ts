import { ShippingPurchaseService } from '@/services/shippingPurchaseService';
import type { ShippingPurchaseAddress, ShippingReservationInput, ShippingReservationReceipt } from '@/types/shippingPurchase';
import {
  collection,
  doc,
  documentId,
  onSnapshot,
  startAfter,
  type QueryConstraint,
  getDoc,
  getDocFromServer,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  Timestamp,
} from 'firebase/firestore';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { auth, firestore, functions } from '../config/firebaseConfig';
import { IssueRefundResult, MeetupSpot, ShippingAddress, Transaction } from '../types';
import { hasBankObligation, hasUnsettledRefund } from '@/utils/refundPresentation';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import type { HistoricalReturnDocument, PendingCancellationResult, ReturnRequestAttempt, PhysicalReturnReason, ReturnRequestResult, ReturnRequestStatus, ReturnShippingQuote } from '@/types/transaction';
import {returnDepositTermsPair} from '@/utils/returnDepositDeadlineContract';
import {RETURN_DEPOSIT_TERMS_HASH} from '@/types/returnDepositDeadline';
import { rememberDisputeResolutionAttempt, runDisputeResolution, validDisputeResolutionAttempt,
  type DisputeResolutionAttempt, type DisputeResolutionOutcome } from '@/services/disputeResolutionJournal';
import { adminFinancialInput, parseAdminFinancialPreview, parseAdminFinancialDecision, rememberAdminFinancialAttempt,
  runAdminFinancialDecision, validAdminFinancialAttempt, isAdminReturnToSenderFinancialResume, type AdminFinancialPreview, type AdminFinancialAttempt,
  type AdminFinancialDecision } from '@/services/adminFinancialDecisionJournal';
import type { AdminReturnToSenderFinancialResume } from '@/types/adminReturnToSenderFinancial';
import { adminProductFinancialReference, isAdminProductFinancialReference, productFinancialCaseId } from '@/services/adminProductFinancialSource';
import { isLateCommercialReference } from '@/services/lateCommercialRecourseService';
import type { LateCommercialReference } from '@/types/lateCommercialRecourse';
import { productReviewEqual, productReviewHash } from '@/services/productReviewService';
import type {ConvenienceReturnReference, ConvenienceReturnTerminal} from '@/types/convenienceReturn';
import {convenienceHash, isConvenienceReturnReference, isConvenienceReturnFinancialTerms, isConvenienceReturnTerminal, isConvenienceReturnVarianceResolution} from '@/utils/convenienceReturnContract';
import type { ProductCommercialReturnReference } from '@/types/productCommercialReturn';
import type { PurchaseRefundAllocation } from '@/types/purchaseRefund';
import { isPurchaseRefundAllocation, purchaseRefundCanonical } from '@/utils/purchaseRefundContract';
import { cashCaseInput, parseCashCasePreview, parseCashCaseDecision, runCashCaseDecision, validCashCaseAttempt, rememberCashCaseAttempt,
  type CashCaseAttempt, type CashCaseDecision, type CashCasePreview } from '@/services/cashCaseDecisionJournal';
import { TransactionProblemJournal } from '@/services/transactionProblemJournal';
import type { TransactionProblemReason, WholeSetDeclaration } from '@/types/transactionProblem';
import { TransportReviewService, hasCurrentNativeCorrectionResolution } from '@/services/transportReviewService';
import type { TransportReviewObservation } from '@/types/transportReview';

/**
 * Every `Transaction` field stored as a Firestore `Timestamp` that the app
 * consumes as a JS `Date`. Centralized so every read path converts the SAME
 * set — components (ShipmentTracking, Timeline) expect `Date`, never raw
 * `Timestamp`, otherwise calls like `toLocaleDateString()` crash.
 */
const TRANSACTION_DATE_FIELDS = [
  'meetupConfirmedAt',
  'meetupCompletedAt',
  'fundsReleaseAt',
  'fundsReleasedAt',
  'disputeClosedAt',
  'shippingReconciledAt',
  'lastLabelAttemptAt',
  'labelCreatedAt',
  'labelStaleNudgedAt',
  'deliveryFailedAt',
  'stripeRefundIssuedAt',
  'refundStartedAt',
  'paidAt',
  'shippedAt',
  'deliveredAt',
] as const;

/**
 * Maps a raw Firestore transaction document into a typed `Transaction`,
 * converting every `Timestamp` field to a `Date`. `createdAt` always resolves
 * to a `Date` (falls back to `new Date(0)` when missing so sorting stays
 * stable); optional date fields stay `undefined` when absent (never written
 * back as `undefined` to Firestore — read-only mapping).
 */
export function readTransactionDate(value: unknown): Date | undefined {
  const date = value instanceof Date ? value :
    value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() : undefined;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : undefined;
}

export function mapTransaction(id: string, data: Record<string, unknown>): Transaction {
  const mapped: Record<string, unknown> = { ...data, id };
  const createdAt = readTransactionDate(data.createdAt);
  mapped.createdAt = createdAt ?? new Date(0);
  mapped.createdAtKnown = !!createdAt;
  for (const field of [...TRANSACTION_DATE_FIELDS, 'returnRequestedAt', 'returnDeliveredAt', 'refundedAt']) {
    // Presence itself is a server witness, including malformed legacy dates.
    if (field === 'returnRequestedAt' && !Object.prototype.hasOwnProperty.call(data, field)) continue;
    mapped[field] = readTransactionDate(data[field]);
  }
  for (const [field, dates] of [
    ['refund', ['fundsAppliedAt', 'requestedAt', 'updatedAt', 'authorizedRetryAt']],
    ['bankDispute', ['openedAt', 'closedAt', 'ledgerReconciledAt']],
    ['buyerReport', ['reportedAt']],
    ['noShowReport', ['reportedAt']],
    ['counterReport', ['reportedAt']],
    ['pendingCancellation', ['committedAt', 'recordedAt']],
    ['walletPayment', ['committedAt']],
    ['returnRequest', ['requestedAt', 'fundsReleaseAt', 'authorizedAt', 'committedAt']],
    ['deliveryCorrection', ['detectedAt', 'originalDeliveryAt', 'originalFundsReleaseAt', 'originalFundsReleasedAt']],
  ] as const) {
    const value = data[field];
    if (value && typeof value === 'object' && (field !== 'deliveryCorrection' || !Array.isArray(value))) {
      const nested = { ...value } as Record<string, unknown>;
      for (const dateField of dates) nested[dateField] = field === 'deliveryCorrection' && nested[dateField] === null
        ? null : readTransactionDate(nested[dateField]);
      if (field === 'returnRequest' && nested.commercialReturnBasis && typeof nested.commercialReturnBasis === 'object' && !Array.isArray(nested.commercialReturnBasis)) {
        const basis = {...nested.commercialReturnBasis} as Record<string, unknown>;
        for (const dateField of ['reportedAt', 'initialReleaseAt', 'instructedAt']) basis[dateField] = readTransactionDate(basis[dateField]);
        nested.commercialReturnBasis = basis;
      }
      mapped[field] = nested;
    }
  }
  return mapped as unknown as Transaction;
}

/** A present marker remains blocked unless a session/focus-bound native reader
 * qualifies its current resolution. Client flags, later scans and case history alone do not suffice. */
export function getDeliveryCorrectionReview(order: Transaction, observation?: TransportReviewObservation | null): {
  blocked: true; qualified: boolean; correctionId: string | null;
  state: 'release_suspended' | 'released_review_required' | null;
  message: string; detectedAt: Date | null;
} | null {
  if (!Object.prototype.hasOwnProperty.call(order, 'deliveryCorrection') && order.deliveryCorrectionBlocked !== true &&
      order.deliveryCorrectionOwnerMessage == null) return null;
  const r = order.deliveryCorrection;
  const candidateId = r && r.schemaVersion === 1 && r.transactionId === order.id && r.buyerId === order.buyerId && r.sellerId === order.sellerId &&
    typeof r.correctionId === 'string' && /^[a-f0-9]{64}$/.test(r.correctionId) ? r.correctionId : null;
  if (hasCurrentNativeCorrectionResolution(observation, order.id, candidateId)) return null;
  const nativeDate = (v: unknown): v is Date => v instanceof Date && Number.isFinite(v.getTime());
  const optionalDate = (v: unknown) => v === null || nativeDate(v);
  const qualified = !!r && typeof r === 'object' && !Array.isArray(r) && r.schemaVersion === 1 &&
    typeof r.correctionId === 'string' && /^[a-f0-9]{64}$/.test(r.correctionId) && r.transactionId === order.id &&
    r.buyerId === order.buyerId && r.sellerId === order.sellerId && r.buyerId !== r.sellerId &&
    ['release_suspended', 'released_review_required'].includes(r.state) &&
    ['dated_provider_correction', 'current_snapshot_contradicts_delivery'].includes(r.qualification) &&
    nativeDate(r.detectedAt) && nativeDate(r.originalDeliveryAt) && optionalDate(r.originalFundsReleaseAt) &&
    optionalDate(r.originalFundsReleasedAt) && r.ownerAction === 'contactSupport';
  const message = typeof order.deliveryCorrectionOwnerMessage === 'string' && order.deliveryCorrectionOwnerMessage.trim() &&
    order.deliveryCorrectionOwnerMessage.length <= 2000 ? order.deliveryCorrectionOwnerMessage
      : qualified && typeof r.ownerMessage === 'string' && r.ownerMessage.trim() && r.ownerMessage.length <= 2000 ? r.ownerMessage
        : 'La correction du suivi et la situation des fonds doivent être vérifiées par notre équipe. Les dates et reçus historiques ne constituent pas une autorisation de nouvelle sortie de fonds.';
  return { blocked: true, qualified, correctionId: qualified ? r.correctionId : null, state: qualified ? r.state : null,
    message, detectedAt: qualified ? r.detectedAt : null };
}

export function sortTransactions(items: Transaction[]): Transaction[] {
  return [...new Map(items.map(item => [item.id, item])).values()].sort((a, b) => {
    const aDate = a.createdAtKnown !== false && Number.isFinite(a.createdAt?.getTime());
    const bDate = b.createdAtKnown !== false && Number.isFinite(b.createdAt?.getTime());
    if (aDate !== bDate) return aDate ? -1 : 1;
    const delta = aDate && bDate ? b.createdAt.getTime() - a.createdAt.getTime() : 0;
    return delta || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  });
}
export interface ChatTransactionPage {
  transactions: Transaction[];
  cursor: { buyer: string | null; seller: string | null };
  hasMore: boolean;
}

const RETURN_STATES: readonly ReturnRequestStatus[] = ['reserved', 'preparing', 'quoted', 'requested', 'unknown', 'reconciliation_required', 'committed', 'closed'];
const RETURN_REASONS: readonly PhysicalReturnReason[] = ['not_as_described', 'damaged', 'wrong_item', 'other', 'change_of_mind'];
const returnRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const returnId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const returnCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const returnMoney = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 &&
  Number.isSafeInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 0.000001 ? Math.round(v * 100) : null;
const returnCost = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const returnText = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 2000;
const returnUrl = (v: unknown): v is string => typeof v === 'string' && /^https:\/\//.test(v) && v.length <= 8000;
const returnKey = (uid: string, id: string) => `return-request:v1:${encodeURIComponent(uid)}:${encodeURIComponent(id)}`;
const returnOperations = new Set<string>();
const returnUnknown = () => new Error('Le résultat de cette demande reste à vérifier. Relisez ce même retour ou contactez notre équipe ; aucune nouvelle demande ne sera envoyée.');
function sameReturnParcel(a: unknown, b: unknown): boolean {
  return returnRecord(a) && returnRecord(b) && returnRecord(a.weight) && returnRecord(b.weight) &&
    returnRecord(a.dimensions) && returnRecord(b.dimensions) && a.weight.unit === 'kilogram' && b.weight.unit === 'kilogram' &&
    a.dimensions.unit === 'centimeter' && b.dimensions.unit === 'centimeter' && a.weight.value === b.weight.value &&
    ['length', 'width', 'height'].every(k => a.dimensions && b.dimensions &&
      (a.dimensions as Record<string, unknown>)[k] === (b.dimensions as Record<string, unknown>)[k]);
}
function sameReturnReceipt(a: ReturnRequestResult, b: ReturnRequestResult): boolean {
  return a.protocol === b.protocol && a.transactionId === b.transactionId && a.requestId === b.requestId && a.version === b.version &&
    a.requestRecorded === b.requestRecorded && a.fundsFrozen === b.fundsFrozen && a.status === b.status &&
    a.labelCommitted === b.labelCommitted && a.shippingPermissionGranted === b.shippingPermissionGranted &&
    a.currentOrderStatus === b.currentOrderStatus && a.returnLabelUrl === b.returnLabelUrl &&
    productReviewEqual(a.terminalCapture ?? null, b.terminalCapture ?? null) && productReviewEqual(a.costResolution ?? null, b.costResolution ?? null) &&
    a.returnTrackingNumber === b.returnTrackingNumber && a.returnLabelCost === b.returnLabelCost &&
    (a.quote === null && b.quote === null || a.quote !== null && b.quote !== null && sameReturnQuote(a.quote, b.quote));
}
function sameReturnQuote(a: ReturnShippingQuote, b: ReturnShippingQuote): boolean {
  return a.protocol === b.protocol && a.requestId === b.requestId && a.version === b.version && a.quoteId === b.quoteId && a.rateId === b.rateId &&
    a.costCents === b.costCents && a.currency === b.currency && a.issuedAtMs === b.issuedAtMs &&
    a.carrierName === b.carrierName && a.serviceName === b.serviceName && a.estimatedDeliveryDays === b.estimatedDeliveryDays &&
    sameReturnParcel(a.parcel, b.parcel) && productReviewEqual(a.depositTerms ?? null, b.depositTerms ?? null) &&
    (a.depositTermsHash ?? null) === (b.depositTermsHash ?? null) &&
    productReviewEqual(a.convenienceReturnFinancialTerms ?? null, b.convenienceReturnFinancialTerms ?? null) &&
    (a.convenienceReturnFinancialTermsHash ?? null) === (b.convenienceReturnFinancialTermsHash ?? null);
}
function validReturnAttempt(value: unknown, uid: string, id: string): value is ReturnRequestAttempt {
  return returnRecord(value) && value.schemaVersion === 1 && value.actorUid === uid && value.transactionId === id &&
    RETURN_REASONS.includes(value.reason as PhysicalReturnReason) &&
    Object.keys(value).every(k => ['schemaVersion', 'actorUid', 'transactionId', 'reason', 'requestId', 'version', 'phase', 'acceptedQuote', 'materialCapability', 'commercialReturn', 'parcelCapability', 'capability', 'convenienceReturn'].includes(k)) &&
    (value.capability === undefined && value.convenienceReturn === undefined && value.reason !== 'change_of_mind' ||
      value.capability === 'convenience_return_shipping_v1' && isConvenienceReturnReference(value.convenienceReturn) && value.reason === 'change_of_mind' && value.materialCapability === undefined && value.commercialReturn === undefined && value.parcelCapability === undefined) &&
    (value.parcelCapability === undefined || value.parcelCapability === 'product_review_parcel_v1' && value.materialCapability === 'product_review_material_v1' && isCommercialReturnReference(value.commercialReturn)) &&
    (value.materialCapability === undefined && value.commercialReturn === undefined || value.materialCapability === 'product_review_material_v1' && isCommercialReturnReference(value.commercialReturn)) &&
    (value.requestId === undefined && value.version === undefined && value.phase === undefined ||
      returnId(value.requestId) && value.requestId.length >= 16 &&
      (value.version === undefined || returnCents(value.version) && value.version > 0) &&
      (value.phase === undefined || ['prepare_submitted', 'prepared', 'confirm_submitted'].includes(String(value.phase)))) &&
    (value.acceptedQuote === undefined && value.phase !== 'confirm_submitted' || returnRecord(value.acceptedQuote) &&
      value.phase === 'confirm_submitted' && returnId(value.acceptedQuote.quoteId) && returnId(value.acceptedQuote.rateId) &&
      returnCents(value.acceptedQuote.version) && value.acceptedQuote.version > 0 && returnCents(value.acceptedQuote.costCents) &&
      (!Object.hasOwn(value.acceptedQuote, 'returnDepositTermsHash') || value.acceptedQuote.returnDepositTermsHash === RETURN_DEPOSIT_TERMS_HASH) &&
      (value.capability === 'convenience_return_shipping_v1' ? convenienceHash(value.acceptedQuote.convenienceReturnFinancialTermsHash) && returnCents(value.acceptedQuote.expectedNetRefundCents) && value.acceptedQuote.expectedNetRefundCents > 0 :
        !Object.hasOwn(value.acceptedQuote, 'convenienceReturnFinancialTermsHash') && !Object.hasOwn(value.acceptedQuote, 'expectedNetRefundCents')));
}
function isCommercialReturnReference(value: unknown): value is ProductCommercialReturnReference {
  return returnRecord(value) && Object.keys(value).length === 2 && Object.keys(value).every(k => ['instructionId', 'contentHash'].includes(k)) &&
    typeof value.instructionId === 'string' && /^pri_[a-f0-9]{64}$/.test(value.instructionId) && typeof value.contentHash === 'string' && /^[a-f0-9]{64}$/.test(value.contentHash);
}
function parseReturnQuote(raw: unknown, requestId: string, version: number): ReturnShippingQuote {
  if (!returnRecord(raw) || !['return_quote_v1', 'return_quote_v2'].includes(String(raw.protocol)) || raw.requestId !== requestId || raw.version !== version ||
      !returnId(raw.quoteId) || !returnId(raw.rateId) || raw.currency !== 'CAD' || !returnCents(raw.costCents) ||
      !returnText(raw.carrierName) || !returnText(raw.serviceName) || !Number.isSafeInteger(raw.issuedAtMs) || Number(raw.issuedAtMs) <= 0 ||
      !(raw.estimatedDeliveryDays === null || returnCents(raw.estimatedDeliveryDays)) ||
      raw.measurementVerified !== false || raw.refundDecisionGranted !== false || !returnRecord(raw.parcel) ||
      !returnRecord(raw.parcel.weight) || !returnRecord(raw.parcel.dimensions) || raw.parcel.weight.unit !== 'kilogram' ||
      raw.parcel.dimensions.unit !== 'centimeter' ||
      !returnDepositTermsPair(raw) || ![raw.parcel.weight.value, raw.parcel.dimensions.length, raw.parcel.dimensions.width, raw.parcel.dimensions.height]
        .every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) ||
      (raw.protocol === 'return_quote_v2' ? !returnRecord(raw.convenienceReturnFinancialTerms) ||
        !isConvenienceReturnFinancialTerms(raw.convenienceReturnFinancialTerms, String(raw.convenienceReturnFinancialTerms.transactionId)) ||
        raw.convenienceReturnFinancialTerms.requestId !== requestId || raw.convenienceReturnFinancialTerms.returnLabelCostCents !== raw.costCents ||
        !convenienceHash(raw.convenienceReturnFinancialTermsHash) || raw.depositTermsHash !== RETURN_DEPOSIT_TERMS_HASH : Object.hasOwn(raw, 'convenienceReturnFinancialTerms') || Object.hasOwn(raw, 'convenienceReturnFinancialTermsHash'))) throw returnUnknown();
  return raw as unknown as ReturnShippingQuote;
}
function parseReturnResult(raw: unknown, id: string): ReturnRequestResult {
  const neutralizedBeforeDeposit = returnRecord(raw) && raw.protocol === 'return_request_v2' && raw.status === 'closed' &&
    isConvenienceReturnTerminal(raw.terminalCapture) && raw.terminalCapture.basis === 'owner_intent_not_deposited' &&
    raw.requestRecorded === false && raw.version === null && returnId(raw.requestId) && raw.requestId === raw.terminalCapture.returnRequestId;
  if (!returnRecord(raw) || !['return_request_v1', 'return_request_v2'].includes(String(raw.protocol)) || raw.transactionId !== id ||
      !['success', 'replay', 'requestRecorded', 'fundsFrozen', 'labelCommitted', 'actionRequired', 'shippingPermissionGranted'].every(k => typeof raw[k] === 'boolean') ||
      !RETURN_STATES.includes(raw.status as ReturnRequestStatus) || !returnText(raw.currentOrderStatus) ||
      !(raw.reason === null || typeof raw.reason === 'string' && raw.reason.length <= 2000) || raw.success !== raw.labelCommitted ||
      raw.shippingPermissionGranted && (!raw.labelCommitted || !raw.fundsFrozen || raw.currentOrderStatus !== 'return_requested' || raw.actionRequired || !returnUrl(raw.returnLabelUrl)) ||
      raw.fundsFrozen && !raw.requestRecorded || raw.labelCommitted && (!raw.requestRecorded || raw.status !== 'committed') ||
      !raw.labelCommitted && raw.status === 'committed' ||
      (raw.requestRecorded ? !returnId(raw.requestId) || !returnCents(raw.version) || raw.version < 1 : !neutralizedBeforeDeposit && (raw.requestId !== null || raw.version !== null)) ||
      (raw.labelCommitted ? !returnText(raw.returnTrackingNumber) || !(raw.returnLabelUrl === null || returnUrl(raw.returnLabelUrl)) || !returnCost(raw.returnLabelCost)
        : raw.returnTrackingNumber !== null || raw.returnLabelUrl !== null || raw.returnLabelCost !== null) ||
      (raw.quote !== null && (!raw.requestRecorded || !raw.fundsFrozen || raw.status !== 'quoted' || !raw.actionRequired))) throw returnUnknown();
  const quote = raw.quote === null ? null : parseReturnQuote(raw.quote, raw.requestId as string, raw.version as number);
  if (quote && (raw.protocol === 'return_request_v2' ? quote.protocol !== 'return_quote_v2' || quote.convenienceReturnFinancialTerms?.transactionId !== id : quote.protocol !== 'return_quote_v1')) throw returnUnknown();
  if (raw.status === 'closed' ? raw.protocol !== 'return_request_v2' || !isConvenienceReturnTerminal(raw.terminalCapture) || raw.terminalCapture.returnRequestId !== raw.requestId ||
      raw.success !== false || !(raw.requestRecorded === true && raw.terminalCapture.basis !== 'owner_intent_not_deposited' || neutralizedBeforeDeposit) || raw.fundsFrozen !== false || raw.labelCommitted !== false || raw.shippingPermissionGranted !== false || raw.quote !== null : Object.hasOwn(raw, 'terminalCapture')) throw returnUnknown();
  if (Object.hasOwn(raw, 'costResolution') && (raw.protocol !== 'return_request_v2' || !raw.labelCommitted || !isConvenienceReturnVarianceResolution(raw.costResolution))) throw returnUnknown();
  return Object.fromEntries(['protocol', 'transactionId', 'success', 'replay', 'requestId', 'version', 'requestRecorded', 'fundsFrozen',
    'labelCommitted', 'shippingPermissionGranted', 'quote', 'status', 'actionRequired', 'currentOrderStatus', 'returnTrackingNumber', 'returnLabelUrl', 'returnLabelCost', 'reason',
    ...(Object.hasOwn(raw, 'terminalCapture') ? ['terminalCapture'] : []), ...(Object.hasOwn(raw, 'costResolution') ? ['costResolution'] : [])]
    .map(k => [k, k === 'quote' ? quote : raw[k]])) as unknown as ReturnRequestResult;
}
async function verifyReturnQuote(result: ReturnRequestResult, uid: string, current: () => void): Promise<void> {
  const quote = result.quote;
  if (quote?.protocol !== 'return_quote_v2') return;
  const terms = quote.convenienceReturnFinancialTerms;
  if (!terms || ![terms.buyerId, terms.sellerId].includes(uid) || await productReviewHash(terms) !== quote.convenienceReturnFinancialTermsHash) throw returnUnknown();
  current();
}
export function hasReturnRequestWitness(order: Transaction): boolean {
  return ['returnRequest', 'returnLabelPending', 'returnRequestedAt'].some(k => Object.prototype.hasOwnProperty.call(order, k)) ||
    order.status === 'return_requested' || order.returnLabelId != null || order.returnTrackingNumber != null || order.returnLabelUrl != null ||
    order.returnDeliveredAt != null || order.returnReconciliationRequired === true;
}
async function returnSourceHash(id: string, data: Record<string, unknown>): Promise<string> {
  const request = returnRecord(data.returnRequest) ? data.returnRequest : null;
  const effectiveWindowSourceHash = request?.effectiveDeliveryWindowSourceHash;
  if (effectiveWindowSourceHash !== undefined && (typeof effectiveWindowSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(effectiveWindowSourceHash))) throw returnUnknown();
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : returnRecord(v) || v instanceof Date ?
    returnNativeMillis(v) !== null ? {timestampMs: returnNativeMillis(v)} : Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical({id, buyerId: data.buyerId, sellerId: data.sellerId,
    articleId: data.articleId, currency: data.currency, amount: data.amount, totalAmount: data.totalAmount, sellerPayout: data.sellerPayout,
    shippingAddress: data.shippingAddress, shippingSnapshot: data.shippingSnapshot, deliveredAt: data.deliveredAt, fundsReleaseAt: data.fundsReleaseAt,
    ...(request?.commercialReturn ? {commercialReturn: request.commercialReturn, commercialReturnBasis: request.commercialReturnBasis} : {}),
    ...(effectiveWindowSourceHash === undefined ? {} : {effectiveDeliveryWindowSourceHash: effectiveWindowSourceHash})})));
}
function returnNativeMillis(v: unknown): number | null {
  // Mirror Admin Timestamp.toMillis(), which floors sub-millisecond nanos;
  // the Web SDK's fractional toMillis() would produce a different source hash.
  const ms = v instanceof Timestamp ? v.seconds * 1000 + Math.floor(v.nanoseconds / 1_000_000) : v instanceof Date ? v.getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}
function unknownReturnView(order: Transaction, attempt?: ReturnRequestAttempt, reason = 'return_request_outcome_unproven'): ReturnRequestResult {
  return {protocol: 'return_request_v1', transactionId: order.id, success: false, replay: true, requestId: null, version: null,
    requestRecorded: false, fundsFrozen: false, labelCommitted: false, shippingPermissionGranted: false, quote: null,
    status: 'reconciliation_required', actionRequired: true,
    currentOrderStatus: order.status, returnTrackingNumber: null, returnLabelUrl: null, returnLabelCost: null,
    reason: attempt?.requestId ? `${reason}: ${attempt.requestId}` : reason};
}
async function returnView(order: Transaction, data: Record<string, unknown>, attempt: ReturnRequestAttempt | null): Promise<ReturnRequestResult | null> {
  if (!hasReturnRequestWitness(order)) return attempt ? unknownReturnView(order, attempt) : null;
  const r = order.returnRequest, rawRequest = returnRecord(data.returnRequest) ? data.returnRequest : null;
  const requested = returnNativeMillis(rawRequest?.requestedAt), deadline = returnNativeMillis(rawRequest?.fundsReleaseAt);
  const basis = returnRecord(rawRequest?.commercialReturnBasis) ? rawRequest.commercialReturnBasis : null;
  const reported = returnNativeMillis(basis?.reportedAt), instructed = returnNativeMillis(basis?.instructedAt);
  const commercialClock = isCommercialReturnReference(rawRequest?.commercialReturn) && basis?.protocol === 'product_commercial_return_basis_v1' &&
    (basis.parcelCapability === undefined || basis.parcelCapability === 'product_review_parcel_v1' && ['delivered', 'disputed'].includes(String(basis.commercialStatusAtInstruction))) &&
    basis.transactionId === order.id && basis.buyerId === order.buyerId && basis.sellerId === order.sellerId && returnId(basis.disputeId) &&
    basis.instructionId === rawRequest.commercialReturn.instructionId && basis.contentHash === rawRequest.commercialReturn.contentHash &&
    typeof basis.semanticSourceHash === 'string' && /^[a-f0-9]{64}$/.test(basis.semanticSourceHash) && returnNativeMillis(basis.initialReleaseAt) === deadline &&
    deadline !== null && reported !== null && instructed !== null && requested !== null && reported < deadline && reported <= instructed && instructed <= requested;
  const recorded = !!r && r.schemaVersion === 1 && returnId(r.requestId) && r.transactionId === order.id && r.actorUid === order.buyerId &&
    r.buyerId === order.buyerId && r.sellerId === order.sellerId && r.buyerId !== r.sellerId && returnId(r.buyerId) && returnId(r.sellerId) &&
    returnCents(r.version) && r.version > 0 && r.version < Number.MAX_SAFE_INTEGER && r.reason !== 'change_of_mind' && RETURN_REASONS.includes(r.reason) &&
    returnCents(r.totalCents) && r.totalCents > 0 && returnCents(r.sellerPayoutCents) && r.currency === 'CAD' &&
    requested !== null && deadline !== null && (rawRequest?.commercialReturn ? commercialClock : requested < deadline) &&
    typeof r.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(r.sourceHash) &&
    (r.effectiveDeliveryWindowSourceHash === undefined || typeof r.effectiveDeliveryWindowSourceHash === 'string' && /^[a-f0-9]{64}$/.test(r.effectiveDeliveryWindowSourceHash)) && RETURN_STATES.includes(r.state);
  if (attempt && (!r || r.reason !== attempt.reason || attempt.requestId !== undefined && r.requestId !== attempt.requestId ||
      attempt.version !== undefined && r.version < attempt.version || (attempt.parcelCapability || basis?.parcelCapability) && ((attempt.parcelCapability ?? null) !== (basis?.parcelCapability ?? null) || !productReviewEqual(attempt.commercialReturn ?? null, rawRequest?.commercialReturn ?? null)))) return unknownReturnView(order, attempt, 'return_request_binding_changed');
  const qualified = recorded && order.currency === 'CAD' && r.totalCents === returnMoney(order.totalAmount) &&
    r.sellerPayoutCents === returnMoney(order.sellerPayout ?? order.amount) && r.sourceHash === await returnSourceHash(order.id, data);
  const q = returnRecord(rawRequest?.quote) ? rawRequest.quote : null;
  const depositTermsPresent = !!q && (Object.hasOwn(q, 'depositTerms') || Object.hasOwn(q, 'depositTermsHash'));
  if (attempt?.acceptedQuote && (attempt.acceptedQuote.returnDepositTermsHash ?? null) !== (q?.depositTermsHash ?? null))
    return unknownReturnView(order, attempt, 'return_accepted_deposit_terms_changed');
  const rates = returnRecord(q?.rates) && Array.isArray(q.rates.rates) && q.rates.rates.length === 1 && returnRecord(q.rates.rates[0]) ? q.rates.rates[0] : null;
  const context = returnRecord(q?.context) ? q.context : null;
  const nativeQuote = qualified && q?.schemaVersion === 1 && q.requestId === r.requestId && q.transactionId === order.id &&
    q.ownerId === order.buyerId && q.sourceHash === r.sourceHash && returnId(q.quoteId) && returnId(q.rateId) &&
    q.currency === 'CAD' && returnCents(q.expectedCostCents) && returnNativeMillis(q.issuedAt) !== null &&
    rates?.rateId === q.rateId && rates.shippingCents === q.expectedCostCents && !!context && context.isReturn === true &&
    rates.carrierId === context.carrierId && rates.carrierCode === context.carrierCode && rates.serviceCode === context.serviceCode &&
    context.outboundLabelId === data.shipEngineLabelId &&
    sameReturnParcel(context.parcel, returnRecord(data.shippingSnapshot) ? data.shippingSnapshot.parcel : null);
  let quote: ReturnShippingQuote | null = null;
  if (nativeQuote && r.state === 'quoted') {
    try {quote = parseReturnQuote({protocol: 'return_quote_v1', quoteId: q.quoteId, requestId: r.requestId, version: r.version,
      rateId: q.rateId, currency: 'CAD', costCents: q.expectedCostCents, carrierName: rates.carrierFriendlyName,
      serviceName: rates.serviceType, estimatedDeliveryDays: rates.estimatedDeliveryDays, issuedAtMs: returnNativeMillis(q.issuedAt),
      ...(Object.hasOwn(q, 'depositTerms') || Object.hasOwn(q, 'depositTermsHash') ? {depositTerms: q.depositTerms, depositTermsHash: q.depositTermsHash} : {}),
      parcel: context.parcel, measurementVerified: false, refundDecisionGranted: false}, r.requestId, r.version);} catch {quote = null;}
  }
  const p = returnRecord(rawRequest?.labelProof) ? rawRequest.labelProof : null;
  const acceptance = returnRecord(rawRequest?.acceptance) ? rawRequest.acceptance : null;
  const committed = qualified && nativeQuote && r.state === 'committed' && !!readTransactionDate(r.committedAt) &&
    p?.schemaVersion === 2 && p.currency === 'CAD' && returnCents(p.shipmentCents) && returnCents(p.insuranceCents) &&
    p.totalCents === p.shipmentCents + p.insuranceCents && p.totalCents === q.expectedCostCents &&
    p.carrierId === context.carrierId && p.carrierCode === context.carrierCode && p.serviceCode === context.serviceCode &&
    p.outboundLabelId === context.outboundLabelId && returnId(p.shipmentId) &&
    acceptance?.actorUid === order.buyerId && acceptance.quoteId === q.quoteId && acceptance.rateId === q.rateId &&
    acceptance.expectedCostCents === p.totalCents && returnNativeMillis(acceptance.acceptedAt) !== null &&
    (!depositTermsPresent || returnDepositTermsPair(q) && acceptance.returnDepositTermsHash === q.depositTermsHash) &&
    returnText(p?.labelId) && p.labelId === order.returnLabelId && returnText(p?.trackingNumber) && p.trackingNumber === order.returnTrackingNumber &&
    returnCost(p?.cost) && p.cost === p.totalCents / 100 && p.cost === order.returnLabelCost && returnUrl(p?.labelUrl) && p.labelUrl === order.returnLabelUrl;
  return {protocol: 'return_request_v1', transactionId: order.id, success: committed, replay: true, requestId: recorded ? r.requestId : null,
    version: recorded ? r.version : null, requestRecorded: recorded, fundsFrozen: recorded && !order.fundsReleasedAt && order.disputed === true,
    // A document can prove a historical label, never current permission to ship.
    labelCommitted: committed, shippingPermissionGranted: false, quote,
    status: committed ? 'committed' : qualified && r.state !== 'committed' && (r.state !== 'quoted' || quote !== null) ? r.state : 'reconciliation_required',
    actionRequired: committed || !qualified || r.state === 'quoted' || ['unknown', 'reconciliation_required', 'committed'].includes(r?.state ?? ''),
    currentOrderStatus: order.status, returnTrackingNumber: committed ? order.returnTrackingNumber! : null,
    // New-policy document furnishing is qualified by the server clock, never a raw order URL.
    returnLabelUrl: committed && !depositTermsPresent ? order.returnLabelUrl! : null, returnLabelCost: committed ? order.returnLabelCost! : null,
    reason: typeof order.returnReconciliationReason === 'string' ? order.returnReconciliationReason : null};
}

function chatQuery(chatId: string, userId: string, role: 'buyerId' | 'sellerId', latest: boolean, cursor?: string | null) {
  const constraints: QueryConstraint[] = [where(role, '==', userId), where('chatId', '==', chatId)];
  if (latest) constraints.push(orderBy('createdAt', 'desc'));
  constraints.push(orderBy(documentId(), 'desc'));
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(fsLimit(latest ? 1 : 50));
  return query(collection(firestore, 'transactions'), ...constraints);
}

export class TransactionService {
  static reportTransactionProblem(transactionId: string, reason: TransactionProblemReason, details: string, uid: string, assertContext: () => void, setDeclaration?: WholeSetDeclaration) {
    return TransactionProblemJournal.submit(transactionId, reason, details, uid, assertContext, setDeclaration);
  }
  static readWholeSetReportSource(transactionId: string, uid: string, assertContext: () => void) {
    return TransactionProblemJournal.wholeSetSource(transactionId, uid, assertContext);
  }
  static readTransactionProblem(transactionId: string, uid: string, assertContext: () => void) {
    return TransactionProblemJournal.read(transactionId, uid, assertContext);
  }
  static acknowledgeTransactionProblem(transactionId: string, uid: string, assertContext: () => void) {
    return TransactionProblemJournal.acknowledge(transactionId, uid, assertContext);
  }
  static resumeTransactionProblem(transactionId: string, uid: string, assertContext: () => void) {
    return TransactionProblemJournal.resume(transactionId, uid, assertContext);
  }
  /** Owner read only: an unknown request is never replayed through a paid POST. */
  static readReturnRequest(transactionId: string, uid: string, assertContext: () => void) {
    return this.readReturnRequestState(transactionId, uid, assertContext, false);
  }
  /** Local discovery remains available if the remote witness cannot be read.
   * Presence never establishes whether prepare reached the server. */
  static async readLocalReturnAttempt(transactionId: string, uid: string, assertContext: () => void): Promise<ReturnRequestAttempt | null> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    if (!returnId(transactionId)) throw returnUnknown();
    const raw = await AsyncStorage.getItem(returnKey(uid, transactionId)); current(); if (raw === null) return null;
    const attempt: unknown = JSON.parse(raw); if (!validReturnAttempt(attempt, uid, transactionId)) throw returnUnknown(); return attempt;
  }
  /** Only the operation that owns the local lock may observe before submission
   * or after its RPC has settled. Background readers cannot probe a live POST. */
  private static async readReturnRequestState(transactionId: string, uid: string, assertContext: () => void, observeDuringOwnOperation: boolean): Promise<{
    transaction: Transaction; result: ReturnRequestResult | null; attempt: ReturnRequestAttempt | null;
    historicalDocument: HistoricalReturnDocument | null;
  }> {
    const session = captureTradeSession(uid);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    assertCurrent();
    if (!returnId(transactionId)) throw returnUnknown();
    const rawAttempt = await AsyncStorage.getItem(returnKey(uid, transactionId)); assertCurrent();
    const attempt: unknown = rawAttempt === null ? null : JSON.parse(rawAttempt);
    if (attempt !== null && !validReturnAttempt(attempt, uid, transactionId)) throw returnUnknown();
    let snapshot = await getDocFromServer(doc(firestore, 'transactions', transactionId)); assertCurrent();
    if (!snapshot.exists()) throw returnUnknown();
    let data = snapshot.data(), transaction = mapTransaction(snapshot.id, data);
    if (transaction.id !== transactionId || uid !== transaction.buyerId && uid !== transaction.sellerId) throw returnUnknown();
    if (attempt?.capability === 'convenience_return_shipping_v1' || transaction.returnRequest?.schemaVersion === 2) {
      if (returnOperations.has(returnKey(uid, transactionId)) && !observeDuringOwnOperation)
        return {transaction, result: null, attempt, historicalDocument: null};
      const reference = attempt?.convenienceReturn ?? transaction.returnRequest?.convenienceReturn;
      const requestId = attempt?.requestId ?? transaction.returnRequest?.requestId;
      if (!isConvenienceReturnReference(reference) || !returnId(requestId)) throw returnUnknown();
      // The native V2 observer qualifies its frozen monetary/physical source.
      // Never reconstruct that proof using the historical V1 source hash.
      const observed = await httpsCallable<Record<string, unknown>, unknown>(functions, 'requestReturn')({
        capability: 'convenience_return_shipping_v1', transactionId, expectedUid: uid, mode: 'observe', requestId,
        reason: 'change_of_mind', convenienceReturn: reference}); assertCurrent();
      const result = parseReturnResult(observed.data, transactionId);
      const anotherActive = result.requestRecorded && result.status !== 'closed' && result.requestId !== requestId;
      const observedReference = anotherActive ? transaction.returnRequest?.convenienceReturn : reference;
      if (result.protocol !== 'return_request_v2' || result.status === 'closed' && result.terminalCapture?.returnRequestId !== requestId ||
          anotherActive && (transaction.returnRequest?.schemaVersion !== 2 || transaction.returnRequest.requestId !== result.requestId || !isConvenienceReturnReference(observedReference)) ||
          result.quote && !productReviewEqual(result.quote.convenienceReturnFinancialTerms?.agreement, observedReference)) throw returnUnknown();
      await verifyReturnQuote(result, uid, assertCurrent); assertCurrent();
      snapshot = await getDocFromServer(doc(firestore, 'transactions', transactionId)); assertCurrent();
      if (!snapshot.exists()) throw returnUnknown();
      transaction = mapTransaction(snapshot.id, snapshot.data());
      if (uid !== transaction.buyerId && uid !== transaction.sellerId || result.currentOrderStatus !== transaction.status ||
          result.requestRecorded && result.status !== 'closed' && (!productReviewEqual(transaction.returnRequest?.convenienceReturn, observedReference) || transaction.returnRequest?.requestId !== result.requestId) ||
          result.quote?.convenienceReturnFinancialTerms && (result.quote.convenienceReturnFinancialTerms.buyerId !== transaction.buyerId || result.quote.convenienceReturnFinancialTerms.sellerId !== transaction.sellerId)) throw returnUnknown();
      return {transaction, result: uid === transaction.buyerId ? result : {...result, shippingPermissionGranted: false}, attempt, historicalDocument: null};
    }
    let result = await returnView(transaction, data, attempt); assertCurrent();
    // Re-entry is exclusively observe. An in-flight prepare/confirm owns its
    // read and must not race its own recovery GET before provider submission.
    if (uid === transaction.buyerId && !returnOperations.has(returnKey(uid, transactionId)) &&
        (attempt?.requestId || result?.requestRecorded && !attempt) &&
        (!attempt?.requestId || !result?.requestRecorded || result.requestId === attempt.requestId)) {
      const requestId = attempt?.requestId ?? result!.requestId!;
      const reason = attempt?.reason ?? transaction.returnRequest?.reason;
      const observed = await httpsCallable<Record<string, unknown>, unknown>(functions, 'requestReturn')({
        transactionId, expectedUid: uid, mode: 'observe', requestId, ...(reason ? {reason} : {}),
        ...(attempt?.commercialReturn ? {materialCapability: 'product_review_material_v1', commercialReturn: attempt.commercialReturn, ...(attempt.parcelCapability ? {parcelCapability: attempt.parcelCapability} : {})} :
          transaction.returnRequest?.commercialReturn ? {materialCapability: 'product_review_material_v1', commercialReturn: transaction.returnRequest.commercialReturn, ...(transaction.returnRequest.commercialReturnBasis?.parcelCapability ? {parcelCapability: transaction.returnRequest.commercialReturnBasis.parcelCapability} : {})} : {}),
      }); assertCurrent();
      const receipt = parseReturnResult(observed.data, transactionId);
      if (receipt.requestRecorded && receipt.requestId !== requestId) throw returnUnknown();
      snapshot = await getDocFromServer(doc(firestore, 'transactions', transactionId)); assertCurrent();
      if (!snapshot.exists()) throw returnUnknown();
      data = snapshot.data(); transaction = mapTransaction(snapshot.id, data);
      if (transaction.buyerId !== uid) throw returnUnknown();
      result = await returnView(transaction, data, attempt); assertCurrent();
      const nativeQuote = returnRecord(data.returnRequest) && returnRecord(data.returnRequest.quote) ? data.returnRequest.quote : null;
      const needsFurnishing = !!nativeQuote && (Object.hasOwn(nativeQuote, 'depositTerms') || Object.hasOwn(nativeQuote, 'depositTermsHash'));
      if (!result || !sameReturnReceipt({...receipt, shippingPermissionGranted: false, ...(needsFurnishing ? {returnLabelUrl: null} : {})},
        {...result, shippingPermissionGranted: false})) throw returnUnknown();
      // Only the freshly requalified server receipt grants permission. A
      // private PDF URL or the seller's read alone grants none.
      result = receipt;
    } else if (result) {
      result = {...result, shippingPermissionGranted: false};
    }
    const rawQuote = returnRecord(data.returnRequest) && returnRecord(data.returnRequest.quote) ? data.returnRequest.quote : null;
    const requiresFurnishing = !!rawQuote && (Object.hasOwn(rawQuote, 'depositTerms') || Object.hasOwn(rawQuote, 'depositTermsHash'));
    const historicalDocument: HistoricalReturnDocument | null = !requiresFurnishing && result?.labelCommitted !== true && returnUrl(data.returnLabelUrl)
      ? { transactionId, labelUrl: data.returnLabelUrl, trackingNumber: returnText(data.returnTrackingNumber) ? data.returnTrackingNumber : null,
        shippingPermissionGranted: false } : null;
    return {transaction, result, attempt, historicalDocument};
  }

  /** One new request per durable owner/order tuple; recovery is exclusively a read. */
  static async requestReturn(transactionId: string, reason: PhysicalReturnReason, uid: string, assertContext: () => void, commercialReturn?: ProductCommercialReturnReference, parcel = false, convenienceReturn?: ConvenienceReturnReference): Promise<ReturnRequestResult> {
    const session = captureTradeSession(uid), key = returnKey(uid, transactionId);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    assertCurrent();
    if (parcel && !commercialReturn || !returnId(transactionId) || !RETURN_REASONS.includes(reason) || commercialReturn !== undefined && !isCommercialReturnReference(commercialReturn) ||
        (convenienceReturn ? !isConvenienceReturnReference(convenienceReturn) || reason !== 'change_of_mind' || !!commercialReturn || parcel : reason === 'change_of_mind')) throw returnUnknown();
    if (returnOperations.has(key)) throw returnUnknown();
    returnOperations.add(key);
    try {
      const existing = await this.readReturnRequestState(transactionId, uid, assertCurrent, true); assertCurrent();
      if (existing.transaction.buyerId !== uid) throw returnUnknown();
      if (existing.result) return existing.result;
      if (existing.attempt) throw returnUnknown();
      const attempt: ReturnRequestAttempt = {schemaVersion: 1, actorUid: uid, transactionId, reason,
        requestId: randomUUID(), phase: 'prepare_submitted', ...(convenienceReturn ? {capability: 'convenience_return_shipping_v1', convenienceReturn} : {}),
        ...(commercialReturn ? {materialCapability: 'product_review_material_v1', commercialReturn, ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})} : {})};
      await AsyncStorage.setItem(key, JSON.stringify(attempt)); assertCurrent();
      const response = await httpsCallable<Record<string, unknown>, unknown>(functions, 'requestReturn')({
        transactionId, expectedUid: uid, reason, requestId: attempt.requestId, mode: 'prepare', ...(attempt.convenienceReturn ? {capability: 'convenience_return_shipping_v1', convenienceReturn: attempt.convenienceReturn} : {}),
        ...(attempt.commercialReturn ? {materialCapability: 'product_review_material_v1', commercialReturn: attempt.commercialReturn, ...(attempt.parcelCapability ? {parcelCapability: attempt.parcelCapability} : {})} : {})});
      assertCurrent();
      const result = parseReturnResult(response.data, transactionId);
      if ((result.protocol === 'return_request_v2') !== !!convenienceReturn) throw returnUnknown();
      await verifyReturnQuote(result, uid, assertCurrent); assertCurrent();
      if (result.requestRecorded && result.requestId !== attempt.requestId) throw returnUnknown();
      if (result.requestRecorded) {
        await AsyncStorage.setItem(key, JSON.stringify({...attempt, version: result.version,
          phase: result.quote ? 'prepared' : 'prepare_submitted'})); assertCurrent();
      }
      const current = await this.readReturnRequestState(transactionId, uid, assertCurrent, true); assertCurrent();
      if (current.transaction.buyerId !== uid || result.requestRecorded && (!current.result?.requestRecorded ||
          current.result.requestId !== result.requestId || current.result.version !== result.version || current.result.fundsFrozen !== result.fundsFrozen) ||
          result.labelCommitted && (!current.result?.labelCommitted || current.result.returnTrackingNumber !== result.returnTrackingNumber ||
          current.result.returnLabelUrl !== result.returnLabelUrl || current.result.returnLabelCost !== result.returnLabelCost)) throw returnUnknown();
      return result;
    } finally {returnOperations.delete(key);}
  }

  /** A closed request is retained until its exact native tombstone is read.
   * Clearing this local intention never submits or resurrects a return. */
  static async acknowledgeClosedConvenienceReturn(transactionId: string, uid: string, terminal: ConvenienceReturnTerminal, assertContext: () => void): Promise<ReturnRequestResult> {
    const session = captureTradeSession(uid), key = returnKey(uid, transactionId), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    if (!isConvenienceReturnTerminal(terminal) || returnOperations.has(key)) throw returnUnknown();
    returnOperations.add(key);
    try {
      const raw = await AsyncStorage.getItem(key); current(); const attempt: unknown = raw === null ? null : JSON.parse(raw);
      if (!validReturnAttempt(attempt, uid, transactionId) || attempt.capability !== 'convenience_return_shipping_v1' || attempt.requestId !== terminal.returnRequestId) throw returnUnknown();
      const observation = await this.readReturnRequestState(transactionId, uid, current, true); current();
      if (observation.result?.status !== 'closed' || !productReviewEqual(observation.result.terminalCapture, terminal) || !productReviewEqual(observation.attempt, attempt)) throw returnUnknown();
      if (await AsyncStorage.getItem(key) !== raw) throw returnUnknown(); current();
      await AsyncStorage.removeItem(key); current(); return observation.result;
    } finally {returnOperations.delete(key);}
  }
  /** Explicitly fence this already-journaled prepare tuple. A missing GET is
   * never enough to clear it, and an active request is never closed here. */
  static async neutralizePendingConvenienceReturn(attempt: ReturnRequestAttempt, uid: string, assertContext: () => void): Promise<ReturnRequestResult> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    if (!validReturnAttempt(attempt, uid, attempt.transactionId) || attempt.capability !== 'convenience_return_shipping_v1' ||
        attempt.phase !== 'prepare_submitted' || !returnId(attempt.requestId) || !isConvenienceReturnReference(attempt.convenienceReturn)) throw returnUnknown();
    const key = returnKey(uid, attempt.transactionId); if (returnOperations.has(key)) throw returnUnknown(); returnOperations.add(key);
    try {
      if (!productReviewEqual(await this.readLocalReturnAttempt(attempt.transactionId, uid, current), attempt)) throw returnUnknown(); current();
      const response = await httpsCallable<Record<string, unknown>, unknown>(functions, 'requestReturn')({capability: 'convenience_return_shipping_v1', expectedUid: uid,
        transactionId: attempt.transactionId, requestId: attempt.requestId, reason: 'change_of_mind', convenienceReturn: attempt.convenienceReturn, mode: 'neutralize'}); current();
      const receipt = parseReturnResult(response.data, attempt.transactionId);
      if (receipt.protocol !== 'return_request_v2' || receipt.status === 'closed' && receipt.terminalCapture?.returnRequestId !== attempt.requestId) throw returnUnknown();
      const fresh = await this.readReturnRequestState(attempt.transactionId, uid, current, true); current();
      if (!fresh.result || !productReviewEqual(fresh.attempt, attempt) ||
          (receipt.status === 'closed' ? fresh.result.status !== 'closed' || !productReviewEqual(fresh.result.terminalCapture, receipt.terminalCapture) : !sameReturnReceipt(fresh.result, receipt))) throw returnUnknown();
      return fresh.result;
    } finally {returnOperations.delete(key);}
  }

  /** The exact accepted tuple is journaled before one confirm invocation.
   * A timeout, rejected read or changed quote never permits its resubmission. */
  static async confirmReturn(transactionId: string, quote: ReturnShippingQuote, uid: string,
    assertContext: () => void): Promise<ReturnRequestResult> {
    const session = captureTradeSession(uid), key = returnKey(uid, transactionId);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    assertCurrent();
    parseReturnQuote(quote, quote.requestId, quote.version);
    if (!returnId(transactionId) || returnOperations.has(key)) throw returnUnknown();
    returnOperations.add(key);
    try {
      const current = await this.readReturnRequestState(transactionId, uid, assertCurrent, true); assertCurrent();
      const receipt = current.result, previous = current.attempt;
      const commercialReturn = previous?.commercialReturn ?? current.transaction.returnRequest?.commercialReturn;
      const convenienceReturn = previous?.convenienceReturn ?? current.transaction.returnRequest?.convenienceReturn;
      const parcel = previous?.parcelCapability === 'product_review_parcel_v1' || !previous && current.transaction.returnRequest?.commercialReturnBasis?.parcelCapability === 'product_review_parcel_v1';
      if (current.transaction.buyerId !== uid || !receipt?.requestRecorded || !receipt.fundsFrozen ||
          receipt.status !== 'quoted' || !receipt.quote || !sameReturnQuote(receipt.quote, quote) ||
          !current.transaction.returnRequest || previous?.phase === 'confirm_submitted' ||
          previous && (!previous.requestId || previous.requestId !== quote.requestId) ||
          hasBankObligation(current.transaction) || hasUnsettledRefund(current.transaction) ||
          current.transaction.fundsReleasedAt || current.transaction.status !== (commercialReturn ? current.transaction.returnRequest?.commercialReturnBasis?.commercialStatusAtInstruction ?? 'disputed' : 'delivered') || commercialReturn && !isCommercialReturnReference(commercialReturn))
        throw returnUnknown();
      if ((quote.protocol === 'return_quote_v2') !== !!convenienceReturn || convenienceReturn && (!isConvenienceReturnReference(convenienceReturn) ||
          !productReviewEqual(quote.convenienceReturnFinancialTerms?.agreement, convenienceReturn) || quote.convenienceReturnFinancialTerms?.buyerId !== uid)) throw returnUnknown();
      await verifyReturnQuote(receipt, uid, assertCurrent); assertCurrent();
      // Only a new confirmation reaches this read; existing receipts and uncertain attempts remain above these guards.
      if (getDeliveryCorrectionReview(current.transaction)) {
        const correction = await TransportReviewService.source(uid, transactionId, 'owner', null, assertCurrent); assertCurrent();
        if (getDeliveryCorrectionReview(current.transaction, correction)) throw returnUnknown();
      }
      const attempt: ReturnRequestAttempt = {schemaVersion: 1, actorUid: uid, transactionId,
        reason: current.transaction.returnRequest.reason, requestId: quote.requestId, version: quote.version,
        phase: 'confirm_submitted', acceptedQuote: {quoteId: quote.quoteId, rateId: quote.rateId,
          version: quote.version, costCents: quote.costCents, ...(quote.depositTermsHash ? {returnDepositTermsHash: quote.depositTermsHash} : {}),
          ...(quote.convenienceReturnFinancialTerms ? {convenienceReturnFinancialTermsHash: quote.convenienceReturnFinancialTermsHash, expectedNetRefundCents: quote.convenienceReturnFinancialTerms.netRefundCents} : {})},
        ...(convenienceReturn ? {capability: 'convenience_return_shipping_v1', convenienceReturn} : {}),
        ...(commercialReturn ? {materialCapability: 'product_review_material_v1', commercialReturn, ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})} : {})};
      await AsyncStorage.setItem(key, JSON.stringify(attempt)); assertCurrent();
      const response = await httpsCallable<Record<string, unknown>, unknown>(functions, 'requestReturn')({
        transactionId, expectedUid: uid, requestId: attempt.requestId, reason: attempt.reason, mode: 'confirm',
        quoteId: quote.quoteId, rateId: quote.rateId, expectedVersion: quote.version,
        expectedCostCents: quote.costCents, accepted: true, ...(quote.depositTermsHash ? {returnDepositTermsHash: quote.depositTermsHash} : {}),
        ...(convenienceReturn ? {capability: 'convenience_return_shipping_v1', convenienceReturn,
          convenienceReturnFinancialTermsHash: quote.convenienceReturnFinancialTermsHash, expectedNetRefundCents: quote.convenienceReturnFinancialTerms!.netRefundCents} : {}),
        ...(attempt.commercialReturn ? {materialCapability: 'product_review_material_v1', commercialReturn: attempt.commercialReturn, ...(attempt.parcelCapability ? {parcelCapability: attempt.parcelCapability} : {})} : {})}); assertCurrent();
      const result = parseReturnResult(response.data, transactionId);
      if (!result.requestRecorded || result.requestId !== quote.requestId || result.version === null || result.version < quote.version) throw returnUnknown();
      const after = await this.readReturnRequestState(transactionId, uid, assertCurrent, true); assertCurrent();
      if (!after.result || !sameReturnReceipt({...result, shippingPermissionGranted: false, ...(quote.depositTermsHash ? {returnLabelUrl: null} : {})},
          {...after.result, shippingPermissionGranted: false})) throw returnUnknown();
      return {...result, shippingPermissionGranted: false};
    } finally {returnOperations.delete(key);}
  }

  static async cancelPendingOrder(transactionId: string, uid: string, assertContext: () => void): Promise<PendingCancellationResult> {
    const session = captureTradeSession(uid); assertContext();
    const response = await httpsCallable<{ transactionId: string; expectedUid: string }, PendingCancellationResult>(functions, 'cancelPendingTransaction')({ transactionId, expectedUid: session.uid });
    assertTradeSessionCurrent(session); assertContext();
    const result = response.data;
    if (result?.success !== true || typeof result.replay !== 'boolean' || result.currentStatus !== 'cancelled' ||
        result.cancellationCommitted !== true || result.walletRefundCommitted !== true || !Number.isSafeInteger(result.refundedCents) || result.refundedCents < 0) {
      throw new Error('Le reçu de l’annulation reste à vérifier dans cette commande.');
    }
    return result;
  }
  /** Canonical new shipping reservation; the complete receipt grants no payment permission. */
  static reserveShippingPurchase(uid: string, articleId: string, destination: ShippingPurchaseAddress,
    input: ShippingReservationInput, assertContext: () => void, recoveryOnly = false): Promise<ShippingReservationReceipt> {
    return ShippingPurchaseService.reserve(uid, articleId, destination, input, assertContext, recoveryOnly);
  }
  static readExistingShippingReservation(uid: string, transactionId: string, assertContext: () => void): Promise<ShippingReservationReceipt> {
    return ShippingPurchaseService.readExisting(uid, transactionId, assertContext);
  }

  /**
   * Create a shipping transaction via Cloud Function.
   *
   * The Cloud Function atomically verifies that the article is still
   * available (not sold, not deleted, not inactive) and creates the
   * transaction in a single Firestore runTransaction. This prevents
   * the race condition where two buyers purchase the same article.
   */
  static async createShippingTransaction(
    articleId: string,
    buyerId: string,
    sellerId: string,
    amount: number,
    shippingCost: number,
    shippingAddress: ShippingAddress,
    shipEngineRateId: string,
    chatId?: string,
    serviceFee?: number
  ): Promise<string> {
    // shipEngineRateId is mandatory: the backend buys the real label from this
    // rate. Never send null — a missing rate would block label generation.
    if (!shipEngineRateId) {
      throw new Error("Le tarif de livraison est manquant. Actualisez l'estimation.");
    }

    const callable = httpsCallable<
      Record<string, any>,
      { success: boolean; transactionId: string }
    >(functions, 'createTransaction');

    const result = await callable({
      articleId,
      deliveryType: 'shipping',
      amount,
      shippingCost,
      serviceFee: serviceFee || 0,
      shippingAddress,
      chatId: chatId || null,
      shipEngineRateId,
    });

    if (!result.data.success || !result.data.transactionId) {
      throw new Error('Erreur lors de la création de la transaction');
    }

    return result.data.transactionId;
  }

  /**
   * Create a meetup transaction via Cloud Function.
   *
   * Same atomic safety as createShippingTransaction: the Cloud Function
   * checks article availability and marks it sold in a single
   * runTransaction.
   */
  static async createMeetupTransaction(
    articleId: string,
    buyerId: string,
    sellerId: string,
    amount: number,
    meetupSpot: MeetupSpot | null,
    chatId?: string
  ): Promise<string> {
    const callable = httpsCallable<
      Record<string, any>,
      { success: boolean; transactionId: string }
    >(functions, 'createTransaction');

    const result = await callable({
      articleId,
      deliveryType: 'meetup',
      amount,
      meetupSpot: meetupSpot || null,
      chatId: chatId || null,
    });

    if (!result.data.success || !result.data.transactionId) {
      throw new Error('Erreur lors de la création de la transaction meetup');
    }

    return result.data.transactionId;
  }

  /**
   * Get a transaction by ID
   */
  static async getTransaction(transactionId: string, ownerRead?: { expectedUid: string; assertCurrent: () => void }): Promise<Transaction | null> {
    const session = ownerRead ? captureTradeSession(ownerRead.expectedUid) : null;
    const assertCurrent = () => { if (session) assertTradeSessionCurrent(session); ownerRead?.assertCurrent(); };
    try {
      assertCurrent();
      const transactionRef = doc(firestore, 'transactions', transactionId);
      const transactionDoc = await (ownerRead ? getDocFromServer(transactionRef) : getDoc(transactionRef));
      assertCurrent();

      if (!transactionDoc.exists()) {
        return null;
      }

      const order = mapTransaction(transactionDoc.id, transactionDoc.data() ?? {});
      if (session && order.buyerId !== session.uid && order.sellerId !== session.uid) throw new Error('Commande inaccessible.');
      return order;
    } catch (error: unknown) {
      if (session) assertCurrent();
      throw new Error(error instanceof Error ? `Erreur lors de la récupération de la transaction: ${error.message}` : 'Impossible de lire la commande.');
    }
  }

  /** Latest dated agreement, plus an ID fallback for undated legacy documents.
   * Every query proves participation and is bounded; history uses its own cursor.
   * New indexes are documented in PACKAGE_REFUND_UI_QUERY_CONTRACT.md.
   */
  static async getTransactionByChat(chatId: string, userId: string): Promise<Transaction | null> {
    if (!userId || !chatId) throw new Error('Identité et conversation requises.');
    // Dedicated latest-by-date queries: ID pagination never establishes newest chronology.
    const snapshots = await Promise.all([
      getDocs(chatQuery(chatId, userId, 'buyerId', true)),
      getDocs(chatQuery(chatId, userId, 'sellerId', true)),
    ]);
    const dated = sortTransactions(snapshots.flatMap(snap => snap.docs.map(d => mapTransaction(d.id, d.data()))));
    if (dated.some(tx => tx.createdAtKnown === false)) {
      throw new Error('La date d’une commande doit être vérifiée avant de déterminer la commande la plus récente.');
    }
    if (dated.some(tx => tx.createdAtKnown)) return dated.find(tx => tx.createdAtKnown) ?? null;
    // Documents without createdAt are excluded by orderBy(createdAt). Their
    // fallback ordering is explicitly ID, not an invented date.
    const legacy = await this.getChatTransactionsPage(chatId, userId);
    return sortTransactions([...dated, ...legacy.transactions])[0] ?? null;
  }

  static async getChatTransactionsPage(chatId: string, userId: string, cursor?: ChatTransactionPage['cursor']): Promise<ChatTransactionPage> {
    if (!userId || !chatId) throw new Error('Identité et conversation requises.');
    const roles = ['buyerId', 'sellerId'] as const;
    const snapshots = await Promise.all(roles.map((role, index) => {
      const side = index === 0 ? 'buyer' : 'seller';
      if (cursor && cursor[side] === null) return Promise.resolve(null);
      return getDocs(chatQuery(chatId, userId, role, false, cursor?.[side]));
    }));
    const next = snapshots.map(snap => snap && snap.docs.length === 50 ? snap.docs[snap.docs.length - 1].id : null);
    return { transactions: sortTransactions(snapshots.flatMap(snap => snap?.docs.map(d => mapTransaction(d.id, d.data())) ?? [])),
      cursor: { buyer: next[0], seller: next[1] }, hasMore: next.some(Boolean) };
  }

  static async getChatTransaction(transactionId: string, chatId: string, userId: string): Promise<Transaction> {
    const tx = await this.getTransaction(transactionId);
    if (!tx || tx.chatId !== chatId || ![tx.buyerId, tx.sellerId].includes(userId)) {
      throw new Error('Cette commande est inaccessible dans cette conversation.');
    }
    return tx;
  }

  /** A chat association alone cannot bind a purchase to an accepted offer. */
  static async getTransactionForOffer(chatId: string, userId: string, messageId: string, linkedId?: string): Promise<{transaction: Transaction | null; canStartCheckout: boolean; ambiguous: boolean}> {
    if (!chatId || !userId || !messageId) throw new Error('Identité de l’offre requise.');
    let transaction: Transaction | null;
    if (linkedId) transaction = await this.getChatTransaction(linkedId, chatId, userId);
    else {
      const snapshot = await getDocs(query(collection(firestore, 'transactions'), where('buyerId', '==', userId),
        where('chatId', '==', chatId), where('offerMessageId', '==', messageId), orderBy(documentId(), 'asc'), fsLimit(2)));
      if (snapshot.docs.length > 1) return {transaction: null, canStartCheckout: false, ambiguous: true};
      transaction = snapshot.docs[0] ? mapTransaction(snapshot.docs[0].id, snapshot.docs[0].data()) : null;
    }
    if (transaction) {
      if (transaction.offerMessageId !== messageId || ![transaction.buyerId, transaction.sellerId].includes(userId) || transaction.deliveryType !== 'shipping') {
        return {transaction: null, canStartCheckout: false, ambiguous: true};
      }
      return {transaction, canStartCheckout: false, ambiguous: false};
    }
    const latest = await this.getTransactionByChat(chatId, userId);
    const rawAgreement: unknown = latest ? (latest as unknown as Record<string, unknown>).shippingOffer : null;
    const agreement = rawAgreement && typeof rawAgreement === 'object' && !Array.isArray(rawAgreement)
      ? rawAgreement as Record<string, unknown> : null;
    // A different modern agreement may follow a fully settled cancellation.
    // The old order is never selected as B's purchase, and legacy/active or
    // financially uncertain orders still block discovery. Quote/reservation
    // revalidate the new message and inventory on the server.
    const cancelledOtherAgreement = !!latest && latest.chatId === chatId && latest.buyerId === userId &&
      typeof latest.offerMessageId === 'string' && latest.offerMessageId.length > 0 && latest.offerMessageId !== messageId &&
      agreement?.protocol === 'shipping_price_agreement_v1' && agreement.messageId === latest.offerMessageId &&
      agreement.chatId === chatId && agreement.articleId === latest.articleId && agreement.buyerId === userId &&
      agreement.sellerId === latest.sellerId && typeof agreement.hash === 'string' && /^[a-f0-9]{64}$/.test(agreement.hash) &&
      ShippingPurchaseService.hasConfirmedCancellation(latest, userId, latest.articleId, latest.id);
    return {transaction: null, canStartCheckout: latest === null || cancelledOtherAgreement, ambiguous: latest !== null && !cancelledOtherAgreement};
  }

  static subscribeToLatestChatTransaction(chatId: string, userId: string, onChange: () => void, onError: (error: Error) => void): () => void {
    const stops = (['buyerId', 'sellerId'] as const).flatMap(role => [true, false].map(latest =>
      onSnapshot(chatQuery(chatId, userId, role, latest), onChange, onError)));
    return () => stops.forEach(stop => stop());
  }

  static subscribeToTransaction(transactionId: string, onChange: () => void, onError: (error: Error) => void): () => void {
    return onSnapshot(doc(firestore, 'transactions', transactionId), onChange, onError);
  }

  /**
   * Update transaction status.
   *
   * SECURITY: 'cancelled' goes through a Cloud Function that re-checks
   * caller identity and current status. 'paid' / 'shipped' / 'delivered'
   * are written by Cloud Functions (stripeWebhook, checkTrackingStatus)
   * and should not be set from the client. Other statuses still go via
   * direct Firestore update.
   */
  static async updateTransactionStatus(
    transactionId: string,
    status: Transaction['status'],
    additionalData?: Partial<Transaction>,
    options?: { expectedUid?: string; assertContext?: () => void },
  ): Promise<void> {
    try {
      if (status === 'cancelled') {
        const session = captureTradeSession(options?.expectedUid); options?.assertContext?.();
        const callable = httpsCallable<
          { transactionId: string; expectedUid: string },
          { success: boolean }
        >(functions, 'cancelPendingTransaction');
        await callable({ transactionId, expectedUid: session.uid });
        assertTradeSessionCurrent(session); options?.assertContext?.();
        return;
      }

      const transactionRef = doc(firestore, 'transactions', transactionId);

      const updateData: any = {
        status,
      };

      // Add timestamp based on status
      if (status === 'paid') {
        updateData.paidAt = serverTimestamp();
      } else if (status === 'shipped') {
        updateData.shippedAt = serverTimestamp();
      } else if (status === 'delivered') {
        updateData.deliveredAt = serverTimestamp();
      } else if (status === 'meetup_confirmed') {
        updateData.meetupConfirmedAt = serverTimestamp();
      } else if (status === 'meetup_completed') {
        updateData.meetupCompletedAt = serverTimestamp();
      }

      // Add any additional data
      if (additionalData) {
        Object.assign(updateData, additionalData);
      }

      await updateDoc(transactionRef, updateData);
    } catch (error: any) {
      throw new Error(`Erreur lors de la mise à jour de la transaction: ${error.message}`);
    }
  }

  /**
   * ADMIN requests a purchase refund through the server-only callable.
   * IssueRefundResult must be checked: pending/action/reconciliation results
   * do not confirm a refund or closure of the commercial dispute. Bank
   * disputes remain independent; the server controls financial settlement.
   */
  static async previewAdminFinancialDecision(transactionId: string, disputeId: string, adminUid: string,
    decisionType: AdminFinancialPreview['decisionType'], assertContext: () => void, decisionContext?: AdminFinancialPreview['decisionContext'],
    resume?: AdminReturnToSenderFinancialResume, transportReviewId?: string, productReviewCaseId?: string, productReviewTopic: 'authenticity' | 'nonconformity' | 'parcel_delivery' = 'authenticity', material = false, parcel = false, allocation?: PurchaseRefundAllocation, lateCommercial?: LateCommercialReference): Promise<AdminFinancialPreview> {
    const session = captureTradeSession(adminUid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    if (lateCommercial && (decisionContext !== 'product_review' || productReviewTopic === 'parcel_delivery' || !isLateCommercialReference(lateCommercial))) throw new Error('Admission tardive native exacte requise.');
    if (allocation && !isPurchaseRefundAllocation(allocation) || decisionContext === 'purchase_refund_allocation' && !allocation) throw new Error('Allocation exacte requise.');
    if (decisionContext === 'transport_review' && (decisionType !== 'refund_without_return' || typeof transportReviewId !== 'string' || !/^case_[a-f0-9]{64}$/.test(transportReviewId))) throw new Error('Une enquête native exacte est requise.');
    if (decisionContext === 'product_review' && productReviewCaseId !== await productFinancialCaseId(transactionId)) throw new Error('Dossier produit exact requis.');
    if (parcel && decisionContext !== 'product_review' || productReviewTopic === 'parcel_delivery' && (!parcel || decisionContext !== 'product_review')) throw new Error('Version colis explicite requise.');
    if (material && decisionContext !== 'product_review' || productReviewTopic === 'nonconformity' && (!material || decisionContext !== 'product_review')) throw new Error('Version matérielle explicite requise.');
    assertCurrent();
    const current = auth.currentUser;
    if (!current || current.uid !== session.uid) throw new Error('Accès administrateur requis.');
    const token = await current.getIdTokenResult(true); assertCurrent();
    if (auth.currentUser !== current || token.claims.admin !== true) throw new Error('Accès administrateur requis.');
    if (resume && (!['return_to_sender_cases', 'transport_review', 'product_review', ...(allocation ? ['purchase_refund_allocation'] : [])].includes(decisionContext ?? '') || !isAdminReturnToSenderFinancialResume(resume))) throw new Error('La reprise exige un examen des déclarations et les références originales exactes.');
    const input = { mode: resume ? 'resume_preview' : 'preview', transactionId, expectedDisputeId: disputeId, expectedAdminUid: adminUid, decisionType,
      ...(decisionContext ? {decisionContext} : {}), ...(resume ? {resume} : {}), ...(decisionContext === 'transport_review' ? {transportReviewId} : {}),
      ...(decisionContext === 'product_review' ? {capability: 'product_review_financial_v1', productReviewCaseId, productReviewTopic, ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})} : {}),
      ...(lateCommercial ? {lateCommercial} : {}),
      ...(allocation ? {allocation, ...(decisionContext === 'product_review' ? {allocationCapability: 'purchase_refund_v1'} : {capability: 'purchase_refund_v1'})} : {}) };
    const { data } = await httpsCallable<typeof input, unknown>(functions, 'adminRefundTransaction')(input); assertCurrent();
    return parseAdminFinancialPreview(data, adminUid, transactionId, disputeId, decisionType, decisionContext, resume, transportReviewId, productReviewCaseId, productReviewTopic, material, parcel, allocation, lateCommercial);
  }

  static async adminRefundTransaction(attempt: AdminFinancialAttempt, assertContext: () => void,
    mode: 'confirm' | 'observe' | 'neutralize'): Promise<AdminFinancialDecision> {
    const session = captureTradeSession(attempt.adminUid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    return runAdminFinancialDecision(session.uid, attempt.transactionId, assertCurrent, async () => {
      assertCurrent();
      if (!['confirm', 'observe', 'neutralize'].includes(mode) || !validAdminFinancialAttempt(attempt, session.uid)) throw new Error('La décision financière doit être vérifiée.');
      const current = auth.currentUser;
      if (!current || current.uid !== session.uid) throw new Error('Accès administrateur requis.');
      // Only pure servicing of this exact native transport tuple bypasses NEW admin admission.
      const transportServicing = !!(attempt.transportReview || attempt.productReview || attempt.allocation) && mode !== 'confirm';
      const token = transportServicing ? null : await current.getIdTokenResult(true); assertCurrent();
      if (auth.currentUser !== current || !transportServicing && token?.claims.admin !== true) throw new Error('Accès administrateur requis.');
      if ((attempt.returnToSender || attempt.transportReview || attempt.productReview || attempt.allocation) && mode === 'confirm') {
        const authenticatedAt = token?.claims.auth_time, now = Math.floor(Date.now() / 1000);
        if (typeof authenticatedAt !== 'number' || !Number.isSafeInteger(authenticatedAt) || authenticatedAt <= 0 || authenticatedAt > now || now - authenticatedAt > 300)
          throw Object.assign(new Error('Confirmez à nouveau votre identité avant cette instruction financière.'), {code: 'client/recent-auth-required'});
      }
      await rememberAdminFinancialAttempt(attempt, assertCurrent); assertCurrent();
      const { adminUid, ...native } = adminFinancialInput(attempt);
      const input = { ...native, expectedAdminUid: adminUid, mode: attempt.resume ? `resume_${mode}` : mode, ...(mode !== 'observe' ? { accepted: true } : {}),
        ...(attempt.productReview ? {capability: 'product_review_financial_v1', ...(attempt.productReview.materialCapability ? {materialCapability: attempt.productReview.materialCapability} : {}), ...(attempt.productReview.parcelCapability ? {parcelCapability: attempt.productReview.parcelCapability} : {})} : {}),
        ...(attempt.allocation ? attempt.productReview ? {allocationCapability: 'purchase_refund_v1'} : {capability: 'purchase_refund_v1'} : {}) };
      const { data } = await httpsCallable<typeof input, unknown>(functions, 'adminRefundTransaction')(input); assertCurrent();
      const receipt = await parseAdminFinancialDecision(data, attempt); assertCurrent(); return receipt;
    });
  }

  /**
   * ADMIN resolves the commercial dispute in favor of the seller through
   * the server-only callable. The server checks independent refund/bank
   * obligations before restoring the commercial state. This action never
   * settles or releases an independent bank dispute.
   */
  static async resolveDispute(
    attempt: DisputeResolutionAttempt,
    assertContext: () => void,
    mode: 'confirm' | 'observe' | 'neutralize' = 'observe',
  ): Promise<DisputeResolutionOutcome> {
    const session = captureTradeSession(attempt.adminUid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    return runDisputeResolution(session.uid, attempt.transactionId, assertCurrent, async () => {
      assertCurrent();
      if (!validDisputeResolutionAttempt(attempt, session.uid)) throw new Error('La décision et sa note doivent être vérifiées.');
      const admin = auth.currentUser;
      if (!admin || admin.uid !== session.uid) throw new Error('Accès administrateur requis.');
      const ownProductServicing = !!(attempt.productReview || attempt.allocation) && mode !== 'confirm';
      const token = ownProductServicing ? null : await admin.getIdTokenResult(true);
      assertCurrent();
      if (auth.currentUser !== admin || !ownProductServicing && token?.claims.admin !== true) throw new Error('Accès administrateur requis.');
      if ((attempt.productReview || attempt.allocation) && mode === 'confirm') {
        const time = token?.claims.auth_time, now = Math.floor(Date.now() / 1000);
        if (typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0 || time > now || now - time > 300)
          throw Object.assign(new Error('Confirmez à nouveau votre identité avant ce classement.'), {code: 'client/recent-auth-required'});
      }
      await rememberDisputeResolutionAttempt(attempt, assertCurrent);
      assertCurrent();
      const input = { transactionId: attempt.transactionId, requestId: attempt.requestId, expectedAdminUid: attempt.adminUid,
        expectedDisputeId: attempt.disputeId, note: attempt.note, mode, ...(mode !== 'observe' ? { accepted: true } : {}),
        ...(attempt.previewId ? { previewId: attempt.previewId, expectedSourceHash: attempt.expectedSourceHash } : {}),
        ...(attempt.productReview ? {capability: 'product_review_financial_v1', productReview: attempt.productReview, ...(attempt.productReview.materialCapability ? {materialCapability: attempt.productReview.materialCapability} : {}), ...(attempt.productReview.parcelCapability ? {parcelCapability: attempt.productReview.parcelCapability} : {})} : {}),
        ...(attempt.allocation ? {allocation: attempt.allocation, ...(attempt.productReview ? {allocationCapability: 'purchase_refund_v1'} : {capability: 'purchase_refund_v1'})} : {}) };
      const { data } = await httpsCallable<typeof input, unknown>(functions, 'resolveDispute')(input);
      assertCurrent();
      const decisionId = await digestStringAsync(CryptoDigestAlgorithm.SHA256,
        JSON.stringify([attempt.transactionId, attempt.adminUid, attempt.requestId]));
      const payloadHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256,
        JSON.stringify([attempt.transactionId, attempt.disputeId, attempt.adminUid, attempt.requestId, 'dismissed', attempt.note,
          ...(attempt.previewId ? [attempt.previewId, attempt.expectedSourceHash] : []), ...(attempt.productReview ? [adminProductFinancialReference(attempt.productReview)] : []), ...(attempt.allocation ? [await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(purchaseRefundCanonical(attempt.allocation)))] : [])]));
      assertCurrent();
      if (!returnRecord(data) || (attempt.productReview ? !isAdminProductFinancialReference(data.productReview) || !productReviewEqual(data.productReview, attempt.productReview) : Object.prototype.hasOwnProperty.call(data, 'productReview')))
        throw new Error('La liaison d’origine au dossier produit doit être retrouvée.');
      if (attempt.allocation ? !isPurchaseRefundAllocation(data.allocation) || !productReviewEqual(data.allocation, attempt.allocation) : Object.prototype.hasOwnProperty.call(data, 'allocation')) throw new Error('L’allocation d’origine doit être retrouvée.');
      const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 &&
        v.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)) && new Set(v).size === v.length;
      if (returnRecord(data) && data.outcome === 'unrecorded') {
        if (data.protocol !== 'commercial_dispute_resolution_v1' || data.transactionId !== attempt.transactionId ||
            data.expectedDisputeId !== attempt.disputeId || data.actorUid !== attempt.adminUid || data.requestId !== attempt.requestId ||
            data.decisionId !== decisionId || data.payloadHash !== payloadHash || data.note !== attempt.note ||
            data.previewId !== (attempt.previewId ?? null) || data.sourceHash !== (attempt.expectedSourceHash ?? null) ||
            data.decisionCommitted !== false || data.effectsCommitted !== false || data.intentionNeutralized !== false || data.lateRequestBlocked !== false ||
            data.retryPermissionGranted !== false || data.moneyMoved !== false || data.releasedCents !== 0 || data.disputesClosed !== 0 ||
            !Array.isArray(data.disputeIds) || data.disputeIds.length !== 0 || data.orderResolutionCommitted !== false || data.notificationCommitted !== false) {
          throw new Error('L’absence de reçu de cette intention doit être vérifiée.');
        }
        return data as unknown as DisputeResolutionOutcome;
      }
      if (returnRecord(data) && data.outcome === 'not_executed') {
        if (data.protocol !== 'commercial_dispute_resolution_v1' || data.transactionId !== attempt.transactionId ||
            data.requestId !== attempt.requestId || data.expectedDisputeId !== attempt.disputeId || data.decisionId !== decisionId ||
            data.actorUid !== attempt.adminUid || data.note !== attempt.note || data.success !== false || data.decisionCommitted !== false ||
            data.effectsCommitted !== false || data.intentionNeutralized !== true || data.lateRequestBlocked !== true ||
            data.payloadHash !== payloadHash || data.nonExecutionQualified !== true ||
            !['target_already_closed', 'source_changed', 'intention_neutralized_before_effects', ...(attempt.allocation ? ['allocation_sources_unqualified'] : [])].includes(String(data.nonExecutionReason)) || data.terminal !== true ||
            data.releasedCents !== 0 || data.disputesClosed !== 0 || !Array.isArray(data.disputeIds) || data.disputeIds.length !== 0 ||
            data.orderResolutionCommitted !== false || data.notificationCommitted !== false ||
            data.nonExecutionReason === 'source_changed' && (data.sourceHash !== attempt.expectedSourceHash ||
              typeof data.observedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.observedSourceHash) || data.moneyMoved !== false) ||
            (data.nonExecutionReason === 'intention_neutralized_before_effects' || attempt.allocation && data.nonExecutionReason === 'allocation_sources_unqualified') && (data.sourceExamined !== false || data.observedSourceHash !== null ||
              data.previewId !== (attempt.previewId ?? null) || data.sourceHash !== (attempt.expectedSourceHash ?? null) || data.moneyMoved !== false) ||
            data.retryPermissionGranted !== false || typeof data.neutralizedAt !== 'string' || !Number.isFinite(Date.parse(data.neutralizedAt)) ||
            typeof data.replay !== 'boolean') throw new Error('La non-exécution de cette intention doit être vérifiée avec la même référence.');
        return data as unknown as DisputeResolutionOutcome;
      }
      if (!returnRecord(data) || data.protocol !== 'commercial_dispute_resolution_v1' || data.success !== true ||
          data.decisionCommitted !== true || data.transactionId !== attempt.transactionId || data.requestId !== attempt.requestId ||
          data.expectedDisputeId !== attempt.disputeId || data.decisionId !== decisionId || data.actorUid !== attempt.adminUid ||
          data.outcome !== 'dismissed' || data.note !== attempt.note || !returnText(data.restored) || !returnText(data.currentOrderStatus) ||
          !returnCents(data.releasedCents) || data.disputesClosed !== 1 || !ids(data.disputeIds) || data.disputeIds.length !== 1 ||
          data.disputeIds[0] !== attempt.disputeId || typeof data.orderResolutionCommitted !== 'boolean' ||
          !ids(data.remainingOpenDisputeIds) || data.remainingOpenDisputeIds.includes(attempt.disputeId) ||
          data.remainingDisputesOpen !== data.remainingOpenDisputeIds.length || !ids(data.retainedObligations) ||
          data.retainedObligations.some(reason => !['return_request', 'delivery_correction', 'bank_hold_reconciliation'].includes(reason)) ||
          !data.orderResolutionCommitted && (data.remainingDisputesOpen === 0 && data.retainedObligations.length === 0 || data.releasedCents !== 0) ||
          data.orderResolutionCommitted && (data.remainingDisputesOpen !== 0 || data.retainedObligations.length !== 0) ||
          typeof data.resolvedAt !== 'string' || !Number.isFinite(Date.parse(data.resolvedAt)) ||
          typeof data.replay !== 'boolean' || typeof data.notificationCommitted !== 'boolean') {
        throw new Error('Le reçu de cette décision doit être relu avec la même référence. Aucun nouveau classement n’est confirmé.');
      }
      // Historical receipts without native notice proofs cannot be upgraded by
      // their decision alone. The new server result explicitly qualifies both
      // in-app receipts; neither transport nor reading is inferred from it.
      const legacyNotification = data.notificationDelivery === undefined && data.notificationCommitted === false &&
        data.deviceDeliveryVerified === undefined && data.readingVerified === undefined;
      if (!legacyNotification && (data.notificationDelivery !== (data.notificationCommitted ? 'in_app_committed' : 'historical_unqualified') ||
          data.deviceDeliveryVerified !== false || data.readingVerified !== false)) {
        throw new Error('Les preuves des avis liés à cette décision doivent être relues.');
      }
      const hasSettlementFields = typeof data.financialSettlementRetained === 'boolean' &&
        (data.settledRefundIntentId === null || typeof data.settledRefundIntentId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.settledRefundIntentId));
      if ((data.financialSettlementRetained !== undefined || data.settledRefundIntentId !== undefined) && !hasSettlementFields ||
          hasSettlementFields && (data.financialSettlementRetained === true
            ? data.settledRefundIntentId === null || data.restored !== 'refunded' || data.releasedCents !== 0
            : data.settledRefundIntentId !== null)) throw new Error('La référence du remboursement conservé doit être rapprochée.');
      if (attempt.previewMonetaryContext !== undefined && (!hasSettlementFields ||
          data.financialSettlementRetained !== (attempt.previewMonetaryContext === 'settled_refund') ||
          data.settledRefundIntentId !== attempt.expectedSettledRefundIntentId)) {
        throw new Error('Le règlement conservé ne correspond pas à l’aperçu d’origine de cette décision.');
      }
      const settlementQualification = attempt.previewMonetaryContext !== undefined && hasSettlementFields ? 'native' : 'historical_unqualified';
      return { ...data, notificationDelivery: data.notificationCommitted ? 'in_app_committed' : 'historical_unqualified',
        deviceDeliveryVerified: false, readingVerified: false, settlementQualification,
        financialSettlementRetained: settlementQualification === 'native' && data.financialSettlementRetained === true,
        settledRefundIntentId: settlementQualification === 'native' ? data.settledRefundIntentId : null } as unknown as DisputeResolutionOutcome;
    });
  }

  /**
   * F74 — seller cancels a paid order BEFORE the first carrier scan.
   *
   * Delegates to the `sellerCancelTransaction` callable, including server
   * eligibility and idempotency checks. IssueRefundResult describes the
   * current intention; pending/action/reconciliation is not proof of a
   * completed cancellation, financial refund or article re-listing.
   */
  static async sellerCancelTransaction(
    transactionId: string,
    reason?: string
  ): Promise<IssueRefundResult> {
    const callable = httpsCallable<
      { transactionId: string; reason?: string },
      IssueRefundResult
    >(functions, 'sellerCancelTransaction');
    const payload: { transactionId: string; reason?: string } = { transactionId };
    if (reason) payload.reason = reason;
    const result = await callable(payload);
    return result.data;
  }

  static async retryPurchaseRefund(transactionId: string, expectedAdminUid: string, expectedRefundIntentId: string,
    assertContext: () => void): Promise<IssueRefundResult> {
    const session = captureTradeSession(expectedAdminUid);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    assertCurrent();
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(transactionId) || !/^[A-Za-z0-9_-]{1,200}$/.test(expectedRefundIntentId)) {
      throw new Error('L’intention de remboursement originale doit être relue.');
    }
    const input = {transactionId, expectedAdminUid: session.uid, expectedRefundIntentId};
    assertCurrent();
    const result = await httpsCallable<typeof input, IssueRefundResult>(functions, 'retryPurchaseRefund')(input);
    assertCurrent();
    return result.data;
  }

  static async previewCashCase(transactionId: string, disputeId: string, adminUid: string, assertContext: () => void): Promise<CashCasePreview> {
    const session = captureTradeSession(adminUid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent(); const current = auth.currentUser;
    if (!current || current.uid !== session.uid) throw new Error('Accès administrateur requis.');
    const token = await current.getIdTokenResult(true); assertCurrent();
    if (auth.currentUser !== current || token.claims.admin !== true) throw new Error('Accès administrateur requis.');
    const input = { mode: 'preview', expectedAdminUid: adminUid, transactionId, expectedDisputeId: disputeId, decisionType: 'buyer_upheld' };
    const { data } = await httpsCallable<typeof input, unknown>(functions, 'closeMeetupNoShow')(input); assertCurrent();
    return parseCashCasePreview(data, adminUid, transactionId, disputeId);
  }
  static async closeMeetupNoShow(attempt: CashCaseAttempt, assertContext: () => void, mode: 'confirm' | 'observe' | 'neutralize'): Promise<CashCaseDecision> {
    const session = captureTradeSession(attempt.adminUid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    return runCashCaseDecision(session.uid, attempt.transactionId, assertCurrent, async () => {
      assertCurrent(); if (!validCashCaseAttempt(attempt, session.uid)) throw new Error('L’intention de rencontre doit être vérifiée.');
      const current = auth.currentUser;
      if (!current || current.uid !== session.uid) throw new Error('Accès administrateur requis.');
      const token = await current.getIdTokenResult(true); assertCurrent();
      if (auth.currentUser !== current || token.claims.admin !== true) throw new Error('Accès administrateur requis.');
      await rememberCashCaseAttempt(attempt, assertCurrent); assertCurrent();
      const { adminUid, ...native } = cashCaseInput(attempt);
      const input = { ...native, expectedAdminUid: adminUid, mode, ...(mode !== 'observe' ? { accepted: true } : {}) };
      const { data } = await httpsCallable<typeof input, unknown>(functions, 'closeMeetupNoShow')(input); assertCurrent();
      const receipt = await parseCashCaseDecision(data, attempt); assertCurrent(); return receipt;
    });
  }

  /**
   * @deprecated Server-side only — handled by stripeWebhook Cloud Function.
   * Stub throws to surface any straggling caller instead of silently
   * hitting Firestore permission-denied (the transactions rule rejects
   * client status='paid' updates).
   */
  static async updatePaymentInfo(
    _transactionId: string,
    _paymentIntentId: string
  ): Promise<void> {
    throw new Error(
      'TransactionService.updatePaymentInfo is server-side only ' +
        '(handled by stripeWebhook Cloud Function).'
    );
  }

  /**
   * @deprecated Server-side only — handled by stripeWebhook (label
   * generation + status='shipped').
   */
  static async updateShippingInfo(
    _transactionId: string,
    _intelcomBookingId: string,
    _shippingLabelUrl: string,
    _trackingNumber: string,
    _trackingUrl?: string
  ): Promise<void> {
    throw new Error(
      'TransactionService.updateShippingInfo is server-side only ' +
        '(handled by stripeWebhook Cloud Function).'
    );
  }

  /**
   * @deprecated Server-side only — handled by checkTrackingStatus
   * Cloud Function (which marks status='delivered' atomically).
   */
  static async updateTrackingStatus(
    _transactionId: string,
    _trackingStatus: string
  ): Promise<void> {
    throw new Error(
      'TransactionService.updateTrackingStatus is server-side only ' +
        '(handled by checkTrackingStatus Cloud Function).'
    );
  }

  /** Read-side account-obligation summary. Deadlines do not prove money release.
   * Independent bank/refund guards also apply to outer terminal statuses.
   * At 201 records per role, an empty result is explicitly incomplete rather
   * than claiming all obligations were examined. Account deletion is server-only.
   */
  static async getActiveTransactionsForUser(userId: string): Promise<Transaction[]> {
    if (!userId) throw new Error('Identité requise.');
    const snapshots = await Promise.all((['buyerId', 'sellerId'] as const).map(role => getDocs(query(
      collection(firestore, 'transactions'), where(role, '==', userId), orderBy(documentId()), fsLimit(201),
    ))));
    const active = sortTransactions(snapshots.flatMap(snap => snap.docs.map(d => mapTransaction(d.id, d.data())))).filter(tx => {
      if (hasUnsettledRefund(tx) || hasBankObligation(tx)) return true;
      if (tx.status === 'disputed' && tx.deliveryType === 'meetup') return false;
      if (tx.disputed) return true;
      // The backend considers delivered non-terminal until its atomic close.
      if (tx.status === 'delivered') return true;
      return !['completed', 'meetup_completed', 'cancelled', 'refunded'].includes(tx.status);
    });
    if (!active.length && snapshots.some(snap => snap.docs.length === 201)) {
      throw new Error('La vérification locale de l’historique est incomplète. Contactez notre équipe pour vérifier les obligations de votre compte.');
    }
    return active;
  }

  /**
   * Default cap on the number of buyer/seller transactions fetched per side.
   * Bounds the my-orders / my-sales reads so the queries never load an entire
   * (potentially huge) transaction history in one shot (F130). Backed by the
   * composite indexes (buyerId|sellerId, createdAt desc).
   */
  static readonly USER_TRANSACTIONS_PAGE_SIZE = 50;

  /**
   * Get the most recent transactions for a user (buyer or seller), bounded.
   *
   * @param userId The user whose transactions to fetch.
   * @param max    Max docs per side (buyer + seller). Defaults to the page size.
   */
  static async getUserTransactions(
    userId: string,
    max: number = TransactionService.USER_TRANSACTIONS_PAGE_SIZE,
  ): Promise<Transaction[]> {
    try {
      const transactionsRef = collection(firestore, 'transactions');

      // Bounded + server-sorted (composite indexes exist). Capping each side
      // avoids loading the whole collection for a heavy account (F130).
      const buyerQuery = query(
        transactionsRef,
        where('buyerId', '==', userId),
        orderBy('createdAt', 'desc'),
        fsLimit(max),
      );

      const sellerQuery = query(
        transactionsRef,
        where('sellerId', '==', userId),
        orderBy('createdAt', 'desc'),
        fsLimit(max),
      );

      const [buyerSnapshot, sellerSnapshot] = await Promise.all([
        getDocs(buyerQuery),
        getDocs(sellerQuery),
      ]);

      const transactions: Transaction[] = [];

      buyerSnapshot.forEach((doc) => {
        transactions.push(mapTransaction(doc.id, doc.data()));
      });

      sellerSnapshot.forEach((doc) => {
        transactions.push(mapTransaction(doc.id, doc.data()));
      });

      // Merge buyer+seller sides and keep most-recent-first.
      return sortTransactions(transactions);
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des transactions: ${error.message}`);
    }
  }
}
