export type WalletHistorySource = 'ledger' | 'withdrawals';
export interface WalletHistoryPeriod { fromMs: number | null; toMs: number | null }
interface HistoryDate {
  createdAt: string | null; createdAtMs: number | null; dateQualification: 'qualified' | 'review_required';
}
export interface WalletHistoryLedgerEntry extends HistoryDate {
  source: 'ledger'; id: string; type: string | null; amountCents: number | null; currency: 'CAD' | null;
  balanceAfterCents: number | null; debtRecordedCents: number | null; debtAllocationCents: number | null;
  amountMeaning: 'debt_allocation' | 'wallet_movement' | 'unknown_type'; description: string | null;
  references: { transactionId: string | null; refundIntentId: string | null; disputeId: string | null;
    withdrawalRequestId: string | null; withdrawalDebitLedgerId: string | null; swapId: string | null };
  anomalies: string[]; financialQualification: 'qualified' | 'review_required';
}
export interface WalletHistoryWithdrawalEntry extends HistoryDate {
  source: 'withdrawals'; id: string; type: 'withdrawal_request'; amountCents: number | null; currency: 'CAD' | null;
  description: 'Demande de retrait'; state: string | null; operationState: string | null;
  proofQualification: 'qualified' | 'review_required'; bankDestination: { last4: string; country: 'CA'; currency: 'CAD' } | null;
  references: { withdrawalRequestId: string; debitLedgerId: string | null; compensationLedgerId: string | null };
  completionProof: { qualified: true; observedAt: string } | null;
  compensationProof: { qualified: true; amountCents: number; ledgerEntryId: string; recordedAt: string } | null;
  anomalies: string[];
}
export type WalletHistoryEntry = WalletHistoryLedgerEntry | WalletHistoryWithdrawalEntry;
export interface WalletHistoryPage {
  protocol: 'wallet_history_page_v1'; ownerId: string; source: WalletHistorySource; period: WalletHistoryPeriod;
  periodBoundary: '[fromMs,toMs)'; readAt: string; order: 'document_id_asc'; entries: WalletHistoryEntry[]; hasMore: boolean; cursor: string | null;
  coverage: { scope: 'page_forward_scan'; timestampPrecision: 'millisecond_floor'; inspectedCount: number; excludedByPeriodCount: number; emittedCount: number; scanLimit: 200; pageSize: number;
    includesUnqualifiedDates: true; undatedEntriesBelongToPeriod: false; scanCompleteAtRead: boolean; accountingSnapshot: false;
    totalsProvided: false; sourcesMayDescribeSameMovement: true; continuationIsCompletenessProof: false };
}
export interface WalletHistoryInput {
  source: WalletHistorySource; period: WalletHistoryPeriod; cursor: string | null; pageSize: number;
}
