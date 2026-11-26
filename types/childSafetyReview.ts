import type { ArticleChildSafetySource } from './articleChildSafety';
import type { ProductReviewContext, ProductReviewEffects, ProductReviewCursor, ProductReviewReference, ProductReviewScope, ProductReviewSource, ProductReviewWorkflowPreviewV2 } from './productReview';
import type { ProductReviewEvidenceReference } from './productReviewEvidence';
export type ChildSafetyAdmissionAction = 'allow_listing_for_sources' | 'retain_review' | 'refuse_listing';
export type ChildSafetyCriterion = 'use_and_regulatory_scope' | 'flammability_requirements' | 'label_and_care_information' | 'condition_alterations_and_sale_unit' | 'hazards_and_recall_information' | 'documentation_limits';
export type ChildSafetyDocument = 'sleepwear_regulations' | 'hc_sleepwear_guidance' | 'hc_second_hand_guidance';
export interface ChildSafetyAssessment {criterion: ChildSafetyCriterion; assessment: 'documented' | 'unresolved' | 'not_applicable'; reason: string}
export interface ChildSafetyAdmissionPreview extends ProductReviewEffects {
  protocol: 'product_review_admission_preview_v1'; actorId: string; scope: ProductReviewScope; context: ProductReviewContext; caseId: string;
  source: ProductReviewSource; childSourceHash: string; statementHash: string | null;
  documentaryCorpus: {hash: string; membersHash: string; contributionReferences: ProductReviewWorkflowPreviewV2['contributionReferences']; evidenceReferences: ProductReviewWorkflowPreviewV2['evidenceReferences']};
  coverage: ProductReviewWorkflowPreviewV2['coverage']; referenceSet: {protocol: 'product_review_child_safety_references_v1'; documents: {id: ChildSafetyDocument; url: string}[]; criteria: ChildSafetyCriterion[]; exhaustiveLegalGuidanceVerified: false; contentFetchedNow: false};
  referenceSetHash: string; options: ChildSafetyAdmissionAction[]; canAllowForCurrentSources: boolean; decisionPermissionGranted: false;
  listingActivated: false; physicalComplianceVerified: false; platformCertificationGranted: false;
}
export interface ChildSafetyAdmissionCommand {
  context: ProductReviewContext; sourceHash: string; childSourceHash: string; statementHash: string | null; action: ChildSafetyAdmissionAction;
  motivation: string; ownerSummary: string; referenceSetHash: string; documentsConsidered: ChildSafetyDocument[]; assessments: ChildSafetyAssessment[]; acknowledged: true;
  documentaryCorpus: {hash: string; membersHash: string; contributionReferences: ProductReviewReference[]; evidenceReferences: ProductReviewEvidenceReference[]};
}
export interface ChildSafetyAdmissionReceipt extends ProductReviewEffects {
  protocol: 'product_review_admission_command_v1'; actorId: string; requestId: string; payloadHash: string; caseId: string; decisionId: string | null;
  state: 'unrecorded' | 'committed' | 'not_executed'; reason: 'requester_neutralized' | 'source_changed' | 'reference_unqualified' | 'incomplete_case_history' | null;
  caseVersionAtCommit: number | null; recordedAt: string | null; currentSourceVerified: false; currentAdmissionVerified: false; listingActivated: false;
  physicalComplianceVerified: false; platformCertificationGranted: false;
}
export interface ChildSafetyAdmissionDecision extends ProductReviewEffects {
  protocol: 'product_review_admission_decision_view_v1'; decisionId: string; contentHash: string; action: ChildSafetyAdmissionAction; caseVersionAtCommit: number;
  childSourceHash: string; documentaryCorpusHash: string; membersHash: string; ownerSummary: string; recordedAt: string; motivation: string | null;
  assessments: ChildSafetyAssessment[]; documentsConsidered: ChildSafetyDocument[]; contributionReferences: ProductReviewReference[]; evidenceReferences: ProductReviewEvidenceReference[];
  currentAdmissionVerified: false; listingActivated: false; physicalComplianceVerified: false; platformCertificationGranted: false;
}
export interface ChildSafetyAdmissionPage extends ProductReviewEffects {
  protocol: 'product_review_admission_decisions_page_v1'; actorId: string; scope: ProductReviewScope; context: ProductReviewContext; caseId: string;
  entries: ({qualification: 'native_admission_decision'; decision: ChildSafetyAdmissionDecision} | {qualification: 'unknown'; decisionId: string; decision: null})[];
  readAt: string; nextCursor: ProductReviewCursor | null; coverage: {inspected: number; limit: 20; hasMore: boolean; exhaustiveHistoryVerified: false};
  privateAnalysisVisible: boolean; originalsAccessGranted: false;
}
export interface ChildSafetyPublicationCommand {articleId: string; articleRevision: string; childSourceHash: string; admissionDecisionId: string; acknowledged: true}
export interface ChildSafetyPublicationPreview {
  protocol: 'article_child_safety_publication_preview_v1'; ownerId: string; articleId: string; source: ArticleChildSafetySource; articleRevision: string | null;
  admissionQualification: 'native_current_allow' | 'no_current_allow' | 'unknown'; blockers: string[]; canPublishNow: boolean; canCorrectPreparationNow: boolean; canWithdrawPreparationNow: boolean; acknowledgmentRequired: true;
  commandSource: Omit<ChildSafetyPublicationCommand, 'acknowledged'> | null; currentPublicationVerified: false; physicalComplianceVerified: false;
  platformCertificationGranted: false; financialEffectsAuthorized: false; inventoryReleaseAuthorized: false;
}
export interface ChildSafetyPublicationReceipt {
  protocol: 'article_child_safety_publication_command_v1'; ownerId: string; requestId: string; commandId: string; command: ChildSafetyPublicationCommand; payloadHash: string;
  state: 'unrecorded' | 'committed' | 'not_executed'; reason: null | 'requester_neutralized' | 'publication_source_unavailable' | 'publication_context_not_authorized' | 'publication_source_changed' | 'publication_guarded';
  blockers: string[]; recordedAt: string | null; publicationRecorded: boolean; listingActivatedAtCommit: boolean; currentPublicationVerified: false; sourceAfterReceiptMustBeRead: true;
  physicalComplianceVerified: false; platformCertificationGranted: false; financialEffectsAuthorized: false; inventoryReleaseAuthorized: false;
  notificationCommitted: boolean; deviceDeliveryVerified: false; readingVerified: false;
}
export type ChildSafetyReviewAttempt = {version: 1; uid: string; requestId: string; articleId: string} &
  ({kind: 'admission'; command: ChildSafetyAdmissionCommand} | {kind: 'publication'; command: ChildSafetyPublicationCommand});
export type ChildSafetyReviewReceipt = ChildSafetyAdmissionReceipt | ChildSafetyPublicationReceipt;
