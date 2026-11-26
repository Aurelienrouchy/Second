import type {AuthorityCase, AuthorityPackageReference, AuthorityReception, AuthoritySelection, AuthoritySource, AuthorityField} from './authorityRequest';
import type {SupportConfidentialTarget, SupportOpaqueCommandReference} from './supportConfidentiality';
export const SUPPORT_LEGAL_REVIEW_CAPABILITY = 'support_legal_review_v2' as const;
export type LegalReviewArea = 'confidential_original' | 'authority_request';
export type LegalReviewReference = {id: string; contentHash: string};
export type LegalEvidenceRef = {evidenceId: string; generation: string; sha256: string; sizeBytes: number};
export type LegalEvidencePurpose = 'identity' | 'power' | 'legal_basis' | 'delegation' | 'human_send' | 'external_receipt';
export type LegalEvidence = {evidence: LegalEvidenceRef; purpose: LegalEvidencePurpose; uploadedAt: string | null};
export type LegalProofRead = {readReference: LegalReviewReference; evidence: LegalEvidenceRef};
export type LegalExaminationKey = 'identity' | 'power' | 'legalBasis' | 'delegation';
export type LegalExaminations = Record<LegalExaminationKey, {state: 'supported' | 'unknown' | 'insufficient'; reason: string; proofReads: LegalProofRead[]}>;
export type LegalOriginalContext = {revision: string; version: number; sourceHash: string};
export type LegalOriginalSource = {protocol: 'support_confidential_source_v2'; actorId: string; caseId: string;
  fields: {target: SupportConfidentialTarget; canProtectOwnField: boolean; canConfineField: boolean; confined: boolean}[];
  context: LegalOriginalContext; original: null; legalAuthorityVerified: false; authorizationScope: 'one_exact_field_per_instruction'};
export type LegalOriginalCommand = {action: 'read_original_field'; target: SupportConfidentialTarget; context: LegalOriginalContext;
  purpose: 'support_handling' | 'privacy_rights' | 'security_review'; reason: string; necessityAccepted: true; minimizationAccepted: true};
export type LegalAuthorityCommand = {action: 'upload_evidence'; caseId: string; source: AuthoritySource; purpose: LegalEvidencePurpose; jpegBase64: string} |
  {action: 'read_evidence'; caseId: string; source: AuthoritySource; evidence: LegalEvidenceRef} |
  {action: 'authorize_package'; caseId: string; source: AuthoritySource; packageReference: AuthorityPackageReference; review: LegalExaminations; reason: string} |
  {action: 'read_authorized_package'; caseId: string; source: AuthoritySource; packageReference: AuthorityPackageReference; authorizationReference: LegalReviewReference} |
  {action: 'attest_human_send'; caseId: string; source: AuthoritySource; packageReference: AuthorityPackageReference; authorizationReference: LegalReviewReference;
    recipient: AuthorityReception['requester']; channel: 'secure_email' | 'registered_mail' | 'secure_portal' | 'in_person'; sentAt: string; externalReference: string; proofRead: LegalProofRead; reason: string} |
  {action: 'record_external_receipt'; caseId: string; source: AuthoritySource; sendReference: LegalReviewReference; receivedAt: string; externalReference: string; proofRead: LegalProofRead; reason: string};
export type LegalReviewCommand = LegalOriginalCommand | LegalAuthorityCommand;
/** Only this descriptor is persisted. Bodies, source snapshots and local media stay volatile. */
export type LegalReviewAttempt = {version: 2; uid: string; area: LegalReviewArea; requestId: string; descriptor: {caseId: string; action: LegalReviewCommand['action']; payloadHash: string}};
export type LegalReviewReceipt = {protocol: 'support_legal_review_receipt_v2'; area: LegalReviewArea; actorId: string; requestId: string;
  caseId: string; action: LegalReviewCommand['action']; payloadHash: string; state: 'unrecorded' | 'committed' | 'not_executed'; committed: boolean; replayed: boolean;
  recordedAt: string | null; reasonCode: 'command_neutralized' | 'source_changed' | 'examinations_unknown' | null; reference: LegalReviewReference | null;
  evidence: LegalEvidenceRef | null; storageOutcome: 'not_asserted'; originalRedisclosed: false; legalAuthorityVerified: false; financialEffect: 'none'};
export type LegalOriginalResult = {protocol: 'support_confidential_original_v2'; actorId: string; caseId: string; field: string; original: string;
  accessAudited: true; auditReference: LegalReviewReference; receipt: LegalReviewReceipt; authorizationScope: 'current_exact_field_only';
  legalAuthorityVerified: false; corporateDelegationInferred: false; financialEffect: 'none'};
export type LegalEvidenceReadResult = {protocol: 'authority_evidence_read_result_v2'; actorId: string; caseId: string; evidence: LegalEvidenceRef;
  readReference: LegalReviewReference; purpose: LegalEvidencePurpose; jpegBase64: string; receipt: LegalReviewReceipt};
export type LegalDisclosurePayload = {protocol: 'authority_disclosure_payload_v2'; caseId: string; packageReference: AuthorityPackageReference;
  selection: AuthoritySelection; items: {transactionId: string; fields: Partial<Record<AuthorityField, {qualification: 'native'; value: unknown}>>}[];
  excludedCategories: string[]; legalAuthorityVerified: false};
export type LegalPackageReadResult = {protocol: 'authority_authorized_package_read_v2'; actorId: string; caseId: string; payload: LegalDisclosurePayload;
  payloadContentHash: string; receipt: LegalReviewReceipt; externalCommunicationPerformed: false; legalAuthorityVerified: false};
export type LegalReviewResult = LegalReviewReceipt | LegalOriginalResult | LegalEvidenceReadResult | LegalPackageReadResult;
export type LegalProofCapture = LegalProofRead & {evidenceSourceHash: string; purpose: LegalEvidencePurpose};
export type LegalAuthorizationRecord = {protocol: 'authority_package_authorization_v2'; actorId: string; authTime: number; caseId: string; source: AuthoritySource;
  packageReference: AuthorityPackageReference; payloadContentHash: string; review: LegalExaminations; proofs: LegalProofCapture[]; reason: string; recordedAt: string;
  authorizationScope: 'exact_current_package_only'; humanExaminationsRecorded: true; corporateDelegationAutomaticallyInferred: false;
  legalAuthorityVerified: false; externalCommunicationPerformed: false; financialEffect: 'none'};
export type LegalSendRecord = {protocol: 'authority_human_send_attestation_v2'; actorId: string; caseId: string; source: AuthoritySource;
  authorizationReference: LegalReviewReference; packageReference: AuthorityPackageReference; payloadContentHash: string; recipient: AuthorityReception['requester'];
  channel: 'secure_email' | 'registered_mail' | 'secure_portal' | 'in_person'; sentAt: string; externalReference: string; proof: LegalProofCapture; reason: string;
  recordedAt: string; humanSendAttested: true; externalCommunicationIndependentlyVerified: false; legalAuthorityVerified: false; financialEffect: 'none'};
export type LegalExternalReceiptRecord = Omit<LegalSendRecord, 'protocol' | 'sentAt' | 'humanSendAttested' | 'externalCommunicationIndependentlyVerified'> & {
  protocol: 'authority_external_receipt_recorded_v2'; sendReference: LegalReviewReference; receivedAt: string; externalAcknowledgmentRecorded: true;
  externalReceiptIndependentlyVerified: false; currentDisclosurePermissionGranted: false};
export type LegalPage<T> = {items: T[]; hasMore: boolean; cursor: string | null};
export type LegalAuthorityCursors = {evidenceCursor: string | null; authorizationCursor: string | null; eventCursor: string | null};
export type LegalAuthorityDetail = {protocol: 'authority_request_detail_v2'; actorId: string; caseId: string; source: AuthoritySource; case: AuthorityCase;
  evidence: LegalPage<LegalEvidence>; authorizations: LegalPage<{reference: LegalReviewReference; record: LegalAuthorizationRecord}>;
  events: LegalPage<{reference: LegalReviewReference; record: LegalSendRecord | LegalExternalReceiptRecord}>;
  legalAuthorityVerified: false; externalCommunicationPerformed: false; financialEffect: 'none'};
export type LegalOriginalSelection = {caseId: string; reference: SupportOpaqueCommandReference | null};
