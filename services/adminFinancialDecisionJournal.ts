import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import type { IssueRefundResult } from '@/types/transaction';
import type { AdminReturnToSenderFinancialReference, AdminReturnToSenderFinancialSource, AdminReturnToSenderFinancialResume,
  AdminReturnToSenderResumeSource } from '@/types/adminReturnToSenderFinancial';
import { isReturnToSenderCase, isReturnToSenderRevision } from '@/services/returnToSenderService';
import { isTransportReview } from '@/services/transportReviewService';
import type { AdminTransportFinancialReference, AdminTransportFinancialSource } from '@/types/adminTransportFinancial';
import type { AdminProductFinancialReference, AdminProductFinancialSource } from '@/types/adminProductFinancial';
import type { LateCommercialReference } from '@/types/lateCommercialRecourse';
import { isAdminProductFinancialReference, isAdminProductFinancialSource } from '@/services/adminProductFinancialSource';
import { productReviewEqual } from '@/services/productReviewService';
import type { PurchaseRefundAllocation, PurchaseRefundAllocationSource } from '@/types/purchaseRefund';
import { isPurchaseRefundAllocation, isPurchaseRefundAllocationSource } from '@/utils/purchaseRefundContract';

export interface AdminFinancialPreview {
  protocol: 'admin_financial_preview_v1'; previewId: string; sourceHash: string; sourceVersion: 1;
  actorUid: string; transactionId: string; expectedDisputeId: string; decisionType: 'refund_without_return' | 'dismissed';
  currency: 'CAD'; totalCents: number; cardCents: number; walletCents: number; sellerDebitCents: number;
  monetaryContext: 'settled_refund' | 'new_instruction'; moneyMovementPlanned?: boolean; refundIntentId?: string;
  buyerId: string; sellerId: string; sourceStatus: string; remainingOpenDisputeIds: string[]; retainedObligations: string[];
  inventoryPermissionGranted: false; physicalPossession: 'unknown'; bilateralAgreementVerified: boolean;
  decisionContext?: 'return_to_sender_cases' | 'transport_review' | 'product_review' | 'purchase_refund_allocation'; returnToSender?: AdminReturnToSenderFinancialSource; transportReview?: AdminTransportFinancialSource;
  productReview?: AdminProductFinancialReference; productReviewSource?: AdminProductFinancialSource;
  allocation?: PurchaseRefundAllocation; allocationSource?: PurchaseRefundAllocationSource;
  resume?: AdminReturnToSenderFinancialResume;
}
export interface AdminFinancialAttempt {
  version: 1; adminUid: string; transactionId: string; disputeId: string; requestId: string; note: string;
  previewId: string; expectedSourceHash: string; expectedTotalCents: number; expectedCardCents: number;
  expectedWalletCents: number; expectedSellerDebitCents: number; decisionType: 'refund_without_return';
  returnToSender?: AdminReturnToSenderFinancialReference;
  transportReview?: AdminTransportFinancialReference;
  productReview?: AdminProductFinancialReference;
  allocation?: PurchaseRefundAllocation;
  resume?: AdminReturnToSenderFinancialResume;
}
interface DecisionIdentity {
  protocol: 'admin_financial_decision_v1'; transactionId: string; expectedDisputeId: string; actorUid: string;
  requestId: string; decisionId: string; payloadHash: string; previewId: string; sourceHash: string; note: string;
  decisionType: 'refund_without_return'; currency: 'CAD'; totalCents: number; cardCents: number; walletCents: number; sellerDebitCents: number;
  inventoryPermissionGranted: false; physicalPossession: 'unknown'; bilateralAgreementVerified: boolean;
  returnToSender?: AdminReturnToSenderFinancialReference;
  transportReview?: AdminTransportFinancialReference;
  productReview?: AdminProductFinancialReference;
  allocation?: PurchaseRefundAllocation;
  resume?: AdminReturnToSenderFinancialResume;
}
export type AdminFinancialDecision = DecisionIdentity & (
  | { outcome: 'unrecorded'; decisionCommitted: false; effectsCommitted: false; intentionNeutralized: false; lateRequestBlocked: false; retryPermissionGranted: false }
  | { outcome: 'not_executed'; buyerId: string; sellerId: string; committedAt: string; decisionCommitted: false; effectsCommitted: false;
      intentionNeutralized: true; lateRequestBlocked: true; nonExecutionQualified: true; retryPermissionGranted: false;
      reason: 'source_changed' | 'another_refund_reserved' | 'intention_neutralized_before_effects' | 'allocation_sources_unqualified'; observedSourceHash: string | null; sourceExamined?: false }
  | { outcome: 'reserved'; buyerId: string; sellerId: string; committedAt: string; decisionCommitted: true; effectsCommitted: true;
      intentionNeutralized: false; lateRequestBlocked: false; refundIntentId: string; financial: IssueRefundResult;
      disputesClosed: number; remainingOpenDisputeIds: string[]; retainedObligations: string[]; manualCorrectionRequired: true }
);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const reference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
// A member UID is compared byte-for-byte, without imposing the document/reference alphabet.
const ownerIdentity = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 &&
  !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(reference) && new Set(v).size === v.length;
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const unknown = () => new Error('L’intention financière doit être relue avec sa référence, son aperçu et sa note d’origine.');
const key = (uid: string) => `second:admin-financial-decision:v1:${encodeURIComponent(uid)}`;
const active = new Set<string>();
const writes = new Map<string, Promise<void>>();
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const rtsId = (v: unknown): v is string => typeof v === 'string' && /^rts_[a-f0-9]{64}$/.test(v);
function financialOptions(v: unknown) {
  return record(v) && exact(v, ['refundScope', 'relistArticle', 'extraSellerDebitCents', 'returnCostDeductionCents']) &&
    v.refundScope === 'full_original_payment' && v.relistArticle === false && v.extraSellerDebitCents === 0 && v.returnCostDeductionCents === 0;
}
export function isAdminReturnToSenderFinancialResume(v: unknown): v is AdminReturnToSenderFinancialResume {
  return record(v) && exact(v, ['refundIntentId', 'refundAttemptId']) && reference(v.refundIntentId) && reference(v.refundAttemptId);
}
function observedRefund(v: unknown): v is IssueRefundResult {
  return record(v) && Object.keys(v).every(key => ['success', 'status', 'intentId', 'refundId', 'actionRequired', 'message', 'outstandingCardCents',
    'localReconciliationRequired', 'bankWaiting', 'alreadyRefunded'].includes(key)) && typeof v.success === 'boolean' &&
    ['pending', 'requires_action', 'unknown', 'succeeded', 'failed', 'canceled', 'reconciliation_required'].includes(String(v.status)) &&
    v.success === (v.status === 'succeeded') && (v.intentId === null || reference(v.intentId)) &&
    (v.refundId === null || typeof v.refundId === 'string' && /^re_[A-Za-z0-9_]+$/.test(v.refundId)) &&
    typeof v.actionRequired === 'boolean' && typeof v.message === 'string' && (v.outstandingCardCents === null || cents(v.outstandingCardCents)) &&
    typeof v.localReconciliationRequired === 'boolean' && typeof v.bankWaiting === 'boolean' &&
    (!Object.prototype.hasOwnProperty.call(v, 'alreadyRefunded') || typeof v.alreadyRefunded === 'boolean');
}
export function parseAdminReturnToSenderResumeSource(v: unknown, uid: string, transactionId: string): AdminReturnToSenderResumeSource {
  if (!record(v) || !exact(v, ['protocol', 'actorUid', 'transactionId', 'sourceRevision', 'qualification', 'resume', 'sourceStatus', 'financial', 'options',
    'inventoryPermissionGranted', 'physicalPossession', 'newRefundPermissionGranted', 'bankArrivalVerified']) || v.protocol !== 'admin_return_to_sender_resume_source_v1' ||
    v.actorUid !== uid || v.transactionId !== transactionId || (v.sourceRevision !== null && !isReturnToSenderRevision(v.sourceRevision)) ||
    !['qualified', 'review_required'].includes(String(v.qualification)) || (v.resume !== null && !isAdminReturnToSenderFinancialResume(v.resume)) ||
    (v.sourceStatus !== null && !reference(v.sourceStatus)) || (v.financial !== null && !observedRefund(v.financial)) ||
    (v.options !== null && !financialOptions(v.options)) || v.inventoryPermissionGranted !== false || v.physicalPossession !== 'unknown' ||
    v.newRefundPermissionGranted !== false || v.bankArrivalVerified !== false || v.qualification === 'qualified' &&
    (!isReturnToSenderRevision(v.sourceRevision) || !isAdminReturnToSenderFinancialResume(v.resume) || !observedRefund(v.financial) ||
      v.financial.intentId !== v.resume.refundIntentId || !financialOptions(v.options))) throw unknown();
  return v as unknown as AdminReturnToSenderResumeSource;
}
function caseReferences(v: unknown): v is AdminReturnToSenderFinancialReference['caseReferences'] {
  return Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every((entry, index) => record(entry) &&
    exact(entry, ['caseId', 'caseRevision', 'caseHash']) && rtsId(entry.caseId) && isReturnToSenderRevision(entry.caseRevision) && hash(entry.caseHash) &&
    (index === 0 || v[index - 1].caseId < entry.caseId));
}
function financialReference(v: unknown, primaryCaseId?: string): v is AdminReturnToSenderFinancialReference {
  return record(v) && exact(v, ['protocol', 'caseReferences', 'caseSetHash', 'financialSourceHash', 'authorizationSourceHash', 'cause', 'options']) &&
    v.protocol === 'return_to_sender_financial_reference_v1' && caseReferences(v.caseReferences) && (!primaryCaseId || v.caseReferences.some(entry => entry.caseId === primaryCaseId)) &&
    hash(v.caseSetHash) && hash(v.financialSourceHash) && hash(v.authorizationSourceHash) && typeof v.cause === 'string' &&
    v.cause === v.cause.trim() && v.cause.length > 0 && v.cause.length <= 300 && financialOptions(v.options);
}
function financialSource(v: unknown, transactionId: string, primaryCaseId: string): v is AdminReturnToSenderFinancialSource {
  if (!record(v) || !exact(v, ['protocol', 'caseReferences', 'caseSetHash', 'financialSourceHash', 'authorizationSourceHash', 'reports', 'qualification',
    'financialPermissionScope', 'options', 'inventoryPermissionGranted', 'physicalPossession', 'guardReleased']) || v.protocol !== 'return_to_sender_financial_source_v1' ||
    !caseReferences(v.caseReferences) || !v.caseReferences.some(entry => entry.caseId === primaryCaseId) || !hash(v.caseSetHash) || !hash(v.financialSourceHash) ||
    !hash(v.authorizationSourceHash) || v.qualification !== 'qualified' || v.financialPermissionScope !== 'full_original_refund_only' || !financialOptions(v.options) ||
    v.inventoryPermissionGranted !== false || v.physicalPossession !== 'unknown' || v.guardReleased !== false ||
    !Array.isArray(v.reports) || v.reports.length !== v.caseReferences.length) return false;
  const refs = v.caseReferences;
  return v.reports.every((report, index) => isReturnToSenderCase(report, transactionId) && report.caseId === refs[index].caseId &&
    report.caseRevision === refs[index].caseRevision && report.caseHash === refs[index].caseHash);
}
export function adminReturnToSenderFinancialReference(source: AdminReturnToSenderFinancialSource, cause: string): AdminReturnToSenderFinancialReference {
  return {protocol: 'return_to_sender_financial_reference_v1', caseReferences: source.caseReferences.map(entry => ({...entry})), caseSetHash: source.caseSetHash,
    financialSourceHash: source.financialSourceHash, authorizationSourceHash: source.authorizationSourceHash, cause: cause.trim(), options: {...source.options}};
}


function transportReferences(v: unknown): v is AdminTransportFinancialReference['caseReferences'] {
  return Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every((entry, index) => record(entry) && exact(entry, ['reviewId', 'reviewRevision', 'reviewHash']) &&
    typeof entry.reviewId === 'string' && /^case_[a-f0-9]{64}$/.test(entry.reviewId) && isReturnToSenderRevision(entry.reviewRevision) && hash(entry.reviewHash) && (index === 0 || v[index - 1].reviewId < entry.reviewId));
}
function transportReference(v: unknown, disputeId?: string): v is AdminTransportFinancialReference {
  return record(v) && exact(v, ['protocol', 'kind', 'reviewId', 'reviewRevision', 'reviewHash', 'caseReferences', 'caseSetHash', 'financialSourceHash', 'authorizationSourceHash', 'cause', 'options']) &&
    v.protocol === 'transport_financial_reference_v1' && ['delivery_correction', 'carrier_exception'].includes(String(v.kind)) && transportReferences(v.caseReferences) &&
    v.caseReferences.some(ref => ref.reviewId === v.reviewId && ref.reviewRevision === v.reviewRevision && ref.reviewHash === v.reviewHash) &&
    (!disputeId || (v.kind === 'delivery_correction' ? disputeId === v.reviewId : /^transport_[a-f0-9]{64}$/.test(disputeId))) && hash(v.caseSetHash) && hash(v.financialSourceHash) && hash(v.authorizationSourceHash) &&
    typeof v.cause === 'string' && v.cause === v.cause.trim() && v.cause.length > 0 && v.cause.length <= 300 && financialOptions(v.options);
}
export const isAdminReturnToSenderFinancialReference = (v: unknown): v is AdminReturnToSenderFinancialReference => financialReference(v);
export const isAdminTransportFinancialReference = (v: unknown): v is AdminTransportFinancialReference => transportReference(v);
function transportSource(v: unknown, transactionId: string, disputeId: string, selected?: string): v is AdminTransportFinancialSource {
  return record(v) && exact(v, ['protocol', 'kind', 'review', 'caseReferences', 'caseSetHash', 'financialSourceHash', 'authorizationSourceHash', 'qualification', 'financialPermissionScope', 'options', ...['financialEffectAuthorized', 'inventoryReleaseAuthorized', 'parcelPossessionVerified']]) &&
    v.protocol === 'transport_financial_source_v1' && ['delivery_correction', 'carrier_exception'].includes(String(v.kind)) && isTransportReview(v.review, transactionId) &&
    v.review.kind === v.kind && (!selected || v.review.reviewId === selected) && v.review.origin.kind === 'system' && 'provider' in v.review.origin && v.review.origin.provider === 'shipengine' && (v.kind === 'carrier_exception' ? v.review.origin.disputeId === disputeId : v.review.reviewId === disputeId) &&
    transportReferences(v.caseReferences) && v.caseReferences.some(ref => ref.reviewId === (v.review as AdminTransportFinancialSource['review']).reviewId) && hash(v.caseSetHash) && hash(v.financialSourceHash) && hash(v.authorizationSourceHash) &&
    v.qualification === 'qualified' && v.financialPermissionScope === 'full_original_refund_only' && financialOptions(v.options) && v.financialEffectAuthorized === false && v.inventoryReleaseAuthorized === false && v.parcelPossessionVerified === false;
}
export function adminTransportFinancialReference(source: AdminTransportFinancialSource, cause: string): AdminTransportFinancialReference {
  const primary = source.caseReferences.find(ref => ref.reviewId === source.review.reviewId); if (!primary) throw unknown();
  return {protocol: 'transport_financial_reference_v1', kind: source.kind, ...primary, caseReferences: source.caseReferences.map(ref => ({...ref})), caseSetHash: source.caseSetHash,
    financialSourceHash: source.financialSourceHash, authorizationSourceHash: source.authorizationSourceHash, cause: cause.trim(), options: {...source.options}};
}

export function parseAdminFinancialPreview(data: unknown, uid: string, transactionId: string, disputeId: string,
  decisionType: AdminFinancialPreview['decisionType'], decisionContext?: AdminFinancialPreview['decisionContext'], resume?: AdminReturnToSenderFinancialResume, transportReviewId?: string, productReviewCaseId?: string,
  productReviewTopic: 'authenticity' | 'nonconformity' | 'parcel_delivery' = 'authenticity', material = false, parcel = false, allocation?: PurchaseRefundAllocation, lateCommercial?: LateCommercialReference): AdminFinancialPreview {
  if (!record(data) || data.protocol !== 'admin_financial_preview_v1' || !hash(data.previewId) || !hash(data.sourceHash) || data.sourceVersion !== 1 ||
      data.actorUid !== uid || data.transactionId !== transactionId || data.expectedDisputeId !== disputeId || data.decisionType !== decisionType ||
      data.currency !== 'CAD' || !cents(data.totalCents) || !cents(data.cardCents) || !cents(data.walletCents) || !cents(data.sellerDebitCents) ||
      data.cardCents + data.walletCents !== data.totalCents || decisionType === 'refund_without_return' && data.totalCents === 0 ||
      !ownerIdentity(data.buyerId) || !ownerIdentity(data.sellerId) || data.buyerId === data.sellerId || !reference(data.sourceStatus) ||
      !ids(data.remainingOpenDisputeIds) || data.remainingOpenDisputeIds.includes(disputeId) || !ids(data.retainedObligations) ||
      data.retainedObligations.some(v => !['return_request', 'delivery_correction', 'bank_case', 'return_to_sender_inventory_review', ...(decisionContext === 'transport_review' ? ['transport_inventory_review'] : [])].includes(v)) ||
      data.inventoryPermissionGranted !== false || data.physicalPossession !== 'unknown' || data.bilateralAgreementVerified !== (allocation ? allocation.agreement !== null : false)) throw unknown();
  if (allocation ? !isPurchaseRefundAllocation(allocation) || !isPurchaseRefundAllocation(data.allocation) || !productReviewEqual(data.allocation, allocation) || !isPurchaseRefundAllocationSource(data.allocationSource) || !productReviewEqual(data.allocationSource.reference, allocation) || data.totalCents !== allocation.terms.cardCents + allocation.terms.walletCents || data.cardCents !== allocation.terms.cardCents || data.walletCents !== allocation.terms.walletCents || data.sellerDebitCents !== allocation.terms.sellerDebitCents || (allocation.terms.settlementKind === 'retain_remaining' ? decisionType !== 'dismissed' : decisionType !== 'refund_without_return') : Object.prototype.hasOwnProperty.call(data, 'allocation') || Object.prototype.hasOwnProperty.call(data, 'allocationSource')) throw unknown();
  const ordinaryDismissal = decisionType === 'dismissed' && data.monetaryContext === 'new_instruction' &&
    data.totalCents === 0 && data.cardCents === 0 && data.walletCents === 0 && data.sellerDebitCents === 0 &&
    !Object.prototype.hasOwnProperty.call(data, 'moneyMovementPlanned') && !Object.prototype.hasOwnProperty.call(data, 'refundIntentId');
  const settledDismissal = decisionType === 'dismissed' && data.monetaryContext === 'settled_refund' &&
    data.totalCents > 0 && data.moneyMovementPlanned === false && reference(data.refundIntentId);
  const newRefund = decisionType === 'refund_without_return' && data.monetaryContext === 'new_instruction' &&
    data.moneyMovementPlanned === true && !Object.prototype.hasOwnProperty.call(data, 'refundIntentId');
  if (!ordinaryDismissal && !settledDismissal && !newRefund) throw unknown();
  if (decisionContext === 'return_to_sender_cases' ? decisionType !== 'refund_without_return' || !newRefund || data.decisionContext !== decisionContext ||
    !financialSource(data.returnToSender, transactionId, disputeId) || Object.prototype.hasOwnProperty.call(data, 'transportReview') : decisionContext === 'transport_review' ?
    decisionType !== 'refund_without_return' || !newRefund || data.decisionContext !== decisionContext || !transportSource(data.transportReview, transactionId, disputeId, transportReviewId) ||
    Object.prototype.hasOwnProperty.call(data, 'returnToSender') : decisionContext === 'product_review' ? data.decisionContext !== decisionContext ||
    !isAdminProductFinancialReference(data.productReview) || data.productReview.caseId !== productReviewCaseId || data.productReview.topic !== productReviewTopic ||
    (lateCommercial ? !productReviewEqual(data.productReview.lateCommercial, lateCommercial) : data.productReview.lateCommercial !== undefined) ||
    (data.productReview.materialCapability === 'product_review_material_v1') !== material || (data.productReview.parcelCapability === 'product_review_parcel_v1') !== parcel || !isAdminProductFinancialSource(data.productReviewSource, data.productReview) ||
    Object.prototype.hasOwnProperty.call(data, 'returnToSender') || Object.prototype.hasOwnProperty.call(data, 'transportReview') : decisionContext === 'purchase_refund_allocation' ? !allocation || data.decisionContext !== decisionContext || Object.prototype.hasOwnProperty.call(data, 'returnToSender') || Object.prototype.hasOwnProperty.call(data, 'transportReview') : Object.prototype.hasOwnProperty.call(data, 'decisionContext') || Object.prototype.hasOwnProperty.call(data, 'returnToSender') || Object.prototype.hasOwnProperty.call(data, 'transportReview')) throw unknown();
  if (decisionContext !== 'product_review' && (Object.prototype.hasOwnProperty.call(data, 'productReview') || Object.prototype.hasOwnProperty.call(data, 'productReviewSource'))) throw unknown();
  if (resume ? !['return_to_sender_cases', 'transport_review', 'product_review', ...(allocation ? ['purchase_refund_allocation'] : [])].includes(decisionContext ?? '') || !isAdminReturnToSenderFinancialResume(data.resume) ||
    data.resume.refundIntentId !== resume.refundIntentId || data.resume.refundAttemptId !== resume.refundAttemptId : Object.prototype.hasOwnProperty.call(data, 'resume')) throw unknown();
  return data as unknown as AdminFinancialPreview;
}
export function validAdminFinancialAttempt(v: unknown, uid: string): v is AdminFinancialAttempt {
  if (!record(v)) return false;
  return Object.keys(v).every(k => ['version', 'adminUid', 'transactionId', 'disputeId', 'requestId', 'note', 'previewId', 'expectedSourceHash',
    'expectedTotalCents', 'expectedCardCents', 'expectedWalletCents', 'expectedSellerDebitCents', 'decisionType', 'returnToSender', 'transportReview', 'productReview', 'resume', 'allocation'].includes(k)) &&
    v.version === 1 && v.adminUid === uid && reference(v.transactionId) && reference(v.disputeId) &&
    typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && typeof v.note === 'string' &&
    v.note.trim() === v.note && v.note.length >= 1 && v.note.length <= 500 && hash(v.previewId) && hash(v.expectedSourceHash) &&
    cents(v.expectedTotalCents) && v.expectedTotalCents > 0 && cents(v.expectedCardCents) && cents(v.expectedWalletCents) &&
    cents(v.expectedSellerDebitCents) && v.expectedCardCents + v.expectedWalletCents === v.expectedTotalCents && v.decisionType === 'refund_without_return' &&
    (!Object.prototype.hasOwnProperty.call(v, 'returnToSender') || financialReference(v.returnToSender, v.disputeId)) &&
    (!Object.prototype.hasOwnProperty.call(v, 'transportReview') || transportReference(v.transportReview, v.disputeId) && !Object.prototype.hasOwnProperty.call(v, 'returnToSender')) &&
    (!Object.prototype.hasOwnProperty.call(v, 'productReview') || isAdminProductFinancialReference(v.productReview) && !Object.prototype.hasOwnProperty.call(v, 'returnToSender') && !Object.prototype.hasOwnProperty.call(v, 'transportReview')) &&
    (!Object.prototype.hasOwnProperty.call(v, 'allocation') || isPurchaseRefundAllocation(v.allocation) && v.allocation.terms.settlementKind !== 'retain_remaining' && v.expectedTotalCents === v.allocation.terms.cardCents + v.allocation.terms.walletCents && v.expectedCardCents === v.allocation.terms.cardCents && v.expectedWalletCents === v.allocation.terms.walletCents && v.expectedSellerDebitCents === v.allocation.terms.sellerDebitCents) &&
    (!Object.prototype.hasOwnProperty.call(v, 'resume') || isAdminReturnToSenderFinancialResume(v.resume) && (financialReference(v.returnToSender, v.disputeId) || transportReference(v.transportReview, v.disputeId) || isAdminProductFinancialReference(v.productReview) || isPurchaseRefundAllocation(v.allocation)));
}
/** The financial engine sorts object keys recursively; existing primitive tuples keep the same bytes. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value === undefined ? null : value;
}
const matches = (a: AdminFinancialAttempt, b: AdminFinancialAttempt) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function adminFinancialInput(a: AdminFinancialAttempt) {
  return { adminUid: a.adminUid, transactionId: a.transactionId, expectedDisputeId: a.disputeId, requestId: a.requestId,
    previewId: a.previewId, expectedSourceHash: a.expectedSourceHash, expectedTotalCents: a.expectedTotalCents, expectedCardCents: a.expectedCardCents,
    expectedWalletCents: a.expectedWalletCents, expectedSellerDebitCents: a.expectedSellerDebitCents, decisionType: a.decisionType, note: a.note,
    ...(a.returnToSender ? {returnToSender: a.returnToSender} : {}), ...(a.transportReview ? {transportReview: a.transportReview} : {}), ...(a.productReview ? {productReview: a.productReview} : {}), ...(a.allocation ? {allocation: a.allocation} : {}), ...(a.resume ? {resume: a.resume} : {}) };
}
export async function parseAdminFinancialDecision(data: unknown, a: AdminFinancialAttempt): Promise<AdminFinancialDecision> {
  const input = adminFinancialInput(a);
  const [decisionId, payloadHash] = await Promise.all([
    digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([a.resume ? 'refund_resume' : 'refund', a.transactionId, a.adminUid, a.requestId])),
    digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(input))),
  ]);
  if (!record(data) || data.protocol !== 'admin_financial_decision_v1' || data.transactionId !== a.transactionId || data.expectedDisputeId !== a.disputeId ||
      data.actorUid !== a.adminUid || data.requestId !== a.requestId || data.decisionId !== decisionId || data.payloadHash !== payloadHash ||
      data.previewId !== a.previewId || data.sourceHash !== a.expectedSourceHash || data.note !== a.note || data.decisionType !== a.decisionType ||
      data.currency !== 'CAD' || data.totalCents !== a.expectedTotalCents || data.cardCents !== a.expectedCardCents ||
      data.walletCents !== a.expectedWalletCents || data.sellerDebitCents !== a.expectedSellerDebitCents || data.inventoryPermissionGranted !== false ||
      data.physicalPossession !== 'unknown' || (a.allocation ? typeof data.bilateralAgreementVerified !== 'boolean' : data.bilateralAgreementVerified !== false)) throw unknown();
  if (a.allocation ? !isPurchaseRefundAllocation(data.allocation) || !productReviewEqual(data.allocation, a.allocation) : Object.prototype.hasOwnProperty.call(data, 'allocation')) throw unknown();
  if (a.returnToSender ? !financialReference(data.returnToSender, a.disputeId) || JSON.stringify(canonical(data.returnToSender)) !== JSON.stringify(canonical(a.returnToSender)) :
    Object.prototype.hasOwnProperty.call(data, 'returnToSender')) throw unknown();
  if (a.transportReview ? !transportReference(data.transportReview, a.disputeId) || JSON.stringify(canonical(data.transportReview)) !== JSON.stringify(canonical(a.transportReview)) : Object.prototype.hasOwnProperty.call(data, 'transportReview')) throw unknown();
  if (a.productReview ? !isAdminProductFinancialReference(data.productReview) || !productReviewEqual(data.productReview, a.productReview) : Object.prototype.hasOwnProperty.call(data, 'productReview')) throw unknown();
  if (a.resume ? !isAdminReturnToSenderFinancialResume(data.resume) || data.resume.refundIntentId !== a.resume.refundIntentId ||
    data.resume.refundAttemptId !== a.resume.refundAttemptId : Object.prototype.hasOwnProperty.call(data, 'resume')) throw unknown();
  if (data.outcome === 'unrecorded') {
    if (data.decisionCommitted !== false || data.effectsCommitted !== false || data.intentionNeutralized !== false ||
        data.lateRequestBlocked !== false || data.retryPermissionGranted !== false || data.bilateralAgreementVerified !== false) throw unknown();
  } else {
    if (!ownerIdentity(data.buyerId) || !ownerIdentity(data.sellerId) || data.buyerId === data.sellerId || !time(data.committedAt)) throw unknown();
    if (data.outcome === 'not_executed') {
      const explicitNeutralization = (data.reason === 'intention_neutralized_before_effects' || a.allocation && data.reason === 'allocation_sources_unqualified') && data.sourceExamined === false && data.observedSourceHash === null;
      const changedSource = ['source_changed', 'another_refund_reserved'].includes(String(data.reason)) && hash(data.observedSourceHash);
      if (data.decisionCommitted !== false || data.effectsCommitted !== false || data.intentionNeutralized !== true || data.lateRequestBlocked !== true ||
          data.nonExecutionQualified !== true || data.retryPermissionGranted !== false || !explicitNeutralization && !changedSource) throw unknown();
    } else if (data.outcome === 'reserved') {
      const f = data.financial;
      if (data.bilateralAgreementVerified !== (a.allocation ? a.allocation.agreement !== null : false) || data.decisionCommitted !== true || data.effectsCommitted !== true || data.intentionNeutralized !== false || data.lateRequestBlocked !== false ||
          !reference(data.refundIntentId) || a.resume && data.refundIntentId !== a.resume.refundIntentId || data.manualCorrectionRequired !== true || !cents(data.disputesClosed) || data.disputesClosed > 1 ||
          !ids(data.remainingOpenDisputeIds) || !ids(data.retainedObligations) || !record(f) || f.intentId !== data.refundIntentId ||
          !['pending', 'requires_action', 'unknown', 'succeeded', 'failed', 'canceled', 'reconciliation_required'].includes(String(f.status)) ||
          typeof f.success !== 'boolean' || f.success !== (f.status === 'succeeded') || typeof f.actionRequired !== 'boolean' ||
          typeof f.localReconciliationRequired !== 'boolean' || typeof f.bankWaiting !== 'boolean' || typeof f.message !== 'string' ||
          !(f.refundId === null || typeof f.refundId === 'string' && /^re_[A-Za-z0-9_]+$/.test(f.refundId)) ||
          !(f.outstandingCardCents === null || cents(f.outstandingCardCents) && f.outstandingCardCents <= a.expectedCardCents) ||
          f.success && (f.outstandingCardCents !== 0 || f.localReconciliationRequired || f.bankWaiting || f.actionRequired ||
            a.expectedCardCents > 0 && f.refundId === null)) throw unknown();
    } else throw unknown();
  }
  return data as unknown as AdminFinancialDecision;
}
export async function readAdminFinancialAttempts(uid: string, assertContext: () => void): Promise<AdminFinancialAttempt[]> {
  const session = captureTradeSession(uid); assertContext();
  const raw = await AsyncStorage.getItem(key(uid)); assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return [];
  let value: unknown; try { value = JSON.parse(raw); } catch { throw unknown(); }
  if (!Array.isArray(value) || !value.every(v => validAdminFinancialAttempt(v, uid)) ||
      new Set(value.map(v => v.transactionId)).size !== value.length) throw unknown();
  return value;
}
export async function runAdminFinancialDecision<T>(uid: string, transactionId: string, assertContext: () => void, work: () => Promise<T>): Promise<T> {
  const session = captureTradeSession(uid); const slot = JSON.stringify([uid, transactionId]); assertContext();
  if (!reference(transactionId) || active.has(slot)) throw unknown(); active.add(slot);
  try { assertTradeSessionCurrent(session); return await work(); } finally { active.delete(slot); }
}
async function serialize(uid: string, work: () => Promise<void>) {
  const pending = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(uid, pending);
  try { await pending; } finally { if (writes.get(uid) === pending) writes.delete(uid); }
}
export async function rememberAdminFinancialAttempt(a: AdminFinancialAttempt, assertContext: () => void) {
  const session = captureTradeSession(a.adminUid);
  await serialize(session.uid, async () => {
    assertTradeSessionCurrent(session); assertContext(); if (!validAdminFinancialAttempt(a, session.uid)) throw unknown();
    const all = await readAdminFinancialAttempts(session.uid, assertContext), old = all.find(v => v.transactionId === a.transactionId);
    if (old && !matches(old, a)) throw unknown(); assertTradeSessionCurrent(session); assertContext();
    await AsyncStorage.setItem(key(session.uid), JSON.stringify(old ? all : [...all, a])); assertTradeSessionCurrent(session); assertContext();
  });
}
/** Only a freshly observed, qualified native receipt permits removing local follow-up. */
export async function acknowledgeAdminFinancialAttempt(a: AdminFinancialAttempt, receipt: AdminFinancialDecision, assertContext: () => void) {
  const session = captureTradeSession(a.adminUid);
  await serialize(session.uid, async () => {
    assertTradeSessionCurrent(session); assertContext();
    const qualified = await parseAdminFinancialDecision(receipt, a); assertTradeSessionCurrent(session); assertContext();
    if (qualified.outcome === 'unrecorded') throw unknown();
    const all = await readAdminFinancialAttempts(session.uid, assertContext), old = all.find(v => v.transactionId === a.transactionId);
    if (!old || !matches(old, a)) throw unknown(); assertTradeSessionCurrent(session); assertContext();
    await AsyncStorage.setItem(key(session.uid), JSON.stringify(all.filter(v => v.transactionId !== a.transactionId)));
    assertTradeSessionCurrent(session); assertContext();
  });
}
