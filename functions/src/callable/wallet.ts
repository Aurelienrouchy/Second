import { financialRecoverySourceFields, writeFinancialRecoveryPurchaseDiagnostic } from "../utils/financialRecoverySources";
import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import { financialRecoveryWalletFields } from "../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
import {assertPrivateAccountSession, withPrivateAccountSession} from '../utils/privateAccountSession';
import {productRoutingAllowsRelease} from '../utils/productRoutingReview';
import {productMixedOrderAllowsRelease} from '../utils/productMixedOrders';
/**
 * Wallet callable functions
 * Firebase Functions v7 - using onCall
 *
 * Virtual wallet ("porte-monnaie") for the Second marketplace.
 * All amounts are in CENTS to avoid floating-point issues.
 *
 * Functions:
 * - activateWallet: One-click wallet creation
 * - getWalletInfo: Read wallet balance + recent ledger
 * - walletWithdraw: Withdraw from wallet to bank via Stripe
 * - payWithWallet: 100% wallet payment (no card)
 * - refundWalletPayment: Refund a 100% wallet transaction
 *
 * Ledger entry types (WalletLedgerType):
 * - 'purchase_debit'    — buyer pays for article
 * - 'sale_credit'       — seller receives funds into pendingBalance (escrow)
 * - 'funds_held'        — delivered: pendingBalance -> heldBalance (7-day dispute window)
 * - 'funds_released'    — dispute window elapsed: heldBalance -> balance (withdrawable)
 * - 'dispute_hold'      — dispute opened: balance -> heldBalance (frozen)
 * - 'refund_credit'     — refund returned to buyer's wallet
 * - 'refund_debit'      — seller debited on refund / lost dispute (may record sellerDebt)
 * - 'withdrawal'        — funds sent to bank via Stripe (withdrawal_requests='processing')
 * - 'withdrawal_failed' — withdrawal reverted after Stripe failure (F08: must be handled in UI)
 *
 * THREE-BUCKET FUNDS MODEL (see scheduled/releaseHeldFunds.ts for the full contract):
 *   pendingBalance — paid, not delivered (escrow)
 *   heldBalance    — delivered, inside 7-day dispute window (NOT withdrawable)
 *   balance        — withdrawable
 *   sellerDebt     — shortfall owed after a lost dispute (blocks withdrawals)
 *
 * Withdrawals (walletWithdraw) draw ONLY from `balance`, are refused while any
 * sale is `disputed`, and create a withdrawal_requests/{id}='processing' doc
 * (closed out by payout.paid / payout.failed webhooks).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import {observePlatformCash,platformCashRefusalMessage,platformCashObservationHash,type PlatformCashRefusalReason} from '../utils/platformCashPreflight';
import {qualifiedWithdrawalNonExecution, withdrawalIdentity, withdrawalIntentHash} from '../utils/withdrawalNonExecution';
import {readSellerAllocationConsumption, readPurchaseRefundReleaseContext} from '../utils/refundAllocation';
import { readOwnerWithdrawalTiming } from '../utils/payoutRecovery';
import { assertNewPaymentsEnabled } from '../config/featureFlags';
import { getShipEngine } from '../config/shipEngine';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { createLabelIdempotent } from '../utils/labelFulfillment';
import { captureServerEvent } from '../lib/analytics';
import { matchesWithdrawalPayout } from '../utils/payoutOutcome';
import { assertAccountOperationOpen, assertRecentAccountAuthentication } from '../utils/eligibility';
import { qualifyWithdrawalBank, bankSelectionIdentity, assertExpectedBankActor, assertBankOperationIdle, commitBankWithdrawalBarrier } from '../utils/stripeBank';
import { executeAdminRefundRequest } from './payments/disputes';
import { hasUnsettledRefund } from '../utils/refundState';
import { hasActiveBankDispute } from '../utils/bankDispute';
import { hasUnsettledReturnRequest } from '../utils/returnRequest';
import { deliveryCorrectionBlocksProgress, orderModerationAllowsProgress } from '../utils/orderModeration';
import { readWalletFinancialReview, assertWalletFinancialReviewClear } from '../utils/walletFundsAdmission';
import { readWalletHistoryPage } from '../utils/walletHistory';
import { effectivePurchaseReleaseAt, purchasePolicyAllowsRelease } from '../utils/purchasePolicy';
import { accountRelationshipAllowsRelease } from '../utils/accountRelationshipReview';
import { fraudReviewAllowsProgress } from '../utils/fraudReviewDecision';
import { readSellerHoldReviews } from '../utils/holdReview';
import { readParticipantSwapHoldReview } from '../utils/swapHeldFunds';
import {STANDARD_WITHDRAWAL_MINIMUM_CENTS, parseSmallBalanceClosureRequest, assertSmallBalanceClosure,
  assertSmallBalanceClosureAmount} from '../utils/smallBalanceClosure';

// Rate limiting: financial callables share a 1-minute sliding window.
// maxCallsUnauthenticated is 0 everywhere — these endpoints require auth.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

type WithdrawalInput = { userId: string; requestId: string; amount: number; bankAccountId: string; mode: 'request' | 'observe' };
const withdrawalReference = (input: WithdrawalInput) => db.collection('withdrawal_requests').doc(`wi_${withdrawalIdentity(input)}`);
const withdrawalDebitReference = (input: WithdrawalInput) => db.collection('wallets').doc(input.userId)
  .collection('ledger').doc(`withdrawal_${withdrawalIdentity(input)}`);
function validWithdrawalSubmission(data: FirebaseFirestore.DocumentData, input: WithdrawalInput): boolean {
  const submission = data.providerSubmission;
  return submission?.schemaVersion === 1 && submission.ownerId === input.userId &&
    submission.withdrawalRequestId === withdrawalReference(input).id && submission.payloadHash === withdrawalIntentHash(input) &&
    submission.amountCents === input.amount && submission.currency === 'CAD' &&
    submission.accountId === data.withdrawalIntent?.accountId && submission.bankAccountId === input.bankAccountId &&
    submission.debitLedgerId === withdrawalDebitReference(input).id &&
    ['not_started', 'requested', 'created', 'unknown'].includes(submission.transfer?.state) &&
    ['not_started', 'requested', 'created', 'unknown'].includes(submission.payout?.state) &&
    (submission.transfer.state === 'not_started' ? submission.transfer.authorizedAt === null : submission.transfer.authorizedAt instanceof Timestamp) &&
    (submission.payout.state === 'not_started' ? submission.payout.authorizedAt === null : submission.payout.authorizedAt instanceof Timestamp) &&
    (submission.transfer.state !== 'created' || submission.transfer.observedAt instanceof Timestamp &&
      /^tr_[A-Za-z0-9_]+$/.test(submission.transfer.providerId ?? '') && submission.transfer.providerId === data.stripeTransferId) &&
    (submission.payout.state === 'not_started' || submission.transfer.state === 'created') &&
    (submission.payout.state !== 'created' || submission.payout.observedAt instanceof Timestamp &&
      /^po_[A-Za-z0-9_]+$/.test(submission.payout.providerId ?? '') && submission.payout.providerId === data.stripePayoutId);
}

function withdrawalInput(uid: string, data: any): WithdrawalInput {
  assertExpectedBankActor(uid, data, true);
  if (typeof data?.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestId)) {
    throw new HttpsError('invalid-argument', 'La référence stable de la demande de retrait est requise.');
  }
  if (!Number.isSafeInteger(data?.amount) || data.amount < 1) {
    throw new HttpsError('invalid-argument', 'Le retrait doit être un montant entier positif en cents.');
  }
  if (typeof data?.expectedBankAccountId !== 'string' || !/^ba_[A-Za-z0-9_]{1,190}$/.test(data.expectedBankAccountId)) {
    throw new HttpsError('invalid-argument', 'La destination bancaire de cette demande est requise.');
  }
  if (data.mode !== undefined && data.mode !== 'request' && data.mode !== 'observe') {
    throw new HttpsError('invalid-argument', 'Mode de demande de retrait invalide.');
  }
  return { userId: uid, requestId: data.requestId, amount: data.amount, bankAccountId: data.expectedBankAccountId,
    mode: data.mode ?? 'request' };
}

/** A native debit receipt, rather than a status or provider ID alone, binds a
 * replay to the original client intention. This read never invokes Stripe. */
async function readWithdrawalReceipt(tx: FirebaseFirestore.Transaction, input: WithdrawalInput) {
  const ref = withdrawalReference(input), data = (await tx.get(ref)).data();
  if (!data) return null;
  // A native preflight refusal closes this exact request ID without ever
  // authorizing a debit or provider POST. Absence is still never a refusal.
  if (Object.prototype.hasOwnProperty.call(data, 'withdrawalNonExecution')) {
    const refusal=data.withdrawalNonExecution;
    if(data.userId!==input.userId||refusal?.ownerId!==input.userId)throw new HttpsError('permission-denied','Cette demande ne correspond pas à votre compte.');
    if(refusal.clientRequestId!==input.requestId||refusal.payloadHash!==withdrawalIntentHash(input)||data.amount!==input.amount||
      refusal.amountCents!==input.amount||refusal.bankAccountId!==input.bankAccountId)throw new HttpsError('failed-precondition','Cette référence désigne une autre demande de retrait.',
        {reason:'withdrawal_intent_conflict',action:'readOriginalWithdrawal'});
    if(!await qualifiedWithdrawalNonExecution(tx,input.userId,ref,data))
      throw new HttpsError('unavailable','La non-exécution de ce retrait doit être rapprochée.',
        {reason:'withdrawal_receipt_unqualified',requestId:input.requestId,withdrawalRequestId:ref.id,action:'contactSupport',retryPermissionGranted:false});
    return {protocol:'withdrawal_intent_v1' as const,requestId:input.requestId,ownerId:input.userId,withdrawalRequestId:ref.id,amountCents:input.amount,currency:'CAD' as const,
      bankAccountId:input.bankAccountId,intentCommitted:false,debitCommitted:false,replay:true,success:false,newBalance:null,balanceSource:'unavailable' as const,
      transferId:null,payoutId:null,status:'not_executed',operationState:'not_executed',completedReceiptQualified:false,recoveryCommitted:false,
      recoveryLedgerId:null,recoveredAt:null,transferState:'not_started',payoutState:'not_started',actionRequired:false,retryPermissionGranted:false,
      action:'contactSupport',ownerMessage:platformCashRefusalMessage(refusal.reason as PlatformCashRefusalReason),nonExecutionReceiptQualified:true,
      nonExecutionReason:refusal.reason as PlatformCashRefusalReason,nonExecutionRecordedAt:refusal.recordedAt.toDate().toISOString()};
  }
  const intent = data.withdrawalIntent;
  if (data.userId !== input.userId || intent?.ownerId !== input.userId) {
    throw new HttpsError('permission-denied', 'Cette demande de retrait ne correspond pas à votre compte.');
  }
  if (intent.clientRequestId !== input.requestId || intent.payloadHash !== withdrawalIntentHash(input) ||
      data.amount !== input.amount || intent.amountCents !== input.amount || intent.bankAccountId !== input.bankAccountId) {
    throw new HttpsError('failed-precondition', 'Cette référence désigne une autre demande de retrait.',
      { reason: 'withdrawal_intent_conflict', action: 'readOriginalWithdrawal' });
  }
  const debitRef = withdrawalDebitReference(input), debit = (await tx.get(debitRef)).data();
  if (intent.schemaVersion !== 1 || intent.withdrawalRequestId !== ref.id || intent.currency !== 'CAD' || data.currency !== 'cad' ||
      intent.debitLedgerId !== debitRef.id || data.ledgerEntryId !== debitRef.id ||
      !(intent.committedAt instanceof Timestamp) || !(data.createdAt instanceof Timestamp) ||
      data.stripeAccountId !== intent.accountId || !/^acct_[A-Za-z0-9_]+$/.test(intent.accountId ?? '') ||
      data.payoutDestination?.schemaVersion !== 1 || data.payoutDestination.accountId !== intent.accountId ||
      data.payoutDestination.bankAccountId !== input.bankAccountId || data.payoutDestination.country !== 'CA' ||
      data.payoutDestination.currency !== 'CAD' || data.payoutDestination.payoutMethod !== 'standard' ||
      intent.transferKey !== `tr_${debitRef.id}` || intent.payoutKey !== `po_${debitRef.id}` ||
      debit?.type !== 'withdrawal' || debit.amount !== input.amount || debit.currency !== 'CAD' ||
      debit.withdrawalRequestId !== ref.id || debit.clientRequestId !== input.requestId ||
      debit.withdrawalIntentHash !== intent.payloadHash || !(debit.createdAt instanceof Timestamp) ||
      !Number.isSafeInteger(debit.balanceAfter) || debit.balanceAfter < 0 ||
      !validWithdrawalSubmission(data, input) ||
      !['processing', 'completed', 'failed'].includes(data.status)) {
    throw new HttpsError('unavailable', 'Le reçu de ce retrait doit être rapproché. Les fonds restent réservés.',
      { reason: 'withdrawal_receipt_unqualified', requestId: input.requestId, withdrawalRequestId: ref.id,
        action: 'contactSupport', retryPermissionGranted: false });
  }
  const transferId = typeof data.stripeTransferId === 'string' && /^tr_[A-Za-z0-9_]+$/.test(data.stripeTransferId) ? data.stripeTransferId : null;
  const payoutId = typeof data.stripePayoutId === 'string' && /^po_[A-Za-z0-9_]+$/.test(data.stripePayoutId) ? data.stripePayoutId : null;
  const recovery = data.payoutRecovery;
  const compensation = recovery?.state === 'recovered' && typeof recovery.compensationLedgerId === 'string' &&
    /^[A-Za-z0-9_-]{1,200}$/.test(recovery.compensationLedgerId)
    ? (await tx.get(db.collection('wallets').doc(input.userId).collection('ledger').doc(recovery.compensationLedgerId))).data() : null;
  const recovered = recovery?.schemaVersion === 1 && recovery.state === 'recovered' && recovery.requestId === ref.id &&
    recovery.ownerId === input.userId && recovery.amountCents === input.amount && recovery.currency === 'CAD' &&
    recovery.accountId === intent.accountId && recovery.debitLedgerId === debitRef.id && recovery.transferId === transferId &&
    recovery.payoutId === payoutId && !!transferId && !!payoutId && recovery.compensatedAt instanceof Timestamp &&
    /^trr_[A-Za-z0-9_]+$/.test(recovery.reversalId ?? '') && /^txn_[A-Za-z0-9_]+$/.test(recovery.returnBalanceTransactionId ?? '') &&
    compensation?.type === 'withdrawal_failed' && compensation.amount === input.amount && compensation.currency === 'CAD' &&
    compensation.withdrawalRequestId === ref.id && compensation.withdrawalDebitLedgerId === debitRef.id &&
    compensation.payoutId === payoutId && compensation.transferId === transferId && compensation.reversalId === recovery.reversalId &&
    compensation.returnBalanceTransactionId === recovery.returnBalanceTransactionId && compensation.createdAt instanceof Timestamp &&
    Number.isSafeInteger(compensation.balanceAfter) && compensation.balanceAfter >= 0;
  const completion = data.payoutCompletion;
  const completed = data.status === 'completed' && data.payoutOutcome === 'paid' && data.completedAt instanceof Timestamp &&
    !!transferId && !!payoutId && completion?.schemaVersion === 1 && completion.withdrawalRequestId === ref.id &&
    completion.ownerId === input.userId && completion.amountCents === input.amount && completion.currency === 'CAD' &&
    completion.accountId === intent.accountId && completion.bankAccountId === input.bankAccountId &&
    completion.payoutId === payoutId && completion.transferId === transferId && completion.debitLedgerId === debitRef.id &&
    completion.observedAt instanceof Timestamp;
  const outcomeUnknown = !completed && !recovered && (data.payoutOutcome === 'unknown' || data.transferOutcome === 'unknown');
  const actionRequired = data.reconciliationRequired === true || outcomeUnknown || data.payoutRecovery != null && !recovered ||
    data.status === 'completed' && !completed || data.status === 'failed' && !recovered;
  return {
    protocol: 'withdrawal_intent_v1' as const, requestId: input.requestId, ownerId: input.userId,
    withdrawalRequestId: ref.id, amountCents: input.amount, currency: 'CAD' as const, bankAccountId: input.bankAccountId,
    intentCommitted: true, debitCommitted: true, replay: true,
    success: !!transferId && !!payoutId && !actionRequired && data.status !== 'failed',
    newBalance: debit.balanceAfter, balanceSource: 'withdrawal_debit_receipt' as const, transferId, payoutId,
    status: data.status, operationState: actionRequired ? 'reconciliation_required' : recovered ? 'recovered' :
      completed ? 'completed' : data.status === 'failed' ? 'failed' : payoutId ? 'submitted' : 'reserved',
    completedReceiptQualified: completed, recoveryCommitted: recovered,
    recoveryLedgerId: recovered ? recovery.compensationLedgerId : null,
    recoveredAt: recovered ? recovery.compensatedAt.toDate().toISOString() : null,
    transferState: data.providerSubmission.transfer.state, payoutState: data.providerSubmission.payout.state,
    actionRequired, retryPermissionGranted: false,
    action: actionRequired ? 'contactSupport' : 'refreshWithdrawals',
    ownerMessage: typeof data.ownerMessage === 'string' ? data.ownerMessage : null,
  };
}

// =============================================================================
// HELPER — Get or auto-create seller wallet inside a transaction
// =============================================================================

/**
 * Reads the seller's wallet inside a Firestore transaction. If the wallet
 * does not exist, creates it automatically with zero balances.
 *
 * This ensures every seller gets a wallet on first sale — no manual
 * activation required on the seller side.
 *
 * MUST be called inside a runTransaction callback (tx parameter).
 */
export async function getOrCreateSellerWallet(
  tx: FirebaseFirestore.Transaction,
  sellerId: string
): Promise<{
  walletRef: FirebaseFirestore.DocumentReference;
  walletData: FirebaseFirestore.DocumentData;
  isNew: boolean;
}> {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
  const walletRef = db.collection('wallets').doc(sellerId);
  const walletSnap = await tx.get(walletRef);

  if (walletSnap.exists) {
    return { walletRef, walletData: walletSnap.data()!, isNew: false };
  }

  const newWallet = {
    balance: 0,
    pendingBalance: 0,
    heldBalance: 0,
    sellerDebt: 0,
    currency: 'cad',
    status: 'active',
    activatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await recoveryCommit({refs: [(walletRef).path]});
    tx.set(walletRef, Object.assign(newWallet, await financialRecoveryWalletFields(walletRef,walletSnap,newWallet)));

  return { walletRef, walletData: { ...newWallet, balance: 0, pendingBalance: 0 }, isNew: true };
}

// =============================================================================
// ACTIVATE WALLET — One-click wallet creation
// =============================================================================

/**
 * Creates a wallet for the authenticated user.
 * Idempotent: if wallet already exists, returns current state.
 *
 * No Stripe Customer creation, no forms — just a single button activation.
 */
export const activateWallet = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/wallet.activateWallet"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    const walletRef = db.collection('wallets').doc(userId);

    try {
      const result = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const walletSnap = await tx.get(walletRef);

        if (walletSnap.exists) {
          // Idempotent: return current state
          const data = walletSnap.data()!;
          return {
            success: true,
            balance: data.balance,
            pendingBalance: data.pendingBalance,
            status: data.status,
            alreadyExisted: true,
          };
        }

        await assertAccountOperationOpen(tx, userId);
        // Create new wallet
        await assertPrivateAccountSession(request, tx);
        await recoveryCommit({refs: [(walletRef).path]});
    tx.set(walletRef, await financialRecoveryWalletFields(walletRef,walletSnap,{
          balance: 0,
          pendingBalance: 0,
          heldBalance: 0,
          sellerDebt: 0,
          currency: 'cad',
          status: 'active',
          activatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },{}));

        return {
          success: true,
          balance: 0,
          pendingBalance: 0,
          status: 'active',
          alreadyExisted: false,
        };
      });

      logger.info('Wallet activated', {
        userId,
        alreadyExisted: result.alreadyExisted,
      });

      return {
        success: true,
        balance: result.balance,
        pendingBalance: result.pendingBalance,
        status: result.status,
      };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error activating wallet', { userId, error: message });
      throw new HttpsError('internal', `Failed to activate wallet: ${message}`);
    }
  }))
);

// =============================================================================
// GET WALLET INFO — Read wallet balance + recent ledger entries
// =============================================================================

/**
 * Returns wallet balance, pendingBalance, status, and last 20 ledger entries.
 * If no wallet exists, returns { hasWallet: false }.
 */
export const getWalletInfo = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/wallet.getWalletInfo"}, async () => {
  return withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    assertExpectedBankActor(userId, request.data, true);
    if (request.data?.mode === 'withdrawal_timing_observe') return readOwnerWithdrawalTiming(userId, request.data, tx => assertPrivateAccountSession(request, tx));
    if (request.data?.mode === 'swap_hold_review') return readParticipantSwapHoldReview(userId, request.data, tx => assertPrivateAccountSession(request, tx));
    if (request.data?.mode === 'hold_reviews') return readSellerHoldReviews(userId, request.data, tx => assertPrivateAccountSession(request, tx));
    if (request.data?.mode === 'history') {
      return readWalletHistoryPage(userId, request.data, async (tx, id, data) => {
        // A pre-debit refusal has its own native tuple and no withdrawalIntent.
        // The shared reader still qualifies its private proof and absent debit.
        const intent = data.withdrawalIntent ?? data.withdrawalNonExecution;
        if (intent?.withdrawalRequestId !== id || intent.ownerId !== userId ||
            typeof intent.clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(intent.clientRequestId) ||
            typeof intent.bankAccountId !== 'string' || !/^ba_[A-Za-z0-9_]{1,190}$/.test(intent.bankAccountId) ||
            !Number.isSafeInteger(data.amount) || data.amount <= 0) return null;
        return readWithdrawalReceipt(tx, { userId, requestId: intent.clientRequestId,
          amount: data.amount, bankAccountId: intent.bankAccountId, mode: 'observe' });
      }, tx => assertPrivateAccountSession(request, tx));
    }
    if (request.data?.mode !== undefined && request.data.mode !== 'summary') throw new HttpsError('invalid-argument', 'Mode de lecture invalide.');

    try {
      const walletRef = db.collection('wallets').doc(userId);
      const ownerView = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
        const walletSnap = await tx.get(walletRef);
        if (!walletSnap.exists) return {walletSnap, ledgerSnap: null, financialReview: null};
        const ledgerSnap = await tx.get(walletRef.collection('ledger').orderBy('createdAt', 'desc').limit(20));
        const financialReview = await readWalletFinancialReview(tx, userId, 'withdrawal', walletSnap.data());
        return {walletSnap, ledgerSnap, financialReview};
      });
      const walletSnap = ownerView.walletSnap;

      if (!walletSnap.exists) {
        return { hasWallet: false };
      }

      const walletData = walletSnap.data()!;

      // Fetch last 20 ledger entries
      const ledgerSnap = ownerView.ledgerSnap!;

      const ledgerEntries = ledgerSnap.docs.map((doc) => {
        const data = doc.data();
        const cents = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
        const reference = (value: unknown): string | null => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;
        const debtRecordedCents = cents(Object.prototype.hasOwnProperty.call(data, 'debtRecorded') ? data.debtRecorded : 0);
        const transactionId = reference(data.transactionId), refundIntentId = reference(data.refundIntentId), disputeId = reference(data.disputeId);
        const debtAttributionQualified = debtRecordedCents === 0 || data.type === 'refund_debit' && transactionId !== null &&
          (refundIntentId !== null || disputeId !== null);
        const financialQualification = cents(data.amount) !== null && cents(data.balanceAfter) !== null && data.createdAt instanceof Timestamp &&
          debtRecordedCents !== null && debtAttributionQualified && (data.type !== 'debt_repayment' || transactionId !== null)
          ? 'qualified' as const : 'review_required' as const;
        return {
          id: doc.id,
          type: data.type,
          amount: data.amount,
          balanceAfter: data.balanceAfter,
          description: data.description,
          transactionId, refundIntentId, disputeId, debtRecordedCents, financialQualification,
          amountMeaning: data.type === 'debt_repayment' ? 'debt_allocation' as const : 'wallet_movement' as const,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        };
      });
      const debtHistoryQualified = ledgerEntries.every(entry => entry.financialQualification === 'qualified');
      const sumCents = (values: number[]) => {
        const sum = values.reduce((total, value) => total + value, 0);
        return Number.isSafeInteger(sum) ? sum : null;
      };
      const sellerDebtCents = ownerView.financialReview!.sellerDebtCents;
      const sellerDebtReview = {protocol: 'wallet_debt_review_v1' as const, ownerId: userId, sellerDebtCents,
        status: sellerDebtCents !== null && debtHistoryQualified ? 'qualified' as const : 'review_required' as const,
        historyComplete: false as const, historyScope: 'recent_20_entries' as const, ledgerLimit: 20 as const,
        reason: 'attribution_history_incomplete' as const,
        recordedDebtCentsInView: debtHistoryQualified ? sumCents(ledgerEntries.map(entry => entry.debtRecordedCents!)) : null,
        repaidDebtCentsInView: debtHistoryQualified ? sumCents(ledgerEntries.filter(entry => entry.type === 'debt_repayment').map(entry => entry.amount)) : null};

      // This existing owner query is a bounded delivered-order view. It never
      // proves global availability or absence of a correction on completed
      // history. Read it even without held funds so encountered reviews remain
      // visible; qualify estimates with the release path's central guards.
      const releaseView = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
        const heldSnap = await tx.get(db.collection('transactions').where('sellerId', '==', userId)
          .where('status', '==', 'delivered').limit(100));
        const iso = (value: unknown): string | null => value instanceof Timestamp ? value.toDate().toISOString() : null;
        let minReleaseMs: number | null = null, blockedOrderCount = 0, qualifiedCandidateCount = 0;
        const deliveryCorrections: {transactionId: string; correctionId: string | null;
          state: 'release_suspended' | 'released_review_required' | 'resolved' | 'unqualified_marker'; blocked: boolean;
          resolutionReceiptQualified: boolean; message: string; action: 'contactSupport'; detectedAt: string | null;
          originalDeliveryAt: string | null; originalFundsReleaseAt: string | null; originalFundsReleasedAt: string | null}[] = [];
        for (const doc of heldSnap.docs) {
          const sale = doc.data(), correction = sale.deliveryCorrection;
          const correctionBlocked = deliveryCorrectionBlocksProgress(sale);
          const markerPresent = Object.prototype.hasOwnProperty.call(sale, 'deliveryCorrection');
          if (markerPresent || sale.deliveryCorrectionBlocked === true) {
            const bound = correction?.schemaVersion === 1 && correction.transactionId === doc.id && correction.sellerId === userId &&
              correction.buyerId === sale.buyerId && typeof correction.correctionId === 'string' && /^[a-f0-9]{64}$/.test(correction.correctionId) &&
              correction.detectedAt instanceof Timestamp && correction.originalDeliveryAt instanceof Timestamp;
            const state = bound && ['release_suspended', 'released_review_required', 'resolved'].includes(correction.state)
              ? correction.state as 'release_suspended' | 'released_review_required' | 'resolved' : 'unqualified_marker';
            const message = typeof sale.deliveryCorrectionOwnerMessage === 'string' && sale.deliveryCorrectionOwnerMessage.trim()
              ? sale.deliveryCorrectionOwnerMessage.slice(0, 500) : bound && typeof correction.ownerMessage === 'string' && correction.ownerMessage.trim()
                ? correction.ownerMessage.slice(0, 500) : 'Le suivi et le gel de cette commande doivent être vérifiés par notre équipe.';
            deliveryCorrections.push({transactionId: doc.id, correctionId: bound ? correction.correctionId : null, state,
              blocked: correctionBlocked || sale.deliveryCorrectionBlocked === true, resolutionReceiptQualified: markerPresent && !correctionBlocked,
              message, action: 'contactSupport', detectedAt: bound ? iso(correction.detectedAt) : null,
              originalDeliveryAt: bound ? iso(correction.originalDeliveryAt) : null, originalFundsReleaseAt: bound ? iso(correction.originalFundsReleaseAt) : null,
              originalFundsReleasedAt: bound ? iso(correction.originalFundsReleasedAt) : null});
          }
          const negotiated = sale.purchaseRefundCaseDisposition != null ? await readPurchaseRefundReleaseContext(tx, doc.id, sale) : null;
          const blocked = Object.prototype.hasOwnProperty.call(sale, 'purchaseRefundCaseDisposition') && !negotiated ||
            correctionBlocked || sale.deliveryCorrectionBlocked === true || sale.disputed === true || hasUnsettledReturnRequest(sale) && negotiated?.returnFinanciallySettled !== true ||
            hasActiveBankDispute(sale) || hasUnsettledRefund(sale) || sale.labelReconciliationRequired === true || !purchasePolicyAllowsRelease(sale, doc.id, await productRoutingAllowsRelease(tx, doc.id, sale), await productMixedOrderAllowsRelease(tx, doc.id, sale));
          if (blocked) { blockedOrderCount++; continue; }
          if (sale.fundsReleasedAt) continue;
          const releaseAt = effectivePurchaseReleaseAt(sale, doc.id);
          if (!releaseAt || !await accountRelationshipAllowsRelease(tx, {kind:'purchase',id:doc.id}, sale.buyerId, sale.sellerId) || !await fraudReviewAllowsProgress(tx, doc.id, sale, doc) ||
              !await orderModerationAllowsProgress(tx, sale)) { blockedOrderCount++; continue; }
          if (Object.prototype.hasOwnProperty.call(sale, 'refundAllocationState')) {
            try {await readSellerAllocationConsumption(tx, doc.id, sale);} catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure;blockedOrderCount++; continue;}
          }
          const ms = releaseAt.toMillis();
          if (!Number.isSafeInteger(ms) || ms < 0) { blockedOrderCount++; continue; }
          qualifiedCandidateCount++;
          if (minReleaseMs === null || ms < minReleaseMs) minReleaseMs = ms;
        }
        const truncated = heldSnap.size === 100;
        const canEstimate = Number.isSafeInteger(walletData.heldBalance) && walletData.heldBalance > 0 && !truncated && blockedOrderCount === 0 && minReleaseMs !== null;
        return {heldReleaseAt: canEstimate ? new Date(minReleaseMs!).toISOString() : null,
          review: {protocol: 'wallet_order_review_v1' as const, scope: 'seller_delivered_orders' as const, limit: 100,
            inspectedCount: heldSnap.size, truncated, globalCoverage: false as const, blockedOrderCount, qualifiedCandidateCount, deliveryCorrections}};
      });

      return {
        hasWallet: true,
        balance: walletData.balance,
        pendingBalance: walletData.pendingBalance,
        // 3-bucket model: heldBalance = livré, dans la fenêtre de protection 7j
        // (non retirable) ; sellerDebt = dû après litige perdu/refund insuffisant
        // (bloque les retraits). Exposés pour l'UI porte-monnaie.
        heldBalance: walletData.heldBalance ?? 0,
        sellerDebt: walletData.sellerDebt ?? 0,
        walletFinancialReview: ownerView.financialReview,
        sellerDebtReview,
        // Conditional estimate for this bounded scope, never withdrawal permission.
        heldReleaseAt: releaseView.heldReleaseAt,
        walletOrderReview: releaseView.review,
        currency: walletData.currency,
        status: walletData.status,
        activatedAt: walletData.activatedAt?.toDate?.()?.toISOString() || null,
        updatedAt: walletData.updatedAt?.toDate?.()?.toISOString() || null,
        ledger: ledgerEntries,
      };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting wallet info', { userId, error: message });
      throw new HttpsError('internal', `Failed to get wallet info: ${message}`);
    }

  });

    });
  }
);

// =============================================================================
// WALLET WITHDRAW — Transfer funds from wallet to bank via Stripe
// =============================================================================

/**
 * Withdraws funds from the user's wallet to their bank account via Stripe.
 *
 * Flow:
 * 1. Validate inputs (standard min 1000 cents; explicit paused-closure full balance 1..999 cents)
 * 2. Qualify the current Connect payout capacity and declared bank destination
 * 3. Atomically debit wallet balance via runTransaction
 * 4. Create Stripe transfer (platform -> Connect account)
 * 5. Create Stripe payout (Connect account -> bank)
 * 6. Record ledger entry
 *
 * Provider submission is witnessed BEFORE each POST. Any unqualified outcome
 * keeps funds reserved until reconciliation of this same native intention.
 */
export const walletWithdraw = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => withFinancialRecoveryScope({operation: "callable/wallet.walletWithdraw"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    const input = withdrawalInput(request.auth.uid, request.data);
    // Historical observation and replay precede every NEW-operation gate.
    // A changed bank, old authentication or flags OFF cannot hide the receipt.
    const readCurrentReceipt = () => db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      return readWithdrawalReceipt(tx, input);
    });
    const existing = await readCurrentReceipt();
    if (existing) return existing;
    if (input.mode === 'observe') {
      return { protocol: 'withdrawal_intent_v1', requestId: input.requestId, ownerId: input.userId,
        withdrawalRequestId: withdrawalReference(input).id, amountCents: input.amount, currency: 'CAD',
        bankAccountId: input.bankAccountId, intentCommitted: false, debitCommitted: false, replay: true,
        success: false, newBalance: null, balanceSource: 'unavailable', transferId: null, payoutId: null,
        status: 'unknown', operationState: 'unknown', actionRequired: true, retryPermissionGranted: false,
        completedReceiptQualified: false, recoveryCommitted: false, recoveryLedgerId: null, recoveredAt: null,
        transferState: 'unknown', payoutState: 'unknown',
        action: 'contactSupport', ownerMessage: 'Cette demande doit être retrouvée. Une absence de reçu ne permet pas de recommencer le retrait.' };
    }
    assertRecentAccountAuthentication(request.auth.token);
    const closureSettlement = parseSmallBalanceClosureRequest(request.data?.closureSettlement);
    if (closureSettlement) {
      if (input.amount >= STANDARD_WITHDRAWAL_MINIMUM_CENTS) throw new HttpsError('invalid-argument',
        'La restitution de fermeture est réservée au solde intégral inférieur à 10,00 $.');
      // This explicit servicing capability does not enable general payments.
      // The monetary source still passes the same L04 qualification at debit.
      await db.runTransaction(async tx => {
        await assertPrivateAccountSession(request, tx);
        const current = await assertAccountOperationOpen(tx, input.userId, true);
        assertRecentAccountAuthentication(request.auth!.token);
        assertSmallBalanceClosure(input.userId, current.profile?.accountClosure, closureSettlement);
        assertSmallBalanceClosureAmount((await tx.get(db.collection('wallets').doc(input.userId))).data(), input.amount);
      });
    } else {
      if (input.amount < STANDARD_WITHDRAWAL_MINIMUM_CENTS) throw new HttpsError('invalid-argument',
        'Le retrait habituel exige au moins 10,00 $. Utilisez la restitution liée à une fermeture mise en pause pour un petit solde.');
      assertNewPaymentsEnabled();
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'walletWithdraw',
      maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { amount, userId } = input;

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    // The provider account, capabilities and exact declared bank are current.
    // No cached charges flag or implicit Stripe default grants payout permission.
    await assertPrivateAccountSession(request);
    const bankQualification = await qualifyWithdrawalBank(userId, stripe);
    await assertPrivateAccountSession(request);
    const payoutDestination = bankQualification.destination;
    if (request.data?.expectedBankAccountId !== payoutDestination.bankAccountId) {
      throw new HttpsError('failed-precondition', 'La destination bancaire a changé. Actualisez avant de retirer.',
        { reason: 'bank_payout_destination_changed', action: 'getStripeAccountStatus' });
    }
    const stripeAccountId = payoutDestination.accountId;
    const walletRef = db.collection('wallets').doc(userId);

    // --- Dispute guard: refuse withdrawal while a FINANCIAL dispute is active ---
    // A seller with a transaction in 'disputed' status whose funds flowed through
    // the platform (chargeback / contested return) cannot cash out: the funds may
    // need to be clawed back. Funds in heldBalance/pendingBalance are already
    // non-withdrawable; this guard also freezes the rest of the balance.
    //
    // F10: a MEETUP no-show dispute is cash-in-hand — NO money flowed through the
    // platform, so there is nothing to claw back and nothing at stake on the
    // wallet. Such a dispute must NOT freeze ALL of a seller's withdrawals (a
    // free griefing vector: anyone could open a meetup tx + report no-show to
    // freeze the seller indefinitely). We exclude `deliveryType == 'meetup'` from
    // the global block; only disputes with real financial exposure freeze.
    // The owner summary and this mutation share the same targeted predicates.
    // The mutation re-reads all witnesses before any debit; cached DTOs grant no permission.

    try {
      // GET-only platform cash preflight immediately precedes a NEW commit.
      // It reserves no Stripe funds and cannot guarantee concurrent capacity.
      const platformCashObservation=await observePlatformCash(stripe,amount,stripeAccountId);
      await assertPrivateAccountSession(request);
      // Step 1: Atomically debit wallet + create withdrawal_requests doc
      const ledgerEntryRef = withdrawalDebitReference(input);
      const withdrawalRequestRef = withdrawalReference(input);
      const platformCashRef=withdrawalRequestRef.collection('private_preflight').doc('observation');
      const platformCashSourceHash=platformCashObservationHash(platformCashObservation);
      let newBalance: number;

      const concurrentReceipt = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        // Two identical callers serialize on this exact native intention.
        // The loser observes the first debit; it never issues another POST.
        const receipt = await readWithdrawalReceipt(tx, input);
        if (receipt) return receipt;
        const withdrawalSourceSnapshot = await tx.get(withdrawalRequestRef);
        const strayDebit = await tx.get(ledgerEntryRef);
        if (strayDebit.exists) throw new HttpsError('unavailable', 'Le reçu de ce retrait doit être rapproché.',
          { reason: 'withdrawal_orphan_debit', requestId: input.requestId, action: 'contactSupport', retryPermissionGranted: false });
        if((await tx.get(platformCashRef)).exists)throw new HttpsError('unavailable','La preuve préalable de ce retrait doit être rapprochée.',
          {reason:'withdrawal_preflight_orphan_proof',requestId:input.requestId,action:'contactSupport',retryPermissionGranted:false});
        const privateProof={protocol:'withdrawal_platform_cash_proof_v1',ownerId:userId,clientRequestId:input.requestId,withdrawalRequestId:withdrawalRequestRef.id,
          payloadHash:withdrawalIntentHash(input),observation:platformCashObservation,contentHash:platformCashSourceHash};
        if(platformCashObservation.qualification!=='available'){
          const at=Timestamp.now(),reason=platformCashObservation.reason;
          if(!reason)throw new HttpsError('unavailable','La vérification du disponible de la plateforme doit être rapprochée.');
          // Serialize refusal and debit on the SAME native request and ledger.
          // A competing committed financial receipt has already won above.
          const record={userId,amount,currency:'cad',status:'not_executed',createdAt:at,updatedAt:at,
            withdrawalNonExecution:{protocol:'withdrawal_non_execution_v1',ownerId:userId,clientRequestId:input.requestId,
              withdrawalRequestId:withdrawalRequestRef.id,payloadHash:withdrawalIntentHash(input),amountCents:amount,currency:'CAD',
              bankAccountId:input.bankAccountId,reason,recordedAt:at,platformCashSourceHash}};
          await assertPrivateAccountSession(request, tx);
          await recoveryCommit({refs: [(withdrawalRequestRef).path]});
    tx.create(withdrawalRequestRef,await financialRecoverySourceFields('withdrawal',withdrawalRequestRef,withdrawalSourceSnapshot,record));
          await recoveryCommit({refs: [(platformCashRef).path]});
    tx.create(platformCashRef,privateProof);
          return {protocol:'withdrawal_intent_v1' as const,requestId:input.requestId,ownerId:userId,withdrawalRequestId:withdrawalRequestRef.id,amountCents:amount,currency:'CAD' as const,
            bankAccountId:input.bankAccountId,intentCommitted:false,debitCommitted:false,replay:false,success:false,newBalance:null,balanceSource:'unavailable' as const,
            transferId:null,payoutId:null,status:'not_executed',operationState:'not_executed',completedReceiptQualified:false,recoveryCommitted:false,
            recoveryLedgerId:null,recoveredAt:null,transferState:'not_started',payoutState:'not_started',actionRequired:false,retryPermissionGranted:false,
            action:'contactSupport',ownerMessage:platformCashRefusalMessage(reason),nonExecutionReceiptQualified:true,
            nonExecutionReason:reason,nonExecutionRecordedAt:at.toDate().toISOString()};
        }
        const current = await assertAccountOperationOpen(tx, userId, true);
        assertRecentAccountAuthentication(request.auth!.token);
        assertBankOperationIdle(current.profile);
        if (current.user!.stripeAccountId !== stripeAccountId ||
            bankSelectionIdentity(current.profile?.selectedBank) !== bankQualification.selectionIdentity) {
          throw new HttpsError('failed-precondition', 'La destination bancaire a changé. Actualisez avant de retirer.',
            { reason: 'bank_payout_destination_changed', action: 'getStripeAccountStatus' });
        }
        const walletSnap = await tx.get(walletRef);
        if (!walletSnap.exists) {
          throw new HttpsError('not-found', 'Aucun porte-monnaie trouve');
        }
        const walletData = walletSnap.data()!;
        const closureSource = closureSettlement ? assertSmallBalanceClosure(userId, current.profile?.accountClosure, closureSettlement) : null;
        if (closureSettlement) assertSmallBalanceClosureAmount(walletData, amount);
        assertWalletFinancialReviewClear(await readWalletFinancialReview(tx, userId, 'withdrawal', walletData));

        if (!Number.isSafeInteger(walletData.balance) || walletData.balance < 0 ||
            !Number.isSafeInteger(walletData.sellerDebt ?? 0) || (walletData.sellerDebt ?? 0) < 0 ||
            String(walletData.currency).toUpperCase() !== 'CAD') {
          throw new HttpsError('failed-precondition', 'Le solde du porte-monnaie doit être vérifié avant un retrait.');
        }
        if (walletData.status !== 'active') {
          throw new HttpsError('failed-precondition', 'Le porte-monnaie n\'est pas actif');
        }
        // Block withdrawals while the seller carries a debt (e.g. lost dispute
        // where funds were already withdrawn). Only `balance` is withdrawable;
        // heldBalance/pendingBalance are never touched here.
        if ((walletData.sellerDebt || 0) > 0) {
          throw new HttpsError(
            'failed-precondition',
            'Votre compte présente un solde dû. Les retraits sont suspendus.'
          );
        }
        if (walletData.balance < amount) {
          throw new HttpsError('failed-precondition', 'Solde insuffisant');
        }

        newBalance = walletData.balance - amount;

        await assertPrivateAccountSession(request, tx);
        await recoveryCommit({refs: [db.collection('eligibility_profiles').doc(userId).path]});
        commitBankWithdrawalBarrier(tx, userId);
        await recoveryCommit({refs: [(platformCashRef).path]});
    tx.create(platformCashRef,privateProof);
        await recoveryCommit({refs: [(walletRef).path]});
    tx.update(walletRef, await financialRecoveryWalletFields(walletRef,walletData,{
          balance: FieldValue.increment(-amount),
          updatedAt: FieldValue.serverTimestamp(),
        },{balance: ((walletData)["balance"]??0) + (-amount)}));

        await recoveryCommit({refs: [(ledgerEntryRef).path]});
    tx.set(ledgerEntryRef, {
          type: 'withdrawal',
          amount,
          currency: 'CAD',
          balanceAfter: newBalance,
          description: `Retrait vers compte bancaire ****${payoutDestination.last4}`,
          withdrawalRequestId: withdrawalRequestRef.id,
          clientRequestId: input.requestId,
          withdrawalIntentHash: withdrawalIntentHash(input),
          createdAt: FieldValue.serverTimestamp(),
        });

        // Audit/tracking doc for the payout lifecycle (payout.paid/failed).
        await recoveryCommit({refs: [(withdrawalRequestRef).path]});
    tx.set(withdrawalRequestRef, await financialRecoverySourceFields('withdrawal',withdrawalRequestRef,withdrawalSourceSnapshot, {
          userId,
          amount,
          currency: 'cad',
          status: 'processing',
          ledgerEntryId: ledgerEntryRef.id,
          stripeAccountId,
          payoutDestination,
          ...(closureSource ? {closureSettlement:{...closureSource,amountCents:amount,currency:'CAD',fullAvailableBalance:true}} : {}),
          platformCashPreflight:{protocol:'platform_cash_preflight_v1',sourceHash:platformCashSourceHash},
          withdrawalIntent: { schemaVersion: 1, ownerId: userId, clientRequestId: input.requestId,
            withdrawalRequestId: withdrawalRequestRef.id, payloadHash: withdrawalIntentHash(input),
            amountCents: amount, currency: 'CAD', accountId: stripeAccountId, bankAccountId: input.bankAccountId,
            debitLedgerId: ledgerEntryRef.id, transferKey: `tr_${ledgerEntryRef.id}`, payoutKey: `po_${ledgerEntryRef.id}`,
            committedAt: FieldValue.serverTimestamp() },
          providerSubmission: { schemaVersion: 1, ownerId: userId, withdrawalRequestId: withdrawalRequestRef.id,
            payloadHash: withdrawalIntentHash(input), amountCents: amount, currency: 'CAD', accountId: stripeAccountId,
            bankAccountId: input.bankAccountId, debitLedgerId: ledgerEntryRef.id,
            transfer: { state: 'not_started', authorizedAt: null, observedAt: null, providerId: null },
            payout: { state: 'not_started', authorizedAt: null, observedAt: null, providerId: null } },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }));
        return null;
      });
      if (concurrentReceipt) return concurrentReceipt;

      // Analytics (§12): withdrawal_requested = ledger debited (the request is
      // now committed). distinct_id = seller. amount/balance already in CENTS.
      await captureServerEvent(userId, 'withdrawal_requested', {
        withdrawal_id: withdrawalRequestRef.id,
        seller_id: userId,
        amount_cents: amount,
        balance_after_cents: newBalance!,
        $insert_id: `withdrawal_requested_${withdrawalRequestRef.id}`,
      });

      // Step 2: Create Stripe transfer + payout
      let transfer: { id: string } | undefined;
      let payout: { id: string } | undefined;
      try {
        const qualifyCurrentDestination = async () => {
          await assertPrivateAccountSession(request);
          const current = await qualifyWithdrawalBank(userId, stripe);
          await assertPrivateAccountSession(request);
          if (current.selectionIdentity !== bankQualification.selectionIdentity ||
              current.destination.accountId !== stripeAccountId || current.destination.bankAccountId !== input.bankAccountId) {
            throw new HttpsError('failed-precondition', 'La destination native de ce retrait doit être rapprochée.',
              { reason: 'bank_payout_destination_changed', action: 'refreshWithdrawals' });
          }
        };
        const qualifyCurrentNativeDestination = async (tx: FirebaseFirestore.Transaction) => {
          await assertPrivateAccountSession(request, tx);
          const current = await assertAccountOperationOpen(tx, userId, true);
          assertBankOperationIdle(current.profile);
          if (closureSettlement) {
            const closureSource = assertSmallBalanceClosure(userId, current.profile?.accountClosure, closureSettlement);
            const native = (await tx.get(withdrawalRequestRef)).data()?.closureSettlement;
            if (!native || native.protocol!==closureSource.protocol || native.sourceHash!==closureSource.sourceHash ||
                native.requestedAt!==closureSource.requestedAt || native.amountCents!==amount || native.currency!=='CAD' ||
                native.fullAvailableBalance!==true) throw new HttpsError('failed-precondition',
              'La restitution engagée doit être rapprochée avant un nouvel envoi.',{reason:'small_balance_closure_intent_changed',action:'contactSupport'});
          }
          if (current.user!.stripeAccountId !== stripeAccountId ||
              bankSelectionIdentity(current.profile?.selectedBank) !== bankQualification.selectionIdentity) {
            throw new HttpsError('failed-precondition', 'La destination native de ce retrait doit être rapprochée.',
              { reason: 'bank_payout_destination_changed', action: 'refreshWithdrawals' });
          }
        };
        await qualifyCurrentDestination();
        // A durable authorization is committed before the provider can receive
        // this POST. Replays only observe; they never resume a submission.
        const transferAllowed = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          await qualifyCurrentNativeDestination(tx);
          const receipt = await readWithdrawalReceipt(tx, input);
          const current = (await tx.get(withdrawalRequestRef)).data();
          if (!receipt || !current || current.status !== 'processing' || current.reconciliationRequired === true ||
              current.payoutRecovery != null || current.providerSubmission.transfer.state !== 'not_started' ||
              current.providerSubmission.payout.state !== 'not_started' || current.stripeTransferId || current.stripePayoutId) {
            throw new Error('Withdrawal transfer authorization changed');
          }
          const review = await readWalletFinancialReview(tx, userId, 'withdrawal', undefined, withdrawalRequestRef.id);
          if (review.status !== 'clear') {
            await assertPrivateAccountSession(request, tx);
            await recoveryCommit({refs: [(withdrawalRequestRef).path]});
    tx.update(withdrawalRequestRef, await financialRecoverySourceFields('withdrawal',withdrawalRequestRef,current,{ reconciliationRequired: true, reconciliationReason: 'withdrawal_new_effect_review_required',
              ownerMessage: 'Une revue est requise avant la suite de ce retrait. Consultez le dossier ou contactez le support.',
              ownerAction: 'contactSupport', updatedAt: FieldValue.serverTimestamp() }));
            return false;
          }
          await assertPrivateAccountSession(request, tx);
          await recoveryCommit({refs: [db.collection('eligibility_profiles').doc(userId).path]});
          commitBankWithdrawalBarrier(tx, userId);
          await recoveryCommit({refs: [(withdrawalRequestRef).path]});
    tx.update(withdrawalRequestRef, await financialRecoverySourceFields('withdrawal',withdrawalRequestRef,current,{ 'providerSubmission.transfer.state': 'requested',
            'providerSubmission.transfer.authorizedAt': FieldValue.serverTimestamp(),
            transferOutcome: 'unknown', reconciliationRequired: true, reconciliationReason: 'withdrawal_submission_pending',
            ownerMessage: 'La demande de virement est en cours. Les fonds restent réservés.', ownerAction: 'refreshWithdrawals',
            updatedAt: FieldValue.serverTimestamp() }));
          return true;
        });
        if (!transferAllowed) {
          const receipt = await readCurrentReceipt();
          if (!receipt) throw new Error('Withdrawal reserved receipt missing');
          return {...receipt, replay: false};
        }
        await assertPrivateAccountSession(request);
        const transferResponse = await stripe.transfers.create(
          {
            amount,
            currency: 'cad',
            destination: stripeAccountId,
            metadata: {
              firebaseUserId: userId,
              walletWithdrawal: 'true',
              withdrawalRequestId: withdrawalRequestRef.id,
            },
          },
          // Deterministic key tied to the (stable) ledger entry id so a retry
          // never moves the same withdrawal twice.
          { idempotencyKey: `tr_${ledgerEntryRef.id}` }
        );
        const responseDestination = typeof transferResponse.destination === 'string' ? transferResponse.destination : transferResponse.destination?.id;
        if (transferResponse.object !== 'transfer' || !/^tr_[A-Za-z0-9_]+$/.test(transferResponse.id) ||
            transferResponse.amount !== amount || transferResponse.currency !== 'cad' || responseDestination !== stripeAccountId ||
            transferResponse.metadata?.firebaseUserId !== userId || transferResponse.metadata?.withdrawalRequestId !== withdrawalRequestRef.id) {
          throw new Error('Withdrawal transfer response unqualified');
        }
        transfer = { id: transferResponse.id };

        // Bind the qualified transfer and authorize the payout atomically.
        // A crash before this commit cannot silently authorize a payout.
        await qualifyCurrentDestination();
        const payoutAllowed = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          await qualifyCurrentNativeDestination(tx);
          const receipt = await readWithdrawalReceipt(tx, input);
          const current = (await tx.get(withdrawalRequestRef)).data();
          if (!receipt || !current || current.status !== 'processing' || current.payoutRecovery != null ||
              current.reconciliationReason !== 'withdrawal_submission_pending' ||
              current.providerSubmission.transfer.state !== 'requested' || current.providerSubmission.payout.state !== 'not_started' ||
              current.stripeTransferId || current.stripePayoutId) throw new Error('Withdrawal payout authorization changed');
          const review = await readWalletFinancialReview(tx, userId, 'withdrawal', undefined, withdrawalRequestRef.id);
          // The real qualified transfer is committed even when a NEW payout
          // is denied. No reversal or local compensation follows this guard.
          await assertPrivateAccountSession(request, tx);
          await recoveryCommit({refs: [db.collection('eligibility_profiles').doc(userId).path]});
          commitBankWithdrawalBarrier(tx, userId);
          await recoveryCommit({refs: [(withdrawalRequestRef).path]});
    tx.update(withdrawalRequestRef, await financialRecoverySourceFields('withdrawal',withdrawalRequestRef,current,{ stripeTransferId: transfer!.id, transferOutcome: 'created',
            'providerSubmission.transfer.state': 'created', 'providerSubmission.transfer.providerId': transfer!.id,
            'providerSubmission.transfer.observedAt': FieldValue.serverTimestamp(),
            ...(review.status === 'clear' ? {payoutOutcome: 'unknown',
              'providerSubmission.payout.state': 'requested', 'providerSubmission.payout.authorizedAt': FieldValue.serverTimestamp()} : {
              reconciliationRequired: true, reconciliationReason: 'withdrawal_new_effect_review_required',
              ownerMessage: 'Le transfert est enregistré. Une revue est requise avant une nouvelle demande de virement bancaire.', ownerAction: 'contactSupport'}),
            updatedAt: FieldValue.serverTimestamp() }));
          return review.status === 'clear';
        });
        if (!payoutAllowed) {
          const receipt = await readCurrentReceipt();
          if (!receipt) throw new Error('Withdrawal transfer receipt missing');
          return {...receipt, replay: false};
        }
        await assertPrivateAccountSession(request);
        const payoutResponse = await stripe.payouts.create(
          {
            amount,
            currency: 'cad',
            destination: payoutDestination.bankAccountId,
            method: 'standard',
            metadata: {
              firebaseUserId: userId,
              walletWithdrawal: 'true',
              // Matched by handlePayoutFailed/handlePayoutPaid to close out the
              // withdrawal_requests doc asynchronously.
              withdrawalRequestId: withdrawalRequestRef.id,
            },
          },
          // stripe-node v22 takes a SINGLE RequestOptions object: both the
          // Connect account selection (stripeAccount) and the deterministic
          // idempotencyKey live here. Tied to the stable ledger entry id so a
          // retry never pays out the same withdrawal twice.
          { stripeAccount: stripeAccountId, idempotencyKey: `po_${ledgerEntryRef.id}` }
        );
        // Qualify the returned provider object against the actual committed
        // request, including its native creation time and frozen destination.
        const payoutSource = (await withdrawalRequestRef.get()).data();
        if (!payoutSource || !matchesWithdrawalPayout(withdrawalRequestRef.id, payoutSource, payoutResponse) ||
            !['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(payoutResponse.status)) {
          throw new Error('Withdrawal payout response unqualified');
        }
        payout = { id: payoutResponse.id };

        // A webhook may have already completed the same payout. Preserve its
        // lifecycle and every unrelated freeze rather than overwriting status.
        await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          const receipt = await readWithdrawalReceipt(tx, input);
          const current = (await tx.get(withdrawalRequestRef)).data();
          if (!receipt || !current || current.stripeTransferId !== transfer!.id ||
              current.providerSubmission.transfer.state !== 'created' ||
              !matchesWithdrawalPayout(withdrawalRequestRef.id, current, payoutResponse)) throw new Error('Withdrawal payout commit changed');
          if (current.providerSubmission.payout.state === 'created' && current.providerSubmission.payout.providerId === payout!.id) return;
          // A qualified current-provider outcome supersedes the POST response,
          // which may be older than a failed/recovered or paid observation.
          if (receipt.completedReceiptQualified || receipt.recoveryCommitted) return;
          if (current.providerSubmission.payout.state !== 'requested') throw new Error('Withdrawal payout phase changed');
          const submissionOnly = current.reconciliationReason === 'withdrawal_submission_pending' && current.payoutRecovery == null &&
            !['failed', 'canceled'].includes(payoutResponse.status);
          await recoveryCommit({refs: [(withdrawalRequestRef).path]});
    tx.update(withdrawalRequestRef, await financialRecoverySourceFields('withdrawal',withdrawalRequestRef,current,{ stripePayoutId: payout!.id,
            'providerSubmission.payout.state': 'created', 'providerSubmission.payout.providerId': payout!.id,
            'providerSubmission.payout.observedAt': FieldValue.serverTimestamp(),
            ...(current.status === 'processing' && current.payoutRecovery == null ? { payoutOutcome: payoutResponse.status } : {}),
            ...(submissionOnly ? { reconciliationRequired: false, reconciliationReason: FieldValue.delete(),
              ownerMessage: 'Le virement a été soumis à la banque. Son arrivée reste à confirmer.', ownerAction: 'refreshWithdrawals' } : {}),
            updatedAt: FieldValue.serverTimestamp() }));
        });

        logger.info('Wallet withdrawal initiated', {
          userId,
          amount,
          transferId: transfer.id,
          payoutId: payout.id,
          withdrawalRequestId: withdrawalRequestRef.id,
        });

        const receipt = await readCurrentReceipt();
        if (!receipt) throw new Error('Committed withdrawal receipt missing');
        return { ...receipt, replay: false };
      } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure;
        // Even a synchronous exception cannot attest that money never moved.
        // Preserve the native phase and any qualified response, then require
        // exact provider/local reconciliation before compensation or a new IO.
        const observed = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          const receipt = await readWithdrawalReceipt(tx, input);
          const current = (await tx.get(withdrawalRequestRef)).data();
          if (!current || current.withdrawalIntent?.payloadHash !== withdrawalIntentHash(input) ||
              !validWithdrawalSubmission(current, input)) throw new Error('Withdrawal unknown source unqualified');
          // This check and the uncertainty write share one transaction. A paid
          // or recovered receipt arriving meanwhile makes Firestore retry the
          // read; a late HTTP catch cannot re-freeze that qualified outcome.
          if (receipt && (receipt.completedReceiptQualified || receipt.recoveryCommitted ||
              current.providerSubmission.payout.state === 'created' && !!receipt.transferId && !!receipt.payoutId)) return receipt;
          const operationRef = db.collection('failed_operations').doc('withdrawal_' + createHash('sha256')
            .update(withdrawalRequestRef.id).digest('hex'));
          const priorOperation = (await tx.get(operationRef)).data();
          const changes: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
          if (current.providerSubmission.transfer.state === 'requested') {
            changes['providerSubmission.transfer.state'] = 'unknown'; changes.transferOutcome = 'unknown';
          }
          if (current.providerSubmission.payout.state === 'requested') {
            changes['providerSubmission.payout.state'] = 'unknown'; changes.payoutOutcome = 'unknown';
          }
          // An observed response is evidence, never permission to adopt an ID
          // onto an unrelated financial lifecycle or initiate another payout.
          changes.submissionObservation = { schemaVersion: 1, payloadHash: withdrawalIntentHash(input),
            transferId: transfer?.id ?? null, payoutId: payout?.id ?? null, observedAt: FieldValue.serverTimestamp() };
          changes.reconciliationRequired = true;
          // Preserve an independent financial fence and its operator reason.
          if (!current.reconciliationRequired || ['withdrawal_submission_pending', 'withdrawal_submission_unknown'].includes(current.reconciliationReason)) {
            changes.reconciliationReason = 'withdrawal_submission_unknown';
          }
          changes.ownerMessage = 'Ce retrait doit être vérifié. Les fonds restent réservés.';
          changes.ownerAction = 'contactSupport';
          await recoveryCommit({refs: [(withdrawalRequestRef).path]});
    tx.update(withdrawalRequestRef, await financialRecoverySourceFields('withdrawal',withdrawalRequestRef,current,changes));
          await recoveryCommit({refs: [(operationRef).path]});
    tx.set(operationRef, { type: 'payout_reversal_failed', refId: withdrawalRequestRef.id,
            payload: { kind: 'payout_identity_reconciliation', evidence: { payloadHash: withdrawalIntentHash(input),
              transferId: transfer?.id ?? null, payoutId: payout?.id ?? null } }, actionRequired: true,
            status: 'pending', attempts: priorOperation?.attempts ?? 0, lastTriedAt: priorOperation?.lastTriedAt ?? null,
            error: 'withdrawal_submission_unknown', createdAt: priorOperation?.createdAt ?? FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          return null;
        });
        if (observed) return { ...observed, replay: false };
        logger.error('Wallet withdrawal outcome unknown — reconciliation required', {
          withdrawalRequestId: withdrawalRequestRef.id, transferId: transfer?.id ?? null, payoutId: payout?.id ?? null,
        });
        const receipt = await readCurrentReceipt();
        if (!receipt) throw new HttpsError('unavailable', 'Le retrait est en cours de vérification. Les fonds restent réservés.');
        return { ...receipt, replay: false };
      }
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      logger.error('Error in walletWithdraw', { userId });
      throw new HttpsError('internal', 'Le retrait ne peut pas être vérifié actuellement. Contactez notre équipe.');
    }
  }))
);

// =============================================================================
// PAY WITH WALLET — 100% wallet payment (no Stripe charge)
// =============================================================================

/**
 * Pays for a transaction entirely from the buyer's wallet.
 * No PaymentIntent, no Stripe charge — pure Firestore transaction.
 *
 * Flow:
 * 1. Read transaction doc — verify status pending_payment, get amounts
 * 2. Read buyer's wallet — verify balance >= totalAmount
 * 3. Debit buyer's wallet
 * 4. If seller has wallet: increment seller's pendingBalance
 * 5. Mark transaction as paid with paidVia: 'wallet'
 * 6. Mark article as sold
 * 7. Create buyer ledger entry
 */
export const payWithWallet = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'] },
  async (request) => withFinancialRecoveryScope({operation: "callable/wallet.payWithWallet"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'payWithWallet',
      maxCallsAuthenticated: 10,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId } = request.data ?? {};

    if (typeof transactionId !== 'string' || transactionId.length === 0 || transactionId.length > 200 || transactionId.includes('/')) {
      assertNewPaymentsEnabled();
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const buyerId = request.auth.uid;

    try {
      const txRef = db.collection('transactions').doc(transactionId);
      // Load new-acquisition admission only for this endpoint. Other wallet /
      // already-paid fulfillment entrypoints retain their existing dependencies.
      const { commitWalletPurchase } = await import('../utils/walletPurchase');
      const result = await commitWalletPurchase(buyerId, transactionId, tx => assertPrivateAccountSession(request, tx));
      if (result.replay) return result;

      // Analytics (§12): 100% wallet payment — no Payment Sheet. order_paid
      // follows the BUYER (payment_method=wallet), sale_paid mirrors on the
      // SELLER. $insert_id shared with the webhook path so a tx can never be
      // double-counted across rails.
      {
        const serviceFeeCents = Math.round((result.serviceFee ?? 0) * 100);
        await captureServerEvent(buyerId, 'order_paid', {
          transaction_id: transactionId,
          article_id: result.articleId,
          buyer_id: buyerId,
          seller_id: result.sellerId ?? null,
          item_amount_cents: Math.round((result.itemAmount ?? 0) * 100),
          shipping_cents: Math.round((result.shippingCost ?? 0) * 100),
          service_fee_cents: serviceFeeCents,
          tax_cents: Math.round((result.taxTotal ?? 0) * 100),
          buyer_total_cents: result.totalAmountCents,
          application_fee_cents: serviceFeeCents,
          wallet_amount_cents: result.totalAmountCents,
          card_amount_cents: 0,
          payment_method: 'wallet',
          delivery_type: result.deliveryType ?? null,
          $insert_id: transactionId,
        });
        if (result.sellerId) {
          await captureServerEvent(result.sellerId, 'sale_paid', {
            transaction_id: transactionId,
            article_id: result.articleId,
            seller_id: result.sellerId,
            buyer_id: buyerId,
            item_amount_cents: Math.round((result.itemAmount ?? 0) * 100),
            seller_net_cents: Math.round((result.sellerPayout ?? 0) * 100),
            delivery_type: result.deliveryType ?? null,
            $insert_id: `sale_${transactionId}`,
          });
        }
      }

      // =====================================================================
      // SHIPPING LABEL (for shipping transactions — mirrors webhook logic)
      // =====================================================================

      if (result.deliveryType === 'shipping') {
        const rateId = result.shipEngineRateId;

        // Guard: reject fallback rateIds generated by the client. The seller is
        // NOT credited (deferred above) and the transaction stays 'paid' for the
        // sweep job to re-rate + retry.
        if (rateId && rateId.startsWith('fallback_')) {
          logger.warn('payWithWallet: fallback rateId detected — deferring to sweepPendingLabels', {
            transactionId,
            rateId,
          });
          await writeFinancialRecoveryPurchaseDiagnostic(db, txRef, {
            labelCreationPending: true,
            labelCreationNote: `Fallback rateId "${rateId}" — re-rate + retry required`,
          });
        } else {
          const shipEngine = getShipEngine();
          if (shipEngine && rateId) {
            // F5/F82: idempotent, double-spend-safe label creation. The helper
            // reserves the tx (atomic) BEFORE the paid ShipEngine call, so a
            // function timeout / retry / concurrent sweep can never create a 2nd
            // label; on success it credits the seller + persists the label fields
            // ('label_created') atomically. Mirrors the webhook + sweep paths so
            // the wallet shipping rail is no longer the only non-idempotent one
            // (B1). On failure it flags labelCreationPending for sweepPendingLabels.
            const outcome = await createLabelIdempotent({
              transactionRef: txRef,
              transactionId,
              rateId,
              shipEngine,
              estimatedShippingCost: result.shippingCost,
            });

            if (outcome === 'created' || outcome === 'skip') {
              const fresh = (await txRef.get()).data();
              const trackingNumber = fresh?.trackingNumber || '';
              const labelUrl = fresh?.shippingLabelUrl || '';
              const trackingUrl = fresh?.trackingUrl || '';

              logger.info('payWithWallet: label creation outcome', {
                transactionId,
                outcome,
                trackingNumber,
              });

              // Send system message with tracking info (only when we have a label).
              if (result.chatId && trackingNumber) {
                let participants: string[] = [];
                try {
                  const chatSnap = await db.collection('chats').doc(result.chatId).get();
                  if (chatSnap.exists) {
                    participants = (chatSnap.data()?.participants as string[]) || [];
                  }
                } catch (lookupErr) {
      if (lookupErr instanceof FinancialRecoveryBlocked) throw lookupErr;
                  logger.warn('payWithWallet: Could not load chat participants', {
                    chatId: result.chatId,
                    error: lookupErr instanceof Error ? lookupErr.message : lookupErr,
                  });
                }

                await db.collection('messages').add({
                  chatId: result.chatId,
                  senderId: 'system',
                  receiverId: 'system',
                  type: 'system',
                  content: `Paiement confirme !\n\nNumero de suivi: ${trackingNumber}\nEtiquette: disponible dans les details de la commande.\n\nLe vendeur peut maintenant expedier l'article.`,
                  participants,
                  timestamp: FieldValue.serverTimestamp(),
                  status: 'sent',
                  isRead: true,
                  shippingLabel: {
                    labelUrl,
                    trackingNumber,
                    trackingUrl,
                  },
                });
              }
            } else {
              // 'failed': the reservation was cleared (createLabel error) — defer
              // to sweepPendingLabels which re-rates + retries. The seller is NOT
              // credited (deferred-credit model); labelCreationPending makes the
              // gelée tx VISIBLE to the sweep (it filters labelCreationPending==true
              // && status=='paid'), closing the orphan-label/frozen-order window.
              logger.error('payWithWallet: label creation failed (will retry via sweep)', {
                transactionId,
              });
              await writeFinancialRecoveryPurchaseDiagnostic(db, txRef, {
                labelCreationPending: true,
                labelCreationNote: 'ShipEngine createLabel failed — re-rate + retry required',
              }).catch((err) => { if (err instanceof FinancialRecoveryBlocked) throw err;
                logger.error('payWithWallet: Failed to flag labelCreationPending', {
                  transactionId,
                  error: err instanceof Error ? err.message : err,
                });
              });
            }
          } else if (!rateId) {
            logger.warn('payWithWallet: no shipEngineRateId on shipping transaction', {
              transactionId,
            });
            await writeFinancialRecoveryPurchaseDiagnostic(db, txRef, {
              labelCreationPending: true,
              labelCreationNote: 'No shipEngineRateId — label must be created manually',
            });
          }
        }
      }

      logger.info('Wallet payment completed', {
        transactionId,
        buyerId,
        newBalance: result.newBalance,
      });

      const currentOrder = (await txRef.get()).data();
      return {
        success: true,
        newBalance: result.newBalance,
        replay: false,
        paymentCommitted: true,
        paymentPermissionGranted: false,
        currentStatus: typeof currentOrder?.status === 'string' ? currentOrder.status : 'unavailable',
        transactionId,
        balanceSource: 'committed_wallet',
      };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) {
        const details = error.details as { reason?: unknown } | null;
        logger.info('payWithWallet refused or requires review', { buyerId, transactionId, code: error.code,
          reason: typeof details?.reason === 'string' ? details.reason : 'wallet_payment_refused' });
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error in payWithWallet', { buyerId, transactionId, error: message });
      throw new HttpsError('internal', `Failed to pay with wallet: ${message}`);
    }
  }))
);

// =============================================================================
// REFUND WALLET PAYMENT — Refund a 100% wallet transaction
// =============================================================================

/**
 * Refunds a transaction that was paid 100% via wallet.
 * These transactions have no stripePaymentIntentId, so the charge.refunded
 * webhook can never trigger for them. This callable provides the refund path.
 *
 * Flow:
 * 1. Validate transaction: exists, paidVia === 'wallet', refundable status
 * 2. Atomically in runTransaction:
 *    a. Credit buyer's wallet (refund_credit ledger entry)
 *    b. Debit seller's wallet (pendingBalance or balance)
 *    c. Mark transaction as 'refunded'
 *    d. Release article (isSold = false)
 *
 * Authorization: ADMIN ONLY (aligned with adminRefundTransaction). A buyer must
 * never reach this — F21/F132: a wallet-only buyer could otherwise refund
 * himself in full AFTER delivery (status shipped/delivered/meetup_completed)
 * while keeping the article, debiting the seller — a direct theft vector with
 * no dispute, seller consent or admin review. Support uses this to resolve
 * wallet-only refunds (the card/destination-charge path is adminRefundTransaction).
 */
export const refundWalletPayment = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/wallet.refundWalletPayment"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    // The central engine qualifies an exact own receipt before a renewed
    // role, and guards every NEW operator instruction in its transaction.
    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'refundWalletPayment',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    return executeAdminRefundRequest(request.auth.uid, request.data, true, request);
  }))
);
