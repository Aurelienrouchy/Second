import {providerSecretsForDeployment} from '../../config/phase1Deployment';
import {handleOrphanCaptureRefund,ORPHAN_CAPTURE_REFUND_CAPABILITY} from '../../utils/orphanCaptureRefund';
import {financialRecoverySourceFields} from "../../utils/financialRecoverySources";
import {cancelLocalMeetup} from '../../utils/localMeetupCancellation';
import { FinancialRecoveryBlocked } from "../../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../../utils/financialRecoverySources";
import { financialRecoveryWalletFields } from "../../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
import {BANK_CASE_CAPABILITY,handleBankDisputeCase} from '../../utils/bankDisputeCase';
import {BANK_FINANCIAL_RECONCILIATION_CAPABILITY,handleBankFinancialReconciliation} from '../../utils/bankFinancialReconciliation';
import {productRoutingAllowsRelease} from '../../utils/productRoutingReview';
import {productMixedOrderAllowsRelease} from '../../utils/productMixedOrders';
import {productParcelRequested, PRODUCT_PARCEL_REVIEW_ENABLED} from '../../utils/productReviewParcel';
import { inspectPaymentCaptureAnomalyProof } from '../../utils/paymentCaptureAnomaly';
import { articleReleaseUpdate, commitArticleRelease } from '../../utils/articleReservation';
import { inventoryEngagementMatches, planInventoryAcquire, type InventoryPlan } from '../../utils/inventoryUnit';
/**
 * Paiement — Litiges, remboursements et annulations.
 *
 * Éclaté depuis functions/src/callable/payments.ts (3881 lignes).
 * `callable/payments.ts` reste la façade : index.ts et sweepPendingLabels
 * importent depuis là, inchangés.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../../utils/privateAccountSession';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../../config/firebase';
import { getStripe } from '../../config/stripe';
import { checkRateLimit, resolveCallerKey } from '../../utils/rateLimit';
import { issueTransactionRefund, retryPurchaseRefundAfterFailure, readPendingCancellationFunds,
  readPendingCancellationReceipt, resumeTransactionRefund, observeRefundBeforeTransportResume } from '../../utils/refund';
import { prepareOperationalNotices, readOperationalNoticeReceipt,
  type OperationalNoticeInput } from '../../utils/notifications';
import { captureServerEvent } from '../../lib/analytics';
import { RATE_LIMIT_WINDOW_MS } from './feeReduction';
import { assertNoActiveBankDispute } from '../../utils/bankDispute';
import { assertNoUnsettledRefund, refundResult } from '../../utils/refundState';
import { prepareAdminDecisionPreview, parseRefundDecisionInput, readAdminRefundDecision, refundDecisionId,
  validDecisionReference, validDecisionUid, qualifyAdminDecisionPreview, readQualifiedSettledRefund, neutralizeAdminRefundDecision,
  readCommercialDecisionSource, readAdminTransportResumeSource, authorizeAdminTransportResume, qualifyOwnProductDecisionPreview,
  assertProductFinancialOperator } from '../../utils/refundDecision';
import { deliveryCorrectionBlocksProgress, orderModerationAllowsProgress } from '../../utils/orderModeration';
import { fraudReviewAllowsProgress } from '../../utils/fraudReviewDecision';
import { hasUnsettledReturnRequest } from '../../utils/returnRequest';
import { cashReservationWasReleased, cashDigest, cashHash } from '../../utils/cashMeetup';
import { supportCurrentAdminSession, supportAdmin, supportHash } from '../../utils/supportRequest';
import { assertRecentAccountAuthentication, assertAccountSecurityOpen } from '../../utils/eligibility';
import {parseProductFinancialReference, type ProductFinancialReference} from '../../utils/productReviewFinancial';
import {PRODUCT_MATERIAL_REVIEW_ENABLED} from '../../utils/productReviewMaterial';
import {recordSellerCancellationLabelStop} from '../../utils/labelLifecycle';
import {purchasePolicyAllowsRelease} from '../../utils/purchasePolicy';
import {purchaseRefundModes, handlePurchaseRefundAgreement, PURCHASE_REFUND_ENABLED, parseRefundAllocation, hasPurchaseRefundContext,
  purchaseRefundCaseDisposition, readSettledAllocationIntent, type RefundAllocationReference} from '../../utils/refundAllocation';
import {purchaseRefundRepairModes, handlePurchaseRefundRepair} from '../../utils/refundRepair';
import {EXCEPTIONAL_RESTITUTION_CAPABILITY,handleExceptionalRestitution} from '../../utils/exceptionalRestitution';

/** Shared admin contract for card, mixed and wallet-only refunds. */
export async function executeAdminRefundRequest(adminUid: string, raw: any, walletOnly = false, sessionRequest?: any) {
  if (sessionRequest?.auth?.uid !== adminUid) throw new HttpsError('unauthenticated', 'Session opérateur actuelle requise.');
  return withPrivateAccountSession(sessionRequest, async () => {
  // Ephemeral checks are never serialized into the original financial intent.
  // Reading one's exact receipt needs a current session, not a renewed role.
  const operatorSession = async (tx?: FirebaseFirestore.Transaction, newEffect = false): Promise<void> => {
    if (newEffect && !tx) return db.runTransaction(current => operatorSession(current, true));
    const current = await assertPrivateAccountSession(sessionRequest, tx);
    if (newEffect) await supportAdmin(tx!, adminUid, current.currentAdminClaim);
  };
  if (raw?.expectedAdminUid !== adminUid || !validDecisionReference(raw?.transactionId))
    throw new HttpsError('invalid-argument', 'Compte administrateur et commande requis.');
  const resuming = ['resume_preview', 'resume_confirm', 'resume_observe', 'resume_neutralize'].includes(raw?.mode);
  const inquiry = raw?.decisionContext === 'transport_review' || raw?.transportReview !== undefined;
  const inquiryJournal = raw?.transportReview !== undefined &&
    ['confirm', 'observe', 'neutralize', 'resume_confirm', 'resume_observe', 'resume_neutralize'].includes(raw?.mode);
  const product = raw?.decisionContext === 'product_review' || raw?.productReview !== undefined;
  const allocation = raw?.allocation !== undefined || raw?.decisionContext === 'purchase_refund_allocation';
  if (allocation && raw?.capability !== 'purchase_refund_v1' && raw?.allocationCapability !== 'purchase_refund_v1') throw new HttpsError('invalid-argument', 'Version d’allocation explicite requise.');
  const material = raw?.materialCapability === 'product_review_material_v1', parcel = productParcelRequested(raw);
  if (raw?.materialCapability !== undefined && !material || raw?.productReview?.topic === 'nonconformity' && !material ||
      material && !product || raw?.productReview && (raw.productReview.materialCapability === 'product_review_material_v1') !== material)
    throw new HttpsError('invalid-argument', 'Version et dossier matériels explicites requis.');
  if (parcel && (!product || raw.productReview && raw.productReview.parcelCapability !== 'product_review_parcel_v1') || raw.productReview?.parcelCapability && !parcel) throw new HttpsError('invalid-argument', 'Version du dossier colis requise.');
  if (product && raw.capability !== 'product_review_financial_v1') throw new HttpsError('invalid-argument', 'Version financière produit explicite requise.');
  if (product && ['legacy_observe', 'legacy_resume'].includes(raw.mode)) throw new HttpsError('invalid-argument', 'Le contexte produit nécessite sa propre intention native.');
  const productJournal = raw?.productReview !== undefined && ['confirm', 'observe', 'neutralize', 'resume_confirm', 'resume_observe', 'resume_neutralize'].includes(raw?.mode);
  const allocationJournal = raw?.allocation !== undefined && ['confirm', 'observe', 'neutralize', 'resume_confirm', 'resume_observe', 'resume_neutralize'].includes(raw?.mode);
  const ownJournal = inquiryJournal || productJournal || allocationJournal;
  const transport = inquiry || raw?.decisionContext === 'return_to_sender_cases' || raw?.returnToSender !== undefined || resuming || raw?.mode === 'resume_source_observe';
  const admitTransport = async () => {
    if (sessionRequest?.auth?.uid !== adminUid) throw new HttpsError('permission-denied', 'Session opérateur actuelle requise.');
    await supportCurrentAdminSession({ ...sessionRequest, data: { expectedUid: adminUid } });
    await db.runTransaction(tx => supportAdmin(tx, adminUid, false));
  };
  // SDK identity and the exact private intention are sufficient to recover or
  // neutralize one's journal. They grant no business/source read permission.
  // Present Auth/cutoff/private role remain mandatory for every NEW instruction.
  if (ownJournal && sessionRequest?.auth?.uid !== adminUid) throw new HttpsError('permission-denied', 'Compte SDK attendu requis.');
  if (material && !ownJournal && !PRODUCT_MATERIAL_REVIEW_ENABLED || parcel && !ownJournal && !PRODUCT_PARCEL_REVIEW_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours matériel est en préparation.', {reason: parcel ? 'product_parcel_review_not_exposed' : 'product_material_review_not_exposed'});
  if ((transport || product || allocation) && !ownJournal) await admitTransport();
  if (raw.mode === 'resume_source_observe') return readAdminTransportResumeSource(adminUid, raw.transactionId, product, material, raw.productReviewTopic ?? 'authenticity', parcel);
  const mode = resuming ? raw.mode.slice('resume_'.length) : raw.mode;
  if (mode === 'preview') {
    if (resuming !== (raw.resume !== undefined)) throw new HttpsError('invalid-argument', 'Mode de reprise exact requis.');
    if (resuming) {
      if (!validDecisionReference(raw.resume?.refundIntentId) || !validDecisionReference(raw.resume?.refundAttemptId))
        throw new HttpsError('invalid-argument', 'Intention et tentative originales requises.');
      const found = await observeRefundBeforeTransportResume(raw.transactionId, raw.resume);
      if (found) throw new HttpsError('failed-precondition', 'Un mouvement financier existant a été observé. Relisez son résultat avant toute autre instruction.',
        { reason: inquiry ? 'transport_financial_review_required' : 'return_to_sender_financial_review_required', newRefundPermissionGranted: false });
    }
    return prepareAdminDecisionPreview(adminUid, raw, walletOnly, operatorSession);
  }
  const ref = db.collection('transactions').doc(raw.transactionId);
  if (raw.mode === 'legacy_observe' || raw.mode === 'legacy_resume') {
    await operatorSession(undefined, true);
    const order = (await ref.get()).data();
    if (!order?.refund || order.refund.commercialDecision != null || order.refund.intentId !== raw.refundIntentId ||
        typeof raw.refundIntentId !== 'string' || (walletOnly && order.paidVia !== 'wallet'))
      throw new HttpsError('failed-precondition', 'L’intention financière historique doit être identifiée exactement.');
    const financial = raw.mode === 'legacy_resume' ? await resumeTransactionRefund(raw.transactionId, raw.refundIntentId) : refundResult(order.refund);
    return { protocol: 'admin_financial_legacy_v1', transactionId: raw.transactionId, actorUid: adminUid,
      refundIntentId: raw.refundIntentId, commercialQualification: 'historical_unqualified',
      inventoryPermissionGranted: false, manualCorrectionRequired: true, financial };
  }
  if (mode !== 'confirm' && mode !== 'observe' && mode !== 'neutralize') throw new HttpsError('invalid-argument', 'Mode invalide.');
  const input = parseRefundDecisionInput(adminUid, raw);
  if (resuming !== !!input.resume) throw new HttpsError('invalid-argument', 'Mode et intention de reprise doivent correspondre.');
  const read = () => db.runTransaction(async tx => {
    await operatorSession(tx);
    const order = (await tx.get(ref)).data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    if (walletOnly && order.paidVia !== 'wallet') throw new HttpsError('failed-precondition', 'Paiement entièrement par porte-monnaie requis.');
    const own = await readAdminRefundDecision(tx, input, order);
    if ((input.productReview || input.allocation) && own.outcome === 'unrecorded') await qualifyOwnProductDecisionPreview(tx, input);
    return own;
  });
  const own = await read();
  // Pure observation never searches Stripe, resumes finance or neutralizes a
  // missing receipt. The client keeps its original unknown intention.
  if (mode === 'observe' || own.outcome === 'not_executed' || own.outcome === 'reserved') return own;
  if (raw.accepted !== true) throw new HttpsError('invalid-argument', 'Confirmation explicite requise.');
  if (mode === 'neutralize') return neutralizeAdminRefundDecision(input, walletOnly, false, operatorSession);
  if (input.allocation && !PURCHASE_REFUND_ENABLED) throw new HttpsError('failed-precondition', 'Les allocations sont en préparation.', {reason: 'purchase_refund_not_exposed'});
  if (material && !PRODUCT_MATERIAL_REVIEW_ENABLED || parcel && !PRODUCT_PARCEL_REVIEW_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours matériel est en préparation.', {reason: parcel ? 'product_parcel_review_not_exposed' : 'product_material_review_not_exposed'});
  if (ownJournal) await admitTransport();
  if (input.returnToSender || input.transportReview || input.productReview || input.allocation) assertRecentAccountAuthentication(sessionRequest.auth.token);
  try {
  if (input.resume) {
    const found = await observeRefundBeforeTransportResume(input.transactionId, input.resume);
    const renewed = await authorizeAdminTransportResume(input, sessionRequest.auth.token.auth_time as number, found, operatorSession);
    if (renewed.outcome === 'reserved') await resumeTransactionRefund(input.transactionId, input.resume.refundIntentId);
    return read();
  }
  await issueTransactionRefund(input.transactionId, {}, { idempotencyKey: `rf_decision_${refundDecisionId(input)}`,
    reason: input.note, relistArticle: false, source: walletOnly ? 'refundWalletPayment' : 'adminRefundTransaction',
    initiatedByUid: adminUid, commercialDecision: input,
    operatorSession,
    ...(input.returnToSender || input.transportReview || input.productReview || input.allocation ? { operatorAuthTime: sessionRequest.auth.token.auth_time as number } : {}),
    allowedInitialStatuses: ['paid', 'label_created', 'shipped', 'delivered', 'delivery_failed', 'lost', 'disputed', 'return_requested', 'completed', 'meetup_completed'] });
  return read();
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    // An allocation whose source became unknown after its private preview is
    // durably refused. An already committed reserve/effect wins inside this
    // helper, so a timeout can never neutralize real money or reserve twice.
    if (input.allocation && error instanceof HttpsError && error.code === 'failed-precondition')
      return neutralizeAdminRefundDecision(input, walletOnly, true, operatorSession);
    throw error;
  }
  });
}

export const adminRefundTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: providerSecretsForDeployment(['STRIPE_SECRET_KEY']) },
  async request => withFinancialRecoveryScope({operation: "callable/payments/disputes.adminRefundTransaction"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise.');
    if(request.data?.capability===ORPHAN_CAPTURE_REFUND_CAPABILITY)return handleOrphanCaptureRefund(request);
    if(request.data?.capability===EXCEPTIONAL_RESTITUTION_CAPABILITY)return handleExceptionalRestitution(request);
    if (request.data?.capability === BANK_FINANCIAL_RECONCILIATION_CAPABILITY) return handleBankFinancialReconciliation(request);
    if (request.data?.capability === BANK_CASE_CAPABILITY) return handleBankDisputeCase(request);
    if (purchaseRefundRepairModes.includes(request.data?.mode)) return handlePurchaseRefundRepair(request);
    if (purchaseRefundModes.includes(request.data?.mode)) return handlePurchaseRefundAgreement(request);
    const adminUid = request.auth.uid;
    // Exact own receipts survive role loss; the central engine alone admits
    // a NEW source read or financial instruction using the current role.
    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, { functionName: 'adminRefundTransaction',
      maxCallsAuthenticated: 30, maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    return executeAdminRefundRequest(adminUid, request.data, false, request);
  }))
);

/** No UI is implied: support invokes this callable with admin credentials and
 * current failed/canceled proof is mandatory in the core. */
export const retryPurchaseRefund = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: providerSecretsForDeployment(['STRIPE_SECRET_KEY']) },
  async request => {
    return withFinancialRecoveryScope({operation: "callable/payments/disputes.retryPurchaseRefund"}, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise.');
    const adminUid = request.auth.uid;
    if (request.data?.expectedAdminUid !== adminUid) throw new HttpsError('permission-denied', 'Le compte administrateur a changé.');
    const admit = async (tx: FirebaseFirestore.Transaction) => {
      await supportCurrentAdminSession({ ...request, data: { expectedUid: adminUid } });
      if ((request.auth!.token.auth_time as number) * 1000 > Date.now()) throw new HttpsError('permission-denied', 'Session administrative indisponible.');
      await supportAdmin(tx, adminUid, false);
      await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(adminUid))).data(), tx, adminUid);
    };
    await db.runTransaction(admit);
    const { transactionId, expectedRefundIntentId } = request.data ?? {};
    if (typeof transactionId !== 'string' || !transactionId || transactionId.includes('/')) throw new HttpsError('invalid-argument', 'Transaction ID is required');
    if (!validDecisionReference(expectedRefundIntentId)) throw new HttpsError('invalid-argument', 'Intention de remboursement originale requise.');
    return retryPurchaseRefundAfterFailure(transactionId, adminUid, admit, expectedRefundIntentId);

    });
  }
);

export const inspectPaymentCaptureAnomaly = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: providerSecretsForDeployment(['STRIPE_SECRET_KEY']) },
  async request => {
    return withFinancialRecoveryScope({operation: "callable/payments/disputes.inspectPaymentCaptureAnomaly"}, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise.');
    const adminUid = request.auth.uid;
    if (request.data?.expectedAdminUid !== adminUid) throw new HttpsError('permission-denied', 'Le compte administrateur a changé.');
    const admit = async (tx: FirebaseFirestore.Transaction) => {
      await supportCurrentAdminSession({ ...request, data: { expectedUid: adminUid } });
      if ((request.auth!.token.auth_time as number) * 1000 > Date.now()) throw new HttpsError('permission-denied', 'Session administrative indisponible.');
      await supportAdmin(tx, adminUid, false);
    };
    await db.runTransaction(admit);
    if (typeof request.data?.operationId === 'string' && request.data.operationId.startsWith('checkout_')) {
      const { inspectCheckoutReconciliation } = await import('../../utils/paymentCheckoutReconciliation');
      return inspectCheckoutReconciliation(request.data.operationId, adminUid, admit);
    }
    return inspectPaymentCaptureAnomalyProof(request.data?.operationId, adminUid, admit);

    });
  }
);

type CashCaseInput = { transactionId: string; expectedDisputeId: string; adminUid: string; requestId: string;
  previewId: string; expectedSourceHash: string; note: string; decisionType: 'buyer_upheld' };
const cashCaseDecisionId = (i: CashCaseInput) => cashDigest(['cash_no_show', i.transactionId, i.adminUid, i.requestId]);
const cashCasePayload = (i: CashCaseInput) => cashDigest(i);
function cashCaseNotices(i: CashCaseInput, decisionId: string, buyerId: string, sellerId: string, otherCasesRetained: boolean) {
  return [buyerId, sellerId].map(userId => ({ eventKey: `cash_no_show_decision:${decisionId}`, userId, type: 'dispute_resolved',
    title: 'Décision enregistrée sur une rencontre',
    message: 'Une décision est enregistrée sur le dossier de rencontre examiné. Aucun mouvement financier ni rétablissement de réservation n’est effectué dans l’application. Consultez le dossier ou contactez le support.',
    data: { transactionId: i.transactionId, disputeId: i.expectedDisputeId, decisionId, ownerId: userId,
      outcome: 'buyer_upheld', actorUid: i.adminUid, noteHash: cashDigest(i.note), otherCasesRetained: String(otherCasesRetained), moneyMoved: 'false', reservationRestored: 'false' },
  }));
}

async function cashCaseSource(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData, expectedDisputeId: string) {
  const source = await readCommercialDecisionSource(tx, transactionId, order, expectedDisputeId);
  const claim = source.target.data(), report = order.noShowReport;
  if (!cashReservationWasReleased(transactionId, order) || !report || report.disputeId !== expectedDisputeId ||
      claim.type !== 'meetup_no_show' || claim.articleId !== order.articleId || claim.cashAgreementId !== order.cashAgreement.agreementId ||
      claim.reservationReleaseId !== order.cashReservationRelease.releaseId || claim.reportedBy !== report.reportedBy ||
      claim.reportedAgainst !== report.reportedAgainst || claim.reason !== report.reason ||
      (claim.details ?? null) !== (report.details ?? null) || !(claim.createdAt instanceof Timestamp) ||
      !claim.createdAt.isEqual(report.reportedAt)) throw new HttpsError('failed-precondition',
        'La provenance cash, le signalement et sa libération doivent être rapprochés.', { reason: 'cash_reconciliation_required' });
  return source;
}

async function readCashCaseDecision(tx: FirebaseFirestore.Transaction, input: CashCaseInput, order: FirebaseFirestore.DocumentData) {
  const decisionId = cashCaseDecisionId(input), payloadHash = cashCasePayload(input);
  const ref = db.collection('transactions').doc(input.transactionId).collection('dispute_decisions').doc(decisionId);
  const native = (await tx.get(ref)).data();
  const common = { protocol: 'cash_case_decision_v1', transactionId: input.transactionId, expectedDisputeId: input.expectedDisputeId,
    actorUid: input.adminUid, requestId: input.requestId, previewId: input.previewId, sourceHash: input.expectedSourceHash,
    decisionId, payloadHash, note: input.note, decisionType: input.decisionType, moneyMoved: false, reservationRestored: false,
    outsidePaymentVerified: false, physicalHandoverVerified: false, retryPermissionGranted: false };
  if (!native) return { ...common, outcome: 'unrecorded', decisionCommitted: false, effectsCommitted: false,
    intentionNeutralized: false, lateRequestBlocked: false, notificationCommitted: false };
  if (native.kind !== 'cash_case_decision_v1' || native.schemaVersion !== 1 || native.decisionId !== decisionId ||
      native.payloadHash !== payloadHash || native.actorUid !== input.adminUid || native.requestId !== input.requestId ||
      native.transactionId !== input.transactionId || native.expectedDisputeId !== input.expectedDisputeId || native.previewId !== input.previewId ||
      native.sourceHash !== input.expectedSourceHash || native.note !== input.note || native.decisionType !== input.decisionType ||
      native.buyerId !== order.buyerId || native.sellerId !== order.sellerId || !validDecisionUid(native.buyerId) ||
      !validDecisionUid(native.sellerId) || native.buyerId === native.sellerId || !(native.committedAt instanceof Timestamp) ||
      native.moneyMoved !== false || native.reservationRestored !== false) throw new HttpsError('unavailable', 'Le reçu exact de cette décision doit être rapproché.');
  const qualified = { ...common, buyerId: native.buyerId, sellerId: native.sellerId, committedAt: native.committedAt.toDate().toISOString() };
  if (native.outcome === 'not_executed') {
    if (native.effectsCommitted !== false || native.intentionNeutralized !== true || native.lateRequestBlocked !== true ||
        !['source_changed', 'intention_neutralized_before_effects'].includes(native.reason) ||
        (native.reason === 'source_changed' ? !cashHash(native.observedSourceHash) : native.sourceExamined !== false || native.observedSourceHash !== null))
      throw new HttpsError('unavailable', 'La non-exécution de cette intention doit être rapprochée.');
    return { ...qualified, outcome: 'not_executed', decisionCommitted: false, effectsCommitted: false,
      intentionNeutralized: true, lateRequestBlocked: true, nonExecutionQualified: true, reason: native.reason,
      observedSourceHash: native.observedSourceHash, notificationCommitted: false,
      ...(native.reason === 'intention_neutralized_before_effects' ? { sourceExamined: false } : {}) };
  }
  const target = (await tx.get(db.collection('disputes').doc(input.expectedDisputeId))).data();
  if (native.outcome !== 'recorded' || native.effectsCommitted !== true || native.intentionNeutralized !== false || native.lateRequestBlocked !== true ||
      native.disputesClosed !== 1 || !Array.isArray(native.remainingOpenDisputeIds) ||
      native.remainingOpenDisputeIds.length > 100 || new Set(native.remainingOpenDisputeIds).size !== native.remainingOpenDisputeIds.length ||
      native.remainingOpenDisputeIds.some((v: unknown) => !validDecisionReference(v) || v === input.expectedDisputeId) ||
      !cashHash(native.cashAgreementId) || !cashHash(native.reservationReleaseId) ||
      target?.transactionId !== input.transactionId || target.buyerId !== native.buyerId || target.sellerId !== native.sellerId ||
      target.status !== 'resolved' || target.resolution !== input.decisionType || target.resolvedBy !== input.adminUid ||
      target.resolutionDecisionId !== decisionId || !(target.resolvedAt instanceof Timestamp) || !target.resolvedAt.isEqual(native.committedAt))
    throw new HttpsError('unavailable', 'La clôture ciblée et son reçu doivent être rapprochés.');
  const notices = await Promise.all(cashCaseNotices(input, decisionId, native.buyerId, native.sellerId, native.remainingOpenDisputeIds.length > 0)
    .map(notice => readOperationalNoticeReceipt(tx, notice)));
  if (notices.some(receipt => !receipt) || !Array.isArray(native.notificationIds) || native.notificationIds.length !== 2 ||
      notices.some((receipt, index) => !receipt || receipt.notificationId !== native.notificationIds[index] || receipt.committedAt !== qualified.committedAt))
    throw new HttpsError('unavailable', 'Les avis natifs de cette décision doivent être retrouvés.');
  return { ...qualified, outcome: 'recorded', decisionCommitted: true, effectsCommitted: true, intentionNeutralized: false,
    lateRequestBlocked: true, cashAgreementId: native.cashAgreementId, reservationReleaseId: native.reservationReleaseId,
    reservationReleased: true, disputesClosed: 1, disputeIds: [input.expectedDisputeId], remainingOpenDisputeIds: native.remainingOpenDisputeIds,
    notificationCommitted: true, notificationIds: native.notificationIds, deviceDeliveryVerified: false, readingVerified: false };
}

export const closeMeetupNoShow = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async request => {
    return withFinancialRecoveryScope({operation: "callable/payments/disputes.closeMeetupNoShow"}, async () => withPrivateAccountSession(request, async () => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise.');
  const adminUid = request.auth.uid, raw = request.data ?? {};
  const localTime=process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'?Timestamp.now():undefined;
  const decisionStamp=()=>localTime??FieldValue.serverTimestamp();
  if (raw.expectedAdminUid !== adminUid || !validDecisionReference(raw.transactionId) || !validDecisionReference(raw.expectedDisputeId) ||
      !['preview', 'confirm', 'observe', 'neutralize'].includes(raw.mode) || raw.decisionType !== 'buyer_upheld')
    throw new HttpsError('invalid-argument', 'Compte, commande, dossier et mode explicites requis.');
  const orderRef = db.collection('transactions').doc(raw.transactionId);
  const assertCurrentAdmin = async (tx: FirebaseFirestore.Transaction) => {
    const current = await assertPrivateAccountSession(request, tx);
    await supportAdmin(tx, adminUid, current.currentAdminClaim);
    await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(adminUid))).data(), tx, adminUid);
  };
  if (raw.mode === 'preview') return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await assertCurrentAdmin(tx);
    const order = (await tx.get(orderRef)).data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    const source = await cashCaseSource(tx, raw.transactionId, order, raw.expectedDisputeId);
    if (source.target.data().status !== 'open') throw new HttpsError('failed-precondition', 'Le dossier examiné est déjà clôturé.');
    const previewId = cashDigest(['cash_case_preview_v1', adminUid, raw.transactionId, raw.expectedDisputeId, source.sourceHash]);
    const previewRef = orderRef.collection('dispute_decisions').doc(`cash_preview_${previewId}`);
    const prior = (await tx.get(previewRef)).data();
    const preview = { protocol: 'cash_case_preview_v1', previewId, actorUid: adminUid, transactionId: raw.transactionId,
      expectedDisputeId: raw.expectedDisputeId, decisionType: 'buyer_upheld', sourceHash: source.sourceHash, sourceVersion: 1,
      buyerId: order.buyerId, sellerId: order.sellerId, cashAgreementId: order.cashAgreement.agreementId,
      reservationReleaseId: order.cashReservationRelease.releaseId, reservationReleased: true, reservationRestored: false,
      moneyMovementPlanned: false, outsidePaymentVerified: false, physicalHandoverVerified: false,
      remainingOpenDisputeIds: source.remainingOpenDisputeIds };
    if (prior && (prior.previewId !== previewId || prior.actorUid !== adminUid || prior.sourceHash !== source.sourceHash))
      throw new HttpsError('unavailable', 'L’aperçu natif doit être rapproché.');
    await assertCurrentAdmin(tx);
    if (!prior) { await recoveryCommit({refs: [(previewRef).path]}); tx.create(previewRef, { ...preview, createdAt: decisionStamp() }); }
    return preview;
  });
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(raw.requestId ?? '') || !cashHash(raw.previewId) || !cashHash(raw.expectedSourceHash) ||
      typeof raw.note !== 'string' || !raw.note.trim() || raw.note.trim().length > 500)
    throw new HttpsError('invalid-argument', 'Aperçu, version, référence stable et note explicite requis.');
  const input: CashCaseInput = { adminUid, transactionId: raw.transactionId, expectedDisputeId: raw.expectedDisputeId,
    requestId: raw.requestId, previewId: raw.previewId, expectedSourceHash: raw.expectedSourceHash, note: raw.note.trim(), decisionType: 'buyer_upheld' };
  const decisionId = cashCaseDecisionId(input), decisionRef = orderRef.collection('dispute_decisions').doc(decisionId);
  await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await assertPrivateAccountSession(request, tx);
    const existing = (await tx.get(decisionRef)).data();
    if (existing) {
      const order = (await tx.get(orderRef)).data();
      if (!order) throw new HttpsError('unavailable', 'La source du propre reçu doit être retrouvée.');
      await readCashCaseDecision(tx, input, order);
      return;
    }
    if (raw.mode === 'observe') return;
    if (raw.accepted !== true) throw new HttpsError('invalid-argument', 'Confirmation explicite requise.');
    if (raw.mode !== 'neutralize') await assertCurrentAdmin(tx);
    const preview = (await tx.get(orderRef.collection('dispute_decisions').doc(`cash_preview_${input.previewId}`))).data();
    if (!preview || preview.protocol !== 'cash_case_preview_v1' || preview.previewId !== input.previewId ||
        preview.actorUid !== adminUid || preview.transactionId !== input.transactionId || preview.expectedDisputeId !== input.expectedDisputeId ||
        preview.decisionType !== input.decisionType || preview.sourceHash !== input.expectedSourceHash || preview.sourceVersion !== 1 ||
        !(preview.createdAt instanceof Timestamp)) throw new HttpsError('failed-precondition', 'L’aperçu ne correspond pas à cette intention.');
    const order = (await tx.get(orderRef)).data();
    if (!order || preview.buyerId !== order.buyerId || preview.sellerId !== order.sellerId)
      throw new HttpsError('unavailable', 'Les parties de l’aperçu doivent être rapprochées.');
    // Neutralizing the exact tuple previously previewed by this actor does not
    // renew a role. Its absence never authorizes reading another native case.
    const target = (await tx.get(db.collection('disputes').doc(input.expectedDisputeId))).data();
    const ownState = order.meetupNoShowResolution;
    if (target?.resolutionDecisionId === decisionId || ownState?.decisionId === decisionId)
      throw new HttpsError('unavailable', 'Un effet natif de cette intention doit être retrouvé avant sa reprise.');
    const base = { kind: 'cash_case_decision_v1', schemaVersion: 1, ...input, actorUid: adminUid, sourceHash: input.expectedSourceHash,
      decisionId, payloadHash: cashCasePayload(input), buyerId: order.buyerId, sellerId: order.sellerId,
      moneyMoved: false, reservationRestored: false, committedAt: decisionStamp(), lateRequestBlocked: true };
    if (!validDecisionUid(order.buyerId) || !validDecisionUid(order.sellerId) || order.buyerId === order.sellerId)
      throw new HttpsError('unavailable', 'Les parties de cette intention doivent être rapprochées.');
    if (raw.mode === 'neutralize') {
      const { callerKey, isAuthenticated } = resolveCallerKey(request);
      await checkRateLimit(callerKey, isAuthenticated, { functionName: 'closeMeetupNoShowNeutralize',
        maxCallsAuthenticated: 20, maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
      await assertPrivateAccountSession(request, tx);
      await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, { ...base, outcome: 'not_executed', effectsCommitted: false, intentionNeutralized: true,
        sourceExamined: false, observedSourceHash: null, reason: 'intention_neutralized_before_effects' });
      return;
    }
    const source = await readCommercialDecisionSource(tx, input.transactionId, order, input.expectedDisputeId);
    if (source.sourceHash !== input.expectedSourceHash || source.target.data().status !== 'open') {
      await assertCurrentAdmin(tx);
      await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, { ...base, outcome: 'not_executed', effectsCommitted: false, intentionNeutralized: true,
        observedSourceHash: source.sourceHash, reason: 'source_changed' });
      return;
    }
    await cashCaseSource(tx, input.transactionId, order, input.expectedDisputeId);
    const notices = await prepareOperationalNotices(tx, cashCaseNotices(input, decisionId, order.buyerId, order.sellerId, source.remainingOpenDisputeIds.length > 0));
    await assertCurrentAdmin(tx);
    // Only this native cash complaint is classified. Its former reservation
    // stays released even when another agreement now owns the article.
    await recoveryCommit({refs: [(source.target.ref).path]});
    tx.update(source.target.ref, { status: 'resolved', resolution: input.decisionType, resolvedBy: adminUid,
      resolvedAt: decisionStamp(), resolutionDecisionId: decisionId, resolutionNote: input.note });
    await recoveryCommit({refs: [(orderRef).path]});
    const closedFields={ ...(source.remainingOpenDisputeIds.length === 0 ? { status: 'cancelled', disputed: false,
      cancelledAt: decisionStamp(), cancelReason: 'cash_meetup_case_classified' } : {}),
      meetupNoShowResolution: { outcome: input.decisionType, expectedDisputeId: input.expectedDisputeId, decisionId,
        resolvedBy: adminUid, resolvedAt: decisionStamp(), note: input.note, notificationIds: notices.notificationIds } };
    tx.update(orderRef,localTime?await financialRecoverySourceFields('purchase',orderRef,order,closedFields):closedFields);
    await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, { ...base, outcome: 'recorded', effectsCommitted: true, intentionNeutralized: false,
      cashAgreementId: order.cashAgreement.agreementId, reservationReleaseId: order.cashReservationRelease.releaseId,
      disputesClosed: 1, remainingOpenDisputeIds: source.remainingOpenDisputeIds, notificationIds: notices.notificationIds });
    notices.commit(localTime);
  });
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    if (!(await tx.get(decisionRef)).exists) return readCashCaseDecision(tx, input, {});
    const order = (await tx.get(orderRef)).data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    return readCashCaseDecision(tx, input, order);
  });

    }));
  });

// =============================================================================
// RESOLVE DISPUTE — Admin closes a dispute WITHOUT a refund (favor of seller)
// =============================================================================

/**
 * F27/F88 + F10 + F26 — admin closes a dispute in favor of the SELLER (no
 * refund). This is the missing other half of adminRefundTransaction: a dispute
 * that the admin rules unfounded must be closeable WITHOUT moving money to the
 * buyer, otherwise every meetup no-show, contested return and chargeback inquiry
 * stays 'disputed' forever — freezing the seller's withdrawals (walletWithdraw
 * blocks on any disputed tx) and blocking both parties' account deletion.
 *
 * In one runTransaction it:
 *   1. closes only the explicitly examined OPEN dispute (resolved, dismissed),
 *   2. restores the native previous status only when no other complaint or
 *      retained return/correction obligation exists,
 *   3. then releases an admissible hold: disputeFreezeCents from heldBalance ->
 *      balance (mirrors the dispute.closed WON path, F37). Meetup no-shows and
 *      returns carry no freeze (meetup = cash; return funds sit in the normal
 *      heldBalance release cycle), so this is a no-op for them.
 *
 * Admin-only, double guard + rate limited (aligned with adminRefundTransaction).
 */

/**
 * F27/F88 + F10 + F26 — admin closes a dispute in favor of the SELLER (no
 * refund). This is the missing other half of adminRefundTransaction: a dispute
 * that the admin rules unfounded must be closeable WITHOUT moving money to the
 * buyer, otherwise every meetup no-show, contested return and chargeback inquiry
 * stays 'disputed' forever — freezing the seller's withdrawals (walletWithdraw
 * blocks on any disputed tx) and blocking both parties' account deletion.
 *
 * In one runTransaction it:
 *   1. closes only the explicitly examined OPEN dispute (resolved, dismissed),
 *   2. restores the native previous status only when no other complaint or
 *      retained return/correction obligation exists,
 *   3. then releases an admissible hold: disputeFreezeCents from heldBalance ->
 *      balance (mirrors the dispute.closed WON path, F37). Meetup no-shows and
 *      returns carry no freeze (meetup = cash; return funds sit in the normal
 *      heldBalance release cycle), so this is a no-op for them.
 *
 * Admin-only, double guard + rate limited (aligned with adminRefundTransaction).
 */

export type DisputeResolutionInput = { transactionId: string; expectedDisputeId: string; requestId: string; adminUid: string; note: string;
  previewId?: string; expectedSourceHash?: string; productReview?: ProductFinancialReference; allocation?: RefundAllocationReference };
const resolutionDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const disputeDecisionId = (input: DisputeResolutionInput) => resolutionDigest([input.transactionId, input.adminUid, input.requestId]);
const disputeDecisionPayload = (input: DisputeResolutionInput) => resolutionDigest([input.transactionId, input.expectedDisputeId,
  input.adminUid, input.requestId, 'dismissed', input.note,
  ...(input.previewId || input.expectedSourceHash ? [input.previewId ?? null, input.expectedSourceHash ?? null] : []),
  ...(input.productReview ? [input.productReview] : []), ...(input.allocation ? [supportHash(input.allocation)] : [])]);
const validDisputeReference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);

/** The bank producer may retain its won hold while a commercial case is open.
 * This consumes that exact native reserve, not a guessed commercial amount. */
async function inheritedBankHold(tx: FirebaseFirestore.Transaction, order: FirebaseFirestore.DocumentData,
  transactionId: string, sellerId: string) {
  const bank = order.bankDispute;
  const noHold = { qualified: true, retained: false, proof: null as Record<string, any> | null };
  const blocked = { qualified: false, retained: true, proof: null as Record<string, any> | null };
  if (bank == null && order.disputeId == null && (order.disputeFreezeCents === undefined || order.disputeFreezeCents === 0)) return noHold;
  if (!bank || typeof bank !== 'object' || !/^(?:du|dp)_[A-Za-z0-9_]+$/.test(bank.id ?? '') || bank.state !== 'closed' ||
      !['won', 'warning_closed'].includes(bank.outcome) || bank.stripeStatus !== bank.outcome ||
      !(bank.openedAt instanceof Timestamp) || !(bank.closedAt instanceof Timestamp) ||
      bank.openedAt.toMillis() > bank.closedAt.toMillis() || !(order.disputeClosedAt instanceof Timestamp) ||
      !bank.closedAt.isEqual(order.disputeClosedAt) ||
      (Object.prototype.hasOwnProperty.call(bank, 'reconciliationRequired') && bank.reconciliationRequired !== false) ||
      bank.conflictingDisputeId != null || (order.disputeId != null && order.disputeId !== bank.id) ||
      !Number.isSafeInteger(bank.freezeCents) || bank.freezeCents < 0 ||
      !Number.isSafeInteger(order.disputeFreezeCents) || order.disputeFreezeCents !== bank.freezeCents ||
      typeof order.stripePaymentIntentId !== 'string' || !/^pi_[A-Za-z0-9_]+$/.test(order.stripePaymentIntentId)) return blocked;
  if (bank.freezeCents === 0) return noHold;
  if (bank.commercialDisputedBeforeOpen !== true) return blocked;
  const rows = await tx.get(db.collection('wallets').doc(sellerId).collection('ledger')
    .where('transactionId', '==', transactionId).limit(101));
  if (rows.size >= 101) return blocked;
  const linked = rows.docs.filter(doc => doc.data().disputeId === bank.id);
  const openings = linked.filter(doc => doc.data().type === 'dispute_hold');
  if (openings.length !== 1 || linked.some(doc => ['dispute_hold_released', 'refund_debit', 'refund_credit'].includes(doc.data().type))) return blocked;
  const opening = openings[0].data();
  if (opening.amount !== bank.freezeCents || opening.transactionId !== transactionId || opening.disputeId !== bank.id ||
      !(opening.createdAt instanceof Timestamp) || !opening.createdAt.isEqual(bank.openedAt) ||
      !Number.isSafeInteger(opening.balanceAfter) || opening.balanceAfter < 0 || opening.status !== 'held') return blocked;
  return { qualified: true, retained: false, proof: { schemaVersion: 1, bankDisputeId: bank.id,
    amountCents: bank.freezeCents, holdLedgerId: openings[0].id, openedAt: bank.openedAt, closedAt: bank.closedAt,
    buyerId: order.buyerId, sellerId, paymentIntentId: order.stripePaymentIntentId, outcome: bank.outcome } };
}

function disputeResolutionNotices(transactionId: string, decisionId: string, disputeId: string,
  buyerId: string, sellerId: string, orderResolutionCommitted: boolean): OperationalNoticeInput[] {
  const message = orderResolutionCommitted
    ? 'Le dossier examiné a été clôturé sans remboursement par cette décision. Consultez la commande pour la décision et son état courant ; le support reste accessible.'
    : 'Le dossier examiné a été clôturé sans remboursement par cette décision. D’autres dossiers ou obligations restent en cours et les fonds restent gelés. Consultez la commande pour son état courant.';
  return [buyerId, sellerId].map(userId => ({ eventKey: `dispute_resolution:${transactionId}:${decisionId}`, userId,
    type: 'dispute_resolved', title: 'Décision enregistrée sur un litige', message,
    data: { transactionId, decisionId, disputeId, outcome: 'dismissed' } }));
}

/** An immutable decision receipt survives a later order status, another claim
 * or another operator action. It is history, never permission to release again. */
export async function readDisputeDecision(tx: FirebaseFirestore.Transaction, input: DisputeResolutionInput,
  order: FirebaseFirestore.DocumentData) {
  const decisionId = disputeDecisionId(input);
  const ref = db.collection('transactions').doc(input.transactionId).collection('dispute_decisions').doc(decisionId);
  const decision = (await tx.get(ref)).data();
  if (!decision) return null;
  if (decision.payloadHash !== disputeDecisionPayload(input) || decision.actorUid !== input.adminUid ||
      decision.requestId !== input.requestId || decision.note !== input.note || decision.expectedDisputeId !== input.expectedDisputeId ||
      resolutionDigest(decision.productReview ?? null) !== resolutionDigest(input.productReview ?? null) ||
      supportHash(decision.allocation ?? null) !== supportHash(input.allocation ?? null)) {
    throw new HttpsError('failed-precondition', 'Cette référence désigne une autre décision.',
      { reason: 'dispute_decision_conflict', action: 'readOriginalDecision' });
  }
  if (decision.outcome === 'not_executed') {
    if (decision.kind === 'commercial_intention_neutralization_v1') {
      if (decision.schemaVersion !== 1 || decision.decisionId !== decisionId || decision.transactionId !== input.transactionId ||
          decision.expectedDisputeId !== input.expectedDisputeId || decision.previewId !== (input.previewId ?? null) ||
          decision.sourceHash !== (input.expectedSourceHash ?? null) || decision.sourceExamined !== false || decision.observedSourceHash !== null ||
          !validDisputeReference(decision.buyerId) || !validDisputeReference(decision.sellerId) || decision.buyerId === decision.sellerId ||
          decision.buyerId !== order.buyerId || decision.sellerId !== order.sellerId || !(decision.committedAt instanceof Timestamp) ||
          decision.effectsCommitted !== false || decision.intentionNeutralized !== true || decision.lateRequestBlocked !== true ||
          (decision.reason !== 'intention_neutralized_before_effects' && !(input.allocation && decision.reason === 'allocation_sources_unqualified')))
        throw new HttpsError('unavailable', 'Le reçu de neutralisation doit être rapproché.');
      return { protocol: 'commercial_dispute_resolution_v1', ...(input.productReview ? {productReview: input.productReview} : {}), ...(input.allocation ? {allocation: input.allocation} : {}), outcome: 'not_executed', success: false,
        transactionId: input.transactionId, expectedDisputeId: input.expectedDisputeId, requestId: input.requestId,
        decisionId, actorUid: input.adminUid, note: input.note, payloadHash: decision.payloadHash,
        previewId: decision.previewId, sourceHash: decision.sourceHash, sourceExamined: false, observedSourceHash: null,
        decisionCommitted: false, effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true,
        nonExecutionQualified: true, nonExecutionReason: decision.reason, terminal: true,
        neutralizedAt: decision.committedAt.toDate().toISOString(), currentOrderStatus: typeof order.status === 'string' ? order.status : 'unavailable',
        releasedCents: 0, disputesClosed: 0, disputeIds: [], orderResolutionCommitted: false, moneyMoved: false,
        replay: true, retryPermissionGranted: false, notificationCommitted: false };
    }
    if (decision.kind === 'commercial_source_nonexecution_v1') {
      if (decision.schemaVersion !== 1 || decision.decisionId !== decisionId || decision.transactionId !== input.transactionId ||
          decision.expectedDisputeId !== input.expectedDisputeId || decision.previewId !== input.previewId ||
          decision.sourceHash !== input.expectedSourceHash || !/^[a-f0-9]{64}$/.test(decision.observedSourceHash ?? '') ||
          decision.buyerId !== order.buyerId || decision.sellerId !== order.sellerId ||
          !(decision.committedAt instanceof Timestamp) || decision.effectsCommitted !== false ||
          decision.intentionNeutralized !== true || decision.lateRequestBlocked !== true || decision.reason !== 'source_changed')
        throw new HttpsError('unavailable', 'Le reçu de non-exécution doit être rapproché.');
      return { protocol: 'commercial_dispute_resolution_v1', ...(input.productReview ? {productReview: input.productReview} : {}), ...(input.allocation ? {allocation: input.allocation} : {}), outcome: 'not_executed', success: false,
        decisionCommitted: false, effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true,
        transactionId: input.transactionId, expectedDisputeId: input.expectedDisputeId, requestId: input.requestId,
        decisionId, actorUid: input.adminUid, note: input.note, payloadHash: decision.payloadHash,
        reason: 'source_changed', sourceHash: decision.sourceHash, observedSourceHash: decision.observedSourceHash,
        nonExecutionQualified: true, nonExecutionReason: 'source_changed', terminal: true,
        neutralizedAt: decision.committedAt.toDate().toISOString(), moneyMoved: false, replay: true,
        currentOrderStatus: typeof order.status === 'string' ? order.status : 'unavailable',
        releasedCents: 0, disputesClosed: 0, disputeIds: [], orderResolutionCommitted: false, retryPermissionGranted: false,
        notificationCommitted: false, notificationDelivery: 'historical_unqualified',
        deviceDeliveryVerified: false, readingVerified: false };
    }
    const proof = decision.nonExecutionProof;
    if (decision.schemaVersion !== 1 || decision.decisionId !== decisionId || decision.transactionId !== input.transactionId ||
        !validDisputeReference(decision.buyerId) || !validDisputeReference(decision.sellerId) || decision.buyerId === decision.sellerId ||
        decision.buyerId !== order.buyerId || decision.sellerId !== order.sellerId ||
        !(decision.committedAt instanceof Timestamp) || decision.effectsCommitted !== false ||
        decision.intentionNeutralized !== true || decision.lateRequestBlocked !== true ||
        proof?.schemaVersion !== 1 || proof.reason !== 'target_already_closed' || proof.targetDisputeId !== input.expectedDisputeId ||
        proof.transactionId !== input.transactionId || proof.buyerId !== decision.buyerId || proof.sellerId !== decision.sellerId ||
        proof.status !== 'resolved' || !['dismissed', 'refunded', 'buyer_upheld'].includes(proof.resolution) ||
        !validDisputeReference(proof.resolvedBy) || !(proof.resolvedAt instanceof Timestamp) ||
        !(proof.createdAt instanceof Timestamp) || proof.createdAt.toMillis() > proof.resolvedAt.toMillis() ||
        proof.resolvedAt.toMillis() > decision.committedAt.toMillis() ||
        (proof.resolutionDecisionId !== null && (!/^[a-f0-9]{64}$/.test(proof.resolutionDecisionId ?? '') || proof.resolutionDecisionId === decisionId)) ||
        decision.sourceHash !== resolutionDigest([proof.targetDisputeId, proof.transactionId, proof.buyerId, proof.sellerId,
          proof.status, proof.resolution, proof.resolvedBy, proof.createdAt.toMillis(), proof.resolvedAt.toMillis(), proof.resolutionDecisionId])) {
      throw new HttpsError('unavailable', 'La non-exécution de cette intention doit être vérifiée. Conservez sa référence.');
    }
    return { protocol: 'commercial_dispute_resolution_v1', ...(input.productReview ? {productReview: input.productReview} : {}), ...(input.allocation ? {allocation: input.allocation} : {}), outcome: 'not_executed', success: false,
      decisionCommitted: false, effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true,
      nonExecutionQualified: true, nonExecutionReason: 'target_already_closed', terminal: true,
      transactionId: input.transactionId, expectedDisputeId: input.expectedDisputeId, requestId: input.requestId,
      decisionId, actorUid: input.adminUid, note: input.note, payloadHash: decision.payloadHash,
      neutralizedAt: decision.committedAt.toDate().toISOString(),
      currentOrderStatus: typeof order.status === 'string' ? order.status : 'unavailable',
      releasedCents: 0, disputesClosed: 0, disputeIds: [], orderResolutionCommitted: false,
      replay: true, retryPermissionGranted: false, notificationCommitted: false };
  }
  if (decision.schemaVersion !== 1 || decision.decisionId !== decisionId || decision.transactionId !== input.transactionId ||
      decision.outcome !== 'dismissed' || !(decision.committedAt instanceof Timestamp) ||
      !validDisputeReference(decision.buyerId) || !validDisputeReference(decision.sellerId) ||
      decision.buyerId !== order.buyerId || decision.sellerId !== order.sellerId ||
      !/^[a-f0-9]{64}$/.test(decision.sourceHash ?? '') || typeof decision.restored !== 'string' || !decision.restored ||
      !Number.isSafeInteger(decision.releasedCents) || decision.releasedCents < 0 ||
      !Array.isArray(decision.disputeIds) || decision.disputeIds.length !== 1 || decision.disputeIds[0] !== input.expectedDisputeId ||
      decision.disputeIds.some((id: unknown) => !validDisputeReference(id)) ||
      new Set(decision.disputeIds).size !== decision.disputeIds.length || decision.disputesClosed !== decision.disputeIds.length ||
      !Array.isArray(decision.remainingOpenDisputeIds) || decision.remainingOpenDisputeIds.length > 99 ||
      decision.remainingOpenDisputeIds.some((id: unknown) => !validDisputeReference(id) || id === input.expectedDisputeId) ||
      new Set(decision.remainingOpenDisputeIds).size !== decision.remainingOpenDisputeIds.length ||
      decision.remainingDisputesOpen !== decision.remainingOpenDisputeIds.length ||
      !Array.isArray(decision.retainedObligations) || decision.retainedObligations.length > 5 ||
      decision.retainedObligations.some((reason: unknown) => typeof reason !== 'string' ||
        !['return_request', 'delivery_correction', 'bank_hold_reconciliation'].includes(reason)) ||
      new Set(decision.retainedObligations).size !== decision.retainedObligations.length ||
      decision.orderResolutionCommitted !== (decision.remainingOpenDisputeIds.length === 0 && decision.retainedObligations.length === 0) ||
      (!decision.orderResolutionCommitted && decision.releasedCents !== 0)) {
    throw new HttpsError('unavailable', 'Le reçu de cette décision doit être vérifié. Aucune nouvelle clôture n’est autorisée.');
  }
  if (decision.releasedCents > 0) {
    const ledgerId = `dispute_resolution_${decisionId}`;
    const ledger = (await tx.get(db.collection('wallets').doc(decision.sellerId).collection('ledger').doc(ledgerId))).data();
    if (decision.releaseLedgerId !== ledgerId || ledger?.type !== 'dispute_hold_released' || ledger.amount !== decision.releasedCents ||
        ledger.transactionId !== input.transactionId || ledger.disputeDecisionId !== decisionId || ledger.actorUid !== input.adminUid ||
        ledger.currency !== 'CAD' || !(ledger.createdAt instanceof Timestamp) || !Number.isSafeInteger(ledger.balanceAfter) || ledger.balanceAfter < 0) {
      throw new HttpsError('unavailable', 'Le reçu des fonds de cette décision doit être vérifié.');
    }
    const bankRelease = decision.bankHoldRelease;
    if (bankRelease != null) {
      if (bankRelease.schemaVersion !== 1 || bankRelease.decisionId !== decisionId || bankRelease.releaseLedgerId !== ledgerId ||
          bankRelease.amountCents !== decision.releasedCents || bankRelease.buyerId !== decision.buyerId || bankRelease.sellerId !== decision.sellerId ||
          !/^(?:du|dp)_[A-Za-z0-9_]+$/.test(bankRelease.bankDisputeId ?? '') || !validDisputeReference(bankRelease.holdLedgerId) ||
          !['won', 'warning_closed'].includes(bankRelease.outcome) || !(bankRelease.openedAt instanceof Timestamp) ||
          !(bankRelease.closedAt instanceof Timestamp) || !(bankRelease.releasedAt instanceof Timestamp) ||
          !bankRelease.releasedAt.isEqual(decision.committedAt) || ledger.disputeId !== bankRelease.bankDisputeId ||
          ledger.bankHoldLedgerId !== bankRelease.holdLedgerId) {
        throw new HttpsError('unavailable', 'Le reçu du gel bancaire hérité doit être rapproché.');
      }
      const opening = (await tx.get(db.collection('wallets').doc(decision.sellerId).collection('ledger').doc(bankRelease.holdLedgerId))).data();
      if (opening?.type !== 'dispute_hold' || opening.amount !== decision.releasedCents ||
          opening.transactionId !== input.transactionId || opening.disputeId !== bankRelease.bankDisputeId ||
          !(opening.createdAt instanceof Timestamp) || !opening.createdAt.isEqual(bankRelease.openedAt)) {
        throw new HttpsError('unavailable', 'La provenance du gel bancaire doit être vérifiée.');
      }
    }
  } else if (decision.releaseLedgerId !== null) throw new HttpsError('unavailable', 'Le reçu de cette décision est incohérent.');
  if (decision.financialSettlementRetained === true && (!validDisputeReference(decision.settledRefundIntentId) ||
      decision.restored !== 'refunded' || decision.releasedCents !== 0 || decision.releaseLedgerId !== null || decision.bankHoldRelease !== null))
    throw new HttpsError('unavailable', 'Le classement après remboursement doit être rapproché.');
  let notificationCommitted = false;
  if (Object.prototype.hasOwnProperty.call(decision, 'notificationIds')) {
    const noticeInputs = disputeResolutionNotices(input.transactionId, decisionId, input.expectedDisputeId,
      decision.buyerId, decision.sellerId, decision.orderResolutionCommitted);
    const receipts = await Promise.all(noticeInputs.map(notice => readOperationalNoticeReceipt(tx, notice)));
    if (!Array.isArray(decision.notificationIds) || decision.notificationIds.length !== 2 ||
        receipts.some((receipt, index) => !receipt || receipt.notificationId !== decision.notificationIds[index])) {
      throw new HttpsError('unavailable', 'Les avis de cette décision doivent être retrouvés.');
    }
    notificationCommitted = true;
  }
  return { protocol: 'commercial_dispute_resolution_v1', ...(input.productReview ? {productReview: input.productReview} : {}), ...(input.allocation ? {allocation: input.allocation} : {}), success: true, decisionCommitted: true,
    transactionId: input.transactionId, requestId: input.requestId, decisionId, actorUid: input.adminUid,
    expectedDisputeId: input.expectedDisputeId,
    outcome: 'dismissed', note: input.note, restored: decision.restored,
    currentOrderStatus: typeof order.status === 'string' ? order.status : 'unavailable',
    releasedCents: decision.releasedCents, disputesClosed: decision.disputesClosed, disputeIds: decision.disputeIds,
    orderResolutionCommitted: decision.orderResolutionCommitted,
    remainingOpenDisputeIds: decision.remainingOpenDisputeIds, remainingDisputesOpen: decision.remainingDisputesOpen,
    retainedObligations: decision.retainedObligations,
    financialSettlementRetained: decision.financialSettlementRetained === true,
    settledRefundIntentId: decision.financialSettlementRetained === true ? decision.settledRefundIntentId : null,
    resolvedAt: decision.committedAt.toDate().toISOString(), replay: true, notificationCommitted,
    notificationDelivery: notificationCommitted ? 'in_app_committed' : 'historical_unqualified',
    deviceDeliveryVerified: false, readingVerified: false };
}

export const resolveDispute = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/payments/disputes.resolveDispute"}, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const product = request.data?.decisionContext === 'product_review' || request.data?.productReview !== undefined;
    const material = request.data?.materialCapability === 'product_review_material_v1', parcel = productParcelRequested(request.data ?? {});
    if (request.data?.materialCapability !== undefined && !material || request.data?.productReview?.topic === 'nonconformity' && !material ||
        material && !product || request.data?.productReview && (request.data.productReview.materialCapability === 'product_review_material_v1') !== material) throw new HttpsError('invalid-argument', 'Version et dossier matériels explicites requis.');
    if (parcel && (!product || request.data?.productReview && request.data.productReview.parcelCapability !== 'product_review_parcel_v1') || request.data?.productReview?.parcelCapability && !parcel) throw new HttpsError('invalid-argument', 'Version du dossier colis requise.');
    if (product && request.data?.capability !== 'product_review_financial_v1') throw new HttpsError('invalid-argument', 'Version financière produit explicite requise.');
    const allocation = request.data?.allocation === undefined ? undefined : parseRefundAllocation(request.data.allocation);
    if (allocation && (allocation.terms.settlementKind !== 'retain_remaining' || allocation.terms.caseHandling !== 'settle_selected_case' ||
        request.data.capability !== 'purchase_refund_v1' && request.data.allocationCapability !== 'purchase_refund_v1'))
      throw new HttpsError('invalid-argument', 'Conservation explicite du reliquat requise pour une décision sans remboursement.');
    const productJournal = (product && request.data?.productReview !== undefined || !!allocation) && ['confirm', 'observe', 'neutralize'].includes(request.data?.mode);
    let isAdmin = productJournal || request.auth.token.admin === true;
    if (!isAdmin) {
      const adminSnap = await db.collection('users').doc(request.auth.uid).get();
      isAdmin = adminSnap.exists && adminSnap.data()?.isAdmin === true;
    }
    if (!isAdmin) {
      throw new HttpsError('permission-denied', 'Admin privileges required');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'resolveDispute',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, expectedDisputeId, note, requestId, expectedAdminUid, previewId, expectedSourceHash, mode, accepted } = request.data ?? {};
    if (!validDisputeReference(transactionId) || !validDisputeReference(expectedDisputeId) ||
        typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId) ||
        typeof note !== 'string' || !note.trim() || note.trim().length > 500) {
      throw new HttpsError('invalid-argument', 'Commande, référence stable et motif explicite (500 caractères maximum) requis.');
    }
    const adminUid = request.auth.uid;
    if (expectedAdminUid !== adminUid) throw new HttpsError('failed-precondition', 'Le compte administrateur a changé.');
    if (mode !== undefined && mode !== 'confirm' && mode !== 'observe' && mode !== 'neutralize') throw new HttpsError('invalid-argument', 'Mode invalide.');
    if (allocation && !['confirm', 'observe', 'neutralize'].includes(mode)) throw new HttpsError('invalid-argument', 'Mode explicite de décision structurée requis.');
    const input: DisputeResolutionInput = { transactionId, expectedDisputeId, requestId, adminUid, note: note.trim(),
      ...(previewId !== undefined ? { previewId } : {}), ...(expectedSourceHash !== undefined ? { expectedSourceHash } : {}),
      ...(product ? {productReview: parseProductFinancialReference(request.data?.productReview)} : {}), ...(allocation ? {allocation} : {}) };
    const decisionId = disputeDecisionId(input);
    const decisionRef = db.collection('transactions').doc(transactionId).collection('dispute_decisions').doc(decisionId);
    const txRef = db.collection('transactions').doc(transactionId);

    try {
      const result = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        const snap = await tx.get(txRef);
        if (!snap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }
        const data = snap.data()!;
        const priorDecision = await readDisputeDecision(tx, input, data);
        // Replaying the exact committed choice does not require reopening the
        // dispute or bypass any newer refund, bank or moderation decision.
        if (priorDecision) return { replay: true as const, receipt: priorDecision };
        if (input.productReview || input.allocation) await qualifyOwnProductDecisionPreview(tx, {...input, decisionType: 'dismissed'});
        if (mode === 'observe') return { replay: true as const, receipt: {
          protocol: 'commercial_dispute_resolution_v1', outcome: 'unrecorded', transactionId, expectedDisputeId, requestId,
          actorUid: adminUid, decisionId, note: input.note, payloadHash: disputeDecisionPayload(input),
          ...(input.productReview ? {productReview: input.productReview} : {}), ...(input.allocation ? {allocation: input.allocation} : {}),
          previewId: input.previewId ?? null, sourceHash: input.expectedSourceHash ?? null,
          decisionCommitted: false, effectsCommitted: false, intentionNeutralized: false, lateRequestBlocked: false,
          retryPermissionGranted: false, moneyMoved: false, releasedCents: 0, disputesClosed: 0, disputeIds: [],
          orderResolutionCommitted: false, notificationCommitted: false } };
        if ((mode === 'confirm' || mode === 'neutralize') && accepted !== true) throw new HttpsError('invalid-argument', 'Confirmation explicite requise.');
        const examinedClaim = (await tx.get(db.collection('disputes').doc(expectedDisputeId))).data();
        if (mode === 'neutralize') {
          if (!validDisputeReference(data.buyerId) || !validDisputeReference(data.sellerId) || data.buyerId === data.sellerId)
            throw new HttpsError('unavailable', 'Les parties et le reçu de cette intention doivent être rapprochés.');
          const ownRelease = await tx.get(db.collection('wallets').doc(data.sellerId).collection('ledger').doc(`dispute_resolution_${decisionId}`));
          if (ownRelease.exists || examinedClaim?.resolutionDecisionId === decisionId || data.disputeResolutionDecisionId === decisionId ||
              data.lastCommercialCaseDecisionId === decisionId)
            throw new HttpsError('unavailable', 'Un effet de cette intention doit être rapproché avant sa neutralisation.');
          await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, { schemaVersion: 1, kind: 'commercial_intention_neutralization_v1', outcome: 'not_executed',
            decisionId, transactionId, expectedDisputeId, requestId, actorUid: adminUid, note: input.note,
            ...(input.productReview ? {productReview: input.productReview} : {}), ...(input.allocation ? {allocation: input.allocation} : {}),
            payloadHash: disputeDecisionPayload(input), previewId: input.previewId ?? null, sourceHash: input.expectedSourceHash ?? null,
            sourceExamined: false, observedSourceHash: null, reason: 'intention_neutralized_before_effects',
            buyerId: data.buyerId, sellerId: data.sellerId, effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true,
            committedAt: FieldValue.serverTimestamp() });
          return { neutralized: true as const };
        }
        if (input.productReview || input.allocation) {
          if (input.allocation && !PURCHASE_REFUND_ENABLED) throw new HttpsError('failed-precondition', 'Les règlements sont en préparation.', {reason: 'purchase_refund_not_exposed'});
          if (material && !PRODUCT_MATERIAL_REVIEW_ENABLED || parcel && !PRODUCT_PARCEL_REVIEW_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours matériel est en préparation.', {reason: parcel ? 'product_parcel_review_not_exposed' : 'product_material_review_not_exposed'});
          await supportCurrentAdminSession({...request, data: {expectedUid: adminUid}});
          assertRecentAccountAuthentication(request.auth!.token);
          await assertProductFinancialOperator(tx, adminUid);
        }
        if (examinedClaim?.status === 'resolved') {
          // This protected native terminal is about the EXACT examined claim.
          // Its actor/choice are evidence of conflict, never A's own decision.
          if (examinedClaim.transactionId !== transactionId || examinedClaim.buyerId !== data.buyerId ||
              examinedClaim.sellerId !== data.sellerId || !validDisputeReference(data.buyerId) || !validDisputeReference(data.sellerId) ||
              !validDisputeReference(examinedClaim.resolvedBy) || !['dismissed', 'refunded', 'buyer_upheld'].includes(examinedClaim.resolution) ||
              !(examinedClaim.createdAt instanceof Timestamp) || !(examinedClaim.resolvedAt instanceof Timestamp) ||
              examinedClaim.createdAt.toMillis() > examinedClaim.resolvedAt.toMillis() ||
              (examinedClaim.resolutionDecisionId != null && !/^[a-f0-9]{64}$/.test(examinedClaim.resolutionDecisionId)) ||
              examinedClaim.resolutionDecisionId === decisionId || data.disputeResolutionDecisionId === decisionId ||
              data.lastCommercialCaseDecisionId === decisionId) {
            throw new HttpsError('unavailable', 'La clôture et l’intention précédente doivent être rapprochées. Conservez la référence.');
          }
          const ownRelease = await tx.get(db.collection('wallets').doc(data.sellerId).collection('ledger').doc(`dispute_resolution_${decisionId}`));
          if (ownRelease.exists) throw new HttpsError('unavailable', 'Un mouvement de cette intention doit être retrouvé avant son acquittement.');
          const proof = { schemaVersion: 1, reason: 'target_already_closed', targetDisputeId: expectedDisputeId,
            transactionId, buyerId: data.buyerId, sellerId: data.sellerId, status: examinedClaim.status,
            resolution: examinedClaim.resolution, resolvedBy: examinedClaim.resolvedBy,
            createdAt: examinedClaim.createdAt, resolvedAt: examinedClaim.resolvedAt,
            resolutionDecisionId: examinedClaim.resolutionDecisionId ?? null };
          // The same deterministic document is read before EVERY first effect.
          // Committing this tombstone serializes a late original A request too.
          await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, { schemaVersion: 1, outcome: 'not_executed', decisionId, transactionId, expectedDisputeId,
            requestId, actorUid: adminUid, note: input.note, payloadHash: disputeDecisionPayload(input),
            ...(input.productReview ? {productReview: input.productReview} : {}), ...(input.allocation ? {allocation: input.allocation} : {}),
            buyerId: data.buyerId, sellerId: data.sellerId, effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true,
            nonExecutionProof: proof, sourceHash: resolutionDigest([proof.targetDisputeId, proof.transactionId, proof.buyerId, proof.sellerId,
              proof.status, proof.resolution, proof.resolvedBy, proof.createdAt.toMillis(), proof.resolvedAt.toMillis(), proof.resolutionDecisionId]),
            committedAt: FieldValue.serverTimestamp() });
          return { neutralized: true as const };
        }
        let preview: Awaited<ReturnType<typeof qualifyAdminDecisionPreview>>;
        try {preview = await qualifyAdminDecisionPreview(tx, adminUid, transactionId, expectedDisputeId, 'dismissed',
          previewId, expectedSourceHash, data, undefined, undefined, undefined, input.productReview, input.allocation);}
        catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
          if (!input.allocation || !(error instanceof HttpsError) || error.code !== 'failed-precondition') throw error;
          await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, {schemaVersion: 1, kind: 'commercial_intention_neutralization_v1', outcome: 'not_executed',
            decisionId, transactionId, expectedDisputeId, requestId, actorUid: adminUid, note: input.note,
            ...(input.productReview ? {productReview: input.productReview} : {}), allocation: input.allocation,
            payloadHash: disputeDecisionPayload(input), previewId: input.previewId ?? null, sourceHash: input.expectedSourceHash ?? null,
            sourceExamined: false, observedSourceHash: null, reason: 'allocation_sources_unqualified', buyerId: data.buyerId, sellerId: data.sellerId,
            effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true, committedAt: FieldValue.serverTimestamp()});
          return {neutralized: true as const};
        }
        if (!preview.current) {
          // This own tombstone wins the same document as every late first
          // request. An open dossier with changed facts is not silently acted on.
          await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, { schemaVersion: 1, kind: 'commercial_source_nonexecution_v1', outcome: 'not_executed',
            decisionId, transactionId, expectedDisputeId, requestId, actorUid: adminUid, note: input.note,
            ...(input.productReview ? {productReview: input.productReview} : {}), ...(input.allocation ? {allocation: input.allocation} : {}),
            payloadHash: disputeDecisionPayload(input), previewId, sourceHash: expectedSourceHash,
            observedSourceHash: preview.refusalSourceHash ?? preview.source.sourceHash, reason: 'source_changed', buyerId: data.buyerId, sellerId: data.sellerId,
            effectsCommitted: false, intentionNeutralized: true, lateRequestBlocked: true, committedAt: FieldValue.serverTimestamp() });
          return { neutralized: true as const };
        }
        assertNoActiveBankDispute(data);
        assertNoUnsettledRefund(data);
        const settledAllocation = input.allocation && data.refund?.allocation ? await readSettledAllocationIntent(tx, transactionId, data, data.refund) : null;
        if (input.allocation && data.refund && !settledAllocation) throw new HttpsError('failed-precondition', 'Le règlement précédent doit être rapproché.');
        const settledRefund = !settledAllocation && (data.refund != null || data.refundedAt != null)
          ? await readQualifiedSettledRefund(tx, transactionId, data) : null;
        const afterRefund = settledRefund !== null;

        // Settled finance does not erase the right to classify a remaining case.
        if (data.status !== 'disputed' && data.status !== 'return_requested' && !(afterRefund && data.status === 'refunded')) {
          throw new HttpsError(
            'failed-precondition',
            `Cannot resolve a dispute for a transaction in status ${data.status}`
          );
        }

        const sellerId = data.sellerId;
        if (!validDisputeReference(sellerId) || !validDisputeReference(data.buyerId) || sellerId === data.buyerId) {
          throw new HttpsError('failed-precondition', 'Les parties de cette commande doivent être vérifiées avant clôture.');
        }
        const openDisputesSnap = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId)
          .where('status', '==', 'open').limit(101));
        if (openDisputesSnap.size >= 101 || openDisputesSnap.docs.some(doc => {
          const claim = doc.data();
          return claim.transactionId !== transactionId || claim.buyerId !== data.buyerId || claim.sellerId !== sellerId ||
            !(claim.createdAt instanceof Timestamp) || claim.status !== 'open' ||
            (claim.articleId != null && claim.articleId !== data.articleId) ||
            (claim.reportedBy != null && ![data.buyerId, sellerId].includes(claim.reportedBy));
        })) throw new HttpsError('failed-precondition', 'Les dossiers liés à cette commande doivent être rapprochés avant clôture.');
        const targetClaim = openDisputesSnap.docs.find(doc => doc.id === expectedDisputeId);
        if (!targetClaim) throw new HttpsError('failed-precondition', 'Le dossier examiné n’est plus ouvert sur cette commande.',
          { reason: 'dispute_case_changed', expectedDisputeId, action: 'refreshDispute' });
        const otherClaims = openDisputesSnap.docs.filter(doc => doc.id !== expectedDisputeId);
        const remainingOpenDisputeIds = otherClaims.map(doc => doc.id).sort();
        const returnFinanciallyExamined = !!input.allocation && preview.source.allocation?.returnFinanciallyExamined === true;
        const retainedObligations: string[] = hasUnsettledReturnRequest(data) && !returnFinanciallyExamined ? ['return_request'] : [];
        if (deliveryCorrectionBlocksProgress(data)) retainedObligations.push('delivery_correction');
        const bankHold = afterRefund
          ? { qualified: true, retained: data.bankDispute != null || data.disputeId != null || (data.disputeFreezeCents != null && data.disputeFreezeCents !== 0),
            proof: null as Record<string, any> | null }
          : await inheritedBankHold(tx, data, transactionId, sellerId);
        // Retaining the remaining price is not a new instruction about a
        // bank reserve. Preserve that independently held money for its own
        // qualified route instead of moving it behind a zero-refund preview.
        if (bankHold.retained || input.allocation && (data.disputeFreezeCents > 0 || data.bankDispute?.freezeCents > 0)) retainedObligations.push('bank_hold_reconciliation');
        const orderResolutionCommitted = otherClaims.length === 0 && retainedObligations.length === 0;
        const releasedCashReservation = cashReservationWasReleased(transactionId, data);
        if (!afterRefund && orderResolutionCommitted && data.deliveryType === 'meetup' && data.noShowReport && !releasedCashReservation) {
          throw new HttpsError('failed-precondition', 'La provenance cash et la réservation de cette rencontre doivent être rapprochées.');
        }
        const disputeIds = [expectedDisputeId];
        if (Object.prototype.hasOwnProperty.call(data, 'disputeFreezeCents') && typeof data.disputeFreezeCents !== 'number') {
          throw new HttpsError('failed-precondition', 'Le montant du gel doit être rapproché avant clôture.');
        }
        const freezeCents =
          typeof data.disputeFreezeCents === 'number' ? data.disputeFreezeCents : 0;
        if (!Number.isSafeInteger(freezeCents) || freezeCents < 0) throw new HttpsError('failed-precondition', 'Les fonds gelés doivent être vérifiés.');

        // Read seller wallet BEFORE writes (only when there is a hold to release).
        const sellerWalletRef =
          !afterRefund && orderResolutionCommitted && freezeCents > 0 && typeof sellerId === 'string'
            ? db.collection('wallets').doc(sellerId)
            : null;
        const sellerWalletSnap = sellerWalletRef ? await tx.get(sellerWalletRef) : null;
        const releaseLedgerRef = db.collection('wallets').doc(sellerId).collection('ledger').doc(`dispute_resolution_${decisionId}`);
        const existingReleaseLedger = !afterRefund && orderResolutionCommitted && freezeCents > 0 ? await tx.get(releaseLedgerRef) : null;
        if (existingReleaseLedger?.exists) throw new HttpsError('failed-precondition', 'Le reçu antérieur de cette libération doit être retrouvé.');
        const sellerWallet = sellerWalletSnap?.data();
        if (!afterRefund && orderResolutionCommitted && freezeCents > 0 && (!sellerWallet || !Number.isSafeInteger(sellerWallet.heldBalance) || sellerWallet.heldBalance < freezeCents ||
            !Number.isSafeInteger(sellerWallet.balance) || sellerWallet.balance < 0 ||
            !Number.isSafeInteger(sellerWallet.balance + freezeCents) || String(sellerWallet.currency).toUpperCase() !== 'CAD')) {
          throw new HttpsError('failed-precondition', 'Le gel et le porte-monnaie doivent être rapprochés avant clôture.');
        }

        // Rencontre : la bulle de chat décide de ses boutons d'après le MESSAGE
        // d'offre. reportMeetupNoShow y pose `offer.meetup.noShow` pour éteindre
        // « Confirmer » et « Signaler une absence ». Restaurer le seul statut de
        // la transaction laissait donc la bulle éteinte : la transaction
        // repartait en `meetup_confirmed` sans qu'aucune des deux parties ne
        // puisse la finaliser, jusqu'à son annulation automatique. On efface le
        // marqueur dans la même transaction que la restauration.
        let meetupOfferRef: FirebaseFirestore.DocumentReference | null = null;
        let meetupOfferSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (
          data.deliveryType === 'meetup' &&
          orderResolutionCommitted && !afterRefund && !releasedCashReservation &&
          typeof data.offerMessageId === 'string' &&
          validDisputeReference(data.offerMessageId)
        ) {
          meetupOfferRef = db.collection('messages').doc(data.offerMessageId);
          meetupOfferSnap = await tx.get(meetupOfferRef);
        }

        // Rencontre : `reportMeetupNoShow` DÉVERROUILLE l'article en gelant la
        // transaction — le vendeur doit pouvoir le remettre en vente pendant
        // l'instruction du litige. Rejeter le signalement remettait la rencontre
        // en vie sans jamais reverrouiller l'article : une transaction
        // `meetup_confirmed` coexistait alors avec un article de nouveau
        // achetable, et le même vêtement pouvait être promis deux fois — sur un
        // règlement en main propre que rien ne réconcilie ensuite.
        // La lecture est faite ICI, avec les autres, parce qu'une transaction
        // Firestore exige toutes ses lectures avant sa première écriture.
        let meetupArticleRef: FirebaseFirestore.DocumentReference | null = null;
        let meetupArticleSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (
          data.deliveryType === 'meetup' &&
          orderResolutionCommitted && !afterRefund && !releasedCashReservation &&
          typeof data.articleId === 'string' &&
          validDisputeReference(data.articleId)
        ) {
          meetupArticleRef = db.collection('articles').doc(data.articleId);
          meetupArticleSnap = await tx.get(meetupArticleRef);
        }

        // Restore the pre-dispute status so the normal release cycle can resume.
        const restored = afterRefund ? 'refunded' : orderResolutionCommitted ? releasedCashReservation ? 'cancelled' :
          returnFinanciallyExamined && purchasePolicyAllowsRelease(data, transactionId, await productRoutingAllowsRelease(tx, transactionId, data), await productMixedOrderAllowsRelease(tx, transactionId, data)) ? 'delivered' : data.statusBeforeDispute : data.status;
        if (!afterRefund && orderResolutionCommitted && (typeof restored !== 'string' || !['paid', 'label_created', 'shipped', 'delivered', 'delivery_failed', 'lost',
          'completed', 'meetup_pending', 'meetup_confirmed', 'meetup_completed', 'cancelled'].includes(restored))) {
          throw new HttpsError('failed-precondition', 'L’état antérieur de cette commande doit être vérifié avant clôture.');
        }
        if (meetupOfferSnap?.exists) {
          const offer = meetupOfferSnap.data()!;
          const chat = validDisputeReference(data.chatId) ? (await tx.get(db.collection('chats').doc(data.chatId))).data() : null;
          if (offer.type !== 'offer' || offer.offer?.transactionId !== transactionId || offer.chatId !== data.chatId ||
              ![data.buyerId, sellerId].includes(offer.senderId) || !Array.isArray(chat?.participants) || chat.participants.length !== 2 ||
              ![data.buyerId, sellerId].every(uid => chat.participants.includes(uid)) ||
              (Array.isArray(offer.participants) && (offer.participants.length !== 2 || ![data.buyerId, sellerId].every(uid => offer.participants.includes(uid))))) {
            throw new HttpsError('failed-precondition', 'Le message de rencontre lié doit être vérifié avant clôture.');
          }
        }
        if (meetupArticleSnap?.exists && meetupArticleSnap.data()?.sellerId !== sellerId) {
          throw new HttpsError('failed-precondition', 'L’article de rencontre lié doit être vérifié avant clôture.');
        }
        let meetupInventoryAcquire: InventoryPlan | null = null;
        if (orderResolutionCommitted && !afterRefund && !releasedCashReservation && data.deliveryType === 'meetup' && ['meetup_pending', 'meetup_confirmed'].includes(restored)) {
          const article = meetupArticleSnap?.data();
          if (!article || (article.activeTransactionId != null && article.activeTransactionId !== transactionId) ||
              (article.isSold === true && article.activeTransactionId !== transactionId)) {
            throw new HttpsError('failed-precondition', 'La disponibilité de l’article doit être rapprochée avant de rétablir la rencontre.');
          }
          const engagement = {kind: 'purchase' as const, id: transactionId, sourceArticleId: meetupArticleRef!.id};
          const alreadyEngaged = await inventoryEngagementMatches(tx, meetupArticleRef!.id, article, engagement, data.inventoryUnitCommitment);
          // Existing native engagements (or an already locked legacy agreement)
          // are servicing. A fresh reservation must acquire the whole declared
          // unit, including aliases, before any write is buffered.
          if (!alreadyEngaged || !Object.prototype.hasOwnProperty.call(article, 'inventoryUnit') &&
              !(article.activeTransactionId === transactionId && article.isSold === true)) {
            meetupInventoryAcquire = await planInventoryAcquire(tx, meetupArticleRef!.id, article, engagement);
          }
        }

        if (!afterRefund && orderResolutionCommitted && freezeCents > 0 &&
            (!await fraudReviewAllowsProgress(tx, transactionId, data, snap) || !(await orderModerationAllowsProgress(tx, { ...data, status: restored, disputed: false })))) {
          throw new HttpsError('failed-precondition',
            'L’instruction de cette commande doit être examinée avant de rendre ces fonds disponibles.');
        }

        const hDisposition = input.allocation ? purchaseRefundCaseDisposition(transactionId, data, decisionId, input.allocation, input.productReview, expectedDisputeId, null) : null;
        if (hDisposition) hDisposition.recordedAt = FieldValue.serverTimestamp() as Timestamp;
        if (hasPurchaseRefundContext(data) && !input.allocation && freezeCents > 0)
          throw new HttpsError('failed-precondition', 'Le règlement structuré courant doit être examiné avant de libérer des fonds.');
        if (input.allocation) assertRecentAccountAuthentication(request.auth!.token);

        const decisionNotices = await prepareOperationalNotices(tx,
          disputeResolutionNotices(transactionId, decisionId, expectedDisputeId, data.buyerId, sellerId, orderResolutionCommitted));

        const dispositionFields=hDisposition?{purchaseRefundCaseDisposition:hDisposition,refundInventoryReviewRequired:true}:{};
        if (afterRefund) {
          // This is only a commercial classification. The settled refund,
          // retained holds and unavailable inventory remain unchanged.
          await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{...dispositionFields,status:'refunded',disputed:!orderResolutionCommitted,lastCommercialCaseDecisionId:decisionId}));
        } else if (orderResolutionCommitted) {
          const txUpdate: Record<string, any> = { status: restored, disputed: false,
            disputeResolvedAt: FieldValue.serverTimestamp(), disputeOutcome: 'dismissed', disputeFreezeCents: 0,
            disputeResolutionNote: input.note, disputeResolvedBy: adminUid, disputeResolutionDecisionId: decisionId };
          if (meetupInventoryAcquire) txUpdate.inventoryUnitCommitment = meetupInventoryAcquire.commitment;
          if (bankHold.proof) {
            // Settle only the inherited reserve whose opening and favourable
            // native closure were qualified above, in the same money commit.
            txUpdate['bankDispute.freezeCents'] = 0;
            txUpdate['bankDispute.commercialHoldRelease'] = { ...bankHold.proof, decisionId,
              releaseLedgerId: releaseLedgerRef.id, releasedAt: FieldValue.serverTimestamp() };
          }
          await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{...dispositionFields,...txUpdate}));
        } else {
          // A decision about one complaint is not a decision about its peers.
          // Preserve the status, hold and every other pending obligation.
          await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, hDisposition?await financialRecoverySourceFields('purchase',txRef,data,{...dispositionFields,disputed:true,lastCommercialCaseDecisionId:decisionId}):{disputed:true,lastCommercialCaseDecisionId:decisionId});
        }

        if (!releasedCashReservation && meetupOfferRef && meetupOfferSnap && meetupOfferSnap.exists) {
          await recoveryCommit({refs: [(meetupOfferRef).path]});
    tx.update(meetupOfferRef, {
            'offer.meetup.noShow': FieldValue.delete(),
          });
        }

        // Reverrouillage de l'article, et seulement si la rencontre repart
        // VIVANTE. Un litige clos sur une transaction annulée ne doit rien
        // reverrouiller.
        if (
          meetupArticleRef &&
          meetupArticleSnap &&
          meetupArticleSnap.exists &&
          !releasedCashReservation &&
          (restored === 'meetup_pending' || restored === 'meetup_confirmed')
        ) {
          meetupInventoryAcquire?.commit();
          await recoveryCommit({refs: [(meetupArticleRef).path]});
    tx.update(meetupArticleRef, { isSold: true, activeTransactionId: transactionId });
        }

        // F37: release the chargeback hold back to withdrawable balance.
        let releasedCents = 0;
        if (
          !afterRefund &&
          freezeCents > 0 &&
          sellerWalletRef &&
          sellerWalletSnap &&
          sellerWalletSnap.exists
        ) {
          const walletData = sellerWalletSnap.data()!;
          releasedCents = freezeCents;
          if (releasedCents > 0) {
            await recoveryCommit({refs: [(sellerWalletRef).path]});
    tx.update(sellerWalletRef, await financialRecoveryWalletFields(sellerWalletRef,walletData,{
              heldBalance: FieldValue.increment(-releasedCents),
              balance: FieldValue.increment(releasedCents),
              updatedAt: FieldValue.serverTimestamp(),
            },{heldBalance: ((walletData)["heldBalance"]??0) + (-releasedCents),balance: ((walletData)["balance"]??0) + (releasedCents)}));
            await recoveryCommit({refs: [(releaseLedgerRef).path]});
    tx.create(releaseLedgerRef, {
              type: 'dispute_hold_released',
              amount: releasedCents,
              currency: 'CAD',
              balanceAfter: walletData.balance + releasedCents,
              description: 'Litige clôturé (en faveur du vendeur) — fonds gelés restitués',
              transactionId,
              disputeDecisionId: decisionId,
              actorUid: adminUid,
              ...(bankHold.proof ? { disputeId: bankHold.proof.bankDisputeId, bankHoldLedgerId: bankHold.proof.holdLedgerId } : {}),
              createdAt: FieldValue.serverTimestamp(),
            });
          }
        }

        // The order, the explicitly examined party-bound ticket and this receipt
        // either commit together or none of them do. No post-commit batch.
        await recoveryCommit({refs: [(targetClaim.ref).path]});
    tx.update(targetClaim.ref, {
            status: 'resolved',
            resolution: 'dismissed',
            resolvedBy: adminUid,
            resolvedAt: FieldValue.serverTimestamp(),
            resolutionNote: input.note,
            resolutionDecisionId: decisionId,
          });
        await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, { schemaVersion: 1, decisionId, transactionId, expectedDisputeId, requestId, actorUid: adminUid,
          previewId, examinedSourceHash: expectedSourceHash,
          ...(input.productReview ? {productReview: input.productReview, operatorAuthTime: request.auth!.token.auth_time} : {}),
          ...(input.allocation ? {allocation: input.allocation, operatorAuthTime: request.auth!.token.auth_time} : {}),
          outcome: 'dismissed', note: input.note, payloadHash: disputeDecisionPayload(input),
          sourceHash: resolutionDigest([transactionId, data.buyerId, sellerId, data.status, restored, freezeCents,
            data.disputedAt instanceof Timestamp ? data.disputedAt.toMillis() : null,
            data.returnRequest?.requestId ?? null, data.returnRequest?.version ?? null,
            openDisputesSnap.docs.map(doc => [doc.id, doc.data().buyerId, doc.data().sellerId,
              doc.data().createdAt.toMillis(), doc.data().statusBeforeDispute ?? null]).sort()]),
          buyerId: data.buyerId, sellerId, sourceStatus: data.status, restored, releasedCents,
          financialSettlementRetained: afterRefund, settledRefundIntentId: settledRefund?.refundIntentId ?? null,
          releaseLedgerId: releasedCents > 0 ? releaseLedgerRef.id : null,
          bankHoldRelease: releasedCents > 0 && bankHold.proof ? { ...bankHold.proof, decisionId,
            releaseLedgerId: releaseLedgerRef.id, releasedAt: FieldValue.serverTimestamp() } : null,
          orderResolutionCommitted, remainingOpenDisputeIds, remainingDisputesOpen: remainingOpenDisputeIds.length, retainedObligations,
          notificationIds: decisionNotices.notificationIds,
          disputeIds, disputesClosed: disputeIds.length, committedAt: FieldValue.serverTimestamp() });
        decisionNotices.commit();
        const firstDispute = targetClaim.data();
        const declarantId = typeof firstDispute?.reportedBy === 'string' ? firstDispute.reportedBy : data.buyerId;
        const daysOpen = firstDispute?.createdAt instanceof Timestamp
          ? Math.round(((Date.now() - firstDispute.createdAt.toMillis()) / 86_400_000) * 100) / 100 : 0;
        return { replay: false as const, restored, releasedCents, sellerId, buyerId: data.buyerId,
          disputesClosed: disputeIds.length, orderResolutionCommitted, remainingDisputesOpen: remainingOpenDisputeIds.length, retainedObligations,
          declarantId, daysOpen };
      });
      if ('replay' in result && result.replay) return result.receipt;
      if ('neutralized' in result) {
        const receipt = await db.runTransaction(async tx => {
          const current = (await tx.get(txRef)).data();
          if (!current) throw new HttpsError('unavailable', 'La commande et le reçu doivent être retrouvés.');
          return readDisputeDecision(tx, input, current);
        });
        if (!receipt || receipt.outcome !== 'not_executed') throw new HttpsError('unavailable', 'Le reçu de neutralisation doit être retrouvé.');
        return { ...receipt, replay: false };
      }

      logger.warn('[resolveDispute] dispute dismissed by admin (favor of seller)', {
        transactionId,
        adminUid,
        restored: result.restored,
        releasedCents: result.releasedCents,
        disputesClosed: result.disputesClosed,
        orderResolutionCommitted: result.orderResolutionCommitted,
        remainingDisputesOpen: result.remainingDisputesOpen,
      });

      // Exact decision + both in-app notices + private transport receipts were
      // committed atomically. Optional push is resumed by the leased worker.

      // Analytics (§12): dispute_resolved — distinct_id = the dispute DECLARANT
      // (reportedBy for a no-show, otherwise the buyer). This resolution dismisses
      // in the seller's favour (release_seller); admin action → automated=false.
      {
        const declarantId = result.declarantId;
        if (declarantId) {
          await captureServerEvent(declarantId, 'dispute_resolved', {
            transaction_id: transactionId,
            resolution: 'release_seller',
            automated: false,
            days_open: result.daysOpen,
            $insert_id: `dispute_resolved_${decisionId}`,
          });
        }
      }

      const receipt = await db.runTransaction(async tx => {
        const currentOrder = (await tx.get(txRef)).data();
        if (!currentOrder) throw new HttpsError('unavailable', 'La commande et le reçu doivent être retrouvés.');
        return readDisputeDecision(tx, input, currentOrder);
      });
      if (!receipt) throw new HttpsError('unavailable', 'Le reçu de la décision doit être retrouvé.');
      return { ...receipt, replay: false };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[resolveDispute] failed', { transactionId, error: message });
      throw new HttpsError('internal', `Failed to resolve dispute: ${message}`);
    }

    });
  }
);

// =============================================================================
// SELLER CANCEL TRANSACTION — Seller cancels a paid order before it ships
// =============================================================================

/**
 * F74 — seller-initiated cancellation AFTER payment but BEFORE the first carrier
 * scan. A seller who can no longer ship (item lost/broken) previously had no way
 * to cancel + refund: the buyer stayed charged and had to wait out the 7-day
 * paid-not-shipped expiry. This callable refunds immediately.
 *
 * Authorization: caller MUST be the seller of the transaction. Rate-limited.
 *
 * Allowed statuses: 'paid' | 'label_created' ONLY. These are exactly the
 * pre-ship statuses (PRESHIP_STATUSES) — once a carrier scans the parcel the tx
 * moves to 'shipped' and this is refused (the item is already in transit; that
 * is a return/dispute, not a seller cancellation).
 *
 * Effect: issueTransactionRefund (key `rf_seller_<txId>` — full buyer refund via
 * Stripe + wallet portion, seller debited exactly what was credited via the
 * wallet cascade) + relist the article (isSold=false) + notify the buyer.
 */

/**
 * F74 — seller-initiated cancellation AFTER payment but BEFORE the first carrier
 * scan. A seller who can no longer ship (item lost/broken) previously had no way
 * to cancel + refund: the buyer stayed charged and had to wait out the 7-day
 * paid-not-shipped expiry. This callable refunds immediately.
 *
 * Authorization: caller MUST be the seller of the transaction. Rate-limited.
 *
 * Allowed statuses: 'paid' | 'label_created' ONLY. These are exactly the
 * pre-ship statuses (PRESHIP_STATUSES) — once a carrier scans the parcel the tx
 * moves to 'shipped' and this is refused (the item is already in transit; that
 * is a return/dispute, not a seller cancellation).
 *
 * Effect: issueTransactionRefund (key `rf_seller_<txId>` — full buyer refund via
 * Stripe + wallet portion, seller debited exactly what was credited via the
 * wallet cascade) + relist the article (isSold=false) + notify the buyer.
 */

export const sellerCancelTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: providerSecretsForDeployment(['STRIPE_SECRET_KEY']) },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/payments/disputes.sellerCancelTransaction"}, async () => {
    if(process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured')return withPrivateAccountSession(request,()=>cancelLocalMeetup(request,true));
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'sellerCancelTransaction',
      maxCallsAuthenticated: 10,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, reason } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const callerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);

    // Pre-read (the Stripe refund must run outside the runTransaction).
    const preSnap = await txRef.get();
    if (!preSnap.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }
    const preData = preSnap.data()!;

    if (preData.sellerId !== callerUid) {
      throw new HttpsError('permission-denied', 'Seul le vendeur peut annuler cette commande');
    }
    assertNoActiveBankDispute(preData);

        // Only pre-ship statuses are seller-cancellable (before the first carrier
    // scan moves the tx to 'shipped').
    const SELLER_CANCELLABLE = new Set(['paid', 'label_created']);
    if (!preData.refund && preData.status !== 'refunded' && !SELLER_CANCELLABLE.has(preData.status)) {
      throw new HttpsError(
        'failed-precondition',
        `Cette commande ne peut plus être annulée (statut ${preData.status}). Une commande déjà expédiée relève d'un retour.`
      );
    }

    try {
      if (!preData.refund && preData.status !== 'refunded') await recordSellerCancellationLabelStop(request, transactionId);
      const result = await issueTransactionRefund(transactionId, preData, {
        reason: typeof reason === 'string' ? reason : 'seller_cancelled',
        idempotencyKey: `rf_seller_${transactionId}`,
        relistArticle: true,
        source: 'sellerCancelTransaction',
        initiatedByUid: callerUid, requiredSellerId: callerUid,
        allowedInitialStatuses: ['paid', 'label_created', 'refunded'],
      });

      if (!result.success || result.alreadyRefunded) return result;
      const settled = (await txRef.get()).data();
      if (settled?.refund?.source !== 'sellerCancelTransaction') return result;

      logger.warn('[sellerCancelTransaction] order cancelled + refunded by seller', {
        transactionId,
        sellerUid: callerUid,
      });

      // The qualified refund core already committed notices for both parties.
      // Avoid a detached duplicate asserting full reimbursement from stale UI.

      // Analytics (§12): order_cancelled follows the BUYER. Seller-initiated,
      // pre-ship. The refund itself is emitted separately (order_refunded) by
      // the charge.refunded webhook.
      if (typeof preData.buyerId === 'string') {
        await captureServerEvent(preData.buyerId, 'order_cancelled', {
          transaction_id: transactionId,
          cancelled_by: 'seller',
          stage: preData.status === 'label_created' ? 'label_created' : 'paid',
          refunded_cents: Math.round(((preData.totalAmount ?? 0) as number) * 100),
          article_relisted: true,
          $insert_id: `order_cancelled_${transactionId}`,
        });
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[sellerCancelTransaction] refund failed', { transactionId, error: message });
      throw new HttpsError('internal', `Cancellation failed: ${message}`);
    }

    });
  }
);

// =============================================================================
// CANCEL PENDING TRANSACTION — Buyer cancels a non-paid transaction
// =============================================================================

/**
 * Buyer cancels a transaction that has not been paid yet (e.g. Stripe
 * checkout failed or was abandoned).
 *
 * Authorization: caller must be the buyer of the transaction. We refuse to
 * cancel transactions whose current status is anything beyond pending —
 * we cannot mark a paid/shipped/delivered transaction as cancelled this way.
 */

/**
 * Buyer cancels a transaction that has not been paid yet (e.g. Stripe
 * checkout failed or was abandoned).
 *
 * Authorization: caller must be the buyer of the transaction. We refuse to
 * cancel transactions whose current status is anything beyond pending —
 * we cannot mark a paid/shipped/delivered transaction as cancelled this way.
 */

export const cancelPendingTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: providerSecretsForDeployment(['STRIPE_SECRET_KEY']) },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/payments/disputes.cancelPendingTransaction"}, async () => {
    if(process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured')return withPrivateAccountSession(request,()=>cancelLocalMeetup(request));
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    if (request.data?.expectedUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'La session de cette annulation a changé.');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'cancelPendingTransaction',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const txRef = db.collection('transactions').doc(transactionId);
    const callerUid = request.auth.uid;

    try {
      // ── F73: cancel the Stripe PaymentIntent BEFORE the Firestore mutation ──
      // A mixed wallet+card 'pending_payment' tx holds an uncaptured PI whose
      // clientSecret the buyer still controls. If we only refund the wallet part
      // and leave the PI confirmable, a late capture -> handlePaymentIntentSucceeded
      // -> 'cancelled_needs_refund' -> issueTransactionRefund would re-credit the
      // wallet a SECOND time. Same pattern as expirePendingPayment: retrieve,
      // refuse to act while in flight/captured, then cancel.
      const preSnap = await txRef.get();
      if (!preSnap.exists) {
        throw new HttpsError('not-found', 'Transaction not found');
      }
      const preData = preSnap.data()!;

      if (preData.buyerId !== callerUid && preData.sellerId !== callerUid) {
        throw new HttpsError('permission-denied', 'Only buyer or seller can cancel');
      }
      assertNoActiveBankDispute(preData);
      assertNoUnsettledRefund(preData);

      if (preData.status === 'cancelled') {
        const replay = await db.runTransaction(async tx => {
          const current = (await tx.get(txRef)).data();
          if (!current || (current.buyerId !== callerUid && current.sellerId !== callerUid)) {
            throw new HttpsError('permission-denied', 'Only buyer or seller can cancel');
          }
          assertNoActiveBankDispute(current); assertNoUnsettledRefund(current);
          return await readPendingCancellationReceipt(tx, transactionId, current)
            ? { success: true, replay: true, currentStatus: 'cancelled', cancellationCommitted: true,
              walletRefundCommitted: true, refundedCents: current.pendingCancellation.walletRefundCents }
            : null;
        });
        if (replay) return replay;
        throw new HttpsError('failed-precondition', 'L’ancienne annulation doit être examinée avant une nouvelle tentative.',
          { reason: 'pending_cancellation_reconciliation_required', action: 'contactSupport' });
      }

      const cancellableStatuses = new Set([
        'pending',
        'pending_payment',
        'meetup_pending',
        'meetup_confirmed',
      ]);
      if (!cancellableStatuses.has(preData.status)) {
        throw new HttpsError(
          'failed-precondition',
          `Cannot cancel transaction in status ${preData.status}`
        );
      }

      const paymentIntentId =
        typeof preData.stripePaymentIntentId === 'string' ? preData.stripePaymentIntentId : null;
      let cancelledPaymentIntent: unknown = null;
      if (paymentIntentId) {
        const stripe = getStripe();
        if (!stripe) {
          throw new HttpsError('failed-precondition', 'Stripe API not configured');
        }
        // PI statuses where money is in flight or already captured — never cancel.
        const STRIPE_PI_IN_FLIGHT = new Set(['requires_capture', 'processing', 'succeeded']);
        let piStatus: string | undefined;
        let observedPaymentIntent: unknown = null;
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          piStatus = pi.status;
          observedPaymentIntent = pi;
          if (piStatus === 'canceled') cancelledPaymentIntent = pi;
        } catch (retrieveErr) {
      if (retrieveErr instanceof FinancialRecoveryBlocked) throw retrieveErr;
          throw new HttpsError(
            'unavailable',
            'Impossible de vérifier le paiement. Réessayez dans un instant.'
          );
        }
        if (piStatus && STRIPE_PI_IN_FLIGHT.has(piStatus)) {
          // The card payment is captured/in flight — cancelling here would risk a
          // double-refund. Refuse; the buyer keeps a paid transaction.
          throw new HttpsError(
            'failed-precondition',
            'Le paiement est en cours de traitement et ne peut plus être annulé.'
          );
        }
        const mayCancel = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          const current = (await tx.get(txRef)).data();
          if (!current || (current.buyerId !== callerUid && current.sellerId !== callerUid)) {
            throw new HttpsError('permission-denied', 'Only buyer or seller can cancel');
          }
          assertNoActiveBankDispute(current); assertNoUnsettledRefund(current);
          if (!cancellableStatuses.has(current.status) || current.stripePaymentIntentId !== paymentIntentId ||
              current.walletCheckoutAttemptId !== preData.walletCheckoutAttemptId) {
            throw new HttpsError('unavailable', 'La commande a changé pendant la vérification. Relisez son état.');
          }
          const proof = await readPendingCancellationFunds(tx, transactionId, current, observedPaymentIntent, false);
          if (proof.qualified) return true;
          await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, { refundBlocked: true, refundLegacyReconciliationRequired: true,
            pendingCancellation: { schemaVersion: 1, state: 'reconciliation_required', transactionId,
              buyerId: typeof current.buyerId === 'string' ? current.buyerId : null,
              sellerId: typeof current.sellerId === 'string' ? current.sellerId : null,
              source: 'participant_cancel_pending', requestedBy: callerUid, reason: proof.reason,
              recordedAt: FieldValue.serverTimestamp() } });
          return false;
        });
        if (!mayCancel) throw new HttpsError('failed-precondition', 'Le paiement doit être rapproché avant toute annulation.',
          { reason: 'pending_cancellation_reconciliation_required', action: 'contactSupport' });
        if (piStatus !== 'canceled') {
          try {
            cancelledPaymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
            logger.info('cancelPendingTransaction: PaymentIntent cancelled', {
              transactionId,
              paymentIntentId,
              piStatusBefore: piStatus,
            });
          } catch (cancelErr) {
      if (cancelErr instanceof FinancialRecoveryBlocked) throw cancelErr;
            // It may have just become uncancelable (e.g. just succeeded) — abort
            // rather than refund the wallet while the card could still capture.
            throw new HttpsError(
              'failed-precondition',
              'Le paiement n\'a pas pu être annulé. Réessayez dans un instant.'
            );
          }
        }
      }

      let cancelBuyerId: string | null = null;
      let cancelRefundCents = 0;
      let cancelRelisted = false;

      const cancellationOutcome = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        // ── ALL READS FIRST (Firestore requires reads before writes) ──
        const snap = await tx.get(txRef);
        if (!snap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }
        const data = snap.data()!;
        cancelBuyerId = typeof data.buyerId === 'string' ? data.buyerId : null;

        // Re-check inside the transaction (idempotent across concurrent calls).
        if (data.buyerId !== callerUid && data.sellerId !== callerUid) {
          throw new HttpsError(
            'permission-denied',
            'Only buyer or seller can cancel'
          );
        }
        assertNoActiveBankDispute(data);
        assertNoUnsettledRefund(data);
        if (data.status === 'cancelled' && await readPendingCancellationReceipt(tx, transactionId, data)) {
          return { qualified: true as const, replay: true, refundedCents: data.pendingCancellation.walletRefundCents };
        }
        if (!cancellableStatuses.has(data.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Cannot cancel transaction in status ${data.status}`
          );
        }

        if ((data.walletCheckoutOutcome === 'unknown' || data.walletCheckoutOutcome === 'creating') && !data.stripePaymentIntentId) {
          throw new HttpsError('unavailable', 'Le paiement doit être vérifié avant de restituer les fonds.');
        }

        if (data.stripePaymentIntentId !== preData.stripePaymentIntentId ||
            data.walletCheckoutAttemptId !== preData.walletCheckoutAttemptId) {
          throw new HttpsError('unavailable', 'Le paiement a changé pendant l’annulation. Réessayez après vérification.');
        }

        const funds = await readPendingCancellationFunds(tx, transactionId, data, cancelledPaymentIntent);
        if (!funds.qualified) {
          await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, { refundBlocked: true, refundLegacyReconciliationRequired: true,
            pendingCancellation: { schemaVersion: 1, state: 'reconciliation_required', transactionId,
              buyerId: typeof data.buyerId === 'string' ? data.buyerId : null,
              sellerId: typeof data.sellerId === 'string' ? data.sellerId : null, source: 'participant_cancel_pending',
              requestedBy: callerUid, reason: funds.reason, recordedAt: FieldValue.serverTimestamp() } });
          return { qualified: false as const, reason: funds.reason };
        }

        // Read the article doc BEFORE any writes (Firestore transaction rule)
        // D2: Guard against deleted article — only update if it still exists
        let articleSnap = null;
        let articleRef = null;
        if (data.articleId) {
          articleRef = db.collection('articles').doc(data.articleId);
          articleSnap = await tx.get(articleRef);
        }

        const articleUnlock = articleRef && articleSnap?.exists
          ? await articleReleaseUpdate(tx, articleRef, articleSnap.data()!, transactionId) : null;

        // Refund only the exact debit/wallet already read and qualified above.
        const walletAmountUsed = funds.walletAmount;
        const hasWalletDebit = walletAmountUsed > 0;

        // La bulle de chat décide de ses boutons d'après le MESSAGE d'offre, pas
        // d'après la transaction. Le correctif b78b657b a couvert l'expiration
        // automatique et le signalement d'absence, mais PAS l'annulation : une
        // rencontre annulée laissait « Confirmer » et « Signaler une absence »
        // affichés, dont chaque appel serait refusé côté serveur. On éteint donc
        // l'offre ici aussi, avec le même marqueur que le balayage (`expired` —
        // le type OfferStatus n'a pas de valeur « annulée »).
        let cancelOfferRef: FirebaseFirestore.DocumentReference | null = null;
        let cancelOfferSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (
          data.deliveryType === 'meetup' &&
          typeof data.offerMessageId === 'string' &&
          data.offerMessageId.length > 0
        ) {
          cancelOfferRef = db.collection('messages').doc(data.offerMessageId);
          cancelOfferSnap = await tx.get(cancelOfferRef);
        }

        const cancellationNotices = await prepareOperationalNotices(tx, [data.buyerId, data.sellerId].map(userId => ({
          eventKey: `participant_canceled:${transactionId}:${funds.intent?.intentId ?? data.offerMessageId ?? 'local'}`, userId,
          type: 'order_cancelled', title: 'Annulation de la commande enregistrée',
          message: 'Une annulation est enregistrée pour cette commande. Consultez la commande et le porte-monnaie pour leurs éventuels mouvements ; le support reste accessible.',
          data: { transactionId, cancelledBy: callerUid,
            ...(data.deliveryType === 'meetup' && typeof data.chatId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.chatId) ? { chatId: data.chatId } : {}) },
        })));

        // ── ALL WRITES AFTER ALL READS ──
        const txUpdate: Record<string, any> = {
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: callerUid,
          pendingCancellation: { schemaVersion: 1, state: 'committed', transactionId,
            buyerId: data.buyerId, sellerId: data.sellerId, source: 'participant_cancel_pending',
            requestedBy: callerUid, walletRefundCents: walletAmountUsed,
            purchaseDebitLedgerId: funds.debitLedgerId, walletRefundLedgerId: hasWalletDebit ? funds.creditRef.id : null,
            cardCapabilityNeutralized: true, committedAt: FieldValue.serverTimestamp() },
        };
        // F73: purge the wallet markers so a late card capture (race between our
        // PI cancel and a confirm) cannot trigger a SECOND wallet re-credit in
        // issueTransactionRefund — it keys on walletAmountUsed/paidVia.
        if (hasWalletDebit) {
          txUpdate.walletAmountUsed = FieldValue.delete();
          txUpdate.paidVia = FieldValue.delete();
        }
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, txUpdate);

        if (cancelOfferRef && cancelOfferSnap && cancelOfferSnap.exists) {
          await recoveryCommit({refs: [(cancelOfferRef).path]});
    tx.update(cancelOfferRef, {
            'offer.status': 'expired',
            'offer.expiredReason': 'meetup_cancelled',
            'offer.expiredAt': FieldValue.serverTimestamp(),
          });
        }

        // Release the article so it can be purchased again.
        // createTransaction marks isSold=true atomically at creation
        // time; cancelling must undo that.
        if (articleRef && articleUnlock) {
          commitArticleRelease(tx, articleRef, articleUnlock);
          cancelRelisted = true;
        }
        if (hasWalletDebit) {
          cancelRefundCents = walletAmountUsed;
        }

        // F03: Refund wallet portion if wallet was debited
        if (hasWalletDebit && funds.wallet) {
          await recoveryCommit({refs: [(funds.walletRef).path]});
    tx.update(funds.walletRef, await financialRecoveryWalletFields(funds.walletRef,funds.wallet,{
            balance: FieldValue.increment(walletAmountUsed),
            updatedAt: FieldValue.serverTimestamp(),
          },{balance: ((funds.wallet)["balance"]??0) + (walletAmountUsed)}));

          await recoveryCommit({refs: [(funds.creditRef).path]});
    tx.create(funds.creditRef, {
            type: 'refund_credit',
            amount: walletAmountUsed,
            balanceAfter: funds.wallet.balance + walletAmountUsed,
            description: 'Remboursement — transaction annulee',
            transactionId,
            currency: 'CAD', purchaseDebitLedgerId: funds.debitLedgerId,
            createdAt: FieldValue.serverTimestamp(),
          });

          logger.info('cancelPendingTransaction: wallet portion refunded', {
            transactionId,
            buyerId: data.buyerId,
            walletAmountRefunded: walletAmountUsed,
          });
        }
        if (funds.intent) { await recoveryCommit({refs: [(funds.intentRef).path]}); tx.update(funds.intentRef, await financialRecoverySourceFields('card_intent',funds.intentRef,funds.intent, { state: 'canceled', providerStatus: 'canceled',
          cardCapabilityNeutralized: true, walletRestitutionLedgerId: hasWalletDebit ? funds.creditRef.id : null,
          cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })); }
        cancellationNotices.commit();
        return { qualified: true as const, replay: false, refundedCents: walletAmountUsed };
      });

      if (!cancellationOutcome.qualified) {
        throw new HttpsError('failed-precondition', 'La restitution doit être rapprochée. Les traces et la réservation sont conservées.',
          { reason: 'pending_cancellation_reconciliation_required', evidenceReason: cancellationOutcome.reason, action: 'contactSupport' });
      }

      // Analytics (§12): order_cancelled follows the BUYER. Cancelled while
      // pending_payment (no card capture — only a wallet portion, if any, is
      // refunded here). cancelled_by derived from who called.
      if (cancelBuyerId) {
        await captureServerEvent(cancelBuyerId, 'order_cancelled', {
          transaction_id: transactionId,
          cancelled_by: callerUid === cancelBuyerId ? 'buyer' : 'seller',
          stage: 'pending_payment',
          refunded_cents: cancelRefundCents,
          article_relisted: cancelRelisted,
          $insert_id: `order_cancelled_${transactionId}`,
        });
      }

      return { success: true, replay: cancellationOutcome.replay, currentStatus: 'cancelled',
        cancellationCommitted: true, walletRefundCommitted: true, refundedCents: cancellationOutcome.refundedCents };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error cancelling transaction:', error);
      throw new HttpsError('internal', `Failed to cancel: ${message}`);
    }

    });
  }
);
