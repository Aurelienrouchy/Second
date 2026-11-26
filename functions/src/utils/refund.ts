import { financialRecoverySourceFields } from "./financialRecoverySources";
import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
import { financialRecoveryWalletFields } from "./financialRecoverySources";
/** Durable purchase refund intent; provider settlement and local money are separate. */
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { articleReleaseUpdate, commitArticleRelease } from './articleReservation';
import { assertNoActiveBankDispute, bankDisputeSaleFunds, hasActiveBankDispute, positiveCents,
  bankRefundOverlapRequiresReview, nativeBankLossLedgerRecorded } from './bankDispute';
import { hasUnsettledRefund, refundResult, qualifiedRefundNoticeSource, refundHasPreSendInventoryProof, qualifiedRejectedLabelPurchase, hasUnresolvedLabelOrParcelSource,
  type IssueRefundResult, type RefundStatus } from './refundState';
import { prepareOperationalNotices, readOperationalNoticeReceipts } from './notifications';
import { captureServerEvent } from '../lib/analytics';
import { exactMixedDebit, nativeTime, nonnegativeCents, stripeIntentEvidence } from './stripeCheckoutProof';
import { reserveAdminRefundDecision, readAdminRefundDecision, commercialClaimHash, returnToSenderNewEffectAllowed,
  returnToSenderOperatorSessionCurrent, transportReviewNewEffectAllowed, productReviewNewEffectAllowed, type RefundDecisionInput } from './refundDecision';
import { assertNonShipmentExpiry, readLabelAbandonmentPolicySource } from './purchasePolicy';
import { deliveryCorrectionBlocksProgress, orderModerationAllowsProgress } from './orderModeration';
import { Timestamp } from 'firebase-admin/firestore';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import { prepareFraudCandidateProjection } from './fraudReviewCandidates';
import {readProductFinancialSource, productFinancialReferenceCurrent, productFinancialContextRequired, productFinancialReviewError} from './productReviewFinancial';
import {hasPurchaseRefundContext, readSettledAllocationIntent, readAllocationHistoryIntent, refundHistoryRef, refundAllocationRef,
  purchaseRefundNewEffectAllowed, readSellerAllocationConsumption, purchaseRefundCaseDisposition} from './refundAllocation';
import {supportSourceHash as supportAllocationHash} from './supportRequest';
import {prepareOriginalRefundRepairObservation, observePurchaseRefundRepairs, observePurchaseRefundRepairIdentity} from './refundRepair';
import {preparePurchasePlatformAccounting} from './refundAccounting';
import {prepareSellerTaxFinancialEvent,sellerTaxFinancialOrderAfter} from './sellerTaxLedger';
export type { IssueRefundResult } from './refundState';

/** Read-only qualification for cancelling an UNPAID order. A wallet marker
 * is not a debit receipt. Both callers apply the returned proof in their own
 * transaction, after their remaining reads, using one deterministic credit. */
export async function readPendingCancellationFunds(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: FirebaseFirestore.DocumentData, cancelledPaymentIntent: unknown, requireCancelledCard = true) {
  const reject = (reason: string) => ({ qualified: false as const, reason });
  const buyerId = order.buyerId;
  if (typeof buyerId !== 'string' || !buyerId || buyerId.includes('/')) return reject('buyer_identity_unqualified');
  if (typeof order.sellerId !== 'string' || !order.sellerId || order.sellerId.includes('/') ||
      order.sellerId === buyerId) return reject('seller_identity_unqualified');
  const walletRef = db.collection('wallets').doc(buyerId);
  const intentRef = db.collection('stripe_checkout_intents').doc(transactionId);
  const intent = (await tx.get(intentRef)).data();
  const rowsSnap = await tx.get(walletRef.collection('ledger').where('transactionId', '==', transactionId).limit(101));
  const creditRef = walletRef.collection('ledger').doc(`pending_cancel_${transactionId}`);
  const priorCredit = await tx.get(creditRef);
  const rows = rowsSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  if (rowsSnap.size >= 101 || priorCredit.exists) return reject('wallet_cancellation_evidence_conflict');
  const terminalCardProof = intent?.protocol === 'server_manual_v1' && typeof order.totalAmount === 'number' &&
    nonnegativeCents(intent.walletCents) && nonnegativeCents(intent.cardCents) &&
    stripeIntentEvidence(cancelledPaymentIntent, {id: order.stripePaymentIntentId, orderId: transactionId,
      buyerId, sellerId: order.sellerId, cardCents: intent.cardCents, walletCents: intent.walletCents,
      intentId: intent.intentId})?.state === 'canceled';
  if ((!terminalCardProof && (['unknown', 'creating'].includes(order.walletCheckoutOutcome) || order.paymentProcessing === true)) ||
      order.paidAt != null || order.stripeChargeId != null ||
      (order.capturedCardCents != null && order.capturedCardCents !== 0)) return reject('payment_outcome_unqualified');
  const walletAmount = order.walletAmountUsed === undefined ? 0 : order.walletAmountUsed;
  if (!nonnegativeCents(walletAmount)) return reject('wallet_amount_unqualified');
  const orderTotal = typeof order.totalAmount === 'number' ? Math.round(order.totalAmount * 100) : NaN;
  if (walletAmount > 0 && (!nonnegativeCents(orderTotal) || orderTotal === 0 ||
      Math.abs(order.totalAmount * 100 - orderTotal) > 0.0000001 ||
      (order.currency != null && (typeof order.currency !== 'string' || order.currency.toUpperCase() !== 'CAD')) ||
      (order.paidVia === 'wallet' ? walletAmount !== orderTotal : walletAmount >= orderTotal))) return reject('wallet_total_unqualified');
  let intendedWalletAmount = walletAmount;
  if (intent) {
    if (intent.schemaVersion !== 1 || intent.ownerId !== buyerId || intent.transactionId !== transactionId ||
        !['server_manual_v1', 'legacy_retirement_v1'].includes(intent.protocol) ||
        (!['prepared', 'requires_payment_method', 'requires_confirmation', 'requires_action', 'canceled', 'retired'].includes(intent.state) &&
          !(terminalCardProof && ['requires_capture', 'processing', 'confirming', 'unknown'].includes(intent.state))) ||
        !nonnegativeCents(intent.walletCents) || !nonnegativeCents(intent.cardCents)) return reject('checkout_intent_unqualified');
    intendedWalletAmount = intent.walletCents;
    if (intent.protocol === 'server_manual_v1' && (typeof intent.intentId !== 'string' || !intent.intentId ||
        !Number.isSafeInteger(intent.version) || intent.version < 1 || intent.version >= Number.MAX_SAFE_INTEGER || !nativeTime(intent.createdAt) ||
        intent.sellerId !== order.sellerId || intent.totalCents !== orderTotal || intent.currency !== 'CAD' ||
        intent.quoteId !== order.shippingQuoteId || intent.rateId !== order.shipEngineRateId ||
        typeof intent.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(intent.sourceHash) ||
        !Number.isSafeInteger(intent.sourceRevision) || intent.sourceRevision < 0)) return reject('checkout_intent_unqualified');
    if (intent.protocol === 'legacy_retirement_v1' && (intent.currency !== 'CAD' ||
        intent.cardCapabilityNeutralized !== true || intent.providerStatus !== 'canceled' ||
        intent.receivedCents !== 0 || intent.capturableCents !== 0 ||
        !nativeTime(intent.authorizedAt) || !nativeTime(intent.completedAt))) return reject('checkout_intent_unqualified');
    if (intent.walletCommittedAt != null) {
      if (!nativeTime(intent.walletCommittedAt) || intendedWalletAmount !== walletAmount ||
          typeof intent.walletLedgerId !== 'string' || !intent.walletLedgerId) return reject('wallet_debit_intent_unqualified');
    } else if (intent.protocol === 'server_manual_v1' && walletAmount > 0) return reject('wallet_debit_intent_missing');
  }
  if (walletAmount > 0) {
    const single = rows.length === 1 ? rows[0] : null;
    const debit = single?.data;
    const exactDebit = order.paidVia === 'wallet'
      ? !intent && order.stripePaymentIntentId == null && !!single && debit?.type === 'purchase_debit' && debit.amount === walletAmount &&
        nonnegativeCents(debit.balanceAfter) && nativeTime(debit.createdAt) &&
        (debit.currency == null || (typeof debit.currency === 'string' && debit.currency.toUpperCase() === 'CAD'))
      : exactMixedDebit(order, rows, walletAmount, intent?.walletLedgerId);
    if (!exactDebit || debit?.transactionId !== transactionId) return reject('wallet_debit_unqualified');
  } else if (rows.length || order.paidVia != null || order.walletPayment != null ||
      order.walletDebitedAt != null || order.walletDebitReservedAt != null) return reject('wallet_trace_without_matched_debit');
  const paymentIntentId = order.stripePaymentIntentId;
  if (paymentIntentId != null) {
    const total = typeof order.totalAmount === 'number' ? Math.round(order.totalAmount * 100) : NaN;
    if (typeof paymentIntentId !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ||
        !nonnegativeCents(total) || total <= intendedWalletAmount ||
        Math.abs(order.totalAmount * 100 - total) > 0.0000001 || typeof order.sellerId !== 'string' ||
        (order.currency != null && order.currency !== 'CAD') ||
        (intent && (intent.paymentIntentId !== paymentIntentId || intent.cardCents !== total - intendedWalletAmount))) {
      return reject('card_binding_unqualified');
    }
    const evidence = stripeIntentEvidence(cancelledPaymentIntent, { id: paymentIntentId, orderId: transactionId,
      buyerId, sellerId: order.sellerId, cardCents: total - intendedWalletAmount, walletCents: intendedWalletAmount,
      ...(intent?.protocol === 'server_manual_v1' ? { intentId: intent.intentId } : {}) });
    if (!evidence || (requireCancelledCard ? evidence.state !== 'canceled'
      : !['unconfirmed', 'action', 'confirmation', 'canceled'].includes(evidence.state))) return reject('card_cancellation_unconfirmed');
  } else if (intent || ['wallet_and_card', 'mixed'].includes(order.paidVia) || order.walletCheckoutAttemptId != null ||
      order.walletCheckoutOutcome != null || order.checkoutLock != null || order.stripeCheckoutProtocol != null ||
      order.stripeCheckoutCreatedAt != null || order.stripeClientSecret != null) return reject('card_operation_unsettled');
  const wallet = walletAmount > 0 ? (await tx.get(walletRef)).data() : null;
  if (walletAmount > 0 && (!wallet || !nonnegativeCents(wallet.balance) ||
      !Number.isSafeInteger(wallet.balance + walletAmount) || typeof wallet.currency !== 'string' ||
      wallet.currency.toUpperCase() !== 'CAD' || !['active', 'inactive'].includes(wallet.status) ||
      (wallet.userId != null && wallet.userId !== buyerId))) return reject('wallet_destination_unqualified');
  return { qualified: true as const, walletAmount, walletRef, wallet, creditRef, intentRef, intent,
    debitLedgerId: walletAmount > 0 ? rows[0].id : null, cardCapabilityNeutralized: requireCancelledCard };
}

/** An exact cancellation receipt, including the deterministic local credit,
 * allows an interrupted caller to recover without any second money movement. */
export async function readPendingCancellationReceipt(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: FirebaseFirestore.DocumentData) {
  const proof = order.pendingCancellation;
  if (order.status !== 'cancelled' || !proof || proof.schemaVersion !== 1 || proof.state !== 'committed' ||
      proof.transactionId !== transactionId || proof.buyerId !== order.buyerId || proof.sellerId !== order.sellerId ||
      proof.cardCapabilityNeutralized !== true || !nativeTime(proof.committedAt) || !nonnegativeCents(proof.walletRefundCents)) return false;
  if (proof.walletRefundCents === 0) return proof.walletRefundLedgerId === null && proof.purchaseDebitLedgerId === null;
  if (typeof order.buyerId !== 'string' || order.buyerId.includes('/') ||
      proof.walletRefundLedgerId !== `pending_cancel_${transactionId}` || typeof proof.purchaseDebitLedgerId !== 'string' ||
      !proof.purchaseDebitLedgerId || proof.purchaseDebitLedgerId.includes('/')) return false;
  const ledger = db.collection('wallets').doc(order.buyerId).collection('ledger');
  const [creditSnap, debitSnap] = await tx.getAll(ledger.doc(proof.walletRefundLedgerId), ledger.doc(proof.purchaseDebitLedgerId));
  const credit = creditSnap.data(), debit = debitSnap.data();
  return credit?.type === 'refund_credit' && debit?.type === 'purchase_debit' && credit.transactionId === transactionId &&
    debit.transactionId === transactionId && credit.amount === proof.walletRefundCents && debit.amount === proof.walletRefundCents &&
    credit.purchaseDebitLedgerId === proof.purchaseDebitLedgerId && nativeTime(credit.createdAt) && nativeTime(debit.createdAt) &&
    nonnegativeCents(credit.balanceAfter) && nonnegativeCents(debit.balanceAfter);
}

/** A terminal, attributed zero-capture PI permits restitution of its exact
 * reserved wallet debit. It never treats an unconfirmed PI as proof that an
 * earlier request did not run, and never acts on paid/fulfilled/refund orders. */
export async function reconcileCanceledPurchase(transactionId: string, paymentIntent: any,
  admit?: (tx: FirebaseFirestore.Transaction) => Promise<void>) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(transactionId) || typeof paymentIntent?.id !== 'string' ||
      !/^pi_[A-Za-z0-9]+$/.test(paymentIntent.id)) return {committed: false as const, reason: 'cancellation_identity_unqualified'};
  const orderRef = db.collection('transactions').doc(transactionId);
  const operationRef = db.collection('failed_operations').doc('checkout_' + createHash('sha256')
    .update(JSON.stringify([transactionId, paymentIntent.id])).digest('hex'));
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    if (admit) await admit(tx);
    const [orderSnap, operationSnap] = await tx.getAll(orderRef, operationRef);
    const order = orderSnap.data();
    if (!order) return {committed: false as const, reason: 'transaction_not_found'};
    if (order.stripePaymentIntentId !== paymentIntent.id || hasActiveBankDispute(order) || order.refund != null ||
        order.bankDispute != null || order.refundedAt != null || order.stripeRefundId != null || order.disputed === true ||
        order.labelId != null || order.shipEngineLabelId != null || order.trackingNumber != null || order.labelCreatedAt != null ||
        order.sellerCreditedCents != null || order.fundsReleasedAt != null) return {committed: false as const, reason: 'cancellation_obligation_conflict'};
    const receipt = order.pendingCancellation;
    if (order.status === 'cancelled') {
      const intent = (await tx.get(db.collection('stripe_checkout_intents').doc(transactionId))).data();
      const total = typeof order.totalAmount === 'number' ? Math.round(order.totalAmount * 100) : NaN;
      const evidence = intent?.protocol === 'server_manual_v1' ? stripeIntentEvidence(paymentIntent, {id: order.stripePaymentIntentId,
        orderId: transactionId, buyerId: order.buyerId, sellerId: order.sellerId, cardCents: total - intent.walletCents,
        walletCents: intent.walletCents, intentId: intent.intentId}) : null;
      if (!evidence || evidence.state !== 'canceled' || !await readPendingCancellationReceipt(tx, transactionId, order))
        return {committed: false as const, reason: 'cancellation_receipt_unqualified'};
      if (operationSnap.exists && operationSnap.data()?.type === 'payment_checkout_reconciliation') { await recoveryCommit({refs: [(operationRef).path]}); tx.update(operationRef,
        {status: 'resolved', actionRequired: false, resolvedAt: FieldValue.serverTimestamp(), resolution: 'canceled_purchase_committed'}); }
      return {committed: true as const, replay: true, refundedCents: receipt.walletRefundCents};
    }
    if (order.status !== 'pending_payment' || order.deliveryType !== 'shipping') return {committed: false as const, reason: 'cancellation_order_not_pending'};
    // Only the old pending-cancellation diagnostic may be lifted by this proof.
    // An unrelated refund freeze remains a separate unresolved obligation.
    const ownsDiagnostic = receipt?.schemaVersion === 1 && receipt.state === 'reconciliation_required' &&
      receipt.transactionId === transactionId && receipt.buyerId === order.buyerId && receipt.sellerId === order.sellerId &&
      ['expiry_pending_1h', 'participant_cancel_pending'].includes(receipt.source) && nativeTime(receipt.recordedAt) &&
      ['checkout_intent_unqualified', 'payment_outcome_unqualified', 'card_cancellation_unconfirmed'].includes(receipt.reason);
    if (hasUnsettledRefund(order) && !ownsDiagnostic) return {committed: false as const, reason: 'cancellation_refund_freeze_unqualified'};
    const funds = await readPendingCancellationFunds(tx, transactionId, order, paymentIntent);
    if (!funds.qualified) return {committed: false as const, reason: funds.reason};
    const cancellationIntent = funds.intent;
    if (cancellationIntent?.protocol !== 'server_manual_v1') return {committed: false as const, reason: 'cancellation_legacy_requires_review'};
    const articleRef = typeof order.articleId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(order.articleId)
      ? db.collection('articles').doc(order.articleId) : null;
    const article = articleRef ? (await tx.get(articleRef)).data() : null;
    const unlock = articleRef && article ? await articleReleaseUpdate(tx, articleRef, article, transactionId) : null;
    const walletAmount = funds.walletAmount;
    const cancellationNotices = await prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({
      eventKey: `purchase_canceled:${transactionId}:${cancellationIntent.intentId}`, userId, type: 'order_cancelled',
      title: 'Annulation de la commande enregistrée',
      message: 'Une annulation est enregistrée pour cette commande. Consultez la commande et le porte-monnaie pour leurs éventuels mouvements ; le support reste accessible.',
      data: { transactionId, cancellationSource: 'stripe_canceled_reconciliation' },
    })));
    // Same deterministic credit and receipt as participant cancellation/expiry.
    if (walletAmount > 0 && funds.wallet) {
      await recoveryCommit({refs: [(funds.walletRef).path]});
    tx.update(funds.walletRef, await financialRecoveryWalletFields(funds.walletRef,funds.wallet,{balance: FieldValue.increment(walletAmount), updatedAt: FieldValue.serverTimestamp()},{balance: ((funds.wallet)["balance"]??0) + (walletAmount)}));
      await recoveryCommit({refs: [(funds.creditRef).path]});
    tx.create(funds.creditRef, {type: 'refund_credit', amount: walletAmount, balanceAfter: funds.wallet.balance + walletAmount,
        description: 'Remboursement — paiement non finalisé (porte-monnaie)', transactionId, currency: 'CAD',
        purchaseDebitLedgerId: funds.debitLedgerId, createdAt: FieldValue.serverTimestamp()});
    }
    await recoveryCommit({refs: [(orderRef).path]});
    tx.update(orderRef, await financialRecoverySourceFields('purchase',orderRef,order,{status: 'cancelled', cancelledAt: FieldValue.serverTimestamp(), cancelReason: 'stripe_payment_intent_canceled',
      pendingCancellation: {schemaVersion: 1, state: 'committed', transactionId, buyerId: order.buyerId, sellerId: order.sellerId,
        source: 'stripe_canceled_reconciliation', requestedBy: null, walletRefundCents: walletAmount,
        purchaseDebitLedgerId: funds.debitLedgerId, walletRefundLedgerId: walletAmount > 0 ? funds.creditRef.id : null,
        cardCapabilityNeutralized: true, committedAt: FieldValue.serverTimestamp()},
      ...(ownsDiagnostic ? {refundBlocked: FieldValue.delete(), refundLegacyReconciliationRequired: FieldValue.delete()} : {}),
      ...(walletAmount > 0 ? {walletAmountUsed: FieldValue.delete(), paidVia: FieldValue.delete()} : {}),
      walletCheckoutOutcome: FieldValue.delete(), paymentProcessing: FieldValue.delete()}));
    await recoveryCommit({refs: [(funds.intentRef).path]});
    tx.update(funds.intentRef, await financialRecoverySourceFields('card_intent',funds.intentRef,cancellationIntent, {state: 'canceled', providerStatus: 'canceled', version: cancellationIntent.version + 1,
      cardCapabilityNeutralized: true, receivedCents: 0, capturableCents: 0,
      walletRestitutionLedgerId: walletAmount > 0 ? funds.creditRef.id : null,
      cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()}));
    if (articleRef && unlock) commitArticleRelease(tx, articleRef, unlock);
    if (operationSnap.exists && operationSnap.data()?.type === 'payment_checkout_reconciliation') { await recoveryCommit({refs: [(operationRef).path]}); tx.update(operationRef,
      {status: 'resolved', actionRequired: false, resolvedAt: FieldValue.serverTimestamp(), resolution: 'canceled_purchase_committed'}); }
    cancellationNotices.commit();
    return {committed: true as const, replay: false, refundedCents: walletAmount};
  });
}

export interface IssueRefundOptions {
  /** Free-text reason persisted on the transaction (truncated to 300 chars). */
  reason?: string;
  /**
   * Deterministic Stripe idempotency key. MUST be stable per logical refund so
   * retries never double-refund (e.g. `rf_admin_<txId>`, `rf_buyer_<txId>`).
   */
  idempotencyKey: string;
  /**
   * Whether to put the article back on sale. Admin disputes re-list by default
   * (article still exists); a lost/failed-parcel auto-refund must NOT re-list
   * (the item is gone). Defaults to false; an instruction is not possession.
   */
  relistArticle?: boolean;
  /**
   * Extra cents to debit from the seller ON TOP of `sellerCreditedCents`
   * (e.g. a return label cost ruled against the seller). Defaults to 0.
   * The buyer credit is NOT affected by this — it only changes the seller debit.
   */
  extraSellerDebitCents?: number;
  /**
   * Override the buyer card/wallet refund and instead refund a specific amount
   * (in cents) of the wallet portion — reserved for the return-leg refund where
   * the buyer bears the return label cost. When omitted, the full paid amount
   * is refunded (card via Stripe, wallet portion re-credited). NOT used by B1.
   */
  buyerWalletRefundOverrideCents?: number;
  /**
   * Partial Stripe (card-portion) refund amount in CENTS. When provided (>= 0),
   * the Stripe refund is created with this exact `amount` instead of refunding
   * the full card portion — reserved for the return-leg refund (B2) where the
   * buyer bears the return label cost and is refunded `total - returnLabelCost`.
   * Capped server-side to never exceed the card portion actually charged. When
   * omitted, the full card portion is refunded (prior admin behaviour). A value
   * of 0 means "no card refund" (e.g. the label cost exceeds the card portion,
   * so the whole buyer refund comes out of the wallet portion).
   */
  cardRefundAmountCents?: number;
  /** Short tag for structured logs. */
  source?: string;
  /** Internal authenticated PI.succeeded proof; never forwarded from request.data. */
  paymentProof?: { id: string; currency: string; capturedCents: number; transactionId: string };
  /** Only webhook adoption may reserve without issuing a new provider request. */
  externalRefundId?: string;
  /** Internal eligibility rechecked when reserving the first intention. */
  requiredBuyerId?: string;
  requiredSellerId?: string;
  allowedInitialStatuses?: readonly string[];
  /** Set by authenticated callables, never copied from request.data. */
  initiatedByUid?: string;
  /** Only constructed by the authenticated operator callable, never spread from request.data. */
  commercialDecision?: RefundDecisionInput;
  operatorAuthTime?: number;
  /** Ephemeral interactive guard; never persisted or required by servicing jobs. */
  operatorSession?: (tx?: FirebaseFirestore.Transaction, newEffect?: boolean) => Promise<unknown>;
  /** A historical servicing request may resume only its exact saved intent. */
  expectedRefundIntentId?: string;
  /** Internal scheduled eligibility only; never forwarded from callable data. */
  nonShipmentExpiry?: { sourceHash: string; expiresAtMs: number };
  /** Native failed label tuple built by the sweep, never callable request data. */
  labelGiveup?: { attemptId: string; rejectionSourceHash: string; labelSourceHash: string; expectedLabelAttempts: number; requiredFailures: number; policySourceHash: string };

}


const LEASE_MS = 3 * 60 * 1000;
const SAFE_RETRY_MS = 23 * 60 * 60 * 1000;
const PROVIDER_STATUSES = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);
const MAX_REFUND_PAGES = 10;

function cents(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpsError('invalid-argument', `${name} doit être un montant entier positif ou nul en cents.`);
  return value;
}
function idOf(value: any): string | null { return typeof value === 'string' && value ? value : typeof value?.id === 'string' && value.id ? value.id : null; }
function bankLost(data: FirebaseFirestore.DocumentData): boolean { return data.bankDispute?.outcome === 'lost' || data.refundedVia === 'chargeback'; }
function canWaitForBank(data: FirebaseFirestore.DocumentData): boolean {
  const bank = data.bankDispute;
  return bank?.state === 'open' && typeof bank.id === 'string' && bank.id.length > 0 && !bank.reconciliationRequired && !bank.conflictingDisputeId &&
    !bankLost(data) && (!data.disputeId || data.disputeId === bank.id);
}

const automaticRefundType = (source: unknown) => source === 'sweepPendingLabels_giveup' ? 'label_refund'
  : source === 'expireOrphanedTransactions_paidNotShipped' ? 'transaction_expired' : null;
/** Each phase is immutable and belongs to this saved intent, not to a sweep
 * execution or today's policy. Reads precede all money/journal writes. */
async function prepareAutomaticRefundJournal(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: FirebaseFirestore.DocumentData, intent: FirebaseFirestore.DocumentData, phase: 'reservation' | 'local_settlement') {
  const decisionType = automaticRefundType(intent.source);
  if (!decisionType) return null;
  const id = 'purchase_auto_refund_' + createHash('sha256').update(JSON.stringify([transactionId, intent.intentId, phase])).digest('hex');
  const ref = db.collection('automatic_decisions_log').doc(id), prior = (await tx.get(ref)).data();
  const knownCents = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const frozen = intent.automaticDecisionSource;
  let criteria: Record<string, unknown> = {qualification: 'historical_criteria_unknown', source: intent.source,
    originalStatus: typeof intent.originalStatus === 'string' ? intent.originalStatus : null,
    nativeRequestRecordedAtMs: Number.isSafeInteger(intent.requestedAtMs) && intent.requestedAtMs > 0 ? intent.requestedAtMs : null,
    deadline: null, rejectionThreshold: null};
  try {
    if (frozen?.protocol === 'purchase_automatic_refund_source_v1' && frozen.document?.transactionId === transactionId &&
        frozen.document.refundIntentId === intent.intentId && frozen.document.source === intent.source &&
        frozen.sourceHash === supportAllocationHash(frozen.document)) criteria = frozen.document;
  } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; /* Legacy criteria are unknown; an authorized provider obligation remains serviceable. */ }
  const document = {protocol: 'purchase_automatic_refund_v1', sourceKind: 'purchase', transactionId, decisionType,
    userId: typeof intent.buyerId === 'string' ? intent.buyerId : order.buyerId ?? null,
    buyerId: typeof intent.buyerId === 'string' ? intent.buyerId : order.buyerId ?? null,
    sellerId: typeof intent.sellerId === 'string' ? intent.sellerId : order.sellerId ?? null,
    automated: true, phase, refundIntentId: intent.intentId, criteria,
    financialOutcome: {refundState: phase === 'reservation' ? 'requested' : 'succeeded',
      providerStatus: phase === 'reservation' ? null : intent.providerStatus ?? null,
      cardAmountCents: knownCents(intent.cardAmountCents), walletAmountCents: knownCents(intent.walletAmountCents),
      sellerDebitCents: knownCents(intent.sellerDebitCents), reservedSellerCents: phase === 'reservation' ? positiveCents(intent.freezeCents) : 0,
      localSettlementRecorded: phase === 'local_settlement', bankArrivalVerified: false},
    result: phase === 'reservation'
      ? 'Demande automatique de remboursement enregistrée ; le règlement et la réception bancaire ne sont pas confirmés.'
      : 'Règlement local du remboursement automatique confirmé ; la réception bancaire reste distincte.'};
  const payloadHash = supportAllocationHash(document);
  if (prior && (prior.protocol !== document.protocol || prior.payloadHash !== payloadHash || !(prior.executedAt instanceof Timestamp)))
    throw new HttpsError('failed-precondition', 'Le journal natif de ce remboursement doit être rapproché.');
  return {id, commit: () => {if (!prior) tx.create(ref, {...document, payloadHash, executedAt: FieldValue.serverTimestamp()});}};
}

async function reserve(transactionId: string, opts: IssueRefundOptions) {
  const ref = db.collection('transactions').doc(transactionId);
  const leaseOwner = randomUUID(), intentId = randomUUID(), now = Date.now();
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await opts.operatorSession?.(tx);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Commande introuvable.');
    const data = snap.data()!;
    if (opts.requiredBuyerId && data.buyerId !== opts.requiredBuyerId) throw new HttpsError('permission-denied', 'Seul l’acheteur peut demander ce remboursement.');
    if (opts.requiredSellerId && data.sellerId !== opts.requiredSellerId) throw new HttpsError('permission-denied', 'Seul le vendeur peut annuler cette commande.');
    let existing = data.refund;
    if (opts.expectedRefundIntentId && existing?.intentId !== opts.expectedRefundIntentId)
      throw new HttpsError('failed-precondition', 'L’intention financière historique a changé.');
    let commercial: Awaited<ReturnType<typeof reserveAdminRefundDecision>> | null = null;
    if (opts.commercialDecision) {
      const own = await readAdminRefundDecision(tx, opts.commercialDecision, data);
      if (own.outcome === 'not_executed') return { intent: { state: 'unknown' }, owner: null, existing: true };
      if (own.outcome === 'unrecorded' && existing && opts.commercialDecision.allocation &&
          await readSettledAllocationIntent(tx, transactionId, data, existing)) existing = null;
      if (own.outcome === 'unrecorded' && existing) {
        const decision = await reserveAdminRefundDecision(tx, opts.commercialDecision, data, intentId,
          { cardAmountCents: 0, walletAmountCents: 0, sellerDebitCents: 0 }, opts.operatorAuthTime, opts.operatorSession);
        if (decision.permitted) throw new HttpsError('unavailable', 'La réservation précédente doit être rapprochée.');
        await opts.operatorSession?.(tx, true);
        decision.commit();
        return { intent: { state: 'unknown' }, owner: null, existing: true };
      }
      if (own.outcome === 'unrecorded') {
        const input = opts.commercialDecision;
        commercial = await reserveAdminRefundDecision(tx, input, data, intentId,
          { cardAmountCents: input.expectedCardCents, walletAmountCents: input.expectedWalletCents, sellerDebitCents: input.expectedSellerDebitCents }, opts.operatorAuthTime, opts.operatorSession);
        if (!commercial.permitted) {
          await opts.operatorSession?.(tx, true);
          commercial.commit();
          return { intent: { state: 'unknown' }, owner: null, existing: true };
        }
      }
    }
    if (existing) {
      if (existing.state === 'succeeded' && existing.fundsAppliedAt && !hasUnsettledRefund(data)) return { intent: existing, owner: null, existing: true };
      if (hasActiveBankDispute(data) || bankLost(data)) return { intent: existing.bankWaiting && canWaitForBank(data)
        ? existing : { ...existing, state: 'reconciliation_required' }, owner: null, existing: true };
      if (existing.state === 'failed' || existing.state === 'canceled' || existing.state === 'reconciliation_required') return { intent: existing, owner: null, existing: true };
      if (existing.leaseUntilMs > now) return { intent: existing, owner: null, existing: true };
      const intent = { ...existing, leaseOwner, leaseUntilMs: now + LEASE_MS };
      await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('purchase',ref,data,{ refund: intent, refundBlocked: true }));
      return { intent, owner: leaseOwner, existing: true };
    }
    const allocation = commercial?.permitted ? commercial.allocation : null;
    if (!opts.externalRefundId && hasPurchaseRefundContext(data) && !allocation) throw new HttpsError('failed-precondition',
      'L’accord ou l’allocation de cette commande doit être examiné explicitement.', {reason: 'purchase_refund_allocation_required', newRefundPermissionGranted: false});
    if (!opts.externalRefundId && (data.refundLegacyReconciliationRequired || data.status === 'refund_in_progress')) {
      const alertRef = db.collection('admin_alerts').doc(`refund_legacy_${transactionId}`);
      const alert = await tx.get(alertRef);
      if (!alert.exists) { await recoveryCommit({refs: [(alertRef).path]}); tx.set(alertRef, { kind: 'purchase_refund_action_required', severity: 'critical', refId: transactionId,
        message: 'Intention legacy sans montants/options persistés : rapprocher Stripe et le ledger avant une nouvelle demande.',
        status: 'open', createdAt: FieldValue.serverTimestamp() }); }
      await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('purchase',ref,data,{ refundBlocked: true, refundLegacyReconciliationRequired: true, status: 'refund_action_required' }));
      return { intent: { state: 'reconciliation_required', stripeRefundId: data.stripeRefundId ?? null }, owner: null, existing: true };
    }
    // True native intents/legacy reconciliation above keep their exact origin.
    // An observed external refund is serviced, never a fresh provider request.
    if (!opts.externalRefundId && !(commercial?.permitted && opts.commercialDecision?.productReview) &&
        await productFinancialContextRequired(tx, transactionId, data)) throw productFinancialReviewError();
    if (!opts.externalRefundId && !await fraudReviewAllowsProgress(tx, transactionId, data, snap)) throw new HttpsError('failed-precondition',
      'La revue du paiement exige une décision humaine avant un nouveau remboursement.',
      {reason: 'fraud_review_requires_human_decision', transactionId, newRefundPermissionGranted: false, action: 'contactSupport'});
    // No current provider code/native status is qualified proof of terminal
    // parcel loss. Existing intents and legacy reconciliation above retain
    // their exact stored amounts/options/key; this guard precedes every NEW
    // buyer-refund intent, ledger reservation and provider authorization.
    if (!opts.externalRefundId && returnToSenderBlocksProgress(data) && !(commercial?.permitted && opts.commercialDecision?.returnToSender)) throw new HttpsError('failed-precondition',
      'Le retour à l’expéditeur signalé exige une décision financière distincte. Le signalement n’autorise aucun remboursement.',
      { reason: 'return_to_sender_requires_human_review', action: 'contactSupport', transactionId, newRefundPermissionGranted: false });
    if (!opts.externalRefundId && (deliveryCorrectionBlocksProgress(data) || data.trackingReviewRequired === true &&
        data.trackingReviewReason === 'carrier_exception_requires_human_review') && !(commercial?.permitted && opts.commercialDecision?.transportReview))
      throw new HttpsError('failed-precondition', 'Le dossier transport exige une instruction financière explicite et distincte.',
        { reason: 'transport_financial_review_required', transactionId, newRefundPermissionGranted: false });
    if (opts.source === 'requestRefund') throw new HttpsError('failed-precondition',
      'Cette commande doit être examinée par notre équipe. Un incident de suivi ne confirme ni une perte ni un remboursement.',
      { reason: 'carrier_incident_requires_human_review', action: 'contactSupport', transactionId,
        newRefundPermissionGranted: false });
    if (opts.allowedInitialStatuses && !opts.allowedInitialStatuses.includes(data.status)) throw new HttpsError('failed-precondition', 'Le statut de la commande a changé.');
    if (opts.source === 'expireOrphanedTransactions_paidNotShipped') {
      if (!opts.nonShipmentExpiry) throw new HttpsError('failed-precondition', 'L’échéance native de cette vente doit être rapprochée.');
      await assertNonShipmentExpiry(tx, transactionId, data, opts.nonShipmentExpiry);
    }
    let labelGiveupProof: ReturnType<typeof qualifiedRejectedLabelPurchase> = null;
    let labelGiveupPolicySource: Awaited<ReturnType<typeof readLabelAbandonmentPolicySource>> = null;
    if (opts.source === 'sweepPendingLabels_giveup') {
      const expected = opts.labelGiveup;
      labelGiveupProof = qualifiedRejectedLabelPurchase(data, transactionId);
      labelGiveupPolicySource=await readLabelAbandonmentPolicySource(tx,transactionId,data);
      if (!expected || !labelGiveupProof || !labelGiveupPolicySource?.ready||
          expected.policySourceHash!==labelGiveupPolicySource.sourceHash||expected.requiredFailures!==labelGiveupPolicySource.requiredFailures||data.status !== 'paid' || data.deliveryType !== 'shipping' || data.labelCreationPending !== true ||
          hasUnresolvedLabelOrParcelSource(data) || !(data.paidAt instanceof Timestamp) || data.currency !== 'CAD' ||
          !Number.isSafeInteger(data.labelAttempts) || data.labelAttempts !== expected.expectedLabelAttempts ||
          data.lastCountedLabelAttemptId !== labelGiveupProof.attemptId ||
          !Number.isSafeInteger(expected.requiredFailures) || expected.requiredFailures < 1 ||
          labelGiveupProof.rejectedAttempts < expected.requiredFailures || labelGiveupProof.attemptId !== expected.attemptId ||
          labelGiveupProof.rejectionSourceHash !== expected.rejectionSourceHash || labelGiveupProof.labelSourceHash !== expected.labelSourceHash) {
        throw new HttpsError('failed-precondition', 'L’achat de l’étiquette doit être rapproché avant une nouvelle demande de remboursement.',
          { reason: 'label_giveup_source_unqualified' });
      }
      const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
      if (claims.size >= 101 || claims.docs.some(claim => !['resolved', 'dismissed', 'closed'].includes(claim.data().status)) ||
          data.returnRequest != null || data.returnRequestedAt != null || data.disputed === true || data.bankDispute != null ||
          hasUnsettledRefund(data) || !await orderModerationAllowsProgress(tx, data))
        throw new HttpsError('failed-precondition', 'Un dossier, un retour ou une restriction exige une instruction avant ce remboursement.',
          { reason: 'label_giveup_obligation_open' });
    }
    if (!opts.externalRefundId) assertNoActiveBankDispute(data);
    if (!opts.externalRefundId && bankLost(data)) throw new HttpsError('failed-precondition', 'La contestation bancaire doit être rapprochée avant toute demande de remboursement.');
    const proof = opts.paymentProof;
    if (proof && (proof.transactionId !== transactionId || proof.currency !== 'cad' || !proof.id ||
      (data.stripePaymentIntentId && data.stripePaymentIntentId !== proof.id))) throw new HttpsError('failed-precondition', 'La preuve du paiement ne correspond pas à cette commande.');
    const pi = idOf(data.stripePaymentIntentId) ?? proof?.id ?? null;
    const paidVia = data.paidVia;
    const mixed = paidVia === 'mixed' || paidVia === 'wallet_and_card';
    const totalKnown = typeof data.totalAmount === 'number' && Number.isFinite(data.totalAmount) && data.totalAmount > 0;
    const total = totalKnown ? cents(Math.round(data.totalAmount * 100), 'totalAmount') : 0;
    const walletPaid = paidVia === 'wallet' ? cents(data.walletAmountUsed ?? total, 'walletAmountUsed') : mixed ? cents(data.walletAmountUsed ?? 0, 'walletAmountUsed') : 0;
    const captured = proof ? cents(proof.capturedCents, 'capturedCents') : data.capturedCardCents != null ? cents(data.capturedCardCents, 'capturedCardCents') : Math.max(0, total - walletPaid);
    if ((pi && captured <= 0) || (!pi && (!totalKnown || walletPaid <= 0))) throw new HttpsError('failed-precondition', 'Le montant réellement payé doit être prouvé avant de rembourser.');
    if (!pi && paidVia !== 'wallet') throw new HttpsError('failed-precondition', 'Le paiement carte doit être rapproché avant de rembourser.');
    const cardAmountCents = allocation ? allocation.record.terms.cardCents : !pi ? 0 : opts.cardRefundAmountCents === undefined ? captured : Math.min(captured, cents(opts.cardRefundAmountCents, 'cardRefundAmountCents'));
    const walletAmountCents = allocation ? allocation.record.terms.walletCents : opts.buyerWalletRefundOverrideCents === undefined ? walletPaid : Math.min(walletPaid, cents(opts.buyerWalletRefundOverrideCents, 'buyerWalletRefundOverrideCents'));
    const extra = opts.extraSellerDebitCents === undefined ? 0 : cents(opts.extraSellerDebitCents, 'extraSellerDebitCents');
    const sellerDebitCents = allocation ? allocation.record.terms.sellerDebitCents : positiveCents(data.sellerCreditedCents) + extra;
    if (allocation && extra !== 0) throw new HttpsError('invalid-argument', 'Aucun coût vendeur supplémentaire implicite dans une allocation.');
    if (opts.commercialDecision && (cardAmountCents !== opts.commercialDecision.expectedCardCents ||
        walletAmountCents !== opts.commercialDecision.expectedWalletCents || sellerDebitCents !== opts.commercialDecision.expectedSellerDebitCents))
      throw new HttpsError('failed-precondition', 'Le paiement courant ne correspond plus aux montants examinés.');
    const sellerRef = typeof data.sellerId === 'string' ? db.collection('wallets').doc(data.sellerId) : null;
    const sellerSnap = sellerRef ? await tx.get(sellerRef) : null;
    let funds = sellerRef && sellerSnap?.exists ? await bankDisputeSaleFunds(tx, sellerRef, data, transactionId) : { releasedCents: 0 };
    if (allocation) {
      const consumed = await readSellerAllocationConsumption(tx, transactionId, data);
      funds = {...funds, releasedCents: Math.max(0, funds.releasedCents - consumed.releasedCents)};
    }
    const legacyApplied = !allocation && (data.status === 'refunded' || !!data.refundedAt);
    const sellerLedger = legacyApplied && sellerRef ? await tx.get(sellerRef.collection('ledger').where('transactionId', '==', transactionId)) : null;
    const buyerRef = legacyApplied && typeof data.buyerId === 'string' ? db.collection('wallets').doc(data.buyerId) : null;
    const buyerLedger = buyerRef ? await tx.get(buyerRef.collection('ledger').where('transactionId', '==', transactionId)) : null;
    const sellerApplied = sellerLedger?.docs.reduce((sum, d) => { const e = d.data(); return sum + (e.type === 'refund_debit' ? positiveCents(e.amount) + positiveCents(e.debtRecorded) : 0); }, 0) ?? 0;
    const walletApplied = buyerLedger?.docs.reduce((sum, d) => sum + (d.data().type === 'refund_credit' ? positiveCents(d.data().amount) : 0), 0) ?? 0;
    const legacyReconciliationRequired = legacyApplied && (sellerApplied !== sellerDebitCents || walletApplied !== walletAmountCents);
    const freezeCents = !legacyApplied && !opts.externalRefundId && !hasActiveBankDispute(data) && sellerSnap?.exists ? Math.min(sellerDebitCents, funds.releasedCents, positiveCents(sellerSnap.data()!.balance)) : 0;
    const intent: FirebaseFirestore.DocumentData = {
      intentId, attemptId: intentId, previousRefundIds: allocation ? allocation.qualified.rows.docs.map(r => r.data().settlement?.providerRefundId).filter((id): id is string => typeof id === 'string') : [], idempotencyKey: opts.idempotencyKey, state: 'requested', providerStatus: null,
      paymentIntentId: pi, currency: 'cad', capturedCardCents: captured, cardAmountCents, walletAmountCents, sellerDebitCents,
      buyerId: data.buyerId ?? null, sellerId: data.sellerId ?? null,
      extraSellerDebitCents: extra, relistArticle: opts.relistArticle === true && !opts.commercialDecision,
      ...(commercial?.permitted ? { commercialDecision: commercial.provenance } : {}),
      ...(allocation ? {allocation: {protocol: 'purchase_refund_intent_allocation_v1', refundIntentId: intentId,
        reservationHash: allocation.record.reservationHash, terms: allocation.record.terms, basisHash: allocation.record.basisHash},
        watchHistoryUntilMs: Math.max(0, ...allocation.qualified.rows.docs.map(r => positiveCents(r.data().settlement?.watchUntilMs)))} : {}),
      ...(labelGiveupProof ? { labelGiveupProof, labelGiveupPolicySource } : {}),
      reason: typeof opts.reason === 'string' ? opts.reason.substring(0, 300) : 'refund', source: opts.source ?? 'issueTransactionRefund',
      actor: opts.initiatedByUid ? { kind: 'user', uid: opts.initiatedByUid } : { kind: 'system', source: opts.source ?? 'issueTransactionRefund', referenceId: proof?.id ?? transactionId },
      originalStatus: data.status ?? null, requestedAtMs: now, requestedAt: FieldValue.serverTimestamp(),
      // A later tranche belongs to a NEW exact intention. The previous
      // provider ID remains only in its immutable history/ceiling manifest.
      externalAttemptedAtMs: null, stripeRefundId: opts.externalRefundId ?? (allocation ? null : data.stripeRefundId ?? null),
      leaseOwner, leaseUntilMs: now + LEASE_MS, freezeCents, outstandingCardCents: cardAmountCents,
      watch: cardAmountCents > 0 || !!allocation && allocation.qualified.rows.docs.some(r => positiveCents(r.data().settlement?.watchUntilMs) > now), watchUntilMs: null,
      fundsAppliedAt: legacyApplied && !legacyReconciliationRequired ? data.refundedAt ?? FieldValue.serverTimestamp() : null, legacyApplied, legacyReconciliationRequired,
    };
    if (automaticRefundType(intent.source)) {
      const document = {qualification: 'qualified_native_reservation', transactionId, refundIntentId: intentId, source: intent.source,
        actor: intent.actor, buyerId: intent.buyerId, sellerId: intent.sellerId, originalStatus: intent.originalStatus,
        nativeRequestRecordedAtMs: now,
        nonShipmentExpiry: opts.nonShipmentExpiry ? {sourceHash: opts.nonShipmentExpiry.sourceHash, expiresAtMs: opts.nonShipmentExpiry.expiresAtMs,
          policyHash: data.nonShipmentPolicyWindow?.policyHash ?? null, windowHash: data.nonShipmentPolicyWindow?.sourceHash ?? null} : null,
        labelGiveup: labelGiveupProof && labelGiveupPolicySource ? {attemptId: labelGiveupProof.attemptId,
          rejectionSourceHash: labelGiveupProof.rejectionSourceHash, labelSourceHash: labelGiveupProof.labelSourceHash,
          policyHash: labelGiveupPolicySource.policyHash, windowHash: labelGiveupPolicySource.windowHash,
          policySourceHash: labelGiveupPolicySource.sourceHash, requiredFailures: labelGiveupPolicySource.requiredFailures,
          rejectedAttempts: labelGiveupPolicySource.rejectedAttempts, countedAttempts: labelGiveupPolicySource.expectedLabelAttempts} : null};
      intent.automaticDecisionSource = {protocol: 'purchase_automatic_refund_source_v1', document, sourceHash: supportAllocationHash(document)};
    }
    const fraudCandidates = proof ? await prepareFraudCandidateProjection(tx, transactionId,
      {...data, stripePaymentIntentId: proof.id, capturedCardCents: captured}) : null;
    const automaticJournal = await prepareAutomaticRefundJournal(tx, transactionId, data, intent, 'reservation');
    await opts.operatorSession?.(tx, true);
    if (freezeCents > 0 && sellerRef && sellerSnap) {
      await recoveryCommit({refs: [(sellerRef).path]});
    tx.update(sellerRef, await financialRecoveryWalletFields(sellerRef,sellerSnap!,{ balance: FieldValue.increment(-freezeCents), heldBalance: FieldValue.increment(freezeCents), updatedAt: FieldValue.serverTimestamp() },{balance: ((sellerSnap!.data()??{})["balance"]??0) + (-freezeCents),heldBalance: ((sellerSnap!.data()??{})["heldBalance"]??0) + (freezeCents)}));
      await recoveryCommit({refs: [(sellerRef.collection('ledger').doc(`refund_hold_${intentId}`)).path]});
    tx.set(sellerRef.collection('ledger').doc(`refund_hold_${intentId}`), { type: 'refund_hold', amount: freezeCents,
        balanceAfter: positiveCents(sellerSnap.data()!.balance) - freezeCents, transactionId, refundIntentId: intentId,
        description: 'Remboursement demandé — fonds réservés', createdAt: FieldValue.serverTimestamp() });
    }
    // The process may stop after this commit, before any provider lookup or
    // response. Its fair replay queue must exist in the SAME atomic reservation.
    await recoveryCommit({refs: [(db.collection('failed_operations').doc(`refund_${intentId}`)).path]});
    tx.set(db.collection('failed_operations').doc(`refund_${intentId}`), { type: 'stripe_refund_failed', refId: transactionId,
      payload: { transactionId, paymentIntentId: pi, refundIntentId: intentId, idempotencyKey: opts.idempotencyKey },
      status: 'pending', attempts: 0, lastTriedAt: null, createdAt: FieldValue.serverTimestamp() });
    await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('purchase',ref,data,{ refund: intent, refundBlocked: true, status: 'refund_in_progress', refundReason: intent.reason,
      refundStartedAt: FieldValue.serverTimestamp(), ...(proof ? { stripePaymentIntentId: proof.id, capturedCardCents: captured } : {}) }));
    commercial?.commit();
    fraudCandidates?.commit();
    automaticJournal?.commit();
    return { intent, owner: leaseOwner, existing: false };
  });
}

async function providerSearch(intent: FirebaseFirestore.DocumentData) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe client unavailable');
  if (intent.stripeRefundId) return stripe.refunds.retrieve(intent.stripeRefundId);
  let after: string | undefined;
  const candidates: any[] = [];
  const matched: any[] = [];
  for (let page = 0; page < MAX_REFUND_PAGES; page++) {
    const result = await stripe.refunds.list({ payment_intent: intent.paymentIntentId, limit: 100, ...(after ? { starting_after: after } : {}) });
    const matches = result.data.filter(r => r.metadata?.refundIntentId === intent.intentId && !intent.previousRefundIds?.includes(r.id) &&
      (!intent.attemptId || intent.attemptId === intent.intentId || r.metadata?.refundAttemptId === intent.attemptId));
    candidates.push(...result.data.filter(r => !intent.previousRefundIds?.includes(r.id)));
    matched.push(...matches);
    if (matched.length > 1) throw new Error('Multiple provider refunds match one intention');
    if (!result.has_more) {
      if (matched.length === 1) return stripe.refunds.retrieve(matched[0].id);
      if (intent.legacyApplied && candidates.length === 1 && candidates[0].amount === intent.cardAmountCents && candidates[0].currency === 'cad') return stripe.refunds.retrieve(candidates[0].id);
      if (candidates.length) throw new Error('Unattributed existing refund requires manual reconciliation; no second request');
      return null;
    }
    if (!result.data.length) throw new Error('Invalid refund pagination');
    after = result.data[result.data.length - 1].id;
  }
  throw new Error('Refund lookup exceeds bounded page budget; manual reconciliation required');
}

/** A stale NEW authorization remains an operator obligation with its original
 * intent and hold. It is neither a cancellation nor proof of returned money. */
async function prepareTransportFinancialHold(tx: FirebaseFirestore.Transaction, transactionId: string, data: FirebaseFirestore.DocumentData,
  reason = 'return_to_sender_financial_source_changed') {
  const intent = data.refund, alertRef = db.collection('admin_alerts').doc(`refund_${intent.intentId}_reconciliation_required`);
  const prior = await tx.get(alertRef), source = qualifiedRefundNoticeSource(data, intent);
  const notices = source ? await prepareOperationalNotices(tx, [source.buyerId, source.sellerId].map(userId => ({
    eventKey: `${reason === 'product_financial_source_changed' ? 'product' : reason === 'transport_financial_source_changed' ? 'transport' : 'rts'}_financial_hold:${transactionId}:${intent.intentId}`, userId, type: 'order_moderation',
    title: 'Instruction financière à réexaminer',
    message: 'Les sources examinées ont changé ou leur autorisation doit être rapprochée. Cette intention financière reste en examen ; aucun nouveau règlement n’est confirmé par cet avis.',
    data: { ownerId: userId, transactionId, refundIntentId: intent.intentId, newRefundAuthorized: 'false', bankArrivalVerified: 'false' },
  }))) : null;
  const held = { ...intent, state: 'reconciliation_required', failureReason: reason, leaseOwner: null, leaseUntilMs: 0 };
  const orderRef=db.collection('transactions').doc(transactionId),orderFields=await financialRecoverySourceFields('purchase',orderRef,data,{refund:held,refundBlocked:true,status:'refund_action_required'});
  return { held, commit: () => {
    if (!prior.exists) tx.create(alertRef, { kind: 'purchase_refund_action_required', severity: 'critical', refId: transactionId,
      refundIntentId: intent.intentId, reason,
      message: 'Réexaminer la liste des dossiers et la source financière avant une nouvelle instruction ; conserver la réservation originale.',
      status: 'open', createdAt: FieldValue.serverTimestamp() });
    tx.update(orderRef,orderFields);
    notices?.commit();
  } };
}

async function applyEvidence(transactionId: string, intentId: string, refund: any, source: 'response' | 'current' | 'local', error: string | null = null, expectedAttemptId?: string): Promise<IssueRefundResult> {
  const ref = db.collection('transactions').doc(transactionId);
  // Only a new local settlement requires an operator's present authorization.
  // Exact provider evidence remains serviceable after a later report/role loss.
  const localPre = source === 'local' ? (await ref.get()).data()?.refund : null;
  const localDecision = localPre?.returnToSenderAuthorization ?? localPre?.commercialDecision;
  const localOperatorCurrent = localDecision?.returnToSender ? await returnToSenderOperatorSessionCurrent(localDecision) : false;
  const localInquiryDecision = localPre?.transportReviewAuthorization ?? localPre?.commercialDecision;
  const localInquiryOperatorCurrent = localInquiryDecision?.transportReview ? await returnToSenderOperatorSessionCurrent(localInquiryDecision) : false;
  const localProductDecision = localPre?.productReviewAuthorization ?? localPre?.commercialDecision;
  const localProductOperatorCurrent = localProductDecision?.productReview ? await returnToSenderOperatorSessionCurrent(localProductDecision) : false;
  const localAllocationDecision = localPre?.purchaseRefundAuthorization ?? localPre?.commercialDecision;
  const localAllocationOperatorCurrent = localAllocationDecision?.allocation ? await returnToSenderOperatorSessionCurrent(localAllocationDecision) : false;
  const outcome = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Commande introuvable.');
    const rootData = snap.data()!, historical = rootData.refund?.intentId !== intentId;
    const selected = historical ? await readAllocationHistoryIntent(tx, transactionId, rootData, intentId) : rootData.refund;
    const data = historical ? {...rootData, refund: selected} : rootData, intent = data.refund;
    if (!intent || intent.intentId !== intentId) throw new HttpsError('failed-precondition', 'L’intention de remboursement a changé.');
    if ((expectedAttemptId && intent.attemptId !== expectedAttemptId) || intent.previousRefundIds?.includes(idOf(refund?.id))) return { result: refundResult(intent), notified: false };
    // The original reservation is not a local settlement receipt. A later
    // risk signal fences NEW wallet credit/debit even on the same intent.
    // Already-applied money and genuine provider evidence keep their path.
    if (source === 'local' && !intent.fundsAppliedAt && !await fraudReviewAllowsProgress(tx, transactionId, data, snap))
      return { result: refundResult({...intent, state: 'reconciliation_required'}), notified: false };
    if (source === 'local' && !intent.fundsAppliedAt && !await purchaseRefundNewEffectAllowed(tx, transactionId, data, localAllocationOperatorCurrent)) {
      const hold = await prepareTransportFinancialHold(tx, transactionId, data, 'purchase_refund_source_changed');
      hold.commit(); return {result: refundResult(hold.held), notified: false};
    }
    if (source === 'local' && !intent.fundsAppliedAt && (intent.cardAmountCents !== 0 ||
        !await returnToSenderNewEffectAllowed(tx, transactionId, data, localOperatorCurrent, localDecision?.decisionId))) {
      const hold = await prepareTransportFinancialHold(tx, transactionId, data);
      hold.commit();
      return { result: refundResult(hold.held), notified: false };
    }
    if (source === 'local' && !intent.fundsAppliedAt &&
        !await transportReviewNewEffectAllowed(tx, transactionId, data, localInquiryOperatorCurrent, localInquiryDecision?.decisionId)) {
      const hold = await prepareTransportFinancialHold(tx, transactionId, data, 'transport_financial_source_changed');
      hold.commit();
      return { result: refundResult(hold.held), notified: false };
    }
    if (source === 'local' && !intent.fundsAppliedAt &&
        !await productReviewNewEffectAllowed(tx, transactionId, data, localProductOperatorCurrent, localProductDecision?.decisionId)) {
      const hold = await prepareTransportFinancialHold(tx, transactionId, data, 'product_financial_source_changed');
      hold.commit(); return {result: refundResult(hold.held), notified: false};
    }
    let state: RefundStatus = PROVIDER_STATUSES.has(refund?.status) ? refund.status : 'unknown';
    let refundId = idOf(refund?.id) ?? intent.stripeRefundId;
    let verifiedEvidence = source === 'local' || !!refund;
    if (source !== 'local' && refund && (!idOf(refund.id) || idOf(refund.payment_intent) !== intent.paymentIntentId || refund.currency !== 'cad' ||
      refund.amount !== intent.cardAmountCents || (intent.stripeRefundId && refundId !== intent.stripeRefundId) ||
      (refund.metadata?.refundIntentId && refund.metadata.refundIntentId !== intentId) ||
      (source === 'current' && !intent.stripeRefundId && !intent.legacyApplied && refund.metadata?.refundIntentId !== intentId) ||
      (refund.metadata?.refundAttemptId && refund.metadata.refundAttemptId !== intent.attemptId))) {
      state = 'reconciliation_required'; error = 'Refund identity, currency or amount does not match the reserved intention';
      verifiedEvidence = false;
      refundId = intent.stripeRefundId ?? refundId;
    }
    // Failed/canceled are terminal for the same provider request. A stale create
    // response cannot override a later failure, nor pending overwrite success.
    if (source === 'response' && intent.lastEvidenceSource === 'current') return { result: refundResult(intent), notified: false };
    if (source === 'response' && ['failed', 'canceled'].includes(intent.providerStatus) && !['failed', 'canceled'].includes(state)) return { result: refundResult(intent), notified: false };
    if (intent.providerStatus === 'succeeded' && (!refund || (source === 'response' && (state === 'pending' || state === 'unknown' || state === 'requires_action')))) return { result: refundResult(intent, true), notified: false };
    const repair = source === 'local' ? null : await prepareOriginalRefundRepairObservation(tx, transactionId, rootData, intent, refund);
    if (repair) {repair.commit(); return {result: repair.result, notified: false};}
    const bankBlocked = hasActiveBankDispute(data) || bankLost(data);
    // A pending/action/unknown request has not settled money. Its bank overlap
    // is temporary, while a verified success, local money already applied or a
    // mismatched proof requires an explicit reconciliation. Never clear a
    // pre-existing bank anomaly/legacy hold to make this distinction.
    const bankWaiting = bankBlocked && canWaitForBank(data) && !intent.fundsAppliedAt && !intent.legacyReconciliationRequired &&
      !(verifiedEvidence && refund?.status === 'succeeded') && !(refund && !verifiedEvidence) &&
      state !== 'reconciliation_required';
    if ((bankBlocked && !bankWaiting) || intent.legacyReconciliationRequired) state = 'reconciliation_required';
    const needsAlert = ['failed', 'canceled', 'unknown', 'requires_action', 'reconciliation_required'].includes(state);
    const alertRef = db.collection('admin_alerts').doc(`refund_${intentId}_${state}`);
    const alertSnap = needsAlert ? await tx.get(alertRef) : null;
    const queueRef = db.collection('failed_operations').doc(`refund_${intentId}`);
    const queueSnap = await tx.get(queueRef);
    const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
    let sellerRef: FirebaseFirestore.DocumentReference | null = null;
    let sellerSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    let buyerRef: FirebaseFirestore.DocumentReference | null = null;
    let buyerSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    let articleRef: FirebaseFirestore.DocumentReference | null = null;
    let articleUnlock: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> | null = null;
    let funds = { pendingCents: 0, heldCents: 0, releasedCents: 0 };
    let productTargetCurrent = true;
    let convenienceTargetCurrent = false;
    let convenienceEffective: Awaited<ReturnType<typeof import('./convenienceReturnFinancial').readEffectiveConvenienceReturnFinancing>> = null;
    const allocationRecord = intent.allocation ? (await tx.get(refundAllocationRef(transactionId, intentId))).data() : null;
    if (intent.allocation && (!allocationRecord || allocationRecord.reservationHash !== intent.allocation.reservationHash ||
        allocationRecord.reservationHash !== supportAllocationHash(allocationRecord.reservation) || allocationRecord.refundIntentId !== intentId))
      throw new HttpsError('failed-precondition', 'La réservation native de cette allocation doit être rapprochée.');
    let allocationSettlement: Record<string, any> | null = null;
    const applyMoney = state === 'succeeded' && !intent.fundsAppliedAt;
    if (applyMoney) {
      if ((intent.sellerDebitCents > 0 && !data.sellerId) || (intent.walletAmountCents > 0 && !data.buyerId) || data.sellerId === data.buyerId) throw new HttpsError('failed-precondition', 'Les bénéficiaires du remboursement doivent être rapprochés.');
      if ((intent.buyerId != null && intent.buyerId !== data.buyerId) || (intent.sellerId != null && intent.sellerId !== data.sellerId))
        throw new HttpsError('failed-precondition', 'Les destinataires réservés du remboursement ont changé.');
      if (intent.commercialDecision) {
        const decision = intent.commercialDecision;
        const native = (await tx.get(ref.collection('dispute_decisions').doc(decision.decisionId))).data();
        if (decision.buyerId !== data.buyerId || decision.sellerId !== data.sellerId ||
            native?.kind !== 'admin_financial_decision_v1' || native.outcome !== 'reserved' || native.refundIntentId !== intentId ||
            native.actorUid !== decision.actorUid || native.payloadHash !== decision.payloadHash ||
            native.buyerId !== data.buyerId || native.sellerId !== data.sellerId ||
            native.cardCents !== intent.cardAmountCents || native.walletCents !== intent.walletAmountCents ||
            native.sellerDebitCents !== intent.sellerDebitCents || !nativeTime(native.committedAt))
          throw new HttpsError('failed-precondition', 'La décision et les montants réservés doivent être rapprochés.');
        const authority = intent.productReviewAuthorization ?? decision;
        if (authority.productReview) {
          try {
            const current = await readProductFinancialSource(tx, transactionId, data, authority.productReview.caseId, authority.allocation?.reviewedDisputeId ?? authority.expectedDisputeId, authority.productReview.topic, authority.productReview.materialCapability === 'product_review_material_v1', authority.productReview.parcelCapability === 'product_review_parcel_v1', authority.productReview.lateCommercial);
            productTargetCurrent = productFinancialReferenceCurrent(current.reference, authority.productReview, true);
          } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
            if (!(error instanceof HttpsError) || error.code !== 'failed-precondition') throw error;
            productTargetCurrent = false;
          }
        } else productTargetCurrent = !await productFinancialContextRequired(tx, transactionId, data);
        if (decision.targetKind === 'convenience_return' && decision.allocation?.convenienceReturn) {
          const {readConvenienceReturnFinancialReception} = await import('./convenienceReturnReception');
          const reception = await readConvenienceReturnFinancialReception(tx, transactionId, data, decision.allocation.convenienceReturn);
          const {readEffectiveConvenienceReturnFinancing} = await import('./convenienceReturnFinancial');
          convenienceEffective = await readEffectiveConvenienceReturnFinancing(tx, transactionId, data);
          if (!convenienceEffective || convenienceEffective.terms.returnLabelCostCents !== intent.allocation.terms.returnLabelDeduction.amountCents ||
              convenienceEffective.terms.netRefundCents !== intent.cardAmountCents + intent.walletAmountCents)
            throw new HttpsError('failed-precondition', 'Le coût effectif du retour doit être rapproché.');
          convenienceTargetCurrent = !!reception && decision.expectedDisputeId === reception.reference.proposalId &&
            commercialClaimHash({...reception.target, transactionId, buyerId: data.buyerId, sellerId: data.sellerId,
              source: 'convenience_return', status: 'open', createdAt: reception.target.recordedAt}) === decision.targetHash;
        }
      }
      sellerRef = intent.sellerDebitCents > 0 ? db.collection('wallets').doc(data.sellerId) : null;
      sellerSnap = sellerRef ? await tx.get(sellerRef) : null;
      buyerRef = intent.walletAmountCents > 0 ? db.collection('wallets').doc(data.buyerId) : null;
      buyerSnap = buyerRef ? await tx.get(buyerRef) : null;
      if (sellerRef && sellerSnap?.exists) funds = await bankDisputeSaleFunds(tx, sellerRef, { ...data, status: intent.originalStatus }, transactionId);
      if (intent.allocation) {
        const consumed = await readSellerAllocationConsumption(tx, transactionId, data);
        funds = {pendingCents: Math.max(0, funds.pendingCents - consumed.pendingCents), heldCents: Math.max(0, funds.heldCents - consumed.heldCents),
          releasedCents: Math.max(0, funds.releasedCents - consumed.releasedCents)};
      }
      // A legacy bool cannot prove possession after delivery. Preserve old
      // finance, but only qualified native pre-send cancellation may unlock.
      const preSendProof = refundHasPreSendInventoryProof(data, intent) &&
        claims.size < 101 && !claims.docs.some(claim => claim.data().status === 'open');
      articleRef = intent.relistArticle && preSendProof && data.articleId ? db.collection('articles').doc(data.articleId) : null;
      const articleSnap = articleRef ? await tx.get(articleRef) : null;
      articleUnlock = articleRef && articleSnap?.exists ? await articleReleaseUpdate(tx, articleRef, articleSnap.data()!, transactionId) : null;
    }
    const bankRefundOverlap = bankRefundOverlapRequiresReview(data);
    // A provider's lost outcome is not a differential reconciliation of an H
    // allocation or an independent refund. Actual refund proofs remain above;
    // only a separate, natively settled bank-only history can satisfy this rail.
    const externalBankLoss = !hasActiveBankDispute(data) && !bankRefundOverlap &&
      data.bankDispute?.state === 'closed' && data.bankDispute.outcome === 'lost' && data.bankDispute.closedAt instanceof Timestamp &&
      typeof data.bankDispute.id === 'string' && data.bankDispute.id.length > 0 && nativeBankLossLedgerRecorded(data.bankDispute) &&
      positiveCents(intent.capturedCardCents) > 0 && positiveCents(data.bankDispute.amountCents) === intent.capturedCardCents;
    const qualifiedBankLoss = externalBankLoss;
    const providerStatus = source === 'local' ? null : verifiedEvidence ? refund?.status ?? intent.providerStatus ?? null : intent.providerStatus ?? null;
    const cardConfirmedCents = verifiedEvidence && refund?.status === 'succeeded' ? intent.cardAmountCents : !verifiedEvidence && intent.providerStatus === 'succeeded' ? positiveCents(intent.cardConfirmedCents) || intent.cardAmountCents : 0;
    const updated: FirebaseFirestore.DocumentData = { ...intent, state, providerStatus, lastEvidenceSource: source, bankWaiting,
      bankWaitingDisputeId: bankWaiting ? idOf(data.bankDispute?.id) ?? idOf(data.disputeId) : null,
      stripeRefundId: refundId ?? null, failureReason: refund?.failure_reason ?? error ?? null,
      nextActionType: refund?.next_action?.type ?? null, leaseOwner: null, leaseUntilMs: 0,
      cardConfirmedCents, cardSatisfiedVia: externalBankLoss ? 'chargeback' : cardConfirmedCents > 0 ? 'stripe' : null,
      outstandingCardCents: externalBankLoss || cardConfirmedCents > 0 ? 0 : intent.cardAmountCents,
      localOutstandingWalletCents: intent.fundsAppliedAt || qualifiedBankLoss ? 0 : intent.walletAmountCents,
      localOutstandingSellerCents: intent.fundsAppliedAt ? 0 : qualifiedBankLoss ? Math.max(0, intent.sellerDebitCents - positiveCents(data.sellerCreditedCents)) : intent.sellerDebitCents,
      duplicateCardSettlementCents: externalBankLoss && cardConfirmedCents > 0 ? cardConfirmedCents : bankRefundOverlap
        ? positiveCents(intent.duplicateCardSettlementCents) || null : 0,
      watch: intent.cardAmountCents > 0 || positiveCents(intent.watchHistoryUntilMs) > Date.now(),
      watchUntilMs: providerStatus === 'succeeded' ? intent.providerStatus === 'succeeded' && typeof intent.watchUntilMs === 'number' ? intent.watchUntilMs : Date.now() + 31 * 24 * 60 * 60 * 1000 : null,
      providerSucceededAtMs: providerStatus === 'succeeded' ? intent.providerStatus === 'succeeded' ? intent.providerSucceededAtMs ?? Date.now() : Date.now() : intent.providerSucceededAtMs ?? null,
      updatedAt: FieldValue.serverTimestamp() };
    const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = { refund: updated, refundBlocked: state !== 'succeeded',
      status: state === 'succeeded' ? (applyMoney ? 'refunded' : data.status) : ['failed', 'canceled', 'reconciliation_required'].includes(state) ? 'refund_action_required' : 'refund_in_progress' };
    const refundNotices = applyMoney ? await prepareOperationalNotices(tx, [data.buyerId, data.sellerId].map(userId => ({
      eventKey: `refund_confirmed:${transactionId}:${intentId}`, userId, type: 'order_refunded',
      title: intent.allocation?.terms.settlementKind === 'partial' ? 'Remboursement partiel confirmé' : 'Remboursement confirmé',
      message: ['expireOrphanedTransactions_paidNotShipped', 'sweepPendingLabels_giveup'].includes(intent.source)
        ? 'Le remboursement de cette commande a été confirmé à la suite d’un traitement automatique. Ses mouvements sont enregistrés ; consultez la commande pour les montants et le moyen de remboursement. Vous pouvez demander un examen humain au support.'
        : intent.allocation ? 'Le montant de cette allocation est confirmé et ses mouvements sont enregistrés. Le reste de la vente, ses dossiers et ses instructions de transport demeurent distincts ; aucune arrivée bancaire n’est attestée.' : 'Le remboursement de cette commande est confirmé et ses mouvements sont enregistrés. Consultez la commande pour les montants et le moyen de remboursement.',
      data: { transactionId, refundIntentId: intentId },
    }))) : null;
    // A later failed/canceled/current-unknown outcome corrects the earlier
    // announcement for BOTH parties in this same native transaction. Version
    // identity is content/intent/attempt based, not a delivery counter; identical
    // replays find the durable notice receipts even after owner dismissal.
    const noticeSource = qualifiedRefundNoticeSource(data, intent);
    const priorSuccessRecorded = intent.fundsAppliedAt instanceof Timestamp ||
      Number.isSafeInteger(intent.providerSucceededAtMs) && intent.providerSucceededAtMs > 0 && intent.providerSucceededAtMs <= Date.now();
    const earlierStatusNotice = ['refund_owner_status_v1', 'refund_owner_status_v2'].includes(intent.ownerStatusNotice?.protocol) &&
      intent.ownerStatusNotice.refundIntentId === intentId && /^[a-f0-9]{64}$/.test(intent.ownerStatusNotice.version ?? '');
    const statusNoticeNeeded = needsAlert || state === 'pending' && priorSuccessRecorded ||
      state === 'succeeded' && !applyMoney && earlierStatusNotice;
    let refundStatusNotices: Awaited<ReturnType<typeof prepareOperationalNotices>> | null = null;
    if (statusNoticeNeeded && noticeSource) {
      const outcome = verifiedEvidence && ['failed', 'canceled', 'requires_action'].includes(refund?.status) ? refund.status :
        state === 'succeeded' ? 'succeeded' : 'unknown';
      const titles: Record<string, string> = { failed: 'Remboursement carte à reprendre', canceled: 'Remboursement carte annulé',
        requires_action: 'Remboursement : examen nécessaire', succeeded: 'Confirmation du remboursement actualisée', unknown: 'Remboursement à vérifier' };
      const descriptions: Record<string, string> = { failed: 'Le prestataire indique que cette demande de remboursement carte a échoué.',
        canceled: 'Le prestataire indique que cette demande de remboursement carte a été annulée.',
        requires_action: 'Le prestataire indique qu’une action reste nécessaire pour cette demande de remboursement.',
        succeeded: 'Le prestataire confirme de nouveau cette demande de remboursement carte.',
        unknown: 'L’issue de cette demande de remboursement doit être rapprochée ; elle n’est pas confirmée par cette observation.' };
      const message = descriptions[outcome] + (priorSuccessRecorded && outcome !== 'succeeded'
        ? ' Une confirmation antérieure doit être revue.' : '') +
        ' Consultez la commande pour son état actuel et contactez le support. Cet avis ne confirme aucun nouvel envoi de fonds ni une arrivée sur un compte bancaire.';
      // A reserved amount is qualified by the native intention. A remaining
      // card obligation is disclosed only if its source is independently clear;
      // a bank overlap/unknown outcome never becomes an invented owner debt.
      const bankLossQualifiedForNotice = externalBankLoss && data.bankDispute?.closedAt instanceof Timestamp &&
        data.bankDispute?.ledgerReconciledAt instanceof Timestamp;
      const outstandingQualified = Number.isSafeInteger(updated.outstandingCardCents) && updated.outstandingCardCents >= 0 &&
        updated.outstandingCardCents <= noticeSource.cardAmountCents &&
        (outcome === 'failed' || outcome === 'canceled' ? updated.outstandingCardCents === noticeSource.cardAmountCents ||
          bankLossQualifiedForNotice && updated.outstandingCardCents === 0 : outcome === 'succeeded' && updated.outstandingCardCents === 0);
      const noticeData = { transactionId, refundIntentId: intentId, refundAttemptId: noticeSource.attemptId,
        refundState: state, providerOutcome: outcome, priorSuccessRecorded: String(priorSuccessRecorded),
        reservedCardAmountCents: String(noticeSource.cardAmountCents), reservedWalletAmountCents: String(noticeSource.walletAmountCents),
        outstandingCardCents: outstandingQualified ? String(updated.outstandingCardCents) : 'unknown',
        outstandingCardAmountQualified: String(outstandingQualified), currency: noticeSource.currency,
        bankArrivalVerified: 'false', newRefundAuthorized: 'false' };
      const version = createHash('sha256').update(JSON.stringify(['refund_owner_status_v2', noticeSource.buyerId, noticeSource.sellerId,
        Object.entries(noticeData).sort(([a], [b]) => a.localeCompare(b)), titles[outcome], message])).digest('hex');
      // V2 adds owner routing. Reconstruct the EXACT V1 content identity before
      // emitting it: a deleted V1 notification is still receipted and must not
      // be recreated merely because the transport acquired an ownerId field.
      const v1Version = createHash('sha256').update(JSON.stringify(['refund_owner_status_v1', noticeSource.buyerId, noticeSource.sellerId,
        Object.entries(noticeData).sort(([a], [b]) => a.localeCompare(b)), titles[outcome], message])).digest('hex');
      const recipients = [noticeSource.buyerId, noticeSource.sellerId];
      const v1Receipts = await readOperationalNoticeReceipts(tx, recipients.map(userId => ({
        eventKey: `refund_status_v1:${transactionId}:${intentId}:${v1Version}`, userId, type: 'order_moderation',
        title: titles[outcome], message, data: { ...noticeData, refundStatusVersion: v1Version },
      })));
      const unreceiptedRecipients = recipients.filter((_userId, index) => !v1Receipts[index]);
      if (unreceiptedRecipients.length) {
        updated.ownerStatusNotice = { protocol: 'refund_owner_status_v2', refundIntentId: intentId, attemptId: noticeSource.attemptId,
          version, outcome, state, recordedAt: earlierStatusNotice && intent.ownerStatusNotice.version === version &&
            intent.ownerStatusNotice.recordedAt instanceof Timestamp ? intent.ownerStatusNotice.recordedAt : FieldValue.serverTimestamp() };
        refundStatusNotices = await prepareOperationalNotices(tx, unreceiptedRecipients.map(userId => ({
          eventKey: `refund_status_v2:${transactionId}:${intentId}:${version}`, userId, type: 'order_moderation',
          title: titles[outcome], message, data: { ...noticeData, ownerId: userId, refundStatusVersion: version },
        })));
      }
    }
    const automaticJournal = applyMoney ? await prepareAutomaticRefundJournal(tx, transactionId, data, updated, 'local_settlement') : null;
    // Read the private accounting corpus before the first money/notice write.
    // Its commit uses the same prepared settlement, never a future TX read.
    const accounting = await preparePurchasePlatformAccounting(tx, transactionId, rootData, {refundIntentId: intentId});
    // Freeze the EXACT local settlement once, before any money or notice
    // write. Source/ledger/tax receipt share the native commit transform. The
    // tax receipt stays explicitly provisional until that date is read back;
    // no preparation timestamp becomes a financial or fiscal effective date.
    const settlementAt=applyMoney&&state==='succeeded'?FieldValue.serverTimestamp():null;
    const sellerMoney=sellerRef?(()=>{const wallet=sellerSnap?.data()??{},pending=positiveCents(wallet.pendingBalance),held=positiveCents(wallet.heldBalance),balance=positiveCents(wallet.balance),
      fromPending=Math.min(intent.sellerDebitCents,funds.pendingCents,pending),fromHeld=Math.min(intent.sellerDebitCents-fromPending,funds.heldCents+positiveCents(intent.freezeCents),held),
      fromBalance=Math.min(intent.sellerDebitCents-fromPending-fromHeld,balance),debt=intent.sellerDebitCents-fromPending-fromHeld-fromBalance,
      residual=Math.min(Math.max(0,positiveCents(intent.freezeCents)-fromHeld),held-fromHeld);return{wallet,pending,held,balance,fromPending,fromHeld,fromBalance,debt,residual};})():null;
    if(state==='succeeded')updated.outstandingCardCents=0;
    if(settlementAt){updated.fundsAppliedAt=settlementAt;updated.freezeCents=0;updated.localOutstandingWalletCents=0;updated.localOutstandingSellerCents=0;
      if(intent.allocation){allocationSettlement={protocol:'purchase_refund_allocation_settlement_v1',refundIntentId:intentId,appliedAt:settlementAt,providerRefundId:refundId??null,
        sellerDebitCents:intent.sellerDebitCents,watchUntilMs:updated.watchUntilMs,salePendingConsumedCents:0,saleHeldConsumedCents:0,saleReleasedConsumedCents:0,fromPendingCents:0,fromHeldCents:0,fromBalanceCents:0,debtCents:0};
        if(sellerMoney){const m=sellerMoney,saleHeld=Math.min(m.fromHeld,funds.heldCents);Object.assign(allocationSettlement,{salePendingConsumedCents:m.fromPending,saleHeldConsumedCents:saleHeld,
          saleReleasedConsumedCents:Math.min(m.fromBalance,funds.releasedCents)+m.fromHeld-saleHeld,fromPendingCents:m.fromPending,fromHeldCents:m.fromHeld,fromBalanceCents:m.fromBalance,debtCents:m.debt});}}
    }
    const buyerRefundLedger=buyerRef?{type:'refund_credit',amount:intent.walletAmountCents,balanceAfter:positiveCents(buyerSnap?.data()?.balance)+intent.walletAmountCents,
      transactionId,refundIntentId:intentId,description:'Remboursement confirmé — portion porte-monnaie',createdAt:settlementAt}:null;
    const sellerRefundLedger=sellerRef&&sellerMoney?{type:'refund_debit',amount:sellerMoney.fromPending+sellerMoney.fromHeld+sellerMoney.fromBalance,debtRecorded:sellerMoney.debt,
      balanceAfter:sellerMoney.balance-sellerMoney.fromBalance+sellerMoney.residual,transactionId,refundIntentId:intentId,description:'Remboursement confirmé — débit vendeur',createdAt:settlementAt}:null;
    const localLedger=settlementAt?[...buyerRef&&buyerRefundLedger?[{path:buyerRef.collection('ledger').doc(`refund_credit_${intentId}`).path,document:buyerRefundLedger}]:[],
      ...sellerRef&&sellerRefundLedger?[{path:sellerRef.collection('ledger').doc(`refund_debit_${intentId}`).path,document:sellerRefundLedger}]:[]]:undefined;
    const anticipatedRootPatch:Record<string,any>={...update,...historical&&(state!=='succeeded'||updated.outstandingCardCents>0)?{'refundAllocationState.reviewRequired':true}:{},
      ...bankBlocked&&!bankWaiting&&data.bankDispute?{'bankDispute.reconciliationRequired':true,...typeof data.bankDispute.id==='string'&&data.bankDispute.id?{disputeId:data.bankDispute.id}:{}}:{}};
    const fiscal=await prepareSellerTaxFinancialEvent(tx,data.sellerId,{kind:'purchase_refund',id:transactionId,refundIntentId:intentId},
      {order:sellerTaxFinancialOrderAfter(rootData,anticipatedRootPatch),...settlementAt?{commitTimestamp:settlementAt}:{},refund:{intent:updated,settlement:allocationSettlement??allocationRecord?.settlement??null,...localLedger?{localLedger}:{}}});
    if (needsAlert && !alertSnap?.exists) { await recoveryCommit({refs: [(alertRef).path]}); tx.set(alertRef, { kind: 'purchase_refund_action_required', severity: 'critical', refId: transactionId,
      message: 'Un remboursement acheteur reste à traiter. Vérifier la demande existante avant tout autre remboursement.',
      context: { refundIntentId: intentId, refundId: refundId ?? null, state, error }, status: 'open', createdAt: FieldValue.serverTimestamp() }); }
    if (bankBlocked && !bankWaiting && data.bankDispute) {
      update['bankDispute.reconciliationRequired'] = true;
      if (typeof data.bankDispute.id === 'string' && data.bankDispute.id) update.disputeId = data.bankDispute.id;
    }
    if (state === 'succeeded') {
      updated.outstandingCardCents = 0;
      if (applyMoney) {
        if (automaticRefundType(intent.source)) {
          update.cancelReason = typeof intent.reason === 'string' ? intent.reason : 'automatic_refund';
          if (intent.source === 'sweepPendingLabels_giveup') update.labelCreationPending = false;
          if (intent.source === 'expireOrphanedTransactions_paidNotShipped') update.cancelledAt = data.cancelledAt ?? FieldValue.serverTimestamp();
        }
        updated.fundsAppliedAt = settlementAt;
        updated.freezeCents = 0;
        updated.localOutstandingWalletCents = 0;
        updated.localOutstandingSellerCents = 0;
        if (buyerRef) {
          if (buyerSnap?.exists) { await recoveryCommit({refs: [(buyerRef).path]}); tx.update(buyerRef, await financialRecoveryWalletFields(buyerRef,buyerSnap!,{ balance: FieldValue.increment(intent.walletAmountCents), updatedAt: FieldValue.serverTimestamp() },{balance: ((buyerSnap!.data()??{})["balance"]??0) + (intent.walletAmountCents)})); }
          else { await recoveryCommit({refs: [(buyerRef).path]}); tx.set(buyerRef, await financialRecoveryWalletFields(buyerRef,buyerSnap!,{ balance: intent.walletAmountCents, currency: 'cad', status: 'active', updatedAt: FieldValue.serverTimestamp() },{}), { merge: true }); }
          await recoveryCommit({refs: [(buyerRef.collection('ledger').doc(`refund_credit_${intentId}`)).path]});
    tx.set(buyerRef.collection('ledger').doc(`refund_credit_${intentId}`), buyerRefundLedger!);
        }
        if (sellerRef) {
          const {wallet,pending,held,balance,fromPending,fromHeld,fromBalance,debt,residual}=sellerMoney!;
          if (allocationSettlement) {
            const saleHeld = Math.min(fromHeld, funds.heldCents);
            Object.assign(allocationSettlement, {salePendingConsumedCents: fromPending, saleHeldConsumedCents: saleHeld,
              saleReleasedConsumedCents: Math.min(fromBalance, funds.releasedCents) + fromHeld - saleHeld,
              fromPendingCents: fromPending, fromHeldCents: fromHeld, fromBalanceCents: fromBalance, debtCents: debt});
          }
          if (positiveCents(intent.freezeCents) > 0) updated.freezeConsumption = {
            protocol: 'refund_hold_consumption_v1', refundIntentId: intentId, refundAttemptId: intent.attemptId,
            buyerId: data.buyerId, sellerId: data.sellerId, currency: 'CAD', originalFreezeCents: intent.freezeCents,
            consumedCents: Math.min(intent.freezeCents, fromHeld), returnedCents: residual,
            fromPendingCents: fromPending, fromHeldCents: fromHeld, fromBalanceCents: fromBalance, debtCents: debt,
            sellerDebitCents: intent.sellerDebitCents, settledAt: settlementAt,
          };
          const values = { pendingBalance: FieldValue.increment(-fromPending), heldBalance: FieldValue.increment(-fromHeld - residual),
            balance: FieldValue.increment(-fromBalance + residual), sellerDebt: FieldValue.increment(debt), updatedAt: FieldValue.serverTimestamp() };
          if (sellerSnap?.exists) { await recoveryCommit({refs: [(sellerRef).path]}); tx.update(sellerRef, await financialRecoveryWalletFields(sellerRef,sellerSnap!,values,{pendingBalance:pending-fromPending,heldBalance:held-fromHeld-residual,balance:balance-fromBalance+residual,sellerDebt:(wallet.sellerDebt??0)+debt})); } else { await recoveryCommit({refs: [(sellerRef).path]}); tx.set(sellerRef, await financialRecoveryWalletFields(sellerRef,sellerSnap!,values,{pendingBalance:pending-fromPending,heldBalance:held-fromHeld-residual,balance:balance-fromBalance+residual,sellerDebt:(wallet.sellerDebt??0)+debt}), { merge: true }); }
          await recoveryCommit({refs: [(sellerRef.collection('ledger').doc(`refund_debit_${intentId}`)).path]});
    tx.set(sellerRef.collection('ledger').doc(`refund_debit_${intentId}`), sellerRefundLedger!);
        }
        if (articleRef && articleUnlock) commitArticleRelease(tx, articleRef, articleUnlock);
      }
      if (!intent.allocation || intent.allocation.terms.settlementKind === 'full_remaining') {
        update.refundedAt = data.refundedAt ?? FieldValue.serverTimestamp(); update.refundedVia = intent.paymentIntentId ? 'stripe' : 'wallet';
      }
      update.refundLegacyReconciliationRequired = FieldValue.delete();
      update.stripeRefundId = refundId ?? null;
      // A financial settlement is not a decision about every complaint. Only
      // the exact unchanged dossier examined before the first reserve closes.
      const decision = intent.commercialDecision;
      const target = decision?.schemaVersion === 1 && !decision.returnToSender ? claims.docs.find(claim => claim.id === decision.expectedDisputeId) : null;
      const targetQualified = applyMoney && (!intent.allocation || intent.allocation.terms.caseHandling === 'settle_selected_case') && productTargetCurrent && claims.size < 101 && target?.data().status === 'open' &&
        target.data().buyerId === decision.buyerId && target.data().sellerId === decision.sellerId &&
        decision.buyerId === data.buyerId && decision.sellerId === data.sellerId &&
        commercialClaimHash(target.data()) === decision.targetHash;
      if (targetQualified && target) { await recoveryCommit({refs: [(target.ref).path]}); tx.update(target.ref, { status: 'resolved', resolution: intent.allocation?.terms.settlementKind === 'partial' ? 'partially_refunded' : 'refunded',
        refundIntentId: intentId, resolvedBy: decision.actorUid, resolutionDecisionId: decision.decisionId,
        resolutionNote: decision.note, resolvedAt: FieldValue.serverTimestamp() }); }
      const remaining = claims.docs.filter(claim => claim.data().status === 'open' && (!targetQualified || claim.id !== target?.id)).map(claim => claim.id).sort();
      if (applyMoney) {
        const convenienceQualified = decision?.targetKind === 'convenience_return' && convenienceTargetCurrent && productTargetCurrent &&
          intent.allocation?.terms.protocol === 'purchase_refund_terms_v2' && remaining.length === 0 && claims.size < 101;
        if (intent.allocation?.terms.caseHandling === 'settle_selected_case' && decision &&
            (targetQualified || convenienceQualified || decision.targetKind === 'agreement' && remaining.length === 0 && data.disputed !== true)) {
          update.purchaseRefundCaseDisposition = purchaseRefundCaseDisposition(transactionId, data, decision.decisionId,
            decision.allocation, decision.productReview, decision.expectedDisputeId, intentId);
        }
        updated.commercialCasesClosed = targetQualified ? 1 : 0;
        updated.remainingOpenDisputeIds = remaining;
        update.disputed = remaining.length > 0 || claims.size >= 101 || data.disputed === true && !targetQualified && !convenienceQualified;
        if (!articleUnlock) update.refundInventoryReviewRequired = true;
        if (decision && !targetQualified) update.refundCommercialReviewRequired = true;
        if (decision?.targetKind === 'agreement' && remaining.length === 0 && data.disputed !== true)
          update.refundCommercialReviewRequired = FieldValue.delete();
        if (intent.allocation?.terms.settlementKind === 'partial') {
          const preserved = intent.originalStatus === 'disputed' && targetQualified && remaining.length === 0 ? data.statusBeforeDispute : intent.originalStatus;
          update.status = ['paid', 'label_created', 'shipped', 'delivered', 'disputed', 'return_requested', 'completed', 'meetup_completed'].includes(preserved) ? preserved : 'disputed';
          if (decision?.targetKind === 'agreement' && remaining.length === 0 && data.disputed !== true) update.refundCommercialReviewRequired = FieldValue.delete();
        }
        if (convenienceQualified) {
          const terms = intent.allocation.terms;
          const effective = convenienceEffective!;
          update.convenienceReturnFinancialSettlement = {protocol: 'convenience_return_financial_settlement_v1', transactionId,
            refundIntentId: intentId, decisionId: decision.decisionId, reference: decision.allocation.convenienceReturn,
            grossArticleCents: terms.refund.articleCents, returnLabelCostCents: terms.returnLabelDeduction.amountCents,
            netRefundCents: terms.cardCents + terms.walletCents, cardCents: terms.cardCents, walletCents: terms.walletCents,
            sellerDebitCents: intent.sellerDebitCents, recordedAt: FieldValue.serverTimestamp(), physicalPossessionVerified: false,
            ...(effective.costResolution ? {actualLabelCostCents: effective.costResolution.actualCostCents,
              platformVarianceCents: effective.costResolution.platformVarianceCents, costResolutionId: effective.costResolution.resolutionId} : {}),
            inventoryReleaseAuthorized: false, bankArrivalVerified: false};
          update.status = 'refunded';
          update.refundCommercialReviewRequired = FieldValue.delete();
        }
      }
    } else if (intent.fundsAppliedAt && updated.outstandingCardCents > 0) {
      for (const claim of claims.docs) if (claim.data().refundIntentId === intentId && ['refunded', 'partially_refunded'].includes(claim.data().resolution)) { await recoveryCommit({refs: [(claim.ref).path]}); tx.update(claim.ref, {
        status: 'open', resolution: FieldValue.delete(), refundFailureAt: FieldValue.serverTimestamp() }); }
    }
    const finalFiscalPatch=historical?{...state!=='succeeded'||updated.outstandingCardCents>0?{'refundAllocationState.reviewRequired':true}:{}}:update;
    fiscal.commit({order:sellerTaxFinancialOrderAfter(rootData,finalFiscalPatch),...settlementAt?{commitTimestamp:settlementAt}:{},refund:{intent:updated,settlement:allocationSettlement??allocationRecord?.settlement??null,...localLedger?{localLedger}:{}}});
    accounting.commit({intent: updated, settlement: allocationSettlement ?? allocationRecord?.settlement,
      localMoneyApplied: applyMoney && state === 'succeeded'});
    if (historical) {
      // Archived allocations already applied their exact local movements.
      // A late provider correction updates their observation, never the
      // latest intent, amounts, stock or an additional credit/debit.
      await recoveryCommit({refs: [(refundHistoryRef(transactionId, intentId)).path]});
    tx.update(refundHistoryRef(transactionId, intentId), {currentIntent: updated});
      if (state !== 'succeeded' || updated.outstandingCardCents > 0) { await recoveryCommit({refs: [(ref).path]}); tx.update(ref, await financialRecoverySourceFields('purchase',ref,rootData,{refundBlocked: true,
        'refundAllocationState.reviewRequired': true, status: 'refund_action_required'})); }
    } else {
      // The latest successful tranche cannot erase a reconciliation raised by
      // another, archived tranche. That independent native hold has no NEW
      // money authority and remains available for an explicit investigation.
      if (rootData.refundAllocationState?.reviewRequired === true) {
        update.refundBlocked = true; update.status = 'refund_action_required';
      }
      await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('purchase',ref,rootData,update));
    }
    if (allocationSettlement) { await recoveryCommit({refs: [(refundAllocationRef(transactionId, intentId)).path]}); tx.update(refundAllocationRef(transactionId, intentId), {settlement: allocationSettlement}); }
    await recoveryCommit({refs: [(queueRef).path]});
    tx.set(queueRef, { type: 'stripe_refund_failed', refId: transactionId,
      payload: { transactionId, paymentIntentId: intent.paymentIntentId, refundIntentId: intentId, idempotencyKey: intent.idempotencyKey },
      status: state === 'succeeded' ? 'resolved' : 'pending', attempts: queueSnap.data()?.attempts ?? 0,
      lastTriedAt: queueSnap.data()?.lastTriedAt ?? null, createdAt: queueSnap.data()?.createdAt ?? FieldValue.serverTimestamp() }, { merge: true });
    refundNotices?.commit();
    refundStatusNotices?.commit();
    automaticJournal?.commit();
    return { result: refundResult(updated, state === 'succeeded' && !applyMoney), notified: applyMoney, buyerId: data.buyerId, sellerId: data.sellerId, intent: updated };
  });
  if (outcome.notified && outcome.intent) {
    // Exact succeeded proof, money and both notices committed together. The
    // independent worker may resume push; pending/unknown never reach this path.
    if (outcome.buyerId) await captureServerEvent(outcome.buyerId, 'order_refunded', { transaction_id: transactionId,
      refund_cents: outcome.intent.cardAmountCents + outcome.intent.walletAmountCents, reason: outcome.intent.reason, $insert_id: `order_refunded_${transactionId}` });
  }
  return outcome.result;
}

export async function issueTransactionRefund(transactionId: string, _preData: FirebaseFirestore.DocumentData, opts: IssueRefundOptions): Promise<IssueRefundResult> {
  const reserved = await reserve(transactionId, opts);
  const intent = reserved.intent;
  if (!reserved.owner) return refundResult(intent, intent.state === 'succeeded');
  if (intent.cardAmountCents === 0) return applyEvidence(transactionId, intent.intentId, { status: 'succeeded' }, 'local', null, intent.attemptId);
  try {
    const found = await providerSearch(intent);
    if (found) return applyEvidence(transactionId, intent.intentId, found, 'current', null, intent.attemptId);
    // A lease timeout is never proof the old request had no external effect.
    if (intent.legacyApplied || (intent.externalAttemptedAtMs && Date.now() - intent.externalAttemptedAtMs >= SAFE_RETRY_MS)) {
      return applyEvidence(transactionId, intent.intentId, null, 'current', 'No unique existing refund found; no new request after the idempotency horizon', intent.attemptId);
    }
    const ref = db.collection('transactions').doc(transactionId);
    const authorization = intent.returnToSenderAuthorization ?? intent.commercialDecision;
    const operatorCurrent = authorization?.returnToSender ? await returnToSenderOperatorSessionCurrent(authorization) : false;
    const inquiryAuthorization = intent.transportReviewAuthorization ?? intent.commercialDecision;
    const inquiryOperatorCurrent = inquiryAuthorization?.transportReview ? await returnToSenderOperatorSessionCurrent(inquiryAuthorization) : false;
    const productAuthorization = intent.productReviewAuthorization ?? intent.commercialDecision;
    const productOperatorCurrent = productAuthorization?.productReview ? await returnToSenderOperatorSessionCurrent(productAuthorization) : false;
    const allocationAuthorization = intent.purchaseRefundAuthorization ?? intent.commercialDecision;
    const allocationOperatorCurrent = allocationAuthorization?.allocation ? await returnToSenderOperatorSessionCurrent(allocationAuthorization) : false;
    const allowed = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await opts.operatorSession?.(tx, true);
      const data = (await tx.get(ref)).data()!;
      if (data.refund.intentId !== intent.intentId || data.refund.leaseOwner !== reserved.owner) return false;
      if (hasActiveBankDispute(data) || bankLost(data)) return false;
      if(!await (await import('./refundRepair')).manualRefundNewProviderEffectAllowed(tx,transactionId,data,data.refund))return false;
      // Exact provider evidence was applied first. A qualified empty lookup
      // does not authorize a NEW POST while the payment review is unresolved.
      if (!await fraudReviewAllowsProgress(tx, transactionId, data)) return false;
      if (!await purchaseRefundNewEffectAllowed(tx, transactionId, data, allocationOperatorCurrent)) {
        const hold = await prepareTransportFinancialHold(tx, transactionId, data, 'purchase_refund_source_changed');
        hold.commit(); return false;
      }
      // The marker says the call MAY have escaped; it is not provider proof.
      // Exact provider evidence above is serviced first. Every create after a
      // qualified empty lookup still requires current sources and an actor.
      if (!await returnToSenderNewEffectAllowed(tx, transactionId, data, operatorCurrent, authorization?.decisionId)) {
        const hold = await prepareTransportFinancialHold(tx, transactionId, data);
        hold.commit();
        return false;
      }
      if (!await transportReviewNewEffectAllowed(tx, transactionId, data, inquiryOperatorCurrent, inquiryAuthorization?.decisionId)) {
        const hold = await prepareTransportFinancialHold(tx, transactionId, data, 'transport_financial_source_changed');
        hold.commit();
        return false;
      }
      if (!await productReviewNewEffectAllowed(tx, transactionId, data, productOperatorCurrent, productAuthorization?.decisionId)) {
        const hold = await prepareTransportFinancialHold(tx, transactionId, data, 'product_financial_source_changed');
        hold.commit(); return false;
      }
      await opts.operatorSession?.(tx, true);
      await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('purchase',ref,data,{ 'refund.externalAttemptedAtMs': intent.externalAttemptedAtMs ?? Date.now() }));
      return true;
    });
    if (!allowed) return refundResult({ ...intent, state: 'reconciliation_required' });
    await opts.operatorSession?.(undefined, true);
    const refund = await createNativePurchaseRefundCardRequest({transactionId, paymentIntentId: intent.paymentIntentId,
      amountCents: intent.cardAmountCents, refundIntentId: intent.intentId, refundAttemptId: intent.attemptId, idempotencyKey: intent.idempotencyKey});
    return applyEvidence(transactionId, intent.intentId, refund, 'response', null, intent.attemptId);
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    logger.error('Purchase refund outcome requires lookup', { transactionId, intentId: intent.intentId, error: error instanceof Error ? error.message : String(error) });
    return applyEvidence(transactionId, intent.intentId, null, 'current', error instanceof Error ? error.message : String(error), intent.attemptId);
  }
}

/** Resume the durable options. Never substitute a job's reason, amounts or key. */
export async function resumeTransactionRefund(transactionId: string, expectedRefundIntentId?: string): Promise<IssueRefundResult> {
  await observePurchaseRefundRepairs(transactionId);
  const data = (await db.collection('transactions').doc(transactionId).get()).data();
  if (data && expectedRefundIntentId && data.refund?.intentId !== expectedRefundIntentId) {
    const previous = await db.runTransaction(tx => readAllocationHistoryIntent(tx, transactionId, data, expectedRefundIntentId));
    if (!previous) throw new HttpsError('failed-precondition', 'L’intention historique doit être rapprochée.');
    if (previous.cardAmountCents === 0) return refundResult(previous, true);
    const found = await providerSearch(previous);
    return applyEvidence(transactionId, previous.intentId, found, 'current', found ? null : 'Historical provider result unknown; no new request', previous.attemptId);
  }
  if (!data?.refund) throw new HttpsError('failed-precondition', 'Aucune intention durable de remboursement.');
  return issueTransactionRefund(transactionId, data, { idempotencyKey: data.refund.idempotencyKey,
    ...(expectedRefundIntentId ? { expectedRefundIntentId } : {}) });
}

/** An explicit human renewal observes the original provider intention FIRST.
 * No create/adoption/new intent is allowed here. An empty bounded lookup is
 * transient knowledge, never persisted as a financial absence certificate. */
export async function observeRefundBeforeTransportResume(transactionId: string,
  expected: { refundIntentId: string; refundAttemptId: string }): Promise<boolean> {
  const data = (await db.collection('transactions').doc(transactionId).get()).data(), intent = data?.refund;
  if (!intent || intent.intentId !== expected.refundIntentId || intent.attemptId !== expected.refundAttemptId)
    throw new HttpsError('failed-precondition', 'L’intention originale a changé.');
  if (intent.fundsAppliedAt != null) return true;
  if (intent.cardAmountCents === 0) return false;
  const found = await providerSearch(intent);
  if (!found) return false;
  await applyEvidence(transactionId, intent.intentId, found, 'current', null, intent.attemptId);
  return true;
}

/** Explicit operator repair after current provider proof of a terminal failure.
 * The obligation and already-applied local money survive the new attempt.
 */
export async function retryPurchaseRefundAfterFailure(transactionId: string, adminUid: string,
  admit?: (tx: FirebaseFirestore.Transaction) => Promise<void>, expectedRefundIntentId?: string): Promise<IssueRefundResult> {
  const ref = db.collection('transactions').doc(transactionId);
  const pre = (await ref.get()).data();
  if (!pre?.refund?.stripeRefundId) throw new HttpsError('failed-precondition', 'Aucune demande carte identifiable à reprendre.');
  if (expectedRefundIntentId !== undefined && pre.refund.intentId !== expectedRefundIntentId)
    throw new HttpsError('aborted', 'L’intention de remboursement originale a changé. Relisez son résultat.');
  const stripe = getStripe();
  if (!stripe) throw new HttpsError('unavailable', 'Le prestataire doit confirmer l’échec avant la reprise.');
  const current = await stripe.refunds.retrieve(pre.refund.stripeRefundId);
  if (!['failed', 'canceled'].includes(current.status ?? '') || idOf(current.payment_intent) !== pre.refund.paymentIntentId ||
      current.currency !== 'cad' || current.amount !== pre.refund.cardAmountCents) throw new HttpsError('failed-precondition', 'L’échec définitif de la demande doit être confirmé auprès du prestataire.');
  await applyEvidence(transactionId, pre.refund.intentId, current, 'current', null, pre.refund.attemptId);
  const attemptId = randomUUID();
  await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const data = (await tx.get(ref)).data();
    if (!data?.refund || data.refund.intentId !== pre.refund.intentId || data.refund.stripeRefundId !== current.id || data.refund.attemptId !== pre.refund.attemptId) throw new HttpsError('aborted', 'La demande a changé. Relisez son résultat.');
    if (admit) await admit(tx);
    if (hasPurchaseRefundContext(data)) throw new HttpsError('failed-precondition',
      'Cette allocation reste une obligation existante. Sa tentative ne peut pas être remplacée par la reprise historique sans décision structurée actuelle.',
      {reason: 'purchase_refund_repair_review_required', newRefundPermissionGranted: false});
    assertNoActiveBankDispute(data);
    if (bankLost(data) || data.refund.legacyReconciliationRequired || !['failed', 'canceled'].includes(data.refund.state)) throw new HttpsError('failed-precondition', 'Le rapprochement financier doit être terminé avant cette reprise.');
    const previousRefundIds = [...(data.refund.previousRefundIds ?? []), current.id];
    if (previousRefundIds.length > 20) throw new HttpsError('failed-precondition', 'Cette obligation nécessite une réparation manuelle alternative.');
    await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('purchase',ref,data,{ refund: { ...data.refund, previousRefundIds, attemptId, idempotencyKey: `rf_repair_${attemptId}`,
      stripeRefundId: null, state: 'requested', providerStatus: null, lastEvidenceSource: null, externalAttemptedAtMs: null, leaseOwner: null, leaseUntilMs: 0,
      authorizedRetryBy: adminUid, authorizedRetryAt: FieldValue.serverTimestamp(), priorFailureReason: current.failure_reason ?? null },
      refundBlocked: true, status: 'refund_in_progress' }));
  });
  return resumeTransactionRefund(transactionId);
}

/** Webhooks retrieve current provider truth rather than trust delivery order. */
export async function observePurchaseRefund(transactionId: string, refundId: string): Promise<IssueRefundResult> {
  const stripe = getStripe(); if (!stripe) throw new HttpsError('unavailable', 'Le remboursement doit être vérifié auprès du prestataire.');
  const current = await stripe.refunds.retrieve(refundId);
  const repaired = await observePurchaseRefundRepairIdentity(transactionId, current);
  if (repaired) return repaired;
  let data = (await db.collection('transactions').doc(transactionId).get()).data();
  if (!data) throw new HttpsError('not-found', 'Commande introuvable.');
  if (!data.refund) {
    // Only a full external refund is adopted automatically. Partial gestures are
    // not permission to unwind the sale or debit its full seller credit.
    const total = Math.round((data.totalAmount || 0) * 100);
    const card = Math.max(0, total - ((data.paidVia === 'mixed' || data.paidVia === 'wallet_and_card') ? positiveCents(data.walletAmountUsed) : 0));
    if (current.amount !== card || idOf(current.payment_intent) !== data.stripePaymentIntentId || current.currency !== 'cad') throw new HttpsError('failed-precondition', 'Le remboursement externe doit être rapproché avant toute régularisation.');
    await reserve(transactionId, { idempotencyKey: `rf_external_${refundId}`, externalRefundId: refundId, source: 'stripe_external_refund' });
    data = (await db.collection('transactions').doc(transactionId).get()).data()!;
  }
  const identified = current.metadata?.refundIntentId;
  if (data.refund?.allocation && current.id !== data.refund.stripeRefundId) {
    // Native provider identity is retained even if external metadata is later
    // absent/edited. It is not reassigned to the latest wallet/card tranche.
    const history = await db.collection('transactions').doc(transactionId).collection('refund_history').orderBy('__name__').limit(101).get();
    const matches = history.docs.filter(row => row.data().originalIntent?.stripeRefundId === current.id);
    if (history.size >= 101 || matches.length > 1) throw new HttpsError('failed-precondition', 'L’identité historique de ce remboursement doit être rapprochée.');
    if (matches.length === 1) {
      const previous = await db.runTransaction(async tx => {
        const order = (await tx.get(db.collection('transactions').doc(transactionId))).data();
        return order ? readAllocationHistoryIntent(tx, transactionId, order, matches[0].id) : null;
      });
      if (!previous) throw new HttpsError('failed-precondition', 'Les reçus historiques de ce remboursement doivent être rapprochés.');
      return applyEvidence(transactionId, previous.intentId, current, 'current', null, previous.attemptId);
    }
  }
  if (typeof identified === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(identified) && identified !== data.refund.intentId) {
    const previous = await db.runTransaction(tx => readAllocationHistoryIntent(tx, transactionId, data!, identified));
    if (previous) return applyEvidence(transactionId, previous.intentId, current, 'current', null, previous.attemptId);
  }
  return applyEvidence(transactionId, data.refund.intentId, current, 'current');
}

/** Single existing provider rail. Callers reserve/qualify native authority
 * before invoking this primitive; no destination or local finance is exposed. */
export async function createNativePurchaseRefundCardRequest(input: {transactionId: string; paymentIntentId: string; amountCents: number;
  refundIntentId: string; refundAttemptId: string; idempotencyKey: string; refundRepairId?: string}) {
  const stripe = getStripe(); if (!stripe) throw new Error('Stripe client unavailable');
  const allowed=await db.runTransaction(async tx=>{
    const order=(await tx.get(db.collection('transactions').doc(input.transactionId))).data();if(!order)return false;
    const intent=order.refund?.intentId===input.refundIntentId?order.refund:await readAllocationHistoryIntent(tx,input.transactionId,order,input.refundIntentId);
    return !!intent&&await (await import('./refundRepair')).manualRefundNewProviderEffectAllowed(tx,input.transactionId,order,intent);
  });
  if(!allowed)throw new HttpsError('failed-precondition','Une restitution manuelle réserve cette obligation.');
  return stripe.refunds.create({payment_intent: input.paymentIntentId, amount: input.amountCents,
    metadata: {transactionId: input.transactionId, refundIntentId: input.refundIntentId, refundAttemptId: input.refundAttemptId,
      ...(input.refundRepairId ? {refundRepairId: input.refundRepairId} : {})}}, {idempotencyKey: input.idempotencyKey});
}

/** Existing reconciliation job, GET-only page of archived tranches. Its cursor
 * advances on inspected native IDs; neither a miss nor a timeout permits POST. */
export async function observeArchivedPurchaseRefunds(transactionId: string): Promise<boolean> {
  const ref = db.collection('transactions').doc(transactionId), order = (await ref.get()).data();
  if (!order?.refundAllocationState) return false;
  const savedCursor = order.refundAllocationState.historyCursor;
  const cursor = typeof savedCursor === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(savedCursor) ? savedCursor : null;
  let query: FirebaseFirestore.Query = ref.collection('refund_history').orderBy('__name__').limit(21);
  if (cursor) query = query.startAfter(cursor);
  let page = await query.get();
  if (page.empty && cursor) page = await ref.collection('refund_history').orderBy('__name__').limit(21).get();
  const inspected = page.docs.slice(0, 20);
  for (const row of inspected) {
    const intent = await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      return current ? readAllocationHistoryIntent(tx, transactionId, current, row.id) : null;
    });
    if (!intent || intent.watch !== true) continue;
    if (intent.cardAmountCents === 0) {
      // A qualified wallet-only historical settlement has no provider refund
      // to observe. Older card histories retain their own watch independently.
      await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        const native = current ? await readAllocationHistoryIntent(tx, transactionId, current, row.id) : null;
        if (native?.cardAmountCents === 0 && native.fundsAppliedAt)
          tx.update(refundHistoryRef(transactionId, row.id), {'currentIntent.watch': false});
      });
      continue;
    }
    if (!intent.stripeRefundId) continue;
    try {await observePurchaseRefund(transactionId, intent.stripeRefundId);} catch (e) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
      await applyEvidence(transactionId, intent.intentId, null, 'current', e instanceof Error ? e.message : 'Historical provider observation unknown', intent.attemptId);
    }
    await db.runTransaction(async tx => {
      const h = (await tx.get(refundHistoryRef(transactionId, row.id))).data();
      if (h?.currentIntent?.state === 'succeeded' && typeof h.currentIntent.watchUntilMs === 'number' && h.currentIntent.watchUntilMs < Date.now())
        tx.update(refundHistoryRef(transactionId, row.id), {'currentIntent.watch': false});
    });
  }
  await db.runTransaction(async tx => {const current = (await tx.get(ref)).data();
    if (current?.refundAllocationState?.protocol === 'purchase_refund_allocation_state_v1')
      tx.update(ref, {'refundAllocationState.historyCursor': page.size > 20 ? inspected.at(-1)?.id ?? null : null});});
  // Do not retire the parent between pages, even once the last original
  // horizon elapsed. Each native history must receive its final GET before
  // watch=false; unknown/malformed rows and real failures retain the review.
  const remaining = await ref.collection('refund_history').orderBy('__name__').limit(101).get();
  return remaining.size >= 101 || remaining.docs.some(row => {
    const r = row.data();
    return r.protocol !== 'purchase_refund_history_v1' || r.transactionId !== transactionId || r.intentId !== row.id ||
      r.currentIntent?.watch !== false;
  }) || positiveCents(order.refund?.watchHistoryUntilMs) > Date.now();
}
