export type TransportReviewScope = 'owner' | 'admin';
export type TransportReviewKind = 'participant_transit' | 'carrier_exception' | 'delivery_correction' | 'label_deposit_deadline';
export type LabelDepositReviewCapability = 'label_deposit_deadline_v1';
export interface LabelDepositDeadlineSource {
  protocol: 'label_deposit_deadline_source_v1'; transactionId: string; deadlineQualification: 'native_accepted_window' | 'unknown';
  policyVersion: string | null; policyHash: string | null; startsAt: string | null; expiresAt: string | null; deadlineReached: boolean; deadlineSourceHash: string | null;
  labelQualification: 'native_current_label' | 'unknown'; labelId: string | null; labelSourceHash: string | null;
  carrierScanQualification: 'carrier_scan_recorded' | 'no_acceptance_scan_recorded' | 'unknown'; observedStatusCode: string | null; providerObservedAt: string | null; providerEventAt: string | null;
  depositDeclaration: 'sender_handover_declared' | 'not_recorded' | 'unknown'; declarationManifestComplete: boolean; declarationManifestHash: string;
  currentOrderStatus: string | null; sourceHash: string;
  resolutionPaths: [
    {kind: 'participant_parcel_investigation'; context: {kind: 'order'; id: string}; contributionEndpoint: 'submitReport'; capability: 'product_review_v1'; parcelCapability: 'product_review_parcel_v1'; recourseEndpoint: 'reportTransactionProblem'; recourseCapability: 'product_parcel_report_v1'; explicitParticipantStatementRequired: true; automaticComplaintCreated: false; permissionGranted: false},
    {kind: 'native_bilateral_refund_agreement'; transactionId: string; endpoint: 'adminRefundTransaction'; capability: 'purchase_refund_v1'; sourceMode: 'purchase_refund_source_observe'; bothNativeAcceptancesRequired: true; separateOperatorDecisionRequired: true; permissionGranted: false},
    {kind: 'label_lifecycle_review'; context: {transactionId: string; leg: 'forward'}; endpoint: 'checkTrackingStatus'; capability: 'label_lifecycle_v1'; sourceMode: 'label_lifecycle_source_observe'; buyerRefundAuthorized: false; permissionGranted: false},
  ];
  physicalDepositVerified: false; absenceOfDepositVerified: false; terminalLossVerified: false; financialEffectAuthorized: false; inventoryReleaseAuthorized: false; labelVoidAuthorized: false;
}
export interface TransportReviewEffects {financialEffectAuthorized: false; inventoryReleaseAuthorized: false}
export interface TransportReviewSource {orderRevision: string; sourceHash: string; financialSourceHash: string; reviewId: string | null; reviewRevision: string | null; reviewHash: string | null}
export interface TransportHistoricalReference {orderRevision: string | null; sourceHash: string | null; financialSourceHash: string | null; reviewId: string | null; reviewRevision: string | null; reviewHash: string | null}
export interface TransportCapture {captureId: string; displayHash: string; sourceHash: string; readVersion: number}
export interface TransportCorrectionResolution extends TransportReviewEffects {
  state: 'absent' | 'resolved_current' | 'review_required'; correctionId: string | null; resolutionQualified: boolean; ownCorrectionBlocksProgress: boolean;
  action: 'continue_held_release' | 'retain_released_history' | null; decidedAt: string | null; effectiveFundsReleaseAt: string | null; effectiveProtectionEndsAt: string | null;
  protectionQualification: 'native_policy_window' | 'historical_deadline' | 'released_history' | 'unknown'; source: TransportReviewSource; otherGuardsRetained: true;
}
export interface TransportReviewSourceView extends TransportReviewEffects {
  labelDepositDeadline?: LabelDepositDeadlineSource;
  deadlineContextQualification?: 'same_deadline_and_label' | 'changed_or_unknown' | 'not_selected';
  protocol: 'transport_review_source_v1'; transactionId: string; reference: TransportReviewSource; capture: TransportCapture | null;
  captureQualification: 'native_capture' | 'absent' | 'historical_unknown'; currentCapture: boolean; observedStatusCode: string | null;
  observedAt: string | null; occurredAt: string | null; shippedAt: string | null; estimatedDelivery: string | null; transportContext: boolean;
  etaInformationalOnly: true; elapsedTimeProvesLoss: false; releaseQualification: 'native_release_recorded' | 'native_held_deadline_recorded' | 'historical_unknown';
  correction: null | {correctionId: string; detectedAt: string | null; originalDeliveryAt: string | null; originalFundsReleaseAt: string | null;
    originalFundsReleasedAt: string | null; currentFundsReleaseAt: string | null; currentFundsReleasedAt: string | null};
  correctionResolution: TransportCorrectionResolution; otherGuards: string[]; correctionResolvable: boolean; parcelPossessionVerified: false;
}
export interface TransportInquiryEntry {
  kind: 'evidence' | 'carrier_contact' | 'participant_contact' | 'follow_up' | 'assessment';
  source: 'operator_observation' | 'participant_statement' | 'carrier_statement' | 'document_reference';
  summary: string; reference: string | null; occurredAt: string | null; nextFollowUpAt: string | null;
}
export interface TransportRecordedEntry extends TransportInquiryEntry {recordedBy: string; recordedAt: string | null;
  sourceExamined: TransportHistoricalReference | null; sourceDeclared: true; independentlyVerified: false}
export interface TransportReviewDecision {finding: string | null; outcome: string | null; reason: string; ownerMessage: string;
  recordedBy: string; recordedAt: string | null; sourceExamined: TransportHistoricalReference | null; financialEffectAuthorized: false; otherGuardsRetained: true}
export interface TransportReview extends TransportReviewEffects {
  protocol: 'transport_review_v1'; reviewId: string; transactionId: string; kind: TransportReviewKind; version: number;
  state: 'open' | 'closed' | 'resolved' | 'financial_review_required'; inquiryState: 'open' | 'closed';
  origin: {kind: 'participant'; reportedBy: string; narrative: string; reportVerified: false} | {kind: 'system'; provider: 'shipengine';
    statusCode: string; trackingSourceHash: string; observationHash: string; occurredAt: string | null; correctionId: string | null;
    disputeId: string | null; previousReviewId: string | null; reportedBy: null} |
    {kind: 'system'; source: 'accepted_contract_deadline'; reportedBy: null; deadline: LabelDepositDeadlineSource};
  initialSource: {reference: TransportHistoricalReference | null; capture: TransportCapture | null; captureQualification: 'native_capture' | 'absent' | 'historical_unknown'};
  entries: TransportRecordedEntry[]; closure: TransportReviewDecision | null; resolution: TransportReviewDecision | null;
  createdAt: string | null; updatedAt: string | null; parcelPossessionVerified: false; terminalLossVerified: false;
}
export type TransportReviewListItem = (TransportReview & {reviewRevision: string | null; reviewHash: string; qualification: 'native_review'}) |
  (TransportReviewEffects & {protocol: 'transport_review_v1'; reviewId: string; transactionId: string; qualification: 'historical_unknown'});
export interface TransportReviews extends TransportReviewEffects {protocol: 'transport_reviews_v1'; ownerId: string; transactionId: string;
  source: TransportReviewSourceView; items: TransportReviewListItem[]; cursor: string | null}
export interface TransportReviewObservation extends TransportReviewSourceView {ownerId: string; review: TransportReview | null}
export type TransportReviewCommand = {transactionId: string; source: TransportReviewSource} & (
  {action: 'report_transit'; narrative: string} |
  {action: 'record_inquiry'; reviewId: string; entry: TransportInquiryEntry; previewId?: string} |
  {action: 'close_inquiry'; reviewId: string; outcome: 'review_completed' | 'signal_not_established' | 'further_action_required'; reason: string; ownerMessage: string; previewId?: string} |
  {action: 'resolve_delivery_correction'; reviewId: string; reason: string; ownerMessage: string; previewId?: string} |
  {action: 'resolve_carrier_exception'; reviewId: string; finding: 'incident_resolved' | 'financial_review_required'; reason: string; ownerMessage: string; previewId?: string}
);
export type TransportOperatorCommand = Exclude<TransportReviewCommand, {action: 'report_transit'}>;
export interface TransportReviewPreview extends TransportReviewEffects {protocol: 'transport_review_preview_v1'; ownerId: string; previewId: string;
  intentHash: string; source: TransportReviewSourceView; review: TransportReview}
export interface TransportReviewAttempt {version: 1; uid: string; requestId: string; command: TransportReviewCommand; capability?: LabelDepositReviewCapability}
export type TransportReviewRefusal = 'command_neutralized' | 'source_changed' | 'transport_context_unqualified' | 'historical_source_unqualified' |
  'preview_unqualified' | 'inquiry_capacity_requires_review' | 'review_already_resolved' | 'delivery_correction_source_unqualified' | 'carrier_exception_source_unqualified' |
  'deadline_inquiry_only' | 'deadline_source_changed_or_unknown';
export interface TransportReviewReceipt extends TransportReviewEffects {protocol: 'transport_review_command_v1'; ownerId: string; requestId: string;
  transactionId: string; payloadHash: string; state: 'unrecorded' | 'committed' | 'not_executed'; reviewId: string | null;
  reviewVersion: number | null; reason: TransportReviewRefusal | null; recordedAt: string | null}
