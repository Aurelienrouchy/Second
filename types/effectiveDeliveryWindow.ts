export interface EffectiveDeliveryWindow {
  protocol: 'effective_delivery_window_v1'; ownerId: string; transactionId: string; sourceRevision: string; sourceHash: string;
  policy: null | {policyVersion: 'shipping_purchase_2026_01' | 'shipping_purchase_2026_02'; policyHash: string; acceptedAt: string; parameters: {fundsHoldMs: number; deliveryProtectionMs: number; nonShipmentMs: number}};
  qualification: 'native_original_window' | 'native_corrected_window' | 'unknown';
  window: null | {clockBasis: 'qualified_provider_delivery_event'; occurredAt: string; originalDeliveryAt: string; originalRecordedAt: string;
    originalFundsReleaseAt: string; originalProtectionEndsAt: string; effectiveFundsReleaseAt: string; effectiveProtectionEndsAt: string;
    correctionId: string | null; correctionDecidedAt: string | null};
  guardQualification: 'native_current' | 'unknown'; blockers: string[]; canReportProblemNow: boolean; canPrepareReturnNow: boolean;
  financialEffectAuthorized: false; inventoryReleaseAuthorized: false; parcelPossessionVerified: false;
}
