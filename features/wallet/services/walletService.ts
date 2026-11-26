/**
 * Wallet Service — Seconde
 *
 * All functions delegate to Cloud Functions (callable).
 * Amounts from the backend are in cents; the service returns raw data
 * and leaves formatting to the UI layer.
 */

import {
  collection,
  doc,
  getDocsFromServer,
  getDocFromServer,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

import { firestore, functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { WalletInfo, WithdrawalRequest, WithdrawalRequestStatus } from '@/types';
import type { WalletDebtReview, WalletFinancialReview, WithdrawalOwnerAction } from '@/types/wallet';
import type { WalletPurchaseResult } from '@/types/manualPayment';
import type { WithdrawalAttempt, WithdrawalIntentResult, WithdrawalOperationState, WithdrawalProviderState } from '@/types/wallet';
import { isValidWithdrawalAttempt, readWithdrawalAttempt, rememberWithdrawalAttempt,
  runWithdrawalOperation, finishWithdrawalAttempt, matchesWithdrawalAttempt, hasQualifiedWithdrawalNonExecution } from '@/services/withdrawalIntentJournal';
import { getWalletHistoryPage } from './walletHistoryService';
import type { WalletHistoryInput, WalletHistoryPage } from '@/types/walletHistory';
import {isSmallBalanceClosureRequest} from '@/utils/smallBalanceClosure';

// =============================================================================
// RESPONSE TYPES (Cloud Function return shapes)
// =============================================================================

interface ActivateWalletResponse {
  success: boolean;
  balance: number;
  status: string;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const operationStates: WithdrawalOperationState[] = ['reserved', 'submitted', 'completed', 'failed', 'recovered', 'reconciliation_required', 'unknown'];
const providerStates: WithdrawalProviderState[] = ['not_started', 'requested', 'created', 'unknown'];
const unknownWithdrawal = () => Object.assign(new Error('Le résultat du retrait reste à vérifier. Relisez cette même demande avant de poursuivre.'),
  { code: 'client/withdrawal-outcome-unknown' });

const reference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const reasons = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 50 &&
  v.every(reason => typeof reason === 'string' && /^[a-z0-9_]{1,100}$/.test(reason)) && new Set(v).size === v.length;
const nullableCents = (v: unknown) => v === null || cents(v);
const financialGuardQueries = ['seller_disputed', 'seller_bank_dispute_identity', 'seller_bank_dispute_freeze',
  'seller_bank_reconciliation', 'seller_refund_blocked', 'withdrawal_processing', 'withdrawal_payout_unknown',
  'withdrawal_transfer_unknown', 'withdrawal_reconciliation', 'seller_fraud_marker', 'seller_fraud_cases',
  'seller_fraud_candidates'];

function parseFinancialReview(value: unknown, ownerId: string): WalletFinancialReview | undefined {
  if (!record(value) || value.protocol !== 'wallet_financial_review_v1' || value.ownerId !== ownerId ||
      typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)) ||
      value.scope !== 'server_financial_guards' || !['blocked', 'clear', 'review_required'].includes(String(value.status)) ||
      value.informationalOnly !== true || value.withdrawalPermissionGranted !== false || value.globalCoverage !== false ||
      !reasons(value.reasons) || !nullableCents(value.sellerDebtCents) || !Array.isArray(value.linkedOrders) ||
      value.linkedOrders.length > 1000 || !Array.isArray(value.withdrawalRequestIds) || value.withdrawalRequestIds.length > 1000 ||
      !value.withdrawalRequestIds.every(reference) || new Set(value.withdrawalRequestIds).size !== value.withdrawalRequestIds.length ||
      !Array.isArray(value.coverage) || !value.coverage.length || value.coverage.length > 50) return undefined;
  const orderIds = new Set<string>();
  for (const order of value.linkedOrders) {
    if (!record(order) || !reference(order.transactionId) || orderIds.has(order.transactionId) || !reasons(order.reasons)) return undefined;
    orderIds.add(order.transactionId);
  }
  const queries = new Set<string>();
  for (const coverage of value.coverage) {
    if (!record(coverage) || !reference(coverage.query) || queries.has(coverage.query) || coverage.limit !== 201 ||
        !cents(coverage.inspectedCount) || coverage.inspectedCount > 201 || typeof coverage.truncated !== 'boolean' ||
        coverage.truncated !== (coverage.inspectedCount === 201)) return undefined;
    queries.add(coverage.query);
  }
  if (queries.size !== financialGuardQueries.length || financialGuardQueries.some(query => !queries.has(query))) return undefined;
  if (value.status === 'clear' && (value.reasons.length > 0 || value.linkedOrders.length > 0 ||
      value.withdrawalRequestIds.length > 0 || value.sellerDebtCents !== 0 || value.coverage.some(c => c.truncated))) return undefined;
  if (value.status === 'blocked' && value.reasons.length === 0) return undefined;
  return value as unknown as WalletFinancialReview;
}

function parseDebtReview(value: unknown, ownerId: string): WalletDebtReview | undefined {
  if (!record(value) || value.protocol !== 'wallet_debt_review_v1' || value.ownerId !== ownerId ||
      !nullableCents(value.sellerDebtCents) || !['qualified', 'review_required'].includes(String(value.status)) ||
      value.historyComplete !== false || value.historyScope !== 'recent_20_entries' || value.ledgerLimit !== 20 ||
      ![null, 'attribution_history_incomplete'].includes(value.reason as null | string) ||
      !nullableCents(value.recordedDebtCentsInView) || !nullableCents(value.repaidDebtCentsInView) ||
      value.status === 'qualified' && !cents(value.sellerDebtCents) ||
      value.status === 'review_required' && value.reason !== 'attribution_history_incomplete') return undefined;
  return value as unknown as WalletDebtReview;
}

async function parseWithdrawalReceipt(value: unknown, attempt: WithdrawalAttempt, assertCurrent: () => void): Promise<WithdrawalIntentResult> {
  assertCurrent();
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([attempt.uid, attempt.requestId]));
  assertCurrent();
  if (record(value) && (['nonExecutionReceiptQualified', 'nonExecutionReason', 'nonExecutionRecordedAt'].some(key => Object.hasOwn(value, key)) || value.status === 'not_executed' || value.operationState === 'not_executed')) {
    const keys = ['protocol', 'requestId', 'ownerId', 'withdrawalRequestId', 'amountCents', 'currency', 'bankAccountId', 'intentCommitted', 'debitCommitted', 'replay', 'success', 'newBalance', 'balanceSource', 'transferId', 'payoutId', 'status', 'operationState', 'completedReceiptQualified', 'recoveryCommitted', 'recoveryLedgerId', 'recoveredAt', 'transferState', 'payoutState', 'actionRequired', 'retryPermissionGranted', 'action', 'ownerMessage', 'nonExecutionReceiptQualified', 'nonExecutionReason', 'nonExecutionRecordedAt'];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
        value.ownerId !== attempt.uid || value.requestId !== attempt.requestId || value.withdrawalRequestId !== `wi_${digest}` ||
        value.amountCents !== attempt.amountCents || value.bankAccountId !== attempt.bankAccountId || typeof value.replay !== 'boolean' ||
        !hasQualifiedWithdrawalNonExecution(value as unknown as WithdrawalIntentResult)) throw unknownWithdrawal();
    return value as unknown as WithdrawalIntentResult;
  }
  if (!record(value) || value.protocol !== 'withdrawal_intent_v1' || value.requestId !== attempt.requestId ||
      value.ownerId !== attempt.uid || value.withdrawalRequestId !== `wi_${digest}` || value.amountCents !== attempt.amountCents ||
      value.currency !== 'CAD' || value.bankAccountId !== attempt.bankAccountId ||
      typeof value.intentCommitted !== 'boolean' || typeof value.debitCommitted !== 'boolean' ||
      typeof value.replay !== 'boolean' || typeof value.success !== 'boolean' ||
      !(value.newBalance === null || cents(value.newBalance)) ||
      !['withdrawal_debit_receipt', 'unavailable'].includes(String(value.balanceSource)) ||
      !(value.transferId === null || typeof value.transferId === 'string' && /^tr_[A-Za-z0-9_]+$/.test(value.transferId)) ||
      !(value.payoutId === null || typeof value.payoutId === 'string' && /^po_[A-Za-z0-9_]+$/.test(value.payoutId)) ||
      !['processing', 'completed', 'failed', 'unknown'].includes(String(value.status)) ||
      !operationStates.includes(value.operationState as WithdrawalOperationState) ||
      typeof value.completedReceiptQualified !== 'boolean' || typeof value.recoveryCommitted !== 'boolean' ||
      !(value.recoveryLedgerId === null || typeof value.recoveryLedgerId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value.recoveryLedgerId)) ||
      !(value.recoveredAt === null || typeof value.recoveredAt === 'string' && Number.isFinite(Date.parse(value.recoveredAt))) ||
      !providerStates.includes(value.transferState as WithdrawalProviderState) || !providerStates.includes(value.payoutState as WithdrawalProviderState) ||
      typeof value.actionRequired !== 'boolean' || value.retryPermissionGranted !== false ||
      !['refreshWithdrawals', 'contactSupport'].includes(String(value.action)) ||
      !(value.ownerMessage === null || typeof value.ownerMessage === 'string')) throw unknownWithdrawal();
  if (value.intentCommitted !== value.debitCommitted ||
      (value.debitCommitted ? value.balanceSource !== 'withdrawal_debit_receipt' || !cents(value.newBalance)
        : value.balanceSource !== 'unavailable' || value.newBalance !== null || value.operationState !== 'unknown' || value.success || !value.actionRequired) ||
      value.success && (!value.transferId || !value.payoutId || value.actionRequired || value.status === 'failed') ||
      value.completedReceiptQualified && (value.status !== 'completed' || !value.transferId || !value.payoutId) ||
      value.recoveryCommitted && (value.status !== 'failed' || !value.transferId || !value.payoutId || !value.recoveryLedgerId || !value.recoveredAt) ||
      value.operationState === 'completed' && (!value.completedReceiptQualified || value.actionRequired) ||
      value.operationState === 'recovered' && (!value.recoveryCommitted || value.actionRequired) ||
      ['reserved', 'submitted'].includes(String(value.operationState)) && value.status !== 'processing' ||
      value.operationState === 'submitted' && (!value.transferId || !value.payoutId)) throw unknownWithdrawal();
  return value as unknown as WithdrawalIntentResult;
}

// =============================================================================
// SERVICE
// =============================================================================

export class WalletService {
  /** Owner servicing only; this history grants no new financial capability. */
  static getFinancialHistory(expectedUid: string, input: WalletHistoryInput, assertContext: () => void): Promise<WalletHistoryPage> {
    return getWalletHistoryPage(expectedUid, input, assertContext);
  }
  /**
   * Fetch wallet info for the authenticated user.
   * Returns hasWallet: false if the user has not activated their wallet.
   */
  static async getWalletInfo(expectedUid?: string, assertContext?: () => void): Promise<WalletInfo> {
    const session = captureTradeSession(expectedUid);
    assertContext?.();
    const callable = httpsCallable<{ expectedUid: string }, WalletInfo>(
      functions,
      'getWalletInfo',
    );
    const { data } = await callable({ expectedUid: session.uid });
    assertTradeSessionCurrent(session);
    assertContext?.();
    const walletFinancialReview = parseFinancialReview(data.walletFinancialReview, session.uid);
    const parsedDebtReview = parseDebtReview(data.sellerDebtReview, session.uid);
    const sellerDebtReview = parsedDebtReview && walletFinancialReview &&
      parsedDebtReview.sellerDebtCents === walletFinancialReview.sellerDebtCents ? parsedDebtReview : undefined;
    // Invalid or old summary contracts remain absent and render as a review,
    // never as a qualified absence of financial obligations.
    return { ...data, walletFinancialReview, sellerDebtReview };
  }

  /**
   * Activate the wallet for the authenticated user.
   */
  static async activateWallet(): Promise<{ success: boolean }> {
    const callable = httpsCallable<Record<string, never>, ActivateWalletResponse>(
      functions,
      'activateWallet',
    );
    const { data } = await callable({});
    return { success: data.success };
  }

  /**
   * Withdraw funds from the wallet to the user's Stripe Connect bank account.
   * Persist one owner-scoped intention before the first request. Re-entry only
   * observes that intention; it cannot submit a second provider operation.
   */
  static async withdrawFromWallet(
    attempt: WithdrawalAttempt,
    options: { assertCurrent: () => void },
  ): Promise<WithdrawalIntentResult> {
    const session = captureTradeSession(attempt.uid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); options.assertCurrent(); };
    return runWithdrawalOperation(attempt.uid, assertCurrent, async () => {
      if (!isValidWithdrawalAttempt(attempt, session.uid)) throw unknownWithdrawal();
      const existing = await readWithdrawalAttempt(attempt.uid, assertCurrent);
      if (existing) {
        if (!matchesWithdrawalAttempt(existing, attempt)) throw unknownWithdrawal();
        return this.observeWithdrawal(existing, options);
      }
      if (attempt.amountCents < 1000 && !isSmallBalanceClosureRequest(attempt.closureSettlement)) throw unknownWithdrawal();
      await rememberWithdrawalAttempt(attempt, assertCurrent);
      assertCurrent();
      return this.callWithdrawal(attempt, 'request', assertCurrent);
    });
  }

  private static async callWithdrawal(attempt: WithdrawalAttempt, mode: 'request' | 'observe', assertCurrent: () => void): Promise<WithdrawalIntentResult> {
    assertCurrent();
    const input = { requestId: attempt.requestId, mode, expectedUid: attempt.uid,
      amount: attempt.amountCents, expectedBankAccountId: attempt.bankAccountId,
      ...(mode === 'request' && attempt.closureSettlement ? {closureSettlement: attempt.closureSettlement} : {}) };
    const { data } = await httpsCallable<typeof input, unknown>(functions, 'walletWithdraw')(input);
    assertCurrent();
    return parseWithdrawalReceipt(data, attempt, assertCurrent);
  }

  /** Read-only server observation. Absence, timeout and old bank details never clear the journal. */
  static async observeWithdrawal(attempt: WithdrawalAttempt, options: { assertCurrent: () => void }): Promise<WithdrawalIntentResult> {
    const session = captureTradeSession(attempt.uid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); options.assertCurrent(); };
    assertCurrent();
    if (!isValidWithdrawalAttempt(attempt, session.uid)) throw unknownWithdrawal();
    return this.callWithdrawal(attempt, 'observe', assertCurrent);
  }

  static async readPendingWithdrawal(uid: string, assertCurrent: () => void): Promise<{
    attempt: WithdrawalAttempt; receipt: WithdrawalIntentResult;
  } | null> {
    const attempt = await readWithdrawalAttempt(uid, assertCurrent);
    if (!attempt) return null;
    return { attempt, receipt: await this.observeWithdrawal(attempt, { assertCurrent }) };
  }

  /** Explicit completion, requalified on the server immediately before clearing the local intention. */
  static async finishWithdrawal(attempt: WithdrawalAttempt, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(attempt.uid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    await runWithdrawalOperation(attempt.uid, assertCurrent, async () => {
      const receipt = await this.observeWithdrawal(attempt, { assertCurrent });
      await finishWithdrawalAttempt(attempt, receipt, assertCurrent);
    });
  }

  /**
   * Pay for a transaction using 100% wallet balance.
   * @param transactionId The transaction to pay for
   */
  static async payWithWallet(
    transactionId: string,
    options?: { expectedUid?: string; assertCurrent?: () => void },
  ): Promise<WalletPurchaseResult> {
    const session = captureTradeSession(options?.expectedUid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); options?.assertCurrent?.(); };
    assertCurrent();
    const callable = httpsCallable<{ transactionId: string }, WalletPurchaseResult>(
      functions,
      'payWithWallet',
    );
    const { data } = await callable({ transactionId });
    assertCurrent();
    if (data?.success !== true || data.transactionId !== transactionId || typeof data.replay !== 'boolean' ||
        data.paymentCommitted !== true || data.paymentPermissionGranted !== false || typeof data.currentStatus !== 'string' ||
        !(data.newBalance === null || (Number.isSafeInteger(data.newBalance) && data.newBalance >= 0)) || typeof data.balanceSource !== 'string') {
      throw new Error('Le reçu du paiement par solde reste à vérifier dans la commande.');
    }
    return data;
  }

  /**
   * Read the authenticated user's recent withdrawal requests (payout lifecycle).
   *
   * The `withdrawal_requests` doc is written server-side (walletWithdraw +
   * payout webhooks) and is the source of truth for "retrait en traitement"
   * (processing / completed / failed). Firestore rules allow the owner to read
   * their own docs (read-only). Amounts are in cents.
   */
  static async getWithdrawalRequests(
    userId: string,
    max = 10,
  ): Promise<WithdrawalRequest[]> {
    const session = captureTradeSession(userId);
    const q = query(
      collection(firestore, 'withdrawal_requests'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      fsLimit(max),
    );
    // Keep older unresolved obligations visible even when they have fallen out
    // of the recent history. Equality-only queries use the existing indexes.
    const snapshots = await Promise.all([
      getDocsFromServer(q),
      getDocsFromServer(query(collection(firestore, 'withdrawal_requests'), where('userId', '==', userId),
        where('reconciliationRequired', '==', true), fsLimit(25))),
      getDocsFromServer(query(collection(firestore, 'withdrawal_requests'), where('userId', '==', userId),
        where('status', '==', 'processing'), fsLimit(25))),
    ]);
    assertTradeSessionCurrent(session);
    const documents = Array.from(new Map(snapshots.flatMap(s => s.docs).map(d => [d.id, d])).values());
    return Promise.all(documents.map(async (d) => {
      const data = d.data() as Record<string, unknown>;
      if (data.userId !== session.uid) throw unknownWithdrawal();
      const toDate = (v: unknown): Date | undefined => {
        if (!v || typeof (v as { toDate?: unknown }).toDate !== 'function') return undefined;
        const date = (v as { toDate: () => Date }).toDate();
        return date instanceof Date && Number.isFinite(date.getTime()) ? date : undefined;
      };
      const refusalCandidate = data.status === 'not_executed' || Object.hasOwn(data, 'withdrawalNonExecution');
      if (refusalCandidate && record(data.withdrawalNonExecution)) {
        const r = data.withdrawalNonExecution;
        const attempt = {version: 1, uid: userId, requestId: r.clientRequestId, amountCents: data.amount, bankAccountId: r.bankAccountId};
        // The public marker selects a tuple only. Its status, dates and reason
        // never establish non-execution without the server's private proof.
        if (r.ownerId === userId && isValidWithdrawalAttempt(attempt, userId)) {
          try {
            assertTradeSessionCurrent(session);
            const receipt = await this.observeWithdrawal(attempt, {assertCurrent: () => assertTradeSessionCurrent(session)});
            assertTradeSessionCurrent(session);
            if (receipt.withdrawalRequestId === d.id && hasQualifiedWithdrawalNonExecution(receipt)) return {
              id: d.id, status: 'not_executed' as const, amount: receipt.amountCents, createdAt: new Date(receipt.nonExecutionRecordedAt!),
              reconciliationRequired: false, ownerMessage: receipt.ownerMessage ?? undefined, ownerAction: 'contactSupport' as const,
              recoveryReceiptQualified: false, completionReceiptQualified: false, amountQualified: true,
              nonExecutionReceiptQualified: true as const, nonExecutionReason: receipt.nonExecutionReason,
              nonExecutionRecordedAt: receipt.nonExecutionRecordedAt,
            };
          } catch {assertTradeSessionCurrent(session); /* An error stays unknown and blocking below. */}
        }
      }
      const ownerAction = (v: unknown): WithdrawalOwnerAction | undefined =>
        ['refreshWithdrawals', 'contactSupport', 'getStripeAccountStatus'].includes(String(v)) ? v as WithdrawalOwnerAction : undefined;
      const transferId = typeof data.stripeTransferId === 'string' ? data.stripeTransferId : null;
      const payoutId = typeof data.stripePayoutId === 'string' ? data.stripePayoutId : null;
      const frozen = record(data.payoutDestination) && data.payoutDestination.schemaVersion === 1 &&
        data.payoutDestination.accountId === data.stripeAccountId && data.payoutDestination.country === 'CA' &&
        data.payoutDestination.currency === 'CAD' && data.payoutDestination.payoutMethod === 'standard' &&
        typeof data.payoutDestination.bankAccountId === 'string' && /^ba_[A-Za-z0-9_]+$/.test(data.payoutDestination.bankAccountId)
        ? data.payoutDestination : null;
      const observation = record(data.payoutObservation) && data.payoutObservation.schemaVersion === 1 &&
        data.payoutObservation.outcome === 'paid' && data.payoutObservation.payoutId === payoutId &&
        data.payoutObservation.accountId === data.stripeAccountId && data.payoutObservation.transferId === transferId &&
        data.payoutObservation.amountCents === data.amount && data.payoutObservation.currency === 'CAD' &&
        typeof data.payoutObservation.bankAccountId === 'string' && /^ba_[A-Za-z0-9_]+$/.test(data.payoutObservation.bankAccountId) &&
        (data.payoutObservation.qualification === 'frozen_destination' && frozen &&
          frozen.bankAccountId === data.payoutObservation.bankAccountId ||
          data.payoutObservation.qualification === 'legacy_saved_payout' && data.payoutDestination == null) &&
        toDate(data.payoutObservation.observedAt) ? data.payoutObservation : null;
      const completion = record(data.payoutCompletion) && data.payoutCompletion.schemaVersion === 1 &&
        data.payoutCompletion.withdrawalRequestId === d.id && data.payoutCompletion.ownerId === userId &&
        data.payoutCompletion.amountCents === data.amount && data.payoutCompletion.currency === 'CAD' &&
        data.payoutCompletion.accountId === data.stripeAccountId && data.payoutCompletion.payoutId === payoutId &&
        data.payoutCompletion.transferId === transferId && data.payoutCompletion.bankAccountId === observation?.bankAccountId &&
        data.payoutCompletion.debitLedgerId === observation?.debitLedgerId && toDate(data.payoutCompletion.observedAt)
        ? data.payoutCompletion : null;
      let completionReceiptQualified = false;
      if (completion && observation && data.status === 'completed' && data.payoutOutcome === 'paid' &&
          data.reconciliationRequired !== true && data.payoutRecovery == null && toDate(data.completedAt) &&
          typeof payoutId === 'string' && /^po_[A-Za-z0-9_]+$/.test(payoutId) &&
          typeof transferId === 'string' && /^tr_[A-Za-z0-9_]+$/.test(transferId) &&
          typeof completion.debitLedgerId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(completion.debitLedgerId) &&
          (completion.debitLedgerId === data.ledgerEntryId || data.withdrawalIntent == null && data.ledgerEntryId == null) &&
          cents(data.amount) && data.amount > 0) {
        assertTradeSessionCurrent(session);
        const debit = (await getDocFromServer(doc(firestore, 'wallets', userId, 'ledger', completion.debitLedgerId))).data();
        assertTradeSessionCurrent(session);
        completionReceiptQualified = debit?.type === 'withdrawal' && debit.amount === data.amount &&
          (debit.currency === 'CAD' || data.withdrawalIntent == null && debit.currency == null) &&
          (debit.withdrawalRequestId === d.id || data.withdrawalIntent == null && debit.withdrawalRequestId == null) &&
          !!toDate(debit.createdAt) && cents(debit.balanceAfter);
      }
      const failure = record(data.payoutFailure) && data.payoutFailure.schemaVersion === 1 &&
        data.payoutFailure.payoutId === payoutId && data.payoutFailure.accountId === data.stripeAccountId &&
        ['failed', 'canceled'].includes(String(data.payoutFailure.status)) && toDate(data.payoutFailure.observedAt)
        ? data.payoutFailure : null;
      const recovery = record(data.payoutRecovery) && data.payoutRecovery.schemaVersion === 1 &&
        data.payoutRecovery.requestId === d.id && data.payoutRecovery.ownerId === userId &&
        data.payoutRecovery.amountCents === data.amount && data.payoutRecovery.currency === 'CAD' &&
        data.payoutRecovery.accountId === data.stripeAccountId && data.payoutRecovery.transferId === transferId &&
        data.payoutRecovery.payoutId === payoutId &&
        ['awaiting_return', 'reconciliation_required', 'recovered'].includes(String(data.payoutRecovery.state)) ? data.payoutRecovery : null;
      let recoveryReceiptQualified = false;
      if (recovery?.state === 'recovered' && data.status === 'failed' && data.reconciliationRequired !== true &&
          toDate(recovery.compensatedAt) && typeof recovery.compensationLedgerId === 'string' &&
          /^[A-Za-z0-9_-]{1,200}$/.test(recovery.compensationLedgerId) &&
          typeof recovery.debitLedgerId === 'string' && typeof recovery.reversalId === 'string' && /^trr_[A-Za-z0-9_]+$/.test(recovery.reversalId) &&
          typeof recovery.returnBalanceTransactionId === 'string' && /^txn_[A-Za-z0-9_]+$/.test(recovery.returnBalanceTransactionId)) {
        assertTradeSessionCurrent(session);
        const compensation = (await getDocFromServer(doc(firestore, 'wallets', userId, 'ledger', recovery.compensationLedgerId))).data();
        assertTradeSessionCurrent(session);
        recoveryReceiptQualified = compensation?.type === 'withdrawal_failed' && compensation.amount === data.amount && compensation.currency === 'CAD' &&
          compensation.withdrawalRequestId === d.id && compensation.withdrawalDebitLedgerId === recovery.debitLedgerId &&
          compensation.payoutId === payoutId && compensation.transferId === transferId && compensation.reversalId === recovery.reversalId &&
          compensation.returnBalanceTransactionId === recovery.returnBalanceTransactionId && !!toDate(compensation.createdAt) && cents(compensation.balanceAfter);
      }
      return {
        id: d.id,
        status: ['processing', 'completed', 'failed'].includes(String(data.status)) ? data.status as WithdrawalRequestStatus : 'unknown',
        amount: cents(data.amount) ? data.amount : 0,
        createdAt: toDate(data.createdAt) ?? null,
        updatedAt: toDate(data.updatedAt),
        reconciliationRequired: refusalCandidate || data.reconciliationRequired === true || data.payoutRecovery != null && !recovery ||
          recovery?.state === 'recovered' && !recoveryReceiptQualified || !cents(data.amount) || data.amount === 0 ||
          data.payoutFailure != null && !failure || data.payoutDestination != null && !frozen || !toDate(data.createdAt),
        ownerMessage: refusalCandidate ? 'La non-exécution de cette demande ne peut pas être qualifiée. Son résultat reste à rapprocher ; aucun nouveau retrait n’est autorisé depuis cette seule observation.' : typeof data.ownerMessage === 'string' ? data.ownerMessage : undefined,
        ownerAction: ownerAction(data.ownerAction),
        ownerBankAction: ownerAction(data.ownerBankAction),
        payoutFailure: failure ? { status: failure.status as 'failed' | 'canceled',
          code: typeof failure.code === 'string' && /^[a-z0-9_]{1,100}$/.test(failure.code) ? failure.code : null,
          observedAt: toDate(failure.observedAt)! } : undefined,
        payoutRecovery: recovery ? { state: recovery.state as 'awaiting_return' | 'reconciliation_required' | 'recovered',
          compensatedAt: toDate(recovery.compensatedAt) } : undefined,
        recoveryReceiptQualified,
        completionReceiptQualified,
        amountQualified: cents(data.amount) && data.amount > 0,
        historicalDestination: frozen && typeof frozen.last4 === 'string' && /^\d{4}$/.test(frozen.last4) ? {
          last4: frozen.last4, ...(typeof frozen.bankName === 'string' && frozen.bankName.length <= 120 ? { bankName: frozen.bankName } : {}),
        } : undefined,
        destinationQualification: observation ? observation.qualification as 'frozen_destination' | 'legacy_saved_payout' : undefined,
        payoutId: payoutId && /^po_[A-Za-z0-9_]+$/.test(payoutId) ? payoutId : undefined,
        transferId: transferId && /^tr_[A-Za-z0-9_]+$/.test(transferId) ? transferId : undefined,
      };
    }));
  }
}
