export const FINANCIAL_RECOVERY_STATUS_CAPABILITY = 'financial_recovery_status_v1';

/** Observation of the independent control; never an authority to resume money. */
export interface FinancialRecoveryStatus {
  protocol: typeof FINANCIAL_RECOVERY_STATUS_CAPABILITY;
  mode: 'normal' | 'draining' | 'recovery' | 'unavailable';
  epoch: string | null;
  previousEpoch: string | null;
  controlGeneration: string | null;
  admissionControlOpen: boolean;
  reason: string | null;
  sourceQualification: 'required_per_source';
  drainState: 'not_measured';
  reopeningAuthority: 'independent_iam';
  actorId: string;
  observedAt: string;
  financialEffectsApplied: false;
}
