import type { PurchaseRefundTerms } from '@/types/purchaseRefund';
export type RefundRepairAction = 'repair_original_method' | 'record_external_instruction';
export interface RefundRepairCommand {
  transactionId: string; refundIntentId: string; action: RefundRepairAction; previewId: string; sourceHash: string; sourceRevision: string;
  terminalRefundId: string; terminalAttemptId: string; amountCents: number; currency: 'CAD'; note: string; partyMessage: string; acknowledged: true;
}
export interface RefundRepairAttempt {version: 1; uid: string; requestId: string; command: RefundRepairCommand}
export interface RefundRepairEffects {
  walletCreditAuthorized: false; sellerDebitAuthorized: false; newReserveAuthorized: false; inventoryPermissionGranted: false;
  shippingPermissionGranted: false; bankArrivalVerified: false; externalPaymentAuthorized: false;
}
export interface RefundRepairProviderRefund {
  id: string; paymentIntentId: string | null; chargeId: string | null; amountCents: number; currency: string; status: string | null;
  failureReason: string | null; failureBalanceTransactionId: string | null; failureFundsReturnedToStripe: boolean;
}
export interface RefundRepairProvider {
  qualification: 'current_original_method_capacity' | 'unknown'; reason: string | null; paymentIntentId: string; chargeId: string;
  amountCapturedCents: number | null; amountRefundedCents: number | null; capacityCents: number | null; refunds: RefundRepairProviderRefund[];
  proofHash: string; observedAt: string;
}
export interface RefundRepairSource extends RefundRepairEffects {
  protocol: 'purchase_refund_repair_source_v1'; transactionId: string; refundIntentId: string; sourceRevision: string | null; sourceHash: string;
  qualification: 'native_reserved_obligation' | 'unknown'; refundAttemptId: string; originalRefundId: string; paymentIntentId: string; currency: 'CAD';
  historical: boolean; allocation: {refundIntentId: string; reservationHash: string; basisHash: string; termsHash: string; terms: PurchaseRefundTerms};
  obligationCardCents: number; remainingCardCents: number | null; cardAmountQualification: 'current_provider_set' | 'unknown'; localMovementsVerified: boolean;
  localWalletCreditCents: number | null; localSellerDebitCents: number | null; localSellerDebtCents: number | null; localReconciliationRequired: boolean;
  originalReservationPreserved: true; bankReviewRequired: boolean; riskReviewRequired: boolean; historyComplete: boolean; terminalRefundId: string | null; terminalAttemptId: string;
  provider: RefundRepairProvider | null;
  repairHistory: {repairId: string; ordinal: number; providerRefundId: string | null; providerStatus: string | null; state: string; amountCents: number; reservedAt: string; observedAt: string | null}[];
  canRepairOriginalMethodNow: boolean; canRecordExternalInstructionNow: boolean; externalChannelQualification: 'not_defined';
}
export interface RefundRepairFinancial {
  repairId: string; attemptId: string; refundId: string | null; state: string; providerStatus: string | null; amountCents: number;
  cardRepairedCents: number | null; observedAt: string | null; bankArrivalVerified: false; localMovementsRepeated: false;
}
export interface RefundRepairReceipt extends RefundRepairEffects {
  protocol: 'purchase_refund_repair_command_v1'; actorId: string; requestId: string; command: RefundRepairCommand; payloadHash: string;
  state: 'unrecorded' | 'reserved' | 'committed' | 'not_executed'; reason: string | null; repairId: string | null; recordedAt: string | null; financial: RefundRepairFinancial | null;
}
export interface RefundRepairObservation extends RefundRepairEffects {
  protocol: 'purchase_refund_repair_observation_v1'; actorId: string; scope: 'own' | 'admin'; transactionId: string;
  sourceRevision: string | null; selected: RefundRepairSource | null; reason: 'repair_native_source_unknown' | null;
  candidates: {refundIntentId: string; qualification: 'native_allocation_reference' | 'unknown'; historical: boolean}[];
  cursor: {lastId: string} | null;
  instructions: {entries: {instructionId: string; refundIntentId: string; action: RefundRepairAction; partyMessage: string; recordedAt: string; externalPaymentAuthorized: false; fundsReceivedVerified: false}[]; cursor: {lastId: string} | null};
  historicalReadOnly: true;
}
export interface RefundRepairPreview extends RefundRepairEffects {
  protocol: 'purchase_refund_repair_preview_v1'; actorId: string; previewId: string; action: RefundRepairAction; source: RefundRepairSource;
}

// Additive manual restitution lane. V1 tuples and their journal remain exact.
export const REFUND_REPAIR_MANUAL_CAPABILITY = 'purchase_refund_external_manual_v1' as const;
export type RefundRepairManualAction = 'prepare_manual_bank_transfer' | 'attest_manual_bank_transfer' | 'void_unexecuted_manual_instruction';
export type RefundRepairManualState = 'none' | 'prepared' | 'manual_operator_attested' | 'voided' | 'reconciliation_required' | 'unknown';
export type RefundRepairManualPurpose = 'beneficiary_verification' | 'payment_execution';
export interface RefundRepairManualEvidenceReference {evidenceId: string; generation: string; sha256: string; contentHash: string}
export interface RefundRepairManualEffects {
  bankArrivalVerified: false; stripeSettlementGranted: false; walletCreditAuthorized: false; sellerDebitAuthorized: false;
  inventoryPermissionGranted: false; shippingPermissionGranted: false;
}
export interface RefundRepairManualCommand {
  transactionId: string; refundIntentId: string; action: RefundRepairManualAction; previewId: string; sourceHash: string; sourceRevision: string;
  amountCents: number; currency: 'CAD'; beneficiaryId: string; instructionId: string | null;
  beneficiaryEvidence: RefundRepairManualEvidenceReference | null; paymentEvidence: RefundRepairManualEvidenceReference | null;
  attestation: {version: 'manual_bank_transfer_human_v1'; beneficiaryIdentityAndDestinationVerified: boolean;
    transferExecutedAndReceiptVerified: boolean; neverExecuted: boolean};
  note: string; partyMessage: string; acknowledged: true;
}
export interface RefundRepairManualAttempt {version: 2; uid: string; requestId: string; command: RefundRepairManualCommand}
export interface RefundRepairManualSource extends RefundRepairManualEffects {
  protocol: 'purchase_refund_external_manual_source_v1'; transactionId: string; refundIntentId: string; sourceHash: string; sourceRevision: string | null;
  beneficiaryId: string; amountCents: number; currency: 'CAD'; remainingCents: number | null; localMovementsVerified: boolean;
  originalRailTerminalVerified: boolean; bankReviewRequired: boolean; riskReviewRequired: boolean; state: RefundRepairManualState;
  instructionId: string | null; instructionHash: string | null; beneficiaryEvidence: RefundRepairManualEvidenceReference | null;
  paymentEvidence: RefundRepairManualEvidenceReference | null; canPrepare: boolean; canAttest: boolean; canVoid: boolean; reason: string | null;
  verificationBasis: 'human_operator_attestation' | null;
}
export interface RefundRepairManualObservation {
  protocol: 'purchase_refund_external_manual_observation_v1'; actorId: string; scope: 'own' | 'admin'; transactionId: string;
  sourceRevision: string | null; selected: RefundRepairManualSource | null; reason: string | null;
}
export interface RefundRepairManualPreview {
  protocol: 'purchase_refund_external_manual_preview_v1'; actorId: string; previewId: string; action: RefundRepairManualAction;
  source: RefundRepairManualSource; bankArrivalVerified: false; stripeSettlementGranted: false;
}
export interface RefundRepairManualReceipt extends RefundRepairManualEffects {
  protocol: 'purchase_refund_external_manual_command_v1'; actorId: string; requestId: string; command: RefundRepairManualCommand; payloadHash: string;
  state: 'unrecorded' | 'committed' | 'not_executed'; reason: string | null; instructionId: string | null;
  manualState: RefundRepairManualState; recordedAt: string | null; verificationBasis: 'human_operator_attestation' | null;
}
export interface RefundRepairManualFile {sha256: string; byteLength: number; contentType: 'image/jpeg'; width: number; height: number}
export interface RefundRepairManualEvidenceContext {
  transactionId: string; refundIntentId: string; previewId: string; sourceHash: string; sourceRevision: string;
  purpose: RefundRepairManualPurpose; instructionId: string | null;
}
export interface RefundRepairManualEvidenceReceipt {
  protocol: 'purchase_refund_external_manual_evidence_v1'; actorId: string; requestId: string; transactionId: string; refundIntentId: string;
  beneficiaryId: string | null; amountCents: number | null; currency: 'CAD'; purpose: RefundRepairManualPurpose | null; instructionId: string | null;
  inputHash: string; state: 'unrecorded' | 'upload_unknown' | 'stored' | 'stored_requires_review' | 'not_executed'; reason: string | null;
  evidence: RefundRepairManualEvidenceReference | null; recordedAt: string | null;
  externalAuthenticityVerified: false; bankArrivalVerified: false;
}
export interface RefundRepairManualEvidencePixels {
  protocol: 'purchase_refund_external_manual_evidence_file_v1'; actorId: string; transactionId: string; refundIntentId: string;
  evidence: RefundRepairManualEvidenceReference; purpose: RefundRepairManualPurpose; dataUrl: string; bankArrivalVerified: false;
}

export interface RefundRepairManualEvidenceAttempt {version: 2; uid: string; requestId: string; context: RefundRepairManualEvidenceContext;
  file: RefundRepairManualFile; inputHash: string; beneficiaryId: string; amountCents: number}
