import type { ReturnToSenderCase } from '@/types/returnToSender';
import type { IssueRefundResult } from '@/types/transaction';

export interface AdminReturnToSenderFinancialResume {refundIntentId: string; refundAttemptId: string}
export interface AdminReturnToSenderResumeSource {
  protocol: 'admin_return_to_sender_resume_source_v1'; actorUid: string; transactionId: string; sourceRevision: string | null;
  qualification: 'qualified' | 'review_required'; resume: AdminReturnToSenderFinancialResume | null; sourceStatus: string | null;
  financial: IssueRefundResult | null; options: AdminReturnToSenderFinancialOptions | null;
  inventoryPermissionGranted: false; physicalPossession: 'unknown'; newRefundPermissionGranted: false; bankArrivalVerified: false;
}

export interface AdminReturnToSenderCaseReference {caseId: string; caseRevision: string; caseHash: string}
export interface AdminReturnToSenderFinancialOptions {
  refundScope: 'full_original_payment'; relistArticle: false; extraSellerDebitCents: 0; returnCostDeductionCents: 0;
}
export interface AdminReturnToSenderFinancialSource {
  protocol: 'return_to_sender_financial_source_v1'; caseReferences: AdminReturnToSenderCaseReference[];
  caseSetHash: string; financialSourceHash: string; authorizationSourceHash: string;
  reports: (ReturnToSenderCase & {caseRevision: string})[]; qualification: 'qualified';
  financialPermissionScope: 'full_original_refund_only'; options: AdminReturnToSenderFinancialOptions;
  inventoryPermissionGranted: false; physicalPossession: 'unknown'; guardReleased: false;
}
export interface AdminReturnToSenderFinancialReference {
  protocol: 'return_to_sender_financial_reference_v1'; caseReferences: AdminReturnToSenderCaseReference[];
  caseSetHash: string; financialSourceHash: string; authorizationSourceHash: string; cause: string;
  options: AdminReturnToSenderFinancialOptions;
}
