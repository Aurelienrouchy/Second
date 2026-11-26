import type { ProductReviewEffects, ProductReviewReference, ProductReviewSource, ProductReviewWorkflowPreviewV2, ProductReviewCursor, ProductReviewScope } from './productReview';
import type { ProductReviewEvidenceReference } from './productReviewEvidence';
export interface ProductCommercialReturnReference {instructionId: string; contentHash: string}
export interface ProductCommercialReturnBasis {protocol: 'product_commercial_return_basis_v1'; transactionId: string; disputeId: string; buyerId: string; sellerId: string;
  instructionId: string; contentHash: string; reportedAt: string; initialReleaseAt: string; instructedAt: string; semanticSourceHash: string; parcelCapability?: 'product_review_parcel_v1'; commercialStatusAtInstruction?: 'delivered' | 'disputed'}
export interface ProductCommercialReturnPreview extends ProductReviewEffects {
  protocol: 'product_commercial_return_preview_v1'; actorId: string; scope: ProductReviewScope; transactionId: string; disputeId: string; returnRequestId: string | null;
  source: ProductReviewSource; sourceHash: string; semanticSourceHash: string; caseVersion: number; corpusHash: string; membersHash: string;
  contributionReferences: ProductReviewReference[]; evidenceReferences: ProductReviewEvidenceReference[]; coverage: ProductReviewWorkflowPreviewV2['coverage'];
  documentaryComplete: boolean; canInstruct: boolean; previewId: string | null; options: ProductCommercialReturnCommand['action'][];
  parcelCapability?: 'product_review_parcel_v1';
  admission: {protocol: 'product_commercial_return_guard_v1'; allowed: boolean; qualification: 'unknown' | 'no_current_instruction' | 'native_current_instruction';
    reference: ProductCommercialReturnReference | null; basis: ProductCommercialReturnBasis | null};
}
export interface ProductCommercialReturnCommand {transactionId: string; disputeId: string; returnRequestId: string | null; previewId: string; sourceHash: string;
  semanticSourceHash: string; caseVersion: number; corpusHash: string; membersHash: string; contributionReferences: ProductReviewReference[];
  evidenceReferences: ProductReviewEvidenceReference[]; action: 'maintain_review' | 'refuse_return' | 'instruct_return'; privateNote: string; partyMessage: string; acknowledged: true; parcelCapability?: 'product_review_parcel_v1'}
export interface ProductCommercialReturnInstruction extends ProductReviewEffects {instructionReference: ProductCommercialReturnReference; transactionId: string; disputeId: string; caseId: string;
  action: ProductCommercialReturnCommand['action']; partyMessage: string; sourceHash: string; semanticSourceHash: string; membersHash: string; corpusHash: string;
  caseVersion: number; recordedAt: string; privateNote?: string; contributionReferences?: ProductReviewReference[]; evidenceReferences?: ProductReviewEvidenceReference[]; currentInstructionVerified: false}
export interface ProductCommercialReturnPage extends ProductReviewEffects {protocol: 'product_commercial_return_instructions_page_v1'; actorId: string; transactionId: string; scope: ProductReviewScope;
  entries: ({qualification: 'native_commercial_return_instruction'; instruction: ProductCommercialReturnInstruction} | {qualification: 'unknown'; instructionId: string; instruction: null})[];
  readAt: string; nextCursor: ProductReviewCursor | null; coverage: {inspected: number; limit: 20; hasMore: boolean; exhaustiveHistoryVerified: false}}
