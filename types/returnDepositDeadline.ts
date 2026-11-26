export const RETURN_DEPOSIT_DEADLINE_CAPABILITY = 'return_deposit_deadline_v1' as const;
export const RETURN_DEPOSIT_TERMS = {
  protocol: 'return_deposit_terms_v1', calendarDays: 7, timeZone: 'America/Toronto',
  clockBasis: 'first_native_document_availability', timeOfDay: 'same_local_time',
  ambiguousOrMissingLocalTime: 'human_review', motivatedExtension: true,
  elapsedTimeDecidesFault: false, financialEffectAuthorized: false,
} as const;
export type ReturnDepositTerms = typeof RETURN_DEPOSIT_TERMS;
/** SHA-256 of the immutable V1 terms using the existing returnHash canonical form. */
export const RETURN_DEPOSIT_TERMS_HASH = '0087b501fed2c039e174ec810bf5d32b39b55bd41e73998c8069e5d7fe82ab4e';
export type ReturnDepositDeadlineScope = 'owner' | 'operator';
export interface ReturnDepositDeadlineEffects {
  financialEffectAuthorized: false; refundDecisionGranted: false; faultEstablished: false;
  shippingPermissionGranted: false; contentsReceivedConfirmed: false;
}
/** make_available is retained only to service an exact historical intent. */
export interface ReturnDepositDeadlineCommand {
  action: 'make_available' | 'extend'; sourceHash: string; expectedVersion: number; expectedLabelId: string;
  newDueAtMs: number | null; motivation: string | null; partyMessage: string | null; acknowledged: true;
}
export interface ReturnDepositDeadlinePreview extends ReturnDepositDeadlineEffects {
  protocol: 'return_deposit_deadline_preview_v1'; transactionId: string; ownerId: string;
  role: 'buyer' | 'seller' | 'operator'; source: {sourceHash: string; version: number | null};
  terms: ReturnDepositTerms | null; termsAccepted: boolean;
  qualification: 'qualified' | 'unknown' | 'historical_terms_not_recorded';
  clock: {version: number; availableAt: string; dueAt: string | null; baseLabelId: string;
    currentLabelId: string | null; currentLabelMatches: boolean; reviewRequired: boolean;
    extensions: {recordedAt: string; newDueAt: string; motivation: string | null; partyMessage: string}[]} | null;
  currentLabelId: string | null; canMakeAvailable: false; canExtend: boolean;
  physicalEvidence: {carrierDepositVerified: false; parcelDeliveredAt: string | null;
    parcelDeliveryDeclared: boolean; contentsReceivedConfirmed: false};
}
export interface ReturnDepositDeadlineReceipt extends ReturnDepositDeadlineEffects {
  protocol: 'return_deposit_deadline_receipt_v1'; transactionId: string; ownerId: string; requestId: string;
  command: ReturnDepositDeadlineCommand; payloadHash: string;
  state: 'absent' | 'committed' | 'not_executed' | 'neutralized'; recordedAt: string | null;
  reason: string | null; clockVersion: number | null;
}
export interface ReturnDepositDeadlineAttempt {
  version: 1; uid: string; transactionId: string; scope: ReturnDepositDeadlineScope; requestId: string;
  capability: typeof RETURN_DEPOSIT_DEADLINE_CAPABILITY; payloadHash: string; command: ReturnDepositDeadlineCommand;
}
