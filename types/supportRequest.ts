import type {SupportActivityAssessment, SupportActivityProgram, SupportActivityRecordedAssessment} from './supportActivityReview';
import type {SupportOpaqueAttempt,SupportOpaqueReceipt,SupportConfidentialProjection} from './supportConfidentiality';
import type { LateTransportIncidentReference, LateTransportRefundObservation } from './lateTransportIncident';
import type { SwapFundReleaseDecision, SwapHoldSource } from './swapHoldReview';
import type { WithdrawalTimingSource } from './withdrawalTiming';
import type { ReturnToSenderSupportReference, ReturnToSenderSupportSource } from './returnToSender';
import type { LateCommercialLink, LateCommercialSupportView } from './lateCommercialRecourse';
export type AccountSupportKind = 'account_reconciliation' | 'restriction_circumvention' | 'representation_review' | 'payment_account_review' | 'activity_compliance_review';
export type SupportKind = 'commercial_late' | 'access_interruption' | 'personal_data_access' | 'personal_data_correction' | 'automated_decision_review' | 'swap_hold_assistance' | 'withdrawal_timing_assistance' | AccountSupportKind;
export interface SupportWithdrawalTimingContext {
  protocol: 'support_withdrawal_timing_context_v1'; withdrawalRequestId: string; sourceRevision: string; sourceHash: string;
  sourceQualification: 'qualified' | 'unknown'; recordedAt: string; declaredIssueSource: 'owner_narrative'; bankReceiptVerified: false; financialEffectAuthorized: false;
}
export interface SupportSwapHoldContext {
  protocol: 'support_swap_hold_context_v1'; swapId: string; participantRole: 'initiator' | 'receiver'; sourceRevision: string; recordedAt: string;
  declaredIssueSource: 'owner_narrative'; financialExecutionVerified: false; holdReleased: false; physicalReceiptVerified: false;
}
export interface SupportSwapHoldSource {
  protocol: 'support_swap_hold_source_v1'; swapId: string; swapRevision: string | null; swapSourceHash: string; observedAt: string;
  source: SwapHoldSource; financialEffectAuthorized: false; holdReleaseAuthorized: false; physicalReceiptVerified: false;
}
export interface SupportRepresentationInput {reason: 'death' | 'incapacity'; relationship: string; authorityStatement: string}
export interface SupportRepresentation extends SupportRepresentationInput {source: 'reporter_declaration'; deathOrIncapacityVerified: false; authorityVerified: false}
export type SupportAccountFinding = 'unresolved' | 'no_link_established' | 'link_requires_manual_action' | 'representation_not_verified' | 'representation_requires_manual_verification';
export interface SupportAccountSourceReference {declaredAccountId: string; sourceHash: string; userRevision: string | null; eligibilityRevision: string | null}
export interface SupportAccountSource extends SupportAccountSourceReference {
  protocol: 'support_account_source_v1'; userDocumentState: 'present' | 'absent'; eligibilityDocumentState: 'present' | 'absent';
  activeFieldState: 'active_recorded' | 'inactive_recorded' | 'unknown'; closureRecordState: 'source_absent' | 'absent' | 'recorded' | 'historical_unknown';
  accountExistenceVerified: false; accountRelationshipVerified: false; representationAuthorityVerified: false; restrictionCircumventionEstablished: false;
  otherAccountAccessGranted: false; paymentAuthorityGranted: false; sameNameOrBirthOrBankProvesRelationship: false;
}
export interface SupportAccountReviewInput {finding: SupportAccountFinding; reason: string; expectedSources: SupportAccountSourceReference[]}
export interface SupportAccountReview {
  protocol: 'support_account_review_v1'; finding: SupportAccountFinding; reason: string; sources: SupportAccountSource[]; recordedBy: string; recordedAt: string;
  accountRelationshipVerified: false; representationAuthorityVerified: false; restrictionCircumventionEstablished: false;
  otherAccountAccessGranted: false; paymentAuthorityGranted: false; automaticActionTaken: false;
}
export type SupportScope = 'owner' | 'admin';
export const SUPPORT_PRIVACY_CATEGORIES = ['account_profile', 'saved_searches', 'search_history', 'consents',
  'notifications', 'articles', 'drafts', 'communications', 'reviews', 'swaps', 'swap_zone', 'favorites',
  'media', 'transactions', 'support', 'other_or_unknown'] as const;
export type SupportPrivacyCategory = typeof SUPPORT_PRIVACY_CATEGORIES[number];
export interface SupportPrivacyScope {
  protocol: 'privacy_scope_v1'; categories: SupportPrivacyCategory[];
  objects: {category: SupportPrivacyCategory; id: string}[]; description: string | null;
}
export interface SupportPrivacyRetention {
  protocol: 'support_privacy_retention_view_v1'; qualification: 'native_preservation' | 'unknown';
  state: 'protected_pending_review'; declaredScope: SupportPrivacyScope | null;
  protectedCategories: SupportPrivacyCategory[]; protectedObjects: {category: SupportPrivacyCategory; id: string}[];
  initialReceivedAt: string | null; ticketVersion: number | null;
  reviewCondition: 'qualified_completion_and_recourse_retention_review';
  releaseAuthorized: false; legalExpiryEstablished: false; responseClosesPreservation: false; historicalDeletionReversed: false;
}
export interface SupportDecisionReference { id: string; revision: string; sourceHash: string }
export type MeetupSupportReason = 'article_refused' | 'disagreement_after_declaration' | 'safety_or_pressure';
export type SupportEvidenceKind = 'commercial_dispute' | 'eligibility_request' | 'support_request' | 'meetup_declaration';
export interface SupportEvidenceInput { kind: SupportEvidenceKind; id: string }
export interface MeetupDeclarationEvidence {
  protocol: 'meetup_declaration_evidence_v1'; transactionId: string; articleId: string | null; ownerRole: 'buyer' | 'seller';
  deliveryType: 'meetup' | 'historical_unknown'; agreementQualification: 'native_cash_agreement' | 'historical_unknown'; agreementId: string | null;
  phase: 'pending' | 'confirmed' | 'completion_declared' | 'cancelled' | 'expired' | 'disputed' | 'historical_unknown'; phaseSourceStatus: string | null;
  completionState: 'recorded' | 'absent' | 'historical_unknown'; completionDeclaredAt: string | null; completionDeclaredBy: string | null;
  noticeState: 'native_metadata' | 'absent' | 'historical_unknown'; capturedAt: string; notificationCommittedVerified: false; deviceDeliveryVerified: false;
  physicalPresenceVerified: false; physicalHandoverVerified: false; outsidePaymentVerified: false; mutualConsentVerified: false; faultEstablished: false;
}
export interface SupportEvidence extends SupportEvidenceInput { revision: string; sourceHash: string; meetupDeclaration?: MeetupDeclarationEvidence }
export interface SupportResponse { text: string; legalBasis: string | null; recourse: string | null; recordedBy: string; recordedAt: string;
  legalQualificationVerified: false; dataSearchCompletedVerified: false; externalRecourseDeadlineExtended: false }
export interface SupportRequest {
  confidentiality?:SupportConfidentialProjection;
  protocol: 'support_request_v1'; id: string; ownerId: string; kind: SupportKind;
  meetupReason: MeetupSupportReason | null;
  status: 'submitted' | 'needs_information' | 'withdrawn' | 'answered'; version: number; narrative: string;
  receivedAt: string; receivedAtMs: number; receivedCivilDate: string; statutoryDueDate: string | null;
  recordedAt: string; clockOriginSupportRequestId: string; deadlineBasis: 'application_initial_receipt'; earliestExternalReceiptVerified: false;
  deadlineState: 'response_recorded' | 'overdue' | 'pending' | 'not_applicable'; silenceEffect: 'refusal_not_permission' | null;
  deadlineExtended: false; discoveredAt: string | null; interruptionAt: string | null; declaredDatesVerified: false;
  priorSupportRequestId: string | null; transactionId: string | null; decision: (SupportDecisionReference & {
    transactionId: string | null; decisionType: string | null; criteria: Record<string, unknown>; result: string;
    executedAt: string | null; financialExecutionVerified: false } | (SwapFundReleaseDecision & {financialExecutionVerified: false})) | null;
  evidence: SupportEvidence[]; ownerMessage: string | null; ownerResponse: SupportResponse | null;
  latestClarification: string | null; withdrawnAt: string | null; updatedAt: string;
  financialEffect: 'none'; admissionVerified: false; accountRecoveryGranted: false; rightsRestored: false;
  humanExaminationVerified: false; responseCompletenessVerified: false; notificationDeliveryVerified: false;
  assignedAdminId?: string | null; internalNote?: string | null;
  relatedAccountIds?: string[]; representation?: SupportRepresentation | null;
  relatedAccountsDeclaredOnly?: true; relatedAccountExistenceVerified?: false; accountRelationshipVerified?: false;
  representationAuthorityVerified?: false; otherAccountAccessGranted?: false; paymentAuthorityGranted?: false;
  accountReview?: SupportAccountReview | SupportAccountReviewV2 | SupportAccountReviewOwnerV2 | null;
  lateTransport?: LateTransportIncidentReference | null; transportInstruction?: SupportTransportInstruction | null;
  swapId?: string; swapHoldContext?: SupportSwapHoldContext;
  withdrawalRequestId?: string; withdrawalTimingContext?: SupportWithdrawalTimingContext;
  returnToSender?: ReturnToSenderSupportReference | null;
  privacyRetention?: SupportPrivacyRetention;
  lateCommercial?: LateCommercialSupportView;
}
export type SupportOwnerCommand = { action: 'submit'; kind: SupportKind; narrative: string; transactionId?: string | null;
  discoveredAt?: string; interruptionAt?: string; priorSupportRequestId?: string; decision?: SupportDecisionReference; evidence?: SupportEvidenceInput[]; meetupReason?: MeetupSupportReason;
  relatedAccountIds?: string[]; representation?: SupportRepresentationInput; lateTransport?: LateTransportIncidentReference; swapId?: string; withdrawalRequestId?: string; returnToSender?: ReturnToSenderSupportReference; privacyScope?: SupportPrivacyScope; lateCommercial?: LateCommercialLink } |
  { action: 'clarify'; supportRequestId: string; expectedVersion: number; narrative: string; privacyScope?: SupportPrivacyScope; lateCommercial?: LateCommercialLink } |
  { action: 'withdraw'; supportRequestId: string; expectedVersion: number; narrative: string; privacyScope?: SupportPrivacyScope } |
  { action: 'link_evidence'; supportRequestId: string; expectedVersion: number; narrative: string; evidence: SupportEvidenceInput[]; privacyScope?: SupportPrivacyScope };
export type SupportAdminCommand = { action: 'assign'; supportRequestId: string; expectedVersion: number; assignedAdminId: string } |
  { action: 'request_details'; supportRequestId: string; expectedVersion: number; ownerMessage: string } |
  { action: 'internal_note'; supportRequestId: string; expectedVersion: number; internalNote: string } |
  { action: 'respond'; supportRequestId: string; expectedVersion: number; response: { text: string; legalBasis?: string; recourse?: string } } |
  {action: 'record_account_review'; supportRequestId: string; expectedVersion: number; accountReview: SupportAccountReviewInput} |
  {action: 'record_transport_instruction'; supportRequestId: string; expectedVersion: number; transportInstruction: SupportTransportInstructionInput};
export type SupportAttempt = { version: 1; uid: string; scope: 'owner'; requestId: string; command: SupportOwnerCommand; privacyRetentionCapability?: 'privacy_retention_v1'; lateCommercialCapability?: 'late_commercial_recourse_v1' } |
  { version: 1; uid: string; scope: 'admin'; requestId: string; command: SupportAdminCommand; privacyRetentionCapability?: 'privacy_retention_v1' };
export interface SupportReceipt {
  protocol: 'support_command_v1'; actorId: string; ownerId: string | null; requestId: string; supportRequestId: string;
  action: SupportAttempt['command']['action']; payloadHash: string; state: 'committed' | 'not_executed' | 'unrecorded';
  committed: boolean; replay: boolean; resultVersion: number | null; recordedAt: string | null; reason: string | null;
  request: SupportRequest | null; admissionVerified: false; financialEffect: 'none'; rightsRestored: false;
}
export interface SupportListCursor { receivedAtMs: number; id: string }
export interface SupportEventsCursor { recordedAtMs: number; id: string }
export interface SupportEvent { id: string; action: SupportAttempt['command']['action']; state: 'committed' | 'not_executed';
  resultVersion: number; recordedAt: string; recordedAtMs: number; ownerAction: boolean; reason: string | null;
  narrative: string | null; ownerMessage: string | null; response: SupportResponse | null; actorId?: string; internalNote?: string | null; accountReview?: SupportAccountReviewInput | SupportAccountReviewInputV2 | null; transportInstruction?: SupportTransportInstruction | null }
export interface SupportList { protocol: 'support_list_v1'; actorId: string; scope: SupportScope; items: SupportRequest[];
  hasMore: boolean; cursor: SupportListCursor | null; completeHistory: boolean }
export interface SupportDetail { protocol: 'support_read_v1'; actorId: string; scope: SupportScope; request: SupportRequest;
  sourceRevision?: string | null;
  privacyRetention?: SupportPrivacyRetention;
  lateCommercial?: LateCommercialSupportView;
  accountSources?: SupportAccountSource[]; transportSource?: SupportTransportSource | null; swapHoldSource?: SupportSwapHoldSource | null; withdrawalTimingSource?: WithdrawalTimingSource | null; returnToSenderSource?: ReturnToSenderSupportSource | null; events: { items: SupportEvent[]; hasMore: boolean; cursor: SupportEventsCursor | null } }
export type TransportInstructionType = 'return' | 'retain' | 'regularisation_review';
export interface SupportTransportInstructionInput {type: TransportInstructionType; reason: string; ownerMessage: string; source: LateTransportIncidentReference | ReturnToSenderSupportReference}
export interface SupportTransportInstruction extends SupportTransportInstructionInput {
  protocol: 'support_transport_instruction_v1'; recordedBy: string; recordedAt: string; requestId: string; financialEffect: 'none';
  recipientReceiptVerified: false; bankReceiptVerified: false; inventoryReleaseAuthorized: false; humanExaminationVerified: false;
}
export interface SupportTransportSource {
  protocol: 'late_transport_support_source_v1'; reference: LateTransportIncidentReference; providerStatusCode: 'IT' | 'DE';
  providerOccurredAt: string | null; providerObservedAt: string; temporalRelation: 'after_refund_request' | 'before_or_at_refund_request' | 'unknown';
  refundAtObservation: LateTransportRefundObservation; refundCurrentlyRecorded: LateTransportRefundObservation; financialSourceCurrent: boolean;
  recipientReceiptVerified: false; bankReceiptVerified: false; financialEffectAuthorized: false; inventoryReleaseAuthorized: false;
}

export type SupportJournalEntry=SupportAttempt|SupportOpaqueAttempt;
export type SupportServicingReceipt=SupportReceipt|SupportOpaqueReceipt;

export type SupportDeadlineLane = 'dated' | 'unknown' | 'bank';
export interface SupportDeadlineCursor {protocol: 'support_deadline_cursor_v1'; actorId: string; lane: SupportDeadlineLane; id: string; statutoryDueDate: string | null}
export interface SupportDeadlineAlert {protocol: 'support_deadline_alert_v1'; alertId: string; clockState: 'overdue' | 'due_today' | 'pending' | 'unknown'; clockQualification: 'native_application_receipt' | 'native_provider_observation' | 'unknown'; firstObservedAt: string; observedAt: string; adminNoticeScanCompleted: boolean; awaitingAdmin: boolean; inAppNoticesPrepared: number; deviceDeliveryVerified: false; readingVerified: false; responseCompletenessVerified: false; deadlineExtended: false}
interface SupportDeadlineItemBase {id: string; version: number | null; assignedAdminId: string | null; sourceRevision: string | null; responseRecorded: boolean; responseCompletenessVerified: false; deadlineAlert?: SupportDeadlineAlert | null}
export interface SupportPrivacyDeadlineItem extends SupportDeadlineItemBase {kind: 'personal_data_access' | 'personal_data_correction'; status: SupportRequest['status'] | null;
  clock: {qualification: 'native_application_receipt' | 'unknown'; receivedAt: string | null; receivedCivilDate: string | null; statutoryDueDate: string | null; recordedDueDate: string | null; state: 'overdue' | 'due_today' | 'pending' | 'unknown'; reason: 'native_clock_missing_or_incoherent' | null; clockOriginSupportRequestId: string | null; basis: 'application_initial_receipt'; earliestExternalReceiptVerified: false; deadlineExtended: false}}
export interface SupportBankDeadlineItem extends SupportDeadlineItemBase {kind: 'bank_dispute'; status: string | null; providerObservedAt: string | null; currentProviderStateVerified: false; transactionId: string | null;
  clock: {qualification: 'native_provider_observation' | 'unknown'; receivedAt: null; receivedCivilDate: null; statutoryDueDate: null; recordedDueDate: string | null; providerDueAt: string | null; state: 'overdue' | 'due_today' | 'pending' | 'unknown' | 'not_actionable'; reason: 'native_bank_observation_missing_or_incoherent' | null; clockOriginSupportRequestId: null; basis: 'recorded_provider_evidence_deadline'; earliestExternalReceiptVerified: false; deadlineExtended: false}}
export type SupportDeadlineItem = SupportPrivacyDeadlineItem | SupportBankDeadlineItem;
export interface SupportBankDeadlineTarget {version: 1; uid: string; cursor: SupportDeadlineCursor | null; item: SupportBankDeadlineItem}
export interface SupportDeadlinePage {
  protocol: 'support_deadline_queue_v1'; actorId: string; scope: 'admin'; operation: 'deadline_queue'; lane: SupportDeadlineLane;
  observedAt: string; civilDate: string | null; items: SupportDeadlineItem[];
  page: {inspected: number; returned: number; excluded: number; limit: 30; hasMore: boolean; cursor: SupportDeadlineCursor | null; completeScan: boolean};
  coverage: {population: 'all_privacy_requests_with_indexed_due_date' | 'all_support_documents' | 'recorded_bank_dispute_cases';
    order: 'statutoryDueDate_asc_id_asc' | 'id_asc'; globalCoverage: false; snapshotConsistentAcrossPages: false};
  financialEffect: 'none'; deadlineExtended: false; humanAvailabilityVerified: false;
}


export const SUPPORT_ACCOUNT_REVIEW_CAPABILITY = 'support_account_review_v2' as const;
export type SupportAccountFindingV2 = 'activity_restriction_maintained' | 'activity_documents_requested' | 'activity_no_prohibition_identified' | 'restrict_new_operations' | 'lift_own_restriction' | 'representation_authority_confirmed' | 'representation_not_confirmed' | 'provider_restriction_maintained' | 'provider_documents_requested' | 'provider_recourse_recorded';
export type SupportAccountEvidencePurpose = 'identity' | 'authority' | 'relationship' | 'provider_restriction' | 'activity' | 'regulatory_basis' | 'other';
export interface SupportAccountEvidenceRef {evidenceId: string; generation: string; sha256: string; sizeBytes: number}
export interface SupportAccountEvidence {evidence: SupportAccountEvidenceRef; purpose: SupportAccountEvidencePurpose; uploadedAt: string}
export interface SupportAccountEvidenceRead {protocol: typeof SUPPORT_ACCOUNT_REVIEW_CAPABILITY; actorId: string; supportRequestId: string; readId: string; evidence: SupportAccountEvidenceRef; jpegBase64: string; readAt: string}
export interface SupportAccountObligationRef {kind: 'transaction' | 'swap' | 'withdrawal' | 'wallet'; id: string}
export interface SupportAccountObligation extends SupportAccountObligationRef {sourceHash: string; sourceRevision: string}
export interface SupportAccountEffects {otherAccountAccessGranted: false; paymentAuthorityGranted: false; providerRestrictionOverridden: false; accountsMerged: false; fundsMoved: false; physicalIdentityAutomaticallyInferred: false}
export interface SupportAccountReviewInputV2 {
  protocol: typeof SUPPORT_ACCOUNT_REVIEW_CAPABILITY; finding: SupportAccountFindingV2; subjectUid: string;
  reason: string; ownerMessage: string; recourse: string; reviewDueAt: string; expectedSources: SupportAccountSourceReference[];
  evidenceReads: {readId: string; evidence: SupportAccountEvidenceRef}[]; obligations: SupportAccountObligation[];
  expectedRestrictionReceiptId: string | null; providerObservationId: string | null;
  identityDocumentsReviewed: boolean; authorityDocumentsReviewed: boolean; accountRelationshipReviewed: boolean; documentsReadAccepted: true; activityAssessment?: SupportActivityAssessment | null;
}
export interface SupportAccountReviewOwnerV2 extends Omit<SupportAccountEffects, 'physicalIdentityAutomaticallyInferred'> {
  protocol: typeof SUPPORT_ACCOUNT_REVIEW_CAPABILITY; finding: SupportAccountFindingV2; ownerMessage: string;
  recourse: string; reviewDueAt: string; recordedAt: string; obligations: SupportAccountObligationRef[]; humanReviewRecorded: true;
}
export interface SupportProviderObservation extends SupportAccountEffects {
  protocol: 'support_provider_observation_v1'; subjectUid: string; accountId: string; userRevision: string; version: number;
  providerSourceHash: string; ownerRestriction: {protocol: 'connect_payout_restriction_v1'; ownerId: string; observedAt: string;
    category: string; action: string; message: string; bankChangeResolvesRestriction: false; payoutPermissionGranted: false} | null;
  observedAtMs: number; screeningCoverage: 'provider_account_observation_only'; observationId: string; actorUid: string; authTime: number;
}
export interface SupportPostClosureBasis {protocol: 'exceptional_post_closure_servicing_v1'; qualified: true; authState: 'native_user_absent'; ownerId: string; creditHash: string; orderHash?: string; lateEvent: {source: 'stripe_bank_dispute'; transactionId: string; disputeId: string; kind: string; recordedAt: string} | {source: 'seconde_compensation'; caseId: string; recordedAt: string}}
export interface SupportAccountReviewV2 extends SupportAccountEffects {
  protocol: typeof SUPPORT_ACCOUNT_REVIEW_CAPABILITY; finding: SupportAccountFindingV2; subjectUid: string; reason: string;
  ownerMessage: string; recourse: string; reviewDueAt: string; sources: SupportAccountSource[];
  evidenceReads: {readId: string; evidence: SupportAccountEvidenceRef}[]; obligations: SupportAccountObligation[];
  providerSource: {observationId: string; accountId: string; providerSourceHash: string; ownerRestriction: SupportProviderObservation['ownerRestriction']; observedAtMs: number} | null;
  identityDocumentsReviewed: boolean; authorityDocumentsReviewed: boolean; accountRelationshipReviewed: boolean; representationAuthorityVerified: boolean;
  authorityScope: 'selected_existing_obligations_only' | 'new_operations_only'; representativeUid: string | null;
  decisionReceiptId: string; recordedBy: string; recordedAt: string; legalIdentityAutomaticallyVerified: false; activityAssessment?: SupportActivityRecordedAssessment | null; postClosureBasis?: SupportPostClosureBasis | null;
}
export interface SupportAccountReviewPreview extends SupportAccountEffects {
  protocol: typeof SUPPORT_ACCOUNT_REVIEW_CAPABILITY; actorId: string; supportRequestId: string; version: number;
  accountSources: SupportAccountSource[]; obligations: SupportAccountObligation[];
  evidencePage: {items: SupportAccountEvidence[]; hasMore: boolean; cursor: string | null};
  activityProgram?: SupportActivityProgram | null; providerObservation: SupportProviderObservation | null; currentReview: SupportAccountReview | SupportAccountReviewV2 | null; selectedObligationsOnly: true;
}
export interface SupportAccountReviewCommandV2 {action: 'record_account_review'; supportRequestId: string; expectedVersion: number; accountReview: SupportAccountReviewInputV2}
/** Opaque metadata only. Decision text, JPEG bytes and local file paths never enter this journal. */
export interface SupportAccountReviewJournalV2 {protocol: typeof SUPPORT_ACCOUNT_REVIEW_CAPABILITY; uid: string; scope: 'admin'; expectedVersion: number; reference: import('./supportConfidentiality').SupportOpaqueCommandReference}
export interface SupportAccountReviewOpaqueReceiptV2 {
  protocol: 'support_account_review_receipt_v2'; operation: 'account_review_decision_receipt' | 'account_review_evidence_receipt';
  actorId: string; supportRequestId: string; requestId: string; payloadHash: string; expectedVersion: number;
  purpose: SupportAccountEvidencePurpose | null; state: 'unrecorded' | 'committed' | 'not_executed'; committed: boolean; replayed: boolean;
  recordedAt: string | null; resultVersion: number | null; reason: 'command_neutralized' | null; evidence: SupportAccountEvidenceRef | null; storageOutcome: 'not_asserted';
}
export interface SupportAccountEvidenceJournalV2 {
  protocol: 'support_account_review_v2'; uid: string; scope: SupportScope; supportRequestId: string; requestId: string;
  expectedVersion: number; purpose: SupportAccountEvidencePurpose; payloadHash: string;
}
