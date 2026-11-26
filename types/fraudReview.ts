export type FraudReviewScope = 'owner' | 'admin';
export interface FraudReviewClock {
  qualification: 'native_timestamp' | 'provider_object_created' | 'provider_read' | 'provider_event' | 'unknown'; at: string | null;
}
export interface FraudReviewSource {caseRevision: string | null; caseSourceHash: string; orderRevision: string | null; orderSourceHash: string | null}
export interface FraudReviewCursor {lastId: string}
export type FraudReviewAction = 'retain_review' | 'close_review_for_sources';
export interface FraudHumanReview {qualification: 'unrecorded' | 'unknown' | 'native_human_receipt'; action: FraudReviewAction | null;
  decisionId: string | null; decidedAt: FraudReviewClock; appliesToLatestObservation: boolean}
export interface FraudReviewNoEffect {
  guiltEstablished: false; identityDecision: 'none'; financialEffectAuthorized: false; inventoryReleaseAuthorized: false;
  guardReleased: false; recipientReceiptVerified: false; bankReceiptVerified: false;
}
export interface FraudReviewCaseSummary extends FraudReviewNoEffect {
  caseId: string; transactionId: string | null; qualification: 'native_case' | 'unknown'; publicState: 'human_review_required' | 'review_closed_for_sources' | 'unknown';
  humanReview: FraudHumanReview;
  firstObservedAt: FraudReviewClock; source: FraudReviewSource;
}
export interface FraudReviewPagination {inspected: number; limit: 10 | 20; hasMore: boolean; nextCursor: FraudReviewCursor | null}
export interface FraudReviewCases extends FraudReviewNoEffect {
  protocol: 'fraud_owner_cases_v1' | 'fraud_admin_cases_v1'; ownerId: string; transactionId: string | null; readAt: string;
  items: FraudReviewCaseSummary[]; pagination: FraudReviewPagination; coverage: {source: 'native_case_records'; exhaustiveRiskHistoryVerified: false};
}
export interface FraudReviewObservation extends FraudReviewNoEffect {
  observationId: string; qualification: 'native_observation' | 'unknown'; recordedAt: FraudReviewClock;
  attribution: 'native_order_qualified_at_observation' | 'unknown';
  payment: {qualification: 'provider_get_qualified_at_observation' | 'unknown'; currency: 'CAD'; captureState: 'captured' | 'authorized' | 'unknown';
    amountCents: number | null; capturedCents: number | null; occurredAt: FraudReviewClock; bankReceiptVerified: false};
  signalCreatedAt: FraudReviewClock; signalOccurredAt: FraudReviewClock; physicalDepositTimeVerified: false; nonDepositVerified: false; reviewStillRequired: true;
}
export interface FraudReviewTransport {
  qualification: 'native_capture' | 'unknown'; currentSource: boolean;
  capture: null | {captureId: string; displayHash: string; sourceHash: string; readId: string; readVersion: number};
  providerStatusCode: string | null; recordedAt: FraudReviewClock; providerReadAt: FraudReviewClock; providerEventAt: FraudReviewClock;
  physicalDepositTimeVerified: false; nonDepositVerified: false; recipientReceiptVerified: false;
}
export interface FraudReviewDetail extends FraudReviewNoEffect {
  protocol: 'fraud_owner_case_v1' | 'fraud_admin_case_v1'; ownerId: string; transactionId: string | null; caseId: string; readAt: string;
  source: FraudReviewSource; qualification: 'native_case' | 'unknown'; publicState: 'human_review_required' | 'review_closed_for_sources' | 'unknown'; humanReview: FraudHumanReview;
  guard: {qualification: 'native_review_guard' | 'unknown' | 'absent'; reviewMarkerPresent: boolean; restrictionEnforcementVerified: false};
  items: FraudReviewObservation[]; currentTransport: FraudReviewTransport | null; pagination: FraudReviewPagination;
  coverage: {source: 'native_observations'; chronologicalOrderVerified: false; exhaustiveRiskHistoryVerified: false};
  resolution: {state: 'human_review_required' | 'review_closed_for_sources' | 'unknown'; resolvedAt: FraudReviewClock; legalDeadline: FraudReviewClock};
}
export interface FraudDecisionEffects {guiltEstablished: false; identityDecision: 'none'; financialEffectAuthorized: false;
  inventoryReleaseAuthorized: false; independentHoldsReleased: false; currentGuardStateVerified: false}
export interface FraudDecisionSource {orderRevision: string; orderSourceHash: string; caseSetHash: string}
export interface FraudDecisionCaseReference {
  caseId: string; caseRevision: string | null; caseSourceHash: string; observationId: string | null; observationRevision: string | null;
  observationHash: string | null; reviewKey: string | null; qualification: 'native_current_case' | 'unknown';
  humanAction: FraudReviewAction | 'unknown' | 'unreviewed'; humanDecisionId: string | null;
}
export interface FraudDecisionPreview extends FraudDecisionEffects {
  protocol: 'fraud_review_preview_v1'; actorId: string; transactionId: string; readAt: string; source: FraudDecisionSource; cases: FraudDecisionCaseReference[];
  coverage: {inspected: number; limit: 30; hasMore: boolean; completeCurrentCaseSet: boolean; source: 'currently_attributed_native_cases'; exhaustiveRiskHistoryVerified: false};
  canCloseOwnReview: boolean; canRetainReview: boolean; markerQualification: 'native_or_absent' | 'unknown'; options: FraudReviewAction[];
}
export interface FraudDecisionCommand {transactionId: string; source: FraudDecisionSource; action: FraudReviewAction; reason: string; acknowledged: true}
export interface FraudDecisionAttempt {version: 1; uid: string; requestId: string; command: FraudDecisionCommand}
export interface FraudDecisionReceipt extends FraudDecisionEffects {
  protocol: 'fraud_review_command_v1'; actorId: string; requestId: string; payloadHash: string; transactionId: string; action: FraudReviewAction;
  state: 'unrecorded' | 'committed' | 'not_executed'; decisionId: string | null; recordedAt: string | null;
  reason: null | 'requester_neutralized' | 'native_order_source_unqualified' | 'source_changed' | 'no_attributed_case' | 'case_set_or_marker_unqualified';
  ownMarkerRemovedAtCommit: boolean;
}
