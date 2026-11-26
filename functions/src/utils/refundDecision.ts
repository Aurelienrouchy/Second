/** Private operator instructions. Commercial facts and money reserve together. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { assertNoActiveBankDispute } from './bankDispute';
import { hasUnsettledReturnRequest } from './returnRequest';
import { deliveryCorrectionBlocksProgress, orderModerationAllowsProgress, readOrderModeration } from './orderModeration';
import { nonnegativeCents, nativeTime } from './stripeCheckoutProof';
import { refundResult, hasUnsettledRefund } from './refundState';
import { readReturnToSenderFinancialSource, parseReturnToSenderFinancialReference,
  type ReturnToSenderFinancialReference } from './returnToSenderCase';
import { assertAccountSecurityOpen } from './eligibility';
import {assertStoredAccountSecuritySession} from './storedAccountSecuritySession';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import { readTransportFinancialSource, parseTransportFinancialReference, type TransportFinancialReference } from './transportReview';
import {supportSourceHash as supportSourceHashForProduct} from './supportRequest';
import {productReviewCaseId} from './productReviewSource';
import {PRODUCT_MATERIAL_REVIEW_ENABLED} from './productReviewMaterial';
import {productParcelRequested, assertProductParcelNewOpen, PRODUCT_PARCEL_REVIEW_ENABLED} from './productReviewParcel';
import {readProductFinancialSource, parseProductFinancialReference, productFinancialReferenceCurrent, productFinancialContextRequired,
  productFinancialReviewError, type ProductFinancialReference} from './productReviewFinancial';
import {parseLateCommercialReference, type LateCommercialReference} from './lateCommercialRecourse';
import {parseRefundAllocation, qualifyRefundAllocation, prepareRefundAllocationReservation, qualifyRefundAllocationRenewal, readRefundAgreementProof, readAllocationHistoryIntent, readSettledAllocationIntent,
  hasPurchaseRefundContext, purchaseRefundReturnContext, PURCHASE_REFUND_ENABLED, type RefundAllocationReference} from './refundAllocation';

type Data = FirebaseFirestore.DocumentData;
export type RefundDecisionInput = {
  transactionId: string; expectedDisputeId: string; adminUid: string; requestId: string;
  previewId: string; expectedSourceHash: string; expectedTotalCents: number;
  expectedCardCents: number; expectedWalletCents: number; expectedSellerDebitCents: number;
  decisionType: 'refund_without_return'; note: string;
  returnToSender?: ReturnToSenderFinancialReference;
  transportReview?: TransportFinancialReference;
  productReview?: ProductFinancialReference;
  allocation?: RefundAllocationReference;
  resume?: { refundIntentId: string; refundAttemptId: string };
};
export const validDecisionReference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
/** Native Firebase identities are compared verbatim, independently of the
 * stricter grammar of commercial, command and provider references. */
export const validDecisionUid = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 &&
  !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
const validHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function canonical(v: any): any {
  if (v instanceof Timestamp) return { seconds: v.seconds, nanoseconds: v.nanoseconds };
  if (v instanceof Date) return { dateMs: v.getTime() };
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v === undefined ? null : v;
}
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const refundDecisionId = (i: RefundDecisionInput) => digest([i.resume ? 'refund_resume' : 'refund', i.transactionId, i.adminUid, i.requestId]);
export const refundDecisionPayload = (i: RefundDecisionInput) => digest(i);
export const refundDecisionRef = (i: RefundDecisionInput) => db.collection('transactions').doc(i.transactionId)
  .collection('dispute_decisions').doc(refundDecisionId(i));

export function parseRefundDecisionInput(adminUid: string, raw: any): RefundDecisionInput {
  if (!validDecisionReference(raw?.transactionId) || !validDecisionReference(raw?.expectedDisputeId) ||
      raw?.expectedAdminUid !== adminUid || !/^[A-Za-z0-9_-]{16,128}$/.test(raw?.requestId ?? '') ||
      !validHash(raw?.previewId) || !validHash(raw?.expectedSourceHash) || raw?.decisionType !== 'refund_without_return' ||
      typeof raw?.note !== 'string' || !raw.note.trim() || raw.note.trim().length > 500 ||
      ![raw?.expectedTotalCents, raw?.expectedCardCents, raw?.expectedWalletCents, raw?.expectedSellerDebitCents].every(nonnegativeCents)) {
    throw new HttpsError('invalid-argument', 'L’aperçu, le dossier, les montants, la référence et la note explicite sont requis.');
  }
  const returnToSender = raw.returnToSender === undefined ? null : parseReturnToSenderFinancialReference(raw.returnToSender);
  const transportReview = raw.transportReview === undefined ? null : parseTransportFinancialReference(raw.transportReview);
  const productReview = raw.productReview === undefined ? null : parseProductFinancialReference(raw.productReview);
  const allocation = raw.allocation === undefined ? null : parseRefundAllocation(raw.allocation);
  if (allocation?.terms.settlementKind === 'retain_remaining') throw new HttpsError('invalid-argument', 'La conservation du reliquat utilise la décision sans remboursement.');
  if (allocation && raw.capability !== 'purchase_refund_v1' && raw.allocationCapability !== 'purchase_refund_v1') throw new HttpsError('invalid-argument', 'Version d’allocation explicite requise.');
  if ([transportReview, returnToSender, productReview].filter(Boolean).length > 1) throw new HttpsError('invalid-argument', 'Un seul contexte financier examiné est autorisé.');
  if (allocation?.convenienceReturn && (transportReview || returnToSender || productReview))
    throw new HttpsError('invalid-argument', 'Le retour de convenance conserve son propre contexte financier.');
  const resume = raw.resume === undefined ? null : parseTransportResume(raw.resume);
  if (resume && !returnToSender && !transportReview && !productReview && !allocation) throw new HttpsError('invalid-argument', 'La reprise exige le contexte examiné.');
  if (returnToSender && !returnToSender.caseReferences.some(item => item.caseId === raw.expectedDisputeId))
    throw new HttpsError('invalid-argument', 'Le dossier principal doit appartenir à la liste examinée.');
  return { transactionId: raw.transactionId, expectedDisputeId: raw.expectedDisputeId, adminUid,
    requestId: raw.requestId, previewId: raw.previewId, expectedSourceHash: raw.expectedSourceHash,
    expectedTotalCents: raw.expectedTotalCents, expectedCardCents: raw.expectedCardCents,
    expectedWalletCents: raw.expectedWalletCents, expectedSellerDebitCents: raw.expectedSellerDebitCents,
    decisionType: 'refund_without_return', note: raw.note.trim(), ...(returnToSender ? { returnToSender } : {}),
    ...(transportReview ? { transportReview } : {}), ...(productReview ? {productReview} : {}), ...(allocation ? {allocation} : {}), ...(resume ? { resume } : {}) };
}
function parseTransportResume(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'refundAttemptId,refundIntentId' ||
      !validDecisionReference(value.refundIntentId) || !validDecisionReference(value.refundAttemptId))
    throw new HttpsError('invalid-argument', 'Intention et tentative originales exactes requises.');
  return { refundIntentId: value.refundIntentId as string, refundAttemptId: value.refundAttemptId as string };
}
function transportResumeBasis(order: Data, resume: { refundIntentId: string; refundAttemptId: string }) {
  const intent = order.refund;
  if (!intent || intent.intentId !== resume.refundIntentId || intent.attemptId !== resume.refundAttemptId ||
      !nativeTime(intent.requestedAt) || !validDecisionReference(intent.idempotencyKey) || intent.currency !== 'cad' ||
      intent.buyerId !== order.buyerId || intent.sellerId !== order.sellerId || intent.buyerId === intent.sellerId ||
      ![intent.cardAmountCents, intent.walletAmountCents, intent.sellerDebitCents, intent.freezeCents].every(nonnegativeCents) ||
      intent.cardAmountCents + intent.walletAmountCents < 1 || intent.relistArticle !== false || intent.extraSellerDebitCents !== 0)
    throw transportReviewError();
  return { intentId: intent.intentId, attemptId: intent.attemptId, idempotencyKey: intent.idempotencyKey,
    currency: intent.currency, buyerId: intent.buyerId, sellerId: intent.sellerId, paymentIntentId: intent.paymentIntentId,
    cardAmountCents: intent.cardAmountCents, walletAmountCents: intent.walletAmountCents, sellerDebitCents: intent.sellerDebitCents,
    freezeCents: intent.freezeCents, relistArticle: intent.relistArticle, extraSellerDebitCents: intent.extraSellerDebitCents,
    requestedAt: intent.requestedAt, actor: intent.actor, originalStatus: intent.originalStatus };
}
function assertTransportResumeOpen(order: Data, resume: { refundIntentId: string; refundAttemptId: string }) {
  transportResumeBasis(order, resume);
  const intent = order.refund;
  if (intent.fundsAppliedAt != null || intent.stripeRefundId != null || intent.providerStatus != null || intent.legacyApplied === true ||
      intent.legacyReconciliationRequired === true || !['requested', 'unknown', 'reconciliation_required'].includes(intent.state) ||
      intent.leaseUntilMs > Date.now() || intent.externalAttemptedAtMs != null &&
      (!Number.isSafeInteger(intent.externalAttemptedAtMs) || intent.externalAttemptedAtMs < 1 || Date.now() - intent.externalAttemptedAtMs >= 23 * 60 * 60_000))
    throw transportReviewError();
}

/** Historical association keeps the original reserve in an immutable native
 * basis. A remaining reserve of zero qualifies only with its exact settlement
 * receipt and local movements; NEW-effect gates still compare current facts. */
async function readTransportResumeAssociation(tx: FirebaseFirestore.Transaction, input: RefundDecisionInput, order: Data, decision: Data) {
  if (!input.resume) return false;
  const current = transportResumeBasis(order, input.resume), intent = order.refund;
  const stored = decision.resumeIntentBasis;
  const originalFreeze = stored ? stored.freezeCents : digest(current) === decision.resumeIntentBasisHash ? current.freezeCents :
    intent.freezeConsumption?.originalFreezeCents;
  if (!nonnegativeCents(originalFreeze) || originalFreeze > input.expectedSellerDebitCents ||
      stored && digest(stored) !== decision.resumeIntentBasisHash ||
      digest({ ...current, freezeCents: originalFreeze }) !== decision.resumeIntentBasisHash) return false;
  if (originalFreeze > 0) {
    const hold = (await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').doc(`refund_hold_${intent.intentId}`))).data();
    if (hold?.type !== 'refund_hold' || hold.transactionId !== input.transactionId || hold.refundIntentId !== intent.intentId ||
        hold.amount !== originalFreeze || !nonnegativeCents(hold.balanceAfter) || !nativeTime(hold.createdAt) ||
        hold.createdAt.toMillis() < current.requestedAt.toMillis() || hold.createdAt.toMillis() > decision.committedAt.toMillis()) return false;
  }
  if (current.freezeCents === originalFreeze) return true;
  const consumed = intent.freezeConsumption;
  if (current.freezeCents !== 0 || originalFreeze === 0 || !nativeTime(intent.fundsAppliedAt) ||
      !consumed || consumed.protocol !== 'refund_hold_consumption_v1' || consumed.refundIntentId !== intent.intentId ||
      consumed.refundAttemptId !== input.resume.refundAttemptId || consumed.buyerId !== order.buyerId || consumed.sellerId !== order.sellerId ||
      consumed.originalFreezeCents !== originalFreeze || consumed.sellerDebitCents !== input.expectedSellerDebitCents || consumed.currency !== 'CAD' ||
      ![consumed.consumedCents, consumed.returnedCents, consumed.fromPendingCents, consumed.fromHeldCents, consumed.fromBalanceCents, consumed.debtCents].every(nonnegativeCents) ||
      consumed.consumedCents + consumed.returnedCents !== originalFreeze || consumed.consumedCents !== Math.min(originalFreeze, consumed.fromHeldCents) ||
      !nativeTime(consumed.settledAt) || !consumed.settledAt.isEqual(intent.fundsAppliedAt) ||
      consumed.settledAt.toMillis() < decision.committedAt.toMillis()) return false;
  const debit = (await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').doc(`refund_debit_${intent.intentId}`))).data();
  if (debit?.type !== 'refund_debit' || debit.transactionId !== input.transactionId || debit.refundIntentId !== intent.intentId ||
      debit.amount !== consumed.fromPendingCents + consumed.fromHeldCents + consumed.fromBalanceCents || debit.debtRecorded !== consumed.debtCents ||
      debit.amount + debit.debtRecorded !== input.expectedSellerDebitCents || !nonnegativeCents(debit.balanceAfter) ||
      !nativeTime(debit.createdAt) || !debit.createdAt.isEqual(intent.fundsAppliedAt)) return false;
  if (input.expectedWalletCents > 0) {
    const credit = (await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').doc(`refund_credit_${intent.intentId}`))).data();
    if (credit?.type !== 'refund_credit' || credit.transactionId !== input.transactionId || credit.refundIntentId !== intent.intentId ||
        credit.amount !== input.expectedWalletCents || !nonnegativeCents(credit.balanceAfter) || !nativeTime(credit.createdAt) ||
        !credit.createdAt.isEqual(intent.fundsAppliedAt)) return false;
  }
  return true;
}

/** Content version includes every protected case fact, not only its status. */
export async function readCommercialDecisionSource(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: Data, expectedDisputeId: string, returnToSender = false, reserved = false, selectedTransportReview?: string, selectedProductReview?: string,
  selectedProductTopic: ProductFinancialReference['topic'] = 'authenticity', material = false, parcel = false, allocation?: RefundAllocationReference, lateCommercial?: LateCommercialReference) {
  if (!validDecisionUid(order.buyerId) || !validDecisionUid(order.sellerId) || order.buyerId === order.sellerId)
    throw new HttpsError('failed-precondition', 'Les parties doivent être rapprochées.');
  const cases = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
  if (cases.size >= 101 || cases.docs.some(doc => doc.data().transactionId !== transactionId ||
      doc.data().buyerId !== order.buyerId || doc.data().sellerId !== order.sellerId || !nativeTime(doc.data().createdAt))) {
    throw new HttpsError('failed-precondition', 'Les dossiers doivent être rapprochés avant une décision.');
  }
  const transport = returnToSender ? await readReturnToSenderFinancialSource(tx, transactionId, order, reserved ? order.refund.originalStatus : undefined) : null;
  const inquiry = selectedTransportReview ? await readTransportFinancialSource(tx, transactionId, order, selectedTransportReview, reserved) : null;
  const transportTargetId = inquiry ? inquiry.kind === 'carrier_exception' ? inquiry.review.origin.disputeId : inquiry.review.reviewId : null;
  const allocationSource = allocation ? await qualifyRefundAllocation(tx, transactionId, order, allocation, reserved ? order.refund?.intentId : undefined) : null;
  const agreement = allocation?.agreement ? await readRefundAgreementProof(tx, transactionId, order, allocation.agreement, allocation.terms, reserved ? order.refund?.intentId : undefined) : null;
  if (allocation?.agreement && !agreement) throw new HttpsError('failed-precondition', 'Les deux acceptations doivent être actuelles.');
  let candidate = inquiry?.kind === 'delivery_correction' && expectedDisputeId === transportTargetId ? inquiry.reviewSnap :
    transport ? transport.cases.docs.find(doc => doc.id === expectedDisputeId) : cases.docs.find(doc => doc.id === expectedDisputeId);
  if (!candidate && agreement && expectedDisputeId === allocation!.agreement!.agreementId) {
    const a = agreement.document;
    candidate = {id: a.agreementId, exists: true, ref: db.collection('transactions').doc(transactionId).collection('refund_agreements').doc(a.agreementId),
      data: () => ({transactionId, buyerId: order.buyerId, sellerId: order.sellerId, createdAt: a.proposedAt, status: 'open',
        source: 'purchase_refund_agreement', termsHash: a.termsHash, version: a.version, acceptanceHash: allocation!.agreement!.acceptanceHash})} as unknown as FirebaseFirestore.QueryDocumentSnapshot;
  }
  if (allocation?.convenienceReturn) {
    const {readConvenienceReturnFinancialReception} = await import('./convenienceReturnReception');
    const reception = await readConvenienceReturnFinancialReception(tx, transactionId, order, allocation.convenienceReturn);
    const progressOrder: Data = {...order, disputed: false, status: 'delivered'};
    if (reserved) {delete progressOrder.refund; delete progressOrder.refundBlocked;}
    if (!reception || expectedDisputeId !== allocation.convenienceReturn.proposalId || cases.docs.some(r => !['resolved', 'dismissed', 'closed'].includes(r.data().status)) ||
        (reserved ? !['refund_in_progress', 'refund_action_required'].includes(order.status) || order.refund?.originalStatus !== 'return_requested' : order.status !== 'return_requested') ||
        returnToSender || selectedTransportReview || selectedProductReview || order.returnEscalatedAt != null || order.buyerReport != null ||
        order.labelReconciliationRequired === true || order.returnReconciliationRequired === true || order.trackingReviewRequired === true ||
        order.purchasePolicyReviewRequired === true || deliveryCorrectionBlocksProgress(order) || returnToSenderBlocksProgress(order) ||
        !await fraudReviewAllowsProgress(tx, transactionId, order) || !await orderModerationAllowsProgress(tx, progressOrder))
      throw new HttpsError('failed-precondition', 'Le retour reçu et les gardes indépendantes exigent un examen avant remboursement.');
    assertNoActiveBankDispute(order);
    const nativeTarget = {...reception.target, transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
      source: 'convenience_return', status: 'open', createdAt: reception.target.recordedAt};
    candidate = {id: expectedDisputeId, exists: true, ref: db.collection('transactions').doc(transactionId).collection('convenience_return').doc('current_v2'),
      data: () => nativeTarget} as unknown as FirebaseFirestore.QueryDocumentSnapshot;
  }
  if (!candidate?.exists || !candidate.data()) throw new HttpsError('failed-precondition', 'Le dossier examiné ne correspond pas à cette commande.');
  // The correction target is fetched by ID rather than by query. Its native
  // existence was qualified above; downstream targets therefore always have
  // data, just like the pre-existing query snapshots.
  const target = candidate as FirebaseFirestore.QueryDocumentSnapshot;
  if (allocation?.reviewedDisputeId && target.data().source !== 'purchase_refund_agreement' && allocation.reviewedDisputeId !== expectedDisputeId)
    throw new HttpsError('failed-precondition', 'La source documentaire doit correspondre à la réclamation examinée.');
  // All order fields are protected server facts here. A change requires a new
  // preview; no timestamp or status is substituted for a version of the facts.
  const protectedCases = cases.docs.map(doc => [doc.id, doc.data()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const legacySource = transport ? [transactionId, order, protectedCases, transport.caseReferences] :
    inquiry ? [transactionId, order, protectedCases, inquiry.caseReferences] : [transactionId, order, protectedCases];
  let product: Awaited<ReturnType<typeof readProductFinancialSource>> | null = null;
  if (selectedProductReview) {
    try {product = await readProductFinancialSource(tx, transactionId, order, selectedProductReview, allocation?.reviewedDisputeId ?? expectedDisputeId, selectedProductTopic, material, parcel, lateCommercial);}
    catch (error) {if (!(error instanceof HttpsError) || error.code !== 'failed-precondition') throw error;}
  }
  const returnFinanciallyExamined = allocation?.convenienceReturn ? true : allocation?.returnDisposition ? qualifyAllocationReturnReview(transactionId, order, allocation, product) : false;
  if (allocation && hasUnsettledReturnRequest(order) && !returnFinanciallyExamined)
    throw new HttpsError('failed-precondition', 'Le retour natif et le dossier documentaire courant exigent une appréciation financière explicite.',
      {reason: 'purchase_return_financial_review_required', newRefundPermissionGranted: false});
  const baseSource = selectedProductReview ? [legacySource, product?.reference ?? {caseId: selectedProductReview, qualification: 'review_required'}] : legacySource;
  const sourceHash = digest(allocation ? [baseSource, allocation, allocationSource!.basisHash, allocationSource!.cumulativeHash, target.data()] : baseSource);
  const retainedObligations = [] as string[];
  if (hasUnsettledReturnRequest(order)) retainedObligations.push('return_request');
  if (deliveryCorrectionBlocksProgress(order)) retainedObligations.push('delivery_correction');
  if (order.bankDispute != null || order.disputeId != null) retainedObligations.push('bank_case');
  if (transport) retainedObligations.push('return_to_sender_inventory_review');
  if (inquiry) retainedObligations.push('transport_inventory_review');
  return { sourceHash, target, cases, retainedObligations, returnToSender: transport, transportReview: inquiry,
    ...(allocation ? {allocation: {reference: allocation, basisHash: allocationSource!.basisHash, cumulativeHash: allocationSource!.cumulativeHash,
      remaining: allocationSource!.remaining, remainingCardCents: allocationSource!.remainingCardCents, remainingWalletCents: allocationSource!.remainingWalletCents,
      remainingSellerCents: allocationSource!.remainingSellerCents, bilateralAgreementVerified: agreement !== null,
      returnContext: purchaseRefundReturnContext(transactionId, order), returnFinanciallyExamined}} : {}),
    ...(selectedProductReview ? {productReview: product} : {}),
    remainingOpenDisputeIds: cases.docs.filter(doc => doc.id !== expectedDisputeId && doc.data().status === 'open').map(doc => doc.id).sort() };
}
/** This examines a lost/not-arrived return commercially. It neither invents
 * DE/receipt nor gives a transport, fault, carrier-cost or inventory authority. */
function qualifyAllocationReturnReview(transactionId: string, order: Data, allocation: RefundAllocationReference,
  product?: Awaited<ReturnType<typeof readProductFinancialSource>> | null): boolean {
  const r = allocation.returnDisposition, context = purchaseRefundReturnContext(transactionId, order), p = product?.reference;
  return !!r && !!p && ['nonconformity', 'parcel_delivery'].includes(p.topic) && context.qualification === 'native_committed_return' &&
    context.requestId === r.requestId && context.sourceHash === r.sourceHash &&
    p.caseId === r.caseId && p.issueId === r.issueId && p.issueHash === r.issueHash && p.membersHash === r.membersHash &&
    p.authorizationSourceHash === r.authorizationSourceHash;
}

const inquiryReviewError = () => new HttpsError('failed-precondition', 'Les dossiers transport et les autres gardes doivent être rapprochés avant une nouvelle instruction.',
  { reason: 'transport_financial_review_required', newRefundPermissionGranted: false });
const inquiryFields = (value: any) => ({ kind: value.kind, reviewId: value.reviewId ?? value.review?.reviewId,
  caseReferences: value.caseReferences, caseSetHash: value.caseSetHash, financialSourceHash: value.financialSourceHash,
  authorizationSourceHash: value.authorizationSourceHash, options: value.options });
function publicInquiryFinancialSource(source: Awaited<ReturnType<typeof readTransportFinancialSource>>) {
  const { reviewSnap: _snapshot, allReviews: _rows, ...view } = source; return view;
}
function publicProductFinancialSource(source: Awaited<ReturnType<typeof readProductFinancialSource>>) {
  const {capture: _privateCapture, ...view} = source; return view;
}
/** A product decision examines its commercial complaint, never overrides
 * independent transport, banking, fraud or native moderation instructions. */
async function productOtherGuards(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data, reserved = false,
  product?: Awaited<ReturnType<typeof readProductFinancialSource>> | null, allocation?: RefundAllocationReference) {
  assertNoActiveBankDispute(order);
  const priorSettled = !reserved && !!allocation && !!order.refund?.allocation && !!await readSettledAllocationIntent(tx, transactionId, order, order.refund);
  if (returnToSenderBlocksProgress(order) || hasUnsettledReturnRequest(order) && product?.materialReturnReview?.qualifiesOwnReturnForFinancialReview !== true && product?.parcelReturnReview?.qualifiesOwnReturnForFinancialReview !== true &&
      !(allocation && qualifyAllocationReturnReview(transactionId, order, allocation, product)) || deliveryCorrectionBlocksProgress(order) ||
      order.trackingReviewRequired === true || order.purchasePolicyReviewRequired === true || order.labelReconciliationRequired === true ||
      order.refundLegacyReconciliationRequired === true || order.refundedAt != null || order.refundedVia === 'chargeback' ||
      order.bankDispute?.outcome === 'lost' || order.disputeOutcome === 'lost' ||
      !reserved && !priorSettled && (order.refund != null || order.refundBlocked === true) || !await fraudReviewAllowsProgress(tx, transactionId, order))
    throw productFinancialReviewError();
  const state = await readOrderModeration(tx, order);
  if (state && (!state.sourceQualified || state.action !== 'continue' ||
      state.otherBlockers.some(reason => reason !== 'order_recourse' && !(reserved && reason === 'refund_reconciliation'))))
    throw productFinancialReviewError();
}
async function inquiryOtherGuards(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data,
  source: Awaited<ReturnType<typeof readTransportFinancialSource>>, reserved = false, expectedDisputeId?: string, allocation?: RefundAllocationReference) {
  assertNoActiveBankDispute(order);
  const priorSettled = !reserved && !!allocation && !!order.refund?.allocation && !!await readSettledAllocationIntent(tx, transactionId, order, order.refund);
  if (returnToSenderBlocksProgress(order) || hasUnsettledReturnRequest(order) || order.refundLegacyReconciliationRequired === true ||
      order.refundedAt != null || order.refundedVia === 'chargeback' || order.bankDispute?.outcome === 'lost' || order.disputeOutcome === 'lost' ||
      order.purchasePolicyReviewRequired === true || order.labelReconciliationRequired === true ||
      !reserved && !priorSettled && (order.refund != null || order.refundBlocked === true) || !await fraudReviewAllowsProgress(tx, transactionId, order)) throw inquiryReviewError();
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
  const ownedIds = source.allReviews.docs.filter(doc => doc.data().body.kind === 'carrier_exception').map(doc => doc.data().body.origin.disputeId);
  if (claims.size >= 101 || claims.docs.some(doc => !['resolved', 'dismissed', 'closed'].includes(doc.data().status) &&
      !((doc.id === expectedDisputeId && doc.data().source !== 'system_transport_review' && [order.buyerId, order.sellerId].includes(doc.data().reportedBy) ||
          doc.data().source === 'system_transport_review' && ownedIds.includes(doc.id)) &&
        doc.data().buyerId === order.buyerId && doc.data().sellerId === order.sellerId && nativeTime(doc.data().createdAt))))
    throw inquiryReviewError();
  const examined = { ...order };
  if (deliveryCorrectionBlocksProgress(order)) {
    const own = source.allReviews.docs.find(doc => doc.id === order.deliveryCorrection?.transportReviewId);
    if (!own || own.data().body.kind !== 'delivery_correction' || own.data().body.origin.correctionId !== order.deliveryCorrection?.correctionId)
      throw inquiryReviewError();
    delete examined.deliveryCorrection;
  }
  examined.disputed = false; examined.trackingReviewRequired = false;
  if (reserved) { delete examined.refund; delete examined.refundBlocked; examined.status = order.refund.originalStatus; }
  if (!await orderModerationAllowsProgress(tx, examined)) throw inquiryReviewError();
}

/** Financial authorization is distinct from inquiry status/support answers.
 * Real external evidence is serviced first by the core; every NEW effect must
 * requalify the same native case set, sources and present operator. */
export async function transportReviewNewEffectAllowed(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: Data, operatorCurrent: boolean, expectedAuthorizationId?: string) {
  const intent = order.refund, decision = intent?.transportReviewAuthorization ?? intent?.commercialDecision;
  const reference = decision?.transportReview;
  const ownHold = deliveryCorrectionBlocksProgress(order) || order.trackingReviewRequired === true && order.trackingReviewReason === 'carrier_exception_requires_human_review';
  if (!reference) return !ownHold;
  if (!operatorCurrent || !recentOperatorAuthentication(decision?.operatorAuthTime) || expectedAuthorizationId !== decision.decisionId || !intent || intent.fundsAppliedAt || order.status !== 'refund_in_progress' ||
      intent.relistArticle !== false || intent.extraSellerDebitCents !== 0) return false;
  try {
    await transportAdmin(tx, decision.actorUid);
    const current = await readTransportFinancialSource(tx, transactionId, order, reference.reviewId, true);
    await inquiryOtherGuards(tx, transactionId, order, current, true, decision.expectedDisputeId);
    const native = (await tx.get(db.collection('transactions').doc(transactionId).collection('dispute_decisions').doc(decision.decisionId))).data();
    return native?.kind === 'admin_financial_decision_v1' && native.outcome === 'reserved' && native.refundIntentId === intent.intentId &&
      native.payloadHash === decision.payloadHash && native.actorUid === decision.actorUid && nativeTime(native.committedAt) &&
      native.buyerId === order.buyerId && native.sellerId === order.sellerId && native.cardCents === intent.cardAmountCents &&
      native.walletCents === intent.walletAmountCents && native.sellerDebitCents === intent.sellerDebitCents &&
      native.totalCents === intent.cardAmountCents + intent.walletAmountCents && digest(native.transportReview) === digest(reference) &&
      (!decision.resume || native.resume?.refundIntentId === intent.intentId && native.resume?.refundAttemptId === intent.attemptId &&
        native.resumeIntentBasisHash === digest(transportResumeBasis(order, decision.resume))) &&
      current.caseSetHash === reference.caseSetHash && digest(current.caseReferences) === digest(reference.caseReferences) &&
      current.authorizationSourceHash === reference.authorizationSourceHash;
  } catch (error) {
    if (error instanceof HttpsError && ['failed-precondition', 'permission-denied'].includes(error.code)) return false;
    throw error;
  }
}

const transportReviewError = () => new HttpsError('failed-precondition',
  'Une autre garde ou une source inconnue exige un examen avant cette instruction financière.',
  { reason: 'return_to_sender_financial_review_required', newRefundPermissionGranted: false });
const transportFields = (value: any) => ({ caseReferences: value.caseReferences, caseSetHash: value.caseSetHash,
  financialSourceHash: value.financialSourceHash, authorizationSourceHash: value.authorizationSourceHash, options: value.options });
function publicTransportSource(source: Awaited<ReturnType<typeof readReturnToSenderFinancialSource>>) {
  const { cases: _cases, ...view } = source; return view;
}
async function transportAdmin(tx: FirebaseFirestore.Transaction, uid: string) {
  const [user, security] = await tx.getAll(db.collection('users').doc(uid), db.collection('eligibility_profiles').doc(uid));
  const privateUser = user.data();
  if (privateUser?.isAdmin !== true || privateUser && Object.prototype.hasOwnProperty.call(privateUser, 'isActive') && privateUser.isActive !== true)
    throw new HttpsError('permission-denied', 'Rôle privé d’opérateur requis.');
  await assertAccountSecurityOpen(security.data(), tx, uid);
}
/** The RTS exception never grants the other permissions retained by the order. */
async function transportOtherGuards(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data, reserved = false, allocation?: RefundAllocationReference) {
  const priorSettled = !reserved && !!allocation && !!order.refund?.allocation && !!await readSettledAllocationIntent(tx, transactionId, order, order.refund);
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
  if (claims.size >= 101 || claims.docs.some(doc => !['resolved', 'dismissed', 'closed'].includes(doc.data().status)) ||
      order.disputed === true || hasUnsettledReturnRequest(order) || deliveryCorrectionBlocksProgress(order) ||
      Object.prototype.hasOwnProperty.call(order, 'fraudReview') || order.refundLegacyReconciliationRequired === true ||
      order.refundedAt != null || order.refundedVia === 'chargeback' || order.bankDispute?.outcome === 'lost' || order.disputeOutcome === 'lost' ||
      order.labelReconciliationRequired === true || order.purchasePolicyReviewRequired === true || order.trackingReviewRequired === true ||
      !reserved && !priorSettled && (order.refund != null || order.refundBlocked === true)) throw transportReviewError();
  assertNoActiveBankDispute(order);
  if (!await fraudReviewAllowsProgress(tx, transactionId, order)) throw transportReviewError();
  const examined = { ...order };
  delete examined.returnToSenderGuard;
  if (reserved) { delete examined.refund; examined.status = order.refund.originalStatus; }
  if (!await orderModerationAllowsProgress(tx, examined)) throw transportReviewError();
}

/** Auth evidence is acquired outside Firestore; the private role is read again
 * inside the NEW-effect transaction. A background worker may service a true
 * external effect but may never renew a missing operator authorization. */
function recentOperatorAuthentication(seconds: unknown): boolean {
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds < 1) return false;
  const authenticatedAtMs = seconds * 1000, nowMs = Date.now();
  return Number.isSafeInteger(authenticatedAtMs) && authenticatedAtMs <= nowMs && nowMs - authenticatedAtMs <= 300_000;
}
export async function returnToSenderOperatorSessionCurrent(decision: any): Promise<boolean> {
  const seconds = decision?.operatorAuthTime;
  const authenticatedAtMs = seconds * 1000;
  if (!validDecisionUid(decision?.actorUid) || !Number.isSafeInteger(seconds) || seconds < 1 ||
      !Number.isSafeInteger(authenticatedAtMs)) return false;
  try {
    return await db.runTransaction(async tx => {
      if (!recentOperatorAuthentication(seconds)) return false;
      await assertStoredAccountSecuritySession(tx, decision.actorUid, seconds);
      return true;
    });
  } catch { return false; }
}
/** Every NEW product-context effect requalifies native origin and members.
 * Reservation, lease and attempted flags never qualify external settlement. */
export async function productReviewNewEffectAllowed(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data,
  operatorCurrent: boolean, expectedAuthorizationId?: string) {
  const intent = order.refund, decision = intent?.productReviewAuthorization ?? intent?.commercialDecision, reference = decision?.productReview;
  if (!reference) return !await productFinancialContextRequired(tx, transactionId, order);
  if (!operatorCurrent || !recentOperatorAuthentication(decision.operatorAuthTime) || expectedAuthorizationId !== decision.decisionId ||
      !intent || intent.fundsAppliedAt || order.status !== 'refund_in_progress' || intent.relistArticle !== false || intent.extraSellerDebitCents !== 0) return false;
  try {
    await transportAdmin(tx, decision.actorUid);
    const native = (await tx.get(db.collection('transactions').doc(transactionId).collection('dispute_decisions').doc(decision.decisionId))).data();
    if (!native || native.outcome !== 'reserved' || native.kind !== 'admin_financial_decision_v1' || native.actorUid !== decision.actorUid ||
        native.payloadHash !== decision.payloadHash || native.sourceHash !== decision.sourceHash || native.refundIntentId !== intent.intentId ||
        digest(native.productReview) !== digest(reference) || native.cardCents !== intent.cardAmountCents || native.walletCents !== intent.walletAmountCents ||
        native.sellerDebitCents !== intent.sellerDebitCents || native.totalCents !== intent.cardAmountCents + intent.walletAmountCents || intent.currency !== 'cad') return false;
    const input: RefundDecisionInput = {transactionId, expectedDisputeId: native.expectedDisputeId, adminUid: native.actorUid, requestId: native.requestId,
      previewId: native.previewId, expectedSourceHash: native.sourceHash, expectedTotalCents: native.totalCents, expectedCardCents: native.cardCents,
      expectedWalletCents: native.walletCents, expectedSellerDebitCents: native.sellerDebitCents, decisionType: native.decisionType,
      note: native.note, productReview: parseProductFinancialReference(reference), ...(decision.resume ? {resume: decision.resume} : {})};
    if (native.allocation !== undefined) input.allocation = parseRefundAllocation(native.allocation);
    const own = await readAdminRefundDecision(tx, input, order);
    const current = await readProductFinancialSource(tx, transactionId, order, reference.caseId, input.allocation?.reviewedDisputeId ?? native.expectedDisputeId, reference.topic, reference.materialCapability === 'product_review_material_v1', reference.parcelCapability === 'product_review_parcel_v1', reference.lateCommercial);
    if (reference.materialCapability === 'product_review_material_v1' && !PRODUCT_MATERIAL_REVIEW_ENABLED || reference.parcelCapability === 'product_review_parcel_v1' && !PRODUCT_PARCEL_REVIEW_ENABLED) return false;
    await productOtherGuards(tx, transactionId, order, true, current, input.allocation);
    return own.outcome === 'reserved' && productFinancialReferenceCurrent(current.reference, reference, true);
  } catch (error) {
    if (error instanceof HttpsError && ['failed-precondition', 'permission-denied', 'invalid-argument', 'unavailable'].includes(error.code)) return false;
    throw error;
  }
}

/** Requalify the complete native set and protected order facts after reserve,
 * before a NEW provider POST or local wallet-only settlement. */
export async function returnToSenderNewEffectAllowed(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: Data, currentOperatorSession: boolean, expectedAuthorizationId?: string): Promise<boolean> {
  if (!returnToSenderBlocksProgress(order)) return !(order.refund?.returnToSenderAuthorization?.returnToSender ?? order.refund?.commercialDecision?.returnToSender);
  const intent = order.refund, decision = intent?.returnToSenderAuthorization ?? intent?.commercialDecision, examined = decision?.returnToSender;
  if (!examined || !currentOperatorSession || !recentOperatorAuthentication(decision?.operatorAuthTime) || expectedAuthorizationId !== decision.decisionId || intent.fundsAppliedAt || order.status !== 'refund_in_progress' ||
      intent.relistArticle !== false || intent.extraSellerDebitCents !== 0) return false;
  try {
    await transportAdmin(tx, decision.actorUid);
    await transportOtherGuards(tx, transactionId, order, true);
    const current = await readReturnToSenderFinancialSource(tx, transactionId, order, intent.originalStatus);
    const native = (await tx.get(db.collection('transactions').doc(transactionId).collection('dispute_decisions').doc(decision.decisionId))).data();
    return native?.kind === 'admin_financial_decision_v1' && native.schemaVersion === 1 && native.outcome === 'reserved' &&
      native.refundIntentId === intent.intentId && native.actorUid === decision.actorUid && nativeTime(native.committedAt) &&
      native.buyerId === order.buyerId && native.sellerId === order.sellerId && decision.buyerId === order.buyerId && decision.sellerId === order.sellerId &&
      native.cardCents === intent.cardAmountCents && native.walletCents === intent.walletAmountCents && native.sellerDebitCents === intent.sellerDebitCents &&
      native.totalCents === intent.cardAmountCents + intent.walletAmountCents && intent.currency === 'cad' &&
      native.inventoryPermissionGranted === false && decision.inventoryPermissionGranted === false &&
      (!decision.resume || native.resume?.refundIntentId === intent.intentId && native.resume?.refundAttemptId === intent.attemptId &&
        native.resumeIntentBasisHash === digest(transportResumeBasis(order, decision.resume))) &&
      native.payloadHash === decision.payloadHash && digest(native.returnToSender) === digest(examined) &&
      current.caseSetHash === examined.caseSetHash && digest(current.caseReferences) === digest(examined.caseReferences) &&
      current.authorizationSourceHash === examined.authorizationSourceHash;
  } catch (error) {
    if (error instanceof HttpsError && ['failed-precondition', 'permission-denied'].includes(error.code)) return false;
    throw error;
  }
}

async function amounts(tx: FirebaseFirestore.Transaction, order: Data, transactionId: string) {
  const totalCents = typeof order.totalAmount === 'number' ? Math.round(order.totalAmount * 100) : NaN;
  if (!nonnegativeCents(totalCents) || totalCents === 0 || Math.abs(order.totalAmount * 100 - totalCents) > 0.0000001 ||
      typeof order.currency !== 'string' || order.currency.toUpperCase() !== 'CAD' || !nativeTime(order.paidAt) ||
      !nonnegativeCents(order.sellerCreditedCents)) throw new HttpsError('failed-precondition', 'Les sommes et le paiement doivent être rapprochés.');
  const walletCents = ['wallet', 'mixed', 'wallet_and_card'].includes(order.paidVia) ? order.walletAmountUsed : 0;
  if (!nonnegativeCents(walletCents) || walletCents > totalCents ||
      (order.paidVia === 'wallet' ? walletCents !== totalCents || order.stripePaymentIntentId != null : walletCents === totalCents)) {
    throw new HttpsError('failed-precondition', 'La répartition du paiement doit être rapprochée.');
  }
  const cardCents = totalCents - walletCents;
  if (cardCents > 0 && (!/^pi_[A-Za-z0-9_]+$/.test(order.stripePaymentIntentId ?? '') || order.capturedCardCents !== cardCents))
    throw new HttpsError('failed-precondition', 'La capture carte doit être rapprochée.');
  if (walletCents > 0) {
    const rows = await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
    const debits = rows.docs.filter(doc => doc.data().type === 'purchase_debit');
    if (rows.size >= 101 || debits.length !== 1 || debits[0].data().amount !== walletCents ||
        !nonnegativeCents(debits[0].data().balanceAfter) || !nativeTime(debits[0].data().createdAt) ||
        rows.docs.some(doc => ['refund_credit', 'refund_debit'].includes(doc.data().type)))
      throw new HttpsError('failed-precondition', 'Le débit initial du porte-monnaie doit être rapproché.');
  }
  return { totalCents, cardCents, walletCents, sellerDebitCents: order.sellerCreditedCents };
}

/** Exact settled intent and local receipts, never a status-only shortcut. */
export async function readQualifiedSettledRefund(tx: FirebaseFirestore.Transaction, transactionId: string, order: Data) {
  const intent = order.refund;
  if (!intent || hasUnsettledRefund(order) || !refundResult(intent).success || intent.currency !== 'cad' ||
      !validDecisionReference(intent.intentId) || !nativeTime(intent.requestedAt) || !nativeTime(intent.fundsAppliedAt) ||
      !nativeTime(order.refundedAt) || ![intent.cardAmountCents, intent.walletAmountCents, intent.sellerDebitCents].every(nonnegativeCents) ||
      intent.bankWaiting === true || intent.legacyReconciliationRequired === true ||
      !validDecisionUid(order.buyerId) || !validDecisionUid(order.sellerId) || order.buyerId === order.sellerId ||
      (intent.buyerId != null && intent.buyerId !== order.buyerId) || (intent.sellerId != null && intent.sellerId !== order.sellerId) ||
      (order.currency != null && String(order.currency).toUpperCase() !== 'CAD') ||
      !['stripe', 'wallet'].includes(order.refundedVia) ||
      (intent.cardAmountCents > 0 && (intent.providerStatus !== 'succeeded' || intent.cardConfirmedCents !== intent.cardAmountCents ||
        !/^re_[A-Za-z0-9_]+$/.test(intent.stripeRefundId ?? '') || order.stripeRefundId !== intent.stripeRefundId ||
        intent.paymentIntentId !== order.stripePaymentIntentId || order.refundedVia !== 'stripe'))) {
    throw new HttpsError('failed-precondition', 'Le remboursement et ses mouvements doivent être intégralement rapprochés avant le classement.');
  }
  if (intent.walletAmountCents > 0) {
    const credit = (await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').doc(`refund_credit_${intent.intentId}`))).data();
    if (credit?.type !== 'refund_credit' || credit.transactionId !== transactionId || credit.refundIntentId !== intent.intentId ||
        credit.amount !== intent.walletAmountCents || !nonnegativeCents(credit.balanceAfter) || !nativeTime(credit.createdAt))
      throw new HttpsError('failed-precondition', 'Le crédit exact du remboursement doit être rapproché.');
  }
  if (intent.sellerDebitCents > 0) {
    const debit = (await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').doc(`refund_debit_${intent.intentId}`))).data();
    if (debit?.type !== 'refund_debit' || debit.transactionId !== transactionId || debit.refundIntentId !== intent.intentId ||
        !nonnegativeCents(debit.amount) || !nonnegativeCents(debit.debtRecorded) ||
        debit.amount + debit.debtRecorded !== intent.sellerDebitCents || !nonnegativeCents(debit.balanceAfter) || !nativeTime(debit.createdAt))
      throw new HttpsError('failed-precondition', 'Le débit et la dette exacts du remboursement doivent être rapprochés.');
  }
  return { totalCents: intent.cardAmountCents + intent.walletAmountCents, cardCents: intent.cardAmountCents,
    walletCents: intent.walletAmountCents, sellerDebitCents: intent.sellerDebitCents, refundIntentId: intent.intentId };
}

export async function prepareAdminDecisionPreview(adminUid: string, raw: any, walletOnly = false,
  operatorSession?: (tx?: FirebaseFirestore.Transaction, newEffect?: boolean) => Promise<unknown>) {
  const transport = raw?.decisionContext === 'return_to_sender_cases';
  const inquiry = raw?.decisionContext === 'transport_review';
  const product = raw?.decisionContext === 'product_review';
  const lateCommercial = raw?.lateCommercial === undefined ? undefined : parseLateCommercialReference(raw.lateCommercial);
  if (lateCommercial && !product) throw new HttpsError('invalid-argument', 'L’admission tardive exige son contexte financier produit.');
  const allocation = raw?.allocation === undefined ? undefined : parseRefundAllocation(raw.allocation);
  const allocationContext = raw?.decisionContext === 'purchase_refund_allocation';
  if (allocation && raw.capability !== 'purchase_refund_v1' && raw.allocationCapability !== 'purchase_refund_v1' || allocationContext && !allocation)
    throw new HttpsError('invalid-argument', 'Contexte d’allocation explicite requis.');
  if (allocation && !PURCHASE_REFUND_ENABLED) throw new HttpsError('failed-precondition', 'Les allocations sont en préparation.', {reason: 'purchase_refund_not_exposed'});
  const resume = raw?.resume === undefined ? null : parseTransportResume(raw.resume);
  if (resume && !transport && !inquiry && !product && !allocation) throw new HttpsError('invalid-argument', 'Contexte examiné requis pour la reprise.');
  if (inquiry && !/^case_[a-f0-9]{64}$/.test(raw?.transportReviewId ?? '')) throw new HttpsError('invalid-argument', 'Enquête exacte requise.');
  const material = raw?.materialCapability === 'product_review_material_v1', parcel = productParcelRequested(raw);
  assertProductParcelNewOpen(parcel);
  if (raw.materialCapability !== undefined && !material || product && raw.productReviewTopic === 'nonconformity' && !material || material && (!product || !PRODUCT_MATERIAL_REVIEW_ENABLED))
    throw new HttpsError('failed-precondition', 'Le parcours financier matériel est en préparation.', {reason: 'product_material_review_not_exposed'});
  if (product && (raw.capability !== 'product_review_financial_v1' || !/^pr_[a-f0-9]{64}$/.test(raw.productReviewCaseId ?? '') || !['authenticity', ...(material ? ['nonconformity'] : []), ...(parcel ? ['parcel_delivery'] : [])].includes(raw.productReviewTopic)))
    throw new HttpsError('invalid-argument', 'Contexte produit explicite requis.');
  if (raw?.decisionContext !== undefined && !transport && !inquiry && !product && !allocationContext || (transport || inquiry) && raw?.decisionType !== 'refund_without_return' ||
      allocation && (allocation.terms.settlementKind === 'retain_remaining' ? raw.decisionType !== 'dismissed' : raw.decisionType !== 'refund_without_return'))
    throw new HttpsError('invalid-argument', 'Contexte explicite de remboursement requis.');
  if (raw?.expectedAdminUid !== adminUid || !validDecisionReference(raw?.transactionId) || !validDecisionReference(raw?.expectedDisputeId) ||
      !['refund_without_return', 'dismissed'].includes(raw?.decisionType)) throw new HttpsError('invalid-argument', 'Commande, dossier et type de décision requis.');
  return db.runTransaction(async tx => {
    await operatorSession?.(tx, true);
    const order = (await tx.get(db.collection('transactions').doc(raw.transactionId))).data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    if (resume) assertTransportResumeOpen(order, resume);
    const source = await readCommercialDecisionSource(tx, raw.transactionId, order, raw.expectedDisputeId, transport, !!resume, inquiry ? raw.transportReviewId : undefined,
      product ? raw.productReviewCaseId : undefined, product ? raw.productReviewTopic : 'authenticity', material, parcel, allocation, lateCommercial);
    if (allocation) {
      await transportAdmin(tx, adminUid);
      if (resume) await qualifyRefundAllocationRenewal(tx, raw.transactionId, order, allocation);
      if (!resume && order.refund && !await readSettledAllocationIntent(tx, raw.transactionId, order, order.refund)) throw new HttpsError('failed-precondition', 'Le règlement précédent doit être rapproché.');
    } else if (raw.decisionType !== 'dismissed' && hasPurchaseRefundContext(order)) throw new HttpsError('failed-precondition', 'Une allocation explicite est requise pour cette commande.', {reason: 'purchase_refund_allocation_required'});
    if (product) {
      await transportAdmin(tx, adminUid); if (!source.productReview) throw productFinancialReviewError();
      if (raw.decisionType !== 'dismissed') await productOtherGuards(tx, raw.transactionId, order, !!resume, source.productReview, allocation);
    }
    if (transport) { await transportAdmin(tx, adminUid); await transportOtherGuards(tx, raw.transactionId, order, !!resume, allocation); }
    if (inquiry) { await transportAdmin(tx, adminUid); await inquiryOtherGuards(tx, raw.transactionId, order, source.transportReview!, !!resume, raw.expectedDisputeId, allocation); }
    if (!inquiry && source.target.data().source === 'system_transport_review') throw inquiryReviewError();
    assertNoActiveBankDispute(order);
    if (!transport && !inquiry && source.target.data().status !== 'open' || inquiry && source.target.id !== raw.transportReviewId &&
        source.target.data().status !== 'open' || order.refundedVia === 'chargeback' ||
        !resume && !allocation && raw.decisionType !== 'dismissed' && (order.refund != null || order.refundedAt != null))
      throw new HttpsError('failed-precondition', 'Le dossier ou le mouvement financier ont changé.');
    if (walletOnly && order.paidVia !== 'wallet') throw new HttpsError('failed-precondition', 'Paiement entièrement par porte-monnaie requis.');
    if (allocation?.terms.settlementKind === 'retain_remaining' && source.target.data().source === 'purchase_refund_agreement')
      throw new HttpsError('failed-precondition', 'La décision sans remboursement doit cibler une réclamation native ouverte.');
    const settled = !allocation && raw.decisionType === 'dismissed' && (order.refund != null || order.refundedAt != null)
      ? await readQualifiedSettledRefund(tx, raw.transactionId, order) : null;
    const money = raw.decisionType === 'dismissed' ? settled ?? { totalCents: 0, cardCents: 0, walletCents: 0, sellerDebitCents: 0 }
      : allocation ? {totalCents: allocation.terms.cardCents + allocation.terms.walletCents, cardCents: allocation.terms.cardCents,
        walletCents: allocation.terms.walletCents, sellerDebitCents: allocation.terms.sellerDebitCents} : await amounts(tx, order, raw.transactionId);
    if (resume && (money.cardCents !== order.refund.cardAmountCents || money.walletCents !== order.refund.walletAmountCents ||
        money.sellerDebitCents !== order.refund.sellerDebitCents)) throw transportReviewError();
    const transportExtension = product ? {decisionContext: 'product_review', productReview: source.productReview!.reference,
      productReviewSource: publicProductFinancialSource(source.productReview!)} : source.returnToSender ? { decisionContext: 'return_to_sender_cases',
      returnToSender: publicTransportSource(source.returnToSender) } : source.transportReview ? { decisionContext: 'transport_review',
      transportReview: publicInquiryFinancialSource(source.transportReview) } : allocationContext ? {decisionContext: 'purchase_refund_allocation'} : {};
    const previewParts = [adminUid, raw.transactionId, raw.expectedDisputeId, raw.decisionType, source.sourceHash, money];
    const previewId = digest(resume ? [...previewParts, resume] : previewParts);
    const ref = db.collection('transactions').doc(raw.transactionId).collection('dispute_decisions').doc(`preview_${previewId}`);
    const prior = (await tx.get(ref)).data();
    if (prior && (prior.previewId !== previewId || prior.actorUid !== adminUid || prior.sourceHash !== source.sourceHash))
      throw new HttpsError('unavailable', 'L’aperçu doit être rapproché.');
    await operatorSession?.(tx, true);
    if (!prior) tx.create(ref, { schemaVersion: 1, kind: 'admin_financial_preview_v1', previewId, actorUid: adminUid,
      transactionId: raw.transactionId, expectedDisputeId: raw.expectedDisputeId, decisionType: raw.decisionType,
      ...transportExtension,
      ...(allocation ? {allocation, allocationSource: source.allocation} : {}),
      ...(product ? {productReviewCapture: source.productReview!.capture} : {}),
      ...(resume ? { resume, resumeIntentBasisHash: digest(transportResumeBasis(order, resume)) } : {}),
      sourceHash: source.sourceHash, sourceVersion: 1, currency: 'CAD', ...money,
      ...(settled ? { moneyMovementPlanned: false } : raw.decisionType === 'refund_without_return' ? { moneyMovementPlanned: true } : {}),
      monetaryContext: settled ? 'settled_refund' : 'new_instruction',
      buyerId: order.buyerId, sellerId: order.sellerId, sourceStatus: order.status,
      remainingOpenDisputeIds: source.remainingOpenDisputeIds, retainedObligations: source.retainedObligations,
      inventoryPermissionGranted: false, physicalPossession: 'unknown', bilateralAgreementVerified: allocation ? source.allocation!.bilateralAgreementVerified : false,
      createdAt: FieldValue.serverTimestamp() });
    return { protocol: 'admin_financial_preview_v1', previewId, actorUid: adminUid, transactionId: raw.transactionId,
      expectedDisputeId: raw.expectedDisputeId, decisionType: raw.decisionType, sourceHash: source.sourceHash,
      ...transportExtension,
      ...(allocation ? {allocation, allocationSource: source.allocation} : {}),
      ...(resume ? { resume } : {}),
      sourceVersion: 1, currency: 'CAD', ...money, buyerId: order.buyerId, sellerId: order.sellerId,
      ...(settled ? { moneyMovementPlanned: false } : raw.decisionType === 'refund_without_return' ? { moneyMovementPlanned: true } : {}),
      monetaryContext: settled ? 'settled_refund' : 'new_instruction',
      sourceStatus: order.status, remainingOpenDisputeIds: source.remainingOpenDisputeIds, retainedObligations: source.retainedObligations,
      inventoryPermissionGranted: false, physicalPossession: 'unknown', bilateralAgreementVerified: allocation ? source.allocation!.bilateralAgreementVerified : false };
  }).catch(error => {
    if (inquiry && error instanceof HttpsError && error.code === 'failed-precondition') throw inquiryReviewError();
    if (transport && error instanceof HttpsError && error.code === 'failed-precondition') throw transportReviewError();
    throw error;
  });
}

export async function qualifyAdminDecisionPreview(tx: FirebaseFirestore.Transaction, adminUid: string, transactionId: string,
  expectedDisputeId: string, decisionType: string, previewId: unknown, expectedSourceHash: unknown, order: Data,
  transport?: ReturnToSenderFinancialReference, resume?: RefundDecisionInput['resume'], inquiry?: TransportFinancialReference, product?: ProductFinancialReference, allocation?: RefundAllocationReference) {
  if (!validHash(previewId) || !validHash(expectedSourceHash)) throw new HttpsError('failed-precondition', 'Un nouvel aperçu qualifié est requis.');
  const source = await readCommercialDecisionSource(tx, transactionId, order, expectedDisputeId, !!transport, !!resume, inquiry?.reviewId, product?.caseId, product?.topic, product?.materialCapability === 'product_review_material_v1', product?.parcelCapability === 'product_review_parcel_v1', allocation, product?.lateCommercial);
  const preview = (await tx.get(db.collection('transactions').doc(transactionId).collection('dispute_decisions').doc(`preview_${previewId}`))).data();
  if (!preview || preview.kind !== 'admin_financial_preview_v1' || preview.schemaVersion !== 1 || preview.actorUid !== adminUid ||
      preview.previewId !== previewId || preview.transactionId !== transactionId || preview.expectedDisputeId !== expectedDisputeId ||
      preview.decisionType !== decisionType || preview.sourceHash !== expectedSourceHash || !nativeTime(preview.createdAt) ||
      preview.buyerId !== order.buyerId || preview.sellerId !== order.sellerId || preview.currency !== 'CAD')
    throw new HttpsError('failed-precondition', 'L’aperçu ne correspond pas à cette intention.');
  if (transport ? preview.decisionContext !== 'return_to_sender_cases' || !preview.returnToSender ||
      digest(transportFields(preview.returnToSender)) !== digest(transportFields(transport)) : preview.returnToSender != null)
    throw new HttpsError('failed-precondition', 'La liste et les options ne correspondent pas à l’aperçu examiné.');
  if (digest(preview.resume ?? null) !== digest(resume ?? null)) throw transportReviewError();
  if (digest(preview.allocation ?? null) !== digest(allocation ?? null)) throw new HttpsError('failed-precondition', 'Les termes et plafonds examinés ont changé.');
  if (inquiry ? preview.decisionContext !== 'transport_review' || !preview.transportReview ||
      digest(inquiryFields(preview.transportReview)) !== digest(inquiryFields(inquiry)) : preview.transportReview != null) throw inquiryReviewError();
  if (product ? preview.decisionContext !== 'product_review' || digest(preview.productReview) !== digest(product) ||
      !preview.productReviewCapture || supportSourceHashForProduct(preview.productReviewCapture.corpus) !== product.corpusHash ||
      supportSourceHashForProduct(preview.productReviewCapture.authorization) !== product.authorizationSourceHash : preview.productReview != null)
    throw productFinancialReviewError();
  if (!inquiry && source.target.data().source === 'system_transport_review') throw inquiryReviewError();
  const legacyProductRequired = !product && !transport && !inquiry && await productFinancialContextRequired(tx, transactionId, order);
  const legacyAllocationRequired = !allocation && decisionType === 'refund_without_return' && hasPurchaseRefundContext(order);
  return { source, preview, ...(legacyProductRequired ? {refusalSourceHash: digest(['product_financial_context_required', source.sourceHash])} : {}),
    current: !legacyProductRequired && !legacyAllocationRequired && source.sourceHash === expectedSourceHash && (transport ? !!source.returnToSender &&
    digest(transportFields(source.returnToSender)) === digest(transportFields(transport)) : inquiry ? !!source.transportReview &&
      digest(inquiryFields(source.transportReview)) === digest(inquiryFields(inquiry)) : product ? !!source.productReview &&
      productFinancialReferenceCurrent(source.productReview.reference, product) && source.target.data().status === 'open' : source.target.data().status === 'open') };
}

/** Read-only native result, never resumes provider IO nor borrows another actor. */
export async function readAdminRefundDecision(tx: FirebaseFirestore.Transaction, input: RefundDecisionInput, order: Data) {
  const decisionId = refundDecisionId(input), decision = (await tx.get(refundDecisionRef(input))).data();
  if (!decision) return { protocol: 'admin_financial_decision_v1', outcome: 'unrecorded', transactionId: input.transactionId,
    actorUid: input.adminUid, requestId: input.requestId, decisionId, payloadHash: refundDecisionPayload(input),
    expectedDisputeId: input.expectedDisputeId, previewId: input.previewId, sourceHash: input.expectedSourceHash,
    note: input.note, decisionType: input.decisionType, currency: 'CAD', totalCents: input.expectedTotalCents,
    ...(input.returnToSender ? { returnToSender: input.returnToSender } : {}),
    ...(input.transportReview ? { transportReview: input.transportReview } : {}),
    ...(input.productReview ? {productReview: input.productReview} : {}),
    ...(input.allocation ? {allocation: input.allocation} : {}),
    ...(input.resume ? { resume: input.resume } : {}),
    cardCents: input.expectedCardCents, walletCents: input.expectedWalletCents, sellerDebitCents: input.expectedSellerDebitCents,
    inventoryPermissionGranted: false, physicalPossession: 'unknown', bilateralAgreementVerified: false,
    decisionCommitted: false, effectsCommitted: false, intentionNeutralized: false, lateRequestBlocked: false,
    retryPermissionGranted: false };
  if (decision.kind !== 'admin_financial_decision_v1' || decision.schemaVersion !== 1 || decision.decisionId !== decisionId ||
      decision.payloadHash !== refundDecisionPayload(input) || decision.actorUid !== input.adminUid || decision.requestId !== input.requestId ||
      decision.transactionId !== input.transactionId || decision.expectedDisputeId !== input.expectedDisputeId ||
      decision.previewId !== input.previewId || decision.sourceHash !== input.expectedSourceHash ||
      decision.decisionType !== input.decisionType || decision.note !== input.note || decision.currency !== 'CAD' ||
      digest(decision.returnToSender ?? null) !== digest(input.returnToSender ?? null) ||
      digest(decision.transportReview ?? null) !== digest(input.transportReview ?? null) ||
      digest(decision.productReview ?? null) !== digest(input.productReview ?? null) ||
      digest(decision.allocation ?? null) !== digest(input.allocation ?? null) ||
      digest(decision.resume ?? null) !== digest(input.resume ?? null) ||
      decision.totalCents !== input.expectedTotalCents || decision.cardCents !== input.expectedCardCents ||
      decision.walletCents !== input.expectedWalletCents || decision.sellerDebitCents !== input.expectedSellerDebitCents ||
      decision.inventoryPermissionGranted !== false || decision.physicalPossession !== 'unknown' ||
      (input.allocation ? typeof decision.bilateralAgreementVerified !== 'boolean' : decision.bilateralAgreementVerified !== false) ||
      !validDecisionUid(decision.buyerId) || !validDecisionUid(decision.sellerId) || decision.buyerId === decision.sellerId ||
      decision.buyerId !== order.buyerId || decision.sellerId !== order.sellerId || !nativeTime(decision.committedAt))
    throw new HttpsError('unavailable', 'Le reçu original de cette intention doit être rapproché.');
  const common = { protocol: 'admin_financial_decision_v1', transactionId: input.transactionId, actorUid: input.adminUid,
    requestId: input.requestId, decisionId, payloadHash: decision.payloadHash, expectedDisputeId: input.expectedDisputeId,
    previewId: input.previewId, sourceHash: input.expectedSourceHash, note: input.note, decisionType: input.decisionType,
    ...(input.returnToSender ? { returnToSender: input.returnToSender } : {}),
    ...(input.transportReview ? { transportReview: input.transportReview } : {}),
    ...(input.productReview ? {productReview: input.productReview} : {}),
    ...(input.allocation ? {allocation: input.allocation} : {}),
    ...(input.resume ? { resume: input.resume } : {}),
    currency: 'CAD', totalCents: input.expectedTotalCents, cardCents: input.expectedCardCents, walletCents: input.expectedWalletCents,
    sellerDebitCents: input.expectedSellerDebitCents, buyerId: decision.buyerId, sellerId: decision.sellerId,
    inventoryPermissionGranted: false, physicalPossession: 'unknown', bilateralAgreementVerified: input.allocation ? decision.bilateralAgreementVerified : false,
    committedAt: decision.committedAt.toDate().toISOString() };
  if (decision.outcome === 'not_executed') {
    const explicitlyNeutralized = (decision.reason === 'intention_neutralized_before_effects' || input.allocation && decision.reason === 'allocation_sources_unqualified') &&
      decision.sourceExamined === false && decision.observedSourceHash === null;
    const changedSource = ['source_changed', 'another_refund_reserved'].includes(decision.reason) && validHash(decision.observedSourceHash);
    if (decision.effectsCommitted !== false || decision.intentionNeutralized !== true || decision.lateRequestBlocked !== true ||
        (!explicitlyNeutralized && !changedSource) || decision.refundIntentId !== null)
      throw new HttpsError('unavailable', 'La non-exécution de cette intention doit être rapprochée.');
    return { ...common, outcome: 'not_executed', decisionCommitted: false, effectsCommitted: false,
      intentionNeutralized: true, lateRequestBlocked: true, nonExecutionQualified: true, retryPermissionGranted: false,
      reason: decision.reason, observedSourceHash: decision.observedSourceHash,
      ...(explicitlyNeutralized ? { sourceExamined: false } : {}) };
  }
  const intent = input.allocation && order.refund?.intentId !== decision.refundIntentId
    ? await readAllocationHistoryIntent(tx, input.transactionId, order, decision.refundIntentId) : order.refund;
  const associationQualified = input.resume ? intent?.intentId === input.resume.refundIntentId && intent.attemptId === input.resume.refundAttemptId &&
    await readTransportResumeAssociation(tx, input, {...order, refund: intent}, decision) :
    intent?.commercialDecision?.decisionId === decisionId && intent.commercialDecision.payloadHash === decision.payloadHash &&
    digest(intent.commercialDecision.returnToSender ?? null) === digest(input.returnToSender ?? null) &&
    digest(intent.commercialDecision.transportReview ?? null) === digest(input.transportReview ?? null) &&
    digest(intent.commercialDecision.productReview ?? null) === digest(input.productReview ?? null) &&
    digest(intent.commercialDecision.allocation ?? null) === digest(input.allocation ?? null) && intent.actor?.uid === input.adminUid;
  if (decision.outcome !== 'reserved' || !intent || intent.intentId !== decision.refundIntentId || !associationQualified ||
      intent.cardAmountCents !== input.expectedCardCents || intent.walletAmountCents !== input.expectedWalletCents ||
      intent.sellerDebitCents !== input.expectedSellerDebitCents || intent.relistArticle !== false)
    throw new HttpsError('unavailable', 'La réservation financière et cette décision doivent être rapprochées.');
  const financial = refundResult(intent);
  if (financial.success) {
    if (!nativeTime(intent.fundsAppliedAt) || input.expectedCardCents > 0 &&
        (intent.providerStatus !== 'succeeded' || intent.cardConfirmedCents !== input.expectedCardCents ||
          !/^re_[A-Za-z0-9_]+$/.test(intent.stripeRefundId ?? '')))
      throw new HttpsError('unavailable', 'Le règlement de cette réservation doit être rapproché.');
    if (input.expectedWalletCents > 0) {
      const credit = (await tx.get(db.collection('wallets').doc(decision.buyerId).collection('ledger').doc(`refund_credit_${intent.intentId}`))).data();
      if (credit?.type !== 'refund_credit' || credit.transactionId !== input.transactionId || credit.refundIntentId !== intent.intentId ||
          credit.amount !== input.expectedWalletCents || !nonnegativeCents(credit.balanceAfter) || !nativeTime(credit.createdAt))
        throw new HttpsError('unavailable', 'Le crédit de cette réservation doit être rapproché.');
    }
    if (input.expectedSellerDebitCents > 0) {
      const debit = (await tx.get(db.collection('wallets').doc(decision.sellerId).collection('ledger').doc(`refund_debit_${intent.intentId}`))).data();
      if (debit?.type !== 'refund_debit' || debit.transactionId !== input.transactionId || debit.refundIntentId !== intent.intentId ||
          !nonnegativeCents(debit.amount) || !nonnegativeCents(debit.debtRecorded) ||
          debit.amount + debit.debtRecorded !== input.expectedSellerDebitCents || !nonnegativeCents(debit.balanceAfter) || !nativeTime(debit.createdAt))
        throw new HttpsError('unavailable', 'Le débit et la dette de cette réservation doivent être rapprochés.');
    }
  }
  return { ...common, outcome: 'reserved', decisionCommitted: true, effectsCommitted: true, intentionNeutralized: false,
    lateRequestBlocked: false, refundIntentId: intent.intentId, financial,
    disputesClosed: Number.isSafeInteger(intent.commercialCasesClosed) ? intent.commercialCasesClosed : 0,
    remainingOpenDisputeIds: Array.isArray(intent.remainingOpenDisputeIds) ? intent.remainingOpenDisputeIds : decision.remainingOpenDisputeIds,
    retainedObligations: decision.retainedObligations, manualCorrectionRequired: true };
}

/** Neutralizes only the caller's exact still-unrecorded intention. Reading and
 * creating the same decision document serializes with the financial reserve. */
export async function neutralizeAdminRefundDecision(input: RefundDecisionInput, walletOnly = false, allocationSourceRefused = false,
  operatorSession?: (tx?: FirebaseFirestore.Transaction, newEffect?: boolean) => Promise<unknown>) {
  const orderRef = db.collection('transactions').doc(input.transactionId);
  await db.runTransaction(async tx => {
    await operatorSession?.(tx);
    const order = (await tx.get(orderRef)).data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    if (walletOnly && order.paidVia !== 'wallet') throw new HttpsError('failed-precondition', 'Paiement entièrement par porte-monnaie requis.');
    const own = await readAdminRefundDecision(tx, input, order);
    if (own.outcome !== 'unrecorded') return;
    await qualifyOwnProductDecisionPreview(tx, input);
    const decisionId = refundDecisionId(input);
    if (!validDecisionUid(order.buyerId) || !validDecisionUid(order.sellerId) || order.buyerId === order.sellerId ||
        order.refund?.commercialDecision?.decisionId === decisionId || order.refund?.idempotencyKey === `rf_decision_${decisionId}`)
      throw new HttpsError('unavailable', 'Le reçu et l’éventuelle réservation de cette intention doivent être rapprochés.');
    await operatorSession?.(tx);
    tx.create(refundDecisionRef(input), { schemaVersion: 1, kind: 'admin_financial_decision_v1', decisionId,
      transactionId: input.transactionId, expectedDisputeId: input.expectedDisputeId, requestId: input.requestId,
      actorUid: input.adminUid, payloadHash: refundDecisionPayload(input), previewId: input.previewId,
      sourceHash: input.expectedSourceHash, decisionType: input.decisionType, note: input.note, currency: 'CAD',
      ...(input.returnToSender ? { returnToSender: input.returnToSender } : {}),
      ...(input.transportReview ? { transportReview: input.transportReview } : {}),
    ...(input.productReview ? {productReview: input.productReview} : {}),
      ...(input.allocation ? {allocation: input.allocation} : {}),
      ...(input.resume ? { resume: input.resume } : {}),
      buyerId: order.buyerId, sellerId: order.sellerId, totalCents: input.expectedTotalCents,
      cardCents: input.expectedCardCents, walletCents: input.expectedWalletCents, sellerDebitCents: input.expectedSellerDebitCents,
      inventoryPermissionGranted: false, physicalPossession: 'unknown', bilateralAgreementVerified: false,
      outcome: 'not_executed', effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true,
      refundIntentId: null, reason: allocationSourceRefused && input.allocation ? 'allocation_sources_unqualified' : 'intention_neutralized_before_effects', sourceExamined: false, observedSourceHash: null,
      committedAt: FieldValue.serverTimestamp() });
  });
  return db.runTransaction(async tx => {
    await operatorSession?.(tx);
    const order = (await tx.get(orderRef)).data();
    if (!order) throw new HttpsError('unavailable', 'La commande et le reçu doivent être retrouvés.');
    const own = await readAdminRefundDecision(tx, input, order);
    if (own.outcome === 'unrecorded') throw new HttpsError('unavailable', 'Le reçu de cette intention doit être retrouvé.');
    return own;
  });
}

/** Pure native discovery. A qualified original tuple is not a permission to
 * send money; a fresh complete preview and human instruction remain required. */
export async function readAdminTransportResumeSource(adminUid: string, transactionId: string, product = false, material = false, topic: ProductFinancialReference['topic'] = 'authenticity', parcel = false) {
  return db.runTransaction(async tx => {
    await transportAdmin(tx, adminUid);
    const snap = await tx.get(db.collection('transactions').doc(transactionId)), order = snap.data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    let resume: RefundDecisionInput['resume'] | null = null, financial: ReturnType<typeof refundResult> | null = null;
    try {
      const reference = parseTransportResume({ refundIntentId: order.refund?.intentId, refundAttemptId: order.refund?.attemptId });
      transportResumeBasis(order, reference);
      if (order.refund.fundsAppliedAt != null || order.refund.state === 'succeeded') await readQualifiedSettledRefund(tx, transactionId, order);
      resume = reference; financial = refundResult(order.refund);
    } catch (error) {
      if (!(error instanceof HttpsError) || !['invalid-argument', 'failed-precondition'].includes(error.code)) throw error;
    }
    return { protocol: product ? 'admin_product_review_resume_source_v1' : 'admin_return_to_sender_resume_source_v1', actorUid: adminUid, transactionId,
      ...(product ? {productReviewCaseId: productReviewCaseId({kind: 'order', id: transactionId}), productReviewTopic: topic, ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {}), authenticityVerified: false, expertiseVerified: false} : {}),
      sourceRevision: snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null,
      qualification: resume ? 'qualified' : 'review_required', resume,
      sourceStatus: typeof order.status === 'string' ? order.status : null, financial,
      options: resume ? { refundScope: 'full_original_payment', relistArticle: false, extraSellerDebitCents: 0, returnCostDeductionCents: 0 } : null,
      inventoryPermissionGranted: false, physicalPossession: 'unknown', newRefundPermissionGranted: false, bankArrivalVerified: false };
  });
}

/** Append a human authorization to the SAME intent. Neither its money, key,
 * attempt, original decision, holds nor historical effects are replaced. */
export async function authorizeAdminTransportResume(input: RefundDecisionInput, operatorAuthTime: number, providerEffectObserved: boolean,
  operatorSession?: (tx?: FirebaseFirestore.Transaction, newEffect?: boolean) => Promise<unknown>) {
  if (!input.resume || !input.returnToSender && !input.transportReview && !input.productReview && !input.allocation) throw new HttpsError('invalid-argument', 'Reprise exacte requise.');
  const ref = db.collection('transactions').doc(input.transactionId);
  await db.runTransaction(async tx => {
    await operatorSession?.(tx);
    const order = (await tx.get(ref)).data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    const own = await readAdminRefundDecision(tx, input, order);
    if (own.outcome !== 'unrecorded') return;
    await operatorSession?.(tx, true);
    const native = { schemaVersion: 1, kind: 'admin_financial_decision_v1', decisionId: refundDecisionId(input),
      transactionId: input.transactionId, expectedDisputeId: input.expectedDisputeId, requestId: input.requestId, actorUid: input.adminUid,
      payloadHash: refundDecisionPayload(input), note: input.note, previewId: input.previewId, sourceHash: input.expectedSourceHash,
      decisionType: input.decisionType, buyerId: order.buyerId, sellerId: order.sellerId, currency: 'CAD',
      ...(input.returnToSender ? { returnToSender: input.returnToSender } : {}),
      ...(input.transportReview ? { transportReview: input.transportReview } : {}),
    ...(input.productReview ? {productReview: input.productReview} : {}), ...(input.allocation ? {allocation: input.allocation} : {}), resume: input.resume,
      totalCents: input.expectedTotalCents, cardCents: input.expectedCardCents, walletCents: input.expectedWalletCents,
      sellerDebitCents: input.expectedSellerDebitCents, inventoryPermissionGranted: false, physicalPossession: 'unknown',
      bilateralAgreementVerified: false, committedAt: FieldValue.serverTimestamp() };
    const reject = (observedSourceHash: string) => tx.create(refundDecisionRef(input), { ...native, outcome: 'not_executed',
      effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true, refundIntentId: null,
      reason: 'source_changed', observedSourceHash });
    // A real provider record found by the exact lookup is serviced first. It
    // cannot be converted into another authorization or a proof of absence.
    if (providerEffectObserved) { reject(digest(order)); return; }
    if (input.productReview?.materialCapability === 'product_review_material_v1' && !PRODUCT_MATERIAL_REVIEW_ENABLED || input.productReview?.parcelCapability === 'product_review_parcel_v1' && !PRODUCT_PARCEL_REVIEW_ENABLED) throw productFinancialReviewError();
    if (input.productReview) await transportAdmin(tx, input.adminUid);
    const qualified = await qualifyAdminDecisionPreview(tx, input.adminUid, input.transactionId, input.expectedDisputeId,
      input.decisionType, input.previewId, input.expectedSourceHash, order, input.returnToSender, input.resume, input.transportReview, input.productReview, input.allocation);
    if (!qualified.current) { reject(qualified.refusalSourceHash ?? qualified.source.sourceHash); return; }
    if (input.productReview) await productOtherGuards(tx, input.transactionId, order, true, qualified.source.productReview, input.allocation);
    assertTransportResumeOpen(order, input.resume!);
    const basis = transportResumeBasis(order, input.resume!), basisHash = digest(basis);
    const allocationRenewal = input.allocation ? await qualifyRefundAllocationRenewal(tx, input.transactionId, order, input.allocation) : null;
    const money = input.allocation ? {totalCents: input.expectedTotalCents, cardCents: input.allocation.terms.cardCents,
      walletCents: input.allocation.terms.walletCents, sellerDebitCents: input.allocation.terms.sellerDebitCents} : await amounts(tx, order, input.transactionId);
    if (qualified.preview.resumeIntentBasisHash !== basisHash || !recentOperatorAuthentication(operatorAuthTime) ||
        money.totalCents !== input.expectedTotalCents || money.cardCents !== input.expectedCardCents ||
        money.walletCents !== input.expectedWalletCents || money.sellerDebitCents !== input.expectedSellerDebitCents ||
        order.refund.cardAmountCents !== input.expectedCardCents || order.refund.walletAmountCents !== input.expectedWalletCents ||
        order.refund.sellerDebitCents !== input.expectedSellerDebitCents) throw transportReviewError();
    await transportAdmin(tx, input.adminUid);
    if (input.transportReview) await inquiryOtherGuards(tx, input.transactionId, order, qualified.source.transportReview!, true, input.expectedDisputeId);
    else if (!input.productReview && !input.allocation) await transportOtherGuards(tx, input.transactionId, order, true);
    const authorization = { schemaVersion: 1, decisionId: native.decisionId, payloadHash: native.payloadHash, actorUid: input.adminUid,
      requestId: input.requestId, expectedDisputeId: input.expectedDisputeId, sourceHash: input.expectedSourceHash,
      decisionType: input.decisionType, note: input.note, buyerId: order.buyerId, sellerId: order.sellerId,
      ...(input.returnToSender ? { returnToSender: input.returnToSender } : {}),
      ...(input.transportReview ? { transportReview: input.transportReview } : {}),
    ...(input.productReview ? {productReview: input.productReview} : {}),
      ...(input.allocation ? {allocation: input.allocation, sourceContextHash: allocationRenewal!.sourceContextHash} : {}), resume: input.resume, operatorAuthTime,
      inventoryPermissionGranted: false, physicalPossession: 'unknown' };
    await operatorSession?.(tx, true);
    tx.create(refundDecisionRef(input), { ...native, ...(allocationRenewal ? {bilateralAgreementVerified: allocationRenewal.bilateralAgreementVerified} : {}),
      resumeIntentBasis: basis, resumeIntentBasisHash: basisHash, outcome: 'reserved', effectsCommitted: true,
      refundIntentId: input.resume!.refundIntentId, remainingOpenDisputeIds: qualified.source.remainingOpenDisputeIds,
      retainedObligations: qualified.source.retainedObligations });
    tx.update(ref, { [input.productReview ? 'refund.productReviewAuthorization' : input.transportReview ? 'refund.transportReviewAuthorization' : input.allocation ? 'refund.purchaseRefundAuthorization' : 'refund.returnToSenderAuthorization']: authorization,
      ...(input.allocation ? {'refund.purchaseRefundAuthorization': authorization} : {}), 'refund.state': 'requested',
      'refund.leaseOwner': null, 'refund.leaseUntilMs': 0, refundBlocked: true, status: 'refund_in_progress' });
  });
  return db.runTransaction(async tx => {
    await operatorSession?.(tx);
    const order = (await tx.get(ref)).data();
    if (!order) throw new HttpsError('unavailable', 'Le reçu original doit être retrouvé.');
    return readAdminRefundDecision(tx, input, order);
  });
}

/** Called inside refund.reserve, before its first mutation. */
export async function reserveAdminRefundDecision(tx: FirebaseFirestore.Transaction, input: RefundDecisionInput, order: Data,
  intentId: string, money: { cardAmountCents: number; walletAmountCents: number; sellerDebitCents: number }, operatorAuthTime?: number,
  operatorSession?: (tx?: FirebaseFirestore.Transaction, newEffect?: boolean) => Promise<unknown>) {
  await operatorSession?.(tx, true);
  if (input.productReview) {
    if (input.productReview.materialCapability === 'product_review_material_v1' && !PRODUCT_MATERIAL_REVIEW_ENABLED || input.productReview.parcelCapability === 'product_review_parcel_v1' && !PRODUCT_PARCEL_REVIEW_ENABLED) throw productFinancialReviewError();
    await transportAdmin(tx, input.adminUid);
    if (!recentOperatorAuthentication(operatorAuthTime)) throw productFinancialReviewError();
  }
  const qualified = await qualifyAdminDecisionPreview(tx, input.adminUid, input.transactionId, input.expectedDisputeId,
    input.decisionType, input.previewId, input.expectedSourceHash, order, input.returnToSender, undefined, input.transportReview, input.productReview, input.allocation);
  const preview = qualified.preview;
  if (preview.totalCents !== input.expectedTotalCents || preview.cardCents !== input.expectedCardCents ||
      preview.walletCents !== input.expectedWalletCents || preview.sellerDebitCents !== input.expectedSellerDebitCents)
    throw new HttpsError('failed-precondition', 'Les montants ne correspondent pas à l’aperçu.');
  const decisionId = refundDecisionId(input);
  const native = { schemaVersion: 1, kind: 'admin_financial_decision_v1', decisionId, transactionId: input.transactionId,
    expectedDisputeId: input.expectedDisputeId, requestId: input.requestId, actorUid: input.adminUid,
    payloadHash: refundDecisionPayload(input), note: input.note, previewId: input.previewId, sourceHash: input.expectedSourceHash,
    decisionType: input.decisionType, buyerId: order.buyerId, sellerId: order.sellerId, currency: 'CAD',
    ...(input.returnToSender ? { returnToSender: input.returnToSender } : {}),
    ...(input.transportReview ? { transportReview: input.transportReview } : {}),
    ...(input.productReview ? {productReview: input.productReview} : {}),
    ...(input.allocation ? {allocation: input.allocation} : {}),
    totalCents: input.expectedTotalCents, cardCents: input.expectedCardCents, walletCents: input.expectedWalletCents,
    sellerDebitCents: input.expectedSellerDebitCents, inventoryPermissionGranted: false, physicalPossession: 'unknown',
    bilateralAgreementVerified: input.allocation ? qualified.source.allocation!.bilateralAgreementVerified : false, committedAt: FieldValue.serverTimestamp() };
  const notExecuted = !qualified.current || !input.allocation && (order.refund != null || order.refundedAt != null) || order.refundedVia === 'chargeback';
  if (notExecuted) return { permitted: false as const, commit: () => tx.create(refundDecisionRef(input), { ...native,
    outcome: 'not_executed', effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true, refundIntentId: null,
    reason: order.refund != null ? 'another_refund_reserved' : 'source_changed', observedSourceHash: qualified.refusalSourceHash ?? qualified.source.sourceHash }) };
  if (money.cardAmountCents !== input.expectedCardCents || money.walletAmountCents !== input.expectedWalletCents ||
      money.sellerDebitCents !== input.expectedSellerDebitCents || money.cardAmountCents + money.walletAmountCents !== input.expectedTotalCents)
    throw new HttpsError('failed-precondition', 'Le paiement courant ne correspond plus aux montants examinés.');
  const allocation = input.allocation ? await prepareRefundAllocationReservation(tx, input.transactionId, order, input.allocation, intentId, decisionId, input.adminUid) : null;
  if (allocation) {
    await transportAdmin(tx, input.adminUid);
    if (!recentOperatorAuthentication(operatorAuthTime)) throw new HttpsError('permission-denied', 'Réauthentification financière récente requise.');
    assertNoActiveBankDispute(order);
    if (!await fraudReviewAllowsProgress(tx, input.transactionId, order)) throw new HttpsError('failed-precondition', 'La revue du paiement reste nécessaire.');
  }
  if (input.returnToSender || input.transportReview || input.productReview) {
    if (!Number.isSafeInteger(operatorAuthTime) || (operatorAuthTime as number) < 1) throw transportReviewError();
    await transportAdmin(tx, input.adminUid);
    if (input.productReview) await productOtherGuards(tx, input.transactionId, order, false, qualified.source.productReview, input.allocation);
    if (input.transportReview) await inquiryOtherGuards(tx, input.transactionId, order, qualified.source.transportReview!, false, input.expectedDisputeId, input.allocation);
    else if (!input.productReview) await transportOtherGuards(tx, input.transactionId, order, false, input.allocation);
    const currentMoney = input.allocation ? {totalCents: input.expectedTotalCents, cardCents: input.allocation.terms.cardCents,
      walletCents: input.allocation.terms.walletCents, sellerDebitCents: input.allocation.terms.sellerDebitCents} : await amounts(tx, order, input.transactionId);
    if (currentMoney.totalCents !== input.expectedTotalCents || currentMoney.cardCents !== input.expectedCardCents ||
        currentMoney.walletCents !== input.expectedWalletCents || currentMoney.sellerDebitCents !== input.expectedSellerDebitCents)
      throw transportReviewError();
  }
  const provenance = { schemaVersion: 1, decisionId, payloadHash: native.payloadHash, actorUid: input.adminUid,
    requestId: input.requestId, expectedDisputeId: input.expectedDisputeId, sourceHash: input.expectedSourceHash,
    decisionType: input.decisionType, note: input.note, buyerId: order.buyerId, sellerId: order.sellerId,
    targetCreatedAt: input.returnToSender ? qualified.source.target.data().recordedAt : qualified.source.target.data().createdAt,
    targetHash: digest(qualified.source.target.data()),
    ...(input.returnToSender ? { returnToSender: input.returnToSender, operatorAuthTime } : {}),
    ...(input.transportReview ? { transportReview: input.transportReview, operatorAuthTime } : {}),
    ...(input.productReview ? {productReview: input.productReview, operatorAuthTime} : {}),
    ...(input.allocation ? {allocation: input.allocation, operatorAuthTime, targetKind: input.allocation.convenienceReturn ? 'convenience_return' :
      qualified.source.target.data().source === 'purchase_refund_agreement' ? 'agreement' : 'claim'} : {}),
    physicalPossession: 'unknown', inventoryPermissionGranted: false };
  return { permitted: true as const, provenance, ...(allocation ? {allocation} : {}), commit: () => {
    tx.create(refundDecisionRef(input), { ...native, outcome: 'reserved', effectsCommitted: true, refundIntentId: intentId,
      remainingOpenDisputeIds: qualified.source.remainingOpenDisputeIds, retainedObligations: qualified.source.retainedObligations });
    allocation?.commit();
  }};
}

export const commercialClaimHash = (claim: Data) => digest(claim);
/** Only a native preview created for this SDK actor registers an uncommitted
 * product tuple. This read supplies no present business/source permission. */
export async function qualifyOwnProductDecisionPreview(tx: FirebaseFirestore.Transaction, input: {
  transactionId: string; expectedDisputeId: string; adminUid: string; previewId?: string; expectedSourceHash?: string;
  productReview?: ProductFinancialReference; allocation?: RefundAllocationReference; decisionType?: string }) {
  if (!input.productReview && !input.allocation) return;
  const preview = (await tx.get(db.collection('transactions').doc(input.transactionId).collection('dispute_decisions').doc(`preview_${input.previewId}`))).data();
  if (input.allocation && (!preview || preview.kind !== 'admin_financial_preview_v1' || preview.actorUid !== input.adminUid ||
      preview.transactionId !== input.transactionId || preview.expectedDisputeId !== input.expectedDisputeId || preview.previewId !== input.previewId ||
      preview.sourceHash !== input.expectedSourceHash || digest(preview.allocation) !== digest(input.allocation) || !nativeTime(preview.createdAt)))
    throw new HttpsError('permission-denied', 'L’aperçu propre exact de cette allocation est requis.');
  if (!input.productReview) return;
  if (!preview || preview.kind !== 'admin_financial_preview_v1' || preview.schemaVersion !== 1 || preview.actorUid !== input.adminUid ||
      preview.transactionId !== input.transactionId || preview.expectedDisputeId !== input.expectedDisputeId || preview.previewId !== input.previewId ||
      preview.sourceHash !== input.expectedSourceHash || preview.decisionContext !== 'product_review' ||
      preview.decisionType !== (input.decisionType ?? 'dismissed') || !nativeTime(preview.createdAt) ||
      digest(preview.productReview) !== digest(input.productReview) ||
      !preview.productReviewCapture || supportSourceHashForProduct(preview.productReviewCapture.corpus) !== input.productReview.corpusHash ||
      supportSourceHashForProduct(preview.productReviewCapture.authorization) !== input.productReview.authorizationSourceHash)
    throw new HttpsError('permission-denied', 'Seul votre tuple produit déjà enregistré peut être observé ou neutralisé.');
}
export async function assertProductFinancialOperator(tx: FirebaseFirestore.Transaction, uid: string) {await transportAdmin(tx, uid);}
