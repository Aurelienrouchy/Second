import type { ProductAuthenticityReportReference } from './productAuthenticityReport';
import type { ProductParcelReportReference } from './productParcelReport';
export type TransactionProblemReason = 'not_received_despite_delivered' | 'not_as_described' | 'damaged' | 'other';
export interface WholeSetDeclaration {
  protocol: 'whole_set_declaration_v1'; snapshotHash: string; claim: 'incomplete_set' | 'other_nonconformity';
  received: {status: 'described' | 'unknown'; description: string | null};
  missing: {status: 'described' | 'none_observed' | 'unknown'; description: string | null}; recourseScope: 'whole_transaction';
}
export interface WholeSetReportSource {
  protocol: 'whole_set_report_source_v1'; ownerId: string; transactionId: string;
  qualification: 'native_whole_set_snapshot' | 'not_a_set' | 'historical_unit_unrecorded' | 'unknown';
  source: {snapshotHash: string; articleId: string; saleUnit: 'set_as_one'; title: string; description: string} | null;
  physicalReceiptVerified: false; faultEstablished: false; financialEffect: 'none'; recourseScope: 'whole_transaction';
}
export interface WholeSetReportDraft {
  snapshotHash: string; claim: WholeSetDeclaration['claim'] | null;
  received: {status: WholeSetDeclaration['received']['status'] | null; description: string};
  missing: {status: WholeSetDeclaration['missing']['status'] | null; description: string};
}
export interface TransactionProblemAttempt { version: 1; uid: string; transactionId: string; requestId: string;
  reason: TransactionProblemReason; details: string; setDeclaration?: WholeSetDeclaration; productReview?: ProductAuthenticityReportReference | ProductParcelReportReference }
export interface TransactionProblemReceipt { protocol: 'transaction_problem_report_v1' | 'transaction_parcel_report_v1'; ownerId: string; transactionId: string;
  requestId: string; payloadHash: string; state: 'committed' | 'not_executed' | 'unrecorded'; committed: boolean; replay: boolean;
  disputeId: string | null; reportedAt: string | null; freezeCommitted: boolean; reason: string | null;
  admissionVerified: false; financialEffect: 'none'; externalRecourseDeadlineExtended: false; setDeclaration?: WholeSetDeclaration; productReview?: ProductAuthenticityReportReference | ProductParcelReportReference;
  recourseScope?: 'unknown' | 'buyer_delivery' | 'seller_return_parcel' | 'parcel_investigation'}
export interface TransactionProblemObservation { attempt: TransactionProblemAttempt | null; receipt: TransactionProblemReceipt | null }
