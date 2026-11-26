import {observeTransportContactFollowUps} from './transportContactReview';
/** Native transport inquiries. A narrative, ETA or DE is never a money instruction. */
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { trackingProofMatches, type QualifiedTracking } from '../config/shipEngine';
import { supportHash, supportSourceHash, supportCurrentAdminSession, supportAdmin } from './supportRequest';
import { prepareOperationalNotices } from './notifications';
import { deliveryCorrectionBlocksProgress, orderModerationAllowsProgress } from './orderModeration';
import { buildDeliveryCorrectionWindow, effectivePurchaseReleaseAt, effectiveDeliveryProtectionWindow } from './purchasePolicy';
import { hasActiveBankDispute, hasCommercialDispute } from './bankDispute';
import { hasUnsettledRefund } from './refundState';
import { hasUnsettledReturnRequest } from './returnRequest';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';

import {assertRecentAccountAuthentication} from './eligibility';
import {LABEL_DEPOSIT_REVIEW_ENABLED, labelDepositReviewOptIn, assertLabelDepositReviewOpen, readLabelDepositDeadline,
  labelDepositReviewIdentity, labelDepositDeadlineCloseQualified, labelDepositOriginQualified} from './labelDepositReview';

type Data = FirebaseFirestore.DocumentData;
type Proof = QualifiedTracking['proof'];
type Kind = 'participant_transit' | 'carrier_exception' | 'delivery_correction' | 'label_deposit_deadline';
export type TransportReviewSource = { orderRevision: string; sourceHash: string; financialSourceHash: string;
  reviewId: string | null; reviewRevision: string | null; reviewHash: string | null };
export type TransportInquiryEntry = { kind: 'evidence' | 'carrier_contact' | 'participant_contact' | 'follow_up' | 'assessment';
  source: 'operator_observation' | 'participant_statement' | 'carrier_statement' | 'document_reference';
  summary: string; reference: string | null; occurredAt: string | null; nextFollowUpAt: string | null };
type Intent = { transactionId: string; source: TransportReviewSource } & (
  { action: 'report_transit'; narrative: string } |
  { action: 'record_inquiry'; reviewId: string; entry: TransportInquiryEntry; previewId?: string } |
  { action: 'close_inquiry'; reviewId: string; outcome: 'review_completed' | 'signal_not_established' | 'further_action_required'; reason: string; ownerMessage: string; previewId?: string } |
  { action: 'resolve_delivery_correction'; reviewId: string; reason: string; ownerMessage: string; previewId?: string } |
  { action: 'resolve_carrier_exception'; reviewId: string; finding: 'incident_resolved' | 'financial_review_required'; reason: string; ownerMessage: string; previewId?: string }
);
export const TRANSPORT_REFUND_OPTIONS = { refundScope: 'full_original_payment', relistArticle: false,
  extraSellerDebitCents: 0, returnCostDeductionCents: 0 } as const;
export type TransportFinancialReference = { protocol: 'transport_financial_reference_v1'; kind: 'delivery_correction' | 'carrier_exception';
  reviewId: string; reviewRevision: string; reviewHash: string; caseReferences: { reviewId: string; reviewRevision: string; reviewHash: string }[];
  caseSetHash: string; financialSourceHash: string; authorizationSourceHash: string; cause: string; options: typeof TRANSPORT_REFUND_OPTIONS };
const PROTOCOL = 'transport_review_v1';
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const deadline = (value: unknown): value is Timestamp => value instanceof Timestamp && Number.isSafeInteger(value.toMillis()) && value.toMillis() >= 0;
const time = (value: unknown): value is Timestamp => deadline(value) && value.toMillis() <= Date.now();
const iso = (value: unknown) => time(value) ? value.toDate().toISOString() : null;
const deadlineIso = (value: unknown) => deadline(value) ? value.toDate().toISOString() : null;
const revision = (value: { updateTime?: Timestamp }) => value.updateTime ? `${value.updateTime.seconds}:${value.updateTime.nanoseconds}` : null;
const rows = (transactionId: string) => db.collection('transactions').doc(transactionId).collection('transport_reviews');
const reviewId = (value: unknown): value is string => typeof value === 'string' && /^case_[a-f0-9]{64}$/.test(value);
const cursorId = (value: unknown): value is string => typeof value === 'string' && value.startsWith('case_') &&
  !value.includes('/') && Buffer.byteLength(value, 'utf8') <= 1500;
const object = (value: any, keys: string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new HttpsError('invalid-argument', 'Paramètres de transport invalides.');
  return value;
};
const text = (value: unknown, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpsError('invalid-argument', 'Texte explicite requis.');
  return value.trim();
};
function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new HttpsError('invalid-argument', 'Date ISO exacte ou inconnue requise.');
  return value;
}
function source(value: any): TransportReviewSource {
  object(value, ['orderRevision', 'sourceHash', 'financialSourceHash', 'reviewId', 'reviewRevision', 'reviewHash']);
  if (!/^\d+:\d+$/.test(value.orderRevision ?? '') || !hash(value.sourceHash) || !hash(value.financialSourceHash) ||
      (value.reviewId === null ? value.reviewRevision !== null || value.reviewHash !== null :
        !reviewId(value.reviewId) || !/^\d+:\d+$/.test(value.reviewRevision ?? '') || !hash(value.reviewHash)))
    throw new HttpsError('invalid-argument', 'Sources exactes de la commande et du dossier requises.');
  return { orderRevision: value.orderRevision, sourceHash: value.sourceHash, financialSourceHash: value.financialSourceHash,
    reviewId: value.reviewId, reviewRevision: value.reviewRevision, reviewHash: value.reviewHash };
}
function intent(value: any): Intent {
  object(value, ['action', 'transactionId', 'source', 'reviewId', 'narrative', 'entry', 'outcome', 'finding', 'reason', 'ownerMessage', 'previewId']);
  if (!id(value.transactionId)) throw new HttpsError('invalid-argument', 'Commande exacte requise.');
  const common = { transactionId: value.transactionId, source: source(value.source) };
  const actionFields: Record<string, string[]> = { report_transit: ['narrative'], record_inquiry: ['reviewId', 'entry', 'previewId'],
    close_inquiry: ['reviewId', 'outcome', 'reason', 'ownerMessage', 'previewId'], resolve_delivery_correction: ['reviewId', 'reason', 'ownerMessage', 'previewId'],
    resolve_carrier_exception: ['reviewId', 'finding', 'reason', 'ownerMessage', 'previewId'] };
  if (!actionFields[value.action] || Object.keys(value).some(key => !['action', 'transactionId', 'source', ...actionFields[value.action]].includes(key)))
    throw new HttpsError('invalid-argument', 'Champs propres à cette action requis.');
  if (value.action === 'report_transit') {
    if (Object.keys(value).some(key => !['action', 'transactionId', 'source', 'narrative'].includes(key)) || common.source.reviewId !== null)
      throw new HttpsError('invalid-argument', 'Une déclaration participante vise sa propre source.');
    return { ...common, action: 'report_transit', narrative: text(value.narrative, 4000) };
  }
  if (!reviewId(value.reviewId) || common.source.reviewId !== value.reviewId ||
      value.previewId !== undefined && !/^preview_[a-f0-9]{64}$/.test(value.previewId)) throw new HttpsError('invalid-argument', 'Dossier et aperçu exacts requis.');
  const admin = { ...common, reviewId: value.reviewId, ...(value.previewId === undefined ? {} : { previewId: value.previewId }) };
  if (value.action === 'record_inquiry') {
    const entry = object(value.entry, ['kind', 'source', 'summary', 'reference', 'occurredAt', 'nextFollowUpAt']);
    if (!['evidence', 'carrier_contact', 'participant_contact', 'follow_up', 'assessment'].includes(entry.kind) ||
        !['operator_observation', 'participant_statement', 'carrier_statement', 'document_reference'].includes(entry.source))
      throw new HttpsError('invalid-argument', 'Nature et source déclarée de la démarche requises.');
    return { ...admin, action: 'record_inquiry', entry: { kind: entry.kind, source: entry.source, summary: text(entry.summary, 2000),
      reference: entry.reference === null ? null : text(entry.reference, 500), occurredAt: date(entry.occurredAt), nextFollowUpAt: date(entry.nextFollowUpAt) } };
  }
  const explanation = { reason: text(value.reason, 2000), ownerMessage: text(value.ownerMessage, 2000) };
  if (value.action === 'close_inquiry' && ['review_completed', 'signal_not_established', 'further_action_required'].includes(value.outcome))
    return { ...admin, ...explanation, action: 'close_inquiry', outcome: value.outcome };
  if (value.action === 'resolve_delivery_correction') return { ...admin, ...explanation, action: 'resolve_delivery_correction' };
  if (value.action === 'resolve_carrier_exception' && ['incident_resolved', 'financial_review_required'].includes(value.finding))
    return { ...admin, ...explanation, action: 'resolve_carrier_exception', finding: value.finding };
  throw new HttpsError('invalid-argument', 'Action de transport inconnue.');
}
function qualifiedReview(value: any, transactionId: string, order: Data) {
  return !!value && value.protocol === PROTOCOL && reviewId(value.reviewId) && value.transactionId === transactionId &&
    value.buyerId === order.buyerId && value.sellerId === order.sellerId && time(value.createdAt) && time(value.updatedAt) &&
    value.body?.version > 0 && Number.isSafeInteger(value.body.version) && ['participant_transit', 'carrier_exception', 'delivery_correction', 'label_deposit_deadline'].includes(value.body.kind) &&
    ['open', 'closed', 'resolved', 'financial_review_required'].includes(value.body.state) && ['open', 'closed'].includes(value.body.inquiryState) &&
    Array.isArray(value.body.entries) && value.body.entries.length <= 100 && value.contentHash === supportSourceHash(value.body) &&
    (value.body.kind === 'participant_transit' ? value.body.origin?.kind === 'participant' &&
      [order.buyerId, order.sellerId].includes(value.body.origin.reportedBy) && typeof value.body.origin.narrative === 'string' &&
      value.body.origin.narrative.length <= 4000 : value.body.kind === 'label_deposit_deadline'
        ? labelDepositOriginQualified(value.body.origin, transactionId) : value.body.origin?.kind === 'system' && value.body.origin.provider === 'shipengine' &&
      hash(value.body.origin.trackingSourceHash) && hash(value.body.origin.observationHash)) &&
    value.body.entries.every((entry: any) => id(entry?.recordedBy) && time(entry.recordedAt) && typeof entry.summary === 'string' && entry.summary.length <= 2000 &&
      ['evidence', 'carrier_contact', 'participant_contact', 'follow_up', 'assessment'].includes(entry.kind) &&
      ['operator_observation', 'participant_statement', 'carrier_statement', 'document_reference'].includes(entry.source));
}
function exceptionMarkerQualified(order: Data, transactionId: string) {
  const value = order.transportExceptionReview;
  return value?.protocol === 'transport_exception_guard_v1' && value.transactionId === transactionId && value.buyerId === order.buyerId &&
    value.sellerId === order.sellerId && time(value.createdAt) && value.sourceComplete === true && Array.isArray(value.reviewIds) &&
    value.reviewIds.length > 0 && value.reviewIds.length <= 100 && value.reviewIds.every(reviewId) && new Set(value.reviewIds).size === value.reviewIds.length;
}
function nativeDisputedOwnership(order: Data, transactionId: string) {
  const correction = order.deliveryCorrection;
  return correction?.flagProvenance?.schemaVersion === 1 && correction.flagProvenance.disputedOwnership === 'native_owned' &&
    correction.transactionId === transactionId && correction.buyerId === order.buyerId && correction.sellerId === order.sellerId ||
    exceptionMarkerQualified(order, transactionId) && order.transportExceptionReview.disputedFlagOwnership === 'native_owned';
}
/** A resolution may clear only attributable transport flags. Other native
 * claims/markers remain independent, even when they share the boolean. */
async function resolvedOwnFlagPatch(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data,
  selected: string, projectedOrder: Data, targetDisputeId: string | null) {
  const reviews = await tx.get(rows(transactionId).orderBy(FieldPath.documentId()).startAt('case_').endBefore('case`').limit(101));
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
  if (reviews.size >= 101 || claims.size >= 101 || reviews.docs.some(doc => doc.id !== doc.data().reviewId || !qualifiedReview(doc.data(), transactionId, order)) ||
      claims.docs.some(doc => doc.data().transactionId !== transactionId || doc.data().buyerId !== order.buyerId ||
        doc.data().sellerId !== order.sellerId || !time(doc.data().createdAt) || !['open', 'resolved', 'dismissed', 'closed'].includes(doc.data().status))) return {};
  const openEX = reviews.docs.some(doc => doc.id !== selected && doc.data().body.kind === 'carrier_exception' && !['resolved', 'closed'].includes(doc.data().body.state));
  const patch: Data = {};
  if (!openEX && exceptionMarkerQualified(order, transactionId) && order.transportExceptionReview.reviewIds.includes(selected) &&
      order.transportExceptionReview.trackingFlagOwnership === 'native_owned' && order.trackingReviewRequired === true &&
      order.trackingReviewReason === 'carrier_exception_requires_human_review') patch.trackingReviewRequired = false;
  const examined = { ...projectedOrder, ...patch };
  const unrelatedClaim = claims.docs.some(doc => doc.id !== targetDisputeId && !['resolved', 'dismissed', 'closed'].includes(doc.data().status));
  const otherMarker = Object.prototype.hasOwnProperty.call(examined, 'returnToSenderGuard') || Object.prototype.hasOwnProperty.call(examined, 'fraudReview') ||
    examined.bankDispute != null || examined.disputeId != null || examined.refund != null || examined.returnRequest != null ||
    examined.returnRequestedAt != null || examined.returnLabelId != null || examined.returnTrackingNumber != null ||
    examined.purchasePolicyReviewRequired === true || examined.labelReconciliationRequired === true || examined.trackingReviewRequired === true ||
    deliveryCorrectionBlocksProgress(examined);
  const moderationAllowsOwnResolution = await orderModerationAllowsProgress(tx, { ...examined, disputed: false });
  if (order.disputed === true && nativeDisputedOwnership(order, transactionId) && !unrelatedClaim && !otherMarker && !openEX && moderationAllowsOwnResolution)
    patch.disputed = false;
  return patch;
}
export function parseTransportFinancialReference(value: any): TransportFinancialReference {
  object(value, ['protocol', 'kind', 'reviewId', 'reviewRevision', 'reviewHash', 'caseReferences', 'caseSetHash', 'financialSourceHash', 'authorizationSourceHash', 'cause', 'options']);
  if (value.protocol !== 'transport_financial_reference_v1' || !['delivery_correction', 'carrier_exception'].includes(value.kind) ||
      !reviewId(value.reviewId) || !/^\d+:\d+$/.test(value.reviewRevision ?? '') || !hash(value.reviewHash) ||
      !['caseSetHash', 'financialSourceHash', 'authorizationSourceHash'].every(key => hash(value[key])) ||
      !Array.isArray(value.caseReferences) || value.caseReferences.length < 1 || value.caseReferences.length > 20 ||
      value.caseReferences.some((entry: any, index: number) => !entry || Object.keys(entry).sort().join(',') !== 'reviewHash,reviewId,reviewRevision' ||
        !reviewId(entry.reviewId) || !/^\d+:\d+$/.test(entry.reviewRevision ?? '') || !hash(entry.reviewHash) ||
        index > 0 && value.caseReferences[index - 1].reviewId >= entry.reviewId) ||
      !value.caseReferences.some((entry: any) => entry.reviewId === value.reviewId && entry.reviewHash === value.reviewHash && entry.reviewRevision === value.reviewRevision) ||
      !value.options || Object.keys(value.options).sort().join(',') !== Object.keys(TRANSPORT_REFUND_OPTIONS).sort().join(',') ||
      Object.entries(TRANSPORT_REFUND_OPTIONS).some(([key, expected]) => value.options[key] !== expected))
    throw new HttpsError('invalid-argument', 'Dossier, liste complète et options exactes requis.');
  return { protocol: 'transport_financial_reference_v1', kind: value.kind, reviewId: value.reviewId, reviewRevision: value.reviewRevision,
    reviewHash: value.reviewHash, caseReferences: value.caseReferences.map((entry: any) => ({ reviewId: entry.reviewId, reviewRevision: entry.reviewRevision, reviewHash: entry.reviewHash })),
    caseSetHash: value.caseSetHash, financialSourceHash: value.financialSourceHash, authorizationSourceHash: value.authorizationSourceHash,
    cause: text(value.cause, 300), options: { ...TRANSPORT_REFUND_OPTIONS } };
}
/** Native inquiry source for an explicit financial instruction. This helper
 * grants neither bank/RTS/risk/return permission nor possession/inventory. */
export async function readTransportFinancialSource(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data,
  selected: string, reserved = false) {
  const current = await frame(tx, transactionId, selected), record = current.record!;
  if (!['delivery_correction', 'carrier_exception'].includes(record.body.kind) || !['open', 'financial_review_required'].includes(record.body.state) ||
      record.body.entries.length < 1) throw new HttpsError('failed-precondition', 'Une enquête native examinée est requise.', { reason: 'transport_financial_review_required' });
  const reviews = await tx.get(rows(transactionId).orderBy(FieldPath.documentId()).startAt('case_').endBefore('case`').limit(21));
  if (reviews.size < 1 || reviews.size > 20 || reviews.docs.some(doc => doc.id !== doc.data().reviewId || !qualifiedReview(doc.data(), transactionId, order)))
    throw new HttpsError('failed-precondition', 'L’ensemble des dossiers doit être rapproché.', { reason: 'transport_financial_review_required' });
  if (record.body.kind === 'delivery_correction' && (record.body.origin.correctionId !== order.deliveryCorrection?.correctionId ||
      order.deliveryCorrection?.transportReviewId !== selected)) throw new HttpsError('failed-precondition', 'Correction examinée différente.');
  if (record.body.kind === 'carrier_exception' && (!exceptionMarkerQualified(order, transactionId) || !order.transportExceptionReview.reviewIds.includes(selected)))
    throw new HttpsError('failed-precondition', 'Source de l’exception à rapprocher.');
  if (order.disputed === true && !nativeDisputedOwnership(order, transactionId) || order.trackingReviewRequired === true &&
      (!exceptionMarkerQualified(order, transactionId) || order.transportExceptionReview.trackingFlagOwnership !== 'native_owned' ||
        order.trackingReviewReason !== 'carrier_exception_requires_human_review'))
    throw new HttpsError('failed-precondition', 'Une garde d’origine inconnue exige un examen.', { reason: 'transport_financial_review_required' });
  const ledgerSources: unknown[] = [];
  for (const uid of [order.buyerId, order.sellerId]) {
    const ledger = await tx.get(db.collection('wallets').doc(uid).collection('ledger').where('transactionId', '==', transactionId).limit(101));
    const entries = ledger.docs.filter(doc => {
      if (reserved && uid === order.sellerId && doc.id === `refund_hold_${order.refund?.intentId}`) {
        const value = doc.data();
        if (value.type !== 'refund_hold' || value.refundIntentId !== order.refund.intentId || value.amount !== order.refund.freezeCents || !time(value.createdAt))
          throw new HttpsError('failed-precondition', 'Réservation native à rapprocher.');
        return false;
      }
      return true;
    });
    if (ledger.size >= 101 || entries.some(doc => doc.data().transactionId !== transactionId || !time(doc.data().createdAt) ||
        !Number.isSafeInteger(doc.data().amount) || doc.data().amount < 0 || ['refund_credit', 'refund_debit', 'refund_hold'].includes(doc.data().type)))
      throw new HttpsError('failed-precondition', 'Mouvements natifs à rapprocher.');
    if (uid === order.sellerId) {
      const credits = entries.filter(doc => doc.data().type === 'sale_credit');
      const debts = entries.filter(doc => doc.data().type === 'debt_repayment' && doc.data().description === 'Vente — régularisation du solde dû');
      if (credits.length > 1 || debts.length > 1 || [...credits, ...debts].reduce((sum, doc) => sum + doc.data().amount, 0) !== order.sellerCreditedCents)
        throw new HttpsError('failed-precondition', 'Crédit original à rapprocher.');
    }
    ledgerSources.push([uid, entries.map(doc => [doc.id, doc.data()])]);
  }
  const caseReferences = reviews.docs.map(doc => ({ reviewId: doc.id, reviewRevision: revision(doc)!, reviewHash: doc.data().contentHash as string }));
  const protectedOrder = { ...order } as Data;
  for (const key of ['refund', 'refundBlocked', 'refundReason', 'refundStartedAt', 'transportReviewFollowUpScan']) delete protectedOrder[key];
  if (reserved) protectedOrder.status = order.refund.originalStatus;
  return { protocol: 'transport_financial_source_v1' as const, kind: record.body.kind as 'delivery_correction' | 'carrier_exception',
    review: view(record), caseReferences, caseSetHash: supportHash(caseReferences), financialSourceHash: current.reference.financialSourceHash,
    authorizationSourceHash: supportSourceHash([protectedOrder, caseReferences, ledgerSources,
      current.claims.docs.map(doc => [doc.id, doc.data()])]), qualification: 'qualified' as const,
    financialPermissionScope: 'full_original_refund_only' as const, options: { ...TRANSPORT_REFUND_OPTIONS }, financialEffectAuthorized: false,
    inventoryReleaseAuthorized: false, parcelPossessionVerified: false, reviewSnap: current.reviewSnap!, allReviews: reviews };
}
function visibleSource(value: any) {
  const capture = value?.capture;
  return { reference: visibleReference(value?.reference), capture: capture && /^tracking_[a-f0-9]{64}$/.test(capture.captureId ?? '') &&
      hash(capture.displayHash) && hash(capture.sourceHash) && Number.isSafeInteger(capture.readVersion) && capture.readVersion > 0
    ? { captureId: capture.captureId, displayHash: capture.displayHash, sourceHash: capture.sourceHash, readVersion: capture.readVersion } : null,
    captureQualification: ['native_capture', 'absent', 'historical_unknown'].includes(value?.captureQualification) ? value.captureQualification : 'historical_unknown' };
}
function visibleReference(value: any) {
  return value ? { orderRevision: typeof value.orderRevision === 'string' ? value.orderRevision : null,
    sourceHash: hash(value.sourceHash) ? value.sourceHash : null, financialSourceHash: hash(value.financialSourceHash) ? value.financialSourceHash : null,
    reviewId: reviewId(value.reviewId) ? value.reviewId : null, reviewRevision: typeof value.reviewRevision === 'string' ? value.reviewRevision : null,
    reviewHash: hash(value.reviewHash) ? value.reviewHash : null } : null;
}
function visibleDecision(value: any) {
  return value ? { finding: value.finding ?? null, outcome: value.outcome ?? null, reason: value.reason,
    ownerMessage: value.ownerMessage, recordedBy: value.recordedBy, recordedAt: iso(value.recordedAt),
    sourceExamined: visibleReference(value.sourceExamined), financialEffectAuthorized: false, otherGuardsRetained: true } : null;
}
function view(value: any) {
  const origin = value.body.origin;
  return { protocol: PROTOCOL, reviewId: value.reviewId, transactionId: value.transactionId, kind: value.body.kind,
    version: value.body.version, state: value.body.state, inquiryState: value.body.inquiryState,
    origin: origin.kind === 'participant' ? { kind: 'participant', reportedBy: origin.reportedBy, narrative: origin.narrative, reportVerified: false } :
      value.body.kind === 'label_deposit_deadline' ? {kind: 'system', source: 'accepted_contract_deadline', reportedBy: null, deadline: origin.deadline} :
      { kind: 'system', provider: 'shipengine', statusCode: origin.statusCode, trackingSourceHash: origin.trackingSourceHash,
        observationHash: origin.observationHash, occurredAt: origin.occurredAt, correctionId: origin.correctionId, disputeId: origin.disputeId,
        previousReviewId: origin.previousReviewId ?? null, reportedBy: null },
    initialSource: visibleSource(value.body.initialSource), entries: value.body.entries.map((entry: any) => ({ kind: entry.kind, source: entry.source,
      summary: entry.summary, reference: entry.reference, occurredAt: entry.occurredAt, nextFollowUpAt: entry.nextFollowUpAt,
      recordedBy: entry.recordedBy, recordedAt: iso(entry.recordedAt), sourceExamined: visibleReference(entry.sourceExamined), sourceDeclared: true, independentlyVerified: false })),
    closure: visibleDecision(value.body.closure), resolution: visibleDecision(value.body.resolution),
    createdAt: iso(value.createdAt), updatedAt: iso(value.updatedAt), financialEffectAuthorized: false, inventoryReleaseAuthorized: false,
    parcelPossessionVerified: false, terminalLossVerified: false };
}
async function frame(tx: FirebaseFirestore.Transaction, transactionId: string, selected: string | null = null, deadlineContext = false) {
  const snap = await tx.get(db.collection('transactions').doc(transactionId)), order = snap.data();
  if (!order || !id(order.buyerId) || !id(order.sellerId) || order.buyerId === order.sellerId || !snap.updateTime)
    throw new HttpsError('permission-denied', 'Commande privée non autorisée.');
  const reviewSnap = selected ? await tx.get(rows(transactionId).doc(selected)) : null, record = reviewSnap?.data();
  if (selected && (!qualifiedReview(record, transactionId, order) || record?.reviewId !== selected || !reviewSnap?.updateTime ||
      record?.body.kind === 'label_deposit_deadline' && !deadlineContext))
    throw new HttpsError('failed-precondition', 'Dossier historique à rapprocher.');
  const pointer = order.trackingHistoryCapture;
  const capture = /^tracking_[a-f0-9]{64}$/.test(pointer?.captureId ?? '') ? (await tx.get(snap.ref.collection('tracking_history').doc(pointer.captureId))).data() : null;
  const info = capture?.info, nativeCapture = capture?.protocol === 'tracking_history_v1' && capture.captureId === pointer.captureId &&
    capture.buyerId === order.buyerId && capture.sellerId === order.sellerId && time(capture.recordedAt) && info?.transactionId === transactionId &&
    info.leg === 'forward' && hash(info.sourceHash) && id(info.readId) && Number.isSafeInteger(info.readVersion) && info.readVersion > 0 &&
    Array.isArray(capture.pageHashes) && capture.pageHashes.every(hash) && capture.displayHash ===
      createHash('sha256').update(JSON.stringify(['tracking_history_v1', info, capture.pageHashes])).digest('hex');
  const captureView = nativeCapture ? { captureId: capture.captureId, displayHash: capture.displayHash, sourceHash: info.sourceHash, readVersion: info.readVersion } : null;
  const candidate = [order.trackingObservation, order.trackingSnapshot, order.trackingIdentityProof]
    .find(value => time(value?.recordedAt) && trackingProofMatches(transactionId, order, value, 'forward'));
  let currentProof: Proof | null = candidate ?? null;
  if (currentProof) {
    const [forward, returned] = await Promise.all([
      tx.get(db.collection('transactions').where('trackingNumber', '==', currentProof.trackingNumber).limit(2)),
      tx.get(db.collection('transactions').where('returnTrackingNumber', '==', currentProof.trackingNumber).limit(2)),
    ]);
    if (forward.size !== 1 || forward.docs[0].id !== transactionId || returned.size !== 0) currentProof = null;
  }
  const ledger = await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
  const releaseRows = ledger.docs.filter(doc => doc.data().type === 'funds_released');
  const released = time(order.fundsReleasedAt) && ledger.size < 101 && releaseRows.length === 1 &&
    releaseRows[0].data().amount === order.sellerReleasedCents && Number.isSafeInteger(order.sellerReleasedCents) && order.sellerReleasedCents >= 0 &&
    time(releaseRows[0].data().createdAt) && releaseRows[0].data().createdAt.isEqual(order.fundsReleasedAt);
  const held = order.fundsReleasedAt == null && order.status !== 'completed' && deadline(order.fundsReleaseAt) && ledger.size < 101 &&
    Number.isSafeInteger(order.sellerCreditedCents) && order.sellerCreditedCents >= 0;
  const financialSourceHash = supportSourceHash([order.refund ?? null, order.refundedAt ?? null, order.bankDispute ?? null,
    order.fundsReleaseAt ?? null, order.fundsReleasedAt ?? null, order.sellerCreditedCents ?? null, order.sellerReleasedCents ?? null,
    ledger.docs.map(doc => [doc.id, doc.data()])]);
  const depositDeadline = deadlineContext ? await readLabelDepositDeadline(tx, transactionId, order) : null;
  const referenceParts: unknown[] = [order, capture, record ?? null, financialSourceHash, claims.docs.map(doc => [doc.id, doc.data()])];
  if (deadlineContext) referenceParts.push(depositDeadline);
  const reference: TransportReviewSource = { orderRevision: revision(snap)!, sourceHash: supportSourceHash(referenceParts),
    financialSourceHash, reviewId: selected, reviewRevision: reviewSnap ? revision(reviewSnap) : null, reviewHash: record?.contentHash ?? null };
  const correction = order.deliveryCorrection;
  const correctionQualified = correction?.schemaVersion === 1 && hash(correction.correctionId) && correction.transactionId === transactionId &&
    correction.buyerId === order.buyerId && correction.sellerId === order.sellerId && time(correction.detectedAt) && time(correction.originalDeliveryAt);
  const currentDE = currentProof?.statusCode === 'DE' && order.trackingObservation?.readId === currentProof.readId &&
    order.trackingObservation?.readVersion === currentProof.readVersion && currentProof.providerEventAtMs !== null &&
    Number.isSafeInteger(currentProof.providerEventAtMs) && Number.isSafeInteger(currentProof.providerLabelCreatedAtMs) &&
    currentProof.providerEventAtMs >= currentProof.providerLabelCreatedAtMs && currentProof.providerEventAtMs <= currentProof.observedAtMs &&
    ['actual_delivery_date', 'normalized_event'].includes(currentProof.providerEventTimeSource ?? '') &&
    currentProof.providerRevision === null && hash(currentProof.observedContentHash);
  const sameHistory = correctionQualified && time(order.deliveredAt) && correction.originalDeliveryAt.isEqual(order.deliveredAt) &&
    (correction.originalFundsReleaseAt == null ? order.fundsReleaseAt == null : deadline(correction.originalFundsReleaseAt) && deadline(order.fundsReleaseAt) && correction.originalFundsReleaseAt.isEqual(order.fundsReleaseAt)) &&
    (correction.originalFundsReleasedAt == null ? order.fundsReleasedAt == null : time(correction.originalFundsReleasedAt) && time(order.fundsReleasedAt) && correction.originalFundsReleasedAt.isEqual(order.fundsReleasedAt));
  const effectiveDeliveryWindow = held && currentDE ? buildDeliveryCorrectionWindow(order, transactionId, currentProof) : null;
  const correctionResolvable = claims.size < 101 && !!sameHistory && !!currentDE && currentProof!.requestedAtMs >= correction.detectedAt.toMillis() &&
    currentProof!.observedAtMs >= currentProof!.requestedAtMs && (released || held && (!!effectiveDeliveryWindow ||
      currentProof!.providerEventAtMs! <= correction.originalDeliveryAt.toMillis()));
  const correctionPresent = Object.prototype.hasOwnProperty.call(order, 'deliveryCorrection');
  const resolutionQualified = correctionPresent && !deliveryCorrectionBlocksProgress(order) && correctionResolvable;
  const correctionResolution = { state: !correctionPresent ? 'absent' : resolutionQualified ? 'resolved_current' : 'review_required',
    correctionId: hash(correction?.correctionId) ? correction.correctionId : null, resolutionQualified,
    ownCorrectionBlocksProgress: correctionPresent && !resolutionQualified,
    action: resolutionQualified ? correction.resolution.action as 'continue_held_release' | 'retain_released_history' : null,
    decidedAt: resolutionQualified ? iso(correction.resolution.decidedAt) : null, source: reference,
    effectiveFundsReleaseAt: resolutionQualified && !released ? deadlineIso(effectivePurchaseReleaseAt(order, transactionId)) : null,
    effectiveProtectionEndsAt: resolutionQualified && !released ? deadlineIso(correction.resolution.effectiveDeliveryWindow?.effectiveProtectionEndsAt) : null,
    protectionQualification: resolutionQualified ? released ? 'released_history' : correction.resolution.effectiveDeliveryWindow
      ? 'native_policy_window' : 'historical_deadline' : 'unknown',
    otherGuardsRetained: true, financialEffectAuthorized: false, inventoryReleaseAuthorized: false };
  return { snap, order, record, reviewSnap, reference, currentProof, correctionResolvable, effectiveDeliveryWindow, released, claims, depositDeadline,
    public: { ...(deadlineContext ? {labelDepositDeadline: depositDeadline,
        deadlineContextQualification: record?.body.kind === 'label_deposit_deadline' ?
          record.body.origin.deadline.deadlineSourceHash === depositDeadline?.deadlineSourceHash &&
          record.body.origin.deadline.labelSourceHash === depositDeadline?.labelSourceHash ? 'same_deadline_and_label' : 'changed_or_unknown' : 'not_selected'} : {}), protocol: 'transport_review_source_v1', transactionId, reference, capture: captureView,
      captureQualification: nativeCapture ? 'native_capture' : pointer === undefined ? 'absent' : 'historical_unknown',
      currentCapture: !!nativeCapture && !!currentProof && info.readId === currentProof.readId && info.readVersion === currentProof.readVersion &&
        pointer.protocol === 'tracking_history_v1' && time(pointer.recordedAt) && pointer.recordedAt.isEqual(capture.recordedAt) &&
        pointer.displayHash === capture.displayHash && pointer.sourceHash === info.sourceHash && pointer.readVersion === info.readVersion,
      observedStatusCode: currentProof?.statusCode ?? null, observedAt: currentProof ? new Date(currentProof.observedAtMs).toISOString() : null,
      occurredAt: currentProof?.providerEventAtMs == null ? null : new Date(currentProof.providerEventAtMs).toISOString(),
      shippedAt: iso(order.shippedAt), estimatedDelivery: typeof order.estimatedDelivery === 'string' ? order.estimatedDelivery.slice(0, 100) : null,
      transportContext: order.deliveryType === 'shipping' || typeof order.shipEngineLabelId === 'string' || typeof order.trackingNumber === 'string',
      etaInformationalOnly: true, elapsedTimeProvesLoss: false, releaseQualification: released ? 'native_release_recorded' : held ? 'native_held_deadline_recorded' : 'historical_unknown',
      correction: correctionQualified ? { correctionId: correction.correctionId, detectedAt: iso(correction.detectedAt),
        originalDeliveryAt: iso(correction.originalDeliveryAt), originalFundsReleaseAt: deadlineIso(correction.originalFundsReleaseAt),
        originalFundsReleasedAt: iso(correction.originalFundsReleasedAt), currentFundsReleaseAt: deadlineIso(order.fundsReleaseAt), currentFundsReleasedAt: iso(order.fundsReleasedAt) } : null,
      correctionResolution,
      otherGuards: [order.bankDispute != null || order.disputeId != null ? 'bank_case' : null,
        Object.prototype.hasOwnProperty.call(order, 'fraudReview') ? 'risk_review' : null,
        Object.prototype.hasOwnProperty.call(order, 'returnToSenderGuard') ? 'return_to_sender' : null,
        order.returnRequest != null ? 'return_request' : null, order.refund != null ? 'refund' : null,
        order.trackingReviewRequired === true ? 'tracking_review' : null, claims.size >= 101 ? 'case_set_unknown' : null,
        claims.docs.some(doc => doc.data().status === 'open') ? 'open_disputes' : null].filter((value): value is string => value !== null),
      correctionResolvable, financialEffectAuthorized: false, inventoryReleaseAuthorized: false, parcelPossessionVerified: false } };
}
function owner(request: any) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (request.data?.expectedUid !== request.auth.uid) throw new HttpsError('permission-denied', 'La session a changé.');
  return request.auth.uid as string;
}
async function authorize(tx: FirebaseFirestore.Transaction, uid: string, order: Data, admin: boolean) {
  if (admin) await supportAdmin(tx, uid, false);
  else if (order.buyerId !== uid && order.sellerId !== uid) throw new HttpsError('permission-denied', 'Commande privée non autorisée.');
}
export async function readTransportReviewSource(request: any) {
  const uid = owner(request), raw = object(request.data, ['mode', 'expectedUid', 'transactionId', 'reviewId', 'scope', 'capability']);
  const deadlineContext = labelDepositReviewOptIn(raw.capability); if (deadlineContext) assertLabelDepositReviewOpen();
  if (!id(raw.transactionId) || raw.reviewId != null && !reviewId(raw.reviewId) || !['owner', 'admin'].includes(raw.scope ?? 'owner'))
    throw new HttpsError('invalid-argument', 'Commande et dossier exacts requis.');
  const admin = raw.scope === 'admin';
  if (admin) await supportCurrentAdminSession(request);
  return db.runTransaction(async tx => {
    const current = await frame(tx, raw.transactionId, raw.reviewId ?? null, deadlineContext);
    await authorize(tx, uid, current.order, admin);
    return { ...current.public, ownerId: uid, review: current.record ? view(current.record) : null };
  });
}
/** Opt-in current owner source, never a new effect. Dates are separate from
 * the native admission facts; every mutator rechecks those facts under TX. */
export async function readEffectivePurchasePolicy(request: any) {
  const uid = owner(request), raw = object(request.data, ['mode', 'expectedUid', 'transactionId', 'capability']);
  if (!id(raw.transactionId) || raw.capability !== 'effective_delivery_window_v1') throw new HttpsError('invalid-argument', 'Source de protection explicite requise.');
  return db.runTransaction(async tx => {
    const current = await frame(tx, raw.transactionId, null), order = current.order;
    await authorize(tx, uid, order, false);
    const clock = effectiveDeliveryProtectionWindow(order, raw.transactionId), now = Timestamp.now();
    const wallet = await tx.get(db.collection('wallets').doc(order.sellerId));
    const movements = await tx.get(wallet.ref.collection('ledger').where('transactionId', '==', raw.transactionId).limit(101));
    const rows = movements.docs.map(doc => doc.data());
    const held = rows.filter(row => row.type === 'funds_held'), credited = rows.filter(row => row.type === 'sale_credit' ||
      row.type === 'debt_repayment' && row.description === 'Vente — régularisation du solde dû');
    const financialKnown = movements.size < 101 && rows.every(row => row.transactionId === raw.transactionId && time(row.createdAt) &&
      Number.isSafeInteger(row.amount) && row.amount >= 0 && (row.currency == null || row.currency === 'CAD')) &&
      credited.reduce((sum, row) => sum + row.amount, 0) === order.sellerCreditedCents && Number.isSafeInteger(order.sellerCreditedCents) && order.sellerCreditedCents >= 0 &&
      held.length === 1 && held[0].amount === order.sellerHeldCreditCents && Number.isSafeInteger(order.sellerHeldCreditCents) && order.sellerHeldCreditCents >= 0 &&
      ['CAD', 'cad'].includes(wallet.data()?.currency) && Number.isSafeInteger(wallet.data()?.heldBalance) && wallet.data()!.heldBalance >= held[0].amount &&
      !rows.some(row => ['refund_credit', 'refund_debit', 'refund_hold', 'funds_released', 'dispute_hold'].includes(row.type));
    const claimsKnown = current.claims.size < 101 && current.claims.docs.every(doc => doc.data().transactionId === raw.transactionId &&
      doc.data().buyerId === order.buyerId && doc.data().sellerId === order.sellerId && time(doc.data().createdAt) &&
      ['open', 'resolved', 'dismissed', 'closed'].includes(doc.data().status));
    const riskAllows = await fraudReviewAllowsProgress(tx, raw.transactionId, order, current.snap);
    const moderationAllows = await orderModerationAllowsProgress(tx, order);
    const futureWindow = !!clock && now.toMillis() < Date.parse(clock.window.effectiveProtectionEndsAt) &&
      now.toMillis() < Date.parse(clock.window.effectiveFundsReleaseAt);
    const blockers = [uid !== order.buyerId ? 'seller_context' : null, !clock || !claimsKnown ? 'source_unknown' : null,
      deliveryCorrectionBlocksProgress(order) || order.deliveryCorrectionBlocked === true ? 'correction_review' : null,
      order.trackingReviewRequired === true ? 'tracking_review' : null, order.purchasePolicyReviewRequired === true ? 'purchase_policy_review' : null,
      hasActiveBankDispute(order) || order.bankDispute?.outcome === 'lost' || order.refundedVia === 'chargeback' ? 'bank_case' : null,
      hasUnsettledRefund(order) || order.refund != null || order.refundedAt != null ? 'refund' : null,
      hasUnsettledReturnRequest(order) ? 'return_request' : null, returnToSenderBlocksProgress(order) ? 'return_to_sender' : null,
      !riskAllows ? 'risk_review' : null, hasCommercialDispute(order) || current.claims.docs.some(doc => !['resolved', 'dismissed', 'closed'].includes(doc.data().status)) ? 'commercial_dispute' : null,
      !moderationAllows ? 'moderation_review' : null, !futureWindow ? 'window_elapsed' : null,
      order.fundsReleasedAt != null ? 'funds_already_released' : null, !financialKnown ? 'financial_source_unknown' : null,
      order.labelReconciliationRequired === true ? 'label_reconciliation' : null, order.status !== 'delivered' || order.deliveryType !== 'shipping' ? 'commercial_context' : null,
    ].filter((value): value is string => value !== null);
    // A participant report is documentary and creates no monetary movement;
    // independent bank/refund/risk/moderation fences still govern any effect.
    const commercialStatus = hasActiveBankDispute(order) ? order.bankDispute?.statusBeforeOpen ?? order.statusBeforeDispute ?? order.refund?.originalStatus ?? order.status
      : hasUnsettledRefund(order) ? order.refund?.originalStatus ?? order.status : order.status;
    const canReportProblemNow = uid === order.buyerId && !!clock && claimsKnown && futureWindow && order.fundsReleasedAt == null &&
      commercialStatus === 'delivered' && !hasCommercialDispute(order) && !current.claims.docs.some(doc => doc.data().status === 'open');
    return { protocol: 'effective_delivery_window_v1', ownerId: uid, transactionId: raw.transactionId,
      sourceRevision: revision(current.snap), sourceHash: supportSourceHash([current.reference, clock, wallet.data() ?? null,
        movements.docs.map(doc => [doc.id, doc.data()]), riskAllows, moderationAllows, blockers]),
      policy: clock?.policy ?? null, qualification: clock?.qualification ?? 'unknown', window: clock?.window ?? null,
      guardQualification: clock && claimsKnown && financialKnown ? 'native_current' : 'unknown', blockers,
      canReportProblemNow, canPrepareReturnNow: blockers.length === 0,
      financialEffectAuthorized: false, inventoryReleaseAuthorized: false, parcelPossessionVerified: false };
  });
}
const previewIntent = (value: Intent) => { const result = { ...value } as any; delete result.previewId; return result; };
export async function previewTransportReview(request: any) {
  const uid = owner(request), raw = object(request.data, ['mode', 'expectedUid', 'intent', 'capability']), command = intent(raw.intent);
  const deadlineContext = labelDepositReviewOptIn(raw.capability); if (deadlineContext) assertLabelDepositReviewOpen();
  if (command.action === 'report_transit') throw new HttpsError('invalid-argument', 'Déclaration participante sans aperçu opérateur.');
  await supportCurrentAdminSession(request);
  if (deadlineContext) assertRecentAccountAuthentication(request.auth.token);
  return db.runTransaction(async tx => {
    if (deadlineContext) {await supportCurrentAdminSession(request); assertRecentAccountAuthentication(request.auth.token);}
    const current = await frame(tx, command.transactionId, command.reviewId, deadlineContext);
    await authorize(tx, uid, current.order, true);
    if (supportHash(command.source) !== supportHash(current.reference)) throw new HttpsError('failed-precondition', 'La source a changé.');
    const previewId = 'preview_' + supportHash([uid, previewIntent(command)]), ref = rows(command.transactionId).doc(previewId), prior = (await tx.get(ref)).data();
    if (prior && (prior.protocol !== 'transport_review_preview_v1' || prior.ownerId !== uid || prior.intentHash !== supportHash(previewIntent(command))))
      throw new HttpsError('unavailable', 'Aperçu historique à rapprocher.');
    if (!prior) tx.create(ref, { protocol: 'transport_review_preview_v1', ownerId: uid, intentHash: supportHash(previewIntent(command)),
      reference: current.reference, createdAt: Timestamp.now() });
    return { protocol: 'transport_review_preview_v1', ownerId: uid, previewId, intentHash: supportHash(previewIntent(command)),
      source: current.public, review: view(current.record), financialEffectAuthorized: false, inventoryReleaseAuthorized: false };
  });
}
/** Caller holds the native tracking/order TX; deterministic business identity
 * excludes GET/read timestamps. Reads precede the caller's atomic commits. */
export async function prepareSystemTransportReview(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data,
  kind: Extract<Kind, 'carrier_exception' | 'delivery_correction'>, proof: Proof, correction: any = order.deliveryCorrection) {
  if (!id(order.buyerId) || !id(order.sellerId) || order.buyerId === order.sellerId ||
      !trackingProofMatches(transactionId, order, proof, 'forward') || kind === 'carrier_exception' && proof.statusCode !== 'EX')
    throw new HttpsError('failed-precondition', 'Source système de transport non qualifiée.');
  if (kind === 'delivery_correction' && (!hash(correction?.correctionId) || correction.transactionId !== transactionId))
    throw new HttpsError('failed-precondition', 'Correction native exacte requise.');
  let caseId = 'case_' + supportHash([kind, transactionId, kind === 'delivery_correction' ? correction.correctionId :
    [proof.sourceHash, proof.observedContentHash, proof.providerEventAtMs]]), ref = rows(transactionId).doc(caseId), prior = (await tx.get(ref)).data();
  let previousReviewId: string | null = null;
  // A fresh native incident after an explicit resolution starts a linked
  // business generation; GET/read time never supplies its deduplication key.
  for (let generation = 0; prior?.body?.state === 'resolved' && generation < 20; generation++) {
    if (!qualifiedReview(prior, transactionId, order)) throw new HttpsError('failed-precondition', 'Dossier antérieur à rapprocher.');
    previousReviewId = caseId;
    caseId = 'case_' + supportHash([kind, transactionId, previousReviewId, prior.contentHash]);
    ref = rows(transactionId).doc(caseId); prior = (await tx.get(ref)).data();
  }
  if (prior?.body?.state === 'resolved') throw new HttpsError('failed-precondition', 'Historique d’incident à rapprocher manuellement.');
  const disputeId = kind === 'carrier_exception' ? 'transport_' + supportHash([transactionId, caseId]) : null;
  const disputeRef = disputeId ? db.collection('disputes').doc(disputeId) : null, dispute = disputeRef ? await tx.get(disputeRef) : null;
  if (prior && !qualifiedReview(prior, transactionId, order) || dispute?.exists &&
      (dispute.data()?.source !== 'system_transport_review' || dispute.data()?.transportReviewId !== caseId || dispute.data()?.transactionId !== transactionId))
    throw new HttpsError('failed-precondition', 'Dossier système historique à rapprocher.');
  const now = Timestamp.now(), origin = { kind: 'system', provider: 'shipengine', statusCode: proof.statusCode,
    trackingSourceHash: proof.sourceHash, observationHash: proof.observedContentHash, occurredAt: proof.providerEventAtMs == null ? null : new Date(proof.providerEventAtMs).toISOString(),
    correctionId: kind === 'delivery_correction' ? correction.correctionId : null, disputeId, previousReviewId, reportedBy: null };
  const current = await frame(tx, transactionId);
  const marker = order.transportExceptionReview;
  const markerPresent = Object.prototype.hasOwnProperty.call(order, 'transportExceptionReview');
  const markerQualified = marker?.protocol === 'transport_exception_guard_v1' && marker.transactionId === transactionId &&
    marker.buyerId === order.buyerId && marker.sellerId === order.sellerId && time(marker.createdAt) &&
    Array.isArray(marker.reviewIds) && marker.reviewIds.length <= 100 && marker.reviewIds.every(reviewId) &&
    new Set(marker.reviewIds).size === marker.reviewIds.length;
  const flagOrigin = (key: string) => !Object.prototype.hasOwnProperty.call(order, key) || order[key] === false ? 'native_owned' : 'historical_unknown';
  const trackingOwnership = flagOrigin('trackingReviewRequired') === 'native_owned' ? 'native_owned' :
    markerQualified && marker.trackingFlagOwnership === 'native_owned' && order.trackingReviewReason === 'carrier_exception_requires_human_review'
      ? 'native_owned' : 'historical_unknown';
  const correctionOwnsDisputed = order.deliveryCorrection?.flagProvenance?.schemaVersion === 1 &&
    order.deliveryCorrection.flagProvenance.disputedOwnership === 'native_owned' && order.deliveryCorrection.transactionId === transactionId &&
    order.deliveryCorrection.buyerId === order.buyerId && order.deliveryCorrection.sellerId === order.sellerId;
  const disputedOwnership = flagOrigin('disputed') === 'native_owned' ? 'native_owned' :
    correctionOwnsDisputed || markerQualified && marker.disputedFlagOwnership === 'native_owned'
      ? 'native_owned' : 'shared_or_unknown';
  const priorIds: string[] = markerQualified ? marker.reviewIds : [];
  const exceptionMarker = { protocol: 'transport_exception_guard_v1', transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
    reviewIds: priorIds.includes(caseId) ? priorIds : [...priorIds, caseId].slice(0, 100),
    sourceComplete: markerQualified && marker.sourceComplete === true && (priorIds.includes(caseId) || priorIds.length < 100) || !markerPresent,
    trackingFlagOwnership: trackingOwnership, disputedFlagOwnership: disputedOwnership,
    createdAt: markerQualified ? marker.createdAt : now };
  const orderPatch = kind === 'carrier_exception' && (!markerPresent || markerQualified) ? { transportExceptionReview: exceptionMarker } : {};
  const body = { kind, version: 1, state: 'open', inquiryState: 'open', origin, initialSource: { reference: current.reference,
    capture: current.public.capture, captureQualification: current.public.captureQualification }, entries: [], closure: null, resolution: null };
  const notices = !prior ? await noticesFor(tx, transactionId, order, caseId, 1, 'Un incident de transport doit être examiné. Ce dossier ne confirme ni une perte, ni une réception physique, ni un remboursement.') : null;
  return { reviewId: caseId, disputeId, created: !prior || !!disputeRef && !dispute?.exists, orderPatch, commit: () => {
    if (!prior) tx.create(ref, { protocol: PROTOCOL, reviewId: caseId, transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
      body, contentHash: supportSourceHash(body), createdAt: now, updatedAt: now,
      ...(kind === 'carrier_exception' ? { flagProvenance: { trackingFlagOwnership: trackingOwnership,
        disputedFlagOwnership: disputedOwnership, sourceHash: current.reference.sourceHash, priorReason: typeof order.trackingReviewReason === 'string' ? order.trackingReviewReason : null } } : {}) });
    if (disputeRef && !dispute?.exists) tx.create(disputeRef, { transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
      articleId: order.articleId ?? null, source: 'system_transport_review', type: 'carrier_exception', reportedBy: null,
      transportReviewId: caseId, status: 'open', description: 'Exception transporteur à examiner ; aucune perte ou faute établie.', createdAt: now });
    notices?.commit();
  } };
}
/** Bounded poller observation; deterministic deadline/label identity excludes
 * observation time. Existing case/notice receipts stay first and are immutable. */
export async function observeLabelDepositDeadline(transactionId: string, now = Timestamp.now()) {
  if (!LABEL_DEPOSIT_REVIEW_ENABLED) return false;
  return db.runTransaction(async tx => {
    const ref = db.collection('transactions').doc(transactionId), snap = await tx.get(ref), order = snap.data();
    if (!order || order.status !== 'label_created' || order.deliveryType !== 'shipping' || !id(order.buyerId) ||
        !id(order.sellerId) || order.buyerId === order.sellerId) return false;
    const source = await readLabelDepositDeadline(tx, transactionId, order, now), selected = labelDepositReviewIdentity(source);
    if (!selected || !source.deadlineReached || source.carrierScanQualification === 'carrier_scan_recorded') return false;
    const caseRef = rows(transactionId).doc(selected), prior = (await tx.get(caseRef)).data();
    if (prior) {
      if (!qualifiedReview(prior, transactionId, order)) throw new HttpsError('failed-precondition', 'Revue historique du délai à rapprocher.');
      return false;
    }
    const current = await frame(tx, transactionId, null, true);
    if (current.depositDeadline?.sourceHash !== source.sourceHash) return false;
    const body = {kind: 'label_deposit_deadline', version: 1, state: 'open', inquiryState: 'open',
      origin: {kind: 'system', source: 'accepted_contract_deadline', reportedBy: null, deadline: source},
      initialSource: {reference: current.reference, capture: current.public.capture, captureQualification: current.public.captureQualification},
      entries: [], closure: null, resolution: null};
    const alertRef = db.collection('admin_alerts').doc('label_deposit_deadline_' + supportHash([transactionId, selected]));
    const alert = await tx.get(alertRef);
    const notices = await noticesFor(tx, transactionId, order, selected, 1,
      'Le délai accepté d’expédition est atteint après création de l’étiquette. Notre équipe doit examiner le dépôt et les sources disponibles. L’absence de scan ne prouve ni une absence de dépôt, ni une perte, ni un remboursement.', true);
    tx.create(caseRef, {protocol: PROTOCOL, reviewId: selected, transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
      body, contentHash: supportSourceHash(body), createdAt: now, updatedAt: now});
    tx.update(ref, {labelDepositDeadlineReview: {protocol: 'label_deposit_deadline_review_v1', reviewId: selected,
      deadlineSourceHash: source.deadlineSourceHash, labelSourceHash: source.labelSourceHash, recordedAt: now}});
    if (!alert.exists) tx.create(alertRef, {kind: 'label_deposit_deadline', refId: transactionId, transportReviewId: selected,
      status: 'open', severity: 'warning', createdAt: now,
      message: 'Échéance contractuelle après création d’étiquette à examiner. Aucun dépôt, perte, annulation, void ou remboursement déduit.',
      context: {deadlineSourceHash: source.deadlineSourceHash, labelSourceHash: source.labelSourceHash}});
    notices.commit(); return true;
  });
}
async function noticesFor(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data, selected: string, version: number, message: string, deadlineContext = false) {
  return prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({
    eventKey: `transport_review:${transactionId}:${selected}:${version}`, userId, type: 'order_moderation', title: 'Suivi du dossier de transport', message,
    data: { ownerId: userId, transactionId, transportReviewId: selected, financialEffectAuthorized: 'false', inventoryReleaseAuthorized: 'false',
      ...(deadlineContext ? {transportReviewCapability: 'label_deposit_deadline_v1'} : {}) },
  })));
}
export async function commandTransportReview(request: any) {
  const uid = owner(request), raw = object(request.data, ['mode', 'expectedUid', 'requestId', 'operation', 'command', 'capability']), command = intent(raw.command);
  const deadlineContext = labelDepositReviewOptIn(raw.capability);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(raw.requestId ?? '') || !['execute', 'observe', 'neutralize'].includes(raw.operation))
    throw new HttpsError('invalid-argument', 'Intention et opération exactes requises.');
  const admin = command.action !== 'report_transit';
  const payloadHash = supportHash(command), receiptRef = rows(command.transactionId).doc('command_' + supportHash([uid, raw.requestId]));
  const receipt = (value: any) => ({ protocol: 'transport_review_command_v1', ownerId: uid, requestId: raw.requestId,
    transactionId: command.transactionId, payloadHash, state: value.state, reviewId: value.reviewId ?? null,
    reviewVersion: Number.isSafeInteger(value.reviewVersion) ? value.reviewVersion : null,
    reason: value.reason ?? null, recordedAt: iso(value.recordedAt), financialEffectAuthorized: false, inventoryReleaseAuthorized: false });
  const priorReceipt = (prior: any) => {
    if (!prior) return null;
    if (prior.protocol !== 'transport_review_command_v1' || prior.ownerId !== uid || prior.requestId !== raw.requestId ||
        prior.transactionId !== command.transactionId || prior.payloadHash !== payloadHash ||
        !['committed', 'not_executed'].includes(prior.state) || !time(prior.recordedAt))
      throw new HttpsError('already-exists', 'La référence désigne une autre intention.');
    return receipt(prior);
  };
  // The SDK UID and exact native receipt alone authorize this private result.
  // No order/case/profile read nor fresh business permission is borrowed here.
  const replay = await db.runTransaction(async tx => {
    const prior = priorReceipt((await tx.get(receiptRef)).data());
    if (prior) return prior;
    if (raw.operation === 'observe') return receipt({ state: 'unrecorded' });
    if (raw.operation === 'neutralize') {
      const value = { protocol: 'transport_review_command_v1', ownerId: uid, requestId: raw.requestId, transactionId: command.transactionId,
        payloadHash, command, state: 'not_executed', reason: 'command_neutralized', reviewId: null, reviewVersion: null, recordedAt: Timestamp.now() };
      tx.create(receiptRef, value); return receipt(value);
    }
    return null;
  });
  if (replay) return replay;
  if (deadlineContext) {assertLabelDepositReviewOpen(); assertRecentAccountAuthentication(request.auth.token);}
  if (admin) await supportCurrentAdminSession(request);
  return db.runTransaction(async tx => {
    const prior = priorReceipt((await tx.get(receiptRef)).data());
    if (prior) return prior;
    if (deadlineContext) {await supportCurrentAdminSession(request); assertRecentAccountAuthentication(request.auth.token);}
    if (admin) await supportAdmin(tx, uid, false);
    const record = (state: 'committed' | 'not_executed', reason: string | null, selected: string | null = null, reviewVersion: number | null = null) => {
      const value = { protocol: 'transport_review_command_v1', ownerId: uid, requestId: raw.requestId, transactionId: command.transactionId,
        payloadHash, command, state, reason, reviewId: selected, reviewVersion, recordedAt: Timestamp.now() };
      tx.create(receiptRef, value); return receipt(value);
    };
    let current: Awaited<ReturnType<typeof frame>>;
    try { current = await frame(tx, command.transactionId, command.action === 'report_transit' ? null : command.reviewId, deadlineContext); }
    catch (error) {
      if (error instanceof HttpsError && error.code === 'failed-precondition') return record('not_executed', 'source_changed');
      throw error;
    }
    await authorize(tx, uid, current.order, admin);
    if (supportHash(command.source) !== supportHash(current.reference)) return record('not_executed', 'source_changed');
    const now = Timestamp.now();
    if (command.action === 'report_transit') {
      if (!current.public.transportContext) return record('not_executed', 'transport_context_unqualified');
      const selected = 'case_' + supportHash(['participant_transit', uid, command.transactionId, command.narrative, command.source]), ref = rows(command.transactionId).doc(selected);
      const priorReview = (await tx.get(ref)).data();
      if (priorReview) {
        if (!qualifiedReview(priorReview, command.transactionId, current.order)) return record('not_executed', 'historical_source_unqualified');
        return record('committed', null, selected, priorReview.body.version);
      }
      const body = { kind: 'participant_transit', version: 1, state: 'open', inquiryState: 'open', origin: { kind: 'participant', reportedBy: uid,
        narrative: command.narrative, reportVerified: false }, initialSource: { reference: command.source, capture: current.public.capture,
        captureQualification: current.public.captureQualification }, entries: [], closure: null, resolution: null };
      const notices = await noticesFor(tx, command.transactionId, current.order, selected, 1,
        'Un participant demande l’examen du transit. Ce récit ne conteste pas à lui seul la réception et ne confirme ni une perte ni un remboursement.');
      tx.create(ref, { protocol: PROTOCOL, reviewId: selected, transactionId: command.transactionId, buyerId: current.order.buyerId,
        sellerId: current.order.sellerId, body, contentHash: supportSourceHash(body), createdAt: now, updatedAt: now });
      notices.commit(); return record('committed', null, selected, 1);
    }
    const preview = command.previewId ? (await tx.get(rows(command.transactionId).doc(command.previewId))).data() : null;
    if (!preview || preview.protocol !== 'transport_review_preview_v1' || preview.ownerId !== uid || !time(preview.createdAt) ||
        preview.intentHash !== supportHash(previewIntent(command)) || supportHash(preview.reference) !== supportHash(command.source))
      return record('not_executed', 'preview_unqualified');
    const old = current.record!, body = { ...old.body, version: old.body.version + 1 };
    if (old.body.kind === 'label_deposit_deadline' && !['record_inquiry', 'close_inquiry'].includes(command.action))
      return record('not_executed', 'deadline_inquiry_only');
    if (old.body.kind === 'label_deposit_deadline' && command.action === 'close_inquiry' &&
        (!current.depositDeadline || !labelDepositDeadlineCloseQualified(current.depositDeadline) ||
          old.body.origin.deadline.deadlineSourceHash !== current.depositDeadline.deadlineSourceHash ||
          old.body.origin.deadline.labelSourceHash !== current.depositDeadline.labelSourceHash))
      return record('not_executed', 'deadline_source_changed_or_unknown');
    let orderUpdate: Data | null = null, disputeUpdate: { ref: FirebaseFirestore.DocumentReference; data: Data } | null = null;
    if (command.action === 'record_inquiry') {
      if (old.body.entries.length >= 100) return record('not_executed', 'inquiry_capacity_requires_review');
      body.entries = [...old.body.entries, { ...command.entry, recordedBy: uid, recordedAt: now, sourceExamined: command.source }];
      body.inquiryState = 'open';
      if (body.kind === 'label_deposit_deadline') body.state = 'open';
    } else if (command.action === 'close_inquiry') {
      body.inquiryState = 'closed';
      if (['participant_transit', 'label_deposit_deadline'].includes(body.kind)) body.state = 'closed';
      body.closure = { outcome: command.outcome, reason: command.reason, ownerMessage: command.ownerMessage, recordedBy: uid,
        recordedAt: now, sourceExamined: command.source, financialEffectAuthorized: false };
    } else if (command.action === 'resolve_delivery_correction') {
      if (body.state === 'resolved') return record('not_executed', 'review_already_resolved');
      if (body.kind !== 'delivery_correction' || body.origin.correctionId !== current.order.deliveryCorrection?.correctionId || !current.correctionResolvable)
        return record('not_executed', 'delivery_correction_source_unqualified');
      const correction = current.order.deliveryCorrection;
      orderUpdate = { deliveryCorrectionBlocked: false, deliveryCorrectionOwnerMessage: command.ownerMessage,
        deliveryCorrection: { ...correction, state: 'resolved', resolution: { schemaVersion: 1, source: 'operator_delivery_review',
        correctionId: correction.correctionId, transactionId: command.transactionId, buyerId: current.order.buyerId, sellerId: current.order.sellerId,
        operatorUid: uid, decidedAt: now, reason: command.reason, action: current.released ? 'retain_released_history' : 'continue_held_release',
        nativeReviewResolution: { protocol: 'transport_review_resolution_v1', reviewId: command.reviewId, reviewVersion: body.version, source: command.source },
        providerProof: current.currentProof, ...(current.released ? {} : { fundsReleaseAt: current.order.fundsReleaseAt,
          ...(current.effectiveDeliveryWindow ? { effectiveDeliveryWindow: current.effectiveDeliveryWindow } : {}) }) } } };
      body.state = 'resolved'; body.resolution = { finding: current.released ? 'retain_released_history' : 'continue_held_release', reason: command.reason,
        ownerMessage: command.ownerMessage, recordedBy: uid, recordedAt: now, sourceExamined: command.source, financialEffectAuthorized: false };
    } else {
      if (body.state === 'resolved') return record('not_executed', 'review_already_resolved');
      if (body.kind !== 'carrier_exception' || body.entries.length < 1) return record('not_executed', 'carrier_exception_source_unqualified');
      const disputeRef = db.collection('disputes').doc(body.origin.disputeId), dispute = (await tx.get(disputeRef)).data();
      if (!dispute || dispute.source !== 'system_transport_review' || dispute.status !== 'open' || dispute.transactionId !== command.transactionId ||
          dispute.transportReviewId !== command.reviewId || dispute.buyerId !== current.order.buyerId || dispute.sellerId !== current.order.sellerId)
        return record('not_executed', 'carrier_exception_source_unqualified');
      if (command.finding === 'incident_resolved' && (!current.currentProof || current.currentProof.statusCode === 'EX'))
        return record('not_executed', 'carrier_exception_source_unqualified');
      body.state = command.finding === 'incident_resolved' ? 'resolved' : 'financial_review_required';
      body.resolution = { finding: command.finding, reason: command.reason, ownerMessage: command.ownerMessage, recordedBy: uid,
        recordedAt: now, sourceExamined: command.source, financialEffectAuthorized: false, otherGuardsRetained: true };
      // Only native attributable flags may be cleared below. Historical or
      // shared flags remain independent of this documentary disposition.
      if (command.finding === 'incident_resolved') disputeUpdate = { ref: disputeRef, data: { status: 'resolved',
        resolution: 'transport_incident_reviewed', resolvedBy: uid, resolvedAt: now, transportReviewVersion: body.version } };
    }
    if (command.action === 'resolve_delivery_correction' || command.action === 'resolve_carrier_exception' && command.finding === 'incident_resolved') {
      const ownPatch = await resolvedOwnFlagPatch(tx, command.transactionId, current.order, command.reviewId,
        { ...current.order, ...(orderUpdate ?? {}) }, command.action === 'resolve_carrier_exception' ? body.origin.disputeId : null);
      orderUpdate = { ...(orderUpdate ?? {}), ...ownPatch };
    }
    const notices = await noticesFor(tx, command.transactionId, current.order, command.reviewId, body.version,
      command.action === 'record_inquiry' ? 'Une démarche de l’enquête de transport a été enregistrée. Les autres recours et gardes restent indépendants.' : command.ownerMessage,
      old.body.kind === 'label_deposit_deadline');
    tx.update(current.reviewSnap!.ref, { body, contentHash: supportSourceHash(body), updatedAt: now });
    if (orderUpdate) tx.update(current.snap.ref, orderUpdate);
    if (disputeUpdate) tx.update(disputeUpdate.ref, disputeUpdate.data);
    notices.commit(); return record('committed', null, command.reviewId, body.version);
  });
}
export async function readTransportReviews(request: any) {
  const uid = owner(request), raw = object(request.data, ['mode', 'expectedUid', 'transactionId', 'scope', 'cursor', 'capability']);
  const deadlineContext = labelDepositReviewOptIn(raw.capability); if (deadlineContext) assertLabelDepositReviewOpen();
  if (!id(raw.transactionId) || raw.cursor != null && !cursorId(raw.cursor) || !['owner', 'admin'].includes(raw.scope ?? 'owner'))
    throw new HttpsError('invalid-argument', 'Commande et curseur exacts requis.');
  const admin = raw.scope === 'admin'; if (admin) await supportCurrentAdminSession(request);
  return db.runTransaction(async tx => {
    const current = await frame(tx, raw.transactionId, null, deadlineContext); await authorize(tx, uid, current.order, admin);
    // The next ASCII prefix includes every valid Unicode suffix of case_,
    // including unknown legacy document names beyond the BMP sentinel.
    let query = rows(raw.transactionId).orderBy(FieldPath.documentId()).startAt('case_').endBefore('case`').limit(21);
    if (raw.cursor) query = rows(raw.transactionId).orderBy(FieldPath.documentId()).startAfter(raw.cursor).endBefore('case`').limit(21);
    const page = await tx.get(query), inspected = page.docs.slice(0, 20);
    const items = inspected.filter(doc => deadlineContext || doc.data().body?.kind !== 'label_deposit_deadline').map(doc => doc.data().reviewId === doc.id && qualifiedReview(doc.data(), raw.transactionId, current.order)
      ? { ...view(doc.data()), reviewRevision: revision(doc), reviewHash: doc.data().contentHash, qualification: 'native_review' }
      : { protocol: PROTOCOL, reviewId: doc.id, transactionId: raw.transactionId, qualification: 'historical_unknown',
        financialEffectAuthorized: false, inventoryReleaseAuthorized: false });
    return { protocol: 'transport_reviews_v1', ownerId: uid, transactionId: raw.transactionId, source: current.public,
      items, cursor: page.size > 20 ? inspected[inspected.length - 1].id : null,
      financialEffectAuthorized: false, inventoryReleaseAuthorized: false };
  });
}

/** Reuses the parcel observer's bounded order cycle. This nested finite cursor
 * advances over unknown/closed rows too; only a human-entered follow-up date
 * can create a reminder. No carrier/business deadline is computed here. */
export async function pollTransportReviewFollowUps(transactionId: string, now = Timestamp.now()) {
  await observeTransportContactFollowUps(transactionId, now);
  return db.runTransaction(async tx => {
    const orderRef = db.collection('transactions').doc(transactionId), order = (await tx.get(orderRef)).data();
    if (!order || !id(order.buyerId) || !id(order.sellerId) || order.buyerId === order.sellerId) return 0;
    const saved = order.transportReviewFollowUpScan;
    let untilId = saved?.schemaVersion === 1 && cursorId(saved.untilId) && (saved.lastId === null || cursorId(saved.lastId) &&
      Buffer.compare(Buffer.from(saved.lastId, 'utf8'), Buffer.from(saved.untilId, 'utf8')) <= 0)
      ? saved.untilId as string : null;
    let lastId = untilId ? saved.lastId as string | null : null;
    if (!untilId) {
      const end = await tx.get(rows(transactionId).orderBy(FieldPath.documentId(), 'desc').startAfter('case`').endAt('case_').limit(1));
      untilId = end.docs[0]?.id ?? null; lastId = null;
      if (!untilId) return 0;
    }
    let query = rows(transactionId).orderBy(FieldPath.documentId()).startAt('case_').endAt(untilId).limit(21);
    if (lastId) query = rows(transactionId).orderBy(FieldPath.documentId()).startAfter(lastId).endAt(untilId).limit(21);
    const page = await tx.get(query), inspected = page.docs.slice(0, 20);
    const writes: (() => void)[] = [];
    for (const doc of inspected) {
      const review = doc.data();
      if (review.reviewId !== doc.id || !qualifiedReview(review, transactionId, order) || review.body.inquiryState !== 'open' ||
          ['closed', 'resolved'].includes(review.body.state)) continue;
      const entries = review.body.entries as any[];
      let entryIndex = entries.length - 1;
      while (entryIndex >= 0 && entries[entryIndex].nextFollowUpAt == null) entryIndex--;
      if (entryIndex < 0) continue;
      const entry = entries[entryIndex];
      try { if (date(entry.nextFollowUpAt) === null) continue; } catch { continue; }
      const due = Date.parse(entry.nextFollowUpAt);
      if (!time(entry.recordedAt) || !Number.isSafeInteger(due) || due > now.toMillis()) continue;
      const eventId = 'followup_' + supportSourceHash([transactionId, doc.id, entryIndex, entry.recordedAt, entry.nextFollowUpAt]);
      const receiptRef = rows(transactionId).doc(eventId), prior = await tx.get(receiptRef);
      if (prior.exists) continue;
      const alertRef = db.collection('admin_alerts').doc(eventId), alert = await tx.get(alertRef);
      const notices = await prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({
        eventKey: `transport_follow_up:${transactionId}:${eventId}`, userId, type: 'order_moderation', title: 'Enquête de transport à suivre',
        message: 'La date de suivi saisie par notre équipe est atteinte. Une nouvelle démarche humaine est attendue ; ce rappel ne confirme ni une perte, ni une réception, ni un remboursement.',
        data: { ownerId: userId, transactionId, transportReviewId: doc.id, financialEffectAuthorized: 'false', inventoryReleaseAuthorized: 'false',
          ...(review.body.kind === 'label_deposit_deadline' ? {transportReviewCapability: 'label_deposit_deadline_v1'} : {}) },
      })));
      writes.push(() => {
        tx.create(receiptRef, { protocol: 'transport_review_follow_up_v1', transactionId, reviewId: doc.id, reviewVersion: review.body.version,
          entryIndex, entryRecordedAt: entry.recordedAt, nextFollowUpAt: entry.nextFollowUpAt,
          actor: { kind: 'system', source: 'tracking_periodic_observer' }, observedAt: now,
          financialEffectAuthorized: false, inventoryReleaseAuthorized: false });
        if (!alert.exists) tx.create(alertRef, { kind: 'transport_follow_up_due', status: 'open', severity: 'warning', refId: transactionId,
          transportReviewId: doc.id, message: 'La date de suivi humaine est atteinte. Examiner le dossier ; aucun délai ne prouve une perte ou une restitution.', createdAt: now });
        notices.commit();
      });
    }
    const completed = page.size <= 20;
    tx.update(orderRef, { transportReviewFollowUpScan: { schemaVersion: 1, untilId: completed ? null : untilId,
      lastId: completed ? null : inspected[inspected.length - 1].id, observedAt: now } });
    for (const commit of writes) commit();
    return writes.length;
  });
}
