/** Private documentary examination. Recorded declarations establish no physical or legal fact. */
import type { ProductRoutingStatement, ProductRoutingQualification } from './productRoutingReview';
import type {ProductMixedOrderStatement,ProductMixedOrderQualification} from './productMixedOrders';
import type { ProductReviewEvidenceReference } from './productReviewEvidence';
import type { ArticleChildSafetySource } from './articleChildSafety';
import type { ProductMaterialSources, ProductMaterialStatement, ProductMaterialReason } from './productMaterialReview';
import type { ProductCommercialReturnCommand, ProductCommercialReturnReference } from './productCommercialReturn';
import type { ProductParcelAssessment, ProductParcelCorpusReview, ProductParcelOperatorRoutes, ProductParcelReason, ProductParcelSources, ProductParcelStatement } from './productParcelReview';
export type ProductReviewContext = {kind: 'order' | 'article_report' | 'article_listing'; id: string};
export type ProductReviewScope = 'own' | 'admin';
export type ProductReviewRole = 'buyer' | 'seller' | 'reporter';
export type ProductReviewTopic = 'authenticity' | 'recall' | 'child_safety' | 'hygiene' | 'animal_material' | 'nonconformity' | 'parcel_delivery';
export interface ProductReviewEffects {
  authenticityVerified: false; recallApplicabilityVerified: false; childSafetyVerified: false; hygieneVerified: false;
  speciesOrProvenanceVerified: false; financialEffectAuthorized: false; inventoryEffectAuthorized: false;
  shippingPermissionGranted: false; physicalContentsVerified: false; legalDeadlineEstablished: false;
}
export interface ProductReviewIdentity {present: boolean; revision: string | null; sourceHash: string | null}
export interface ProductReviewArticleText {
  title: string | null; description: string | null; condition: string | null; brand: string | null; brandStatus: string | null;
  category: string | null; categoryIds: string[] | null; materials: string[] | null; model: string | null; lot: string | null;
  productReference: string | null; species: string | null; provenance: string | null; imageCountRecorded: number | null;
  imagesAreReceivedItemEvidence: false;
}
export interface ProductReviewSourceV1 extends ProductReviewEffects {
  protocol: 'product_review_source_v1'; context: ProductReviewContext; articleId: string | null;
  contextSource: ProductReviewIdentity; articleSource: ProductReviewIdentity; caseSource: ProductReviewIdentity;
  caseId: string; sourceHash: string; actorId: string; actorRoles: ProductReviewRole[]; readAt: string;
  originalsAccessGranted: false; exhaustiveHistoryVerified: false;
  sources: {
    contractSnapshot: {qualification: 'native_order_snapshot_recorded' | 'unknown'; content: ProductReviewArticleText; executedAgreementVerified: false};
    currentListing: {qualification: 'current_listing_recorded' | 'unknown'; content: ProductReviewArticleText};
    reportedListing: {qualification: 'native_report_capture' | 'unknown'; articleRevision: string | null; contentHash: string | null;
      capturedAt: string | null; mediaCount: number | null; content: ProductReviewArticleText};
    receivedItem: {qualification: 'unknown'; source: 'requires_separate_participant_declaration'; physicalContentsVerified: false};
  };
}
export interface ProductReviewSourceV2 extends Omit<ProductReviewSourceV1, 'protocol'> {
  protocol: 'product_review_source_v2';
  listingSubmission: {moderationStatus: string | null; isActive: boolean | null; childSafety: ArticleChildSafetySource; admissionPermissionGranted: false};
}
export interface ProductReviewSourceV3 extends Omit<ProductReviewSourceV1, 'protocol'> {
  protocol: 'product_review_source_v3'; materialAttributes: ProductMaterialSources;
}
export interface ProductReviewSourceV4 extends Omit<ProductReviewSourceV3, 'protocol'> {protocol: 'product_review_source_v4'; parcelSources: ProductParcelSources}
export type ProductReviewSource = ProductReviewSourceV1 | ProductReviewSourceV2 | ProductReviewSourceV3 | ProductReviewSourceV4;
export interface ProductReviewPreview extends ProductReviewEffects, Partial<ProductRoutingQualification>,Partial<ProductMixedOrderQualification> {
  protocol: 'product_review_preview_v1' | 'product_review_material_preview_v1' | 'product_review_parcel_preview_v1'; source: ProductReviewSource; topics: ProductReviewTopic[]; factKeys: ProductReviewFactKey[];
  materialReasons?: ProductMaterialReason[];
  parcelReasons?: ProductParcelReason[];
  routingCapability?: 'product_review_routing_v1';
  mixedOrdersCapability?: 'product_review_mixed_orders_v1';
  contributionPermissionGranted: false; receivedItemImagesSupported: false; originalExpertiseUploadSupported: false;
}
export type ProductReviewFactKey = 'brand' | 'model' | 'productReference' | 'lot' | 'category' | 'intendedUse' | 'recallReference' |
  'officialSourceDeclared' | 'childSafetyObservation' | 'hygieneObservation' | 'conditionObserved' | 'sealOrUseObservation' |
  'species' | 'provenance' | 'expertiseSummary';
export type ProductReviewFacts = Record<ProductReviewFactKey, string | null>;
export interface ProductReviewContributionCommand {
  context: ProductReviewContext; sourceHash: string; actorRole: ProductReviewRole; topic: ProductReviewTopic;
  statement: string; facts: ProductReviewFacts; observedAt: string | null;
  materialStatement?: ProductMaterialStatement;
  parcelStatement?: ProductParcelStatement;
  routingStatement?: ProductRoutingStatement;
  mixedOrderStatement?: ProductMixedOrderStatement;
}
export interface ProductReviewContribution extends ProductReviewEffects, Partial<ProductRoutingQualification>,Partial<ProductMixedOrderQualification> {
  protocol: 'product_review_contribution_v1' | 'product_review_material_contribution_v1' | 'product_review_parcel_contribution_v1'; contributionId: string; actorId: string; actorRole: ProductReviewRole; topic: ProductReviewTopic;
  statement: string; facts: ProductReviewFacts; observedAt: string | null; observedAtQualification: 'unknown' | 'actor_declaration';
  origin: 'received_item_declaration' | 'offered_item_declaration' | 'reporter_observation_declaration'; sourceHash: string;
  payloadHash: string; recordedAt: string; statementQualification: 'native_actor_declaration'; originalsState: 'not_submitted_in_this_contribution';
  officialSourceFetched: false; expertiseVerified: false;
  materialStatement?: ProductMaterialStatement;
  parcelStatement?: ProductParcelStatement;
  routingStatement?: ProductRoutingStatement;
  mixedOrderStatement?: ProductMixedOrderStatement;
}
export type ProductReviewReference = {id: string; contentHash: string};
export type ProductCommercialReturnContestReference = ProductCommercialReturnReference & {caseVersion: number};
export interface ProductCommercialReturnContestInstruction extends ProductReviewEffects {
  reference: ProductCommercialReturnContestReference; action: ProductCommercialReturnCommand['action']; partyMessage: string; sourceHash: string;
  recordedAt: string; currentPointerMatches: boolean; currentInstructionVerified: false;
}
export type ProductReviewWorkflowKind = 'ask_details' | 'communicate_summary' | 'issue_outcome' | 'respond' | 'contest';
export type ProductReviewOutcome = 'information_incomplete' | 'review_documented' | 'additional_action_required';
export interface ProductReviewWorkflowCommand {
  context: ProductReviewContext; sourceHash: string; kind: ProductReviewWorkflowKind; text: string; targetRoles: ProductReviewRole[];
  privateNote: string | null; result: ProductReviewOutcome | null; contributionReferences: ProductReviewReference[];
  parent: ProductReviewReference | null; acknowledged: boolean;
  documentaryCorpus?: {hash: string; evidenceReferences: ProductReviewEvidenceReference[]};
  parcelAssessment?: ProductParcelAssessment;
  commercialReturnInstruction?: ProductCommercialReturnContestReference;
}
export interface ProductReviewCommunication extends ProductReviewEffects {
  protocol: 'product_review_communication_v1'; eventId: string; kind: ProductReviewWorkflowKind; contentHash: string; caseVersion: number;
  text: string; result: ProductReviewOutcome | null; parent: ProductReviewReference | null; sourceHash: string;
  actorRole: ProductReviewRole | 'operator'; recordedAt: string; privateNote: string | null; contributionReferences: ProductReviewReference[];
  appliesToCurrentCaseVerified: false; originalsAccessGranted: false;
}
export interface ProductReviewCommunicationV2 extends Omit<ProductReviewCommunication, 'protocol'> {
  protocol: 'product_review_communication_v2' | 'product_review_parcel_communication_v1'; documentaryCorpusHash: string | null; evidenceReferences: ProductReviewEvidenceReference[];
  documentaryEvidenceBoundAtCommit: boolean;
  parcelAssessment?: ProductParcelAssessment | null; parcelAssessmentState?: 'available_sources_examined'; responsibilityEstablished?: false; indemnityGranted?: false; costDecisionGranted?: false;
  commercialReturnInstruction?: ProductCommercialReturnContestReference;
}
export type ProductReviewCommunicationView = ProductReviewCommunication | ProductReviewCommunicationV2;
export interface ProductReviewWorkflowPreview extends ProductReviewEffects {
  protocol: 'product_review_workflow_preview_v1'; actorId: string; scope: ProductReviewScope; source: ProductReviewSource; caseVersion: number;
  parent: ProductReviewCommunication | null;
  contributionReferences: {id: string; contentHash: string | null; qualification: 'native_contribution' | 'unknown'}[];
  communicationReferences: {id: string; contentHash: string | null; kind: ProductReviewWorkflowKind | null; qualification: 'native_communication' | 'unknown'}[];
  recipientRoles: ProductReviewRole[]; options: ProductReviewWorkflowKind[];
  coverage: {contributionsInspected: number; communicationsInspected: number; limitPerSource: 100;
    contributionsHasMore: boolean; communicationsHasMore: boolean; completeCurrentCaseSet: boolean; exhaustiveHistoryVerified: false};
  decisionPermissionGranted: false;
}
export interface ProductReviewWorkflowPreviewV2 extends Omit<ProductReviewWorkflowPreview, 'protocol' | 'parent' | 'coverage'> {
  protocol: 'product_review_workflow_preview_v2' | 'product_review_parcel_workflow_preview_v1'; parent: ProductReviewCommunicationV2 | null; documentaryCorpusHash: string;
  documentaryEvidenceBoundAtPreview: true;
  evidenceReferences: ({qualification: 'native_stored_file'; evidence: ProductReviewEvidenceReference} | {qualification: 'unknown'; evidenceId: string; evidence: null})[];
  coverage: ProductReviewWorkflowPreview['coverage'] & {evidenceInspected: number; intentsInspected: number; evidenceHasMore: boolean;
    intentsHasMore: boolean; documentaryCompleteCurrentCaseSet: boolean};
  parcelReview?: ProductParcelCorpusReview;
  operatorParcelRoutes?: ProductParcelOperatorRoutes;
  commercialReturnInstruction?: ProductCommercialReturnContestInstruction;
}
export type ProductReviewCursor = {lastId: string};
export interface ProductReviewPageBase extends ProductReviewEffects {
  actorId: string; scope: ProductReviewScope; caseId: string; readAt: string; nextCursor: ProductReviewCursor | null;
  coverage: {inspected: number; limit: 20; hasMore: boolean; exhaustiveHistoryVerified: false};
  otherPartiesRawContributionsVisible: boolean; originalsAccessGranted: false;
}
export type ProductReviewContributionEntry = {qualification: 'native_actor_contribution'; contribution: ProductReviewContribution} |
  {qualification: 'unknown'; contributionId: string; contribution: null};
export interface ProductReviewContributions extends ProductReviewPageBase {
  protocol: 'product_review_contributions_page_v1' | 'product_review_material_contributions_page_v1' | 'product_review_parcel_contributions_page_v1'; entries: ProductReviewContributionEntry[];
}
export type ProductReviewCommunicationEntry = {qualification: 'native_addressed_communication'; communication: ProductReviewCommunication} |
  {qualification: 'unknown'; eventId: string; communication: null};
export interface ProductReviewCommunications extends ProductReviewPageBase {
  protocol: 'product_review_communications_page_v1'; entries: ProductReviewCommunicationEntry[]; privateAnalysisVisible: boolean;
}
export type ProductReviewCommunicationEntryV2 = {qualification: 'native_addressed_communication'; communication: ProductReviewCommunicationV2} |
  {qualification: 'unknown'; eventId: string; communication: null};
export interface ProductReviewCommunicationsV2 extends Omit<ProductReviewCommunications, 'protocol' | 'entries'> {
  protocol: 'product_review_communications_page_v2' | 'product_review_parcel_communications_page_v1'; entries: ProductReviewCommunicationEntryV2[];
}
export type ProductReviewRefusal = 'requester_neutralized' | 'source_changed' | 'reference_unqualified' | 'incomplete_case_history' | 'product_material_review_not_exposed' | 'product_parcel_review_not_exposed';
export interface ProductReviewReceipt extends ProductReviewEffects {
  protocol: 'product_review_command_v1' | 'product_review_material_command_v1' | 'product_review_parcel_command_v1' | 'product_review_workflow_command_v1' | 'product_commercial_return_command_v1'; actorId: string; requestId: string; payloadHash: string;
  caseId: string; state: 'unrecorded' | 'committed' | 'not_executed'; reason: ProductReviewRefusal | null;
  recordedAt: string | null; currentSourceVerified: false;
  contributionId?: string | null; eventId?: string | null; caseVersionAtCommit?: number | null; currentInstructionVerified?: false;
  instructionReference?: ProductCommercialReturnReference | null;
}
export type ProductReviewAttempt = {version: 1; uid: string; requestId: string; context: ProductReviewContext; materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1'; routeAmendmentCapability?: 'label_route_amendment_v1'; routingCapability?: 'product_review_routing_v1';mixedOrdersCapability?:'product_review_mixed_orders_v1'} &
  ({type: 'contribution'; command: ProductReviewContributionCommand} | {type: 'workflow'; command: ProductReviewWorkflowCommand} | {type: 'commercial_return'; command: ProductCommercialReturnCommand});
