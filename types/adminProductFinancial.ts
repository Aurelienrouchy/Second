import type { ProductReviewEvidenceReference } from './productReviewEvidence';
import type { ProductReviewRole, ProductReviewWorkflowPreviewV2 } from './productReview';
import type { AdminReturnToSenderResumeSource } from './adminReturnToSenderFinancial';
import type { ProductParcelAssessment } from './productParcelReview';
import type { LateCommercialReference, LateCommercialFinancialBasis } from './lateCommercialRecourse';

export interface AdminProductFinancialReference {
  caseId: string; topic: 'authenticity' | 'nonconformity' | 'parcel_delivery'; caseVersion: number; caseSourceHash: string;
  issueId: string; issueHash: string; corpusHash: string; membersHash: string; authorizationSourceHash: string;
  materialCapability?: 'product_review_material_v1';
  parcelCapability?: 'product_review_parcel_v1';
  lateCommercial?: LateCommercialReference;
}
export interface AdminProductFinancialSource {
  protocol: 'product_financial_source_v1'; reference: AdminProductFinancialReference;
  issue: {eventId: string; contentHash: string; caseVersion: number; result: 'review_documented' | 'information_incomplete';
    text: string; motivation: string | null; sourceHash: string; recordedAt: string};
  contributionReferences: {id: string; contentHash: string; actorId: string; actorRole: ProductReviewRole;
    topic: string; qualification: 'native_contribution'}[];
  evidenceReferences: ProductReviewEvidenceReference[]; coverage: ProductReviewWorkflowPreviewV2['coverage'];
  authenticityVerified: false; expertiseVerified: false; newRefundPermissionGranted: false; inventoryPermissionGranted: false;
  lateCommercial?: LateCommercialFinancialBasis;
  materialReturnReview?: {qualification: 'native_parcel_with_actor_return_declaration' | 'not_applicable' | 'unknown';
    qualifiesOwnReturnForFinancialReview: boolean; physicalContentsVerified: false; faultEstablished: false};
  parcelReview?: {integrityQualified: true; documentaryComplete: boolean; assessment: ProductParcelAssessment; qualification: 'native_operator_assessment_of_available_sources'; responsibilityEstablished: false; insurancePaymentPromised: false; costDecisionGranted: false};
  parcelReturnReview?: {qualifiesOwnReturnForFinancialReview: boolean; qualification: 'native_parcel_with_actor_return_declaration' | 'unknown'; physicalContentsVerified: false; faultEstablished: false};
}
export interface AdminProductResumeSource extends Omit<AdminReturnToSenderResumeSource, 'protocol'> {
  protocol: 'admin_product_review_resume_source_v1'; productReviewCaseId: string; productReviewTopic: 'authenticity' | 'nonconformity' | 'parcel_delivery';
  authenticityVerified: false; expertiseVerified: false;
  materialCapability?: 'product_review_material_v1';
  parcelCapability?: 'product_review_parcel_v1';
}
