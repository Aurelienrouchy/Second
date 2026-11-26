export interface SwapHoldSource {
  state: 'no_topup' | 'held' | 'release_recorded' | 'review_required';
  reason: null | 'commercial_dispute' | 'financial_source_reconciliation' | 'reception_source_reconciliation' | 'hold_clock_unqualified';
  amountCents: number | null; currency: 'CAD'; amountBasis: 'observed_swap_hold' | 'recorded_swap_release';
  financialQualification: 'native_linked_movements' | 'unknown'; releaseReceiptQualification: 'native_receipt' | 'legacy_linked_movement' | 'unknown';
  startedAt: string | null; initialDeadlineAt: string | null;
  startQualification: 'native_timestamp' | 'unknown'; deadlineQualification: 'native_timestamp' | 'unknown';
  deadlineState: 'future' | 'elapsed' | 'unknown'; bothReceptionsAt: string | null;
  receptionsQualification: 'native_participant_confirmations' | 'unknown';
}
export interface SwapHoldReview {
  protocol: 'swap_hold_review_v1'; ownerId: string; swapId: string; readAt: string;
  role: 'payer' | 'payee' | 'participant_unknown'; currentSource: SwapHoldSource;
  reviewQualification: 'observed' | 'absent' | 'unqualified';
  review: null | {protocol: 'swap_hold_observation_v1'; observationId: string; observedAt: string; currentSourceMatches: boolean;
    source: SwapHoldSource; resolutionState: 'unknown'; legalMaximumDeadlineAt: null; financialPermission: false; action: 'contactSupport'};
  resolutionState: 'unknown'; legalMaximumDeadlineAt: null; financialPermission: false;
}

export interface SwapFundReleaseDecision {
  id: string; revision: string; sourceHash: string;
  protocol: 'swap_funds_released_v1'; sourceKind: 'swap'; swapId: string; transactionId: null;
  decisionType: 'funds_released';
  criteria: {
    status: 'completed'; disputed: false | null; heldAt: string; initialDeadlineAt: string;
    bothReceptionsAt: string; releasedCents: number; currency: 'CAD'; swapSourceRevision: string;
  };
  result: string; executedAt: string; internalReleaseRecorded: true; externalPayoutVerified: false;
}
interface SwapFundReleaseLogBase {
  ok: true; protocol: 'swap_fund_release_log_v1'; ownerId: string; swapId: string;
  sourceKind: 'swap'; coverage: 'recorded_entries_only'; absenceOfDecisionVerified: false;
  financialExecutionCoverageVerified: false; completeHistory: false;
}
export type SwapFundReleaseLog = SwapFundReleaseLogBase & (
  { journalState: 'recorded'; entry: SwapFundReleaseDecision } |
  { journalState: 'not_recorded' | 'unqualified'; entry: null }
);
