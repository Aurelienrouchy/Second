export const PRIVACY_OPERATIONS_CAPABILITY = 'support_privacy_operations_v2';
export const PRIVACY_ACTIONS = ['capture_prepare', 'capture_advance', 'release_copy', 'correct_profile', 'disposition_scope_prepare', 'disposition_scope_advance', 'disposition_authorize', 'disposition_execute', 'disposition_reconcile'] as const;
export type PrivacyAction = typeof PRIVACY_ACTIONS[number];
export type PrivacyJson = null | boolean | number | string | PrivacyJson[] | {[key: string]: PrivacyJson};
export interface PrivacyReference {id: string; contentHash: string}
export interface PrivacyAttempt {version: 2; uid: string; requestId: string; descriptor: {caseId: string; action: PrivacyAction; payloadHash: string}}
export interface PrivacyReceipt {protocol: 'support_privacy_operation_receipt_v2'; actorId: string; requestId: string; caseId: string; action: PrivacyAction; payloadHash: string;
  state: 'unrecorded' | 'not_executed' | 'committed'; committed: boolean; replayed: boolean; recordedAt: string | null; reasonCode: string | null; reference: PrivacyReference | null;
  effectVerified: false; externalOutcomeNotAsserted: true; legalCompletionVerified: false}
export interface PrivacyCapture {protocol: 'privacy_native_capture_v1'; reference: PrivacyReference; caseId: string; ownerId: string; status: 'capturing' | 'complete' | 'unavailable'; version: number;
  nativeReadTime: {seconds: number; nanoseconds: number}; cursor: {protocol: 'privacy_capture_position_v1'; phase: string; afterId: string | null; pendingChatPages: number};
  pages: number; inspected: number; unknownEntries: number; reason: string | null; knownNativeSourceSetClosed: boolean;
  inventory: {version: string; phases: {id: string; collection: string; field: string | null; op: string | null}[]; unknowns: string[]; legalSourceUniverseVerified: false};
  externalSourcesSearched: false; legalSourceUniverseVerified: false; legalRequestCompleted: false}
export interface PrivacyEntry extends PrivacyReference {sourcePath: string; sourceRevision: string | null; sourceHash: string; phase: string; exists: boolean;
  qualification: 'native_selected_fields' | 'native_document_absent' | 'projection_requires_manual_review'; values: Record<string, PrivacyJson> | null; thirdPartyMinimizationVerified: false; sourceUniverseVerified: false}
export interface PrivacyCaptureEntries {capture: PrivacyCapture; entries: PrivacyEntry[]; nextCursor: string | null; exhaustiveLegalSearchVerified: false}
export type PrivacyPatch = {displayName?: string; bio?: string | null};
export interface PrivacyProfileSource {path: string; revision: string; sourceHash: string; before: Record<string, {present: boolean; value: PrivacyJson}>}
export interface PrivacyProfilePreview {protocol: 'privacy_profile_correction_preview_v1'; caseId: string; ownerId: string; source: PrivacyProfileSource; patch: PrivacyPatch;
  contractsChanged: false; ledgerChanged: false; authEmailPhoneChanged: false}
export type PrivacyTarget = {service: 'firestore'; kind: 'notification' | 'draft' | 'saved_search' | 'search_history' | 'profile'; id: string | null}
  | {service: 'storage'; objectName: string; generation: string} | {service: 'stripe'} | {service: 'auth'};
export interface PrivacyHold {id: string; version: number | null; revision: string | null; sourceHash: string; kind: string; qualification: string}
export interface PrivacyScopeEntry extends PrivacyReference {kind: 'hold' | 'financial_source'; sourcePath: string; sourceRevision: string | null; sourceHash: string;
  caseKind: string | null; version: number | null; qualification: 'native' | 'unknown'; blockers: string[]}
export interface PrivacyDispositionScope {protocol: 'privacy_disposition_scope_v1'; reference: PrivacyReference; caseId: string; ownerId: string; target: PrivacyTarget;
  status: 'capturing' | 'review_required' | 'complete' | 'unavailable' | 'stale'; version: number; nativeReadTime: {seconds: number; nanoseconds: number}; phase: string;
  currentPage: null | {reference: PrivacyReference; phase: string; entries: PrivacyScopeEntry[]}; reviewsRequired: boolean;
  progress: {pages: number; inspected: number; reviewedHolds: number; financialSources: number}; blockers: string[]; reason: string | null;
  knownNativeSourceSetClosed: boolean; sourceSetExhaustive: false; globalErasureVerified: false}
export interface PrivacyScopeReview {entry: PrivacyReference; resolution: 'ended_for_exact_target' | 'not_applicable_to_exact_target'; reason: string}
export interface PrivacyDispositionPreview {protocol: 'privacy_disposition_preview_v1'; caseId: string; ownerId: string; target: PrivacyTarget; sourceHash: string;
  source: {ownerId: string; target: PrivacyTarget; source: Record<string, PrivacyJson>; accountId: string | null; holds: PrivacyHold[]; blockers: string[]; [key: string]: unknown};
  policy: {protocol: 'privacy_disposition_criteria_v1'; version: 1; contentHash: string; sources: string[]; criteria: string[]; statutoryRetentionPeriodInvented: false; technicalAdminIsNotAutomaticallyRpr: true};
  legalAuthorityAutomaticallyVerified: false; globalErasureVerified: false; currentNativeSourcesOnly: true}
export interface PrivacyDispositionReview {policyVersion: 1; policyHash: string; purposesAccomplished: true; legalRetentionReviewed: true; legalRetentionRequired: false;
  recourseReviewed: true; recoursePreservationRequired: false; scopeReviewed: true;
  holdReviews: {id: string; version: number | null; revision: string | null; sourceHash: string; resolution: 'ended_for_exact_target' | 'not_applicable_to_exact_target'; reason: string}[];
  basis: string; reason: string; recourse: string; reviewDueAt: string}
export interface PrivacyDisposition {protocol: 'privacy_disposition_v1'; reference: PrivacyReference; caseId: string; ownerId: string; target: PrivacyTarget; state: 'authorized' | 'post_authorized' | 'unknown' | 'complete';
  version: number; reason: string | null; recourse: string | null; reviewDueAt: string | null; recordedAt: string | null; postAuthorizedAt: string | null; completedAt: string | null; outcome: PrivacyJson;
  globalErasureVerified: false; financialRecordsDeleted: false; retainedRecords: ['contracts', 'ledger', 'support_and_disposition_receipts']}
export type PrivacyCollection = 'captures' | 'dispositions' | 'copies' | 'corrections' | 'inspections';
export interface PrivacyPage {inspected: number; limit: 20; nextCursor: string | null}
export interface PrivacyState {protocol: 'privacy_operations_state_v1'; actorId: string; caseId: string; ownerId: string; collection: PrivacyCollection;
  entries: (PrivacyCapture | PrivacyDisposition | PrivacyDispositionScope | {reference: PrivacyReference; recordedAt: string; reason: string | null})[]; page: PrivacyPage; globalErasureVerified: false; legalRequestCompleted: false}
export interface PrivacyReleasedCopies {protocol: 'privacy_released_copies_v1'; actorId: string; ownerId: string; caseId: string; entries: {reference: PrivacyReference; recordedAt: string; entryCount: number}[]; page: PrivacyPage; legalRequestCompleted: false}
export interface PrivacyReleasedCopy {protocol: 'privacy_released_copy_view_v1'; actorId: string; caseId: string; reference: PrivacyReference;
  copy: {protocol: 'privacy_selected_copy_v1'; caseId: string; ownerId: string; captureReference: PrivacyReference; entries: {entry: PrivacyReference; sourcePath: string; values: Record<string, PrivacyJson>}[];
    recordedAt: string; minimizationAccepted: true; necessityAccepted: true; legalRequestCompleted: false; recipientReadingVerified: false; externalSourcesSearched: false};
  recipientReadingVerified: false; legalRequestCompleted: false}
export type PrivacyCommand = {action: 'capture_prepare'} | {action: 'capture_advance'; captureReference: PrivacyReference; expectedCaptureVersion: number}
  | {action: 'release_copy'; captureReference: PrivacyReference; selections: {entry: PrivacyReference; fields: string[]}[]; reason: string; minimizationAccepted: true; necessityAccepted: true}
  | {action: 'correct_profile'; patch: PrivacyPatch; expectedSource: PrivacyProfileSource; reason: string}
  | {action: 'disposition_scope_prepare'; target: PrivacyTarget}
  | {action: 'disposition_scope_advance'; inspectionReference: PrivacyReference; expectedVersion: number; reviews: PrivacyScopeReview[]}
  | {action: 'disposition_authorize'; target: PrivacyTarget; expectedSourceHash: string; review: PrivacyDispositionReview; inspectionReference?: PrivacyReference}
  | {action: 'disposition_execute'; dispositionReference: PrivacyReference; expectedVersion: number}
  | {action: 'disposition_reconcile'; dispositionReference: PrivacyReference};
