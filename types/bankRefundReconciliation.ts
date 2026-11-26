export const BANK_REFUND_RECONCILIATION_CAPABILITY = 'bank_financial_reconciliation_v1' as const;

export interface BankReconciliationIdentity {
  transactionId: string; disputeId: string; paymentIntentId: string; chargeId: string; capturedCardCents: number;
}
export interface BankReconciliationPaymentIntent {
  id: string | null; object: string | null; chargeId: string | null; currency: string | null;
  livemode: boolean | null; status: string | null; capturedCents: number | null; directPlatformCharge: boolean;
}
export interface BankReconciliationCharge {
  id: string | null; object: string | null; paymentIntentId: string | null; currency: string | null;
  livemode: boolean | null; capturedCents: number | null; refundedCents: number | null; paid: boolean | null;
  disputed: boolean | null; balanceTransactionId: string | null;
}
export interface BankReconciliationRefund {
  id: string | null; object: string | null; paymentIntentId: string | null; chargeId: string | null;
  amountCents: number | null; currency: string | null; status: string | null; createdSeconds: number | null;
  balanceTransactionId: string | null; failureBalanceTransactionId: string | null; failureReason: string | null;
  requestedId: string; associationQualified: boolean;
}
export interface BankReconciliationDispute {
  id: string | null; object: string | null; paymentIntentId: string | null; chargeId: string | null;
  amountCents: number | null; currency: string | null; livemode: boolean | null; status: string | null;
  createdSeconds: number | null; balanceTransactionIds: (string | null)[] | null; requestedId: string; associationQualified: boolean;
}
export type BankReconciliationMovementFamily = 'charge_principal' | 'refund_principal' | 'refund_reversal' | 'dispute_principal' | 'dispute_reversal' | 'fee_movement' | 'reserve_movement' | 'unknown';
export interface BankReconciliationMovement {
  id: string | null; qualification: 'native_referenced_movement' | 'unknown'; amountCents: number | null;
  feeCents: number | null; netCents: number | null;
  feeDetails: {amountCents: number | null; currency: string | null; type: string | null; applicationId: string | null; description: string | null}[] | null;
  currency: string | null; balanceType: 'payments' | 'issuing' | 'refund_and_dispute_prefunding' | 'risk_reserved' | null;
  status: 'pending' | 'available' | null; availableOnSeconds: number | null; createdSeconds: number | null;
  sourceId: string | null; type: string | null; reportingCategory: string | null; family: BankReconciliationMovementFamily;
  netArithmeticQualified: boolean;
  edges: {objectId: string; field: 'charge.balance_transaction' | 'refund.balance_transaction' | 'refund.failure_balance_transaction' | 'dispute.balance_transactions'; balanceTransactionId: string}[];
  requestedId: string; platformAccountId: string | null; livemode: boolean | null;
  providerRestitutionVerified: false; financialEffectAuthorized: false;
}
export interface BankReconciliationMovementGroup {
  key: string; platformAccountId: string; livemode: boolean; currency: string; balanceType: NonNullable<BankReconciliationMovement['balanceType']>;
  status: NonNullable<BankReconciliationMovement['status']>; family: BankReconciliationMovementFamily;
  balanceTransactionIds: string[]; amountCents: number; feeCents: number; netCents: number;
}
export interface BankFinancialGraph {
  protocol: 'bank_financial_graph_v1'; identity: BankReconciliationIdentity; platformAccountId: string | null; livemode: boolean | null;
  pi: BankReconciliationPaymentIntent | null; charge: BankReconciliationCharge | null;
  refunds: BankReconciliationRefund[]; disputes: BankReconciliationDispute[]; movements: BankReconciliationMovement[]; groups: BankReconciliationMovementGroup[];
  coverage: {
    refunds: {inspected: number; limit: 10; complete: boolean}; disputes: {inspected: number; limit: 10; complete: boolean};
    balanceTransactions: {referenced: number; inspected: number; limit: 40; complete: boolean};
    manifestRechecked: boolean; manifestStable: boolean; exhaustiveExternalHistoryVerified: false;
  };
  qualification: 'complete_referenced_manifest' | 'unknown'; reasons: string[]; startedAt: string; observedAt: string;
  totalsAreObservedBalanceMovementsOnly: true; netFinancialResolutionQualified: false; financialEffectAuthorized: false;
}
export interface BankReconciliationLocalEvidence {
  ledgers: {id: string; ownerRole: 'buyer' | 'seller'; transactionId: string; type: string; amountCents: number | null; debtCents: number | null; refundIntentId: string | null; disputeId: string | null; createdAt: string | null; sourceHash: string; qualification: 'native_recorded_ledger_movement' | 'unknown'; providerSettlementVerified: false}[];
  allocations: {id: string; sourceHash: string; reservationQualification: 'native_reservation' | 'unknown'; localMovementsQualification: 'native_local_effects' | 'unknown'; reservedAt: string | null; appliedAt: string | null; providerRefundId: string | null;
    terms: {cardCents: number; walletCents: number; sellerDebitCents: number} | null;
    localEffects: {sellerDebitCents: number; fromPendingCents: number; fromHeldCents: number; fromBalanceCents: number; debtCents: number} | null; providerSettlementVerified: false}[];
  repairs: {id: string; sourceHash: string; qualification: 'native_recorded_repair' | 'unknown'; refundIntentId: string | null; providerRefundId: string | null; state: string; amountCents: number | null; currency: 'CAD' | null; reservedAt: string | null; observedAt: string | null; providerSettlementVerified: false; localEffectsVerified: false}[];
  histories: {id: string; sourceHash: string; recordedAt: string | null; qualification: 'native_recorded_history' | 'unknown'}[];
  currentRefund: {intentId: string | null; state: string; providerRefundId: string | null; cardCents: number | null; walletCents: number | null; sellerDebitCents: number | null; fundsAppliedAt: string | null; financialSettlementVerified: false} | null;
  reasons: string[]; amountsAreSeparateRecordedFacts: true; netFinancialResolutionQualified: false; financialEffectAuthorized: false;
}
export interface BankReconciliationNativeCapture {
  protocol: 'bank_financial_native_source_v1'; transactionId: string; disputeId: string; orderRevision: string; orderHash: string;
  bankRevision: string; bankHash: string; parties: [string, string] | null;
  manifest: {kind: 'buyer_ledger' | 'seller_ledger' | 'refund_allocations' | 'refund_history' | 'refund_repairs'; count: number; hash: string}[];
  identityQualified: boolean; localCoverageQualified: boolean;
}
export interface BankRefundReconciliationEffects {
  financialExecutionAllowed: false; netFinancialResolutionQualified: false; financingAuthorized: false;
  holdReleaseAuthorized: false; sellerDebitAuthorized: false; buyerCreditAuthorized: false; bankArrivalVerified: false;
}
export interface BankRefundReconciliationReference {id: string; contentHash: string}
export interface BankRefundReconciliationCommand {
  action: 'capture_report' | 'record_instruction'; sourceHash: string; reportReference: BankRefundReconciliationReference | null;
  instruction: 'missing_evidence' | 'reconciliation_documented' | 'financial_review_preparation' | null;
  note: string; acknowledged: true;
}
interface EntryBase extends BankRefundReconciliationEffects {
  protocol: 'bank_financial_reconciliation_entry_v1'; id: string; actorId: string; transactionId: string; disputeId: string;
  requestId: string; command: BankRefundReconciliationCommand; recordedAt: string;
  nativeSourceHash: string; nativeSource: BankReconciliationNativeCapture;
}
export type BankRefundReconciliationEntry = EntryBase & ({
  kind: 'report'; nativeSourceMatchesAtCommit: boolean; currentNativeSourceHash: string;
  localEvidence: BankReconciliationLocalEvidence; report: BankFinancialGraph;
} | {
  kind: 'instruction'; reportReference: BankRefundReconciliationReference; reportCorpusHash: string;
  instruction: NonNullable<BankRefundReconciliationCommand['instruction']>; motivation: string; documentaryOnly: true;
});
export type BankRefundReconciliationHistoryRow = {qualification: 'native_documentary_entry'; reference: BankRefundReconciliationReference; entry: BankRefundReconciliationEntry} | {qualification: 'unknown'; entryId: string; entry: null};
export interface BankRefundReconciliationPreview extends BankRefundReconciliationEffects {
  protocol: 'bank_financial_reconciliation_preview_v1'; actorId: string; transactionId: string; disputeId: string;
  source: {sourceHash: string; qualification: 'native_current' | 'unknown'; capture: BankReconciliationNativeCapture};
  localEvidence: BankReconciliationLocalEvidence; selectedEntry: BankRefundReconciliationEntry | null;
  rows: BankRefundReconciliationHistoryRow[]; nextCursor: {lastId: string} | null;
  coverage: {inspected: number; limit: 20; hasMore: boolean; exhaustiveHistoricalReportsVerified: false} | null; readAt: string;
}
export interface BankRefundReconciliationReceipt extends BankRefundReconciliationEffects {
  protocol: 'bank_financial_reconciliation_command_v1'; actorId: string; transactionId: string; disputeId: string;
  requestId: string; command: BankRefundReconciliationCommand; payloadHash: string;
  state: 'unrecorded' | 'unknown' | 'received' | 'not_executed'; reason: string | null;
  reference: BankRefundReconciliationReference | null; recordedAt: string | null;
  result: ({kind: 'report' | 'instruction'; documentaryOnly: true} & BankRefundReconciliationEffects) | null;
}
export interface BankRefundReconciliationAttempt {
  version: 1; uid: string; transactionId: string; disputeId: string; requestId: string;
  capability: typeof BANK_REFUND_RECONCILIATION_CAPABILITY; command: BankRefundReconciliationCommand;
}
