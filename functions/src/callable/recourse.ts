import { FinancialRecoveryBlocked, assertFinancialRecoveryEffect } from "../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint, financialRecoverySourceFields } from "../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
/**
 * Buyer recourse callables — anti-fraud refund & dispute flows.
 *
 * Firebase Functions v2, region northamerica-northeast1.
 *
 * PRINCIPLE (anti-fraud, NON negotiable): we NEVER refund on the buyer's word
 * alone. A tracking exception is not proof of loss, and a returned parcel's
 * arrival does not qualify its contents or authorize a refund.
 *
 *   1. requestRefund(transactionId)
 *        Buyer-only recovery of an existing financial intention. A new request
 *        based only on delivery_failed/lost/EX requires human examination;
 *        reserve refuses it before any new intent or money effect.
 *
 *   2. reportTransactionProblem(transactionId, reason, details?)
 *        Buyer-only "delivered but problem" report. NO money movement. Freezes
 *        the funds (disputed=true), records buyerReport + statusBeforeDispute,
 *        opens a `disputes` doc for admin review. Refuses a re-report.
 *
 *   3. requestReturn(transactionId, reason)
 *        Buyer-only "item not as described, sending it back". ALLOWED only on a
 *        DELIVERED shipping transaction still inside the 7-day window. Buys a
 *        RETURN label (origin = buyer shipping address, destination = seller
 *        origin address), with a native hold before preparation and explicit
 *        quote acceptance before the single label purchase. A return DELIVERED
 *        scan records parcel arrival and opens content/refund instruction.
 *        It does not prove the contents or authorize a deduction/refund.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { issueTransactionRefund } from '../utils/refund';
import {lateCommercialRecourse, LATE_COMMERCIAL_CAPABILITY} from '../utils/lateCommercialRecourse';
import {COMMERCIAL_CLAIM_REVIEW_CAPABILITY, handleCommercialClaimReview} from '../utils/commercialClaimReview';
import {
  getShipEngine,
  type ShipEngineLabel,
  ShipEngineLabelPurchaseError,
} from '../config/shipEngine';
import { Timestamp } from 'firebase-admin/firestore';
import { captureServerEvent } from '../lib/analytics';
import { assertNoActiveBankDispute, hasActiveBankDispute, hasCommercialDispute } from '../utils/bankDispute';
import { assertNoUnsettledRefund, hasUnsettledRefund } from '../utils/refundState';
import { hasUnsettledReturnRequest, qualifiedReturnRequest, returnRequestSourceHash, returnRequestView, committedReturnReceipt, frozenReturnContext, qualifiedReturnQuote, returnHash, returnPreparationCanAmend } from '../utils/returnRequest';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { exactCents, consistentRateDetails } from '../utils/shippingPurchaseRate';
import { readOrderModeration } from '../utils/orderModeration';
import { supportHash, supportSourceHash, supportId, supportObject, supportRequestId, supportUid, supportCurrentAdminSession } from '../utils/supportRequest';
import { fraudReviewAllowsProgress } from '../utils/fraudReviewDecision';
import { deliveryCorrectionBlocksProgress } from '../utils/orderModeration';
import { effectivePurchaseReleaseAt } from '../utils/purchasePolicy';
import { productPhysicalAllowsLeg } from '../utils/productPhysicalInstruction';
import {productReviewCaseId, productReviewCaseRef, readProductReviewSource} from '../utils/productReviewSource';
import {readProductReviewContributionProof} from '../utils/productReviewContributions';
import {prepareOperationalNotices, readOperationalNoticeReceipts} from '../utils/notifications';
import {PRODUCT_MATERIAL_REVIEW_ENABLED, productMaterialRequested} from '../utils/productReviewMaterial';
import {readCommercialReturnAdmission, productMaterialReturnContextRequired, parseCommercialReturnReference, commercialReturnExpectedStatus, type CommercialReturnReference} from '../utils/productCommercialReturn';
import {productParcelReport} from '../utils/productParcelRecourse';
import {readParcelClaimHistory, PARCEL_CLAIM_HISTORY_CAPABILITY} from '../utils/parcelClaimHistory';
import {assertProductParcelNewOpen, productParcelRequested, PRODUCT_PARCEL_REVIEW_ENABLED} from '../utils/productReviewParcel';
import {labelLifecycleAllowsLeg,labelRouteAmendmentPreparationBasis} from '../utils/labelLifecycle';
import {readAcceptedRouteAmendment,readHistoricalRouteAmendment,LABEL_ROUTE_AMENDMENT_ENABLED,LABEL_ROUTE_AMENDMENT_CAPABILITY} from '../utils/labelRouteAmendment';
import {CONVENIENCE_RETURN_CAPABILITY, CONVENIENCE_RETURN_POLICY_CAPABILITY, handleConvenienceReturn, parseConvenienceReturnReference,
  readConvenienceReturnAgreement} from '../utils/convenienceReturn';
import {costTermsHash, prepareConvenienceReturnCostReservation, readConvenienceReturnCostQuote, readConvenienceReturnFinancing,
  readEffectiveConvenienceReturnFinancing} from '../utils/convenienceReturnFinancial';
import {assertPrivateAccountSession, withPrivateAccountSession} from '../utils/privateAccountSession';
import {assertNewPaymentsEnabled, isShippingEnabled} from '../config/featureFlags';
import {assertNewPaidShippingCoverageQualified} from '../utils/shippingLaunchAdmission';
import {CONVENIENCE_RETURN_INCIDENT_CAPABILITY, handleConvenienceReturnIncident, prepareConvenienceReturnAbsentIntent, readConvenienceReturnTerminal,
  convenienceReturnTerminalView, recordConvenienceReturnLateObservation} from '../utils/convenienceReturnIncident';
import {RETURN_DEPOSIT_TERMS} from '../utils/returnDepositTerms';
import {hasReturnDepositTerms, prepareInitialReturnDocumentFurnishing, qualifyReturnLabelDocument, returnDocumentFurnished, returnDepositAllowsNewDeposit} from '../utils/returnDepositDeadline';
import {assertAccountSecurityOpen} from '../utils/eligibility';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Allowed reason codes for a buyer-initiated return ("item not as described"). */
const RETURN_REASONS = new Set(['not_as_described', 'damaged', 'wrong_item', 'other', 'change_of_mind']);
const CONVENIENCE_RETURN_SHIPPING_CAPABILITY = 'convenience_return_shipping_v1';
function assertNewConvenienceReturnPurchaseOpen() {
  assertNewPaymentsEnabled();
  if (!isShippingEnabled()) throw new HttpsError('failed-precondition', 'La livraison n’est pas disponible pour le moment.');
  assertNewPaidShippingCoverageQualified();
}
async function assertReturnNotTerminal(tx: FirebaseFirestore.Transaction, id: string, requestId: string) {
  if (await readConvenienceReturnTerminal(tx, id, requestId)) throw new HttpsError('failed-precondition',
    'Cette intention de retour est définitivement clôturée. Relisez son reçu.', {reason: 'convenience_return_closed'});
}
/** The agreement is native, and its pre-reservation source is CURRENT. Once
 * financing is reserved, only that exact native reservation can be serviced. */
async function convenienceReturnPreparationCurrent(tx: FirebaseFirestore.Transaction, id: string, data: FirebaseFirestore.DocumentData) {
  const r = data.returnRequest, basis = r?.convenienceReturnBasis;
  if (r?.schemaVersion !== 2 || r.reason !== 'change_of_mind' || !qualifiedReturnRequest(id, data)) return false;
  const agreement = await readConvenienceReturnAgreement(tx, id, data, r.convenienceReturn,
    {requireCurrentSource: !Object.prototype.hasOwnProperty.call(data, 'convenienceReturnFinancialReservation')});
  if (!agreement || basis.proposalId !== agreement.proposal.proposalId || basis.agreementContentHash !== agreement.contentHash ||
      basis.agreementSourceHash !== agreement.proposal.sourceHash || basis.termsHash !== supportSourceHash(agreement.proposal.terms) ||
      !basis.acceptedAt.isEqual(agreement.response.recordedAt)) return false;
  if (Object.prototype.hasOwnProperty.call(data, 'convenienceReturnFinancialReservation'))
    return !!await readConvenienceReturnFinancing(tx, id, data);
  await readConvenienceReturnCostQuote(tx, id, data, {requestId: r.requestId, agreement: r.convenienceReturn,
    costCents: r.quote?.expectedCostCents ?? 0});
  return true;
}

/** A return's own recourse hold is expected. Only the current native
 * moderation instruction may lift its separate pause for a NEW preparation. */
async function returnModerationAllowsPreparation(tx: FirebaseFirestore.Transaction, data: FirebaseFirestore.DocumentData, transactionId: string, suppliedCommercial?: CommercialReturnReference, amendedReturnPreparation = false, newConvenience = false) {
  const commercial = data.returnRequest?.commercialReturn ?? suppliedCommercial;
  // Historical "other" receipts remain serviceable, but cannot authorize a
  // new convenience label. A documentary seller agreement settles no cost.
  if (data.returnRequest?.reason === 'change_of_mind' && !await convenienceReturnPreparationCurrent(tx, transactionId, data) ||
      data.returnRequest?.reason === 'other' && !commercial || newConvenience && commercial) return false;
  if (await productMaterialReturnContextRequired(tx, transactionId, data)) {
    if (!commercial || !PRODUCT_MATERIAL_REVIEW_ENABLED || !(await readCommercialReturnAdmission(tx, transactionId, data, commercial)).allowed) return false;
  }
  if (!await productPhysicalAllowsLeg(tx, data, 'return', transactionId)) return false;
  if (!await labelLifecycleAllowsLeg(tx, transactionId, data, 'return', amendedReturnPreparation)) return false;
  const state = await readOrderModeration(tx, data);
  return state === null || state.sourceQualified && state.action === 'continue' &&
    state.otherBlockers.every(blocker => blocker === 'order_recourse');
}

/** Allowed reason codes for a "delivered but problem" buyer report. */
const REPORT_REASONS = new Set([
  'not_received_despite_delivered',
  'not_as_described',
  'damaged',
  'other',
]);

/**
 * Statuses from which a buyer may file a "delivered but problem" report.
 *
 * ONLY `delivered`: the report freezes funds inside the 7-day dispute window
 * while they still sit in the seller's `heldBalance`. `shipped` is in-transit
 * (a tracking incident goes through human support); `completed` means
 * the window has elapsed and funds were already released to (and possibly
 * withdrawn from) the seller's withdrawable `balance` — re-freezing then would
 * require a balance->heldBalance claw-back coordinated with releaseHeldFunds
 * (out of scope here), so a post-window report is refused and routed to admin.
 */
const REPORTABLE_STATUSES = new Set(['delivered']);

type ProductProblemReference = {caseId: string; caseVersion: number; caseSourceHash: string;
  contributionId: string; contributionHash: string; sourceHash: string; topic: 'authenticity' | 'nonconformity'; materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1'};
function productProblemReference(value: unknown, topic: 'authenticity' | 'nonconformity' = 'authenticity', material = false, parcel = false): ProductProblemReference {
  const r = supportObject(value, ['caseId', 'caseVersion', 'caseSourceHash', 'contributionId', 'contributionHash', 'sourceHash', 'topic', 'materialCapability', 'parcelCapability']);
  if (!/^pr_[a-f0-9]{64}$/.test(r.caseId ?? '') || !/^pc_[a-f0-9]{64}$/.test(r.contributionId ?? '') || r.topic !== topic ||
      !Number.isSafeInteger(r.caseVersion) || r.caseVersion < 1 ||
      !['caseSourceHash', 'contributionHash', 'sourceHash'].every(key => typeof r[key] === 'string' && /^[a-f0-9]{64}$/.test(r[key])) ||
      r.materialCapability !== undefined && r.materialCapability !== 'product_review_material_v1' || (r.materialCapability !== undefined) !== material ||
      r.parcelCapability !== undefined && r.parcelCapability !== 'product_review_parcel_v1' || (r.parcelCapability !== undefined) !== parcel)
    throw new HttpsError('invalid-argument', 'Référence native de contribution et de dossier requise.');
  return {caseId: r.caseId, caseVersion: r.caseVersion, caseSourceHash: r.caseSourceHash, contributionId: r.contributionId,
    contributionHash: r.contributionHash, sourceHash: r.sourceHash, topic, ...(material ? {materialCapability: 'product_review_material_v1' as const} : {}),
    ...(parcel ? {parcelCapability: 'product_review_parcel_v1' as const} : {})};
}
async function productProblemSource(tx: FirebaseFirestore.Transaction, transactionId: string, uid: string, contributionId: string, topic: 'authenticity' | 'nonconformity' = 'authenticity', material = false, parcel = false) {
  const context = {kind: 'order' as const, id: transactionId}, source = await readProductReviewSource(tx, context, material, parcel), root = source.caseSnap.data();
  if (source.document.nativeActors.buyerId !== uid) throw new HttpsError('permission-denied', 'Ce dossier n’appartient pas à votre compte acheteur.');
  const row = (await tx.get(productReviewCaseRef(context).collection('contributions').doc(contributionId))).data();
  const contribution = await readProductReviewContributionProof(tx, context, contributionId, row);
  if (!root || root.protocol !== 'product_review_case_v1' || root.caseId !== productReviewCaseId(context) ||
      supportHash(root.context) !== supportHash(context) || !Number.isSafeInteger(root.version) || root.version < 1 ||
      !(root.createdAt instanceof Timestamp) || root.createdAt.toMillis() < 0 || root.createdAt.toMillis() > Date.now() ||
      !contribution || contribution.actorId !== uid || contribution.actorRole !== 'buyer' || contribution.topic !== topic ||
      topic === 'nonconformity' && !contribution.command.materialStatement) return null;
  return {caseId: source.caseId, caseVersion: root.version, caseSourceHash: supportSourceHash(root),
    contributionId, contributionHash: row!.contentHash, sourceHash: source.sourceHash, topic, ...(material ? {materialCapability: 'product_review_material_v1' as const} : {}),
    ...(parcel ? {parcelCapability: 'product_review_parcel_v1' as const} : {})};
}
function productProblemNotices(transactionId: string, disputeId: string, reference: ProductProblemReference, buyerId: string, sellerId: string) {
  return [buyerId, sellerId].map(userId => ({eventKey: `${reference.topic === 'nonconformity' ? 'product_material_problem_v1' : 'product_authenticity_problem_v1'}:${disputeId}`, userId,
    type: 'product_review_update', title: 'Examen de l’article et recours',
    message: reference.topic === 'nonconformity' ? 'Une différence déclarée entre l’article promis et reçu a été reliée à cette commande pour examen humain dans la fenêtre du recours. Cette déclaration ne prouve ni les faits physiques ni une faute et ne décide d’aucun remboursement.' : 'Une contestation d’authenticité a été reliée à cette commande pour examen humain dans la fenêtre du recours. Cette déclaration ne prouve ni une contrefaçon ni une faute et ne décide d’aucun remboursement.',
    data: {ownerId: userId, transactionId, disputeId, productReviewCaseId: reference.caseId, contextKind: 'order', contextId: transactionId}}));
}

type WholeSetDeclaration = { protocol: 'whole_set_declaration_v1'; snapshotHash: string;
  claim: 'incomplete_set' | 'other_nonconformity';
  received: {status: 'described' | 'unknown'; description: string | null};
  missing: {status: 'described' | 'none_observed' | 'unknown'; description: string | null};
  recourseScope: 'whole_transaction' };
function wholeSetDeclaration(raw: unknown): WholeSetDeclaration {
  const value = supportObject(raw, ['protocol', 'snapshotHash', 'claim', 'received', 'missing', 'recourseScope']);
  const observation = (input: unknown, missing: boolean) => {
    const item = supportObject(input, ['status', 'description']);
    if (!(missing ? ['described', 'none_observed', 'unknown'] : ['described', 'unknown']).includes(item.status as string) ||
        (item.status === 'described' ? typeof item.description !== 'string' || !item.description.trim() || item.description.length > 1000
          : item.description !== null)) throw new HttpsError('invalid-argument', 'Décrivez votre observation ou indiquez explicitement qu’elle est inconnue.');
    return {status: item.status as 'described' | 'none_observed' | 'unknown',
      description: item.status === 'described' ? (item.description as string).trim() : null};
  };
  const received = observation(value.received, false), missing = observation(value.missing, true);
  if (value.protocol !== 'whole_set_declaration_v1' || typeof value.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.snapshotHash) ||
      !['incomplete_set', 'other_nonconformity'].includes(value.claim as string) || value.recourseScope !== 'whole_transaction' ||
      value.claim === 'incomplete_set' && missing.status === 'none_observed')
    throw new HttpsError('invalid-argument', 'Le signalement doit viser l’ensemble promis entier et préciser ce qui est reçu et ce qui manque.');
  return {protocol: 'whole_set_declaration_v1', snapshotHash: value.snapshotHash as string,
    claim: value.claim as WholeSetDeclaration['claim'], received: received as WholeSetDeclaration['received'], missing,
    recourseScope: 'whole_transaction'};
}
/** The native contract is the source, never a current listing/photo or a
 * description regex. This binds an observation, not physical receipt/fault. */
function wholeSetSnapshot(transactionId: string, data: FirebaseFirestore.DocumentData) {
  const item = data.articleSnapshot;
  if (!item || typeof item !== 'object' || Array.isArray(item) ||
      typeof item.title !== 'string' || !item.title.trim() || typeof item.description !== 'string' || !item.description.trim() ||
      typeof data.articleId !== 'string' || !data.articleId || data.articleId.includes('/') ||
      typeof data.buyerId !== 'string' || !data.buyerId || data.buyerId.includes('/') ||
      typeof data.sellerId !== 'string' || !data.sellerId || data.sellerId.includes('/') || data.buyerId === data.sellerId)
    return {qualification: 'unknown' as const, source: null};
  // Only a real native snapshot with no own unit field qualifies this
  // historical absence. Null/malformed fields and a missing snapshot are
  // unknown; absence never asserts a physical single article or a set.
  if (!Object.prototype.hasOwnProperty.call(item, 'saleUnit'))
    return {qualification: 'historical_unit_unrecorded' as const, source: null};
  if (item.saleUnit === 'single_article') return {qualification: 'not_a_set' as const, source: null};
  if (item.saleUnit !== 'set_as_one') return {qualification: 'unknown' as const, source: null};
  return {qualification: 'native_whole_set_snapshot' as const, source: {
    snapshotHash: supportSourceHash(['whole_set_report_source_v1', transactionId, data.articleId, data.buyerId, data.sellerId, item]),
    articleId: data.articleId as string, saleUnit: 'set_as_one' as const, title: item.title as string, description: item.description as string }};
}

// =============================================================================
// requestRefund — Existing intention recovery; new incidents need human review
// =============================================================================

/**
 * Existing native financial intents/legacy reconciliation have priority inside
 * reserve. No fresh intention is authorized from a carrier exception or a local
 * delivery_failed/lost status. These incidents route to human support.
 */
export const requestRefund = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/recourse.requestRefund"}, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'requestRefund',
      maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0 || transactionId.length > 200 || transactionId.includes('/')) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const txRef = db.collection('transactions').doc(transactionId);
    const preSnap = await txRef.get();
    if (!preSnap.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }
    const preData = preSnap.data()!;

    // Buyer-only.
    if (preData.buyerId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the buyer can request this refund');
    }
    return issueTransactionRefund(transactionId, preData, {
      reason: 'buyer_requested_refund', idempotencyKey: `rf_buyer_${transactionId}`,
      relistArticle: false, source: 'requestRefund', initiatedByUid: request.auth.uid, requiredBuyerId: request.auth.uid,
      ...(typeof preData.refund?.intentId === 'string' ? { expectedRefundIntentId: preData.refund.intentId } : {}),
    });

    });
  }
);

// =============================================================================
// reportTransactionProblem — Buyer flags a delivered-but-problematic order
// =============================================================================

/**
 * Buyer reports a problem on a DELIVERED order ("delivered but problem").
 *
 * NO money moves. This freezes the funds by setting `disputed=true` (the
 * held-funds release job already blocks on `disputed === true`), records the
 * buyer report and the pre-dispute status, sets status `disputed`, opens a
 * `disputes` doc for admin review and notifies the admin team. A second report
 * on an already-disputed transaction is refused.
 *
 * Resolution (refund / no-refund) is an ADMIN decision via
 * adminRefundTransaction — this function never decides the outcome.
 */
export const reportTransactionProblem = onCall(
  // 512MiB (aligné sur requestRefund/requestReturn): tout le bundle functions
  // est chargé au cold-start ; 256MiB faisait échouer le healthcheck Cloud Run.
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/recourse.reportTransactionProblem"}, async () => {
    const buyerUid = supportUid(request);
    if (request.data?.capability === COMMERCIAL_CLAIM_REVIEW_CAPABILITY) return handleCommercialClaimReview(request);
    if (request.data?.capability === PARCEL_CLAIM_HISTORY_CAPABILITY) return readParcelClaimHistory(request);
    if (request.data?.capability === LATE_COMMERCIAL_CAPABILITY) return lateCommercialRecourse(request);
    if (request.data?.capability === 'product_parcel_report_v1') return productParcelReport(request);
    const input = supportObject(request.data, ['expectedUid', 'transactionId', 'requestId', 'reason', 'details', 'mode', 'capability', 'materialCapability', 'parcelCapability', 'setDeclaration', 'productReview', 'contributionId', 'accepted']);
    const transactionId = supportId(input.transactionId);
    const material = productMaterialRequested(input), parcel = productParcelRequested(input), nonconformity = input.capability === 'product_material_report_v1';
    if (nonconformity && !material || (material || parcel) && !['product_authenticity_report_v1', 'product_material_report_v1'].includes(input.capability))
      throw new HttpsError('invalid-argument', 'Version matérielle et recours produit explicites requis.');
    if (input.mode === 'source_observe') {
      if (['product_authenticity_report_v1', 'product_material_report_v1'].includes(input.capability)) {
        assertProductParcelNewOpen(parcel);
        if (material && !PRODUCT_MATERIAL_REVIEW_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours matériel est en préparation.', {reason: 'product_material_review_not_exposed'});
        if (!/^pc_[a-f0-9]{64}$/.test(input.contributionId ?? '') || ['requestId', 'reason', 'details', 'setDeclaration', 'productReview', 'accepted'].some(key => input[key] !== undefined))
          throw new HttpsError('invalid-argument', 'Lecture explicite d’une contribution d’authenticité requise.');
        return db.runTransaction(async tx => ({protocol: nonconformity ? 'product_material_report_source_v1' : 'product_authenticity_report_source_v1', ownerId: buyerUid, transactionId,
          productReview: await productProblemSource(tx, transactionId, buyerUid, input.contributionId, nonconformity ? 'nonconformity' : 'authenticity', material, parcel),
          authenticityVerified: false, faultEstablished: false, financialEffect: 'none', freezePermissionGranted: false}));
      }
      if (input.capability !== 'whole_set_report_v1' || ['requestId', 'reason', 'details', 'setDeclaration'].some(key => input[key] !== undefined))
        throw new HttpsError('invalid-argument', 'Une lecture explicite du contrat de l’ensemble est requise.');
      return db.runTransaction(async tx => {
        const data = (await tx.get(db.collection('transactions').doc(transactionId))).data();
        if (!data || data.buyerId !== buyerUid) throw new HttpsError('permission-denied', 'Pas votre recours.');
        return {protocol: 'whole_set_report_source_v1', ownerId: buyerUid, transactionId, ...wholeSetSnapshot(transactionId, data),
          physicalReceiptVerified: false, faultEstablished: false, financialEffect: 'none', recourseScope: 'whole_transaction'};
      });
    }
    const product = nonconformity || input.capability === 'product_authenticity_report_v1';
    if (input.capability !== undefined && !product || !product && ['productReview', 'contributionId', 'accepted'].some(key => input[key] !== undefined) || input.contributionId !== undefined)
      throw new HttpsError('invalid-argument', 'Capacité ou champs de signalement incompatibles.');
    const productReview = product ? productProblemReference(input.productReview, nonconformity ? 'nonconformity' : 'authenticity', material, parcel) : null;
    const requestId = supportRequestId(input.requestId);
    const { reason, details, mode } = input;
    if (!(product ? ['execute', 'observe', 'neutralize'] : ['execute', 'observe']).includes(mode)) throw new HttpsError('invalid-argument', 'Mode invalide.');
    if (product && (!(nonconformity ? ['not_as_described', 'other', 'wrong_item', 'damaged'] : ['not_as_described', 'other']).includes(reason) || mode !== 'observe' && input.accepted !== true))
      throw new HttpsError('invalid-argument', 'Contestation et accord explicites requis.');
    if (typeof reason !== 'string' || !(REPORT_REASONS.has(reason) || nonconformity && reason === 'wrong_item')) {
      throw new HttpsError(
        'invalid-argument',
        'Un motif de réclamation valide est requis'
      );
    }
    // details is optional free text; trim + cap. Omit the field if empty.
    if (details != null && (typeof details !== 'string' || details.length > 1000)) throw new HttpsError('invalid-argument', 'Description invalide.');
    const trimmedDetails =
      typeof details === 'string' && details.trim().length > 0
        ? details.trim().substring(0, 1000)
        : null;

    const txRef = db.collection('transactions').doc(transactionId);
    const setDeclaration = input.setDeclaration === undefined ? null : wholeSetDeclaration(input.setDeclaration);
    if (setDeclaration && reason !== 'not_as_described') throw new HttpsError('invalid-argument', 'La déclaration d’ensemble accompagne le motif non conforme.');
    // Absence preserves every byte of the historical payload hash/receipt.
    const extension = {...(setDeclaration ? {setDeclaration} : {}), ...(productReview ? {productReview} : {})};
    const payloadHash = supportHash({ reason, details: trimmedDetails, ...extension });
    const receiptRef = txRef.collection('problem_requests').doc(supportHash([buyerUid, requestId]));
    const nativeDisputeId = 'problem_' + supportHash([buyerUid, transactionId, requestId]);
    if (mode === 'execute' && !(await receiptRef.get()).exists) {
      await checkRateLimit(buyerUid, true, { functionName: 'reportTransactionProblem', maxCallsAuthenticated: 5,
        maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    }
    let disputeHeldCents = 0;
    const outcome = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const [snap, receiptSnap] = await tx.getAll(txRef, receiptRef);
      const native = receiptSnap.data();
      if (native) {
        if (native.protocol !== 'transaction_problem_report_v1' || native.ownerId !== buyerUid || native.transactionId !== transactionId ||
            native.requestId !== requestId || native.payloadHash !== payloadHash ||
            supportHash(native.productReview ?? null) !== supportHash(productReview) ||
            supportHash(native.setDeclaration ?? null) !== supportHash(setDeclaration)) throw new HttpsError('already-exists', 'Identifiant déjà utilisé pour un autre signalement.');
        const committed = native.state === 'committed';
        if (!['committed', 'not_executed'].includes(native.state) || native.committed !== committed || native.freezeCommitted !== committed ||
            (committed ? native.disputeId !== nativeDisputeId || native.reason !== null : native.disputeId !== null || typeof native.reason !== 'string') ||
            typeof native.reportedAt !== 'string' || !Number.isFinite(Date.parse(native.reportedAt)) || native.financialEffect !== 'none' ||
            native.admissionVerified !== false || native.externalRecourseDeadlineExtended !== false) {
          throw new HttpsError('failed-precondition', 'Reçu de signalement non qualifié.');
        }
        if (productReview && committed) {
          const linked = (await tx.get(db.collection('disputes').doc(nativeDisputeId))).data();
          if (!linked || linked.transactionId !== transactionId || linked.buyerId !== buyerUid || typeof linked.sellerId !== 'string' || !linked.sellerId || linked.sellerId.includes('/') || linked.sellerId === buyerUid ||
              linked.reportRequestId !== requestId || linked.reportOwnerId !== buyerUid || linked.reportPayloadHash !== payloadHash ||
              supportHash(linked.productReview) !== supportHash(productReview) || !(linked.createdAt instanceof Timestamp) ||
              !Array.isArray(native.notificationIds) || native.notificationIds.length !== 2)
            throw new HttpsError('failed-precondition', 'La liaison native et les avis du recours doivent être rapprochés.');
          const notices = await readOperationalNoticeReceipts(tx, productProblemNotices(transactionId, nativeDisputeId, productReview, buyerUid, linked.sellerId));
          if (notices.some((receipt, index) => !receipt || receipt.notificationId !== native.notificationIds[index]))
            throw new HttpsError('failed-precondition', 'Les reçus natifs des avis du recours doivent être retrouvés.');
        }
        return { protocol: native.protocol, ownerId: buyerUid, transactionId, requestId, payloadHash, state: native.state,
          committed, replay: true, disputeId: native.disputeId, reportedAt: native.reportedAt, freezeCommitted: committed,
          reason: native.reason, ...extension, admissionVerified: false, financialEffect: 'none', externalRecourseDeadlineExtended: false };
      }
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Transaction not found');
      }
      const data = snap.data()!;

      // Buyer-only.
      if (data.buyerId !== buyerUid) {
        throw new HttpsError('permission-denied', 'Only the buyer can report a problem');
      }
      if (mode === 'observe') return { protocol: 'transaction_problem_report_v1', ownerId: buyerUid, transactionId, requestId, payloadHash,
        state: 'unrecorded', committed: false, replay: false, disputeId: null, reportedAt: null, freezeCommitted: false, reason: null,
        ...extension, admissionVerified: false, financialEffect: 'none', externalRecourseDeadlineExtended: false };
      const nowMs = Date.now();
      const reject = (rejection: string) => {
        const receipt = { protocol: 'transaction_problem_report_v1', ownerId: buyerUid, transactionId, requestId, payloadHash,
          state: 'not_executed', committed: false, disputeId: null, reportedAt: new Date(nowMs).toISOString(), freezeCommitted: false,
          reason: rejection, ...extension, admissionVerified: false, financialEffect: 'none', externalRecourseDeadlineExtended: false };
        tx.create(receiptRef, receipt);
        return { ...receipt, replay: false };
      };

      if (mode === 'neutralize') return reject('requester_neutralized');
      if (material && !PRODUCT_MATERIAL_REVIEW_ENABLED) return reject('product_material_review_not_exposed');
      if (parcel && !PRODUCT_PARCEL_REVIEW_ENABLED) return reject('product_parcel_review_not_exposed');
      if (productReview) {
        const current = await productProblemSource(tx, transactionId, buyerUid, productReview.contributionId, productReview.topic, productReview.materialCapability === 'product_review_material_v1', productReview.parcelCapability === 'product_review_parcel_v1');
        if (!current || supportHash(current) !== supportHash(productReview)) return reject('product_review_source_changed');
      }

      const setSource = wholeSetSnapshot(transactionId, data);
      if (reason === 'not_as_described' && data.articleSnapshot?.saleUnit === 'set_as_one' && !setDeclaration)
        return reject('set_content_declaration_required');
      if (setDeclaration && (!setSource.source || setSource.qualification !== 'native_whole_set_snapshot'))
        return reject('set_contract_source_unqualified');
      if (setDeclaration && setDeclaration.snapshotHash !== setSource.source!.snapshotHash)
        return reject('set_contract_source_changed');

      disputeHeldCents =
        typeof data.sellerCreditedCents === 'number'
          ? data.sellerCreditedCents
          : Math.round(((data.sellerPayout ?? data.amount ?? 0) as number) * 100);

      // Refuse a re-report on an already-disputed / resolved transaction.
      if (hasCommercialDispute(data)) {
        return reject('existing_commercial_dispute');
      }
      if (data.status === 'refunded' && !hasUnsettledRefund(data)) {
        return reject('already_refunded');
      }

      // Only "delivered-window" statuses can be reported as problematic.
      const bankActive = hasActiveBankDispute(data);
      const commercialStatus = bankActive
        ? data.bankDispute?.statusBeforeOpen ?? data.statusBeforeDispute ?? data.refund?.originalStatus ?? data.status : hasUnsettledRefund(data) ? data.refund?.originalStatus ?? data.status : data.status;
      if (!REPORTABLE_STATUSES.has(commercialStatus)) {
        return reject('outside_commercial_window');
      }

      // 7-day dispute window: the report freezes funds while they still sit in
      // the seller's heldBalance. Once the funds have been released
      // (fundsReleasedAt set) or the release deadline has passed, the window is
      // closed — refuse and route the buyer to admin support (no auto re-freeze
      // of already-withdrawable funds here).
      if (data.fundsReleasedAt) {
        return reject('outside_commercial_window');
      }
      const releaseAtMs = effectivePurchaseReleaseAt(data, transactionId)?.toMillis() ?? null;
      if (productReview && releaseAtMs === null) return reject('commercial_clock_unqualified');
      if (Object.prototype.hasOwnProperty.call(data, 'deliveryCorrection') && releaseAtMs === null)
        return reject('outside_commercial_window');
      if (releaseAtMs !== null && releaseAtMs <= Date.now()) {
        return reject('outside_commercial_window');
      }

      const productNotices = productReview ? await prepareOperationalNotices(tx,
        productProblemNotices(transactionId, nativeDisputeId, productReview, data.buyerId, data.sellerId)) : null;
      if (productReview && (await tx.get(db.collection('disputes').doc(nativeDisputeId))).exists)
        throw new HttpsError('unavailable', 'Le litige sans son reçu doit être rapproché.');

      // Freeze funds + flag dispute. NO money movement here.
      await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, {
        status: hasUnsettledRefund(data) ? data.status : 'disputed',
        disputed: true,
        statusBeforeDispute: commercialStatus,
        buyerReport: {
          reason,
          requestId, disputeId: nativeDisputeId, protocol: 'transaction_problem_report_v1', payloadHash,
          ...(trimmedDetails !== null ? { details: trimmedDetails } : {}),
          ...extension,
          ...(setDeclaration ? {setContract: setSource.source, physicalReceiptVerified: false, faultEstablished: false, recourseScope: 'whole_transaction'} : {}),
          reportedAt: FieldValue.serverTimestamp(),
        },
        disputedAt: FieldValue.serverTimestamp(),
        ...(data.bankDispute ? { 'bankDispute.commercialDisputedBeforeOpen': true } : {}),
      });

      // Open a dispute doc for admin review.
      const disputeRef = db.collection('disputes').doc(nativeDisputeId);
      await recoveryCommit({refs: [(disputeRef).path]});
    tx.set(disputeRef, {
        transactionId,
        buyerId: data.buyerId,
        sellerId: data.sellerId ?? null,
        articleId: data.articleId ?? null,
        articleTitle: data.articleTitle ?? null,
        reason,
        ...(trimmedDetails !== null ? { details: trimmedDetails } : {}),
        ...extension,
        ...(setDeclaration ? {setContract: setSource.source, physicalReceiptVerified: false, faultEstablished: false, recourseScope: 'whole_transaction'} : {}),
        status: 'open',
        statusBeforeDispute: commercialStatus,
        createdAt: FieldValue.serverTimestamp(),
        reportRequestId: requestId, reportOwnerId: buyerUid, reportPayloadHash: payloadHash,
      });
      const receipt = { protocol: 'transaction_problem_report_v1', ownerId: buyerUid, transactionId, requestId, payloadHash,
        state: 'committed', committed: true, disputeId: disputeRef.id, reportedAt: new Date(nowMs).toISOString(),
        freezeCommitted: true, reason: null, ...extension, admissionVerified: false, financialEffect: 'none', externalRecourseDeadlineExtended: false };
      await recoveryCommit({refs: [(receiptRef).path]});
    tx.create(receiptRef, {...receipt, ...(productNotices ? {notificationIds: productNotices.notificationIds} : {})});
      productNotices?.commit();
      return { ...receipt, replay: false };
    });

    if (!outcome.committed || outcome.replay) return outcome;
    const disputeId = outcome.disputeId;

    // Best-effort admin signal (in-app notification path is via support tooling;
    // here we emit a structured warning the on-call admin dashboard ingests).
    logger.warn('ADMIN_REVIEW — buyer reported a transaction problem', {
      disputeId,
      transactionId,
      buyerId: buyerUid,
      reason,
    });

    // Analytics (§12): dispute_opened — distinct_id = declarant (buyer).
    await captureServerEvent(buyerUid, 'dispute_opened', {
      transaction_id: transactionId,
      type: 'problem',
      reason_code: reason,
      held_cents: disputeHeldCents,
      $insert_id: `dispute_opened_${disputeId}`,
    });

    return outcome;

    });
  }
);

// =============================================================================
// requestReturn — Buyer ships a non-conforming item back to the seller
// =============================================================================

/** Return deposit, explicit quote acceptance and GET-only purchase recovery.
 * Existing claims are serviced before any new-operation gates. */
export const requestReturn = onCall(
  {region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY']},
  async request => {
    return withFinancialRecoveryScope({operation: "callable/recourse.requestReturn"}, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');
    if (request.data?.capability === CONVENIENCE_RETURN_INCIDENT_CAPABILITY) return handleConvenienceReturnIncident(request);
    if ([CONVENIENCE_RETURN_CAPABILITY, CONVENIENCE_RETURN_POLICY_CAPABILITY].includes(request.data?.capability)) return handleConvenienceReturn(request);
    const buyerUid = request.auth.uid;
    return withPrivateAccountSession(request, async () => {
    const input = request.data ?? {};
    const {transactionId, reason} = input, mode = input.mode ?? 'prepare';
    const convenience = input.capability === CONVENIENCE_RETURN_SHIPPING_CAPABILITY;
    if (input.capability !== undefined && !convenience || convenience && (input.materialCapability !== undefined || input.commercialReturn !== undefined || input.routeAmendmentCapability !== undefined))
      throw new HttpsError('invalid-argument', 'Un seul parcours de retour explicite est autorisé.');
    const routeOptIn = input.routeAmendmentCapability === LABEL_ROUTE_AMENDMENT_CAPABILITY;
    if (input.routeAmendmentCapability !== undefined && !routeOptIn) throw new HttpsError('invalid-argument', 'Version de route explicite requise.');
    const material = input.materialCapability === 'product_review_material_v1';
    if (input.materialCapability !== undefined && !material || input.commercialReturn !== undefined && !material)
      throw new HttpsError('invalid-argument', 'Version matérielle du retour explicite requise.');
    const commercialReturn = input.commercialReturn === undefined ? null : parseCommercialReturnReference(input.commercialReturn);
    if (material && mode !== 'observe' && !commercialReturn) throw new HttpsError('invalid-argument', 'Instruction commerciale exacte requise.');
    const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
    if (!id(transactionId) || input.expectedUid !== buyerUid || !['prepare','confirm','observe', ...(convenience ? ['neutralize'] : [])].includes(mode) ||
        mode === 'observe' && input.requestId != null && (!id(input.requestId) || input.requestId.length < 16))
      throw new HttpsError('invalid-argument', 'Une commande, un compte et une action explicites sont requis.');
    if (mode !== 'observe' && (typeof reason !== 'string' || !RETURN_REASONS.has(reason) || !id(input.requestId) || input.requestId.length < 16))
      throw new HttpsError('invalid-argument', 'Un motif et une intention de retour sont requis.');
    if (mode === 'confirm' && (!id(input.quoteId) || !id(input.rateId) || !Number.isSafeInteger(input.expectedVersion) ||
        !Number.isSafeInteger(input.expectedCostCents) || input.expectedCostCents < 0 || input.accepted !== true))
      throw new HttpsError('invalid-argument', 'Confirmez explicitement le devis exact du retour.');
    const {callerKey, isAuthenticated} = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {functionName: 'requestReturn', maxCallsAuthenticated: 12,
      maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS});
    const txRef = db.collection('transactions').doc(transactionId);
    const furnishResolvedDocument = async () => {
      const before = await db.runTransaction(async tx => {
        await assertPrivateAccountSession(request, tx);
        const data = (await tx.get(txRef)).data();
        if (!data || data.buyerId !== buyerUid || !data.convenienceReturnCostResolution || data.status !== 'return_requested' ||
            data.refund != null || data.fundsReleasedAt != null || hasActiveBankDispute(data) || !committedReturnReceipt(transactionId, data) ||
            input.requestId != null && input.requestId !== data.returnRequest.requestId) return null;
        if (await readConvenienceReturnTerminal(tx, transactionId, data.returnRequest.requestId) ||
            await returnDocumentFurnished(tx, transactionId, data) || !await readEffectiveConvenienceReturnFinancing(tx, transactionId, data)) return null;
        return {data, sourceHash: supportSourceHash([data.returnRequest, data.convenienceReturnCostResolution])};
      });
      if (!before) return;
      const p = before.data.returnRequest.labelProof;
      const pdf = await qualifyReturnLabelDocument({labelId: p.labelId, direction: 'return', trackingNumber: p.trackingNumber,
        carrierCode: p.carrierCode, shipmentId: p.shipmentId, carrierId: p.carrierId, serviceCode: p.serviceCode,
        outboundLabelId: p.outboundLabelId, rateId: null, providerCreatedAtMs: null}, true);
      if (!pdf?.documentUrl) return;
      await supportCurrentAdminSession(request);
      const session = {ownerId: buyerUid, authTimeMs: (request.auth!.token.auth_time as number) * 1000, qualifiedAt: Timestamp.now()};
      await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const data = (await tx.get(txRef)).data();
        if (!data || data.buyerId !== buyerUid || data.status !== 'return_requested' || data.refund != null || hasActiveBankDispute(data) ||
            await readConvenienceReturnTerminal(tx, transactionId, before.data.returnRequest.requestId) ||
            supportSourceHash([data.returnRequest, data.convenienceReturnCostResolution]) !== before.sourceHash ||
            !await readEffectiveConvenienceReturnFinancing(tx, transactionId, data)) return;
        const prospective = {...data, returnLabelUrl: pdf.documentUrl,
          returnRequest: {...data.returnRequest, labelProof: {...data.returnRequest.labelProof, labelUrl: pdf.documentUrl}}};
        const {documentUrl: _documentUrl, ...availability} = pdf;
        const furnishing = await prepareInitialReturnDocumentFurnishing(tx, transactionId, prospective, availability, session, Timestamp.now());
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, {returnLabelUrl: pdf.documentUrl, 'returnRequest.labelProof.labelUrl': pdf.documentUrl});
        furnishing.commit();
      });
    };
    const readView = async (replay: boolean) => {
      if (mode !== 'neutralize') await furnishResolvedDocument();
      return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const data = (await tx.get(txRef)).data();
      if (!data || data.buyerId !== buyerUid && (mode !== 'observe' || data.sellerId !== buyerUid)) throw new HttpsError('permission-denied', 'La commande est privée à ses membres.');
      const terminal = input.requestId ? await readConvenienceReturnTerminal(tx, transactionId, input.requestId) : null;
      if (terminal) return convenienceReturnTerminalView(transactionId, data, terminal);
      if (mode !== 'neutralize' && input.requestId != null && data.returnRequest?.requestId != null && data.returnRequest.requestId !== input.requestId)
        throw new HttpsError('already-exists', 'Cette intention ne correspond pas à la demande déposée.');
      const moderation = committedReturnReceipt(transactionId, data) ? await readOrderModeration(tx, data) : null;
      const moderationAllowsReturn = moderation == null || moderation.sourceQualified && moderation.action === 'continue' &&
        moderation.otherBlockers.every(blocker => blocker === 'order_recourse');
      const physicalAllowsReturn = await productPhysicalAllowsLeg(tx, data, 'return', transactionId);
      const commercialAdmission = data.returnRequest?.commercialReturn
        ? await readCommercialReturnAdmission(tx, transactionId, data, data.returnRequest.commercialReturn) : null;
      const commercialAllowsReturn = commercialAdmission ? commercialAdmission.allowed : !await productMaterialReturnContextRequired(tx, transactionId, data);
      const lifecycleAllowsReturn = await labelLifecycleAllowsLeg(tx, transactionId, data, 'return');
      const documentFurnished = await returnDocumentFurnished(tx, transactionId, data);
      const newDepositAllowed = await returnDepositAllowsNewDeposit(tx, transactionId, data);
      const financing = data.returnRequest?.reason === 'change_of_mind' ? await readEffectiveConvenienceReturnFinancing(tx, transactionId, data) : null;
      return returnRequestView(transactionId, data, replay, moderationAllowsReturn && physicalAllowsReturn && commercialAllowsReturn && lifecycleAllowsReturn,
        commercialAdmission?.buyerReportQualified === true, documentFurnished, data.buyerId === buyerUid && newDepositAllowed, !!financing);
      });
    };
    const deposit = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await assertPrivateAccountSession(request, tx);
      const data = (await tx.get(txRef)).data();
      if (!data) throw new HttpsError('not-found', 'Transaction not found');
      if (data.buyerId !== buyerUid) {
        if (mode === 'observe' && data.sellerId === buyerUid) return {owned: false, data, sellerReadOnly: true};
        throw new HttpsError('permission-denied', 'Only the buyer can request a return');
      }
      const terminal = input.requestId ? await readConvenienceReturnTerminal(tx, transactionId, input.requestId) : null;
      if (terminal) return {owned: false, data, terminal};
      if (mode === 'neutralize') {
        const reference = parseConvenienceReturnReference(input.convenienceReturn);
        if (!convenience || reason !== 'change_of_mind') throw new HttpsError('invalid-argument', 'Intention de convenance exacte requise.');
        if ((hasUnsettledReturnRequest(data) || data.status === 'return_requested') && data.returnRequest?.requestId === input.requestId) {
          if (data.returnRequest?.schemaVersion !== 2 || data.returnRequest.reason !== 'change_of_mind' ||
              !qualifiedReturnRequest(transactionId, data))
            throw new HttpsError('failed-precondition', 'La demande native actuelle doit être rapprochée sans la clôturer.');
          return {owned: false, data, neutralizeActive: true};
        }
        const absent = await prepareConvenienceReturnAbsentIntent(tx, transactionId, data, buyerUid, input.requestId, reference);
        return {owned: false, data, terminal: absent};
      }
      if (hasUnsettledReturnRequest(data) || data.status === 'return_requested') {
        if ((mode !== 'observe' || input.requestId != null) && data.returnRequest?.requestId !== input.requestId)
          throw new HttpsError('already-exists', 'Une demande de retour est déjà déposée. Relisez cette demande.');
        if (mode !== 'observe' && data.returnRequest?.reason !== reason)
          throw new HttpsError('already-exists', 'Cette intention correspond à un autre motif.');
        if (commercialReturn && returnHash(data.returnRequest.commercialReturn ?? null) !== returnHash(commercialReturn))
          throw new HttpsError('already-exists', 'Cette intention correspond à une autre instruction commerciale.');
        if (input.convenienceReturn !== undefined && returnHash(data.returnRequest.convenienceReturn ?? null) !== returnHash(parseConvenienceReturnReference(input.convenienceReturn)))
          throw new HttpsError('already-exists', 'Cette intention correspond à un autre accord pour changement d’avis.');
        if (!qualifiedReturnRequest(transactionId, data)) {
          await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, {returnReconciliationRequired: true, returnReconciliationReason: 'legacy_return_request_unqualified'});
          return {owned: false, data: {...data, returnReconciliationRequired: true, returnReconciliationReason: 'legacy_return_request_unqualified'}};
        }
        return {owned: false, data};
      }
      if (mode !== 'prepare') return {owned: false, data};
      let convenienceExtension: FirebaseFirestore.DocumentData = {};
      if (reason === 'other' && !commercialReturn) throw new HttpsError('failed-precondition',
        'Le changement d’avis demande l’accord explicite du vendeur. Un autre problème peut être signalé à l’équipe.',
        {reason: 'convenience_return_seller_agreement_required', capability: CONVENIENCE_RETURN_CAPABILITY});
      if (reason === 'change_of_mind') {
        const reference = parseConvenienceReturnReference(input.convenienceReturn);
        const agreement = await readConvenienceReturnAgreement(tx, transactionId, data, reference);
        if (!agreement) throw new HttpsError('failed-precondition',
          'L’accord explicite du vendeur doit porter sur la source actuelle de cette commande.',
          {reason: 'convenience_return_seller_agreement_required', capability: CONVENIENCE_RETURN_POLICY_CAPABILITY});
        if (!convenience || reference.termsProtocol !== 'convenience_return_terms_v2') throw new HttpsError('failed-precondition',
          'Un accord natif sur les conditions actuelles et le parcours de financement explicite sont requis.',
          {reason: 'convenience_return_priced_policy_required', financialEffectAuthorized: false, shippingPermissionGranted: false});
        assertNewConvenienceReturnPurchaseOpen();
        const profile = (await tx.get(db.collection('eligibility_profiles').doc(buyerUid))).data();
        await assertAccountSecurityOpen(profile, tx, buyerUid);
        await readConvenienceReturnCostQuote(tx, transactionId, data, {requestId: input.requestId, agreement: reference, costCents: 0});
        convenienceExtension = {convenienceReturn: reference, convenienceReturnBasis: {protocol: 'convenience_return_basis_v1', transactionId,
          buyerId: data.buyerId, sellerId: data.sellerId, proposalId: agreement.proposal.proposalId, agreementContentHash: agreement.contentHash,
          agreementSourceHash: agreement.proposal.sourceHash, termsHash: supportSourceHash(agreement.proposal.terms),
          acceptedAt: agreement.response.recordedAt, initialReleaseAt: effectivePurchaseReleaseAt(data, transactionId),
          preReturnState: {status: data.status, disputedPresent: Object.prototype.hasOwnProperty.call(data, 'disputed'),
            disputed: data.disputed ?? false}}};
      }
      if (convenience && reason !== 'change_of_mind') throw new HttpsError('invalid-argument', 'Le parcours de convenance requiert le motif changement d’avis.');
      const commercialAdmission = commercialReturn ? await readCommercialReturnAdmission(tx, transactionId, data, commercialReturn) : null;
      if (commercialReturn && (!PRODUCT_MATERIAL_REVIEW_ENABLED || !commercialAdmission?.allowed || !commercialAdmission.basis))
        throw new HttpsError('failed-precondition', 'L’instruction commerciale de ce dossier doit être rapprochée avant un nouveau retour.', {reason: 'product_commercial_return_requires_instruction'});
      if (returnToSenderBlocksProgress(data)) throw new HttpsError('failed-precondition',
        'Le retour à l’expéditeur signalé doit être examiné avant de préparer un nouveau retour.',
        {reason: 'return_to_sender_requires_human_review'});
      assertNoActiveBankDispute(data); assertNoUnsettledRefund(data);
      if (!await returnModerationAllowsPreparation(tx, data, transactionId, commercialReturn ?? undefined, false, convenience)) throw new HttpsError('failed-precondition',
        'Une instruction de l’équipe est requise avant de préparer ce retour. Les reçus, le signalement et le support restent accessibles.',
        {reason: 'return_moderation_requires_instruction'});
      const requestedAt = Timestamp.now(), deadline = effectivePurchaseReleaseAt(data, transactionId);
      const totalCents = exactCents(data.totalAmount), sellerPayoutCents = exactCents(data.sellerPayout ?? data.amount);
      if (data.status !== (commercialReturn ? commercialAdmission?.basis?.commercialStatusAtInstruction ?? 'disputed' : 'delivered') || data.deliveryType !== 'shipping' || data.fundsReleasedAt ||
          data.trackingReviewRequired === true || data.deliveryCorrectionBlocked === true || deliveryCorrectionBlocksProgress(data) ||
          !(deadline instanceof Timestamp) || !Number.isSafeInteger(deadline.toMillis()) || !commercialReturn && !convenience && requestedAt.toMillis() >= deadline.toMillis())
        throw new HttpsError('failed-precondition', 'La commande et sa fenêtre de retour doivent être confirmées.');
      if (data.currency !== 'CAD' || totalCents === null || totalCents <= 0 || sellerPayoutCents === null ||
          !id(data.sellerId) || data.sellerId === buyerUid)
        throw new HttpsError('failed-precondition', 'Les montants et les parties doivent être rapprochés.');
      const effectiveWindowSourceHash = data.deliveryCorrection?.resolution?.effectiveDeliveryWindow?.sourceHash;
      const commercialExtension = commercialReturn ? {commercialReturn, commercialReturnBasis: commercialAdmission!.basis!} : {};
      const extension = {...commercialExtension, ...convenienceExtension};
      const intent = {schemaVersion: convenience ? 2 : 1, requestId: input.requestId, version: 1, transactionId, actorUid: buyerUid,
        buyerId: buyerUid, sellerId: data.sellerId, reason, totalCents, sellerPayoutCents, currency: 'CAD', requestedAt,
        ...(effectiveWindowSourceHash === undefined ? {} : {effectiveDeliveryWindowSourceHash: effectiveWindowSourceHash}),
        ...extension, fundsReleaseAt: deadline,
        sourceHash: returnRequestSourceHash(transactionId, commercialReturn || convenience ? {...data, returnRequest: extension} : data, effectiveWindowSourceHash), state: 'reserved'};
      const update = await financialRecoverySourceFields('purchase', txRef, data,
        {returnRequest: intent, returnLabelPending: true, returnRequestedAt: requestedAt, disputed: true});
      await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, update); return {owned: true, data: {...data, ...update}};
    });
    let preData: FirebaseFirestore.DocumentData = deposit.data;
    if (deposit.terminal) return convenienceReturnTerminalView(transactionId, preData, deposit.terminal);
    if (deposit.sellerReadOnly || deposit.neutralizeActive) return readView(true);
    const requestId = preData.returnRequest?.requestId;
    const requestObservationVersion = preData.returnRequest?.version;
    if (!qualifiedReturnRequest(transactionId, preData) || committedReturnReceipt(transactionId, preData))
      return readView(true);
    if (mode === 'observe' && (routeOptIn || preData.returnRequest?.routeAmendmentCapture)) return readView(true);
    const recordFailure = async (failureReason: string, observed?: ShipEngineLabel, purchaseError?: ShipEngineLabelPurchaseError) => {
      // Provider purchase identity is enough for GET recovery. A document URL
      // must not leak through an uncommitted observation before furnishing.
      const observedIdentity = observed ? {labelId: observed.labelId, shipmentId: observed.shipmentId ?? null,
        carrierId: observed.carrierId ?? null, carrierCode: observed.carrierCode, serviceCode: observed.serviceCode ?? null,
        trackingNumber: observed.trackingNumber, qualification: observed.qualification ?? null} : null;
      const safeOriginalRequest = {...preData.returnRequest, ...(preData.returnRequest?.observedLabel ? {
        observedLabel: {labelId: preData.returnRequest.observedLabel.labelId ?? null}} : {})};
      await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const current = (await tx.get(txRef)).data(), alertRef = db.collection('admin_alerts').doc(`return_request_${requestId}`);
        const alert = await tx.get(alertRef);
        const terminal = await readConvenienceReturnTerminal(tx, transactionId, requestId);
        if (terminal) {await recordConvenienceReturnLateObservation(tx, transactionId, terminal, failureReason, observed); return;}
        if (!current || current.buyerId !== buyerUid || current.returnRequest?.requestId !== requestId || committedReturnReceipt(transactionId, current)) return;
        const r = current.returnRequest;
        if (!Number.isSafeInteger(r.version) || r.version < 1 || r.version >= Number.MAX_SAFE_INTEGER - 1) return;
        // A read/commit started before a quote's positive commit cannot revoke
        // that newer quote when its response finally arrives. This includes an
        // older positive GET whose commit loses the version CAS, but never a
        // confirm-time observation of changed rate data.
        if (['return_quote_lookup_unknown', 'return_quote_preparation_unknown', 'return_quote_commit_requires_instruction'].includes(failureReason) &&
            r.state === 'quoted' && r.version > requestObservationVersion &&
            qualifiedReturnRequest(transactionId, current) && qualifiedReturnQuote(transactionId, current)) return;
        const currentContext = frozenReturnContext(transactionId, current);
        // The version is the owner's native I/O authorization, not a counter
        // of inconclusive GETs. Another device can observe before the original
        // POST becomes visible at the provider. Preserve that authorization so
        // its positive result can still pass the exact source/quote/acceptance
        // CAS; an unknown observation never permits another POST.
        const preparationWitness = qualifiedReturnRequest(transactionId, current) && currentContext != null &&
          r.preparationAuthorizedAt instanceof Timestamp && r.requestedAt instanceof Timestamp &&
          r.preparationAuthorizedAt.toMillis() >= r.requestedAt.toMillis() && r.preparationAuthorizedAt.toMillis() <= Date.now() &&
          r.labelContext != null && returnHash(r.labelContext) === returnHash(currentContext);
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase', txRef, current, {...(r.state === 'committed' ? {} : {
          'returnRequest.state': observed ? 'reconciliation_required' : 'unknown',
          'returnRequest.version': preparationWitness ? r.version : r.version + 1,
          returnLabelPending: true}), 'returnRequest.lastFailureReason': failureReason,
          ...(observedIdentity ? {'returnRequest.observedLabel': observedIdentity} : {}),
          ...(purchaseError && r.reason === 'change_of_mind' && r.authorizedAt instanceof Timestamp ? {
            'returnRequest.purchaseObservation': {protocol: 'convenience_return_purchase_observation_v1', source: 'native_return_label_post',
              transactionId, returnRequestId: requestId, purchaseExternalId: r.purchaseExternalId, requestSourceHash: r.sourceHash,
              quoteHash: returnHash(r.quote), acceptanceHash: returnHash(r.acceptance), outcome: purchaseError.outcome,
              evidence: Object.fromEntries(['stage', 'httpStatus', 'requestId', 'purchaseExternalId', 'requestedRateId', 'contextHash', 'errors']
                .map(key => [key, purchaseError.evidence[key] ?? null])), evidenceHash: supportSourceHash(purchaseError.evidence), recordedAt: Timestamp.now()}} : {}),
          returnReconciliationRequired: true, returnReconciliationReason: failureReason}));
        await recoveryCommit({refs: [(alertRef).path]});
    tx.set(alertRef, {kind: 'return_request_reconciliation', severity: 'critical', refId: transactionId, requestId,
          message: 'Demande de retour déposée : instruction requise, aucun nouvel achat autorisé.',
          context: {transactionId, requestId, reason: failureReason, originalRequest: safeOriginalRequest,
            observedLabel: observedIdentity}, status: 'open', createdAt: alert.data()?.createdAt ?? FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      });
      const current = (await txRef.get()).data();
      if (!current || current.buyerId !== buyerUid) throw new HttpsError('unavailable', 'Le reçu doit être relu.');
      return readView(true);
    };
    if (preData.returnRequest.state === 'committed') return recordFailure('legacy_return_label_requires_instruction');
    // Only a witnessed BEFORE-I/O native return can adopt a new agreed source.
    // Its request ID, dates, financial/window witness and all old effects remain intact.
    if (routeOptIn && mode === 'prepare' && returnPreparationCanAmend(preData)) {
      if (!LABEL_ROUTE_AMENDMENT_ENABLED) throw new HttpsError('failed-precondition', 'Amendement en préparation.', {reason:'label_route_amendment_not_exposed'});
      preData = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        await assertReturnNotTerminal(tx, transactionId, requestId);
        const data = (await tx.get(txRef)).data();
        if (!data || data.buyerId !== buyerUid || data.returnRequest?.requestId !== requestId || !qualifiedReturnRequest(transactionId,data) || !returnPreparationCanAmend(data))
          throw new HttpsError('aborted','La demande native doit être relue.');
        const capture = await readAcceptedRouteAmendment(tx,{transactionId,leg:'return'},data);
        if (!capture || !await labelRouteAmendmentPreparationBasis(tx,transactionId,data,'return') || capture.requestId !== requestId || data.status !== commercialReturnExpectedStatus(data) || data.disputed !== true || data.fundsReleasedAt ||
            !await returnModerationAllowsPreparation(tx,data,transactionId,undefined,true) || !await fraudReviewAllowsProgress(tx,transactionId,data))
          throw new HttpsError('failed-precondition','La route et les autres instructions doivent être confirmées.',{reason:'return_route_amendment_requires_review'});
        assertNoActiveBankDispute(data); assertNoUnsettledRefund(data);
        const r = data.returnRequest;
        if(r.version>=Number.MAX_SAFE_INTEGER-4)throw new HttpsError('failed-precondition','Version native à rapprocher.');
        const routeCaptures = txRef.collection('return_route_captures');
        const currentCaptureRef = routeCaptures.doc(returnHash([requestId,capture]));
        const savedCapture = await tx.get(currentCaptureRef);
        if (savedCapture.exists && returnHash(savedCapture.data()?.capture) !== returnHash(capture))
          throw new HttpsError('failed-precondition','Capture de route à rapprocher.');
        let oldCaptureRef:FirebaseFirestore.DocumentReference|null = null, oldCaptureExists = false;
        if (r.routeAmendmentCapture) {
          if (!await readHistoricalRouteAmendment(tx,{transactionId,leg:'return'},r.routeAmendmentCapture))
            throw new HttpsError('failed-precondition','Origine de la route précédente à rapprocher.');
          oldCaptureRef = routeCaptures.doc(returnHash([requestId,r.routeAmendmentCapture]));
          const oldCapture = await tx.get(oldCaptureRef); oldCaptureExists = oldCapture.exists;
          if (oldCapture.exists && returnHash(oldCapture.data()?.capture) !== returnHash(r.routeAmendmentCapture))
            throw new HttpsError('failed-precondition','Capture précédente à rapprocher.');
        }
        const next = {...r,routeAmendmentCapture:capture,state:'reserved',version:r.version+1};
        const update = await financialRecoverySourceFields('purchase', txRef, data,
          {'returnRequest.routeAmendmentCapture':capture,'returnRequest.state':'reserved','returnRequest.version':next.version});
        if (oldCaptureRef && !oldCaptureExists) { await recoveryCommit({refs: [(oldCaptureRef).path]}); tx.create(oldCaptureRef,{protocol:'return_route_capture_v1',requestId,capture:r.routeAmendmentCapture}); }
        if (!savedCapture.exists) { await recoveryCommit({refs: [(currentCaptureRef).path]}); tx.create(currentCaptureRef,{protocol:'return_route_capture_v1',requestId,capture}); }
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef,update);
        return {...data,returnRequest:next, financialRecoveryWitness: update.financialRecoveryWitness};
      });
    }
    const amended = preData.returnRequest.routeAmendmentCapture != null;
    if (amended && !await db.runTransaction(tx => readHistoricalRouteAmendment(tx,{transactionId,leg:'return'},preData.returnRequest.routeAmendmentCapture)))
      return readView(true);
    const amendmentOwned = amended && routeOptIn && mode === 'prepare' && preData.returnRequest.state === 'reserved';
    if (!deposit.owned && !amendmentOwned && preData.returnRequest.state === 'reserved') return readView(true);
    const context = frozenReturnContext(transactionId, preData), engine = getShipEngine();
    if (!context || !engine) return recordFailure(context ? 'return_provider_unavailable' : 'return_frozen_source_requires_instruction');
    // Every commit contends on the same order. Unknown reads never manufacture
    // absence, unlock a POST, alter liability or close the buyer's timely claim.
    const commitLabel = async (label: ShipEngineLabel, expectedVersion: number) => {
      const proof = label.qualification;
      if (!proof || proof.currency !== 'CAD' || proof.rateIdentitySource !== 'return_shipment' ||
          proof.totalCents !== preData.returnRequest.quote?.expectedCostCents || !Number.isSafeInteger(proof.totalCents) ||
          proof.totalCents !== proof.shipmentCents + proof.insuranceCents) return recordFailure('return_label_cost_requires_instruction', label);
      const nativeBefore = await db.runTransaction(async tx => {
        await assertPrivateAccountSession(request, tx);
        const terminal = await readConvenienceReturnTerminal(tx, transactionId, requestId);
        if (terminal) {await recordConvenienceReturnLateObservation(tx, transactionId, terminal, 'late_positive_label', label); return {terminal};}
        const data = (await tx.get(txRef)).data();
        if (!data || data.buyerId !== buyerUid || data.returnRequest?.requestId !== requestId) return null;
        if (committedReturnReceipt(transactionId, data)) return data;
        return qualifiedReturnRequest(transactionId, data) && qualifiedReturnQuote(transactionId, data) &&
          data.returnRequest.version === expectedVersion && data.returnRequest.authorizedAt instanceof Timestamp &&
          returnHash(data.returnRequest.quote.context) === returnHash(context) ? data : null;
      });
      if (nativeBefore?.terminal) return readView(true);
      if (!nativeBefore) return recordFailure('return_document_source_requires_reconciliation', label);
      if (committedReturnReceipt(transactionId, nativeBefore)) return readView(true);
      let pdf: Awaited<ReturnType<typeof qualifyReturnLabelDocument>> = null;
      let buyerSession: {ownerId: string; authTimeMs: number; qualifiedAt: Timestamp} | null = null;
      if (hasReturnDepositTerms(nativeBefore)) {
        pdf = await qualifyReturnLabelDocument({labelId: label.labelId, direction: 'return', trackingNumber: label.trackingNumber,
          carrierCode: context.carrierCode, shipmentId: label.shipmentId ?? null, carrierId: context.carrierId,
          serviceCode: context.serviceCode, outboundLabelId: context.outboundLabelId, rateId: null, providerCreatedAtMs: null});
        if (!pdf) return recordFailure('return_actual_document_availability_unknown', label);
        // This existing helper qualifies CURRENT Auth UID/disabled/cutoff for
        // every caller; its boolean admin result grants no owner permission.
        try {
          await supportCurrentAdminSession(request);
          buyerSession = {ownerId: buyerUid, authTimeMs: (request.auth!.token.auth_time as number) * 1000, qualifiedAt: Timestamp.now()};
          if (buyerSession.authTimeMs > buyerSession.qualifiedAt.toMillis()) throw new HttpsError('permission-denied', 'Session non qualifiée.');
        }
        catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure;return recordFailure('return_document_buyer_session_unknown', label);}
      }
      try {
        await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          await assertPrivateAccountSession(request, tx);
          const terminal = await readConvenienceReturnTerminal(tx, transactionId, requestId);
          if (terminal) {await recordConvenienceReturnLateObservation(tx, transactionId, terminal, 'late_positive_label', label); return;}
          const data = (await tx.get(txRef)).data();
          if (!data || data.buyerId !== buyerUid) throw new HttpsError('permission-denied', 'Only the buyer can request a return');
          if (committedReturnReceipt(transactionId, data)) return;
          if (hasReturnDepositTerms(data)) {
            const profile = (await tx.get(db.collection('eligibility_profiles').doc(buyerUid))).data();
            await assertAccountSecurityOpen(profile, tx, buyerUid);
          }
          assertNoActiveBankDispute(data); assertNoUnsettledRefund(data);
          const r = data.returnRequest;
          if (r?.reason === 'change_of_mind' && !await readConvenienceReturnFinancing(tx, transactionId, data))
            throw new HttpsError('failed-precondition', 'Le financement réservé du retour doit être rapproché.');
          if (!qualifiedReturnRequest(transactionId, data) || !qualifiedReturnQuote(transactionId, data) || r.requestId !== requestId ||
              r.version !== expectedVersion || !['requested','unknown','reconciliation_required'].includes(r.state) ||
              !(r.authorizedAt instanceof Timestamp) || r.acceptance?.actorUid !== buyerUid ||
              r.acceptance?.quoteId !== r.quote.quoteId || r.acceptance?.rateId !== r.quote.rateId ||
              r.acceptance?.expectedCostCents !== proof.totalCents || !(r.acceptance?.acceptedAt instanceof Timestamp) ||
              r.purchaseExternalId !== `sr_${returnHash([transactionId, requestId, r.quote.quoteId, 'label']).slice(0,40)}` ||
              returnHash(r.quote.context) !== returnHash(context) || returnHash(r.quote) !== returnHash(nativeBefore.returnRequest.quote) ||
              returnHash(r.acceptance) !== returnHash(nativeBefore.returnRequest.acceptance) || data.status !== commercialReturnExpectedStatus(data) ||
              data.disputed !== true || data.fundsReleasedAt || data.returnLabelId != null || data.returnTrackingNumber != null)
            throw new HttpsError('aborted', 'La demande doit être rapprochée.');
          if (hasReturnDepositTerms(data)) {
            const [forwardOwners, returnOwners] = await Promise.all([
              tx.get(db.collection('transactions').where('shipEngineLabelId', '==', label.labelId).limit(2)),
              tx.get(db.collection('transactions').where('returnLabelId', '==', label.labelId).limit(2)),
            ]);
            if (forwardOwners.size > 0 || returnOwners.docs.some(owner => owner.id !== transactionId))
              throw new HttpsError('failed-precondition', 'Le propriétaire de cette étiquette doit être rapproché.');
          }
          const committedAt = Timestamp.now();
          const labelProof = {schemaVersion: 2, labelId: label.labelId, shipmentId: label.shipmentId,
            carrierId: label.carrierId, carrierCode: label.carrierCode, serviceCode: label.serviceCode,
            outboundLabelId: context.outboundLabelId, trackingNumber: label.trackingNumber, labelUrl: label.labelDownload.href,
            cost: proof.totalCents / 100, currency: 'CAD', shipmentCents: proof.shipmentCents, insuranceCents: proof.insuranceCents,
            totalCents: proof.totalCents, providerCreatedAt: proof.providerCreatedAt, rateDetails: proof.rateDetails};
          const readyFields = {status: 'return_requested', disputed: true,
            ...(r.commercialReturn ? (typeof data.statusBeforeDispute === 'string' ? {statusBeforeDispute: data.statusBeforeDispute} : {}) : {statusBeforeDispute: data.status}),
            returnLabelId: label.labelId, returnTrackingNumber: label.trackingNumber, returnLabelUrl: label.labelDownload.href,
            returnCarrierCode: label.carrierCode, returnLabelCost: proof.totalCents / 100, returnReason: r.reason,
            returnRequestedAt: r.requestedAt, returnLabelPending: null, returnReconciliationRequired: false, returnReconciliationReason: null};
          const prospective = {...data, ...readyFields, returnRequest: {...r, state: 'committed', version: r.version + 1, committedAt, labelProof}};
          const furnishing = await prepareInitialReturnDocumentFurnishing(tx, transactionId, prospective, pdf, buyerSession);
          await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase', txRef, data, {...readyFields,
            'returnRequest.state': 'committed', 'returnRequest.version': r.version + 1, 'returnRequest.committedAt': committedAt,
            'returnRequest.labelProof': labelProof, 'returnRequest.observedLabel': FieldValue.delete()}));
          furnishing.commit();
        });
      } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; return recordFailure('return_label_commit_requires_reconciliation', label); }
      const current = (await txRef.get()).data();
      if (!current || current.buyerId !== buyerUid) throw new HttpsError('unavailable', 'Le reçu doit être relu.');
      return readView(true);
    };
    if (preData.returnRequest.authorizedAt || preData.returnRequest.purchaseExternalId) {
      if (!qualifiedReturnQuote(transactionId, preData) || !preData.returnRequest.acceptance ||
          preData.returnRequest.purchaseExternalId !== `sr_${returnHash([transactionId, requestId, preData.returnRequest.quote.quoteId, 'label']).slice(0,40)}`)
        return recordFailure('return_purchase_witness_requires_instruction');
      try {
        const label = await engine.readReturnPurchasedLabel(context, preData.returnRequest.quote.rateId,
          preData.returnRequest.purchaseExternalId, preData.returnRequest.observedLabel?.labelId);
        return commitLabel(label, preData.returnRequest.version);
      } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; return recordFailure('return_label_lookup_unknown'); }
    }
    const convenienceRequest = preData.returnRequest.reason === 'change_of_mind';
    if (convenienceRequest && mode !== 'observe' && !convenience)
      throw new HttpsError('failed-precondition', 'Le parcours de retour et son financement explicites doivent être confirmés.',
        {reason: 'convenience_return_shipping_capability_required'});
    if (amended && mode !== 'confirm' && preData.returnRequest.state === 'quoted' && qualifiedReturnQuote(transactionId,preData)) return readView(true);
    if (amended && (!routeOptIn || !LABEL_ROUTE_AMENDMENT_ENABLED)) throw new HttpsError('failed-precondition','Version actuelle du trajet requise avant une nouvelle opération.',{reason:routeOptIn?'label_route_amendment_not_exposed':'return_route_amendment_requires_review'});
    const amendmentCurrent = async (tx:FirebaseFirestore.Transaction,data:FirebaseFirestore.DocumentData) => {
      if (!data.returnRequest?.routeAmendmentCapture) return true;
      const accepted = await readAcceptedRouteAmendment(tx,{transactionId,leg:'return'},data);
      return !!accepted && await labelRouteAmendmentPreparationBasis(tx,transactionId,data,'return') && returnHash(accepted.proposal) === returnHash(data.returnRequest.routeAmendmentCapture.proposal) && returnHash(accepted.context) === returnHash(context);
    };
    if (mode === 'confirm') {
      if (!qualifiedReturnQuote(transactionId, preData) || preData.returnRequest.state !== 'quoted')
        return recordFailure('return_quote_requires_instruction');
      const q = preData.returnRequest.quote;
      if ((Object.prototype.hasOwnProperty.call(q, 'depositTerms') || Object.prototype.hasOwnProperty.call(q, 'depositTermsHash')) &&
          (returnHash(q.depositTerms ?? null) !== returnHash(RETURN_DEPOSIT_TERMS) ||
          q.depositTermsHash !== returnHash(RETURN_DEPOSIT_TERMS) || input.returnDepositTermsHash !== q.depositTermsHash))
        throw new HttpsError('failed-precondition', 'Acceptez les conditions exactes du délai de dépôt présentées avec ce devis.',
          {reason: 'return_deposit_terms_acceptance_required'});
      if (q.quoteId !== input.quoteId || q.rateId !== input.rateId || q.expectedCostCents !== input.expectedCostCents ||
          preData.returnRequest.version !== input.expectedVersion) throw new HttpsError('aborted', 'Le devis a changé. Relisez-le.');
      if (convenienceRequest && (input.convenienceReturnFinancialTermsHash !== q.convenienceReturnFinancialTermsHash ||
          input.expectedNetRefundCents !== q.convenienceReturnFinancialTerms?.netRefundCents))
        throw new HttpsError('failed-precondition', 'Acceptez le coût de retour déduit et le montant net exact présentés par ce devis.',
          {reason: 'convenience_return_financial_terms_acceptance_required'});
      let fresh;
      try { fresh = await engine.readReturnPurchaseRates(context, q.rates.shipmentId); }
      catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; return recordFailure('return_quote_read_unknown'); }
      if (returnHash(fresh.rates) !== returnHash(q.rates.rates) || !consistentRateDetails(q.rates.qualification, fresh.qualification, q.rateId))
        return recordFailure('return_quote_changed_requires_instruction');
      const purchaseExternalId = `sr_${returnHash([transactionId, requestId, q.quoteId, 'label']).slice(0,40)}`;
      let version: number, purchaseSourceHash: string;
      try {
        const authorizedVersion = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          await assertPrivateAccountSession(request, tx);
          await assertReturnNotTerminal(tx, transactionId, requestId);
          const data = (await tx.get(txRef)).data();
          if (!data || data.buyerId !== buyerUid) throw new HttpsError('permission-denied', 'Only the buyer can request a return');
          assertNoActiveBankDispute(data); assertNoUnsettledRefund(data);
          const r = data.returnRequest;
          if (!qualifiedReturnRequest(transactionId, data) || !qualifiedReturnQuote(transactionId, data) || r.requestId !== requestId ||
              r.state !== 'quoted' || r.version !== input.expectedVersion || returnHash(r.quote) !== returnHash(q) ||
              returnToSenderBlocksProgress(data) ||
              r.authorizedAt != null || r.purchaseExternalId != null || data.returnLabelId != null || data.returnTrackingNumber != null ||
              data.status !== commercialReturnExpectedStatus(data) || data.disputed !== true || data.fundsReleasedAt)
            throw new HttpsError('aborted', 'La demande a changé.');
          if (!await amendmentCurrent(tx,data) || !await returnModerationAllowsPreparation(tx, data, transactionId,undefined,amended)) return null;
          if (!await fraudReviewAllowsProgress(tx, transactionId, data)) throw new HttpsError('failed-precondition',
            'La revue du paiement exige une décision humaine avant un nouvel achat d’étiquette retour.');
          if (convenienceRequest) {
            assertNewConvenienceReturnPurchaseOpen();
            const profile = (await tx.get(db.collection('eligibility_profiles').doc(buyerUid))).data();
            await assertAccountSecurityOpen(profile, tx, buyerUid);
          }
          const financing = convenienceRequest ? await prepareConvenienceReturnCostReservation(tx, transactionId, data,
            r.quote.convenienceReturnFinancialTerms, r.quote.convenienceReturnFinancialTermsHash) : null;
          const acceptedAt = Timestamp.now();
          await recoveryCommit({refs: [(txRef).path]});
          const update = await financialRecoverySourceFields('purchase', txRef, data, {'returnRequest.state': 'requested', 'returnRequest.version': r.version + 1,
            'returnRequest.authorizedAt': acceptedAt, 'returnRequest.purchaseExternalId': purchaseExternalId,
            'returnRequest.acceptance': {actorUid: buyerUid, quoteId: q.quoteId, rateId: q.rateId,
              expectedCostCents: q.expectedCostCents, currency: 'CAD', acceptedAt, refundDecisionGranted: false,
              ...(convenienceRequest ? {convenienceReturnFinancialTermsHash: q.convenienceReturnFinancialTermsHash,
                expectedNetRefundCents: q.convenienceReturnFinancialTerms.netRefundCents} : {}),
              ...(q.depositTerms ? {returnDepositTermsHash: q.depositTermsHash} : {})}});
          tx.update(txRef, update);
          financing?.commit();
          return {version: r.version + 1, sourceHash: update.financialRecoveryWitness.nativeSourceHash as string};
        });
        if (authorizedVersion === null) return recordFailure('return_moderation_requires_instruction');
        version = authorizedVersion.version;
        purchaseSourceHash = authorizedVersion.sourceHash;
      } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; return recordFailure('return_authorization_changed'); }
      try {
        await assertFinancialRecoveryEffect('shipengine_label_mutation', {refs: [txRef.path], sourceHash: purchaseSourceHash,
          providerOperation: 'recourse.returnLabelPurchase', idempotencyKeys: [purchaseExternalId]});
        return commitLabel(await engine.createReturnLabel(context, q.rateId, purchaseExternalId), version);
      }
      catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error; logger.warn('return_purchase_unknown', {transactionId, requestId, error: error instanceof Error ? error.message : 'unknown'});
        return recordFailure(error instanceof ShipEngineLabelPurchaseError && error.outcome === 'rejected'
          ? 'return_label_post_validation_rejected' : 'return_label_purchase_unknown', undefined,
          error instanceof ShipEngineLabelPurchaseError ? error : undefined); }
    }
    if (preData.returnRequest.state === 'quoted' && qualifiedReturnQuote(transactionId, preData))
      return readView(true);
    let preparedVersion = preData.returnRequest.version, rates;
    // Only the invocation that owns the new deposit can create its quote.
    // Crash/re-entry reads the pre-authorized external identity; no repeat POST.
    if (deposit.owned || amendmentOwned) {
      try {
        const authorizedVersion = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          await assertPrivateAccountSession(request, tx);
          await assertReturnNotTerminal(tx, transactionId, requestId);
          const data = (await tx.get(txRef)).data();
          if (!data || data.buyerId !== buyerUid || !qualifiedReturnRequest(transactionId, data) ||
              data.returnRequest.requestId !== requestId || data.returnRequest.state !== 'reserved' || data.returnRequest.version !== (amendmentOwned ? preData.returnRequest.version : 1) ||
              returnHash(frozenReturnContext(transactionId, data)) !== returnHash(context)) throw new HttpsError('aborted', 'Source modifiée.');
          if (!await amendmentCurrent(tx,data) || !await returnModerationAllowsPreparation(tx, data, transactionId,undefined,amended)) return null;
          if (convenienceRequest) assertNewConvenienceReturnPurchaseOpen();
          await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase', txRef, data, {'returnRequest.state': 'preparing', 'returnRequest.version': data.returnRequest.version + 1,
            'returnRequest.preparationAuthorizedAt': Timestamp.now(), 'returnRequest.labelContext': context}));
          return data.returnRequest.version + 1;
        });
        if (authorizedVersion === null) return recordFailure('return_moderation_requires_instruction');
        preparedVersion = authorizedVersion;
        rates = await engine.getReturnPurchaseRates(context);
      } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; return recordFailure('return_quote_preparation_unknown'); }
    } else {
      if (!(preData.returnRequest.preparationAuthorizedAt instanceof Timestamp) ||
          returnHash(preData.returnRequest.labelContext) !== returnHash(context))
        return recordFailure('return_preparation_witness_requires_instruction');
      try { rates = await engine.readReturnPurchaseRates(context); }
      catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; return recordFailure('return_quote_lookup_unknown'); }
    }
    try {
      await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        await assertReturnNotTerminal(tx, transactionId, requestId);
        const data = (await tx.get(txRef)).data();
        if (!data || data.buyerId !== buyerUid || !qualifiedReturnRequest(transactionId, data) || data.returnRequest.requestId !== requestId ||
            data.returnRequest.version !== preparedVersion || data.returnRequest.authorizedAt != null ||
            data.status !== commercialReturnExpectedStatus(data) || data.disputed !== true || data.fundsReleasedAt ||
            returnHash(frozenReturnContext(transactionId, data)) !== returnHash(context)) throw new HttpsError('aborted', 'Source modifiée.');
        if (!await amendmentCurrent(tx,data) || !await returnModerationAllowsPreparation(tx, data, transactionId,undefined,amended)) throw new HttpsError('failed-precondition', 'Instruction actuelle requise avant un nouveau devis.');
        const rate = rates.rates[0], quoteId = `rq_${returnHash([transactionId, requestId, rate]).slice(0,40)}`;
        const financingTerms = convenienceRequest ? await readConvenienceReturnCostQuote(tx, transactionId, data,
          {requestId, agreement: data.returnRequest.convenienceReturn, costCents: rate.shippingCents}) : null;
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase', txRef, data, {'returnRequest.state': 'quoted', 'returnRequest.version': preparedVersion + 1,
          'returnRequest.quote': {schemaVersion: convenienceRequest ? 2 : 1, quoteId, requestId, transactionId, ownerId: buyerUid,
            sourceHash: data.returnRequest.sourceHash, context, rates, rateId: rate.rateId, currency: 'CAD',
            expectedCostCents: rate.shippingCents, issuedAt: Timestamp.now(),
            ...(financingTerms ? {convenienceReturnFinancialTerms: financingTerms,
              convenienceReturnFinancialTermsHash: costTermsHash(financingTerms)} : {}),
            depositTerms: RETURN_DEPOSIT_TERMS, depositTermsHash: returnHash(RETURN_DEPOSIT_TERMS)},
          returnReconciliationRequired: false, returnReconciliationReason: null}));
      });
    } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; return recordFailure('return_quote_commit_requires_instruction'); }
    const current = (await txRef.get()).data();
    if (!current || current.buyerId !== buyerUid) throw new HttpsError('unavailable', 'Le devis doit être relu.');
    return readView(false);
    });

    });
  }
);
