/**
 * Types — Porte-monnaie vendeur : ledger, solde, retraits.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

// ============================================
// WALLET TYPES
// ============================================

export type WalletLedgerType =
  | 'sale_credit'        // Crédit suite à une vente (livraison confirmée)
  | 'purchase_debit'     // Débit suite à un achat depuis le wallet
  | 'withdrawal'         // Retrait vers le compte bancaire
  | 'withdrawal_failed'  // Retrait échoué → re-crédité au solde
  | 'refund_credit'      // Crédit suite à un remboursement reçu
  | 'funds_held'         // Fonds mis en attente (fenêtre de protection 7j)
  | 'funds_released'     // Fonds libérés après la fenêtre de protection
  | 'dispute_hold'       // Fonds gelés suite à l'ouverture d'un litige
  | 'refund_hold'        // Réserve interne pendant un remboursement
  | 'dispute_hold_released' // Libération d'une réserve interne, pas un nouveau revenu
  | 'refund_debit'       // Débit du vendeur suite à un remboursement acheteur
  | 'debt_repayment';    // Fonds libérés affectés en priorité au solde dû (régularisation)

export interface WalletLedgerEntry {
  id: string;
  type: WalletLedgerType;
  amount: number;
  balanceAfter: number;
  description: string;
  transactionId?: string | null;
  /** Qualified attribution, never inferred from the recent ledger total. */
  debtRecordedCents?: number | null;
  refundIntentId?: string | null;
  disputeId?: string | null;
  financialQualification?: 'qualified' | 'review_required';
  amountMeaning?: 'wallet_movement' | 'debt_allocation';
  createdAt: string;
}

export interface WalletInfo {
  hasWallet: boolean;
  balance: number;
  pendingBalance: number;
  /** Funds soon available (cents) — delivered sales inside the 7-day protection window. */
  heldBalance?: number;
  /** ISO date at which the next batch of held funds becomes withdrawable (7-day window). */
  heldReleaseAt?: string;
  /** Outstanding amount to regularize (cents). Blocks withdrawals while > 0. */
  sellerDebt?: number;
  status: 'active' | 'inactive';
  ledger: WalletLedgerEntry[];
  walletOrderReview?: WalletOrderReview;
  walletFinancialReview?: WalletFinancialReview;
  sellerDebtReview?: WalletDebtReview;
}

/** Owner-scoped observations of the server guards; no permission to move money. */
export interface WalletFinancialReview {
  protocol: 'wallet_financial_review_v1';
  ownerId: string;
  observedAt: string;
  scope: 'server_financial_guards';
  status: 'blocked' | 'clear' | 'review_required';
  informationalOnly: true;
  withdrawalPermissionGranted: false;
  globalCoverage: false;
  reasons: string[];
  linkedOrders: Array<{ transactionId: string; reasons: string[] }>;
  withdrawalRequestIds: string[];
  coverage: Array<{ query: string; limit: 201; inspectedCount: number; truncated: boolean }>;
  sellerDebtCents: number | null;
}

/** The current debt and the recent movements are separate observations. */
export interface WalletDebtReview {
  protocol: 'wallet_debt_review_v1';
  ownerId: string;
  sellerDebtCents: number | null;
  status: 'qualified' | 'review_required';
  historyComplete: false;
  historyScope: 'recent_20_entries';
  ledgerLimit: 20;
  reason: 'attribution_history_incomplete' | null;
  recordedDebtCentsInView: number | null;
  repaidDebtCentsInView: number | null;
}

/** Bounded owner review; it never proves global absence or grants withdrawal. */
export interface WalletOrderReview {
  protocol: 'wallet_order_review_v1';
  scope: 'seller_delivered_orders';
  limit: 100;
  inspectedCount: number;
  truncated: boolean;
  globalCoverage: false;
  blockedOrderCount: number;
  qualifiedCandidateCount: number;
  deliveryCorrections: Array<{
    transactionId: string;
    correctionId: string | null;
    state: 'release_suspended' | 'released_review_required' | 'resolved' | 'unqualified_marker';
    blocked: boolean;
    resolutionReceiptQualified: boolean;
    message: string;
    action: 'contactSupport';
    detectedAt: string | null;
    originalDeliveryAt: string | null;
    originalFundsReleaseAt: string | null;
    originalFundsReleasedAt: string | null;
  }>;
}

// withdrawal_requests collection — tracks payouts to the seller bank account.
export type WithdrawalRequestStatus = 'processing' | 'completed' | 'failed' | 'unknown' | 'not_executed';
export const WITHDRAWAL_NON_EXECUTION_REASONS = ['platform_cash_preflight_not_exposed', 'platform_cash_observation_unknown', 'platform_cash_unavailable', 'platform_cash_insufficient'] as const;
export type WithdrawalNonExecutionReason = typeof WITHDRAWAL_NON_EXECUTION_REASONS[number];

export type WithdrawalOwnerAction = 'refreshWithdrawals' | 'contactSupport' | 'getStripeAccountStatus';

export interface WithdrawalRequest {
  id: string;
  status: WithdrawalRequestStatus;
  /** Withdrawn amount (cents). */
  amount: number;
  failureReason?: string;
  createdAt: Date | null;
  updatedAt?: Date;
  reconciliationRequired: boolean;
  ownerMessage?: string;
  ownerAction?: WithdrawalOwnerAction;
  ownerBankAction?: WithdrawalOwnerAction;
  payoutFailure?: {
    status: 'failed' | 'canceled';
    code: string | null;
    observedAt: Date;
  };
  payoutRecovery?: {
    state: 'awaiting_return' | 'reconciliation_required' | 'recovered';
    compensatedAt?: Date;
  };
  recoveryReceiptQualified: boolean;
  completionReceiptQualified: boolean;
  amountQualified: boolean;
  /** Present only after a fresh native observation of the exact refusal tuple. */
  nonExecutionReceiptQualified?: true;
  nonExecutionReason?: WithdrawalNonExecutionReason;
  nonExecutionRecordedAt?: string;
  historicalDestination?: { last4: string; bankName?: string };
  destinationQualification?: 'frozen_destination' | 'legacy_saved_payout';
  payoutId?: string;
  transferId?: string;
}

/** Immutable local intention, persisted before the first financial request. */
export interface WithdrawalAttempt {
  version: 1;
  uid: string;
  requestId: string;
  amountCents: number;
  bankAccountId: string;
  closureSettlement?: SmallBalanceClosureRequest;
}
export interface SmallBalanceClosureRequest {protocol: 'small_balance_closure_v1'; sourceHash: string}
export interface SmallBalanceSettlement extends SmallBalanceClosureRequest {requestedAt: string; amountCents: number; currency: 'CAD'; withdrawalPermissionGranted: false; accountDeletionPermissionGranted: false}

export type WithdrawalOperationState = 'reserved' | 'submitted' | 'completed' | 'failed' |
  'recovered' | 'reconciliation_required' | 'unknown' | 'not_executed';
export type WithdrawalProviderState = 'not_started' | 'requested' | 'created' | 'unknown';

/** Server-qualified receipt. A submitted payout is not a bank payment. */
export interface WithdrawalIntentResult {
  protocol: 'withdrawal_intent_v1';
  requestId: string;
  ownerId: string;
  withdrawalRequestId: string;
  amountCents: number;
  currency: 'CAD';
  bankAccountId: string;
  intentCommitted: boolean;
  debitCommitted: boolean;
  replay: boolean;
  success: boolean;
  newBalance: number | null;
  balanceSource: 'withdrawal_debit_receipt' | 'unavailable';
  transferId: string | null;
  payoutId: string | null;
  status: WithdrawalRequestStatus | 'unknown';
  operationState: WithdrawalOperationState;
  completedReceiptQualified: boolean;
  recoveryCommitted: boolean;
  recoveryLedgerId: string | null;
  recoveredAt: string | null;
  transferState: WithdrawalProviderState;
  payoutState: WithdrawalProviderState;
  actionRequired: boolean;
  retryPermissionGranted: false;
  action: 'refreshWithdrawals' | 'contactSupport';
  ownerMessage: string | null;
  /** Additive native refusal branch; absent from all older receipt shapes. */
  nonExecutionReceiptQualified?: true;
  nonExecutionReason?: WithdrawalNonExecutionReason;
  nonExecutionRecordedAt?: string;
}
