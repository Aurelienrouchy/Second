export interface ProductParcelReportReference {caseId: string; caseVersion: number; caseSourceHash: string; contributionId: string; contributionHash: string; sourceHash: string;
  topic: 'parcel_delivery'; parcelCapability: 'product_review_parcel_v1'; actorRole: 'buyer' | 'seller'; leg: 'forward' | 'return'}
export interface ProductParcelReportSource {protocol: 'product_parcel_report_source_v1'; ownerId: string; transactionId: string; productReview: ProductParcelReportReference | null;
  physicalReceiptVerified: false; faultEstablished: false; financialEffect: 'none'; freezePermissionGranted: false}
