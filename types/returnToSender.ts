export const RETURN_TO_SENDER_STATEMENT_VERSION = 'return_to_sender_report_v1' as const;
export const RETURN_TO_SENDER_STATEMENT = 'Je signale un retour à l’expéditeur ; mon récit doit être vérifié par le support.';
export interface ReturnToSenderSourceReference {
  orderRevision: string; sourceHash: string; financialSourceHash: string;
  capture: null | {captureId: string; displayHash: string; sourceHash: string; readVersion: number};
  captureQualification: 'native_capture' | 'absent' | 'historical_unknown';
}
export interface ReturnToSenderFinancialRecording {
  refundSource: 'absent' | 'record_present_unverified'; releaseSource: 'absent' | 'native_timestamp_recorded' | 'historical_unknown';
  moneyReturnedVerified: false; bankReceiptVerified: false; financialEffectAuthorized: false;
}
export interface ReturnToSenderSource extends ReturnToSenderSourceReference {
  protocol: 'return_to_sender_source_v1'; ownerId: string; transactionId: string; financialRecording: ReturnToSenderFinancialRecording;
  currentCapture: boolean; transportContext: boolean; reportVerified: false; returnToSenderVerified: false;
  recipientReceiptVerified: false; contentsVerified: false; financialEffectAuthorized: false; inventoryReleaseAuthorized: false;
}
export interface ReturnToSenderCommand {transactionId: string; narrative: string; statementVersion: typeof RETURN_TO_SENDER_STATEMENT_VERSION; accepted: true; source: ReturnToSenderSourceReference}
export interface ReturnToSenderAttempt {version: 1; uid: string; requestId: string; command: ReturnToSenderCommand}
export interface ReturnToSenderReceipt {
  protocol: 'return_to_sender_command_v1'; ownerId: string; requestId: string; transactionId: string; payloadHash: string;
  state: 'unrecorded' | 'committed' | 'not_executed'; caseId: string | null; recordedAt: string | null;
  reason: null | 'command_neutralized' | 'source_changed' | 'transport_context_unqualified' | 'guard_source_unqualified' | 'case_capacity_requires_review';
  financialEffectAuthorized: false; inventoryReleaseAuthorized: false;
}
export interface ReturnToSenderCase {
  protocol: 'return_to_sender_case_v1'; caseId: string; transactionId: string; reporterId: string; version: 1; narrative: string;
  statementVersion: typeof RETURN_TO_SENDER_STATEMENT_VERSION; source: ReturnToSenderSourceReference; recordedAt: string;
  caseRevision: string | null; caseHash: string; reportVerified: false; returnToSenderVerified: false; recipientReceiptVerified: false;
  contentsVerified: false; financialEffectAuthorized: false; inventoryReleaseAuthorized: false; guardReleased: false;
}
export interface ReturnToSenderCases {
  protocol: 'return_to_sender_cases_v1'; ownerId: string; transactionId: string; sourceRevision: string | null; guardPresent: boolean;
  financialSourceHash: string; financialRecording: ReturnToSenderFinancialRecording;
  items: ReturnToSenderCase[]; financialEffectAuthorized: false; inventoryReleaseAuthorized: false;
}
export type ReturnToSenderReport = Omit<ReturnToSenderCase, 'caseRevision' | 'caseHash'>;
export interface ReturnToSenderSupportReference {
  kind: 'return_to_sender_report'; transactionId: string; caseId: string; caseRevision: string; caseHash: string;
  financialSourceHash: string; orderRevision: string;
}
export interface ReturnToSenderSupportSource {
  protocol: 'return_to_sender_support_source_v1'; reference: ReturnToSenderSupportReference; report: ReturnToSenderReport;
  financialRecording: ReturnToSenderFinancialRecording; recipientReceiptVerified: false; contentsVerified: false;
  financialEffectAuthorized: false; inventoryReleaseAuthorized: false;
}
