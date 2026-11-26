/** Negotiated refund terms and exact cumulative native allocations.
 * Components are monetary, never parts of an article/set or a legal proration. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportHash, supportSourceHash, supportId, supportObject, supportRevision, supportRequestId, supportUid, supportCurrentAdminSession, supportAdmin} from './supportRequest';
import {exactCents} from './shippingPurchaseRate';
import {acceptedOrderPurchasePolicy, acceptedQuotePurchasePolicy, nativePurchasePaymentSource, acceptedPurchaseTaxSnapshot} from './purchasePolicy';
import {prepareOperationalNotices} from './notifications';
import {productReviewCaseRef} from './productReviewSource';
import {readProductReviewEvidenceProof} from './productReviewEvidence';
import {assertAccountSecurityOpen} from './eligibility';
import {committedReturnReceipt} from './returnRequest';

export const PURCHASE_REFUND_ENABLED: boolean = true;
const HASH = /^[a-f0-9]{64}$/;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const amount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const own = (v: any, key: string) => v != null && Object.prototype.hasOwnProperty.call(v, key);
export const REFUND_COMPONENTS = ['articleCents', 'buyerFeeCents', 'shippingCents', 'gstCents', 'qstCents'] as const;
export type RefundComponents = Record<typeof REFUND_COMPONENTS[number], number>;
type PurchaseRefundTermFields = {
  currency: 'CAD'; settlementKind: 'full_remaining' | 'partial' | 'retain_remaining';
  refund: RefundComponents; retained: RefundComponents; cardCents: number; walletCents: number;
  sellerDebitCents: number; platformArticleCostCents: number;
  articleHandling: 'keep_article' | 'return_separately'; caseHandling: 'settle_selected_case' | 'retain_review';
  paymentDeadline: {qualification: 'unknown'; date: null} | {qualification: 'declared_calendar_date'; date: string};
  provenance: {kind: 'in_app' | 'external_declared'; statement: string | null;
    evidenceReferences: Array<{evidenceId: string; contentHash: string}>};
};
/** V1's conservation equations are immutable. V2 consumes the GROSS article
 * budget; the explicit return-label deduction reduces only the buyer's net. */
export type PurchaseRefundTerms = PurchaseRefundTermFields & ({protocol: 'purchase_refund_terms_v1'} | {
  protocol: 'purchase_refund_terms_v2'; returnLabelDeduction: {protocol: 'buyer_return_label_deduction_v1';
    financingTermsHash: string; requestId: string; amountCents: number};
});
export type ConvenienceReturnFinancialReference = {protocol: 'convenience_return_financial_review_v1'; proposalId: string;
  agreementContentHash: string; requestId: string; financingTermsHash: string; receptionRequestId: string; receptionHash: string};
export type RefundAgreementReference = {agreementId: string; version: number; termsHash: string; acceptanceHash: string};
export type RefundReturnDisposition = {protocol: 'purchase_return_financial_review_v1'; requestId: string; sourceHash: string;
  caseId: string; issueId: string; issueHash: string; membersHash: string; authorizationSourceHash: string;
  arrivalAssessment: 'not_arrived_declared' | 'unknown'; motivation: string;
  financialTreatment: 'settle_return_commercially'; physicalContentsVerified: false; faultEstablished: false; costDecisionGranted: false};
export type RefundAllocationReference = {protocol: 'purchase_refund_allocation_v1' | 'purchase_refund_allocation_v2'; terms: PurchaseRefundTerms;
  basisHash: string; cumulativeHash: string; agreement: RefundAgreementReference | null; returnDisposition?: RefundReturnDisposition;
  reviewedDisputeId?: string; convenienceReturn?: ConvenienceReturnFinancialReference};
const sum = (v: RefundComponents) => REFUND_COMPONENTS.reduce((n, k) => n + v[k], 0);
const zeros = (): RefundComponents => ({articleCents: 0, buyerFeeCents: 0, shippingCents: 0, gstCents: 0, qstCents: 0});
export const refundAllocationRef = (id: string, intentId: string) => db.collection('transactions').doc(id).collection('refund_allocations').doc(intentId);
export const refundHistoryRef = (id: string, intentId: string) => db.collection('transactions').doc(id).collection('refund_history').doc(intentId);
const agreementRef = (id: string, agreementId: string) => db.collection('transactions').doc(id).collection('refund_agreements').doc(agreementId);
const agreementReceiptRef = (uid: string, id: string) => db.collection('purchase_refund_agreement_commands').doc(supportHash([uid, id]));
function components(value: unknown): RefundComponents {
  const raw = supportObject(value, [...REFUND_COMPONENTS]);
  if (!REFUND_COMPONENTS.every(k => amount(raw[k]))) throw new HttpsError('invalid-argument', 'Composantes exactes en cents requises.');
  return Object.fromEntries(REFUND_COMPONENTS.map(k => [k, raw[k]])) as RefundComponents;
}
export function parsePurchaseRefundTerms(value: unknown): PurchaseRefundTerms {
  const d = supportObject(value, ['protocol', 'currency', 'settlementKind', 'refund', 'retained', 'cardCents', 'walletCents', 'sellerDebitCents',
    'platformArticleCostCents', 'articleHandling', 'caseHandling', 'paymentDeadline', 'provenance',
    ...((value as any)?.protocol === 'purchase_refund_terms_v2' ? ['returnLabelDeduction'] : [])]);
  const refund = components(d.refund), retained = components(d.retained);
  type ReturnLabelDeduction = Extract<PurchaseRefundTerms, {protocol: 'purchase_refund_terms_v2'}>['returnLabelDeduction'];
  let returnLabelDeduction: ReturnLabelDeduction | null = null;
  if (d.protocol === 'purchase_refund_terms_v2') {
    const r = supportObject(d.returnLabelDeduction, ['protocol', 'financingTermsHash', 'requestId', 'amountCents']);
    if (r.protocol !== 'buyer_return_label_deduction_v1' || !HASH.test(r.financingTermsHash ?? '') || !supportId(r.requestId) ||
        !amount(r.amountCents) || r.amountCents >= refund.articleCents ||
        REFUND_COMPONENTS.some(k => k !== 'articleCents' && refund[k] !== 0) ||
        d.sellerDebitCents !== refund.articleCents || d.platformArticleCostCents !== 0 || d.articleHandling !== 'return_separately' ||
        d.caseHandling !== 'settle_selected_case' || d.settlementKind === 'retain_remaining')
      throw new HttpsError('invalid-argument', 'La retenue de retour native et le prix brut de l’article sont requis.');
    returnLabelDeduction = r as ReturnLabelDeduction;
  }
  const deductionCents = returnLabelDeduction?.amountCents ?? 0;
  if (!['purchase_refund_terms_v1', 'purchase_refund_terms_v2'].includes(d.protocol) || d.currency !== 'CAD' || !['full_remaining', 'partial', 'retain_remaining'].includes(d.settlementKind) ||
      ![d.cardCents, d.walletCents, d.sellerDebitCents, d.platformArticleCostCents].every(amount) ||
      !Number.isSafeInteger(sum(refund)) || (d.settlementKind === 'retain_remaining' ? sum(refund) !== 0 : sum(refund) < 1) || !Number.isSafeInteger(sum(retained)) ||
      d.cardCents + d.walletCents !== sum(refund) - deductionCents || d.sellerDebitCents + d.platformArticleCostCents !== refund.articleCents ||
      !['keep_article', 'return_separately'].includes(d.articleHandling) || !['settle_selected_case', 'retain_review'].includes(d.caseHandling) ||
      (d.settlementKind === 'full_remaining' ? sum(retained) !== 0 : sum(retained) === 0)) throw new HttpsError('invalid-argument', 'Termes monétaires et traitement de l’article explicites requis.');
  const deadline = supportObject(d.paymentDeadline, ['qualification', 'date']);
  if (deadline.qualification === 'unknown' ? deadline.date !== null : deadline.qualification !== 'declared_calendar_date' ||
      typeof deadline.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline.date) ||
      !Number.isFinite(Date.parse(deadline.date + 'T00:00:00Z')) || new Date(deadline.date + 'T00:00:00Z').toISOString().slice(0, 10) !== deadline.date)
    throw new HttpsError('invalid-argument', 'Date déclarée ou inconnue explicite requise.');
  const provenance = supportObject(d.provenance, ['kind', 'statement', 'evidenceReferences']);
  if (!['in_app', 'external_declared'].includes(provenance.kind) || !Array.isArray(provenance.evidenceReferences) || provenance.evidenceReferences.length > 20 ||
      (provenance.kind === 'in_app' ? provenance.statement !== null : typeof provenance.statement !== 'string' || !provenance.statement.trim() || provenance.statement.length > 4000))
    throw new HttpsError('invalid-argument', 'Provenance déclarée exacte requise.');
  const evidenceReferences = provenance.evidenceReferences.map((r: any) => {const v = supportObject(r, ['evidenceId', 'contentHash']);
    if (!/^pf_[a-f0-9]{64}$/.test(v.evidenceId ?? '') || !HASH.test(v.contentHash ?? '')) throw new HttpsError('invalid-argument', 'Pièce native exacte requise.');
    return {evidenceId: v.evidenceId, contentHash: v.contentHash};}).sort((a: any, b: any) => a.evidenceId.localeCompare(b.evidenceId));
  if (new Set(evidenceReferences.map((r: any) => r.evidenceId)).size !== evidenceReferences.length) throw new HttpsError('invalid-argument', 'Pièces répétées.');
  return {protocol: d.protocol, ...(returnLabelDeduction ? {returnLabelDeduction} : {}), currency: 'CAD', settlementKind: d.settlementKind, refund, retained,
    cardCents: d.cardCents, walletCents: d.walletCents, sellerDebitCents: d.sellerDebitCents, platformArticleCostCents: d.platformArticleCostCents,
    articleHandling: d.articleHandling, caseHandling: d.caseHandling, paymentDeadline: deadline as PurchaseRefundTerms['paymentDeadline'],
    provenance: {kind: provenance.kind, statement: provenance.statement === null ? null : provenance.statement.trim(), evidenceReferences}};
}
export function parseRefundAllocation(value: unknown): RefundAllocationReference {
  const d = supportObject(value, ['protocol', 'terms', 'basisHash', 'cumulativeHash', 'agreement', 'returnDisposition', 'reviewedDisputeId',
    ...((value as any)?.protocol === 'purchase_refund_allocation_v2' ? ['convenienceReturn'] : [])]);
  if (!['purchase_refund_allocation_v1', 'purchase_refund_allocation_v2'].includes(d.protocol) || !HASH.test(d.basisHash ?? '') || !HASH.test(d.cumulativeHash ?? ''))
    throw new HttpsError('invalid-argument', 'Source et allocation exactes requises.');
  let agreement: RefundAgreementReference | null = null;
  if (d.agreement !== null) {const a = supportObject(d.agreement, ['agreementId', 'version', 'termsHash', 'acceptanceHash']);
    if (!/^ag_[a-f0-9]{64}$/.test(a.agreementId ?? '') || !Number.isSafeInteger(a.version) || a.version < 1 || !HASH.test(a.termsHash ?? '') || !HASH.test(a.acceptanceHash ?? ''))
      throw new HttpsError('invalid-argument', 'Acceptations natives exactes requises.');
    agreement = {agreementId: a.agreementId, version: a.version, termsHash: a.termsHash, acceptanceHash: a.acceptanceHash};}
  let returnDisposition: RefundReturnDisposition | undefined;
  if (d.returnDisposition !== undefined) {
    const r = supportObject(d.returnDisposition, ['protocol', 'requestId', 'sourceHash', 'caseId', 'issueId', 'issueHash', 'membersHash',
      'authorizationSourceHash', 'arrivalAssessment', 'motivation', 'financialTreatment', 'physicalContentsVerified', 'faultEstablished', 'costDecisionGranted']);
    if (r.protocol !== 'purchase_return_financial_review_v1' || !supportId(r.requestId) || !/^pr_[a-f0-9]{64}$/.test(r.caseId ?? '') ||
        !/^pe_[a-f0-9]{64}$/.test(r.issueId ?? '') || !['sourceHash', 'issueHash', 'membersHash', 'authorizationSourceHash'].every(k => HASH.test(r[k] ?? '')) ||
        !['not_arrived_declared', 'unknown'].includes(r.arrivalAssessment) || typeof r.motivation !== 'string' || !r.motivation.trim() || r.motivation.length > 2000 ||
        r.financialTreatment !== 'settle_return_commercially' || r.physicalContentsVerified !== false || r.faultEstablished !== false || r.costDecisionGranted !== false)
      throw new HttpsError('invalid-argument', 'L’examen financier explicite du retour et ses sources exactes sont requis.');
    returnDisposition = {...r, motivation: r.motivation.trim()} as RefundReturnDisposition;
  }
  const terms = parsePurchaseRefundTerms(d.terms);
  let convenienceReturn: ConvenienceReturnFinancialReference | undefined;
  if (d.protocol === 'purchase_refund_allocation_v2') {
    const r = supportObject(d.convenienceReturn, ['protocol', 'proposalId', 'agreementContentHash', 'requestId', 'financingTermsHash', 'receptionRequestId', 'receptionHash']);
    if (r.protocol !== 'convenience_return_financial_review_v1' || !/^cr_[a-f0-9]{64}$/.test(r.proposalId ?? '') ||
        !['agreementContentHash', 'financingTermsHash', 'receptionHash'].every(k => HASH.test(r[k] ?? '')) ||
        !supportId(r.requestId) || !supportRequestId(r.receptionRequestId) || terms.protocol !== 'purchase_refund_terms_v2' ||
        terms.returnLabelDeduction.financingTermsHash !== r.financingTermsHash || terms.returnLabelDeduction.requestId !== r.requestId ||
        agreement !== null || d.returnDisposition !== undefined || d.reviewedDisputeId !== undefined)
      throw new HttpsError('invalid-argument', 'Le contexte financier du retour de convenance est requis.');
    convenienceReturn = r as ConvenienceReturnFinancialReference;
  } else if (terms.protocol !== 'purchase_refund_terms_v1') throw new HttpsError('invalid-argument', 'Les termes V2 exigent l’allocation V2.');
  return {protocol: d.protocol, terms, basisHash: d.basisHash, cumulativeHash: d.cumulativeHash, agreement,
    ...(convenienceReturn ? {convenienceReturn} : {}),
    ...(returnDisposition ? {returnDisposition} : {}), ...(d.reviewedDisputeId === undefined ? {} : {reviewedDisputeId: supportId(d.reviewedDisputeId)})};
}
/** Identity of the real return and its available observations, never a
 * synthesized delivered event or proof of contents/physical reception. */
export function purchaseRefundReturnContext(transactionId: string, order: any) {
  if (!own(order, 'returnRequest') && !own(order, 'returnRequestedAt') && !own(order, 'returnLabelId'))
    return {protocol: 'purchase_refund_return_context_v1', qualification: 'not_applicable', requestId: null, version: null, sourceHash: null};
  if (!committedReturnReceipt(transactionId, order))
    return {protocol: 'purchase_refund_return_context_v1', qualification: 'unknown', requestId: null, version: null, sourceHash: null};
  const observation = (raw: any) => raw == null ? null : Object.fromEntries(['schemaVersion', 'provider', 'transactionId', 'leg', 'sourceHash',
    'labelId', 'statusCode', 'providerEventAtMs', 'providerLabelCreatedAtMs', 'observedContentHash', 'providerEventTimeSource', 'providerRevision']
    .map(key => [key, raw[key] ?? null]));
  return {protocol: 'purchase_refund_return_context_v1', qualification: 'native_committed_return', requestId: order.returnRequest.requestId as string,
    version: order.returnRequest.version as number, sourceHash: supportSourceHash({transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
      returnRequest: order.returnRequest, currentLabel: order.labelLifecycleCurrent?.return ?? null, returnLabelId: order.returnLabelId ?? null,
      // Reading the same business event again does not invalidate a human
      // disposition. A different source/label/event/content/time still does.
      observation: observation(order.returnTrackingObservation), delivery: observation(order.returnDeliveryProof), deliveredAt: order.returnDeliveredAt ?? null})};
}
/** A commercial settlement does not close/erase the return, release stock or
 * authorize transport. The independent release job may examine this receipt
 * only for the seller's remaining money after the native delivery window. */
export function purchaseRefundCaseDisposition(transactionId: string, order: any, decisionId: string,
  allocation: RefundAllocationReference, productReview: any, disputeId: string, refundIntentId: string | null) {
  return {protocol: 'purchase_refund_case_disposition_v1', transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
    decisionId, allocation, productReview: productReview ?? null, disputeId, refundIntentId, recordedAt: Timestamp.now(),
    inventoryReleaseAuthorized: false, shippingPermissionGranted: false, physicalPossessionVerified: false};
}
/** The immutable financial receipt and CURRENT return/corpus/claim set are
 * required together. A narrative or an old decision cannot lift another guard. */
export async function readPurchaseRefundReleaseContext(tx: FirebaseFirestore.Transaction, id: string, order: any) {
  const d = order.purchaseRefundCaseDisposition;
  if (!PURCHASE_REFUND_ENABLED || d?.protocol !== 'purchase_refund_case_disposition_v1' || d.transactionId !== id ||
      d.buyerId !== order.buyerId || d.sellerId !== order.sellerId || !HASH.test(d.decisionId ?? '') || !native(d.recordedAt)) return null;
  let a: RefundAllocationReference; try {a = parseRefundAllocation(d.allocation);} catch {return null;}
  try {
    const source = await readRefundAllocationSource(tx, id, order), decision = (await tx.get(db.collection('transactions').doc(id).collection('dispute_decisions').doc(d.decisionId))).data();
    if (!decision || decision.transactionId !== id || decision.buyerId !== order.buyerId || decision.sellerId !== order.sellerId ||
        supportHash(decision.allocation) !== supportHash(a) || !native(decision.committedAt)) return null;
    if (a.terms.settlementKind === 'retain_remaining') {
      if (d.refundIntentId !== null || decision.outcome !== 'dismissed' || decision.expectedDisputeId !== d.disputeId ||
          decision.committedAt.toMillis() !== d.recordedAt.toMillis()) return null;
    } else {
      const intent = order.refund?.intentId === d.refundIntentId ? await readSettledAllocationIntent(tx, id, order, order.refund) :
        await readAllocationHistoryIntent(tx, id, order, d.refundIntentId);
      if (!intent || intent.state !== 'succeeded' || decision.kind !== 'admin_financial_decision_v1' || decision.outcome !== 'reserved' ||
          intent.commercialDecision?.decisionId !== d.decisionId || decision.refundIntentId !== intent.intentId ||
          a.terms.caseHandling !== 'settle_selected_case') return null;
    }
    const claims = await tx.get(db.collection('disputes').where('transactionId', '==', id).limit(101));
    if (claims.size >= 101 || claims.docs.some(r => r.data().buyerId !== order.buyerId || r.data().sellerId !== order.sellerId ||
        !native(r.data().createdAt) || !['resolved', 'dismissed', 'closed'].includes(r.data().status))) return null;
    const claim = claims.docs.find(r => r.id === d.disputeId)?.data();
    const agreementTarget = decision.allocation?.agreement?.agreementId === d.disputeId;
    const convenienceTarget = a.convenienceReturn?.proposalId === d.disputeId && decision.allocation?.convenienceReturn?.proposalId === d.disputeId;
    if (!agreementTarget && !convenienceTarget && (!claim || claim.resolutionDecisionId !== d.decisionId)) return null;
    let returnFinanciallySettled = false;
    if (convenienceTarget) {
      const settled = order.convenienceReturnFinancialSettlement;
      if (settled?.protocol !== 'convenience_return_financial_settlement_v1' || settled.refundIntentId !== d.refundIntentId ||
          settled.decisionId !== d.decisionId || !native(settled.recordedAt) || supportHash(settled.reference) !== supportHash(a.convenienceReturn) ||
          a.terms.protocol !== 'purchase_refund_terms_v2' || settled.grossArticleCents !== a.terms.refund.articleCents ||
          settled.returnLabelCostCents !== a.terms.returnLabelDeduction.amountCents || settled.netRefundCents !== a.terms.cardCents + a.terms.walletCents) return null;
      returnFinanciallySettled = true;
    }
    if (a.returnDisposition) {
      const context = purchaseRefundReturnContext(id, order), r = a.returnDisposition, p = d.productReview;
      if (context.qualification !== 'native_committed_return' || context.requestId !== r.requestId || context.sourceHash !== r.sourceHash || !p ||
          p.caseId !== r.caseId || p.issueId !== r.issueId || p.issueHash !== r.issueHash || p.membersHash !== r.membersHash || p.authorizationSourceHash !== r.authorizationSourceHash) return null;
      const {readProductFinancialSource} = await import('./productReviewFinancial');
      const current = await readProductFinancialSource(tx, id, order, p.caseId, a.reviewedDisputeId ?? d.disputeId, p.topic,
        p.materialCapability === 'product_review_material_v1', p.parcelCapability === 'product_review_parcel_v1');
      // Closing this exact native complaint is expected. Its monetary/source
      // authorization hash changes; the examined immutable issue/members must not.
      if (current.reference.membersHash !== p.membersHash || current.reference.issueId !== p.issueId || current.reference.issueHash !== p.issueHash ||
          current.reference.caseSourceHash !== p.caseSourceHash) return null;
      returnFinanciallySettled = true;
    }
    return {returnFinanciallySettled, remainingSellerCents: source.remainingSellerCents, decisionId: d.decisionId,
      stockPermissionGranted: false, shippingPermissionGranted: false};
  } catch (e) {if (e instanceof HttpsError && ['failed-precondition', 'invalid-argument', 'permission-denied'].includes(e.code)) return null; throw e;}
}
export function hasPurchaseRefundContext(order: any): boolean {
  return own(order, 'refundAllocationState') || own(order, 'refundAgreementContext') || own(order, 'purchaseRefundCaseDisposition') ||
    own(order, 'purchaseRefundRepairContext') || own(order, 'convenienceReturnFinancialReservation') || order.refund?.allocation != null;
}
const unknownSource = () => new HttpsError('failed-precondition', 'La source initiale et les allocations doivent être rapprochées.', {reason: 'purchase_refund_source_unknown', newRefundPermissionGranted: false});
/** Frozen quote + native paid witness + original ledger entries; amounts alone
 * or a latest public article/fee never replace the original price contract. */
export async function readRefundAllocationSource(tx: FirebaseFirestore.Transaction, transactionId: string, order: any, omitIntentId?: string,
  ownConvenienceTermsHash?: string) {
  // A label authorization reserves the GROSS article budget before provider
  // I/O. A concurrent unrelated H proposal/allocation must not spend it.
  const convenience = order.convenienceReturnFinancialReservation;
  if (own(order, 'convenienceReturnFinancialReservation')) {
    const {readConvenienceReturnFinancing} = await import('./convenienceReturnFinancial');
    if (!await readConvenienceReturnFinancing(tx, transactionId, order) ||
        convenience.consumedByRefundIntentId === null && ownConvenienceTermsHash !== convenience.termsHash) throw unknownSource();
  }
  const policy = acceptedOrderPurchasePolicy(order, transactionId), q = policy ? (await tx.get(db.collection('shipping_quotes').doc(policy.quoteId))).data() : null;
  if (!policy || !q || q.schemaVersion !== 1 || q.ownerId !== order.buyerId || q.articleId !== order.articleId || q.sellerId !== order.sellerId ||
      !acceptedQuotePurchasePolicy(order, transactionId, q) || q.state !== 'claimed' || q.transactionId !== transactionId || q.acceptedTotal !== order.totalAmount || !native(order.paidAt) ||
      q.source?.amount !== order.amount || q.source?.fee !== order.serviceFee || q.source?.tax !== order.taxTotal || order.currency !== 'CAD') throw unknownSource();
  const articleCents = exactCents(order.amount), buyerFeeCents = exactCents(order.serviceFee), shippingCents = exactCents(order.shippingCost), tax = exactCents(order.taxTotal);
  const acceptedTax = acceptedPurchaseTaxSnapshot(order, q);
  // Never infer a historical positive split from present rates or an unbound
  // order-only object. Legacy zero-tax contracts still have zero components.
  const gstCents = tax === 0 ? 0 : exactCents(acceptedTax?.gst), qstCents = tax === 0 ? 0 : exactCents(acceptedTax?.qst);
  if (![articleCents, buyerFeeCents, shippingCents, gstCents, qstCents].every(amount) || gstCents! + qstCents! !== tax ||
      q.acceptedQualification?.version !== 3 || q.acceptedRateId !== order.shipEngineRateId || q.source?.hash !== policy.sourceHash ||
      order.shippingSnapshot?.rate?.rateId !== order.shipEngineRateId || order.shippingSnapshot?.rate?.shippingCents !== shippingCents) throw unknownSource();
  const initial: RefundComponents = {articleCents: articleCents!, buyerFeeCents: buyerFeeCents!, shippingCents: shippingCents!, gstCents: gstCents!, qstCents: qstCents!};
  const totalCents = exactCents(order.totalAmount), walletCents = ['wallet', 'mixed', 'wallet_and_card'].includes(order.paidVia) ? order.walletAmountUsed : 0;
  if (totalCents !== sum(initial) || !amount(walletCents) || walletCents > totalCents || !supportId(order.buyerId) || !supportId(order.sellerId) || order.buyerId === order.sellerId) throw unknownSource();
  const cardCents = totalCents - walletCents;
  const buyerRows = await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
  const debits = buyerRows.docs.filter(r => r.data().type === 'purchase_debit');
  if (buyerRows.size >= 101 || (walletCents > 0 ? debits.length !== 1 || debits[0].data().amount !== walletCents || !native(debits[0].data().createdAt) : debits.length !== 0)) throw unknownSource();
  const payment = nativePurchasePaymentSource(order, transactionId);
  if (order.nonShipmentPolicyWindow?.schemaVersion !== 1 || order.nonShipmentPolicyWindow?.transactionId !== transactionId ||
      !native(order.nonShipmentPolicyWindow?.startsAt) || !order.nonShipmentPolicyWindow.startsAt.isEqual(order.paidAt) || payment?.amountCents !== totalCents || payment.walletCents !== walletCents ||
      (cardCents > 0 ? payment.kind !== 'stripe_payment_intent' || payment.referenceId !== order.stripePaymentIntentId || order.capturedCardCents !== cardCents :
        payment.kind !== 'wallet_ledger' || payment.referenceId !== debits[0]?.id || order.paidVia !== 'wallet')) throw unknownSource();
  const sellerRows = await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
  const originals = sellerRows.docs.filter(r => r.data().type === 'sale_credit' || r.data().type === 'debt_repayment' && r.data().description === 'Vente — régularisation du solde dû');
  const sellerCents = order.sellerCreditedCents === undefined && originals.length === 0 && ['paid', 'refund_in_progress', 'refund_action_required'].includes(order.refund?.originalStatus ?? order.status) ? 0 : order.sellerCreditedCents;
  if (sellerRows.size >= 101 || !amount(sellerCents) || sellerCents > initial.articleCents || originals.some(r => !amount(r.data().amount) || !native(r.data().createdAt)) ||
      originals.reduce((n, r) => n + r.data().amount, 0) !== sellerCents) throw unknownSource();
  const basis = {protocol: 'purchase_refund_basis_v1', transactionId, buyerId: order.buyerId, sellerId: order.sellerId, articleId: order.articleId,
    initial, totalCents, cardCents, walletCents, originalSellerEntitlementCents: initial.articleCents, quoteId: policy.quoteId, policyHash: policy.hash, payment,
    buyerDebit: debits.map(r => [r.id, r.data()])};
  const basisHash = supportSourceHash(basis), rows = await tx.get(db.collection('transactions').doc(transactionId).collection('refund_allocations').orderBy('__name__').limit(101));
  if (rows.size >= 101) throw unknownSource();
  if (convenience?.consumedByRefundIntentId != null && !rows.docs.some(r => r.id === convenience.consumedByRefundIntentId &&
      r.data().terms?.protocol === 'purchase_refund_terms_v2' && r.data().terms.returnLabelDeduction?.financingTermsHash === convenience.termsHash &&
      r.data().terms.refund?.articleCents === convenience.terms.grossArticleCents)) throw unknownSource();
  if (own(order, 'refundAllocationState') && (order.refundAllocationState?.protocol !== 'purchase_refund_allocation_state_v1' ||
      order.refundAllocationState.transactionId !== transactionId || order.refundAllocationState.basisHash !== basisHash ||
      order.refundAllocationState.reviewRequired !== false || !rows.docs.some(r => r.id === order.refundAllocationState.latestIntentId)) ||
      rows.size > 0 && !own(order, 'refundAllocationState')) throw unknownSource();
  if (own(order, 'refundAgreementContext') && (order.refundAgreementContext?.protocol !== 'purchase_refund_agreement_context_v1' ||
      order.refundAgreementContext.transactionId !== transactionId || !/^ag_[a-f0-9]{64}$/.test(order.refundAgreementContext.agreementId ?? ''))) throw unknownSource();
  const used = zeros(); let usedCard = 0, usedWallet = 0, usedSeller = 0;
  const manifest: Array<[string, string]> = [];
  for (const row of rows.docs) {
    const d = row.data(); let terms: PurchaseRefundTerms;
    try {terms = parsePurchaseRefundTerms(d.terms);} catch {throw unknownSource();}
    if (d.protocol !== 'purchase_refund_allocation_record_v1' || d.refundIntentId !== row.id || d.transactionId !== transactionId || d.basisHash !== basisHash ||
        d.buyerId !== order.buyerId || d.sellerId !== order.sellerId || !native(d.reservedAt) || d.reservationHash !== supportSourceHash(d.reservation) ||
        d.reservation?.termsHash !== supportHash(terms) || d.reservation?.basisHash !== basisHash || d.reservation?.refundIntentId !== row.id) throw unknownSource();
    if (row.id === omitIntentId) continue;
    for (const k of REFUND_COMPONENTS) used[k] += terms.refund[k];
    usedCard += terms.cardCents; usedWallet += terms.walletCents; usedSeller += terms.sellerDebitCents; manifest.push([row.id, d.reservationHash]);
  }
  if (REFUND_COMPONENTS.some(k => !amount(used[k]) || used[k] > initial[k]) || usedCard > cardCents || usedWallet > walletCents || usedSeller > sellerCents) throw unknownSource();
  if (order.refund != null && !order.refund.allocation || buyerRows.docs.some(r => r.data().type === 'refund_credit' && !rows.docs.some(a => a.id === r.data().refundIntentId))) throw unknownSource();
  const remaining = Object.fromEntries(REFUND_COMPONENTS.map(k => [k, initial[k] - used[k]])) as RefundComponents;
  return {basis, basisHash, initial, remaining, totalCents, cardCents, walletCents, sellerCents, used,
    sellerCreditSourceHash: supportSourceHash(originals.map(r => [r.id, r.data()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
    remainingCardCents: cardCents - usedCard, remainingWalletCents: walletCents - usedWallet, remainingSellerCents: sellerCents - usedSeller,
    cumulativeHash: supportHash(manifest), rows, buyerRows, sellerRows};
}
export async function qualifyRefundAllocation(tx: FirebaseFirestore.Transaction, id: string, order: any, reference: RefundAllocationReference, omitIntentId?: string) {
  const source = await readRefundAllocationSource(tx, id, order, omitIntentId, reference.convenienceReturn?.financingTermsHash), t = reference.terms;
  if (reference.basisHash !== source.basisHash || reference.cumulativeHash !== source.cumulativeHash ||
      REFUND_COMPONENTS.some(k => t.refund[k] + t.retained[k] !== source.remaining[k]) || t.cardCents > source.remainingCardCents ||
      t.walletCents > source.remainingWalletCents || t.sellerDebitCents > source.remainingSellerCents) throw unknownSource();
  if (t.protocol === 'purchase_refund_terms_v2') {
    const {readEffectiveConvenienceReturnFinancing} = await import('./convenienceReturnFinancial');
    const financing = await readEffectiveConvenienceReturnFinancing(tx, id, order), c = reference.convenienceReturn;
    const {readConvenienceReturnFinancialReception} = await import('./convenienceReturnReception');
    const reception = c ? await readConvenienceReturnFinancialReception(tx, id, order, c) : null;
    if (!financing || !reception || reference.protocol !== 'purchase_refund_allocation_v2' || !c ||
        financing.termsHash !== c.financingTermsHash || financing.terms.requestId !== c.requestId ||
        financing.terms.grossArticleCents !== t.refund.articleCents || financing.terms.returnLabelCostCents !== t.returnLabelDeduction.amountCents ||
        financing.terms.netRefundCents !== t.cardCents + t.walletCents ||
        financing.terms.basisHash !== source.basisHash || financing.terms.cumulativeHash !== source.cumulativeHash ||
        financing.consumedByRefundIntentId !== null && financing.consumedByRefundIntentId !== omitIntentId) throw unknownSource();
  } else if (reference.convenienceReturn) throw unknownSource();
  const evidence = [];
  for (const r of t.provenance.evidenceReferences) {
    const context = {kind: 'order' as const, id}, raw = (await tx.get(productReviewCaseRef(context).collection('evidence').doc(r.evidenceId))).data();
    const proof = await readProductReviewEvidenceProof(tx, context, r.evidenceId, raw);
    if (!proof || raw?.contentHash !== r.contentHash || ![order.buyerId, order.sellerId].includes(proof.document.actorId)) throw unknownSource();
    evidence.push(r);
  }
  return {...source, evidence};
}
/** Reservation counts against all caps before any I/O. A failed/unknown
 * provider attempt remains this allocation, never a free new refund budget. */
export async function prepareRefundAllocationReservation(tx: FirebaseFirestore.Transaction, id: string, order: any, reference: RefundAllocationReference,
  intentId: string, decisionId: string, actorId: string) {
  if (!PURCHASE_REFUND_ENABLED) throw new HttpsError('failed-precondition', 'Les allocations sont en préparation.', {reason: 'purchase_refund_not_exposed'});
  const qualified = await qualifyRefundAllocation(tx, id, order, reference);
  const agreement = reference.agreement ? await readRefundAgreementProof(tx, id, order, reference.agreement, reference.terms) : null;
  if (reference.agreement && !agreement || order.refundAllocationState?.reviewRequired === true) throw unknownSource();
  const context = await agreementSource(tx, id, order, undefined, reference.convenienceReturn?.financingTermsHash);
  const agreementCapture = agreement ? {contentHash: agreement.contentHash, document: agreement.document} : null;
  const reservation = {protocol: 'purchase_refund_reservation_v1', transactionId: id, refundIntentId: intentId, decisionId, actorId,
    basisHash: qualified.basisHash, cumulativeHashBeforeReserve: qualified.cumulativeHash, termsHash: supportHash(reference.terms),
    agreementReference: reference.agreement, agreementCaptureHash: supportSourceHash(agreementCapture), agreementSourceHash: context.sourceHash,
    initial: qualified.initial, originalCardCents: qualified.cardCents, originalWalletCents: qualified.walletCents,
    originalSellerCents: qualified.sellerCents, sellerCreditSourceHash: qualified.sellerCreditSourceHash};
  const record = {protocol: 'purchase_refund_allocation_record_v1', refundIntentId: intentId, transactionId: id, buyerId: order.buyerId, sellerId: order.sellerId,
    terms: reference.terms, basis: qualified.basis, basisHash: qualified.basisHash, reservation, reservationHash: supportSourceHash(reservation),
    reservedAt: Timestamp.now(), agreementCapture, settlement: null};
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > 750000) throw unknownSource();
  const previous = order.refund ? await readSettledAllocationIntent(tx, id, order, order.refund) : null;
  if (order.refund && !previous) throw unknownSource();
  const archived = previous ? await tx.get(refundHistoryRef(id, previous.intentId)) : null;
  if (archived?.exists) throw unknownSource();
  return {record, previous, agreement, qualified, bilateralAgreementVerified: agreement !== null,
    commit: () => {
      tx.create(refundAllocationRef(id, intentId), record);
      if (previous) tx.create(refundHistoryRef(id, previous.intentId), {protocol: 'purchase_refund_history_v1', transactionId: id,
        intentId: previous.intentId, buyerId: order.buyerId, sellerId: order.sellerId, originalIntentHash: supportSourceHash(previous),
        originalIntent: previous, currentIntent: previous, archivedAt: Timestamp.now()});
      tx.update(db.collection('transactions').doc(id), {refundAllocationState: {protocol: 'purchase_refund_allocation_state_v1', transactionId: id,
        ...order.refundAllocationState, basisHash: qualified.basisHash, latestIntentId: intentId, reviewRequired: false}});
      if (agreement) {const document = {...agreement.document, consumption: {refundIntentId: intentId, decisionId, reservedAt: Timestamp.now()}};
        tx.update(agreementRef(id, reference.agreement!.agreementId), {document, contentHash: supportSourceHash(document)});}
      if (reference.convenienceReturn) tx.update(db.collection('transactions').doc(id),
        {'convenienceReturnFinancialReservation.consumedByRefundIntentId': intentId});
    }};
}
/** Native association of historical/applied money. A reserve or a current
 * status alone never qualifies the old allocation before a later tranche. */
export async function readSettledAllocationIntent(tx: FirebaseFirestore.Transaction, id: string, order: any, intent: any) {
  if (!intent?.allocation || intent.state !== 'succeeded' || !native(intent.fundsAppliedAt) || intent.currency !== 'cad' ||
      intent.buyerId !== order.buyerId || intent.sellerId !== order.sellerId || intent.outstandingCardCents !== 0 ||
      intent.freezeCents !== 0 || intent.bankWaiting || intent.legacyReconciliationRequired || order.refundAllocationState?.reviewRequired === true) return null;
  const r = (await tx.get(refundAllocationRef(id, intent.intentId))).data();
  const repairedCard = intent.cardRepairSettlement != null && await (await import('./refundRepair')).readRefundRepairCardSettlement(tx, id, order, intent);
  const manual = intent.manualBankSettlement != null && await (await import('./refundRepair')).readManualRefundSettlement(tx,id,order,intent);
  if (!r || r.reservationHash !== intent.allocation.reservationHash || r.reservationHash !== supportSourceHash(r.reservation) ||
      r.reservation?.agreementCaptureHash !== supportSourceHash(r.agreementCapture ?? null) ||
      r.refundIntentId !== intent.intentId || r.transactionId !== id || r.buyerId !== order.buyerId || r.sellerId !== order.sellerId ||
      supportHash(r.terms) !== r.reservation.termsHash || !native(r.settlement?.appliedAt) || !r.settlement.appliedAt.isEqual(intent.fundsAppliedAt) ||
      r.terms.cardCents !== intent.cardAmountCents || r.terms.walletCents !== intent.walletAmountCents || r.terms.sellerDebitCents !== intent.sellerDebitCents ||
      (intent.cardAmountCents > 0 && (r.settlement.providerRefundId !== intent.stripeRefundId ||
        !manual&&((!repairedCard && intent.providerStatus !== 'succeeded') || intent.cardConfirmedCents !== intent.cardAmountCents)))) return null;
  const seller = intent.sellerDebitCents > 0 ? (await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').doc(`refund_debit_${intent.intentId}`))).data() : null;
  const buyer = intent.walletAmountCents > 0 ? (await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').doc(`refund_credit_${intent.intentId}`))).data() : null;
  if (intent.sellerDebitCents > 0 && (!seller || seller.type !== 'refund_debit' || seller.transactionId !== id || seller.refundIntentId !== intent.intentId ||
      !amount(seller.amount) || !amount(seller.debtRecorded) || seller.amount + seller.debtRecorded !== intent.sellerDebitCents || !native(seller.createdAt) || !seller.createdAt.isEqual(intent.fundsAppliedAt)) ||
      intent.walletAmountCents > 0 && (!buyer || buyer.type !== 'refund_credit' || buyer.transactionId !== id || buyer.refundIntentId !== intent.intentId ||
      buyer.amount !== intent.walletAmountCents || !native(buyer.createdAt) || !buyer.createdAt.isEqual(intent.fundsAppliedAt))) return null;
  return intent;
}
/** Local ledger truth remains readable if the same provider refund later
 * fails. This deliberately makes no current-provider or bank-arrival claim. */
export async function allocationLocalMovementsVerified(tx: FirebaseFirestore.Transaction, id: string, order: any, intent: any, r: any) {
  const s = r?.settlement;
  if (!intent || !native(intent.fundsAppliedAt) || s?.protocol !== 'purchase_refund_allocation_settlement_v1' ||
      s.refundIntentId !== intent.intentId || !native(s.appliedAt) || !s.appliedAt.isEqual(intent.fundsAppliedAt) ||
      r.reservationHash !== intent.allocation?.reservationHash || r.buyerId !== order.buyerId || r.sellerId !== order.sellerId ||
      r.terms.cardCents !== intent.cardAmountCents || r.terms.walletCents !== intent.walletAmountCents ||
      r.terms.sellerDebitCents !== intent.sellerDebitCents || s.sellerDebitCents !== intent.sellerDebitCents ||
      intent.cardAmountCents > 0 && s.providerRefundId !== intent.stripeRefundId) return false;
  const seller = intent.sellerDebitCents > 0 ? (await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').doc(`refund_debit_${intent.intentId}`))).data() : null;
  const buyer = intent.walletAmountCents > 0 ? (await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').doc(`refund_credit_${intent.intentId}`))).data() : null;
  return !(intent.sellerDebitCents > 0 && (seller?.type !== 'refund_debit' || seller.transactionId !== id || seller.refundIntentId !== intent.intentId ||
      !amount(seller.amount) || !amount(seller.debtRecorded) || seller.amount + seller.debtRecorded !== intent.sellerDebitCents ||
      !native(seller.createdAt) || !seller.createdAt.isEqual(s.appliedAt)) ||
    intent.walletAmountCents > 0 && (buyer?.type !== 'refund_credit' || buyer.transactionId !== id || buyer.refundIntentId !== intent.intentId ||
      buyer.amount !== intent.walletAmountCents || !native(buyer.createdAt) || !buyer.createdAt.isEqual(s.appliedAt)));
}
export async function readAllocationHistoryIntent(tx: FirebaseFirestore.Transaction, id: string, order: any, intentId: string) {
  const raw = (await tx.get(refundHistoryRef(id, intentId))).data();
  if (raw?.protocol !== 'purchase_refund_history_v1' || raw.transactionId !== id || raw.intentId !== intentId || raw.buyerId !== order.buyerId || raw.sellerId !== order.sellerId ||
      !native(raw.archivedAt) || raw.originalIntentHash !== supportSourceHash(raw.originalIntent) || raw.currentIntent?.intentId !== intentId ||
      !raw.originalIntent?.fundsAppliedAt || supportHash([raw.currentIntent.cardAmountCents, raw.currentIntent.walletAmountCents, raw.currentIntent.sellerDebitCents,
        raw.currentIntent.idempotencyKey, raw.currentIntent.commercialDecision, raw.currentIntent.allocation, raw.currentIntent.fundsAppliedAt]) !==
      supportHash([raw.originalIntent.cardAmountCents, raw.originalIntent.walletAmountCents, raw.originalIntent.sellerDebitCents,
        raw.originalIntent.idempotencyKey, raw.originalIntent.commercialDecision, raw.originalIntent.allocation, raw.originalIntent.fundsAppliedAt])) return null;
  // The original immutable association is checked even if a later provider
  // status corrects the current observation; no second local settlement.
  if (!await readSettledAllocationIntent(tx, id, {...order, refundAllocationState: {...order.refundAllocationState, reviewRequired: false}}, raw.originalIntent)) return null;
  return raw.currentIntent;
}
export async function qualifyRefundAllocationRenewal(tx: FirebaseFirestore.Transaction, id: string, order: any, reference: RefundAllocationReference) {
  const intent = order.refund, r = intent?.intentId ? (await tx.get(refundAllocationRef(id, intent.intentId))).data() : null;
  if (!intent?.allocation || !r || r.reservationHash !== intent.allocation.reservationHash || r.reservationHash !== supportSourceHash(r.reservation) ||
      r.refundIntentId !== intent.intentId || r.reservation.termsHash !== supportHash(reference.terms) ||
      reference.terms.cardCents !== intent.cardAmountCents || reference.terms.walletCents !== intent.walletAmountCents ||
      reference.terms.sellerDebitCents !== intent.sellerDebitCents || intent.fundsAppliedAt || r.settlement !== null) throw unknownSource();
  await qualifyRefundAllocation(tx, id, order, reference, intent.intentId);
  const agreement = reference.agreement ? await readRefundAgreementProof(tx, id, order, reference.agreement, reference.terms, intent.intentId) : null;
  if (reference.agreement && !agreement) throw unknownSource();
  return {sourceContextHash: (await agreementSource(tx, id, order, intent.intentId, reference.convenienceReturn?.financingTermsHash)).sourceHash, bilateralAgreementVerified: agreement !== null};
}
export async function purchaseRefundNewEffectAllowed(tx: FirebaseFirestore.Transaction, id: string, order: any, operatorCurrent: boolean) {
  const intent = order.refund, authority = intent?.purchaseRefundAuthorization ?? intent?.commercialDecision;
  const reference: RefundAllocationReference | undefined = authority?.allocation;
  if (!reference) return !hasPurchaseRefundContext(order);
  if (!PURCHASE_REFUND_ENABLED) return false;
  const authMs = authority.operatorAuthTime * 1000, nowMs = Date.now();
  if (!operatorCurrent || !Number.isSafeInteger(authority.operatorAuthTime) || !Number.isSafeInteger(authMs) || authMs < 1 ||
      authMs > nowMs || nowMs - authMs > 300000 || intent.fundsAppliedAt || order.refundAllocationState?.reviewRequired !== false) return false;
  try {
    await supportAdmin(tx, authority.actorUid, false);
    await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(authority.actorUid))).data(), tx, authority.actorUid);
    const r = (await tx.get(refundAllocationRef(id, intent.intentId))).data();
    const decision = (await tx.get(db.collection('transactions').doc(id).collection('dispute_decisions').doc(authority.decisionId))).data();
    if (!r || r.reservationHash !== intent.allocation?.reservationHash || r.reservationHash !== supportSourceHash(r.reservation) ||
        r.refundIntentId !== intent.intentId || decision?.outcome !== 'reserved' || decision.refundIntentId !== intent.intentId ||
        decision.actorUid !== authority.actorUid || decision.payloadHash !== authority.payloadHash || supportHash(decision.allocation) !== supportHash(reference) ||
        decision.cardCents !== intent.cardAmountCents || decision.walletCents !== intent.walletAmountCents || decision.sellerDebitCents !== intent.sellerDebitCents ||
        !native(decision.committedAt) || authority.resume && (authority.resume.refundIntentId !== intent.intentId || authority.resume.refundAttemptId !== intent.attemptId) ||
        !authority.resume && r.reservation.decisionId !== authority.decisionId) return false;
    await qualifyRefundAllocation(tx, id, order, reference, intent.intentId);
    if ((await agreementSource(tx, id, order, intent.intentId, reference.convenienceReturn?.financingTermsHash)).sourceHash !== (authority.sourceContextHash ?? r.reservation.agreementSourceHash)) return false;
    if (reference.agreement && !await readRefundAgreementProof(tx, id, order, reference.agreement, reference.terms, intent.intentId)) return false;
    return true;
  } catch (e) {if (e instanceof HttpsError && ['failed-precondition', 'invalid-argument', 'permission-denied'].includes(e.code)) return false; throw e;}
}
/** Actual attributed debits, never original gross minus an arbitrary amount.
 * This prevents a later tranche/release from consuming another sale's hold. */
export async function readSellerAllocationConsumption(tx: FirebaseFirestore.Transaction, id: string, order: any) {
  const result = {sellerDebitCents: 0, pendingCents: 0, heldCents: 0, releasedCents: 0};
  if (!own(order, 'refundAllocationState')) return result;
  const state = order.refundAllocationState;
  if (state?.protocol !== 'purchase_refund_allocation_state_v1' || state.transactionId !== id || !HASH.test(state.basisHash ?? '') || state.reviewRequired !== false) throw unknownSource();
  const rows = await tx.get(db.collection('transactions').doc(id).collection('refund_allocations').orderBy('__name__').limit(101));
  if (rows.size >= 101 || rows.empty || !rows.docs.some(r => r.id === state.latestIntentId)) throw unknownSource();
  for (const row of rows.docs) {
    const r = row.data(), s = r.settlement;
    let terms: PurchaseRefundTerms; try {terms = parsePurchaseRefundTerms(r.terms);} catch {throw unknownSource();}
    if (r.protocol !== 'purchase_refund_allocation_record_v1' || r.refundIntentId !== row.id || r.transactionId !== id || r.basisHash !== state.basisHash ||
        r.basisHash !== supportSourceHash(r.basis) || r.reservation?.basisHash !== r.basisHash || r.reservation.refundIntentId !== row.id ||
        r.reservation.termsHash !== supportHash(terms) || r.buyerId !== order.buyerId || r.sellerId !== order.sellerId ||
        r.reservationHash !== supportSourceHash(r.reservation) || !native(r.reservedAt)) throw unknownSource();
    if (s === null) continue;
    if (s?.protocol !== 'purchase_refund_allocation_settlement_v1' || s.refundIntentId !== row.id || !native(s.appliedAt) ||
        ![s.sellerDebitCents, s.salePendingConsumedCents, s.saleHeldConsumedCents, s.saleReleasedConsumedCents, s.fromPendingCents, s.fromHeldCents,
          s.fromBalanceCents, s.debtCents].every(amount) || s.sellerDebitCents !== r.terms.sellerDebitCents ||
        s.fromPendingCents + s.fromHeldCents + s.fromBalanceCents + s.debtCents !== s.sellerDebitCents ||
        s.salePendingConsumedCents > s.fromPendingCents || s.saleHeldConsumedCents > s.fromHeldCents ||
        s.saleReleasedConsumedCents > s.fromHeldCents + s.fromBalanceCents) throw unknownSource();
    if (s.sellerDebitCents > 0) {
      const ledger = (await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').doc(`refund_debit_${row.id}`))).data();
      if (ledger?.type !== 'refund_debit' || ledger.transactionId !== id || ledger.refundIntentId !== row.id ||
          ledger.amount !== s.fromPendingCents + s.fromHeldCents + s.fromBalanceCents || ledger.debtRecorded !== s.debtCents ||
          !native(ledger.createdAt) || !ledger.createdAt.isEqual(s.appliedAt)) throw unknownSource();
    }
    result.sellerDebitCents += s.sellerDebitCents; result.pendingCents += s.salePendingConsumedCents;
    result.heldCents += s.saleHeldConsumedCents; result.releasedCents += s.saleReleasedConsumedCents;
  }
  if (!Object.values(result).every(amount)) throw unknownSource();
  return result;
}
const effects = {financialEffectAuthorized: false, inventoryReleaseAuthorized: false, shippingPermissionGranted: false,
  physicalPossessionVerified: false, externalAuthenticityVerified: false, bankArrivalVerified: false};
async function agreementSource(tx: FirebaseFirestore.Transaction, id: string, order: any, omitIntentId?: string, ownConvenienceTermsHash?: string) {
  const money = await readRefundAllocationSource(tx, id, order, omitIntentId, ownConvenienceTermsHash);
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', id).limit(101));
  if (claims.size >= 101 || claims.docs.some(r => r.data().buyerId !== order.buyerId || r.data().sellerId !== order.sellerId || !native(r.data().createdAt))) throw unknownSource();
  const excluded = ['refundAgreementContext', 'refundAllocationState', 'refund', 'refundBlocked', 'refundReason', 'refundStartedAt',
    'refundInventoryReviewRequired', 'refundCommercialReviewRequired', 'stripeRefundId', 'refundedAt', 'refundedVia', 'updatedAt', 'trackingRead', 'returnTrackingRead'];
  const examined: Record<string, any> = Object.fromEntries(Object.entries(order).filter(([k]) => !excluded.includes(k)));
  // The reservation's native consumption marker changes atomically with H's
  // own reserve; it must not invalidate that same authorization before I/O.
  if (ownConvenienceTermsHash && examined.convenienceReturnFinancialReservation?.termsHash === ownConvenienceTermsHash)
    examined.convenienceReturnFinancialReservation = {...examined.convenienceReturnFinancialReservation, consumedByRefundIntentId: null};
  // Only an in-flight engine status is normalized. Once a previous tranche
  // settled, its restored commercial status is the CURRENT source of a new
  // offer. Reusing that older intent's originalStatus would self-invalidate
  // every subsequent reservation after a complaint was closed.
  if (order.refund?.allocation && ['refund_in_progress', 'refund_action_required'].includes(order.status)) examined.status = order.refund.originalStatus;
  const sourceHash = supportSourceHash([id, examined, money.basisHash, money.cumulativeHash,
    claims.docs.map(r => [r.id, r.data()]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  return {money, claims, sourceHash};
}
export async function readRefundAgreementProof(tx: FirebaseFirestore.Transaction, id: string, order: any, reference: RefundAgreementReference,
  terms: PurchaseRefundTerms, omitIntentId?: string) {
  const raw = (await tx.get(agreementRef(id, reference.agreementId))).data(), document = raw?.document;
  if (!document || raw?.protocol !== 'purchase_refund_agreement_v1' || raw.contentHash !== supportSourceHash(document) ||
      document.transactionId !== id || document.agreementId !== reference.agreementId || document.buyerId !== order.buyerId || document.sellerId !== order.sellerId ||
      document.termsHash !== reference.termsHash || document.termsHash !== supportHash(terms) || supportHash(document.terms) !== supportHash(terms) ||
      document.version !== reference.version || document.state !== 'proposed' || !native(document.proposedAt) ||
      document.expiresAt !== null && (!(document.expiresAt instanceof Timestamp) || document.expiresAt.toMillis() <= Date.now()) ||
      order.refundAgreementContext?.agreementId !== reference.agreementId) return null;
  const proposal = (await tx.get(agreementReceiptRef(document.proposedBy, document.proposalRequestId))).data();
  if (![order.buyerId, order.sellerId].includes(document.proposedBy) || document.agreementId !== 'ag_' + supportHash([document.proposedBy, document.proposalRequestId]) ||
      proposal?.state !== 'committed' || proposal.actorId !== document.proposedBy || proposal.command?.action !== 'propose' ||
      proposal.command.transactionId !== id || proposal.command.termsHash !== document.termsHash || supportHash(proposal.command.terms) !== document.termsHash ||
      proposal.payloadHash !== supportHash(proposal.command) || !native(proposal.recordedAt) || !proposal.recordedAt.isEqual(document.proposedAt)) return null;
  const source = await agreementSource(tx, id, order, omitIntentId);
  if (document.sourceHash !== source.sourceHash || document.basisHash !== source.money.basisHash || document.cumulativeHash !== source.money.cumulativeHash) return null;
  const acceptances = document.acceptances;
  if (supportHash(acceptances) !== reference.acceptanceHash) return null;
  for (const role of ['buyer', 'seller'] as const) {
    const a = acceptances?.[role];
    if (a?.actorId !== order[`${role}Id`] || a.termsHash !== document.termsHash || !native(a.recordedAt) || !a.requestId) return null;
    const receipt = (await tx.get(agreementReceiptRef(a.actorId, a.requestId))).data();
    if (receipt?.protocol !== 'purchase_refund_agreement_command_v1' || receipt.actorId !== a.actorId || receipt.requestId !== a.requestId ||
        receipt.state !== 'committed' || receipt.command?.action !== 'accept' || receipt.command.transactionId !== id ||
        receipt.command.agreementId !== reference.agreementId || receipt.command.termsHash !== document.termsHash ||
        receipt.payloadHash !== supportHash(receipt.command) || !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(a.recordedAt)) return null;
  }
  return {raw: raw!, document, contentHash: raw!.contentHash as string, source};
}
function agreementView(raw: any, id: string, order: any, currentSourceHash: string | null) {
  const d = raw?.document;
  if (raw?.protocol !== 'purchase_refund_agreement_v1' || !d || raw.contentHash !== supportSourceHash(d) || d.transactionId !== id ||
      d.buyerId !== order.buyerId || d.sellerId !== order.sellerId || !native(d.proposedAt) || !Number.isSafeInteger(d.version) || d.version < 1) return null;
  let terms: PurchaseRefundTerms; try {terms = parsePurchaseRefundTerms(d.terms);} catch {return null;}
  if (!/^ag_[a-f0-9]{64}$/.test(d.agreementId ?? '') || !['proposed', 'refused', 'withdrawn'].includes(d.state) ||
      d.termsHash !== supportHash(terms) || !['sourceHash', 'basisHash', 'cumulativeHash'].every(k => HASH.test(d[k] ?? '')) ||
      d.expiresAt !== null && !(d.expiresAt instanceof Timestamp) || d.consumption != null &&
      (!/^[A-Za-z0-9_-]{1,200}$/.test(d.consumption.refundIntentId ?? '') || !HASH.test(d.consumption.decisionId ?? '') || !native(d.consumption.reservedAt))) return null;
  const expired = d.expiresAt !== null && (!(d.expiresAt instanceof Timestamp) || d.expiresAt.toMillis() <= Date.now());
  return {protocol: 'purchase_refund_agreement_view_v1', agreementId: d.agreementId, contentHash: raw.contentHash, version: d.version,
    terms, termsHash: d.termsHash, state: d.state, expiresAt: d.expiresAt instanceof Timestamp ? d.expiresAt.toDate().toISOString() : null,
    proposedAt: d.proposedAt.toDate().toISOString(), sourceHash: d.sourceHash, basisHash: d.basisHash, cumulativeHash: d.cumulativeHash,
    sourceCurrentlyMatches: !expired && d.state === 'proposed' && currentSourceHash !== null && d.sourceHash === currentSourceHash && order.refundAgreementContext?.agreementId === d.agreementId,
    expired, buyerAcceptedRecorded: !!d.acceptances?.buyer, sellerAcceptedRecorded: !!d.acceptances?.seller,
    consumption: d.consumption ? {refundIntentId: d.consumption.refundIntentId, decisionId: d.consumption.decisionId, allocationReserved: true, moneyAppliedVerified: false} : null, ...effects};
}
function agreementCommand(raw: any) {
  const d = supportObject(raw, ['transactionId', 'action', 'sourceHash', 'sourceRevision', 'agreementId', 'expectedVersion', 'termsHash', 'terms', 'expiresAt', 'acknowledged']);
  if (!['propose', 'accept', 'refuse', 'withdraw'].includes(d.action) || !HASH.test(d.sourceHash ?? '') || typeof d.sourceRevision !== 'string' ||
      !/^\d+:\d+$/.test(d.sourceRevision) || !Number.isSafeInteger(d.expectedVersion) || d.expectedVersion < 0 ||
      !HASH.test(d.termsHash ?? '') || d.acknowledged !== true) throw new HttpsError('invalid-argument', 'Intention d’accord exacte requise.');
  const terms = d.action === 'propose' ? parsePurchaseRefundTerms(d.terms) : null;
  if (d.action === 'propose' ? d.agreementId !== null || d.expectedVersion !== 0 || supportHash(terms) !== d.termsHash :
      !/^ag_[a-f0-9]{64}$/.test(d.agreementId ?? '') || d.expectedVersion < 1 || d.terms !== null || d.expiresAt !== null) throw new HttpsError('invalid-argument', 'Version et termes exacts requis.');
  if (d.expiresAt !== null && (typeof d.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(d.expiresAt) ||
      !Number.isFinite(Date.parse(d.expiresAt)) || new Date(d.expiresAt).toISOString() !== d.expiresAt)) throw new HttpsError('invalid-argument', 'Expiration déclarée exacte requise.');
  return {transactionId: supportId(d.transactionId), action: d.action, sourceHash: d.sourceHash, sourceRevision: d.sourceRevision,
    agreementId: d.agreementId, expectedVersion: d.expectedVersion, termsHash: d.termsHash, terms, expiresAt: d.expiresAt, acknowledged: true};
}
export const purchaseRefundModes = ['purchase_refund_source_observe', 'purchase_refund_admin_source_observe', 'purchase_refund_agreement_preview', 'purchase_refund_agreement_command', 'purchase_refund_agreements_observe'];
export async function handlePurchaseRefundAgreement(request: any) {
  const uid = supportUid(request), raw = request.data;
  if (raw.capability !== 'purchase_refund_v1') throw new HttpsError('invalid-argument', 'Version de l’accord requise.');
  if (raw.mode === 'purchase_refund_agreement_command') {
    supportObject(raw, ['mode', 'capability', 'expectedUid', 'requestId', 'modeAction', 'command']);
    const command = agreementCommand(raw.command), requestId = supportRequestId(raw.requestId), payloadHash = supportHash(command);
    if (!['execute', 'observe', 'neutralize'].includes(raw.modeAction)) throw new HttpsError('invalid-argument', 'Action du journal inconnue.');
    return db.runTransaction(async tx => {
      const receiptRef = agreementReceiptRef(uid, requestId), prior = (await tx.get(receiptRef)).data();
      if (prior) {
        if (prior.protocol !== 'purchase_refund_agreement_command_v1' || prior.actorId !== uid || prior.requestId !== requestId || prior.payloadHash !== payloadHash ||
            supportHash(prior.command) !== payloadHash || !native(prior.recordedAt) || !['committed', 'not_executed'].includes(prior.state)) throw new HttpsError('already-exists', 'Reçu d’intention différent ou inconnu.');
        return {...prior, recordedAt: prior.recordedAt.toDate().toISOString(), ...effects};
      }
      const now = Timestamp.now(), base = {protocol: 'purchase_refund_agreement_command_v1', actorId: uid, requestId, command, payloadHash};
      if (raw.modeAction === 'observe') return {...base, state: 'unrecorded', reason: null, agreementId: null, version: null, recordedAt: null, ...effects};
      const refuse = (reason: string) => {const receipt = {...base, state: 'not_executed', reason, agreementId: null, version: null, recordedAt: now};
        tx.create(receiptRef, receipt); return {...receipt, recordedAt: now.toDate().toISOString(), ...effects};};
      if (raw.modeAction === 'neutralize') return refuse('requester_neutralized');
      if (!PURCHASE_REFUND_ENABLED) return refuse('purchase_refund_not_exposed');
      const ref = db.collection('transactions').doc(command.transactionId), snap = await tx.get(ref), order = snap.data();
      if (!order || ![order.buyerId, order.sellerId].includes(uid)) return refuse('not_a_native_participant');
      // A NEW native acceptance can later support money. Qualify the present
      // session without requiring a commercial profile, role, DOB or purchase
      // admission. The helper's admin-claim return is intentionally unused:
      // its UID/disabled/cutoff checks apply to this ordinary SDK actor too.
      // Own receipts, observation and neutralization above remain SDK-only.
      const security = (await tx.get(db.collection('eligibility_profiles').doc(uid))).data();
      const authenticatedAtMs = request.auth.token?.auth_time * 1000;
      if (!Number.isSafeInteger(authenticatedAtMs) || authenticatedAtMs < 1 || authenticatedAtMs > Date.now())
        return refuse('participant_session_unavailable');
      try {await supportCurrentAdminSession(request);} catch (e) {
        if (e instanceof HttpsError && e.code === 'permission-denied' || (e as {code?: string})?.code === 'auth/user-not-found')
          return refuse('participant_session_unavailable');
        throw e;
      }
      try {await assertAccountSecurityOpen(security, tx, uid);} catch (e) {
        if (e instanceof HttpsError && e.code === 'failed-precondition') return refuse('participant_security_restricted');
        throw e;
      }
      let source: Awaited<ReturnType<typeof agreementSource>>;
      try {source = await agreementSource(tx, command.transactionId, order);} catch (e) {if (e instanceof HttpsError && e.code === 'failed-precondition') return refuse('native_sources_unknown'); throw e;}
      if (source.sourceHash !== command.sourceHash || supportRevision(snap) !== command.sourceRevision) return refuse('source_changed');
      const id = command.action === 'propose' ? 'ag_' + supportHash([uid, requestId]) : command.agreementId;
      const aref = agreementRef(command.transactionId, id), previous = (await tx.get(aref)).data();
      let d: any;
      if (command.action === 'propose') {
        const terms = command.terms!, allocation: RefundAllocationReference = {protocol: 'purchase_refund_allocation_v1', terms,
          basisHash: source.money.basisHash, cumulativeHash: source.money.cumulativeHash, agreement: null};
        await qualifyRefundAllocation(tx, command.transactionId, order, allocation);
        if (previous || command.expiresAt !== null && Date.parse(command.expiresAt) <= Date.now()) return refuse('agreement_or_expiration_changed');
        d = {protocol: 'purchase_refund_agreement_v1', agreementId: id, transactionId: command.transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
          terms, termsHash: command.termsHash, version: 1, state: 'proposed', proposedBy: uid, proposalRequestId: requestId, proposedAt: now,
          expiresAt: command.expiresAt === null ? null : Timestamp.fromMillis(Date.parse(command.expiresAt)), acceptances: {}, consumption: null,
          sourceHash: source.sourceHash, basisHash: source.money.basisHash, cumulativeHash: source.money.cumulativeHash};
      } else {
        const p = previous?.document;
        if (!agreementView(previous, command.transactionId, order, source.sourceHash) || previous!.contentHash !== supportSourceHash(p) ||
            p.version !== command.expectedVersion || p.termsHash !== command.termsHash || p.state !== 'proposed' ||
            order.refundAgreementContext?.agreementId !== id || p.sourceHash !== source.sourceHash || p.expiresAt !== null && p.expiresAt.toMillis() <= Date.now()) return refuse('agreement_or_sources_changed');
        if (p.version >= Number.MAX_SAFE_INTEGER - 1) return refuse('agreement_version_unknown');
        d = {...p, version: p.version + 1};
        if (command.action === 'accept') d.acceptances = {...p.acceptances, [uid === order.buyerId ? 'buyer' : 'seller']:
          {actorId: uid, requestId, termsHash: command.termsHash, recordedAt: now}};
        else d.state = command.action === 'refuse' ? 'refused' : 'withdrawn';
      }
      const notices = await prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({eventKey: `purchase_refund_agreement:${id}:${uid}:${requestId}`,
        userId, type: 'order_moderation', title: 'Accord de remboursement actualisé',
        message: 'Une proposition ou une réponse est enregistrée. Consultez ses termes exacts ; cela ne confirme aucun remboursement, arrivée bancaire ou permission de réexpédition.',
        data: {ownerId: userId, transactionId: command.transactionId, refundAgreementId: id}})));
      const receipt = {...base, state: 'committed', reason: null, agreementId: id, version: d.version, recordedAt: now};
      tx.set(aref, {protocol: d.protocol, document: d, contentHash: supportSourceHash(d)});
      if (command.action === 'propose') tx.update(ref, {refundAgreementContext: {protocol: 'purchase_refund_agreement_context_v1', transactionId: command.transactionId, agreementId: id}});
      tx.create(receiptRef, receipt); notices.commit(); return {...receipt, recordedAt: now.toDate().toISOString(), ...effects};
    });
  }
  if (!PURCHASE_REFUND_ENABLED) throw new HttpsError('failed-precondition', 'Les accords de remboursement sont en préparation.', {reason: 'purchase_refund_not_exposed'});
  supportObject(raw, ['mode', 'capability', 'expectedUid', 'transactionId', 'cursor', 'expectedDisputeId']);
  if (raw.expectedDisputeId !== undefined && raw.mode !== 'purchase_refund_admin_source_observe')
    throw new HttpsError('invalid-argument', 'La sélection de réclamation est réservée au lecteur opérateur.');
  const id = supportId(raw.transactionId), after = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (after !== null && (typeof after !== 'string' || !after || Buffer.byteLength(after, 'utf8') > 1500 || after.includes('/'))) throw new HttpsError('invalid-argument', 'Curseur inconnu.');
  return db.runTransaction(async tx => {
    const admin = raw.mode === 'purchase_refund_admin_source_observe';
    if (admin) await supportAdmin(tx, uid, await supportCurrentAdminSession(request));
    const ref = db.collection('transactions').doc(id), snap = await tx.get(ref), order = snap.data();
    if (!order || !admin && ![order.buyerId, order.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Partie native requise.');
    let convenienceReturnSource: Record<string, unknown> | undefined;
    let ownConvenienceTermsHash: string | undefined;
    if (admin && typeof raw.expectedDisputeId === 'string' && /^cr_[a-f0-9]{64}$/.test(raw.expectedDisputeId)) {
      const {readEffectiveConvenienceReturnFinancing} = await import('./convenienceReturnFinancial');
      const {readConvenienceReturnFinancialReception} = await import('./convenienceReturnReception');
      const financing = await readEffectiveConvenienceReturnFinancing(tx, id, order);
      const reception = financing ? await readConvenienceReturnFinancialReception(tx, id, order) : null;
      const qualified = !!financing && !!reception && reception.reference.proposalId === raw.expectedDisputeId &&
        financing.termsHash === reception.reference.financingTermsHash;
      if (qualified) ownConvenienceTermsHash = financing!.termsHash;
      convenienceReturnSource = {protocol: 'convenience_return_financial_source_v1', qualification: qualified ? 'native_received_return' : 'unknown',
        reference: qualified ? reception!.reference : null, financingTerms: qualified ? financing!.originalTerms : null,
        effectiveFinancingTerms: qualified ? financing!.terms : null, costResolution: qualified ? financing!.costResolution : null,
        newRefundPermissionGranted: false};
    }
    let source: Awaited<ReturnType<typeof agreementSource>> | null = null;
    try {source = await agreementSource(tx, id, order, undefined, ownConvenienceTermsHash);} catch (e) {if (!(e instanceof HttpsError && e.code === 'failed-precondition')) throw e;}
    const current = order.refundAgreementContext?.agreementId, a = /^ag_[a-f0-9]{64}$/.test(current ?? '') ? (await tx.get(agreementRef(id, current))).data() : null;
    const view = agreementView(a, id, order, source?.sourceHash ?? null);
    let verified: RefundAgreementReference | null = null;
    if (view && view.sourceCurrentlyMatches && a?.document.acceptances?.buyer && a.document.acceptances?.seller) {
      const r = {agreementId: view.agreementId, version: view.version, termsHash: view.termsHash, acceptanceHash: supportHash(a.document.acceptances)};
      if (await readRefundAgreementProof(tx, id, order, r, view.terms)) verified = r;
    }
    let reservedRefund: Record<string, unknown> | null = null;
    let returnReviewSource: Record<string, unknown> | null = null;
    if (admin && raw.expectedDisputeId !== undefined) {
      const disputeId = supportId(raw.expectedDisputeId), claim = source?.claims.docs.find(r => r.id === disputeId)?.data();
      let reference: unknown = null;
      if (claim && ['authenticity', 'nonconformity', 'parcel_delivery'].includes(claim.productReview?.topic)) {
        try {
          const {readProductFinancialSource} = await import('./productReviewFinancial');
          reference = (await readProductFinancialSource(tx, id, order, claim.productReview.caseId, disputeId, claim.productReview.topic,
            claim.productReview.materialCapability === 'product_review_material_v1', claim.productReview.parcelCapability === 'product_review_parcel_v1')).reference;
        } catch (e) {if (!(e instanceof HttpsError && e.code === 'failed-precondition')) throw e;}
      }
      returnReviewSource = {protocol: 'purchase_refund_return_review_source_v1', expectedDisputeId: disputeId,
        qualification: reference ? 'native_current_documentary_source' : 'unknown', returnContext: purchaseRefundReturnContext(id, order),
        productReview: reference, newRefundPermissionGranted: false, physicalPossessionVerified: false, faultEstablished: false, costDecisionGranted: false};
    }
    if (admin && order.refund?.allocation) {
      const intent = order.refund, r = (await tx.get(refundAllocationRef(id, intent.intentId))).data();
      let reservedTerms: PurchaseRefundTerms | null = null; try {reservedTerms = parsePurchaseRefundTerms(r?.terms);} catch { /* Explicit unknown source below. */ }
      const authority = intent.purchaseRefundAuthorization ?? intent.commercialDecision;
      let nativeAllocation: RefundAllocationReference | null = null;
      try {nativeAllocation = parseRefundAllocation(authority?.allocation);} catch { /* Historical/unknown authority remains null. */ }
      const authorityReceipt = HASH.test(authority?.decisionId ?? '') ? (await tx.get(ref.collection('dispute_decisions').doc(authority.decisionId))).data() : null;
      if (r?.protocol === 'purchase_refund_allocation_record_v1' && r.transactionId === id && r.refundIntentId === intent.intentId &&
          reservedTerms !== null && nativeAllocation !== null && supportHash(nativeAllocation.terms) === supportHash(reservedTerms) &&
          authorityReceipt?.kind === 'admin_financial_decision_v1' && authorityReceipt.outcome === 'reserved' && authorityReceipt.refundIntentId === intent.intentId &&
          authorityReceipt.actorUid === authority.actorUid && authorityReceipt.payloadHash === authority.payloadHash && supportHash(authorityReceipt.allocation) === supportHash(nativeAllocation) &&
          r.reservationHash === intent.allocation.reservationHash && r.reservationHash === supportSourceHash(r.reservation) &&
          r.terms.cardCents === intent.cardAmountCents && r.terms.walletCents === intent.walletAmountCents && r.terms.sellerDebitCents === intent.sellerDebitCents) {
        let resumeSource: Awaited<ReturnType<typeof agreementSource>> | null = null;
        try {resumeSource = await agreementSource(tx, id, order, intent.intentId, nativeAllocation.convenienceReturn?.financingTermsHash);} catch (e) {if (!(e instanceof HttpsError && e.code === 'failed-precondition')) throw e;}
        const currentAcceptance = resumeSource && nativeAllocation.agreement && await readRefundAgreementProof(tx, id, order, nativeAllocation.agreement, nativeAllocation.terms, intent.intentId)
          ? nativeAllocation.agreement : null;
        reservedRefund = {protocol: 'purchase_refund_reserved_source_v1', refundIntentId: intent.intentId, refundAttemptId: intent.attemptId,
          expectedDisputeId: authority.expectedDisputeId, authorizationDecisionId: authority.decisionId, allocation: nativeAllocation,
          bilateralAcceptance: currentAcceptance, bilateralAgreementVerified: currentAcceptance !== null,
          terms: reservedTerms, basisHash: resumeSource?.money.basisHash ?? null, cumulativeHash: resumeSource?.money.cumulativeHash ?? null,
          sourceQualification: resumeSource ? 'native_allocation_reservation' : 'unknown', state: intent.state,
          fundsAppliedRecorded: native(intent.fundsAppliedAt), newRefundPermissionGranted: false,
          contexts: {returnToSender: authority.returnToSender ?? null, transportReview: authority.transportReview ?? null, productReview: authority.productReview ?? null},
          fixedMoney: {cardCents: intent.cardAmountCents, walletCents: intent.walletAmountCents, sellerDebitCents: intent.sellerDebitCents},
          originalReservationPreserved: true, bankArrivalVerified: false};
      }
    }
    const allocationEntries = [];
    if (source) for (const row of source.money.rows.docs) {
      const record = row.data(), current = order.refund?.intentId === row.id ? order.refund : await readAllocationHistoryIntent(tx, id, order, row.id);
      const applied = await allocationLocalMovementsVerified(tx, id, order, current, record);
      allocationEntries.push({refundIntentId: row.id, termsHash: record.reservation.termsHash, terms: record.terms,
        reservationRecorded: true, localMovementsVerified: applied,
        settlementState: current && ['requested', 'pending', 'requires_action', 'unknown', 'succeeded', 'failed', 'canceled', 'reconciliation_required'].includes(current.state)
          ? current.state === 'requested' ? 'pending' : current.state : 'unknown',
        providerObservationState: current && ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(current.providerStatus) ? current.providerStatus : null,
        bankArrivalVerified: false});
    }
    const common = {protocol: 'purchase_refund_source_v1', actorId: uid, transactionId: id, sourceRevision: supportRevision(snap), sourceHash: source?.sourceHash ?? null,
      qualification: source ? 'native_initial_and_cumulative' : 'unknown', basisHash: source?.money.basisHash ?? null, cumulativeHash: source?.money.cumulativeHash ?? null,
      initial: source?.money.initial ?? null, remaining: source?.money.remaining ?? null, remainingCardCents: source?.money.remainingCardCents ?? null,
      remainingWalletCents: source?.money.remainingWalletCents ?? null, remainingSellerCents: source?.money.remainingSellerCents ?? null,
      returnContext: purchaseRefundReturnContext(id, order), agreement: view, bilateralAcceptance: verified, bilateralAgreementVerified: verified !== null, reservedRefund, returnReviewSource,
      ...(convenienceReturnSource ? {convenienceReturnSource} : {}),
      allocationHistory: {qualification: source ? 'native_bounded_set' : 'unknown', entries: allocationEntries, limit: 100, completeSet: source !== null}, ...effects};
    if (raw.mode !== 'purchase_refund_agreements_observe') return common;
    let query: FirebaseFirestore.Query = ref.collection('refund_agreements').orderBy('__name__').limit(21); if (after) query = query.startAfter(after);
    const page = await tx.get(query), inspected = page.docs.slice(0, 20);
    return {...common, protocol: 'purchase_refund_agreements_page_v1', entries: inspected.map(r => ({id: r.id, view: agreementView(r.data(), id, order, source?.sourceHash ?? null)})),
      nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null, inspected: inspected.length, hasMore: page.size > 20};
  });
}
