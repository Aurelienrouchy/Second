import type { TransportReview } from '@/types/transportReview';
import type { AdminReturnToSenderFinancialOptions } from '@/types/adminReturnToSenderFinancial';
export interface AdminTransportCaseReference {reviewId: string; reviewRevision: string; reviewHash: string}
export interface AdminTransportFinancialSource {
  protocol: 'transport_financial_source_v1'; kind: 'delivery_correction' | 'carrier_exception'; review: TransportReview;
  caseReferences: AdminTransportCaseReference[]; caseSetHash: string; financialSourceHash: string; authorizationSourceHash: string;
  qualification: 'qualified'; financialPermissionScope: 'full_original_refund_only'; options: AdminReturnToSenderFinancialOptions;
  financialEffectAuthorized: false; inventoryReleaseAuthorized: false; parcelPossessionVerified: false;
}
export interface AdminTransportFinancialReference {
  protocol: 'transport_financial_reference_v1'; kind: 'delivery_correction' | 'carrier_exception'; reviewId: string; reviewRevision: string; reviewHash: string;
  caseReferences: AdminTransportCaseReference[]; caseSetHash: string; financialSourceHash: string; authorizationSourceHash: string;
  cause: string; options: AdminReturnToSenderFinancialOptions;
}
