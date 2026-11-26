/** Financial composition only: the purchase-policy and seller-reception
 * boundaries are separately exercised by their native producer packets. */
import {Timestamp} from 'firebase-admin/firestore';
import {beforeEach, expect, it, vi} from 'vitest';
import {createFirestoreMock, type MockFirestore} from './testHelpers/firestoreMock';
const h = vi.hoisted(() => ({fs: null as MockFirestore | null, reception: true, creates: [] as any[], refunds: {} as Record<string, any>}));
const fs = createFirestoreMock({enforceReadBeforeWrite: true}); h.fs = fs;
const run = fs.db.runTransaction.bind(fs.db);
fs.db.runTransaction = (callback: any) => run(async tx => {
  (tx as any).getAll = (...refs: any[]) => Promise.all(refs.map(ref => tx.get(ref)));
  return callback(tx);
});
vi.mock('../config/firebase', async () => {
  const {FieldValue, Timestamp: NativeTimestamp} = await import('firebase-admin/firestore');
  return {get db() {return h.fs!.db;}, get FieldValue() {return {...h.fs!.FieldValue, vector: FieldValue.vector.bind(FieldValue), serverTimestamp: () => NativeTimestamp.now()};},
    auth: {getUser: async (uid: string) => ({uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString()})}};
});
vi.mock('../config/stripe', () => ({getStripe: () => ({refunds: {
  list: async () => ({data: Object.values(h.refunds), has_more: false}), retrieve: async (id: string) => h.refunds[id],
  create: async (params: any, options: any) => {h.creates.push({params, options}); const r = {id: 're_nativeG10', status: 'succeeded',
    payment_intent: params.payment_intent, amount: params.amount, currency: 'cad', metadata: params.metadata}; h.refunds[r.id] = r; return r;},
}})}));
vi.mock('./purchasePolicy', async original => ({...await original<any>(),
  acceptedOrderPurchasePolicy: () => ({quoteId: 'quote', sourceHash: 'a'.repeat(64), hash: 'b'.repeat(64)}),
  acceptedQuotePurchasePolicy: () => true, acceptedPurchaseTaxSnapshot: () => null,
  nativePurchasePaymentSource: (order: any) => ({kind: order.paidVia === 'wallet' ? 'wallet_ledger' : 'stripe_payment_intent',
    referenceId: order.paidVia === 'wallet' ? 'purchase' : order.stripePaymentIntentId, amountCents: 5150, walletCents: order.walletAmountUsed ?? 0})}));
vi.mock('./convenienceReturn', () => ({readConvenienceReturnAgreement: async () => ({state: 'accepted'})}));
vi.mock('./convenienceReturnReception', () => ({readConvenienceReturnFinancialReception: async (_tx: any, _id: string, order: any, expected?: any) => {
  if (!h.reception) return null;
  const f = order.convenienceReturnFinancialReservation;
  const reference = {protocol: 'convenience_return_financial_review_v1', proposalId: f.terms.agreement.proposalId,
    agreementContentHash: f.terms.agreement.contentHash, requestId: f.terms.requestId, financingTermsHash: f.termsHash,
    receptionRequestId: 'reception_request_123', receptionHash: 'e'.repeat(64)};
  if (expected && JSON.stringify(expected) !== JSON.stringify(reference)) return null;
  return {reference, target: {protocol: 'convenience_return_reception_v1', actorId: 'seller', recordedAt: Timestamp.fromMillis(100000)}};
}}));
vi.mock('./notifications', () => ({prepareOperationalNotices: async () => ({commit() {}}), readOperationalNoticeReceipts: async () => []}));
vi.mock('./fraudReviewDecision', () => ({fraudReviewAllowsProgress: async () => true}));
vi.mock('./fraudReviewCandidates', () => ({prepareFraudCandidateProjection: async () => null}));
vi.mock('./productReviewFinancial', () => ({productFinancialContextRequired: async () => false}));
vi.mock('./orderModeration', () => ({deliveryCorrectionBlocksProgress: () => false, orderModerationAllowsProgress: async () => true}));
vi.mock('./rateLimit', () => ({checkRateLimit: async () => {}, resolveCallerKey: () => ({callerKey: 'admin', isAuthenticated: true})}));
vi.mock('../lib/analytics', () => ({captureServerEvent: async () => {}}));
vi.mock('firebase-functions/logger', () => ({info() {}, warn() {}, error() {}}));
import {costTermsHash, prepareConvenienceReturnCostReservation, readConvenienceReturnCostQuote} from './convenienceReturnFinancial';
import {parsePurchaseRefundTerms, parseRefundAllocation, readRefundAllocationSource, qualifyRefundAllocation, prepareRefundAllocationReservation,
  type PurchaseRefundTerms, type RefundAllocationReference} from './refundAllocation';
import {supportHash, supportSourceHash} from './supportRequest';
import {prepareAdminDecisionPreview, parseRefundDecisionInput, refundDecisionId} from './refundDecision';
import {issueTransactionRefund} from './refund';
import {handlePurchaseRefundRepair} from './refundRepair';
const order = () => fs.getDoc('transactions/sale')!;
const agreement = {proposalId: 'cr_' + 'c'.repeat(64), contentHash: 'd'.repeat(64), termsProtocol: 'convenience_return_terms_v2' as const};
beforeEach(() => {
  fs.reset(); h.reception = true; h.creates = []; h.refunds = {};
  const paidAt = Timestamp.fromMillis(1000);
  fs.setDoc('transactions/sale', {buyerId: 'buyer', sellerId: 'seller', articleId: 'article', amount: 40, serviceFee: 3.5,
    shippingCost: 8, taxTotal: 0, totalAmount: 51.5, currency: 'CAD', paidVia: 'card', stripePaymentIntentId: 'pi_nativeG10', stripeChargeId: 'ch_nativeG10', capturedCardCents: 5150,
    shipEngineRateId: 'rate', shippingSnapshot: {rate: {rateId: 'rate', shippingCents: 800}}, paidAt, status: 'return_requested', deliveryType: 'shipping',
    sellerCreditedCents: 4000, sellerHeldCreditCents: 4000, sellerPendingCreditCents: 4000, fundsReleaseAt: Timestamp.fromMillis(Date.now() + 3600000),
    nonShipmentPolicyWindow: {schemaVersion: 1, transactionId: 'sale', startsAt: paidAt},
    returnRequest: {schemaVersion: 2, reason: 'change_of_mind', requestId: 'return_request_1234'}, disputed: true});
  fs.setDoc('shipping_quotes/quote', {schemaVersion: 1, ownerId: 'buyer', articleId: 'article', sellerId: 'seller', state: 'claimed', transactionId: 'sale',
    acceptedTotal: 51.5, source: {amount: 40, fee: 3.5, tax: 0, hash: 'a'.repeat(64)}, acceptedQualification: {version: 3}, acceptedRateId: 'rate'});
  fs.setDoc('wallets/seller', {currency: 'cad', heldBalance: 4000, pendingBalance: 0, balance: 0, sellerDebt: 0, status: 'active'});
  fs.setDoc('wallets/seller/ledger/sale', {type: 'sale_credit', amount: 4000, transactionId: 'sale', createdAt: paidAt});
  fs.setDoc('wallets/seller/ledger/held', {type: 'funds_held', amount: 4000, transactionId: 'sale', createdAt: paidAt});
  fs.setDoc('wallets/buyer', {currency: 'cad', balance: 0, status: 'active'});
  fs.setDoc('users/admin', {isAdmin: true, isActive: true});
});
async function finance(costCents = 800) {
  const terms = await fs.db.runTransaction(tx => readConvenienceReturnCostQuote(tx as any, 'sale', order(), {requestId: 'return_request_1234', agreement, costCents}));
  await fs.db.runTransaction(async tx => {
    const reserved = await prepareConvenienceReturnCostReservation(tx as any, 'sale', order(), terms, costTermsHash(terms));
    reserved.commit();
    tx.update(fs.db.collection('transactions').doc('sale'), {'returnRequest.quote': {convenienceReturnFinancialTerms: terms,
      convenienceReturnFinancialTermsHash: costTermsHash(terms), expectedCostCents: costCents},
    'returnRequest.acceptance': {convenienceReturnFinancialTermsHash: costTermsHash(terms)}});
  });
  const source = await fs.db.runTransaction(tx => readRefundAllocationSource(tx as any, 'sale', order(), undefined, costTermsHash(terms)));
  const refundTerms: PurchaseRefundTerms = {protocol: 'purchase_refund_terms_v2', currency: 'CAD', settlementKind: 'partial',
    refund: {articleCents: 4000, buyerFeeCents: 0, shippingCents: 0, gstCents: 0, qstCents: 0},
    retained: {articleCents: 0, buyerFeeCents: 350, shippingCents: 800, gstCents: 0, qstCents: 0},
    cardCents: terms.netRefundCents, walletCents: 0, sellerDebitCents: 4000, platformArticleCostCents: 0,
    articleHandling: 'return_separately', caseHandling: 'settle_selected_case', paymentDeadline: {qualification: 'unknown', date: null},
    provenance: {kind: 'in_app', statement: null, evidenceReferences: []},
    returnLabelDeduction: {protocol: 'buyer_return_label_deduction_v1', financingTermsHash: costTermsHash(terms), requestId: terms.requestId, amountCents: costCents}};
  const allocation: RefundAllocationReference = {protocol: 'purchase_refund_allocation_v2', terms: refundTerms, basisHash: source.basisHash,
    cumulativeHash: source.cumulativeHash, agreement: null, convenienceReturn: {protocol: 'convenience_return_financial_review_v1', proposalId: agreement.proposalId,
      agreementContentHash: agreement.contentHash, requestId: terms.requestId, financingTermsHash: costTermsHash(terms),
      receptionRequestId: 'reception_request_123', receptionHash: 'e'.repeat(64)}};
  return {terms, source, allocation};
}
it('keeps V1 equations/hashes intact and explicitly expresses gross 40, cost 8, net 32 in V2', async () => {
  const {allocation} = await finance();
  expect(parseRefundAllocation(allocation)).toEqual(allocation);
  expect(() => parsePurchaseRefundTerms({...allocation.terms, protocol: 'purchase_refund_terms_v1'})).toThrow();
  expect(() => parseRefundAllocation({...allocation, protocol: 'purchase_refund_allocation_v1'})).toThrow();
  const {returnLabelDeduction: _deduction, ...v1} = allocation.terms as any;
  const legacy = {...v1, protocol: 'purchase_refund_terms_v1', cardCents: 4000};
  expect(parsePurchaseRefundTerms(legacy)).toEqual(legacy);
  expect(supportHash(parsePurchaseRefundTerms(legacy))).toBe(supportHash(legacy));
});
it.each([4000, 4100])('cost %i does not authorize a label, debt, buyer charge or null refund', async cost => {
  await expect(finance(cost)).rejects.toMatchObject({code: 'failed-precondition'});
  expect(fs.writeOps).toHaveLength(0);
});
it('requires both actual wallet cover AND a native held movement before the label purchase reserve', async () => {
  fs.setDoc('wallets/seller/ledger/held', null);
  await expect(finance()).rejects.toMatchObject({code: 'failed-precondition'});
  fs.setDoc('wallets/seller/ledger/held', {type: 'funds_held', amount: 4000, transactionId: 'sale', createdAt: Timestamp.fromMillis(1000)});
  fs.setDoc('wallets/seller', {currency: 'cad', heldBalance: 3999});
  await expect(finance()).rejects.toMatchObject({code: 'failed-precondition'});
  expect(fs.writeOps).toHaveLength(0);
});
it('reserves gross budget against unrelated H allocations and retains it when the label outcome is unknown', async () => {
  const {allocation} = await finance();
  await expect(fs.db.runTransaction(tx => readRefundAllocationSource(tx as any, 'sale', order()))).rejects.toMatchObject({code: 'failed-precondition'});
  const {returnLabelDeduction: _deduction, ...fields} = allocation.terms as any;
  const unrelated = {...allocation, protocol: 'purchase_refund_allocation_v1', terms: {...fields, protocol: 'purchase_refund_terms_v1', cardCents: 4000}};
  delete unrelated.convenienceReturn;
  await expect(fs.db.runTransaction(tx => qualifyRefundAllocation(tx as any, 'sale', order(), unrelated))).rejects.toMatchObject({code: 'failed-precondition'});
  h.reception = false;
  await expect(fs.db.runTransaction(tx => qualifyRefundAllocation(tx as any, 'sale', order(), allocation))).rejects.toMatchObject({code: 'failed-precondition'});
  expect(order().convenienceReturnFinancialReservation.consumedByRefundIntentId).toBeNull();
});
it.each([{pay: 'card', cost: 800, card: 3200, wallet: 0}, {pay: 'card', cost: 0, card: 4000, wallet: 0},
  {pay: 'wallet', cost: 800, card: 0, wallet: 3200}, {pay: 'mixed', cost: 800, card: 200, wallet: 3000}])(
  '$pay cost $cost: consumes/debits gross 40 once, refunds only its net on original rails', async ({pay, cost, card, wallet}) => {
  const originalWallet = pay === 'wallet' ? 5150 : pay === 'mixed' ? 3000 : 0;
  if (originalWallet) {
    const original = order(); fs.setDoc('transactions/sale', {...original, paidVia: pay, walletAmountUsed: originalWallet,
      stripePaymentIntentId: pay === 'wallet' ? null : original.stripePaymentIntentId, capturedCardCents: 5150 - originalWallet});
    fs.setDoc('wallets/buyer/ledger/purchase', {type: 'purchase_debit', transactionId: 'sale', amount: originalWallet, createdAt: Timestamp.fromMillis(1000)});
  }
  const {allocation} = await finance(cost);
  allocation.terms.cardCents = card; allocation.terms.walletCents = wallet;
  const raw = {expectedAdminUid: 'admin', transactionId: 'sale', expectedDisputeId: agreement.proposalId,
    capability: 'purchase_refund_v1', decisionContext: 'purchase_refund_allocation', decisionType: 'refund_without_return', allocation};
  const preview: any = await prepareAdminDecisionPreview('admin', raw);
  const input = parseRefundDecisionInput('admin', {...raw, requestId: 'refund_request_native_123', note: 'Retour reçu déclaré, prix de l’article moins coût retour accepté.',
    previewId: preview.previewId, expectedSourceHash: preview.sourceHash, expectedTotalCents: card + wallet, expectedCardCents: card, expectedWalletCents: wallet, expectedSellerDebitCents: 4000});
  const opts = {idempotencyKey: `rf_decision_${refundDecisionId(input)}`, commercialDecision: input,
    initiatedByUid: 'admin', operatorAuthTime: Math.floor(Date.now() / 1000)};
  const first = await issueTransactionRefund('sale', {}, opts);
  expect(first.success).toBe(true);
  expect(h.creates).toHaveLength(card ? 1 : 0);
  if (card) {expect(h.creates[0].params.amount).toBe(card); expect(h.creates[0].params.payment_intent).toBe('pi_nativeG10');}
  expect(fs.getDoc('wallets/buyer')!.balance).toBe(wallet);
  expect(fs.getDoc('wallets/seller')!.heldBalance).toBe(0);
  expect(fs.getDoc('wallets/seller')!.sellerDebt).toBe(0);
  expect(order().convenienceReturnFinancialSettlement).toMatchObject({grossArticleCents: 4000, returnLabelCostCents: cost, netRefundCents: card + wallet, sellerDebitCents: 4000});
  expect(order().disputed).toBe(false);
  const second = await issueTransactionRefund('sale', {}, opts);
  expect(second.success).toBe(true); expect(h.creates).toHaveLength(card ? 1 : 0);
  const money = await fs.db.runTransaction(tx => readRefundAllocationSource(tx as any, 'sale', order()));
  expect(money.remaining.articleCents).toBe(0); expect(money.remainingCardCents).toBe(5150 - originalWallet - card);
  expect(money.remainingWalletCents).toBe(originalWallet - wallet);
  expect(money.used.articleCents).toBe(4000); expect(money.remainingSellerCents).toBe(0);
  if (card) {
    const repair: any = await handlePurchaseRefundRepair({auth: { token: { auth_time: Math.floor(Date.now() / 1000) },uid: 'buyer'}, data: {expectedUid: 'buyer',
      mode: 'purchase_refund_repair_source_observe', capability: 'purchase_refund_repair_v1', scope: 'own', transactionId: 'sale', refundIntentId: order().refund.intentId}});
    expect(repair.selected).toMatchObject({qualification: 'native_reserved_obligation', obligationCardCents: card,
      localMovementsVerified: true, localSellerDebitCents: 4000, localWalletCreditCents: wallet,
      allocation: {terms: {protocol: 'purchase_refund_terms_v2', returnLabelDeduction: {amountCents: cost}}}});
  }
  expect(fs.countWrites(op => op.path.includes('/ledger/refund_debit_'))).toBe(1);
  expect(fs.sumIncrements('wallets/seller', 'heldBalance')).toBe(-4000);
  expect(order().refund.allocation.reservationHash).toBe(supportSourceHash(fs.getDoc(`transactions/sale/refund_allocations/${order().refund.intentId}`)!.reservation));
});
it('caps mixed rails independently and never spends a paid wallet portion as new card capacity', async () => {
  const original = order(); fs.setDoc('transactions/sale', {...original, paidVia: 'mixed', walletAmountUsed: 3000, capturedCardCents: 2150});
  fs.setDoc('wallets/buyer/ledger/purchase', {type: 'purchase_debit', transactionId: 'sale', amount: 3000, createdAt: Timestamp.fromMillis(1000)});
  const {allocation} = await finance();
  await expect(fs.db.runTransaction(tx => qualifyRefundAllocation(tx as any, 'sale', order(), allocation))).rejects.toMatchObject({code: 'failed-precondition'});
  allocation.terms.cardCents = 200; allocation.terms.walletCents = 3000;
  const allowed = await fs.db.runTransaction(tx => prepareRefundAllocationReservation(tx as any, 'sale', order(), allocation, 'refund_native', 'f'.repeat(64), 'admin'));
  expect(allowed.record.terms).toMatchObject({cardCents: 200, walletCents: 3000, sellerDebitCents: 4000});
});
