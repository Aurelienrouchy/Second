import {isSupportPostClosureBasis} from '@/utils/supportPostClosureContract';
import {isSupportActivityAssessment, isSupportActivityProgram} from '@/utils/supportActivityReviewContract';
import {isDeclaredSupportAccountId, isDeclaredSupportAccountList} from '@/utils/supportAccountIdentity';
import {getSupportProjectionGeneration,assertSupportProjectionGeneration,qualifySupportProjection} from '@/services/supportProjectionGuard';
import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {SupportConfidentialityService} from '@/services/supportConfidentialityService';
import {SupportConfidentialityJournal} from '@/services/supportConfidentialityJournal';
import {isSupportOpaqueAttempt,isSupportConfidentialAttempt} from '@/utils/supportConfidentialityContract';
import type {SupportOpaqueAttempt,SupportConfidentialAttempt,SupportConfidentialReceipt,SupportOpaqueCommandReference,SupportOpaqueReceipt} from '@/types/supportConfidentiality';
import { auth, functions } from '@/config/firebaseConfig';
import { isOwnerAdmissionDecision, isPurchaseAutomaticRefundDecision } from '@/services/automatedDecisionService';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { isSwapFundReleaseDecision, isSwapHoldSource } from '@/services/swapHoldReviewService';
import { parseWithdrawalTimingSource } from '@/services/withdrawalTimingService';
import { isReturnToSenderSupportReference, isReturnToSenderSupportSource } from '@/services/returnToSenderService';
import { isLateCommercialLink, isLateCommercialSupportView } from '@/services/lateCommercialRecourseService';
import { SUPPORT_PRIVACY_CATEGORIES, type SupportJournalEntry,type SupportServicingReceipt, type SupportAttempt, type SupportDetail, type SupportEventsCursor, type SupportList, type SupportListCursor, type SupportReceipt,
  type SupportRequest, type SupportScope, type SupportResponse, type SupportAccountSource, type SupportAccountReview, type SupportRepresentation, type SupportAccountReviewInput,
  type SupportTransportInstruction, type SupportTransportInstructionInput, type SupportTransportSource, type SupportSwapHoldContext, type SupportSwapHoldSource, type SupportWithdrawalTimingContext,
  type SupportPrivacyCategory, type SupportPrivacyScope, type SupportPrivacyRetention, SUPPORT_ACCOUNT_REVIEW_CAPABILITY, type SupportAccountReviewInputV2, type SupportAccountReviewV2, type SupportAccountReviewOwnerV2, type SupportAccountReviewPreview, type SupportAccountEvidenceRef, type SupportAccountEvidenceRead, type SupportAccountEvidence, type SupportAccountObligationRef, type SupportAccountObligation, type SupportProviderObservation, type SupportAccountReviewCommandV2, type SupportAccountReviewJournalV2, type SupportAccountEvidenceJournalV2, type SupportAccountReviewOpaqueReceiptV2, type SupportDeadlineCursor, type SupportDeadlineItem, type SupportDeadlineLane, type SupportDeadlinePage, type SupportBankDeadlineItem, type SupportBankDeadlineTarget } from '@/types/supportRequest';
import type { LateTransportIncidentReference, LateTransportRefundObservation } from '@/types/lateTransportIncident';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 200 &&
  !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 4000;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const nullableText = (v: unknown) => v === null || text(v);
const nullableDate = (v: unknown) => v === null || date(v);
export const ACCOUNT_SUPPORT_KINDS = ['account_reconciliation', 'restriction_circumvention', 'representation_review', 'payment_account_review', 'activity_compliance_review'] as const;
const kinds = ['commercial_late', 'access_interruption', 'personal_data_access', 'personal_data_correction', 'automated_decision_review', 'swap_hold_assistance', 'withdrawal_timing_assistance', ...ACCOUNT_SUPPORT_KINDS];
const ownerActions = ['submit', 'clarify', 'withdraw', 'link_evidence'];
const adminActions = ['assign', 'request_details', 'respond', 'internal_note', 'record_account_review', 'record_transport_instruction'];
const accountFindings = ['unresolved', 'no_link_established', 'link_requires_manual_action', 'representation_not_verified', 'representation_requires_manual_verification'];
const evidenceKinds = ['commercial_dispute', 'eligibility_request', 'support_request', 'meetup_declaration'];
const meetupReasons = ['article_refused', 'disagreement_after_declaration', 'safety_or_pressure'];
const unknown = () => new Error('Le résultat reste à vérifier avec exactement la même demande. Une absence ou un délai ne confirme aucun refus ni dépôt.');
const key = (uid: string, scope: SupportScope) => `second:support-command:v1:${JSON.stringify([uid, scope])}`;
const locks = new Set<string>();
const writes = new Map<string, Promise<void>>();
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])]));
  return v ?? null;
}
export const supportCommandHash = (v: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
export const newSupportRequestId = () => randomUUID();
export function supportError(error: unknown) { return error instanceof Error ? error.message : 'La demande ne peut pas être vérifiée actuellement.'; }
function validResponse(v: unknown): v is SupportResponse {
  return object(v) && text(v.text) && nullableText(v.legalBasis) && nullableText(v.recourse) && isDeclaredSupportAccountId(v.recordedBy) && date(v.recordedAt) &&
    v.legalQualificationVerified === false && v.dataSearchCompletedVerified === false && v.externalRecourseDeadlineExtended === false;
}
const accountKind = (v: unknown) => (ACCOUNT_SUPPORT_KINDS as readonly unknown[]).includes(v);
const declaredAccounts = isDeclaredSupportAccountList;
const nativeRevision = (v: unknown) => v === null || typeof v === 'string' && /^\d+:\d+$/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const supportSwapDecision = (v: unknown, swapId: unknown) => {
  if (!object(v) || !id(swapId) || v.financialExecutionVerified !== false) return false;
  const {financialExecutionVerified: _coverage, ...entry} = v;
  return isSwapFundReleaseDecision(entry, swapId);
};
export const isSupportPrivacyKind = (v: unknown) => v === 'personal_data_access' || v === 'personal_data_correction';
const privacyCategory = (v: unknown): v is SupportPrivacyCategory => (SUPPORT_PRIVACY_CATEGORIES as readonly unknown[]).includes(v);
const utf8Bytes = (v: string) => Array.from(v).reduce((sum, char) => {
  const code = char.codePointAt(0)!; return sum + (code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4);
}, 0);
function privacyObject(v: unknown, maxBytes = 128): v is SupportPrivacyScope['objects'][number] {
  return object(v) && exact(v, ['category', 'id']) && privacyCategory(v.category) && typeof v.id === 'string' && !!v.id &&
    utf8Bytes(v.id) <= maxBytes && !v.id.includes('/') && !['.', '..'].includes(v.id) && !/^__.*__$/.test(v.id);
}
function privacyScope(v: unknown): v is SupportPrivacyScope {
  return object(v) && exact(v, ['protocol', 'categories', 'objects', 'description']) && v.protocol === 'privacy_scope_v1' &&
    Array.isArray(v.categories) && v.categories.length > 0 && v.categories.length <= 16 && v.categories.every(privacyCategory) &&
    new Set(v.categories).size === v.categories.length && Array.isArray(v.objects) && v.objects.length <= 20 &&
    v.objects.every(o => privacyObject(o) && (v.categories as unknown[]).includes(o.category)) &&
    new Set(v.objects.map(o => JSON.stringify([o.category, o.id]))).size === v.objects.length &&
    (v.description === null || text(v.description) && v.description.length <= 2000);
}
function privacyRetention(v: unknown, request: SupportRequest): v is SupportPrivacyRetention {
  if (!object(v) || !isSupportPrivacyKind(request.kind) || !exact(v, ['protocol', 'qualification', 'state', 'declaredScope',
    'protectedCategories', 'protectedObjects', 'initialReceivedAt', 'ticketVersion', 'reviewCondition', 'releaseAuthorized',
    'legalExpiryEstablished', 'responseClosesPreservation', 'historicalDeletionReversed']) ||
    v.protocol !== 'support_privacy_retention_view_v1' || !['native_preservation', 'unknown'].includes(String(v.qualification)) ||
    v.state !== 'protected_pending_review' || !(v.declaredScope === null || privacyScope(v.declaredScope)) ||
    !Array.isArray(v.protectedCategories) || !v.protectedCategories.length || v.protectedCategories.length > 16 ||
    !v.protectedCategories.every(privacyCategory) || new Set(v.protectedCategories).size !== v.protectedCategories.length ||
    !Array.isArray(v.protectedObjects) || v.protectedObjects.length > 1600 || !v.protectedObjects.every(o => privacyObject(o, 1500) &&
      ((v.protectedCategories as unknown[]).includes('other_or_unknown') || (v.protectedCategories as unknown[]).includes(o.category))) ||
    new Set(v.protectedObjects.map(o => JSON.stringify([o.category, o.id]))).size !== v.protectedObjects.length ||
    v.initialReceivedAt !== request.receivedAt || v.ticketVersion !== request.version ||
    v.reviewCondition !== 'qualified_completion_and_recourse_retention_review' ||
    ['releaseAuthorized', 'legalExpiryEstablished', 'responseClosesPreservation', 'historicalDeletionReversed'].some(key => v[key] !== false)) return false;
  return v.qualification !== 'unknown' || v.declaredScope === null && v.protectedObjects.length === 0 &&
    v.protectedCategories.length === 1 && v.protectedCategories[0] === 'other_or_unknown';
}
const qualifiedRevision = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) return false;
  const [seconds, nanos] = v.split(':').map(Number);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 && Number.isSafeInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000;
};
export function isLateTransportReference(v: unknown): v is LateTransportIncidentReference {
  return object(v) && exact(v, ['kind', 'transactionId', 'incidentId', 'incidentRevision', 'incidentHash', 'financialSourceHash', 'orderRevision']) &&
    v.kind === 'late_transport_incident' && id(v.transactionId) && typeof v.incidentId === 'string' && /^late_[a-f0-9]{64}$/.test(v.incidentId) &&
    qualifiedRevision(v.incidentRevision) && hash(v.incidentHash) && hash(v.financialSourceHash) && qualifiedRevision(v.orderRevision);
}
function transportInstructionInput(v: unknown): v is SupportTransportInstructionInput {
  return object(v) && exact(v, ['type', 'reason', 'ownerMessage', 'source']) && ['return', 'retain', 'regularisation_review'].includes(String(v.type)) &&
    text(v.reason) && text(v.ownerMessage) && (isLateTransportReference(v.source) || isReturnToSenderSupportReference(v.source));
}
function transportInstruction(v: unknown): v is SupportTransportInstruction {
  return object(v) && exact(v, ['protocol', 'type', 'reason', 'ownerMessage', 'source', 'recordedBy', 'recordedAt', 'requestId', 'financialEffect',
    'recipientReceiptVerified', 'bankReceiptVerified', 'inventoryReleaseAuthorized', 'humanExaminationVerified']) &&
    transportInstructionInput({type: v.type, reason: v.reason, ownerMessage: v.ownerMessage, source: v.source}) &&
    v.protocol === 'support_transport_instruction_v1' && isDeclaredSupportAccountId(v.recordedBy) && date(v.recordedAt) && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) &&
    v.financialEffect === 'none' && ['recipientReceiptVerified', 'bankReceiptVerified', 'inventoryReleaseAuthorized', 'humanExaminationVerified'].every(key => v[key] === false);
}
function refundObservation(v: unknown): v is LateTransportRefundObservation {
  if (!object(v) || !exact(v, ['qualification', 'state', 'intentId', 'requestedAt', 'fundsAppliedAt']) ||
    !['native_intent', 'historical_unknown'].includes(String(v.qualification)) || !['engaged', 'unknown', 'confirmed'].includes(String(v.state))) return false;
  if (v.qualification === 'historical_unknown') return v.state === 'unknown' && v.intentId === null && v.requestedAt === null && v.fundsAppliedAt === null;
  return id(v.intentId) && date(v.requestedAt) && (v.state === 'confirmed' ? date(v.fundsAppliedAt) && Date.parse(v.fundsAppliedAt) >= Date.parse(v.requestedAt) : v.fundsAppliedAt === null);
}
function transportSource(v: unknown): v is SupportTransportSource {
  if (!object(v) || !exact(v, ['protocol', 'reference', 'providerStatusCode', 'providerOccurredAt', 'providerObservedAt', 'temporalRelation',
    'refundAtObservation', 'refundCurrentlyRecorded', 'financialSourceCurrent', 'recipientReceiptVerified', 'bankReceiptVerified', 'financialEffectAuthorized', 'inventoryReleaseAuthorized']) ||
    v.protocol !== 'late_transport_support_source_v1' || !isLateTransportReference(v.reference) || !['IT', 'DE'].includes(String(v.providerStatusCode)) ||
    !date(v.providerObservedAt) || !(v.providerOccurredAt === null || date(v.providerOccurredAt) && Date.parse(v.providerOccurredAt) <= Date.parse(v.providerObservedAt)) ||
    !refundObservation(v.refundAtObservation) || !refundObservation(v.refundCurrentlyRecorded) || typeof v.financialSourceCurrent !== 'boolean' ||
    ['recipientReceiptVerified', 'bankReceiptVerified', 'financialEffectAuthorized', 'inventoryReleaseAuthorized'].some(key => v[key] !== false)) return false;
  const expected = v.providerOccurredAt === null || v.refundAtObservation.requestedAt === null ? 'unknown' :
    Date.parse(v.providerOccurredAt as string) > Date.parse(v.refundAtObservation.requestedAt) ? 'after_refund_request' : 'before_or_at_refund_request';
  return v.temporalRelation === expected;
}
export const supportAttemptCanNeutralize=(attempt:SupportJournalEntry)=>isSupportOpaqueAttempt(attempt)||validAttempt(attempt,attempt.uid,attempt.scope);
function withdrawalTimingContext(v: unknown): v is SupportWithdrawalTimingContext {
  return object(v) && exact(v, ['protocol', 'withdrawalRequestId', 'sourceRevision', 'sourceHash', 'sourceQualification', 'recordedAt',
    'declaredIssueSource', 'bankReceiptVerified', 'financialEffectAuthorized']) && v.protocol === 'support_withdrawal_timing_context_v1' &&
    typeof v.withdrawalRequestId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v.withdrawalRequestId) && qualifiedRevision(v.sourceRevision) && hash(v.sourceHash) &&
    ['qualified', 'unknown'].includes(String(v.sourceQualification)) && date(v.recordedAt) && v.declaredIssueSource === 'owner_narrative' &&
    v.bankReceiptVerified === false && v.financialEffectAuthorized === false;
}
function swapHoldContext(v: unknown): v is SupportSwapHoldContext {
  return object(v) && exact(v, ['protocol', 'swapId', 'participantRole', 'sourceRevision', 'recordedAt', 'declaredIssueSource', 'financialExecutionVerified', 'holdReleased', 'physicalReceiptVerified']) &&
    v.protocol === 'support_swap_hold_context_v1' && id(v.swapId) && ['initiator', 'receiver'].includes(String(v.participantRole)) &&
    qualifiedRevision(v.sourceRevision) && date(v.recordedAt) && v.declaredIssueSource === 'owner_narrative' &&
    v.financialExecutionVerified === false && v.holdReleased === false && v.physicalReceiptVerified === false;
}
function swapHoldSource(v: unknown): v is SupportSwapHoldSource {
  return object(v) && exact(v, ['protocol', 'swapId', 'swapRevision', 'swapSourceHash', 'observedAt', 'source', 'financialEffectAuthorized', 'holdReleaseAuthorized', 'physicalReceiptVerified']) &&
    v.protocol === 'support_swap_hold_source_v1' && id(v.swapId) && (v.swapRevision === null || qualifiedRevision(v.swapRevision)) && hash(v.swapSourceHash) &&
    date(v.observedAt) && isSwapHoldSource(v.source, v.observedAt) && v.financialEffectAuthorized === false && v.holdReleaseAuthorized === false && v.physicalReceiptVerified === false;
}
function representationInput(v: unknown): boolean {
  return object(v) && ['death', 'incapacity'].includes(String(v.reason)) && text(v.relationship) && v.relationship.length <= 300 &&
    text(v.authorityStatement) && v.authorityStatement.length <= 2000;
}
function representation(v: unknown): v is SupportRepresentation {
  return representationInput(v) && object(v) && Object.keys(v).every(k => ['reason', 'relationship', 'authorityStatement', 'source', 'deathOrIncapacityVerified', 'authorityVerified'].includes(k)) &&
    v.source === 'reporter_declaration' && v.deathOrIncapacityVerified === false && v.authorityVerified === false;
}
function sourceReference(v: unknown): boolean {
  return object(v) && isDeclaredSupportAccountId(v.declaredAccountId) && hash(v.sourceHash) && nativeRevision(v.userRevision) && nativeRevision(v.eligibilityRevision);
}
export function isSupportAccountSource(v: unknown): v is SupportAccountSource {
  return sourceReference(v) && object(v) && Object.keys(v).every(k => ['protocol', 'declaredAccountId', 'sourceHash', 'userRevision', 'eligibilityRevision',
    'userDocumentState', 'eligibilityDocumentState', 'activeFieldState', 'closureRecordState', 'accountExistenceVerified', 'accountRelationshipVerified',
    'representationAuthorityVerified', 'restrictionCircumventionEstablished', 'otherAccountAccessGranted', 'paymentAuthorityGranted', 'sameNameOrBirthOrBankProvesRelationship'].includes(k)) &&
    v.protocol === 'support_account_source_v1' && ['present', 'absent'].includes(String(v.userDocumentState)) && ['present', 'absent'].includes(String(v.eligibilityDocumentState)) &&
    (v.userDocumentState === 'absent' ? v.userRevision === null && v.activeFieldState === 'unknown' : typeof v.userRevision === 'string') &&
    (v.eligibilityDocumentState === 'absent' ? v.eligibilityRevision === null && v.closureRecordState === 'source_absent' : typeof v.eligibilityRevision === 'string') &&
    ['active_recorded', 'inactive_recorded', 'unknown'].includes(String(v.activeFieldState)) && ['source_absent', 'absent', 'recorded', 'historical_unknown'].includes(String(v.closureRecordState)) &&
    ['accountExistenceVerified', 'accountRelationshipVerified', 'representationAuthorityVerified', 'restrictionCircumventionEstablished', 'otherAccountAccessGranted', 'paymentAuthorityGranted', 'sameNameOrBirthOrBankProvesRelationship'].every(k => v[k] === false);
}
function accountReviewInput(v: unknown): v is SupportAccountReviewInput {
  return object(v) && Object.keys(v).every(k => ['finding', 'reason', 'expectedSources'].includes(k)) && accountFindings.includes(String(v.finding)) && text(v.reason) &&
    Array.isArray(v.expectedSources) && v.expectedSources.length >= 1 && v.expectedSources.length <= 5 && v.expectedSources.every(source => sourceReference(source) && object(source) &&
      Object.keys(source).every(k => ['declaredAccountId', 'sourceHash', 'userRevision', 'eligibilityRevision'].includes(k))) &&
    new Set(v.expectedSources.map(source => source.declaredAccountId)).size === v.expectedSources.length;
}
function accountReview(v: unknown): v is SupportAccountReview {
  return object(v) && Object.keys(v).every(k => ['protocol', 'finding', 'reason', 'sources', 'recordedBy', 'recordedAt', 'accountRelationshipVerified',
    'representationAuthorityVerified', 'restrictionCircumventionEstablished', 'otherAccountAccessGranted', 'paymentAuthorityGranted', 'automaticActionTaken'].includes(k)) &&
    v.protocol === 'support_account_review_v1' && accountFindings.includes(String(v.finding)) && text(v.reason) && isDeclaredSupportAccountId(v.recordedBy) && date(v.recordedAt) &&
    Array.isArray(v.sources) && v.sources.length >= 1 && v.sources.length <= 5 && v.sources.every(isSupportAccountSource) &&
    new Set(v.sources.map(source => source.declaredAccountId)).size === v.sources.length &&
    ['accountRelationshipVerified', 'representationAuthorityVerified', 'restrictionCircumventionEstablished', 'otherAccountAccessGranted', 'paymentAuthorityGranted', 'automaticActionTaken'].every(k => v[k] === false);
}
const reviewV2Findings = ['restrict_new_operations', 'lift_own_restriction', 'representation_authority_confirmed', 'representation_not_confirmed', 'provider_restriction_maintained', 'provider_documents_requested', 'provider_recourse_recorded', 'activity_restriction_maintained', 'activity_documents_requested', 'activity_no_prohibition_identified'];
const reviewEffects = (v: Record<string, unknown>, physical = true) => ['otherAccountAccessGranted', 'paymentAuthorityGranted', 'providerRestrictionOverridden', 'accountsMerged', 'fundsMoved', ...(physical ? ['physicalIdentityAutomaticallyInferred'] : [])].every(k => v[k] === false);
const evidenceRef = (v: unknown): v is SupportAccountEvidenceRef => object(v) && exact(v, ['evidenceId', 'generation', 'sha256', 'sizeBytes']) && /^spe_[a-f0-9]{64}$/.test(String(v.evidenceId)) && typeof v.generation === 'string' && /^[1-9]\d*$/.test(v.generation) && hash(v.sha256) && integer(v.sizeBytes) && v.sizeBytes <= 5 * 1024 * 1024;
const obligationRef = (v: unknown): v is SupportAccountObligationRef => object(v) && ['transaction', 'swap', 'withdrawal', 'wallet'].includes(String(v.kind)) && (v.kind === 'wallet' ? isDeclaredSupportAccountId(v.id) : id(v.id));
const obligation = (v: unknown): v is SupportAccountObligation => obligationRef(v) && object(v) && exact(v, ['kind', 'id', 'sourceHash', 'sourceRevision']) && hash(v.sourceHash) && qualifiedRevision(v.sourceRevision);
const uniqueObligations = (v: unknown): v is SupportAccountObligation[] => Array.isArray(v) && v.length <= 20 && v.every(obligation) && new Set(v.map(o => JSON.stringify([o.kind, o.id]))).size === v.length;
const evidencePurposes = ['identity', 'authority', 'relationship', 'provider_restriction', 'activity', 'regulatory_basis', 'other'];
const reviewEvidence = (v: unknown): v is SupportAccountEvidence => object(v) && exact(v, ['evidence', 'purpose', 'uploadedAt']) && evidenceRef(v.evidence) && evidencePurposes.includes(String(v.purpose)) && date(v.uploadedAt);
const reviewReads = (v: unknown): v is SupportAccountReviewInputV2['evidenceReads'] => Array.isArray(v) && v.length >= 1 && v.length <= 10 && v.every(r => object(r) && exact(r, ['readId', 'evidence']) && /^ser_[a-f0-9]{64}$/.test(String(r.readId)) && evidenceRef(r.evidence)) && new Set(v.map(r => r.evidence.evidenceId)).size === v.length;
function accountReviewOwnerV2(v: unknown): v is SupportAccountReviewOwnerV2 {
  return object(v) && exact(v, ['protocol', 'finding', 'ownerMessage', 'recourse', 'reviewDueAt', 'recordedAt', 'obligations', 'humanReviewRecorded', 'otherAccountAccessGranted', 'paymentAuthorityGranted', 'providerRestrictionOverridden', 'accountsMerged', 'fundsMoved']) && v.protocol === SUPPORT_ACCOUNT_REVIEW_CAPABILITY && reviewV2Findings.includes(String(v.finding)) && text(v.ownerMessage) && text(v.recourse) && date(v.reviewDueAt) && date(v.recordedAt) && Array.isArray(v.obligations) && v.obligations.length <= 20 && v.obligations.every(o => obligationRef(o) && object(o) && exact(o, ['kind', 'id'])) && v.humanReviewRecorded === true && (v.finding === 'representation_authority_confirmed' ? v.obligations.length > 0 : v.obligations.length === 0) && reviewEffects(v, false);
}
function accountReviewInputV2(v: unknown): v is SupportAccountReviewInputV2 {
  return object(v) && exact(v, ['protocol', 'finding', 'subjectUid', 'reason', 'ownerMessage', 'recourse', 'reviewDueAt', 'expectedSources', 'evidenceReads', 'obligations', 'expectedRestrictionReceiptId', 'providerObservationId', 'identityDocumentsReviewed', 'authorityDocumentsReviewed', 'accountRelationshipReviewed', 'documentsReadAccepted', ...(Object.hasOwn(v, 'activityAssessment') ? ['activityAssessment'] : [])]) && v.protocol === SUPPORT_ACCOUNT_REVIEW_CAPABILITY && reviewV2Findings.includes(String(v.finding)) && isDeclaredSupportAccountId(v.subjectUid) && text(v.reason) && text(v.ownerMessage) && text(v.recourse) && date(v.reviewDueAt) && Array.isArray(v.expectedSources) && v.expectedSources.length >= 1 && v.expectedSources.length <= 5 && v.expectedSources.every(source => sourceReference(source) && object(source) && exact(source, ['declaredAccountId', 'sourceHash', 'userRevision', 'eligibilityRevision'])) && new Set(v.expectedSources.map(source => source.declaredAccountId)).size === v.expectedSources.length && reviewReads(v.evidenceReads) && uniqueObligations(v.obligations) && (v.expectedRestrictionReceiptId === null || hash(v.expectedRestrictionReceiptId)) && (v.providerObservationId === null || /^spo_[a-f0-9]{64}$/.test(String(v.providerObservationId))) && typeof v.identityDocumentsReviewed === 'boolean' && typeof v.authorityDocumentsReviewed === 'boolean' && typeof v.accountRelationshipReviewed === 'boolean' && v.documentsReadAccepted === true && (v.activityAssessment == null || isSupportActivityAssessment(v.activityAssessment, false));
}
function providerRestriction(v: unknown): boolean {
  return v === null || object(v) && exact(v, ['protocol', 'ownerId', 'observedAt', 'category', 'action', 'message', 'bankChangeResolvesRestriction', 'payoutPermissionGranted']) && v.protocol === 'connect_payout_restriction_v1' && isDeclaredSupportAccountId(v.ownerId) && date(v.observedAt) && text(v.category) && text(v.action) && text(v.message) && v.bankChangeResolvesRestriction === false && v.payoutPermissionGranted === false;
}
function accountReviewV2(v: unknown): v is SupportAccountReviewV2 {
  if (!object(v) || !exact(v, ['protocol', 'finding', 'subjectUid', 'reason', 'ownerMessage', 'recourse', 'reviewDueAt', 'sources', 'evidenceReads', 'obligations', 'providerSource', 'identityDocumentsReviewed', 'authorityDocumentsReviewed', 'accountRelationshipReviewed', 'representationAuthorityVerified', 'authorityScope', 'representativeUid', 'decisionReceiptId', 'recordedBy', 'recordedAt', 'legalIdentityAutomaticallyVerified', 'otherAccountAccessGranted', 'paymentAuthorityGranted', 'providerRestrictionOverridden', 'accountsMerged', 'fundsMoved', 'physicalIdentityAutomaticallyInferred', ...(Object.hasOwn(v, 'activityAssessment') ? ['activityAssessment'] : []), ...(Object.hasOwn(v, 'postClosureBasis') ? ['postClosureBasis'] : [])]) || v.protocol !== SUPPORT_ACCOUNT_REVIEW_CAPABILITY || !reviewV2Findings.includes(String(v.finding)) || !isDeclaredSupportAccountId(v.subjectUid) || !text(v.reason) || !text(v.ownerMessage) || !text(v.recourse) || !date(v.reviewDueAt) || !date(v.recordedAt) || !isDeclaredSupportAccountId(v.recordedBy) || !hash(v.decisionReceiptId) || !Array.isArray(v.sources) || !v.sources.length || v.sources.length > 5 || !v.sources.every(isSupportAccountSource) || !v.sources.some(source => source.declaredAccountId === v.subjectUid) || !reviewReads(v.evidenceReads) || !uniqueObligations(v.obligations) || typeof v.identityDocumentsReviewed !== 'boolean' || typeof v.authorityDocumentsReviewed !== 'boolean' || typeof v.accountRelationshipReviewed !== 'boolean' || v.legalIdentityAutomaticallyVerified !== false || !reviewEffects(v) || v.activityAssessment != null && !isSupportActivityAssessment(v.activityAssessment, true) || v.postClosureBasis != null && !isSupportPostClosureBasis(v.postClosureBasis, String(v.subjectUid))) return false;
  const rep = String(v.finding).startsWith('representation_'), provider = String(v.finding).startsWith('provider_');
  if (v.activityAssessment == null && ['restrict_new_operations', 'lift_own_restriction'].includes(String(v.finding)) && (!v.identityDocumentsReviewed || !v.accountRelationshipReviewed || v.evidenceReads.length < 2)) return false;
  if (v.representationAuthorityVerified !== (v.finding === 'representation_authority_confirmed') || v.authorityScope !== (rep ? 'selected_existing_obligations_only' : 'new_operations_only') || (rep ? !isDeclaredSupportAccountId(v.representativeUid) || !v.obligations.length || !v.identityDocumentsReviewed || !v.authorityDocumentsReviewed : v.representativeUid !== null || v.obligations.length > 0)) return false;
  return provider ? object(v.providerSource) && exact(v.providerSource, ['observationId', 'accountId', 'providerSourceHash', 'ownerRestriction', 'observedAtMs']) && /^spo_[a-f0-9]{64}$/.test(String(v.providerSource.observationId)) && /^acct_[A-Za-z0-9_]{1,190}$/.test(String(v.providerSource.accountId)) && hash(v.providerSource.providerSourceHash) && integer(v.providerSource.observedAtMs) && providerRestriction(v.providerSource.ownerRestriction) : v.providerSource === null;
}

function validMeetupDeclaration(v: unknown, transactionId: string): boolean {
  return object(v) && v.protocol === 'meetup_declaration_evidence_v1' && v.transactionId === transactionId &&
    (v.articleId === null || id(v.articleId)) && ['buyer', 'seller'].includes(String(v.ownerRole)) &&
    ['meetup', 'historical_unknown'].includes(String(v.deliveryType)) && ['native_cash_agreement', 'historical_unknown'].includes(String(v.agreementQualification)) &&
    (v.agreementQualification === 'native_cash_agreement' ? hash(v.agreementId) && v.deliveryType === 'meetup' : v.agreementId === null) &&
    ['pending', 'confirmed', 'completion_declared', 'cancelled', 'expired', 'disputed', 'historical_unknown'].includes(String(v.phase)) && nullableText(v.phaseSourceStatus) &&
    ['recorded', 'absent', 'historical_unknown'].includes(String(v.completionState)) &&
    nullableDate(v.completionDeclaredAt) && (v.completionDeclaredBy === null || id(v.completionDeclaredBy)) &&
    (v.completionState === 'recorded' ? date(v.completionDeclaredAt) && id(v.completionDeclaredBy)
      : v.completionState === 'absent' ? v.completionDeclaredAt === null && v.completionDeclaredBy === null : true) &&
    ['native_metadata', 'absent', 'historical_unknown'].includes(String(v.noticeState)) && date(v.capturedAt) &&
    ['notificationCommittedVerified', 'deviceDeliveryVerified', 'physicalPresenceVerified', 'physicalHandoverVerified', 'outsidePaymentVerified', 'mutualConsentVerified', 'faultEstablished']
      .every(field => v[field] === false);
}
export function parseSupportRequest(v: unknown, scope: SupportScope, uid?: string): SupportRequest {
  if (!object(v) || v.protocol !== 'support_request_v1' || !id(v.id) || !isDeclaredSupportAccountId(v.ownerId) || scope === 'owner' && v.ownerId !== uid ||
    !kinds.includes(String(v.kind)) || !['submitted', 'needs_information', 'withdrawn', 'answered'].includes(String(v.status)) || !integer(v.version) ||
    !text(v.narrative) || !date(v.receivedAt) || !integer(v.receivedAtMs) || Date.parse(v.receivedAt) !== v.receivedAtMs ||
    !date(v.recordedAt) || !id(v.clockOriginSupportRequestId) || v.deadlineBasis !== 'application_initial_receipt' || v.earliestExternalReceiptVerified !== false ||
    typeof v.receivedCivilDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.receivedCivilDate) ||
    !(v.statutoryDueDate === null || typeof v.statutoryDueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.statutoryDueDate)) ||
    !['response_recorded', 'overdue', 'pending', 'not_applicable'].includes(String(v.deadlineState)) ||
    !(v.silenceEffect === null || v.silenceEffect === 'refusal_not_permission') || v.deadlineExtended !== false ||
    !nullableDate(v.discoveredAt) || !nullableDate(v.interruptionAt) || v.declaredDatesVerified !== false ||
    !(v.priorSupportRequestId === null || id(v.priorSupportRequestId)) || !(v.transactionId === null || id(v.transactionId)) ||
    !nullableText(v.ownerMessage) || !(v.ownerResponse === null || validResponse(v.ownerResponse)) || !nullableText(v.latestClarification) ||
    !nullableDate(v.withdrawnAt) || !date(v.updatedAt) || v.financialEffect !== 'none' || v.admissionVerified !== false ||
    v.accountRecoveryGranted !== false || v.rightsRestored !== false || v.humanExaminationVerified !== false ||
    v.responseCompletenessVerified !== false || v.notificationDeliveryVerified !== false || !Array.isArray(v.evidence) || v.evidence.length > 30 ||
    !v.evidence.every(e => object(e) && evidenceKinds.includes(String(e.kind)) && id(e.id) && text(e.revision) && hash(e.sourceHash) &&
      (e.kind === 'meetup_declaration' ? validMeetupDeclaration(e.meetupDeclaration, e.id) : e.meetupDeclaration === undefined))) throw unknown();
  if (v.meetupReason != null && (!meetupReasons.includes(String(v.meetupReason)) || v.kind !== 'commercial_late' || !id(v.transactionId) ||
      !v.evidence.some(e => object(e) && e.kind === 'meetup_declaration' && e.id === v.transactionId))) throw unknown();
  if (v.decision !== null && (!object(v.decision) || !id(v.decision.id) || !text(v.decision.revision) || !hash(v.decision.sourceHash) ||
    v.decision.transactionId !== v.transactionId || !nullableText(v.decision.decisionType) || !object(v.decision.criteria) ||
    typeof v.decision.result !== 'string' || !nullableDate(v.decision.executedAt) || v.decision.financialExecutionVerified !== false)) throw unknown();
  const swapDecisionReview = v.kind === 'automated_decision_review' && v.swapId !== undefined;
  if (v.kind === 'automated_decision_review' && v.transactionId === null && (swapDecisionReview
    ? !supportSwapDecision(v.decision, v.swapId) : !isOwnerAdmissionDecision(v.decision, String(v.ownerId)) || v.decision.revision === null)) throw unknown();
  if (object(v.decision) && v.decision.protocol === 'purchase_automatic_refund_v1' && !isPurchaseAutomaticRefundDecision(v.decision)) throw unknown();
  if (accountKind(v.kind)) {
    if (!declaredAccounts(v.relatedAccountIds) || v.relatedAccountsDeclaredOnly !== true ||
      ['relatedAccountExistenceVerified', 'accountRelationshipVerified', 'representationAuthorityVerified', 'otherAccountAccessGranted', 'paymentAuthorityGranted'].some(k => v[k] !== false) ||
      (v.kind === 'representation_review' ? !representation(v.representation) : v.representation !== null)) throw unknown();
  } else if (v.relatedAccountIds !== undefined && (!Array.isArray(v.relatedAccountIds) || v.relatedAccountIds.length) ||
    v.representation !== undefined && v.representation !== null ||
    ['relatedAccountExistenceVerified', 'accountRelationshipVerified', 'representationAuthorityVerified', 'otherAccountAccessGranted', 'paymentAuthorityGranted'].some(k => v[k] !== undefined && v[k] !== false) ||
    v.relatedAccountsDeclaredOnly !== undefined && v.relatedAccountsDeclaredOnly !== true) throw unknown();
  if (v.lateTransport !== undefined && v.lateTransport !== null && (!isLateTransportReference(v.lateTransport) || v.kind !== 'commercial_late' ||
    v.transactionId !== v.lateTransport.transactionId || v.meetupReason != null)) throw unknown();
  if (v.returnToSender !== undefined && v.returnToSender !== null && (!isReturnToSenderSupportReference(v.returnToSender) || v.kind !== 'commercial_late' ||
    v.transactionId !== v.returnToSender.transactionId || v.meetupReason != null || v.lateTransport != null)) throw unknown();
  if (v.transportInstruction !== undefined && v.transportInstruction !== null) {
    if (!transportInstruction(v.transportInstruction) || v.transportInstruction.source.transactionId !== v.transactionId) throw unknown();
    const instructionSource = v.transportInstruction.source;
    if (instructionSource.kind === 'late_transport_incident' ? !isLateTransportReference(v.lateTransport) ||
      instructionSource.incidentId !== v.lateTransport.incidentId || instructionSource.incidentHash !== v.lateTransport.incidentHash :
      !isReturnToSenderSupportReference(v.returnToSender) || instructionSource.caseId !== v.returnToSender.caseId ||
      instructionSource.caseHash !== v.returnToSender.caseHash || instructionSource.caseRevision !== v.returnToSender.caseRevision) throw unknown();
  }
  if (v.kind === 'swap_hold_assistance' ? !id(v.swapId) || !swapHoldContext(v.swapHoldContext) || v.swapHoldContext.swapId !== v.swapId ||
    v.transactionId !== null || v.meetupReason != null || v.decision !== null || v.lateTransport != null || v.returnToSender != null || v.transportInstruction != null :
    swapDecisionReview ? !id(v.swapId) || !supportSwapDecision(v.decision, v.swapId) || v.transactionId !== null || v.swapHoldContext !== undefined ||
      v.meetupReason != null || v.lateTransport != null || v.returnToSender != null || v.transportInstruction != null :
    v.swapId !== undefined || v.swapHoldContext !== undefined) throw unknown();
  if (v.kind === 'withdrawal_timing_assistance' ? !id(v.withdrawalRequestId) || !withdrawalTimingContext(v.withdrawalTimingContext) ||
    v.withdrawalTimingContext.withdrawalRequestId !== v.withdrawalRequestId || v.transactionId !== null || v.meetupReason != null || v.decision !== null ||
    v.lateTransport != null || v.returnToSender != null || v.transportInstruction != null : v.withdrawalRequestId !== undefined || v.withdrawalTimingContext !== undefined) throw unknown();
  if (scope === 'owner' && v.accountReview != null && !accountKind(v.kind)) throw unknown();
  if (scope === 'owner' && ('internalNote' in v || 'assignedAdminId' in v || ('accountReview' in v && v.accountReview !== null && !accountReviewOwnerV2(v.accountReview)) || 'accountSources' in v || 'transportSource' in v || 'swapHoldSource' in v || 'withdrawalTimingSource' in v || 'returnToSenderSource' in v)) throw unknown();
  if (scope === 'admin' && (!(v.assignedAdminId === null || isDeclaredSupportAccountId(v.assignedAdminId)) || !nullableText(v.internalNote))) throw unknown();
  const relatedAccountIds = v.relatedAccountIds;
  if (scope === 'admin' && v.accountReview !== undefined && v.accountReview !== null && (!accountKind(v.kind) || !(accountReview(v.accountReview) || accountReviewV2(v.accountReview)) ||
    !Array.isArray(relatedAccountIds) || v.accountReview.sources.length !== relatedAccountIds.length || v.accountReview.sources.some(source => !relatedAccountIds.includes(source.declaredAccountId)))) throw unknown();
  const parsed = { ...v, meetupReason: v.meetupReason ?? null } as unknown as SupportRequest;
  if (v.privacyRetention !== undefined && !privacyRetention(v.privacyRetention, parsed)) throw unknown();
  if (v.lateCommercial !== undefined && (v.kind !== 'commercial_late' || !isLateCommercialSupportView(v.lateCommercial, parsed.transactionId))) throw unknown();
  if(v.confidentiality!==undefined){const c=v.confidentiality;if(!object(c)||!exact(c,['protocol','state','originalRetained','originalReadAuthorized','externalCopiesErased'])||c.protocol!=='support_confidentiality_projection_v1'||!['fields_confined','not_recorded','unknown'].includes(String(c.state))||c.originalRetained!==true||c.originalReadAuthorized!==false||c.externalCopiesErased!==false)throw unknown();}
  return parsed;
}
function validAttempt(v: unknown, uid: string, scope: SupportScope): v is SupportAttempt {
  if (!object(v) || v.version !== 1 || v.uid !== uid || v.scope !== scope || typeof v.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) || !object(v.command) || Object.keys(v).some(k => !['version', 'uid', 'scope', 'requestId', 'command', 'privacyRetentionCapability', 'lateCommercialCapability'].includes(k)) ||
    v.privacyRetentionCapability !== undefined && v.privacyRetentionCapability !== 'privacy_retention_v1' ||
    v.lateCommercialCapability !== undefined && (scope !== 'owner' || v.lateCommercialCapability !== 'late_commercial_recourse_v1')) return false;
  const c = v.command;
  const keys = scope === 'owner' ? ['action', 'supportRequestId', 'expectedVersion', 'kind', 'narrative', 'transactionId', 'discoveredAt', 'interruptionAt', 'priorSupportRequestId', 'decision', 'evidence', 'meetupReason', 'relatedAccountIds', 'representation', 'lateTransport', 'swapId', 'withdrawalRequestId', 'returnToSender', 'privacyScope', 'lateCommercial']
    : ['action', 'supportRequestId', 'expectedVersion', 'assignedAdminId', 'ownerMessage', 'internalNote', 'response', 'accountReview', 'transportInstruction'];
  if (Object.keys(c).some(k => !keys.includes(k)) || !(scope === 'owner' ? ownerActions : adminActions).includes(String(c.action))) return false;
  if (c.privacyScope !== undefined && (scope !== 'owner' || !privacyScope(c.privacyScope) || c.action === 'submit' && !isSupportPrivacyKind(c.kind) ||
    v.privacyRetentionCapability !== 'privacy_retention_v1')) return false;
  if (c.lateCommercial !== undefined && (scope !== 'owner' || !isLateCommercialLink(c.lateCommercial) ||
    !['submit', 'clarify'].includes(String(c.action)) || c.action === 'submit' && (c.kind !== 'commercial_late' ||
      c.transactionId !== c.lateCommercial.transactionId || c.meetupReason !== undefined || c.lateTransport !== undefined || c.returnToSender !== undefined) ||
    v.lateCommercialCapability !== 'late_commercial_recourse_v1')) return false;
  if (c.action !== 'submit' && (!id(c.supportRequestId) || !integer(c.expectedVersion))) return false;
  if (c.action === 'submit' && (!kinds.includes(String(c.kind)) || !text(c.narrative) || c.supportRequestId !== undefined || c.expectedVersion !== undefined ||
    c.kind === 'commercial_late' && !id(c.transactionId))) return false;
  if (['clarify', 'withdraw', 'link_evidence'].includes(String(c.action)) && !text(c.narrative)) return false;
  if (c.action === 'assign' && !isDeclaredSupportAccountId(c.assignedAdminId) || c.action === 'request_details' && !text(c.ownerMessage) ||
    c.action === 'internal_note' && !text(c.internalNote) || c.action === 'respond' && (!object(c.response) || !text(c.response.text) ||
    c.response.legalBasis !== undefined && !text(c.response.legalBasis) || c.response.recourse !== undefined && !text(c.response.recourse))) return false;
  if (c.action === 'record_account_review' ? !accountReviewInput(c.accountReview) : c.accountReview !== undefined) return false;
  if (c.action === 'record_transport_instruction' ? !transportInstructionInput(c.transportInstruction) : c.transportInstruction !== undefined) return false;
  if (c.lateTransport !== undefined && (c.action !== 'submit' || c.kind !== 'commercial_late' || !isLateTransportReference(c.lateTransport) ||
    c.lateTransport.transactionId !== c.transactionId || c.meetupReason !== undefined || c.returnToSender !== undefined)) return false;
  if (c.returnToSender !== undefined && (c.action !== 'submit' || c.kind !== 'commercial_late' || !isReturnToSenderSupportReference(c.returnToSender) ||
    c.returnToSender.transactionId !== c.transactionId || c.meetupReason !== undefined || c.lateTransport !== undefined)) return false;
  const swapDecisionReview = c.action === 'submit' && c.kind === 'automated_decision_review' && c.swapId !== undefined;
  if (c.action === 'submit' && c.kind === 'swap_hold_assistance' ? !id(c.swapId) || c.transactionId !== undefined || c.meetupReason !== undefined ||
    c.decision !== undefined || c.lateTransport !== undefined || c.returnToSender !== undefined || c.evidence !== undefined && (!Array.isArray(c.evidence) || c.evidence.length > 0) :
    swapDecisionReview ? !id(c.swapId) || c.transactionId !== null || c.meetupReason !== undefined || c.lateTransport !== undefined || c.returnToSender !== undefined ||
      !object(c.decision) || !exact(c.decision, ['id', 'revision', 'sourceHash']) || !/^swap_funds_released_[a-f0-9]{64}$/.test(String(c.decision.id)) ||
      !qualifiedRevision(c.decision.revision) || !hash(c.decision.sourceHash) || !Array.isArray(c.evidence) || c.evidence.length !== 0 : c.swapId !== undefined) return false;
  if (c.action === 'submit' && c.kind === 'withdrawal_timing_assistance' ? typeof c.withdrawalRequestId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(c.withdrawalRequestId) ||
    c.transactionId !== undefined || c.swapId !== undefined || c.meetupReason !== undefined || c.decision !== undefined || c.lateTransport !== undefined || c.returnToSender !== undefined ||
    c.evidence !== undefined && (!Array.isArray(c.evidence) || c.evidence.length > 0) : c.withdrawalRequestId !== undefined) return false;
  if (scope === 'owner') {
    if (c.action === 'submit' && accountKind(c.kind) ? !declaredAccounts(c.relatedAccountIds) ||
      (c.kind === 'representation_review' ? !representationInput(c.representation) || !object(c.representation) ||
        Object.keys(c.representation).some(k => !['reason', 'relationship', 'authorityStatement'].includes(k)) : c.representation !== undefined)
      : c.relatedAccountIds !== undefined || c.representation !== undefined) return false;
    if (c.meetupReason !== undefined && (c.action !== 'submit' || c.kind !== 'commercial_late' || !meetupReasons.includes(String(c.meetupReason)) || !id(c.transactionId) ||
        !Array.isArray(c.evidence) || !c.evidence.some(e => object(e) && e.kind === 'meetup_declaration' && e.id === c.transactionId))) return false;
    if (c.transactionId !== undefined && !(id(c.transactionId) || c.transactionId === null && c.action === 'submit' && c.kind === 'automated_decision_review') || c.priorSupportRequestId !== undefined && !id(c.priorSupportRequestId) ||
      c.discoveredAt !== undefined && !date(c.discoveredAt) || c.interruptionAt !== undefined && !date(c.interruptionAt)) return false;
    if (c.evidence !== undefined && (!Array.isArray(c.evidence) || c.evidence.length > 10 || !c.evidence.every(e => object(e) &&
      Object.keys(e).every(k => ['kind', 'id'].includes(k)) && evidenceKinds.includes(String(e.kind)) && id(e.id)))) return false;
    if (c.action === 'link_evidence' && (!Array.isArray(c.evidence) || !c.evidence.length)) return false;
    if (c.action === 'submit' && c.kind === 'automated_decision_review' && (!(id(c.transactionId) || c.transactionId === null) || !object(c.decision) ||
      !id(c.decision.id) || !text(c.decision.revision) || !hash(c.decision.sourceHash))) return false;
    if (c.decision !== undefined && c.kind !== 'automated_decision_review') return false;
  }
  return true;
}
async function parseReceipt(v: unknown, attempt: SupportAttempt, assertCurrent: () => void): Promise<SupportReceipt> {
  const payloadHash = await supportCommandHash(attempt.command); assertCurrent();
  const supportId = attempt.command.action === 'submit' ? `support_${await supportCommandHash([attempt.uid, attempt.requestId])}` : attempt.command.supportRequestId;
  assertCurrent();
  if (!object(v) || v.protocol !== 'support_command_v1' || v.actorId !== attempt.uid || v.requestId !== attempt.requestId ||
    v.supportRequestId !== supportId || v.action !== attempt.command.action || v.payloadHash !== payloadHash || typeof v.replay !== 'boolean' ||
    !['committed', 'not_executed', 'unrecorded'].includes(String(v.state)) || v.committed !== (v.state === 'committed') ||
    v.admissionVerified !== false || v.financialEffect !== 'none' || v.rightsRestored !== false) throw unknown();
  if (v.state === 'unrecorded') {
    if (v.ownerId !== null || v.request !== null || v.resultVersion !== null || v.recordedAt !== null || v.reason !== null || v.replay !== false) throw unknown();
  } else {
    // New privacy admin journals can be neutralized after role loss, without
    // reading the owner's dossier. This is a receipt, not owner data access.
    if (attempt.scope === 'admin' && attempt.privacyRetentionCapability === 'privacy_retention_v1' &&
      v.state === 'not_executed' && v.reason === 'command_neutralized' && v.ownerId === null &&
      v.request === null && v.resultVersion === null && date(v.recordedAt)) return v as unknown as SupportReceipt;
    if (!isDeclaredSupportAccountId(v.ownerId) || attempt.scope === 'owner' && v.ownerId !== attempt.uid || !date(v.recordedAt) ||
      (v.state === 'committed' ? v.reason !== null : !['source_changed', 'request_closed', 'context_not_authorized', 'prior_context_not_authorized', 'decision_source_changed', 'evidence_not_authorized', 'evidence_context_mismatch', 'source_context_unqualified', 'account_source_changed', 'assignment_target_not_qualified', 'transport_source_changed', 'transport_context_mismatch', 'swap_context_not_authorized', 'withdrawal_context_not_authorized', 'command_neutralized',
        ...(attempt.scope === 'owner' && attempt.lateCommercialCapability === 'late_commercial_recourse_v1' ? ['late_commercial_recourse_not_exposed'] : [])].includes(String(v.reason)))) throw unknown();
    if (v.request === null) {
      if (v.state !== 'not_executed' || v.resultVersion !== null || attempt.command.action !== 'submit') throw unknown();
    } else {
      if (!integer(v.resultVersion)) throw unknown();
      const request = parseSupportRequest(v.request, 'owner', String(v.ownerId));
      if (request.id !== supportId || request.version !== v.resultVersion) throw unknown();
      if (v.state === 'committed' && attempt.command.action === 'submit' && attempt.command.kind === 'swap_hold_assistance' &&
        (request.kind !== 'swap_hold_assistance' || request.swapId !== attempt.command.swapId)) throw unknown();
      if (v.state === 'committed' && attempt.command.action === 'submit' && attempt.command.kind === 'withdrawal_timing_assistance' &&
        (request.kind !== 'withdrawal_timing_assistance' || request.withdrawalRequestId !== attempt.command.withdrawalRequestId)) throw unknown();
      if (v.state === 'committed' && attempt.command.action === 'submit' && attempt.command.kind === 'automated_decision_review') {
        const expected = attempt.command.decision, received = request.decision;
        if (!expected || !received || request.kind !== 'automated_decision_review' || request.transactionId !== attempt.command.transactionId ||
          request.swapId !== attempt.command.swapId ||
          received.id !== expected.id || received.revision !== expected.revision || received.sourceHash !== expected.sourceHash) throw unknown();
      }
      if (v.state === 'committed' && attempt.command.action === 'submit' && attempt.command.lateTransport !== undefined &&
        await supportCommandHash(request.lateTransport) !== await supportCommandHash(attempt.command.lateTransport)) throw unknown();
      if (v.state === 'committed' && attempt.command.action === 'submit' && attempt.command.returnToSender !== undefined &&
        await supportCommandHash(request.returnToSender) !== await supportCommandHash(attempt.command.returnToSender)) throw unknown();
      if (v.state === 'committed' && attempt.command.action === 'record_transport_instruction') {
        const received = request.transportInstruction, declared = attempt.command.transportInstruction;
        if (!received || received.requestId !== attempt.requestId || received.recordedBy !== attempt.uid || received.type !== declared.type ||
          received.reason !== declared.reason || received.ownerMessage !== declared.ownerMessage ||
          await supportCommandHash(received.source) !== await supportCommandHash(declared.source)) throw unknown();
      }
      assertCurrent();
      if (attempt.command.action === 'submit' && attempt.command.meetupReason !== undefined &&
          (request.meetupReason !== attempt.command.meetupReason || request.transactionId !== attempt.command.transactionId)) throw unknown();
      if (attempt.command.action === 'submit' && accountKind(attempt.command.kind)) {
        const declared = attempt.command.representation, received = request.representation;
        if (JSON.stringify(request.relatedAccountIds) !== JSON.stringify(attempt.command.relatedAccountIds) ||
          attempt.command.kind === 'representation_review' && (!received || !declared || received.reason !== declared.reason ||
            received.relationship !== declared.relationship || received.authorityStatement !== declared.authorityStatement)) throw unknown();
      }
    }
  }
  return v as unknown as SupportReceipt;
}
export {isSupportOpaqueAttempt};
export const supportReceiptRequestId=(r:SupportServicingReceipt)=>r.protocol==='support_confidential_opaque_receipt_v1'?r.reference.requestId:r.requestId;
export async function supportJournalReference(a:SupportJournalEntry,guard:()=>void):Promise<SupportOpaqueCommandReference>{const session=captureTradeSession(a.uid),caller=guard;guard=()=>{assertTradeSessionCurrent(session);caller();};guard();if(isSupportOpaqueAttempt(a))return a.reference;const payloadHash=await supportCommandHash(a.command);guard();const supportRequestId=a.command.action==='submit'?`support_${await supportCommandHash([a.uid,a.requestId])}`:a.command.supportRequestId;guard();return {actorId:a.uid,supportRequestId,requestId:a.requestId,payloadHash,action:a.command.action};}
async function qualifiedOpaque(a:SupportOpaqueAttempt,guard:()=>void){if(!isSupportOpaqueAttempt(a))throw unknown();const proof=await SupportConfidentialityService.command(a.protection,'observe',guard);guard();if(proof.state!=='committed'||!['confined','awaiting_native_command'].includes(proof.confinement)||await supportCommandHash(proof.opaqueCommandReference)!==await supportCommandHash(a.reference)||await supportCommandHash(proof.target)!==await supportCommandHash(a.protection.command.target))throw unknown();guard();return proof;}
async function rpc(attempt: SupportAttempt, mode: 'execute', assertContext: () => void): Promise<SupportReceipt> {
  const projection=getSupportProjectionGeneration(),session = captureTradeSession(attempt.uid), assertCurrent = () => { assertTradeSessionCurrent(session);assertSupportProjectionGeneration(projection); assertContext(); };
  assertCurrent(); if (!validAttempt(attempt, attempt.uid, attempt.scope)) throw unknown();
  const reference=await supportJournalReference(attempt,assertCurrent);assertCurrent();if(await SupportConfidentialityJournal.blocksFullReplay(reference,attempt.scope,assertCurrent))throw new Error('Une protection a été demandée pour cette intention. Son texte ne sera pas réémis ; suivez le reçu de protection pour utiliser sa référence opaque.');assertCurrent();
  const callable = httpsCallable<unknown, unknown>(functions, attempt.scope === 'admin' ? 'administerSupportRequest' : 'commandSupportRequest');
  const result = await callable({ expectedUid: attempt.uid, requestId: attempt.requestId, mode, command: attempt.command,
    ...(attempt.command.action === 'submit' && ['payment_account_review', 'activity_compliance_review'].includes(attempt.command.kind) ? {capability: SUPPORT_ACCOUNT_REVIEW_CAPABILITY} : {}),
    ...(attempt.privacyRetentionCapability ? {privacyRetentionCapability: attempt.privacyRetentionCapability} : {}),
    ...(attempt.scope === 'owner' && attempt.lateCommercialCapability ? {lateCommercialCapability: attempt.lateCommercialCapability} : {}) });
  assertCurrent(); return parseReceipt(result.data, attempt, assertCurrent);
}
async function serialize(slot: string, work: () => Promise<void>) {
  const pending = (writes.get(slot) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(slot, pending);
  try { await pending; } finally { if (writes.get(slot) === pending) writes.delete(slot); }
}
const deadlineNativeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && utf8Bytes(value) <= 1500 &&
  !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
const deadlineCivilDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
  const instant = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
};
const nullableCivilDate = (value: unknown) => value === null || deadlineCivilDate(value);
function deadlineCursor(value: unknown, uid: string, lane: SupportDeadlineLane): value is SupportDeadlineCursor {
  return object(value) && exact(value, ['protocol', 'actorId', 'lane', 'id', 'statutoryDueDate']) &&
    value.protocol === 'support_deadline_cursor_v1' && value.actorId === uid && value.lane === lane && deadlineNativeId(value.id) &&
    (lane !== 'dated' ? value.statutoryDueDate === null : typeof value.statutoryDueDate === 'string' && value.statutoryDueDate.length <= 1500 &&
      value.statutoryDueDate >= '0001-01-01' && value.statutoryDueDate <= '9999-12-31');
}
// Native document-name ordering follows Unicode code points, not UTF-16 units.
function deadlineCompare(left: string, right: string): number {
  const a = Array.from(left), b = Array.from(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {const delta = a[i].codePointAt(0)! - b[i].codePointAt(0)!; if (delta) return delta;}
  return a.length - b.length;
}
function deadlineAfter(left: {id: string; statutoryDueDate: string | null}, right: {id: string; statutoryDueDate: string | null}, lane: SupportDeadlineLane): boolean {
  const dateOrder = lane === 'dated' ? deadlineCompare(left.statutoryDueDate!, right.statutoryDueDate!) : 0;
  return dateOrder > 0 || dateOrder === 0 && deadlineCompare(left.id, right.id) > 0;
}
function parseDeadlinePage(value: unknown, uid: string, lane: SupportDeadlineLane, cursor: SupportDeadlineCursor | null): SupportDeadlinePage {
  if (!object(value) || !exact(value, ['protocol', 'actorId', 'scope', 'operation', 'lane', 'observedAt', 'civilDate', 'items', 'page', 'coverage',
    'financialEffect', 'deadlineExtended', 'humanAvailabilityVerified']) || value.protocol !== 'support_deadline_queue_v1' || value.actorId !== uid ||
    value.scope !== 'admin' || value.operation !== 'deadline_queue' || value.lane !== lane || !date(value.observedAt) || !nullableCivilDate(value.civilDate) ||
    !Array.isArray(value.items) || value.items.length > 30 || value.financialEffect !== 'none' || value.deadlineExtended !== false || value.humanAvailabilityVerified !== false ||
    !object(value.page) || !exact(value.page, ['inspected', 'returned', 'excluded', 'limit', 'hasMore', 'cursor', 'completeScan']) ||
    !object(value.coverage) || !exact(value.coverage, ['population', 'order', 'globalCoverage', 'snapshotConsistentAcrossPages']) ||
    value.coverage.population !== (lane === 'dated' ? 'all_privacy_requests_with_indexed_due_date' : lane === 'bank' ? 'recorded_bank_dispute_cases' : 'all_support_documents') ||
    value.coverage.order !== (lane === 'dated' ? 'statutoryDueDate_asc_id_asc' : 'id_asc') ||
    value.coverage.globalCoverage !== false || value.coverage.snapshotConsistentAcrossPages !== false) throw unknown();
  const page = value.page;
  if (!Number.isSafeInteger(page.inspected) || (page.inspected as number) < 0 || (page.inspected as number) > 30 || page.returned !== value.items.length ||
    page.excluded !== (page.inspected as number) - value.items.length || (page.excluded as number) < 0 || page.limit !== 30 ||
    typeof page.hasMore !== 'boolean' || page.hasMore !== (page.cursor !== null) ||
    page.hasMore && (page.inspected !== 30 || !deadlineCursor(page.cursor, uid, lane)) ||
    page.completeScan !== (cursor === null && !page.hasMore) || cursor && page.cursor !== null && !deadlineAfter(page.cursor as SupportDeadlineCursor, cursor, lane)) throw unknown();
  const observedMs = Date.parse(value.observedAt), civilNow = value.civilDate;
  for (const item of value.items) {
    if (!object(item) || !exact(item, ['id', 'kind', 'status', 'version', 'assignedAdminId', 'sourceRevision', 'clock', 'responseRecorded', 'responseCompletenessVerified', ...(Object.hasOwn(item, 'deadlineAlert') ? ['deadlineAlert'] : []), ...(lane === 'bank' ? ['providerObservedAt', 'currentProviderStateVerified', 'transactionId'] : [])]) ||
      !deadlineNativeId(item.id) || (lane === 'bank' ? item.kind !== 'bank_dispute' : !isSupportPrivacyKind(item.kind)) || !(item.status === null || (lane === 'bank' ? ['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review', 'won', 'lost', 'warning_closed', 'prevented'] : ['submitted', 'needs_information', 'withdrawn', 'answered']).includes(String(item.status))) ||
      !(item.version === null || integer(item.version)) || !(item.assignedAdminId === null || isDeclaredSupportAccountId(item.assignedAdminId)) ||
      !(item.sourceRevision === null || qualifiedRevision(item.sourceRevision)) || typeof item.responseRecorded !== 'boolean' || item.responseCompletenessVerified !== false ||
      !object(item.clock) || !exact(item.clock, ['qualification', 'receivedAt', 'receivedCivilDate', 'statutoryDueDate', 'recordedDueDate', 'state', 'reason',
        'clockOriginSupportRequestId', 'basis', 'earliestExternalReceiptVerified', 'deadlineExtended', ...(lane === 'bank' ? ['providerDueAt'] : [])])) throw unknown();
    const clock = item.clock;
    if (!nullableDate(clock.receivedAt) || clock.receivedAt !== null && Date.parse(clock.receivedAt as string) > observedMs ||
      !nullableCivilDate(clock.receivedCivilDate) || !nullableCivilDate(clock.statutoryDueDate) || !nullableCivilDate(clock.recordedDueDate) ||
      !(clock.clockOriginSupportRequestId === null || deadlineNativeId(clock.clockOriginSupportRequestId)) || clock.basis !== (lane === 'bank' ? 'recorded_provider_evidence_deadline' : 'application_initial_receipt') ||
      clock.earliestExternalReceiptVerified !== false || clock.deadlineExtended !== false) throw unknown();
    if (Object.hasOwn(item, 'deadlineAlert') && item.deadlineAlert !== null) {
      const alert = item.deadlineAlert;
      if (!object(alert) || !exact(alert, ['protocol', 'alertId', 'clockState', 'clockQualification', 'firstObservedAt', 'observedAt', 'adminNoticeScanCompleted', 'awaitingAdmin', 'inAppNoticesPrepared', 'deviceDeliveryVerified', 'readingVerified', 'responseCompletenessVerified', 'deadlineExtended']) || alert.protocol !== 'support_deadline_alert_v1' || !/^deadline_[a-f0-9]{64}$/.test(String(alert.alertId)) || alert.clockState !== clock.state || alert.clockQualification !== clock.qualification || !date(alert.firstObservedAt) || !date(alert.observedAt) || Date.parse(alert.firstObservedAt) > Date.parse(alert.observedAt) || Date.parse(alert.observedAt) > observedMs || typeof alert.adminNoticeScanCompleted !== 'boolean' || typeof alert.awaitingAdmin !== 'boolean' || !Number.isSafeInteger(alert.inAppNoticesPrepared) || (alert.inAppNoticesPrepared as number) < 0 || ['deviceDeliveryVerified', 'readingVerified', 'responseCompletenessVerified', 'deadlineExtended'].some(k => alert[k] !== false)) throw unknown();
    }
    if (lane === 'bank') {
      if (item.assignedAdminId !== null || item.currentProviderStateVerified !== false || !nullableDate(item.providerObservedAt) || item.providerObservedAt !== null && Date.parse(item.providerObservedAt as string) > observedMs || !(item.transactionId === null || id(item.transactionId)) || clock.receivedAt !== null || clock.receivedCivilDate !== null || clock.statutoryDueDate !== null || clock.clockOriginSupportRequestId !== null || !nullableDate(clock.providerDueAt)) throw unknown();
      if (clock.qualification === 'unknown') {if (clock.state !== 'unknown' || clock.reason !== 'native_bank_observation_missing_or_incoherent' || clock.recordedDueDate !== null || clock.providerDueAt !== null || item.providerObservedAt !== null || item.transactionId !== null || item.status !== null) throw unknown();}
      else {
        if (!/^du_[A-Za-z0-9_]{1,190}$/.test(String(item.id)) || clock.qualification !== 'native_provider_observation' || !date(item.providerObservedAt) || !id(item.transactionId) || clock.reason !== null) throw unknown();
        const responsive = ['needs_response', 'warning_needs_response'].includes(String(item.status)), due = clock.providerDueAt;
        if (due === null ? clock.recordedDueDate !== null || clock.state !== 'not_actionable' : !date(due) || !deadlineCivilDate(clock.recordedDueDate) || clock.recordedDueDate !== new Date(due).toLocaleDateString('en-CA', {timeZone: 'America/Toronto'}) || clock.state !== (!responsive ? 'not_actionable' : Date.parse(due) < observedMs ? 'overdue' : clock.recordedDueDate === civilNow ? 'due_today' : 'pending')) throw unknown();
      }
    } else if (lane === 'dated') {
      if (clock.qualification !== 'native_application_receipt' || !date(clock.receivedAt) || !deadlineCivilDate(clock.receivedCivilDate) ||
        !deadlineCivilDate(clock.statutoryDueDate) || clock.statutoryDueDate !== clock.recordedDueDate || !deadlineCivilDate(civilNow) || clock.reason !== null ||
        clock.state !== (clock.statutoryDueDate < civilNow ? 'overdue' : clock.statutoryDueDate === civilNow ? 'due_today' : 'pending')) throw unknown();
    } else if (clock.qualification !== 'unknown' || clock.statutoryDueDate !== null || clock.state !== 'unknown' || clock.reason !== 'native_clock_missing_or_incoherent') throw unknown();
  }
  const items = value.items as unknown as SupportDeadlineItem[];
  if (new Set(items.map(item => item.id)).size !== items.length) throw unknown();
  const point = (item: SupportDeadlineItem) => ({id: item.id, statutoryDueDate: item.clock.statutoryDueDate});
  for (let index = 0; index < items.length; index++) {
    const prior = index ? point(items[index - 1]) : cursor;
    if (prior && !deadlineAfter(point(items[index]), prior, lane)) throw unknown();
    if (page.cursor !== null && deadlineAfter(point(items[index]), page.cursor as SupportDeadlineCursor, lane)) throw unknown();
  }
  return value as unknown as SupportDeadlinePage;
}

/** A route supplies only a lookup descriptor; deadlineBankTarget re-reads it. */
export function parseSupportBankDeadlineTarget(v: unknown, uid: string): SupportBankDeadlineTarget | null {
  return object(v) && exact(v, ['version', 'uid', 'cursor', 'item']) && v.version === 1 && v.uid === uid && (v.cursor === null || deadlineCursor(v.cursor, uid, 'bank')) && object(v.item) && v.item.kind === 'bank_dispute' && /^du_[A-Za-z0-9_]{1,190}$/.test(String(v.item.id)) && id(v.item.transactionId) && integer(v.item.version) && qualifiedRevision(v.item.sourceRevision) ? v as unknown as SupportBankDeadlineTarget : null;
}
export const hasSupportDeadlineNotice = (v: unknown): boolean => object(v) && (v.noticeSource === 'support_deadline_alert_v1' || Object.hasOwn(v, 'deadlineLane'));
export async function supportDeadlineNotificationContext(value: unknown, uid: string, guard: () => void): Promise<{lane: SupportDeadlineLane}> {
  const current = reviewGuard(uid, guard); current();
  if (!object(value) || value.ownerId !== uid || value.noticeSource !== 'support_deadline_alert_v1' || !['dated', 'unknown', 'bank'].includes(String(value.deadlineLane))) throw unknown();
  const lane = value.deadlineLane as SupportDeadlineLane;
  if (['sourceCollection', 'supportRequestId', 'alertId'].some(k => Object.hasOwn(value, k)) && (value.sourceCollection !== (lane === 'bank' ? 'bank_dispute_cases' : 'support_requests') || !deadlineNativeId(value.supportRequestId) || !/^deadline_[a-f0-9]{64}$/.test(String(value.alertId)))) throw unknown();
  // Both full in-app and minimized push notices open only a freshly qualified
  // admin queue. No notice ID, text or deep link grants direct dossier access.
  await SupportRequestService.deadlineQueue(uid, lane, null, current); current(); return {lane};
}
export const SupportRequestService = {
  async deadlineQueue(uid: string, lane: SupportDeadlineLane, cursor: SupportDeadlineCursor | null, assertContext: () => void): Promise<SupportDeadlinePage> {
    const session = captureTradeSession(uid), projection = getSupportProjectionGeneration();
    const current = () => {assertTradeSessionCurrent(session); assertSupportProjectionGeneration(projection); assertContext();};
    current();
    if (!['dated', 'unknown', 'bank'].includes(lane) || cursor !== null && !deadlineCursor(cursor, uid, lane)) throw unknown();
    const result = await httpsCallable<unknown, unknown>(functions, 'readSupportRequests')({expectedUid: uid, scope: 'admin',
      operation: 'deadline_queue', lane, queueCursor: cursor});
    current();
    return qualifySupportProjection(parseDeadlinePage(result.data, uid, lane, cursor), projection);
  },
  async deadlineDetail(uid: string, item: SupportDeadlineItem, assertContext: () => void): Promise<SupportDetail> {
    if (item.kind === 'bank_dispute' || !id(item.id) || !integer(item.version) || !qualifiedRevision(item.sourceRevision)) throw unknown();
    const result = await this.detail(uid, 'admin', item.id, undefined, assertContext);
    assertContext();
    if (result.sourceRevision !== item.sourceRevision || result.request.version !== item.version || result.request.kind !== item.kind)
      throw new Error('Le dossier a changé depuis la file. Relisez la file avant de choisir sa version actuelle.');
    return result;
  },
  async deadlineBankTarget(uid: string, item: SupportBankDeadlineItem, cursor: SupportDeadlineCursor | null, assertContext: () => void): Promise<SupportBankDeadlineTarget> {
    const current = reviewGuard(uid, assertContext); current();
    const page = await this.deadlineQueue(uid, 'bank', cursor, current); current();
    const native = page.items.find(row => row.kind === 'bank_dispute' && row.id === item.id);
    if (!native || native.kind !== 'bank_dispute' || !equalReview(native, item) || !id(native.transactionId) || !integer(native.version) || !qualifiedRevision(native.sourceRevision) || native.clock.qualification !== 'native_provider_observation') throw new Error('Relisez l’échéance bancaire et sa source native actuelle.');
    return {version: 1, uid, cursor, item: native};
  },
  async journal(uid: string, scope: SupportScope, assertContext: () => void): Promise<SupportJournalEntry | null> {
    const session = captureTradeSession(uid); assertContext(); const raw = await AsyncStorage.getItem(key(uid, scope));
    assertTradeSessionCurrent(session); assertContext(); if (raw === null) return null;
    const v: unknown = JSON.parse(raw); if(isSupportOpaqueAttempt(v)){if(v.uid!==uid||v.scope!==scope)throw unknown();await qualifiedOpaque(v,()=>{assertTradeSessionCurrent(session);assertContext();});return v;} if (!validAttempt(v, uid, scope)) throw unknown(); return v;
  },
  async execute(attempt: SupportAttempt, assertContext: () => void, resume = false): Promise<SupportServicingReceipt> {
    const session = captureTradeSession(attempt.uid), slot = key(attempt.uid, attempt.scope);
    if (locks.has(slot) || !validAttempt(attempt, attempt.uid, attempt.scope)) throw unknown(); locks.add(slot);
    try {
      await serialize(slot, async () => {
        assertTradeSessionCurrent(session); assertContext();
        const prior = await this.journal(attempt.uid, attempt.scope, assertContext);
        if (resume && !prior || prior&&isSupportOpaqueAttempt(prior)) throw unknown();
        if (prior && (prior.requestId !== attempt.requestId || prior.privacyRetentionCapability !== attempt.privacyRetentionCapability ||
          ('lateCommercialCapability' in prior ? prior.lateCommercialCapability : undefined) !== ('lateCommercialCapability' in attempt ? attempt.lateCommercialCapability : undefined) ||
          await supportCommandHash(prior.command) !== await supportCommandHash(attempt.command))) throw unknown();
        assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.setItem(slot, JSON.stringify(attempt));
        assertTradeSessionCurrent(session); assertContext();
      });
      await rpc(attempt, 'execute', assertContext);
      return this.observe(attempt,assertContext);
    } finally { locks.delete(slot); }
  },
  async observe(attempt:SupportJournalEntry,assertContext:()=>void):Promise<SupportServicingReceipt>{const session=captureTradeSession(attempt.uid),caller=assertContext;assertContext=()=>{assertTradeSessionCurrent(session);caller();};assertContext();if(isSupportOpaqueAttempt(attempt)){await qualifiedOpaque(attempt,assertContext);return SupportConfidentialityService.receipt(attempt.uid,attempt.scope,attempt.reference,'receipt_observe',assertContext);}if(!validAttempt(attempt,attempt.uid,attempt.scope))throw unknown();const reference=await supportJournalReference(attempt,assertContext);assertContext();return SupportConfidentialityService.receipt(attempt.uid,attempt.scope,reference,'servicing_observe',assertContext);},
  async neutralize(attempt:SupportJournalEntry,assertContext:()=>void):Promise<SupportServicingReceipt>{const session=captureTradeSession(attempt.uid),caller=assertContext;assertContext=()=>{assertTradeSessionCurrent(session);caller();};assertContext();if(isSupportOpaqueAttempt(attempt)){await qualifiedOpaque(attempt,assertContext);return SupportConfidentialityService.receipt(attempt.uid,attempt.scope,attempt.reference,'receipt_neutralize',assertContext);}
    const slot = key(attempt.uid, attempt.scope);
    if (locks.has(slot) || !supportAttemptCanNeutralize(attempt)) throw unknown(); locks.add(slot);
    try {
      await serialize(slot, async () => {
        const prior = await this.journal(attempt.uid, attempt.scope, assertContext);
        if (!prior || isSupportOpaqueAttempt(prior) || prior.requestId !== attempt.requestId || prior.privacyRetentionCapability !== attempt.privacyRetentionCapability ||
          ('lateCommercialCapability' in prior ? prior.lateCommercialCapability : undefined) !== ('lateCommercialCapability' in attempt ? attempt.lateCommercialCapability : undefined) ||
          await supportCommandHash(prior.command) !== await supportCommandHash(attempt.command)) throw unknown();
        assertTradeSessionCurrent(session); assertContext();
      });
      const reference=await supportJournalReference(attempt,assertContext);assertTradeSessionCurrent(session);assertContext();await SupportConfidentialityService.receipt(attempt.uid,attempt.scope,reference,'servicing_neutralize',assertContext);return SupportConfidentialityService.receipt(attempt.uid,attempt.scope,reference,'servicing_observe',assertContext);
    } finally {locks.delete(slot);}
  },
  async acknowledge(attempt:SupportJournalEntry,assertContext:()=>void):Promise<SupportServicingReceipt>{const session=captureTradeSession(attempt.uid),caller=assertContext;assertContext=()=>{assertTradeSessionCurrent(session);caller();};assertContext();if(isSupportOpaqueAttempt(attempt))return this.acknowledgeOpaque(attempt,assertContext);
    const slot = key(attempt.uid, attempt.scope);
    if (locks.has(slot)) throw unknown(); locks.add(slot);
    try {
      if(!validAttempt(attempt,attempt.uid,attempt.scope))throw unknown();const reference=await supportJournalReference(attempt,assertContext);assertTradeSessionCurrent(session);assertContext();const receipt=await SupportConfidentialityService.receipt(attempt.uid,attempt.scope,reference,'servicing_observe',assertContext);
      if (receipt.state === 'unrecorded') throw unknown();
      await serialize(slot, async () => {
        const prior = await this.journal(attempt.uid, attempt.scope, assertContext);
        if (!prior || isSupportOpaqueAttempt(prior) || prior.requestId !== attempt.requestId || prior.privacyRetentionCapability !== attempt.privacyRetentionCapability ||
          ('lateCommercialCapability' in prior ? prior.lateCommercialCapability : undefined) !== ('lateCommercialCapability' in attempt ? attempt.lateCommercialCapability : undefined) ||
          await supportCommandHash(prior.command) !== receipt.reference.payloadHash) throw unknown();
        assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.removeItem(slot);
        assertTradeSessionCurrent(session); assertContext();
      }); return receipt;
    } finally { locks.delete(slot); }
  },
  async adoptProtection(protection:SupportConfidentialAttempt,receipt:SupportConfidentialReceipt,assertContext:()=>void):Promise<boolean>{if(!isSupportConfidentialAttempt(protection,protection.uid)||receipt.state!=='committed'||receipt.actorId!==protection.uid||receipt.requestId!==protection.requestId||!receipt.opaqueCommandReference)return false;const session=captureTradeSession(protection.uid),current=()=>{assertTradeSessionCurrent(session);assertContext();},slot=key(protection.uid,protection.scope);current();if(locks.has(slot))throw unknown();locks.add(slot);try{let adopted=false;await serialize(slot,async()=>{current();const proof=await SupportConfidentialityService.command(protection,'observe',current);current();if(proof.state!=='committed'||!proof.opaqueCommandReference||proof.actorId!==protection.uid||proof.requestId!==protection.requestId||!['confined','awaiting_native_command'].includes(proof.confinement)||await supportCommandHash(proof.target)!==await supportCommandHash(protection.command.target)||await supportCommandHash(proof.opaqueCommandReference)!==await supportCommandHash(receipt.opaqueCommandReference))throw unknown();current();const raw=await AsyncStorage.getItem(slot);current();if(raw===null)return;const prior:unknown=JSON.parse(raw);if(isSupportOpaqueAttempt(prior)){await qualifiedOpaque(prior,current);return;}if(!validAttempt(prior,protection.uid,protection.scope))throw unknown();const reference=await supportJournalReference(prior,current);current();if(await supportCommandHash(reference)!==await supportCommandHash(proof.opaqueCommandReference))return;const opaque:SupportOpaqueAttempt={version:2,uid:prior.uid,scope:prior.scope,requestId:prior.requestId,reference,protection};if(!isSupportOpaqueAttempt(opaque))throw unknown();current();if(await AsyncStorage.getItem(slot)!==raw)throw unknown();current();await AsyncStorage.setItem(slot,JSON.stringify(opaque));current();adopted=true;});return adopted;}finally{locks.delete(slot);}},
  async acknowledgeOpaque(attempt:SupportOpaqueAttempt,assertContext:()=>void):Promise<SupportOpaqueReceipt>{const session=captureTradeSession(attempt.uid),current=()=>{assertTradeSessionCurrent(session);assertContext();},slot=key(attempt.uid,attempt.scope);current();if(locks.has(slot))throw unknown();locks.add(slot);try{await qualifiedOpaque(attempt,current);const receipt=await SupportConfidentialityService.receipt(attempt.uid,attempt.scope,attempt.reference,'receipt_observe',current);current();if(receipt.state==='unrecorded')throw unknown();await serialize(slot,async()=>{const raw=await AsyncStorage.getItem(slot);current();if(raw===null||await supportCommandHash(JSON.parse(raw))!==await supportCommandHash(attempt))throw unknown();current();await AsyncStorage.removeItem(slot);current();});return receipt;}finally{locks.delete(slot);}},
  async list(uid: string, scope: SupportScope, cursor: SupportListCursor | undefined, assertContext: () => void): Promise<SupportList> {
    const projection=getSupportProjectionGeneration(),session = captureTradeSession(uid),caller=assertContext;assertContext=()=>{assertSupportProjectionGeneration(projection);caller();}; assertContext();
    const result = await httpsCallable<unknown, unknown>(functions, 'readSupportRequests')({expectedUid: uid, scope, capability: SUPPORT_ACCOUNT_REVIEW_CAPABILITY, privacyRetentionCapability: 'privacy_retention_v1', lateCommercialCapability: 'late_commercial_recourse_v1', confidentialityCapability:'support_confidentiality_v1', ...(cursor ? {cursor} : {})});
    assertTradeSessionCurrent(session); assertContext(); const v = result.data;
    if (!object(v) || v.protocol !== 'support_list_v1' || v.actorId !== uid || v.scope !== scope || !Array.isArray(v.items) || v.items.length > 30 ||
      typeof v.hasMore !== 'boolean' || typeof v.completeHistory !== 'boolean' || v.hasMore !== (v.cursor !== null) ||
      (v.cursor !== null && (!object(v.cursor) || !integer(v.cursor.receivedAtMs) || !id(v.cursor.id))) ||
      v.completeHistory && (!!cursor || v.hasMore)) throw unknown();
    if (cursor && object(v.cursor) && (v.cursor.receivedAtMs as number) >= cursor.receivedAtMs &&
      ((v.cursor.receivedAtMs as number) > cursor.receivedAtMs || (v.cursor.id as string) >= cursor.id)) throw unknown();
    const items = v.items.map(item => parseSupportRequest(item, scope, uid));
    if (items.some(item => !item.confidentiality||isSupportPrivacyKind(item.kind) && !item.privacyRetention)) throw unknown();
    if (new Set(items.map(item => item.id)).size !== items.length) throw unknown();
    return qualifySupportProjection({...v,items} as unknown as SupportList,projection);
  },
  async detail(uid: string, scope: SupportScope, supportRequestId: string, eventsCursor: SupportEventsCursor | undefined, assertContext: () => void): Promise<SupportDetail> {
    const projection=getSupportProjectionGeneration(),session = captureTradeSession(uid),caller=assertContext;assertContext=()=>{assertSupportProjectionGeneration(projection);caller();}; assertContext(); if (!id(supportRequestId)) throw unknown();
    const result = await httpsCallable<unknown, unknown>(functions, 'readSupportRequests')({expectedUid: uid, scope, capability: SUPPORT_ACCOUNT_REVIEW_CAPABILITY, privacyRetentionCapability: 'privacy_retention_v1', lateCommercialCapability: 'late_commercial_recourse_v1', confidentialityCapability:'support_confidentiality_v1', supportRequestId, ...(eventsCursor ? {eventsCursor} : {})});
    assertTradeSessionCurrent(session); assertContext(); const v = result.data;
    if (!object(v) || v.protocol !== 'support_read_v1' || v.actorId !== uid || v.scope !== scope || !object(v.events) ||
      !Array.isArray(v.events.items) || v.events.items.length > 20 || typeof v.events.hasMore !== 'boolean' || v.events.hasMore !== (v.events.cursor !== null) ||
      (v.events.cursor !== null && (!object(v.events.cursor) || !integer(v.events.cursor.recordedAtMs) || !id(v.events.cursor.id)))) throw unknown();
    if (v.sourceRevision !== undefined && (scope !== 'admin' || v.sourceRevision !== null && !qualifiedRevision(v.sourceRevision))) throw unknown();
    const request = parseSupportRequest(v.request, scope, uid); if (request.id !== supportRequestId||!request.confidentiality) throw unknown();
    if (isSupportPrivacyKind(request.kind) ? !privacyRetention(v.privacyRetention, request) : v.privacyRetention !== undefined) throw unknown();
    if (v.lateCommercial !== undefined && (request.kind !== 'commercial_late' || !isLateCommercialSupportView(v.lateCommercial, request.transactionId))) throw unknown();
    if (scope === 'owner' && 'transportSource' in v || scope === 'admin' && v.transportSource !== null &&
      (!transportSource(v.transportSource) || !request.lateTransport || v.transportSource.reference.transactionId !== request.transactionId ||
        v.transportSource.reference.incidentId !== request.lateTransport.incidentId || v.transportSource.reference.incidentHash !== request.lateTransport.incidentHash)) throw unknown();
    if (scope === 'owner' && 'swapHoldSource' in v || scope === 'admin' && v.swapHoldSource !== null &&
      (!swapHoldSource(v.swapHoldSource) || request.kind !== 'swap_hold_assistance' || v.swapHoldSource.swapId !== request.swapId)) throw unknown();
    if (scope === 'owner' && 'withdrawalTimingSource' in v) throw unknown();
    if (scope === 'admin' && v.withdrawalTimingSource !== null) {
      if (request.kind !== 'withdrawal_timing_assistance' || !request.withdrawalRequestId) throw unknown();
      parseWithdrawalTimingSource(v.withdrawalTimingSource, request.ownerId, request.withdrawalRequestId);
    }
    if (scope === 'owner' && 'returnToSenderSource' in v || scope === 'admin' && v.returnToSenderSource !== null &&
      (!request.returnToSender || !request.transactionId || !isReturnToSenderSupportSource(v.returnToSenderSource, request.transactionId) ||
        v.returnToSenderSource.reference.caseId !== request.returnToSender.caseId || v.returnToSenderSource.reference.caseHash !== request.returnToSender.caseHash ||
        v.returnToSenderSource.reference.caseRevision !== request.returnToSender.caseRevision)) throw unknown();
    if (scope === 'owner' && 'accountSources' in v || scope === 'admin' && accountKind(request.kind) && (!Array.isArray(v.accountSources) ||
      !v.accountSources.every(isSupportAccountSource) || v.accountSources.length !== request.relatedAccountIds?.length ||
      new Set(v.accountSources.map(source => source.declaredAccountId)).size !== v.accountSources.length ||
      v.accountSources.some(source => !request.relatedAccountIds!.includes(source.declaredAccountId))) ||
      scope === 'admin' && !accountKind(request.kind) && v.accountSources !== undefined && (!Array.isArray(v.accountSources) || v.accountSources.length)) throw unknown();
    if (!v.events.items.every(e => object(e) && hash(e.id) && [...ownerActions, ...adminActions].includes(String(e.action)) &&
      ['committed', 'not_executed'].includes(String(e.state)) && integer(e.resultVersion) && date(e.recordedAt) && integer(e.recordedAtMs) &&
      Date.parse(e.recordedAt) === e.recordedAtMs && typeof e.ownerAction === 'boolean' && nullableText(e.reason) && nullableText(e.narrative) &&
      nullableText(e.ownerMessage) && (e.response === null || validResponse(e.response)) &&
      (e.transportInstruction === undefined || e.transportInstruction === null || e.action === 'record_transport_instruction' && e.state === 'committed' &&
        transportInstruction(e.transportInstruction) && e.transportInstruction.source.transactionId === request.transactionId &&
        (e.transportInstruction.source.kind === 'late_transport_incident' ? e.transportInstruction.source.incidentId === request.lateTransport?.incidentId :
          e.transportInstruction.source.caseId === request.returnToSender?.caseId)) &&
      (scope === 'owner' ? !('internalNote' in e) && !('actorId' in e) && !('accountReview' in e) : isDeclaredSupportAccountId(e.actorId) && nullableText(e.internalNote) &&
        (e.accountReview === undefined || e.accountReview === null || e.action === 'record_account_review' && (accountReviewInput(e.accountReview) || accountReviewInputV2(e.accountReview)))))) throw unknown();
    return qualifySupportProjection({...v,request} as unknown as SupportDetail,projection);
  },
};

/** A present support discriminant consumes the notice even when malformed, so it
 * cannot fall through to an order or an arbitrary deep link. */
export const hasSupportOwnerUpdateNotice = (value: unknown): boolean => object(value) &&
  ['supportUpdateProtocol', 'supportCommandId', 'supportAction', 'supportRequestVersion'].some(field => Object.prototype.hasOwnProperty.call(value, field));
export async function supportOwnerUpdateNotificationContext(value: unknown, uid: string, guard: () => void): Promise<{supportRequestId: string}> {
  const session = captureTradeSession(uid), projection = getSupportProjectionGeneration();
  const current = () => {assertTradeSessionCurrent(session); assertSupportProjectionGeneration(projection); guard();}; current();
  if (!object(value) || value.supportUpdateProtocol !== 'support_owner_update_v1' || value.ownerId !== uid ||
    !id(value.supportRequestId) || /^authority_[a-f0-9]{64}$/.test(value.supportRequestId) || !hash(value.supportCommandId) ||
    !['request_details', 'respond'].includes(String(value.supportAction)) || typeof value.supportRequestVersion !== 'string' ||
    !/^[1-9]\d*$/.test(value.supportRequestVersion)) throw new Error('Cet avis de support doit être relu avec son propre compte et ses références natives.');
  const version = Number(value.supportRequestVersion);
  if (!Number.isSafeInteger(version) || String(version) !== value.supportRequestVersion) throw unknown();
  const detail = await SupportRequestService.detail(uid, 'owner', value.supportRequestId, undefined, current); current();
  if (detail.request.id !== value.supportRequestId || detail.request.ownerId !== uid || detail.request.version < version)
    throw new Error('Cet avis ne correspond pas à la version propriétaire actuelle du dossier.');
  // Exact notification-command qualification is native. An old command can be
  // outside this bounded page; only the fresh owner's ordinary dossier opens.
  return {supportRequestId: detail.request.id};
}

// Reuse the exact transport projections for the additive recovery capability.
export { transportSource as isLateTransportSupportSource, refundObservation as isLateTransportRefundObservation };

/** V2 private account review lives beside the ordinary support service. The
 * opaque journal is independent of legacy prose-bearing V1 commands. */
const reviewJournalKey = (uid: string) => `second:support-account-review:v2:${JSON.stringify(uid)}`;
const reviewJournalLocks = new Set<string>();
const equalReview = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function reviewGuard(uid: string, caller: () => void) {
  const session = captureTradeSession(uid), owner = auth.currentUser, projection = getSupportProjectionGeneration();
  return () => {assertTradeSessionCurrent(session); assertSupportProjectionGeneration(projection); caller(); if (!owner || auth.currentUser !== owner) throw unknown();};
}
async function reviewRpc(uid: string, endpoint: string, body: Record<string, unknown>, caller: () => void, admin: boolean) {
  const current = reviewGuard(uid, caller); current(); const user = auth.currentUser!;
  const token = await user.getIdTokenResult(true); current(); const at = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
  if (!integer(at) || at > now || now - at > 300 || admin && token.claims.admin !== true) throw new Error('Reconnectez-vous avec votre moyen Firebase déjà lié, puis relisez ce dossier. Une confirmation récente est requise.');
  const response = await httpsCallable<unknown, unknown>(functions, endpoint)({capability: SUPPORT_ACCOUNT_REVIEW_CAPABILITY, expectedUid: uid, ...body}); current(); return response.data;
}
const isReviewJournal = (v: unknown, uid: string): v is SupportAccountReviewJournalV2 => object(v) && exact(v, ['protocol', 'uid', 'scope', 'expectedVersion', 'reference']) && v.protocol === SUPPORT_ACCOUNT_REVIEW_CAPABILITY && v.uid === uid && v.scope === 'admin' && integer(v.expectedVersion) && object(v.reference) && exact(v.reference, ['actorId', 'supportRequestId', 'requestId', 'payloadHash', 'action']) && v.reference.actorId === uid && id(v.reference.supportRequestId) && /^[A-Za-z0-9_-]{16,128}$/.test(String(v.reference.requestId)) && hash(v.reference.payloadHash) && v.reference.action === 'record_account_review';
function providerObservation(v: unknown, uid: string): v is SupportProviderObservation {
  return object(v) && exact(v, ['protocol', 'subjectUid', 'accountId', 'userRevision', 'version', 'providerSourceHash', 'ownerRestriction', 'observedAtMs', 'screeningCoverage', 'otherAccountAccessGranted', 'paymentAuthorityGranted', 'providerRestrictionOverridden', 'accountsMerged', 'fundsMoved', 'physicalIdentityAutomaticallyInferred', 'observationId', 'actorUid', 'authTime']) && v.protocol === 'support_provider_observation_v1' && isDeclaredSupportAccountId(v.subjectUid) && /^acct_[A-Za-z0-9_]{1,190}$/.test(String(v.accountId)) && qualifiedRevision(v.userRevision) && integer(v.version) && hash(v.providerSourceHash) && providerRestriction(v.ownerRestriction) && (v.ownerRestriction === null || object(v.ownerRestriction) && v.ownerRestriction.ownerId === v.subjectUid) && integer(v.observedAtMs) && v.screeningCoverage === 'provider_account_observation_only' && /^spo_[a-f0-9]{64}$/.test(String(v.observationId)) && v.actorUid === uid && integer(v.authTime) && reviewEffects(v);
}
function parseReviewPreview(v: unknown, uid: string, request: SupportRequest, selected: SupportAccountObligationRef[], cursor: string | null): SupportAccountReviewPreview {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'supportRequestId', 'version', 'accountSources', 'obligations', 'evidencePage', 'providerObservation', 'currentReview', 'selectedObligationsOnly', ...(Object.hasOwn(v, 'activityProgram') ? ['activityProgram'] : []), 'otherAccountAccessGranted', 'paymentAuthorityGranted', 'providerRestrictionOverridden', 'accountsMerged', 'fundsMoved', 'physicalIdentityAutomaticallyInferred']) || v.protocol !== SUPPORT_ACCOUNT_REVIEW_CAPABILITY || v.actorId !== uid || v.supportRequestId !== request.id || v.version !== request.version || v.selectedObligationsOnly !== true || (request.kind === 'activity_compliance_review' ? !isSupportActivityProgram(v.activityProgram) : v.activityProgram != null) || !reviewEffects(v) || !Array.isArray(v.accountSources) || v.accountSources.length !== request.relatedAccountIds?.length || !v.accountSources.every(isSupportAccountSource) || new Set(v.accountSources.map(source => source.declaredAccountId)).size !== v.accountSources.length || v.accountSources.some(source => !request.relatedAccountIds!.includes(source.declaredAccountId)) || !uniqueObligations(v.obligations) || !equalReview(v.obligations.map(({kind, id}) => ({kind, id})), selected) || !object(v.evidencePage) || !exact(v.evidencePage, ['items', 'hasMore', 'cursor']) || !Array.isArray(v.evidencePage.items) || v.evidencePage.items.length > 20 || !v.evidencePage.items.every(reviewEvidence) || typeof v.evidencePage.hasMore !== 'boolean' || v.evidencePage.hasMore !== (v.evidencePage.cursor !== null) || v.evidencePage.hasMore && (v.evidencePage.items.length !== 20 || v.evidencePage.cursor !== v.evidencePage.items.at(-1)?.evidence.evidenceId) || v.currentReview !== null && !(accountReview(v.currentReview) || accountReviewV2(v.currentReview)) || (request.kind === 'payment_account_review' ? !providerObservation(v.providerObservation, uid) || v.providerObservation.version !== request.version || !request.relatedAccountIds?.includes(v.providerObservation.subjectUid) : v.providerObservation !== null)) throw unknown();
  const ids = v.evidencePage.items.map(item => item.evidence.evidenceId);
  if (new Set(ids).size !== ids.length || ids.some((value, index) => value <= (index ? ids[index - 1] : cursor ?? ''))) throw unknown();
  return v as unknown as SupportAccountReviewPreview;
}
function decodeReviewJpeg(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value || value.length % 4 || value.length > Math.ceil(5 * 1024 * 1024 / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw unknown();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', size = value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  if (size < 4 || size > 5 * 1024 * 1024) throw unknown();
  const bytes = new Uint8Array(size); let offset = 0;
  for (let i = 0; i < value.length; i += 4) {const a = alphabet.indexOf(value[i]), b = alphabet.indexOf(value[i + 1]), c = alphabet.indexOf(value[i + 2]), d = alphabet.indexOf(value[i + 3]); bytes[offset++] = a << 2 | b >> 4; if (offset < size) bytes[offset++] = (b & 15) << 4 | Math.max(c, 0) >> 2; if (offset < size) bytes[offset++] = (Math.max(c, 0) & 3) << 6 | Math.max(d, 0);}
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw unknown(); return bytes;
}
const evidenceJournalKey = (uid: string, scope: SupportScope) => `second:support-account-evidence:v2:${JSON.stringify([uid, scope])}`;
const isEvidenceJournal = (v: unknown, uid: string, scope: SupportScope): v is SupportAccountEvidenceJournalV2 => object(v) && exact(v, ['protocol', 'uid', 'scope', 'supportRequestId', 'requestId', 'expectedVersion', 'purpose', 'payloadHash']) && v.protocol === SUPPORT_ACCOUNT_REVIEW_CAPABILITY && v.uid === uid && v.scope === scope && id(v.supportRequestId) && /^[A-Za-z0-9_-]{16,128}$/.test(String(v.requestId)) && integer(v.expectedVersion) && evidencePurposes.includes(String(v.purpose)) && hash(v.payloadHash);
async function opaqueReviewReceipt(uid: string, operation: SupportAccountReviewOpaqueReceiptV2['operation'], attempt: {supportRequestId: string; requestId: string; payloadHash: string; expectedVersion: number; purpose: SupportAccountEvidence['purpose'] | null}, mode: 'observe' | 'neutralize', guard: () => void): Promise<SupportAccountReviewOpaqueReceiptV2> {
  const current = reviewGuard(uid, guard); current();
  const response = await httpsCallable<unknown, unknown>(functions, 'readSupportRequests')({capability: SUPPORT_ACCOUNT_REVIEW_CAPABILITY, expectedUid: uid, operation, mode, supportRequestId: attempt.supportRequestId, requestId: attempt.requestId, payloadHash: attempt.payloadHash, expectedVersion: attempt.expectedVersion, ...(operation === 'account_review_evidence_receipt' ? {purpose: attempt.purpose} : {})}); current(); const v = response.data;
  return parseOpaqueReviewReceipt(v, uid, operation, attempt);
}

function parseOpaqueReviewReceipt(v: unknown, uid: string, operation: SupportAccountReviewOpaqueReceiptV2['operation'], attempt: {supportRequestId: string; requestId: string; payloadHash: string; expectedVersion: number; purpose: SupportAccountEvidence['purpose'] | null}): SupportAccountReviewOpaqueReceiptV2 {
  if (!object(v) || !exact(v, ['protocol', 'operation', 'actorId', 'supportRequestId', 'requestId', 'payloadHash', 'expectedVersion', 'purpose', 'state', 'committed', 'replayed', 'recordedAt', 'resultVersion', 'reason', 'evidence', 'storageOutcome']) || v.protocol !== 'support_account_review_receipt_v2' || v.operation !== operation || v.actorId !== uid || v.supportRequestId !== attempt.supportRequestId || v.requestId !== attempt.requestId || v.payloadHash !== attempt.payloadHash || v.expectedVersion !== attempt.expectedVersion || v.purpose !== attempt.purpose || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) || v.committed !== (v.state === 'committed') || typeof v.replayed !== 'boolean' || v.storageOutcome !== 'not_asserted' || !(v.reason === null || v.reason === 'command_neutralized') || !(v.resultVersion === null || integer(v.resultVersion)) || !nullableDate(v.recordedAt)) throw unknown();
  if (v.state === 'unrecorded' ? v.recordedAt !== null || v.resultVersion !== null || v.evidence !== null || v.reason !== null : !date(v.recordedAt)) throw unknown();
  if (operation === 'account_review_evidence_receipt' && v.state === 'committed' ? !evidenceRef(v.evidence) || v.resultVersion !== attempt.expectedVersion : v.evidence !== null) throw unknown();
  if (v.state === 'committed' && (v.reason !== null || !integer(v.resultVersion))) throw unknown();
  return v as unknown as SupportAccountReviewOpaqueReceiptV2;
}

export const SupportAccountReviewService = {
  async preview(uid: string, request: SupportRequest, selected: SupportAccountObligationRef[], evidenceCursor: string | null, subjectUid: string, guard: () => void): Promise<SupportAccountReviewPreview> {
    const current = reviewGuard(uid, guard); current();
    if (!accountKind(request.kind) || !Array.isArray(selected) || selected.length > 20 || !selected.every(value => obligationRef(value) && object(value) && exact(value, ['kind', 'id'])) || new Set(selected.map(value => JSON.stringify(value))).size !== selected.length || evidenceCursor !== null && !/^spe_[a-f0-9]{64}$/.test(evidenceCursor) || !request.relatedAccountIds?.includes(subjectUid)) throw unknown();
    const v = await reviewRpc(uid, 'readSupportRequests', {scope: 'admin', operation: 'account_review_preview', supportRequestId: request.id, obligations: selected, ...(evidenceCursor ? {evidenceCursor} : {}), ...(request.kind === 'payment_account_review' ? {subjectUid} : {})}, current, true); current(); const result = parseReviewPreview(v, uid, request, selected, evidenceCursor); if (result.activityProgram) {const {contentHash, ...program} = result.activityProgram; if (await supportCommandHash(program) !== contentHash) throw unknown(); current();} return result;
  },
  async upload(uid: string, scope: SupportScope, request: SupportRequest, requestId: string, purpose: SupportAccountEvidence['purpose'], jpegBase64: string, guard: () => void): Promise<(SupportAccountEvidence & {replayed: boolean}) | SupportAccountReviewOpaqueReceiptV2> {
    const current = reviewGuard(uid, guard); current();
    if (!accountKind(request.kind) || scope === 'owner' && request.ownerId !== uid || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId) || !evidencePurposes.includes(purpose)) throw unknown();
    const bytes = decodeReviewJpeg(jpegBase64);
    const {productReviewByteHash} = await import('@/services/productReviewEvidenceService'); current();
    const sha256 = await productReviewByteHash(bytes); current();
    const payloadHash = await supportCommandHash({supportRequestId: request.id, expectedVersion: request.version, purpose, sha256}); current();
    const attempt: SupportAccountEvidenceJournalV2 = {protocol: SUPPORT_ACCOUNT_REVIEW_CAPABILITY, uid, scope, supportRequestId: request.id, requestId, expectedVersion: request.version, purpose, payloadHash};
    const slot = evidenceJournalKey(uid, scope); if (reviewJournalLocks.has(slot)) throw unknown(); reviewJournalLocks.add(slot);
    try {const prior = await this.evidenceJournal(uid, scope, current); current(); if (prior && !equalReview(prior, attempt)) throw new Error('Le dépôt précédent doit être rapproché avec sa référence exacte.');
    await serialize(slot, async () => {current(); await AsyncStorage.setItem(slot, JSON.stringify(attempt)); current();});
    const v = await reviewRpc(uid, scope === 'admin' ? 'administerSupportRequest' : 'commandSupportRequest', {operation: 'account_review_evidence_upload', supportRequestId: request.id, expectedVersion: request.version, requestId, purpose, jpegBase64}, current, scope === 'admin'); current();
    if (object(v) && v.protocol === 'support_account_review_receipt_v2') return parseOpaqueReviewReceipt(v, uid, 'account_review_evidence_receipt', attempt);
    if (!object(v) || !exact(v, ['protocol', 'supportRequestId', 'replayed', 'payloadHash', 'evidence', 'purpose', 'uploadedAt']) || v.protocol !== SUPPORT_ACCOUNT_REVIEW_CAPABILITY || v.supportRequestId !== request.id || v.payloadHash !== payloadHash || typeof v.replayed !== 'boolean' || !reviewEvidence({evidence: v.evidence, purpose: v.purpose, uploadedAt: v.uploadedAt}) || !evidenceRef(v.evidence) || v.purpose !== purpose || v.evidence.sha256 !== sha256 || v.evidence.sizeBytes !== bytes.length) throw unknown();
    return {evidence: v.evidence, purpose, uploadedAt: v.uploadedAt as string, replayed: v.replayed};
    } finally {reviewJournalLocks.delete(slot);}
  },
  async readEvidence(uid: string, request: SupportRequest, evidence: SupportAccountEvidenceRef, requestId: string, guard: () => void): Promise<SupportAccountEvidenceRead> {
    const current = reviewGuard(uid, guard); current(); if (!evidenceRef(evidence) || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw unknown();
    const v = await reviewRpc(uid, 'readSupportRequests', {scope: 'admin', operation: 'account_review_evidence_read', supportRequestId: request.id, expectedVersion: request.version, requestId, evidence}, current, true); current();
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'supportRequestId', 'readId', 'evidence', 'jpegBase64', 'readAt']) || v.protocol !== SUPPORT_ACCOUNT_REVIEW_CAPABILITY || v.actorId !== uid || v.supportRequestId !== request.id || v.readId !== `ser_${await supportCommandHash([request.id, uid, requestId])}` || !equalReview(v.evidence, evidence) || !date(v.readAt)) throw unknown(); current();
    const bytes = decodeReviewJpeg(v.jpegBase64), {productReviewByteHash} = await import('@/services/productReviewEvidenceService'); current();
    if (bytes.length !== evidence.sizeBytes || await productReviewByteHash(bytes) !== evidence.sha256) throw unknown(); current(); return v as unknown as SupportAccountEvidenceRead;
  },
  async evidenceJournal(uid: string, scope: SupportScope, guard: () => void): Promise<SupportAccountEvidenceJournalV2 | null> {
    const current = reviewGuard(uid, guard); current(); const raw = await AsyncStorage.getItem(evidenceJournalKey(uid, scope)); current(); if (raw === null) return null; const value: unknown = JSON.parse(raw); if (!isEvidenceJournal(value, uid, scope)) throw unknown(); return value;
  },
  async evidenceReceipt(attempt: SupportAccountEvidenceJournalV2, mode: 'observe' | 'neutralize', guard: () => void): Promise<SupportAccountReviewOpaqueReceiptV2> {
    if (!isEvidenceJournal(attempt, attempt.uid, attempt.scope)) throw unknown(); return opaqueReviewReceipt(attempt.uid, 'account_review_evidence_receipt', attempt, mode, guard);
  },
  async decisionReceipt(attempt: SupportAccountReviewJournalV2, mode: 'observe' | 'neutralize', guard: () => void): Promise<SupportAccountReviewOpaqueReceiptV2> {
    if (!isReviewJournal(attempt, attempt.uid)) throw unknown(); return opaqueReviewReceipt(attempt.uid, 'account_review_decision_receipt', {...attempt.reference, expectedVersion: attempt.expectedVersion, purpose: null}, mode, guard);
  },
  async acknowledgeEvidence(attempt: SupportAccountEvidenceJournalV2, guard: () => void) {
    const current = reviewGuard(attempt.uid, guard), slot = evidenceJournalKey(attempt.uid, attempt.scope); current(); if (reviewJournalLocks.has(slot)) throw unknown(); reviewJournalLocks.add(slot);
    try {const receipt = await this.evidenceReceipt(attempt, 'observe', current); current(); if (receipt.state === 'unrecorded') throw unknown(); await serialize(slot, async () => {const prior = await this.evidenceJournal(attempt.uid, attempt.scope, current); current(); if (!equalReview(prior, attempt)) throw unknown(); await AsyncStorage.removeItem(slot); current();}); return receipt;} finally {reviewJournalLocks.delete(slot);}
  },
  async acknowledgeDecision(attempt: SupportAccountReviewJournalV2, guard: () => void) {
    const current = reviewGuard(attempt.uid, guard), slot = reviewJournalKey(attempt.uid); current(); if (reviewJournalLocks.has(slot)) throw unknown(); reviewJournalLocks.add(slot);
    try {const receipt = await this.decisionReceipt(attempt, 'observe', current); current(); if (receipt.state === 'unrecorded') throw unknown(); await serialize(slot, async () => {const prior = await this.journal(attempt.uid, current); current(); if (!equalReview(prior, attempt)) throw unknown(); await AsyncStorage.removeItem(slot); current();}); return receipt;} finally {reviewJournalLocks.delete(slot);}
  },
  async journal(uid: string, guard: () => void): Promise<SupportAccountReviewJournalV2 | null> {
    const current = reviewGuard(uid, guard); current(); const raw = await AsyncStorage.getItem(reviewJournalKey(uid)); current();
    if (raw === null) return null; const v: unknown = JSON.parse(raw); if (!isReviewJournal(v, uid)) throw unknown(); return v;
  },
  async execute(uid: string, requestId: string, command: SupportAccountReviewCommandV2, guard: () => void): Promise<SupportReceipt | SupportAccountReviewOpaqueReceiptV2> {
    const current = reviewGuard(uid, guard), slot = reviewJournalKey(uid); current();
    if (reviewJournalLocks.has(slot) || !id(command.supportRequestId) || !integer(command.expectedVersion) || command.action !== 'record_account_review' || !accountReviewInputV2(command.accountReview) || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw unknown();
    reviewJournalLocks.add(slot);
    try {const payloadHash = await supportCommandHash(command); current(); const reference = {actorId: uid, supportRequestId: command.supportRequestId, requestId, payloadHash, action: command.action};
      const entry: SupportAccountReviewJournalV2 = {protocol: SUPPORT_ACCOUNT_REVIEW_CAPABILITY, uid, scope: 'admin', expectedVersion: command.expectedVersion, reference};
      const prior = await this.journal(uid, current); current(); if (prior && !equalReview(prior, entry)) throw new Error('Une décision précédente doit être rapprochée avec son reçu exact.');
      if (prior) {const original = await this.decisionReceipt(prior, 'observe', current); current(); if (original.state !== 'unrecorded') return original;} else {const due = Date.parse(command.accountReview.reviewDueAt), now = Date.now(); if (due <= now || due > now + 90 * 86400_000) throw new Error('Une date de révision future dans les 90 jours est requise.');}
      await serialize(slot, async () => {current(); await AsyncStorage.setItem(slot, JSON.stringify(entry)); current();});
      const v = await reviewRpc(uid, 'administerSupportRequest', {mode: 'execute', requestId, command}, current, true); current();
      if (object(v) && v.protocol === 'support_account_review_receipt_v2') return parseOpaqueReviewReceipt(v, uid, 'account_review_decision_receipt', {...reference, expectedVersion: command.expectedVersion, purpose: null});
      if (!object(v) || v.protocol !== 'support_command_v1' || v.actorId !== uid || v.requestId !== requestId || v.supportRequestId !== command.supportRequestId || v.action !== 'record_account_review' || v.payloadHash !== payloadHash || !['committed', 'not_executed', 'unrecorded'].includes(String(v.state)) || v.committed !== (v.state === 'committed') || typeof v.replay !== 'boolean' || v.admissionVerified !== false || v.financialEffect !== 'none' || v.rightsRestored !== false || !(v.ownerId === null || isDeclaredSupportAccountId(v.ownerId)) || !(v.resultVersion === null || integer(v.resultVersion)) || !nullableDate(v.recordedAt) || !nullableText(v.reason)) throw unknown();
      if (v.state === 'unrecorded' ? v.request !== null || v.recordedAt !== null || v.resultVersion !== null || v.ownerId !== null || v.reason !== null : !date(v.recordedAt)) throw unknown();
      if (v.state === 'committed' && (v.request === null || !isDeclaredSupportAccountId(v.ownerId) || v.resultVersion !== command.expectedVersion + 1 || v.reason !== null)) throw unknown();
      if (v.request !== null) {const request = parseSupportRequest(v.request, 'owner', String(v.ownerId)); if (request.id !== command.supportRequestId || request.version !== v.resultVersion) throw unknown(); if (v.state === 'committed' && (request.accountReview?.protocol !== SUPPORT_ACCOUNT_REVIEW_CAPABILITY || request.accountReview.finding !== command.accountReview.finding || request.accountReview.ownerMessage !== command.accountReview.ownerMessage || request.accountReview.recourse !== command.accountReview.recourse || request.accountReview.reviewDueAt !== command.accountReview.reviewDueAt)) throw unknown();}
      return v as unknown as SupportReceipt;
    } finally {reviewJournalLocks.delete(slot);}
  },
};
