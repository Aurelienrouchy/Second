import type { ProductReviewEffects, ProductReviewSource, ProductReviewReference, ProductReviewCursor, ProductReviewScope, ProductReviewWorkflowPreviewV2 } from './productReview';
import type { ProductReviewEvidenceReference } from './productReviewEvidence';
export type ProductPhysicalContext = {kind: 'order'; id: string};
/** Local qualification of the exact native documentary read; never a physical certification. */
export interface ProductPhysicalDocumentaryAdmission {
  key: string; uid: string; context: ProductPhysicalContext; scope: ProductReviewScope; sourceHash: string; corpusHash: string;
  assertCurrent: () => void; revalidate: () => Promise<void>;
  materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1';
}
export type ProductPhysicalAction = 'maintain_stop' | 'allow_forward_only' | 'allow_return_only' | 'no_reship_separate_handling';
export type ProductPhysicalCriterion = 'manufacturer_model_lot' | 'recall_applicability' | 'corrective_action' | 'hygiene_condition' | 'route_handling_limits' | 'documentation_limits';
export type ProductPhysicalDocument = 'hc_recalls' | 'hc_second_hand';
export interface ProductPhysicalAssessment {criterion: ProductPhysicalCriterion; qualification: 'unknown' | 'declared' | 'examined' | 'not_applicable'; summary: string}
export interface ProductPhysicalCurrentInstruction {
  protocol: 'product_physical_current_instruction_v1'; instructionId: string; contentHash: string; action: ProductPhysicalAction; leg: 'forward' | 'return' | 'none';
  partyMessage: string; separateHandlingSummary: string | null; recordedAt: string; appliesToCurrentSources: boolean; currentInstructionVerified: boolean;
  physicalComplianceVerified: false; financialEffectAuthorized: false; shippingPermissionGranted: false;
}
export interface ProductPhysicalPreview extends ProductReviewEffects {
  protocol: 'product_physical_preview_v1'; parcelCapability?: 'product_review_parcel_v1'; materialCapability?: 'product_review_material_v1'; actorId: string; scope: ProductReviewScope; context: ProductPhysicalContext; caseId: string;
  source: ProductReviewSource; semanticSourceHash: string; caseVersion: number; guardQualification: 'native_current_signals' | 'unknown'; guardVersion: number | null;
  signalReferences: {id: string; contentHash: string | null; qualified: boolean}[]; routes: {forward: string | null; return: string | null};
  referenceSet: {protocol: 'product_physical_references_v1'; documents: {id: ProductPhysicalDocument; url: string}[]; criteria: ProductPhysicalCriterion[]; exhaustiveLegalGuidanceVerified: false; contentFetchedNow: false}; referenceSetHash: string;
  documentaryCorpus: {hash: string; membersHash: string; contributionReferences: ProductReviewWorkflowPreviewV2['contributionReferences']; evidenceReferences: ProductReviewWorkflowPreviewV2['evidenceReferences']};
  coverage: ProductReviewWorkflowPreviewV2['coverage']; canConsiderRouteForSources: boolean; options: ProductPhysicalAction[];
  currentForwardAllowedBySafety: boolean; currentReturnAllowedBySafety: boolean; decisionPermissionGranted: false; physicalComplianceVerified: false;
  currentInstruction: {qualification: 'unrecorded' | 'unknown' | 'historical_sources_changed' | 'native_current_instruction'; instruction: ProductPhysicalCurrentInstruction | null};
  fundsFrozenBySafetySignal: false; commercialHandlingIsSeparate: true;
}
export interface ProductPhysicalCommand {
  parcelCapability?: 'product_review_parcel_v1'; materialCapability?: 'product_review_material_v1';
  context: ProductPhysicalContext; sourceHash: string; semanticSourceHash: string; caseVersion: number; guardVersion: number | null;
  signalReferences: ProductReviewReference[]; action: ProductPhysicalAction; leg: 'forward' | 'return' | 'none'; routeSourceHash: string | null;
  assessments: ProductPhysicalAssessment[]; privateNote: string; partyMessage: string; separateHandlingSummary: string | null;
  referenceSetHash: string; documentsConsidered: ProductPhysicalDocument[]; acknowledged: true;
  documentaryCorpus: {hash: string; membersHash: string; contributionReferences: ProductReviewReference[]; evidenceReferences: ProductReviewEvidenceReference[]};
}
export interface ProductPhysicalReceipt extends ProductReviewEffects {
  protocol: 'product_physical_command_v1'; actorId: string; requestId: string; command: ProductPhysicalCommand; payloadHash: string; caseId: string;
  instructionId: string | null; caseVersionAtCommit: number | null; state: 'unrecorded' | 'committed' | 'not_executed';
  reason: null | 'requester_neutralized' | 'source_changed' | 'incomplete_physical_sources' | 'document_capacity_requires_review'; recordedAt: string | null;
  currentInstructionVerified: false; physicalComplianceVerified: false; fundsFrozenBySafetySignal: false; commercialHandlingIsSeparate: true;
}
export interface ProductPhysicalInstruction extends ProductReviewEffects {
  protocol: 'product_physical_instruction_view_v1'; parcelCapability?: 'product_review_parcel_v1'; materialCapability?: 'product_review_material_v1'; instructionId: string; contentHash: string; action: ProductPhysicalAction; leg: 'forward' | 'return' | 'none';
  partyMessage: string; separateHandlingSummary: string | null; privateNote: string | null; assessments: ProductPhysicalAssessment[];
  documentsConsidered: ProductPhysicalDocument[]; contributionReferences: ProductReviewReference[]; evidenceReferences: ProductReviewEvidenceReference[];
  caseVersionAtCommit: number; semanticSourceHash: string; recordedAt: string; currentInstructionVerified: false; physicalComplianceVerified: false;
}
export interface ProductPhysicalPage extends ProductReviewEffects {
  protocol: 'product_physical_instructions_page_v1'; parcelCapability?: 'product_review_parcel_v1'; materialCapability?: 'product_review_material_v1'; actorId: string; scope: ProductReviewScope; context: ProductPhysicalContext; caseId: string;
  entries: ({qualification: 'native_instruction'; instruction: ProductPhysicalInstruction} | {qualification: 'unknown'; instructionId: string; instruction: null})[];
  nextCursor: ProductReviewCursor | null; coverage: {inspected: number; limit: 20; hasMore: boolean; exhaustiveHistoryVerified: false};
  readAt: string; privateAnalysisVisible: boolean; originalsAccessGranted: false; physicalComplianceVerified: false;
}
export interface ProductPhysicalAttempt {version: 1; uid: string; requestId: string; context: ProductPhysicalContext; command: ProductPhysicalCommand; materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1'}
