/** Content decisions never grant financial or identity sanctions. */
export const CONTENT_SAFETY_ENABLED: boolean = true;
export type ContentSafetyReason = 'review_pressure' | 'refund_pressure' | 'threat' | 'personal_information';
export type ContentUrgency = 'yes' | 'no' | 'unknown';
export interface ContentSafetyStatement {protocol: 'content_safety_statement_v1'; urgency: ContentUrgency; linkedReviewId: string | null}
export interface ContentTarget {targetType: 'review' | 'message'; targetId: string}
export interface ContentDecisionReference {id: string; contentHash: string; version: number}
export interface ContentSafetySelection extends ContentTarget {reportId: string | null; decisionReference?: ContentDecisionReference}
export interface ContentEffects {refundAuthorized: false; banAuthorized: false; faultEstablished: false; physicalReceiptVerified: false; deliveredCopiesErasureVerified: false; bearerUrlRevocation: 'unknown'}
export interface ContentMediaWithdrawal {protocol:'content_media_withdrawal_view_v1';state:'not_required'|'pending'|'unknown'|'needs_review'|'observed_revoked';managedObjectCount:number|null;privatelyPreservedCount:number|null;revokedObjectCount:number|null;referenceCoverage:'native_managed_only'|'unknown_or_external'|'unknown';observedAt:string|null;priorBearerAccessRestored:false;externalUrlsWithdrawalVerified:false;deliveredCopiesErasureVerified:false}
export interface ContentCommand extends ContentTarget {scope: 'own' | 'admin'; action: 'report' | 'contest' | 'maintain' | 'hide' | 'restore'; reportId: string | null;
  sourceHash: string; previewId: string; reason: ContentSafetyReason; description: string | null; urgency: ContentUrgency;
  privateNote: string | null; ownerMessage: string | null; decisionReference: ContentDecisionReference | null; acknowledged: true; ratingAloneIsNotRemovalGround: true}
export interface ContentAttempt {version: 1; uid: string; requestId: string; command: ContentCommand}
export interface ContentEntry extends ContentEffects {reference: ContentDecisionReference; action: ContentCommand['action']; reason: ContentSafetyReason; description: string | null;
  urgency: ContentUrgency; ownerMessage: string | null; privateNote: string | null; relatedDecision: ContentDecisionReference | null;
  visibilityAtCommit: 'hidden' | 'visible'; recordedAt: string; historicalOnly: true}
export interface ContentSource extends ContentTarget {protocol: 'content_moderation_source_v1'; reportId: string | null; sourceHash: string; qualification: 'native_content' | 'unknown';
  contentHash: string; contentRevision: string | null; reportHash: string; reportRevision: string | null; caseVersion: number | null; caseHash: string; originalHash: string | null;
  parent: {kind: 'chat' | 'order' | 'swap'; id: string; revision: string} | null; parties: string[]}
export interface ContentPreview extends ContentTarget, ContentEffects {protocol: 'content_moderation_preview_v1' | 'content_moderation_history_v1'; actorId: string; scope: 'own' | 'admin'; reportId: string | null;
  mediaWithdrawal: ContentMediaWithdrawal;
  source: ContentSource; previewId: string; current: Record<string, unknown> | null; original: Record<string, unknown> | null;
  messageEvidence: Record<string, unknown> | null; reportEvidence: {qualification: 'native_report_capture'; body: Record<string, unknown>; sourceHash: string; recordedAt: string} | null;
  report: {reason: string | null; description: string | null; urgency: ContentUrgency; status: string | null} | null;
  selectedDecision?: {qualification: 'native_addressed_entry'; entry: ContentEntry} | null; currentDecision: ContentEntry | null; options: ContentCommand['action'][];
  entries: ({qualification: 'native_content_entry'; entry: ContentEntry} | {qualification: 'unknown'; entryId: string; entry: null})[];
  nextCursor: {lastId: string} | null; coverage: {inspected: number; limit: 20; hasMore: boolean; exhaustiveHistoryVerified: false} | null}
export interface ContentReceipt extends ContentEffects {protocol: 'content_moderation_command_v1'; actorId: string; requestId: string; command: ContentCommand; payloadHash: string;
  mediaWithdrawal: ContentMediaWithdrawal;
  state: 'unrecorded' | 'committed' | 'not_executed'; reason: string | null; reportId: string | null; caseId: string | null; entryId: string | null;
  entryReference: ContentDecisionReference | null; recordedAt: string | null; documentNeutralizedAtCommit: boolean; storageSdkRestrictionAtCommit: boolean}
export interface ContentOriginalFile extends ContentTarget, ContentEffects {protocol: 'content_original_file_v1'; actorId: string; reportId: string; sourceHash: string;
  generation: string; crc32c: string | null; sha256: string; contentType: string; base64: string; originalAtReportTimeVerified: false; physicalContentVerified: false}
export const CONTENT_REASON_LABELS: Record<ContentSafetyReason, string> = {review_pressure: 'Pression pour obtenir ou modifier un avis', refund_pressure: 'Pression liée à un remboursement', threat: 'Menace déclarée', personal_information: 'Divulgation de renseignements personnels'};
