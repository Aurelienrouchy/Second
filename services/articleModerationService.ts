import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { collection, documentId, getDocsFromServer, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { auth, firestore, functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession, isDefinitiveTradeRefusal } from '@/services/tradeOperation';
import { getCallableErrorCode } from '@/utils/callableError';
import type { AdminReportsResponse, ArticleAppealAttempt, ArticleAppealInput, ArticleAppealResponse,
  OwnerArticleDecision, OwnerDecisionResponse, OwnerModerationArticlePage, TriageReportInput, TriageReportResponse,
  AdminModerationReference, AdminOrderModeration, ModeratedOrdersPage, OrderModerationAttempt,
  OrderModerationInput, OrderModerationReceipt, OrderNoticeContinuation, PartyOrderModerationResponse,
  FavorableArticleAttempt, FavorableArticleInput, FavorableArticleReceipt, FavorableArticleSource,
  LegacyOrderModerationInput, LegacyOrderModerationReceipt, OrderContinuationInput, OrderContinuationProof,
  OrderContinuationPreview, OrderContinuationReceipt } from '@/types/articleModeration';
import type { AdminArticlePhoto, AdminArticlePhotoEvidence } from '@/types/articleReportEvidence';
import {isMessageReportSummary} from '@/services/messageReportService';
import {isProductReviewEvidenceReference, productReviewEqual, productReviewHash} from '@/services/productReviewService';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && !!value && !value.includes('/') && value.trim() === value;
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const journalKey = (uid: string, articleId: string) => `article-appeal:v1:${encodeURIComponent(uid)}:${encodeURIComponent(articleId)}`;
const orderJournalKey = (uid: string, articleId: string) => `order-moderation:v1:${encodeURIComponent(uid)}:${encodeURIComponent(articleId)}`;
const historyKey = (uid: string) => `admin-moderation-references:v1:${encodeURIComponent(uid)}`;
const favorableKey = (uid: string) => `article-moderation-favorable:v1:${encodeURIComponent(uid)}`;
const queues = new Map<string, Promise<unknown>>();
const samePayload = (left: ArticleAppealInput, right: ArticleAppealInput) => left.operation === right.operation && left.articleId === right.articleId &&
  left.decisionId === right.decisionId && left.requestId === right.requestId && left.reason === right.reason;
function decision(value: unknown): value is OwnerArticleDecision {
  if (!record(value) || !digest(value.id) || !['hold', 'reject', 'approve'].includes(String(value.action)) || typeof value.status !== 'string' ||
    typeof value.ownerMessage !== 'string' || !nullableString(value.decidedAt) || !nullableString(value.appealStatus) || !nullableString(value.appealReceivedAt)) return false;
  if (value.action === 'approve' || value.favorableRecorded !== undefined) {
    if (typeof value.favorableRecorded !== 'boolean' || typeof value.listingReactivated !== 'boolean' || value.availabilityPermissionGranted !== false ||
      !Array.isArray(value.availabilityBlockers) || !value.availabilityBlockers.every(v => typeof v === 'string') ||
      !(value.reviewedAppealId === null || id(value.reviewedAppealId)) || !(value.remainingRestrictionCount === null ||
        typeof value.remainingRestrictionCount === 'number' && Number.isSafeInteger(value.remainingRestrictionCount) && value.remainingRestrictionCount >= 0) ||
      !record(value.currentListingState) || ![null, true, false].includes(value.currentListingState.isActive as boolean | null) ||
      ![null, true, false].includes(value.currentListingState.isSold as boolean | null) || !nullableString(value.currentListingState.moderationStatus)) return false;
    const lifted = value.liftedDecision;
    if (lifted !== null && (!record(lifted) || !digest(lifted.id) || !['hold', 'reject'].includes(String(lifted.action)) ||
      !nullableString(lifted.ownerMessage) || !nullableString(lifted.decidedAt) || typeof lifted.sourceQualified !== 'boolean')) return false;
  }
  return true;
}
const favorableInputKeys = ['articleId', 'reportId', 'expectedOwnerId', 'expectedDecisionId', 'expectedModerationDecisionId', 'expectedArticleRevision',
  'expectedReportRevision', 'expectedModerationRevision', 'expectedAppealId', 'expectedAppealRevision', 'requestId', 'action', 'ownerMessage', 'authorityNote', 'evidenceReferences'];
const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && v === v.trim() && !!v && v.length <= max;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const favorableUnknown = () => new Error('Cette intention favorable doit être relue avec ses références, ses versions et son motif d’origine. Une absence ne permet pas de l’acquitter.');
function favorableInput(value: unknown): value is FavorableArticleInput {
  return record(value) && Object.keys(value).every(key => favorableInputKeys.includes(key)) &&
    [value.articleId, value.reportId, value.expectedOwnerId].every(id) &&
    [value.expectedDecisionId, value.expectedModerationDecisionId, value.expectedArticleRevision, value.expectedReportRevision, value.expectedModerationRevision].every(digest) &&
    (value.expectedAppealId === null && value.expectedAppealRevision === null || id(value.expectedAppealId) && digest(value.expectedAppealRevision)) &&
    typeof value.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value.requestId) && value.action === 'approve' &&
    bounded(value.ownerMessage, 2000) && bounded(value.authorityNote, 2000) && Array.isArray(value.evidenceReferences) &&
    value.evidenceReferences.length >= 1 && value.evidenceReferences.length <= 10 && value.evidenceReferences.every(v => bounded(v, 500));
}
function favorableAttempt(value: unknown, uid: string): value is FavorableArticleAttempt {
  return record(value) && Object.keys(value).every(key => ['version', 'uid', 'payload'].includes(key)) && value.version === 1 && value.uid === uid && favorableInput(value.payload);
}
export function sameFavorableArticleInput(left: FavorableArticleInput, right: FavorableArticleInput) {
  return JSON.stringify(Object.fromEntries(favorableInputKeys.slice().sort().map(key => [key, left[key as keyof FavorableArticleInput]]))) ===
    JSON.stringify(Object.fromEntries(favorableInputKeys.slice().sort().map(key => [key, right[key as keyof FavorableArticleInput]])));
}
async function parseFavorableReceipt(value: unknown, uid: string, input: FavorableArticleInput, assertContext: () => void): Promise<FavorableArticleReceipt> {
  const decisionId = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([uid, input.articleId, input.requestId])); assertContext();
  const canonical = Object.fromEntries(favorableInputKeys.slice().sort().map(key => [key, input[key as keyof FavorableArticleInput]]));
  const payloadHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([uid, canonical])); assertContext();
  if (!record(value) || value.protocol !== 'article_moderation_favorable_v1' || value.actorUid !== uid || value.articleId !== input.articleId ||
    value.reportId !== input.reportId || value.ownerId !== input.expectedOwnerId || value.requestId !== input.requestId || value.decisionId !== decisionId || value.payloadHash !== payloadHash ||
    !['approved', 'not_executed', 'unrecorded'].includes(String(value.outcome)) || value.availabilityPermissionGranted !== false || value.financialEffectsCommitted !== false ||
    value.orderProgressPermissionGranted !== false || value.authenticityVerified !== false || value.rightsVerified !== false) throw favorableUnknown();
  const approved = value.outcome === 'approved', neutralized = value.outcome === 'not_executed';
  if (value.favorableRecorded !== approved || value.decisionCommitted !== approved || value.sourceExamined !== approved ||
    value.intentionNeutralized !== neutralized || value.lateRequestBlocked !== neutralized || typeof value.listingReactivated !== 'boolean' ||
    !approved && value.listingReactivated !== false) throw favorableUnknown();
  if (value.outcome === 'unrecorded') {
    if (['reason', 'liftedDecisionId', 'reviewedAppealId', 'availabilityBlockers', 'remainingRestrictionDecisionIds', 'ownerMessage', 'decidedAt', 'replay', 'superseded',
      'notificationCommitted', 'deviceDeliveryVerified', 'readingVerified'].some(key => key in value)) throw favorableUnknown();
  } else {
    if (typeof value.replay !== 'boolean' || typeof value.superseded !== 'boolean' || !iso(value.decidedAt) || value.ownerMessage !== input.ownerMessage ||
      value.notificationCommitted !== approved || value.deviceDeliveryVerified !== false || value.readingVerified !== false ||
      !Array.isArray(value.availabilityBlockers) || value.availabilityBlockers.some(v => !bounded(v, 200)) || !Array.isArray(value.remainingRestrictionDecisionIds) ||
      !value.remainingRestrictionDecisionIds.every(digest)) throw favorableUnknown();
    if (approved ? value.reason !== null || value.liftedDecisionId !== input.expectedDecisionId ||
      !(value.reviewedAppealId === null || value.reviewedAppealId === input.expectedAppealId) ||
      value.listingReactivated !== (value.availabilityBlockers.length === 0) || value.listingReactivated && value.remainingRestrictionDecisionIds.length !== 0 :
      !['source_changed', 'intention_neutralized_before_effects'].includes(String(value.reason)) || value.liftedDecisionId !== null ||
      value.reviewedAppealId !== null || value.availabilityBlockers.length !== 0 || value.remainingRestrictionDecisionIds.length !== 0) throw favorableUnknown();
  }
  return value as unknown as FavorableArticleReceipt;
}
function appealInput(value: unknown): value is ArticleAppealInput {
  return record(value) && value.operation === 'contestArticleDecision' && id(value.articleId) && digest(value.decisionId) && id(value.requestId) &&
    typeof value.reason === 'string' && !!value.reason.trim() && value.reason.length <= 2000;
}
function appealReceipt(value: unknown, articleId: string): value is ArticleAppealResponse {
  return record(value) && value.ok === true && value.articleId === articleId && value.recorded === true &&
    digest(value.appealId) && typeof value.replay === 'boolean' && decision(value.decision);
}
function validAttempt(value: unknown, uid: string, articleId: string): value is ArticleAppealAttempt {
  return record(value) && value.uid === uid && value.articleId === articleId && appealInput(value.payload) && value.payload.articleId === articleId &&
    (value.receipt === undefined || appealReceipt(value.receipt, articleId));
}
function orderState(value: unknown): value is AdminOrderModeration {
  return record(value) && id(value.articleId) && (value.decisionId === null || digest(value.decisionId)) &&
    ['pause', 'continue'].includes(String(value.action)) && typeof value.message === 'string' &&
    (value.instructionId === null || digest(value.instructionId)) && nullableString(value.decidedAt) &&
    typeof value.sourceQualified === 'boolean' && Array.isArray(value.otherBlockers) && value.otherBlockers.every(item => typeof item === 'string');
}
const continuationUnknown = () => new Error('L’intention exacte doit être relue. Une absence ou une erreur ne prouve pas sa non-exécution.');
const legacyOrderKeys = ['operation', 'expectedAdminUid', 'transactionId', 'requestId', 'expectedOrderRevision', 'expectedArticleDecisionId',
  'action', 'message', 'authorityNote', 'evidenceReferences'];
const continuationOrderKeys = [...legacyOrderKeys, 'capability', 'expectedUid', 'articleId', 'continuationProof'];
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const continuationLimits = (v: Record<string, unknown>) => v.humanCompetenceVerified === false && v.expertiseVerified === false && v.legalAuthorityVerified === false;
function continuationProof(value: unknown): value is OrderContinuationProof {
  return record(value) && exactKeys(value, ['protocol', 'sourceHash', 'stableOrderHash', 'caseId', 'caseVersion', 'caseSourceHash', 'corpusHash', 'technicalQualificationOnly']) &&
    value.protocol === 'order_moderation_continuation_proof_v1' && value.technicalQualificationOnly === true &&
    [value.sourceHash, value.stableOrderHash, value.caseSourceHash, value.corpusHash].every(digest) &&
    typeof value.caseId === 'string' && /^pr_[a-f0-9]{64}$/.test(value.caseId) && typeof value.caseVersion === 'number' && Number.isSafeInteger(value.caseVersion) && value.caseVersion > 0;
}
export function isOrderContinuationInput(value: OrderModerationInput): value is OrderContinuationInput {
  return 'capability' in value && value.capability === 'order_moderation_continuation_v1';
}
function orderInput(value: unknown, uid: string): value is OrderModerationInput {
  if (!record(value) || value.operation !== 'reviewOrderModeration' || value.expectedAdminUid !== uid || !id(value.transactionId) ||
      !id(value.requestId) || !digest(value.expectedOrderRevision) || !digest(value.expectedArticleDecisionId) ||
      !['pause', 'continue'].includes(String(value.action)) || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 2000 ||
      typeof value.authorityNote !== 'string' || !value.authorityNote.trim() || value.authorityNote.length > 2000 || !Array.isArray(value.evidenceReferences)) return false;
  if (value.capability === undefined) return exactKeys(value, legacyOrderKeys) && value.evidenceReferences.length >= 1 && value.evidenceReferences.length <= 10 &&
    value.evidenceReferences.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 500);
  return exactKeys(value, continuationOrderKeys) && value.capability === 'order_moderation_continuation_v1' && value.expectedUid === uid && id(value.articleId) &&
    value.requestId.length >= 16 && value.message === value.message.trim() && value.authorityNote === value.authorityNote.trim() &&
    value.evidenceReferences.length <= 100 && value.evidenceReferences.every(isProductReviewEvidenceReference) &&
    new Set(value.evidenceReferences.map(ref => ref.id)).size === value.evidenceReferences.length &&
    (value.action === 'pause' ? value.continuationProof === null : continuationProof(value.continuationProof) && value.evidenceReferences.length > 0 &&
      value.evidenceReferences.every(ref => ref.state === 'received'));
}
function orderReceipt(value: unknown, input: LegacyOrderModerationInput): value is LegacyOrderModerationReceipt {
  return record(value) && value.ok === true && value.transactionId === input.transactionId && digest(value.instructionId) &&
    typeof value.replay === 'boolean' && typeof value.superseded === 'boolean' &&
    (value.moderation === null || orderState(value.moderation));
}
export const sameOrderModerationInput = (left: OrderModerationInput, right: OrderModerationInput) => productReviewEqual(left, right);
async function parseOrderReceipt(value: unknown, uid: string, input: OrderModerationInput, assertCurrent: () => void): Promise<OrderModerationReceipt> {
  const instructionId = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([uid, input.transactionId, input.requestId])); assertCurrent();
  if (!isOrderContinuationInput(input)) {
    if (!orderReceipt(value, input) || value.instructionId !== instructionId) throw continuationUnknown();
    return value;
  }
  const command = {action: input.action, message: input.message, authorityNote: input.authorityNote, evidenceReferences: input.evidenceReferences,
    expectedOrderRevision: input.expectedOrderRevision, expectedArticleDecisionId: input.expectedArticleDecisionId,
    capability: input.capability, continuationProof: input.continuationProof};
  const inputHash = await productReviewHash([uid, input.transactionId, input.requestId, command]); assertCurrent();
  if (!record(value) || !exactKeys(value, ['protocol', 'ownerId', 'transactionId', 'articleId', 'requestId', 'inputHash', 'instructionId', 'state',
      'recordedAt', 'reason', 'action', 'sourceBoundAtCommit', 'humanCompetenceVerified', 'expertiseVerified', 'legalAuthorityVerified']) ||
      value.protocol !== 'order_moderation_continuation_receipt_v1' || value.ownerId !== uid || value.transactionId !== input.transactionId ||
      value.articleId !== input.articleId || value.requestId !== input.requestId || value.inputHash !== inputHash || value.instructionId !== instructionId ||
      value.action !== input.action || !['absent', 'committed', 'not_executed', 'neutralized'].includes(String(value.state)) || !continuationLimits(value) ||
      value.sourceBoundAtCommit !== (value.state === 'committed' && input.action === 'continue') ||
      (value.state === 'absent' ? value.recordedAt !== null || value.reason !== null : !iso(value.recordedAt) || !nullableString(value.reason)) ||
      value.state === 'committed' && value.reason !== null || value.state === 'neutralized' && value.reason !== 'owner_neutralized') throw continuationUnknown();
  return value as unknown as OrderContinuationReceipt;
}
async function assertOrderRecentSession(uid: string, assertCurrent: () => void) {
  assertCurrent(); const user = auth.currentUser;
  if (!user || user.uid !== uid) throw continuationUnknown();
  const token = await user.getIdTokenResult(true); assertCurrent();
  const time = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
  if (auth.currentUser !== user || token.claims.admin !== true || typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0 || time > now || now - time > 300)
    throw new Error('Vérifiez à nouveau votre identité puis relisez le dossier avant cette instruction.');
}
async function call<I, O>(uid: string, name: string, input: I, assertContext: () => void): Promise<O> {
  const session = captureTradeSession(uid); assertContext();
  const response = await httpsCallable<I, O>(functions, name)(input);
  assertTradeSessionCurrent(session); assertContext();
  return response.data;
}
export const newArticleAppealRequestId = () => randomUUID();
export const ARTICLE_AVAILABILITY_BLOCKER_LABELS: Readonly<Record<string, string>> = {
  restriction_history_unqualified: 'Historique de restrictions à qualifier',
  other_operator_restrictions: 'Autres motifs de restriction encore présents',
  privacy_withdrawal: 'Retrait lié à la confidentialité',
  sold_or_sale_state_unqualified: 'Article vendu ou état de vente à qualifier',
  owner_withdrawal_or_visibility_history_unqualified: 'Retrait du propriétaire ou historique de visibilité à qualifier',
  listing_images_unqualified: 'Photos de l’annonce à qualifier',
  agreement_or_financial_obligation: 'Accord existant ou obligation financière à examiner',
  seller_admission_required: 'Admission du vendeur à confirmer',
  hygiene_declaration_required: 'État d’hygiène à confirmer',
};
export class ArticleModerationService {
  static async readReportPhotoEvidence(uid: string, reportId: string, assertContext: () => void): Promise<AdminArticlePhotoEvidence> {
    const value = await call<unknown, unknown>(uid, 'getPendingReports', {operation: 'readReportEvidence', expectedUid: uid, reportId}, assertContext);
    if (!record(value) || value.protocol !== 'article_report_evidence_v1' || value.actorUid !== uid || value.reportId !== reportId ||
      !['historical_unknown', 'pending', 'preserved', 'needs_review'].includes(String(value.conservation)) ||
      value.authenticityVerified !== false || value.photoRightsVerified !== false || !Array.isArray(value.media) || value.media.length > 10 ||
      value.media.some((media, index) => !record(media) || media.index !== index || !digest(media.mediaId) ||
        !['pending', 'preserved', 'needs_review'].includes(String(media.state)) || !nullableString(media.reason) ||
        !(media.contentType === null || typeof media.contentType === 'string' && media.contentType.startsWith('image/')) ||
        !(media.size === null || typeof media.size === 'number' && Number.isSafeInteger(media.size) && media.size > 0 && media.size < 10 * 1024 * 1024) ||
        ![media.sourceGeneration, media.privateGeneration].every(v => v === null || typeof v === 'string' && /^\d+$/.test(v)) ||
        media.state === 'preserved' && (!media.privateGeneration || !media.sourceGeneration) ||
        Object.keys(media).some(key => !['index', 'mediaId', 'state', 'reason', 'contentType', 'size', 'sourceGeneration', 'privateGeneration'].includes(key))) ||
      new Set(value.media.map(media => media.mediaId)).size !== value.media.length) throw new Error('La preuve photo du dossier n’est pas qualifiée.');
    if (value.snapshot === null) {
      if (value.media.length || !['historical_unknown', 'needs_review'].includes(String(value.conservation))) throw new Error('La capture historique reste à rapprocher.');
    } else if (!record(value.snapshot) || Object.keys(value.snapshot).some(key => !['title', 'description', 'price', 'condition', 'brand', 'brandStatus',
      'categoryIds', 'size', 'color', 'colors', 'material', 'materials', 'pattern', 'hasKnownDefects', 'defectsDescription', 'hasAlterations', 'alterationsDescription', 'quantity'].includes(key)) ||
      !id(value.articleId) || !id(value.sellerId) || !id(value.reporterId) ||
      !digest(value.articleRevision) || !digest(value.contentHash) || !iso(value.capturedAt)) throw new Error('La capture native de l’annonce doit être relue.');
    if (Object.keys(value).some(key => !['protocol', 'actorUid', 'reportId', 'conservation', 'articleId', 'sellerId', 'reporterId',
      'articleRevision', 'contentHash', 'capturedAt', 'snapshot', 'media', 'authenticityVerified', 'photoRightsVerified', 'integrity'].includes(key))) {
      throw new Error('La capture contient des informations non qualifiées.');
    }
    return value as unknown as AdminArticlePhotoEvidence;
  }

  static async readReportPrivatePhoto(uid: string, evidence: AdminArticlePhotoEvidence, mediaId: string, assertContext: () => void): Promise<AdminArticlePhoto> {
    const expected = evidence.media.find(media => media.mediaId === mediaId && media.state === 'preserved');
    if (evidence.actorUid !== uid || !expected || !evidence.articleId || !expected.privateGeneration || !expected.sourceGeneration) throw new Error('Cette photo privée n’est pas qualifiée pour ce dossier.');
    const value = await call<unknown, unknown>(uid, 'getPendingReports', {operation: 'readReportEvidence', expectedUid: uid, reportId: evidence.reportId, mediaId}, assertContext);
    if (!record(value) || value.protocol !== 'article_report_media_v1' || value.actorUid !== uid || value.reportId !== evidence.reportId ||
      value.articleId !== evidence.articleId || value.mediaId !== mediaId || value.generation !== expected.privateGeneration ||
      value.sourceGeneration !== expected.sourceGeneration || value.contentType !== expected.contentType || value.size !== expected.size ||
      value.authenticityVerified !== false || value.photoRightsVerified !== false || typeof value.dataUrl !== 'string' ||
      !value.dataUrl.startsWith(`data:${expected.contentType};base64,`) || value.dataUrl.length > 14 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl.slice(value.dataUrl.indexOf(',') + 1)) ||
      Object.keys(value).some(key => !['protocol', 'actorUid', 'reportId', 'articleId', 'mediaId', 'generation', 'sourceGeneration',
        'contentType', 'size', 'authenticityVerified', 'photoRightsVerified', 'dataUrl'].includes(key))) throw new Error('La photo privée ne correspond plus à la capture examinée.');
    const encoded = value.dataUrl.slice(value.dataUrl.indexOf(',') + 1);
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    if (encoded.length % 4 !== 0 || encoded.length / 4 * 3 - padding !== value.size) throw new Error('Les pixels privés ne correspondent pas à la taille qualifiée.');
    return value as unknown as AdminArticlePhoto;
  }

  static async readFavorableSource(uid: string, articleId: string, reportId: string, assertContext: () => void): Promise<FavorableArticleSource> {
    const value = await call<unknown, unknown>(uid, 'getPendingReports', {operation: 'readArticleModeration', expectedAdminUid: uid, articleId, reportId}, assertContext);
    if (!record(value) || value.protocol !== 'article_moderation_review_v1' || value.actorUid !== uid || value.articleId !== articleId || value.reportId !== reportId ||
      !id(value.expectedOwnerId) || ![value.expectedDecisionId, value.expectedModerationDecisionId, value.expectedArticleRevision,
        value.expectedReportRevision, value.expectedModerationRevision].every(digest) ||
      !(value.expectedAppealId === null && value.expectedAppealRevision === null || id(value.expectedAppealId) && digest(value.expectedAppealRevision)) ||
      typeof value.restrictionEvidenceQualified !== 'boolean' || value.listingReactivated !== false || value.availabilityPermissionGranted !== false ||
      !record(value.restriction) || !['hold', 'reject'].includes(String(value.restriction.action)) || !nullableString(value.restriction.ownerMessage) ||
      !(value.restriction.decidedAt === null || iso(value.restriction.decidedAt)) || !Array.isArray(value.restriction.evidenceReferences) ||
      !value.restriction.evidenceReferences.every(v => bounded(v, 500)) || value.restriction.evidenceReferences.length > 10) throw favorableUnknown();
    if (value.appeal === null ? value.expectedAppealId !== null : !record(value.appeal) || value.appeal.id !== value.expectedAppealId ||
      typeof value.appeal.status !== 'string' || !nullableString(value.appeal.reason) || !(value.appeal.receivedAt === null || iso(value.appeal.receivedAt))) throw favorableUnknown();
    return value as unknown as FavorableArticleSource;
  }
  static async readFavorableAttempt(uid: string, assertContext: () => void): Promise<FavorableArticleAttempt | null> {
    const session = captureTradeSession(uid); assertContext();
    const raw = await AsyncStorage.getItem(favorableKey(uid)); assertTradeSessionCurrent(session); assertContext();
    if (raw === null) return null; const value: unknown = JSON.parse(raw);
    if (!favorableAttempt(value, uid)) throw favorableUnknown(); return value;
  }
  static async reviewFavorable(uid: string, input: FavorableArticleInput, mode: 'confirm' | 'observe' | 'neutralize',
    assertContext: () => void, recoveryOnly = false): Promise<FavorableArticleReceipt> {
    const session = captureTradeSession(uid), key = favorableKey(uid);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertCurrent(); if (!favorableInput(input)) throw favorableUnknown();
      const prior = await this.readFavorableAttempt(uid, assertCurrent);
      if (prior && !sameFavorableArticleInput(prior.payload, input) || !prior && (mode !== 'confirm' || recoveryOnly)) throw favorableUnknown();
      const saved: FavorableArticleAttempt = prior ?? {version: 1, uid, payload: {...input, evidenceReferences: [...input.evidenceReferences]}};
      if (!prior) {await AsyncStorage.setItem(key, JSON.stringify(saved)); assertCurrent();}
      const value = await call<unknown, unknown>(uid, 'triageReport', {operation: 'reviewArticleModeration', expectedAdminUid: uid, ...saved.payload,
        mode, ...(mode === 'observe' ? {} : {accepted: true})}, assertCurrent);
      assertCurrent(); const receipt = await parseFavorableReceipt(value, uid, saved.payload, assertCurrent); assertCurrent(); return receipt;
    });
    queues.set(key, pending);
    try {return await pending;} finally {if (queues.get(key) === pending) queues.delete(key);}
  }
  static async acknowledgeFavorable(uid: string, input: FavorableArticleInput, assertContext: () => void): Promise<FavorableArticleReceipt> {
    const session = captureTradeSession(uid), key = favorableKey(uid);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertCurrent(); const prior = await this.readFavorableAttempt(uid, assertCurrent);
      if (!prior || !sameFavorableArticleInput(prior.payload, input)) throw favorableUnknown();
      const value = await call<unknown, unknown>(uid, 'triageReport', {operation: 'reviewArticleModeration', expectedAdminUid: uid, ...prior.payload, mode: 'observe'}, assertCurrent);
      const receipt = await parseFavorableReceipt(value, uid, prior.payload, assertCurrent); assertCurrent();
      if (receipt.outcome === 'unrecorded') throw favorableUnknown();
      const current = await this.readFavorableAttempt(uid, assertCurrent);
      if (!current || !sameFavorableArticleInput(current.payload, input)) throw favorableUnknown();
      await AsyncStorage.removeItem(key); assertCurrent(); return receipt;
    });
    queues.set(key, pending);
    try {return await pending;} finally {if (queues.get(key) === pending) queues.delete(key);}
  }
  static async readOrderModeration(uid: string, transactionId: string, assertContext: () => void): Promise<PartyOrderModerationResponse> {
    const response = await call<{ operation: 'readOrderModeration'; transactionId: string }, PartyOrderModerationResponse>(
      uid, 'submitReport', { operation: 'readOrderModeration', transactionId }, assertContext);
    const state = response.moderation;
    if (response.ok !== true || response.transactionId !== transactionId || (state !== null &&
        (!record(state) || !id(state.articleId) || !(state.decisionId === null || digest(state.decisionId)) ||
        !['pause', 'continue'].includes(state.action) || typeof state.message !== 'string' || !nullableString(state.decidedAt) ||
        !(state.instructionId === null || digest(state.instructionId)) || typeof state.progressAllowed !== 'boolean' ||
        typeof state.additionalReviewRequired !== 'boolean'))) throw new Error('L’instruction de cette commande doit être relue.');
    return response;
  }
  static async getModeratedOrders(uid: string, articleId: string, cursor: string | null, assertContext: () => void): Promise<ModeratedOrdersPage> {
    const response = await call<{ operation: 'readModeratedOrders'; articleId: string; cursor?: string }, ModeratedOrdersPage>(uid,
      'getPendingReports', { operation: 'readModeratedOrders', articleId, ...(cursor ? { cursor } : {}) }, assertContext);
    if (response.ok !== true || response.articleId !== articleId || !digest(response.decisionId) || typeof response.noticesPending !== 'boolean' ||
        !(response.nextCursor === null || id(response.nextCursor)) || (response.nextCursor !== null && response.nextCursor === cursor) ||
        !Array.isArray(response.orders) || response.orders.length > 20 || new Set(response.orders.map(order => order.id)).size !== response.orders.length ||
        response.orders.some(order => !id(order.id) || !digest(order.revision) || order.articleId !== articleId ||
          !nullableString(order.buyerId) || !nullableString(order.sellerId) || !nullableString(order.status) || !nullableString(order.deliveryType) ||
          typeof order.paymentEvidence !== 'boolean' || typeof order.fundsReleased !== 'boolean' || typeof order.hasLabel !== 'boolean' ||
          !(order.moderation === null || orderState(order.moderation)))) throw new Error('Les commandes doivent être relues avant une instruction.');
    return response;
  }
  static async continueOrderNotices(uid: string, articleId: string, decisionId: string, assertContext: () => void): Promise<OrderNoticeContinuation> {
    const session = captureTradeSession(uid);
    const response = await call<{ operation: 'continueOrderNotices'; expectedAdminUid: string; articleId: string; decisionId: string }, OrderNoticeContinuation>(
      uid, 'triageReport', { operation: 'continueOrderNotices', expectedAdminUid: session.uid, articleId, decisionId }, assertContext);
    if (response.ok !== true || response.articleId !== articleId || response.decisionId !== decisionId ||
        typeof response.noticesPending !== 'boolean' || typeof response.superseded !== 'boolean') throw new Error('La continuation des avis reste à vérifier.');
    return response;
  }
  static async readAdminReferences(uid: string, assertContext: () => void): Promise<AdminModerationReference[]> {
    const session = captureTradeSession(uid); assertContext();
    const raw = await AsyncStorage.getItem(historyKey(uid)); assertTradeSessionCurrent(session); assertContext();
    const values: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(values) || values.some(value => !record(value) || !id(value.articleId) || !digest(value.decisionId))) {
      throw new Error('Les références locales doivent être examinées. La recherche par annonce reste disponible.');
    }
    const references = new Map((values as AdminModerationReference[]).map(reference => [reference.articleId, reference]));
    // Discover an own pending tuple even if saving the former operator lookup failed.
    const prefix = `order-moderation:v1:${encodeURIComponent(uid)}:`;
    const keys = await AsyncStorage.getAllKeys(); assertTradeSessionCurrent(session); assertContext();
    for (const key of keys.filter(key => key.startsWith(prefix))) {
      const articleId = decodeURIComponent(key.slice(prefix.length));
      if (!id(articleId)) continue;
      const pending = await this.readOrderAttempt(uid, articleId, assertContext); assertTradeSessionCurrent(session); assertContext();
      if (pending) references.set(articleId, {articleId, decisionId: pending.payload.expectedArticleDecisionId});
    }
    return [...references.values()];
  }
  static async rememberAdminReference(uid: string, reference: AdminModerationReference, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(uid); assertContext();
    const key = historyKey(uid), pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertTradeSessionCurrent(session); assertContext();
      const saved = await this.readAdminReferences(uid, assertContext);
      assertTradeSessionCurrent(session); assertContext();
      await AsyncStorage.setItem(key, JSON.stringify([reference, ...saved.filter(item => item.articleId !== reference.articleId)]));
      assertTradeSessionCurrent(session); assertContext();
    });
    queues.set(key, pending);
    try { await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
  }
  static async previewOrderContinuation(uid: string, transactionId: string, assertContext: () => void): Promise<OrderContinuationPreview> {
    await assertOrderRecentSession(uid, assertContext);
    const value = await call<unknown, unknown>(uid, 'getPendingReports', {operation: 'previewOrderModerationContinuation', capability: 'order_moderation_continuation_v1',
      expectedUid: uid, expectedAdminUid: uid, transactionId}, assertContext);
    if (!record(value) || !exactKeys(value, ['protocol', 'ownerId', 'transactionId', 'articleId', 'expectedOrderRevision', 'expectedArticleDecisionId', 'source',
        'evidenceReferences', 'coverage', 'canContinue', 'humanCompetenceVerified', 'expertiseVerified', 'legalAuthorityVerified']) ||
        value.protocol !== 'order_moderation_continuation_preview_v1' || value.ownerId !== uid || value.transactionId !== transactionId || !id(value.articleId) ||
        !digest(value.expectedOrderRevision) || !(value.expectedArticleDecisionId === null || digest(value.expectedArticleDecisionId)) ||
        !(value.source === null || continuationProof(value.source)) || !Array.isArray(value.evidenceReferences) || value.evidenceReferences.length > 100 ||
        !value.evidenceReferences.every(ref => isProductReviewEvidenceReference(ref) && ref.state === 'received') ||
        new Set(value.evidenceReferences.map(ref => ref.id)).size !== value.evidenceReferences.length || typeof value.canContinue !== 'boolean' || !continuationLimits(value)) throw continuationUnknown();
    const coverage = value.coverage;
    if (coverage !== null && (!record(coverage) || !exactKeys(coverage, ['contributionsInspected', 'communicationsInspected', 'limitPerSource', 'contributionsHasMore',
        'communicationsHasMore', 'completeCurrentCaseSet', 'exhaustiveHistoryVerified', 'evidenceInspected', 'intentsInspected', 'evidenceHasMore', 'intentsHasMore', 'documentaryCompleteCurrentCaseSet']) ||
        coverage.limitPerSource !== 100 || coverage.exhaustiveHistoryVerified !== false ||
        ['contributionsInspected', 'communicationsInspected', 'evidenceInspected', 'intentsInspected'].some(k => typeof coverage[k] !== 'number' || !Number.isSafeInteger(coverage[k]) || coverage[k] < 0 || coverage[k] > 100) ||
        ['contributionsHasMore', 'communicationsHasMore', 'completeCurrentCaseSet', 'evidenceHasMore', 'intentsHasMore', 'documentaryCompleteCurrentCaseSet'].some(k => typeof coverage[k] !== 'boolean'))) throw continuationUnknown();
    if (value.canContinue && (!value.source || !value.expectedArticleDecisionId || !value.evidenceReferences.length || !record(coverage) ||
        coverage.completeCurrentCaseSet !== true || coverage.documentaryCompleteCurrentCaseSet !== true ||
        [coverage.contributionsHasMore, coverage.communicationsHasMore, coverage.evidenceHasMore, coverage.intentsHasMore].some(v => v !== false))) throw continuationUnknown();
    return value as unknown as OrderContinuationPreview;
  }
  static async readOrderAttempt(uid: string, articleId: string, assertContext: () => void): Promise<OrderModerationAttempt | null> {
    const session = captureTradeSession(uid); assertContext();
    const raw = await AsyncStorage.getItem(orderJournalKey(uid, articleId)); assertTradeSessionCurrent(session); assertContext();
    if (raw === null) return null;
    const saved: unknown = JSON.parse(raw);
    if (!record(saved) || saved.uid !== uid || saved.articleId !== articleId || !orderInput(saved.payload, uid) ||
        isOrderContinuationInput(saved.payload) && saved.payload.articleId !== articleId ||
        saved.refusal !== undefined && (!record(saved.refusal) || typeof saved.refusal.code !== 'string') ||
        isOrderContinuationInput(saved.payload) && saved.refusal !== undefined) throw continuationUnknown();
    if (saved.receipt !== undefined) await parseOrderReceipt(saved.receipt, uid, saved.payload, () => {assertTradeSessionCurrent(session); assertContext();});
    return saved as unknown as OrderModerationAttempt;
  }
  static async reviewOrder(uid: string, articleId: string, input: OrderModerationInput, assertContext: () => void,
    mode: 'execute' | 'observe' | 'neutralize' = 'observe'): Promise<OrderModerationReceipt> {
    const session = captureTradeSession(uid), key = orderJournalKey(uid, articleId);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertCurrent(); if (!orderInput(input, uid) || isOrderContinuationInput(input) && input.articleId !== articleId) throw continuationUnknown();
      const previous = await this.readOrderAttempt(uid, articleId, assertCurrent);
      if (previous && !sameOrderModerationInput(previous.payload, input) || !previous && mode !== 'execute' ||
          !isOrderContinuationInput(input) && mode !== 'observe') throw continuationUnknown();
      const saved: OrderModerationAttempt = previous ?? {uid, articleId, payload: JSON.parse(JSON.stringify(input)) as OrderModerationInput};
      if (!previous) {await AsyncStorage.setItem(key, JSON.stringify(saved)); assertCurrent();}
      const invoke = async (operationMode: 'execute' | 'neutralize') => {
        assertCurrent();
        const response = await call<unknown, unknown>(uid, 'triageReport', {...saved.payload, articleId, mode: operationMode}, assertCurrent);
        return parseOrderReceipt(response, uid, saved.payload, assertCurrent);
      };
      // This read-only endpoint also fails closed against an older server;
      // never fall back to triageReport to observe an original legacy tuple.
      const observed = await call<unknown, unknown>(uid, 'getPendingReports', {operation: 'readOrderModerationReceipt',
        expectedUid: uid, expectedAdminUid: uid, articleId, command: saved.payload}, assertCurrent);
      let receipt = await parseOrderReceipt(observed, uid, saved.payload, assertCurrent); assertCurrent();
      if ('protocol' in receipt && receipt.state === 'absent' && mode !== 'observe') {
        if (mode === 'execute') await assertOrderRecentSession(uid, assertCurrent);
        assertCurrent(); receipt = await invoke(mode); assertCurrent();
      }
      const current = await this.readOrderAttempt(uid, articleId, assertCurrent);
      if (!current || !sameOrderModerationInput(current.payload, saved.payload)) throw continuationUnknown();
      await AsyncStorage.setItem(key, JSON.stringify({...current, receipt})); assertCurrent();
      return receipt;
    });
    queues.set(key, pending);
    try {return await pending;} finally {if (queues.get(key) === pending) queues.delete(key);}
  }
  static async acknowledgeOrderAttempt(uid: string, articleId: string, requestId: string, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(uid), key = orderJournalKey(uid, articleId);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertCurrent(); const saved = await this.readOrderAttempt(uid, articleId, assertCurrent);
      if (!saved || saved.payload.requestId !== requestId) throw continuationUnknown();
      const value = await call<unknown, unknown>(uid, 'getPendingReports', {operation: 'readOrderModerationReceipt',
        expectedUid: uid, expectedAdminUid: uid, articleId, command: saved.payload}, assertCurrent);
      const receipt = await parseOrderReceipt(value, uid, saved.payload, assertCurrent); assertCurrent();
      if ('protocol' in receipt && receipt.state === 'absent') throw continuationUnknown();
      const current = await this.readOrderAttempt(uid, articleId, assertCurrent);
      if (!current || !sameOrderModerationInput(current.payload, saved.payload)) throw continuationUnknown();
      await AsyncStorage.removeItem(key); assertCurrent();
    });
    queues.set(key, pending);
    try {await pending;} finally {if (queues.get(key) === pending) queues.delete(key);}
  }
  static async getReports(uid: string, assertContext: () => void, messageEvidence = false): Promise<AdminReportsResponse> {
    const response = await call<unknown, AdminReportsResponse>(uid, 'getPendingReports', messageEvidence ? {capability: 'message_report_v1', expectedUid: uid} : {}, assertContext);
    if (response.ok !== true || !Array.isArray(response.reports) || response.reports.some(report => !id(report.id) || !digest(report.revision) ||
      (report.articleReview && (!digest(report.articleReview.revision) || report.articleReview.articleId !== report.targetId)) ||
      (messageEvidence && (report.targetType === 'message' ? !isMessageReportSummary(report.messageEvidence, report.id) : report.messageEvidence !== null)))) throw new Error('Les dossiers doivent être relus avant une décision.');
    return response;
  }
  static async triage(uid: string, input: TriageReportInput, assertContext: () => void): Promise<TriageReportResponse> {
    const response = await call<TriageReportInput, TriageReportResponse>(uid, 'triageReport', input, assertContext);
    if (response.ok !== true || response.reportId !== input.reportId || typeof response.replay !== 'boolean' || typeof response.superseded !== 'boolean' ||
      typeof response.currentStatus !== 'string' || (input.articleDecision && !digest(response.decisionId))) throw new Error('La réponse de la décision reste à vérifier.');
    return response;
  }
  static async readDecision(uid: string, articleId: string, assertContext: () => void): Promise<OwnerDecisionResponse> {
    const response = await call<{ operation: 'readArticleDecision'; articleId: string }, unknown>(uid, 'submitReport', { operation: 'readArticleDecision', articleId }, assertContext);
    if (!record(response) || response.ok !== true || response.articleId !== articleId || !(response.decision === null || decision(response.decision))) throw new Error('La décision privée doit être vérifiée.');
    return response as unknown as OwnerDecisionResponse;
  }
  /** Reference-only owner listing includes inactive articles without changing commercial lists. */
  static async listOwnerArticles(uid: string, cursor: string | null, assertContext: () => void): Promise<OwnerModerationArticlePage> {
    const session = captureTradeSession(uid); assertContext();
    const snap = await getDocsFromServer(query(collection(firestore, 'articles'), where('sellerId', '==', uid), orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []), limit(21)));
    assertTradeSessionCurrent(session); assertContext();
    const docs = snap.docs.slice(0, 20);
    return { items: docs.map(doc => {
      const data = doc.data();
      if (data.sellerId !== uid) throw new Error('Cette référence ne vous appartient pas.');
      return { id: doc.id, title: typeof data.title === 'string' ? data.title : 'Article sans titre connu', isActive: data.isActive === true,
        moderationStatus: typeof data.moderationStatus === 'string' ? data.moderationStatus : null,
        moderationSource: typeof data.moderationSource === 'string' ? data.moderationSource : null };
    }), cursor: docs.at(-1)?.id ?? null, hasMore: snap.docs.length > 20 };
  }
  static async readAttempt(uid: string, articleId: string, assertContext: () => void): Promise<ArticleAppealAttempt | null> {
    const session = captureTradeSession(uid); assertContext();
    const raw = await AsyncStorage.getItem(journalKey(uid, articleId));
    assertTradeSessionCurrent(session); assertContext();
    if (raw === null) return null;
    const saved: unknown = JSON.parse(raw);
    if (!validAttempt(saved, uid, articleId)) throw new Error('La contestation conservée doit être examinée avant un nouvel envoi.');
    return saved;
  }
  static async contest(uid: string, input: ArticleAppealInput, assertContext: () => void, recoveryOnly = false): Promise<ArticleAppealResponse> {
    const session = captureTradeSession(uid), key = journalKey(uid, input.articleId);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertCurrent();
      if (!appealInput(input)) throw new Error('Indiquez un motif de contestation de 2 000 caractères maximum.');
      const old = await this.readAttempt(uid, input.articleId, assertCurrent);
      if (old && !samePayload(old.payload, input)) throw new Error('Vérifiez la contestation précédente avant un nouvel envoi.');
      if (!old && recoveryOnly) throw new Error('Aucune contestation précédente à vérifier.');
      const saved: ArticleAppealAttempt = old ?? { uid, articleId: input.articleId, payload: { ...input } };
      await AsyncStorage.setItem(key, JSON.stringify(saved)); assertCurrent();
      try {
        const response = await httpsCallable<ArticleAppealInput, unknown>(functions, 'submitReport')(saved.payload);
        if (!appealReceipt(response.data, input.articleId) || (saved.receipt && saved.receipt.appealId !== response.data.appealId)) throw new Error('La réception de la contestation reste à vérifier.');
        // Keep proof even if this screen/session stopped awaiting the reply.
        await AsyncStorage.setItem(key, JSON.stringify({ ...saved, receipt: response.data })); assertCurrent();
        return response.data;
      } catch (error) {
        if (!old && !saved.receipt && (isDefinitiveTradeRefusal(error) || getCallableErrorCode(error) === 'aborted')) {
          assertCurrent(); await AsyncStorage.removeItem(key);
        }
        if (old) throw Object.assign(new Error('La contestation précédente reste à vérifier. Sa référence et son motif sont conservés ; cette erreur ne confirme pas sa non-exécution.'), {
          cause: error, tradeRecovery: true,
          ...(record(error) && typeof error.code === 'string' ? {code: error.code} : {}),
          ...(record(error) && record(error.details) ? {details: error.details} : {}),
        });
        throw error;
      }
    });
    queues.set(key, pending);
    try { return await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
  }
  static async acknowledge(uid: string, articleId: string, requestId: string, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(uid), key = journalKey(uid, articleId);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    const pending = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      assertCurrent();
      const saved = await this.readAttempt(uid, articleId, assertCurrent);
      if (!saved?.receipt || saved.payload.requestId !== requestId) throw new Error('La réception doit être confirmée avant un nouvel envoi.');
      assertCurrent(); await AsyncStorage.removeItem(key); assertCurrent();
    });
    queues.set(key, pending);
    try { await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
  }
}
