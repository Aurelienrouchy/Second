export interface ProductAuthenticityReportReference {
  caseId: string; caseVersion: number; caseSourceHash: string; contributionId: string;
  contributionHash: string; sourceHash: string; topic: 'authenticity' | 'nonconformity'; materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1';
}
export interface ProductAuthenticityReportSource {
  protocol: 'product_authenticity_report_source_v1' | 'product_material_report_source_v1'; ownerId: string; transactionId: string;
  productReview: ProductAuthenticityReportReference | null;
  authenticityVerified: false; faultEstablished: false; financialEffect: 'none'; freezePermissionGranted: false;
}
