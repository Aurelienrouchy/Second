import type { ProductReviewContext, ProductReviewEffects, ProductReviewRole, ProductReviewScope, ProductReviewCursor, ProductReviewPageBase } from './productReview';
export type ProductReviewEvidenceType = 'received_item_photo' | 'supporting_document_image' | 'expertise_image';
export interface ProductReviewPreparedFile {
  sha256: string; byteLength: number; contentType: 'image/jpeg'; width: number; height: number;
  preparation: 'prepareImageForUpload'; qualityDeclared: 0.75;
}
export interface ProductReviewEvidenceCommand {context: ProductReviewContext; contributionId: string; contributionHash: string; sourceHash: string;
  typeDeclared: ProductReviewEvidenceType; file: ProductReviewPreparedFile}
export interface ProductReviewEvidencePreview extends ProductReviewEffects {
  protocol: 'product_review_evidence_preview_v1'; actorId: string; context: ProductReviewContext; caseId: string; contributionId: string;
  contributionHash: string; sourceHash: string; typesDeclared: ProductReviewEvidenceType[]; contentType: 'image/jpeg'; maxBytes: 2097152;
  maxDimension: 1200; preparation: 'prepareImageForUpload'; qualityDeclared: 0.75; uploadPermissionGranted: false;
}
export interface ProductReviewEvidenceReference {id: string; contentHash: string; actorId: string; actorRole: ProductReviewRole;
  contributionId: string; contributionHash: string; sourceHash: string; generation: string; crc32c: string; sha256: string;
  typeDeclared: ProductReviewEvidenceType; state: 'received' | 'stored_requires_review'; receiptHash: string}
export interface ProductReviewFileProof {generation: string; crc32c: string; sha256: string; byteLength: number; contentType: 'image/jpeg'; width: number; height: number}
export type ProductReviewEvidenceState = 'unrecorded' | 'reserved' | 'upload_unknown' | 'received' | 'stored_requires_review' | 'not_executed';
export type ProductReviewEvidenceReason = 'requester_neutralized' | 'source_changed' | 'future_effects_neutralized' | 'upload_retry_limit_reached';
export interface ProductReviewEvidenceReceipt extends ProductReviewEffects {
  protocol: 'product_review_evidence_command_v1'; actorId: string; requestId: string; payloadHash: string; caseId: string; contributionId: string;
  evidenceId: string; actorRole: ProductReviewRole | null; futureEffectsNeutralized: boolean; sendAttempts: number; state: ProductReviewEvidenceState;
  reason: ProductReviewEvidenceReason | null; evidenceHash: string | null; storedNativeVerified: boolean; attachedToContributionVerified: boolean;
  fileProof: ProductReviewFileProof | null; recordedAt: string | null; currentBlobAvailabilityVerified: false; imageDecodeVerified: false; issuerOriginalVerified: false;
}
export interface ProductReviewEvidence extends ProductReviewEffects, ProductReviewFileProof {
  protocol: 'product_review_evidence_v1'; evidenceId: string; contentHash: string; actorId: string; actorRole: ProductReviewRole;
  contributionId: string; typeDeclared: ProductReviewEvidenceType; state: 'received' | 'stored_requires_review'; sourceHash: string; recordedAt: string;
  currentBlobAvailabilityVerified: false; imageDecodeVerified: false; issuerOriginalVerified: false;
}
export type ProductReviewEvidenceEntry = {qualification: 'native_stored_file'; evidence: ProductReviewEvidence} | {qualification: 'unknown'; evidenceId: string; evidence: null};
export interface ProductReviewEvidencePage extends ProductReviewEffects {
  protocol: 'product_review_evidence_page_v1'; actorId: string; scope: ProductReviewScope; caseId: string; entries: ProductReviewEvidenceEntry[];
  nextCursor: ProductReviewCursor | null; readAt: string; coverage: ProductReviewPageBase['coverage']; otherActorsOriginalsVisible: boolean;
}
export interface ProductReviewEvidencePixels extends ProductReviewEffects {
  protocol: 'product_review_evidence_file_v1'; actorId: string; evidenceId: string; contentHash: string; dataUrl: string;
  generation: string; crc32c: string; sha256: string; imageDecodeVerified: false; issuerOriginalVerified: false;
}
/** Local private JPEG path and metadata only: the Base64 payload is never persisted in AsyncStorage. */
export interface ProductReviewEvidenceAttempt {version: 1; uid: string; requestId: string; context: ProductReviewContext;
  command: ProductReviewEvidenceCommand; preparedUri: string; materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1'}
