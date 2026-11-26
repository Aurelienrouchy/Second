export interface WithdrawalTimingSource {
  protocol: 'withdrawal_timing_source_v1'; ownerId: string; withdrawalRequestId: string;
  sourceRevision: string | null; sourceHash: string; sourceQualification: 'qualified' | 'unknown';
  requestState: 'processing' | 'completed' | 'failed' | null; amountCents: number | null; currency: 'CAD' | null;
  observation: null | {protocol: 'withdrawal_payout_timing_v1'; providerStatus: 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled';
    arrivalDateSeconds: number | null; arrivalCalendarDate: string | null; arrivalQualification: 'provider_estimate' | 'unknown';
    observedAt: string; identityQualification: 'frozen_destination' | 'legacy_saved_payout'; sourceCurrent: boolean;
    bankReceiptVerified: false; arrivalGuaranteed: false};
  bankReceiptVerified: false; financialEffectAuthorized: false;
}
