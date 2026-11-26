/**
 * Shop & Report Moderation — admin-only callables (B2 / B3).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The client UI used to mutate a shop's validation `status` and a report's
 * moderation lifecycle directly via the Web SDK. firestore.rules (B1/B2/B3)
 * correctly LOCK those fields: a shop's `status`/`verificationDetails` and a
 * report's `status`/`reviewedBy`/`reviewedAt`/`resolution` are admin-owned and
 * the client write is rejected for a non-owner admin (and for the owner too).
 * So those mutations MUST go through Cloud Functions (Admin SDK bypasses rules)
 * with a server-side admin guard.
 *
 * B2 — approveShop / rejectShop / suspendShop:
 *   Mutate the shop validation status under runTransaction. Atomic read→check→
 *   write so two admins acting concurrently can't stomp each other and we never
 *   re-stamp `verificationDetails` from stale data.
 *
 * B3 — triageReport:
 *   The `reports` collection had no server-side processing. This callable lets
 *   an admin set a report's moderation outcome (reviewed/resolved/dismissed)
 *   and stamps `reviewedBy` / `reviewedAt` / `resolution`. getPendingReports
 *   lists open reports (needs the reports(status, createdAt) composite index
 *   added to firestore.indexes.json).
 *
 * All callables: v2, region northamerica-northeast1, memory 512MiB, structured
 * logging via firebase-functions/logger, never write `undefined` to Firestore.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { db, auth, FieldValue } from '../config/firebase';
import { prepareOperationalNotices, readOperationalNoticeReceipt, type OperationalNoticeInput } from '../utils/notifications';
import { readOrderModeration, prepareOrderModerationNotices, ensureOrderModerationNotices,
  orderHasPaymentEvidence, ORDER_CONTINUATION_CAPABILITY, ORDER_CONTINUATION_LIMITS, parseOrderContinuationProof,
  readOrderContinuationSource, orderContinuationSelectionMatches, orderContinuationCaptureMatches } from '../utils/orderModeration';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { assertNoLiveArticleTransaction } from './products';
import { articlePrivacyWithdrawn } from '../utils/publicProfile';
import { readEligibilityEvidence, assertRecentAccountAuthentication, assertAccountSecurityOpen } from '../utils/eligibility';
import { assertOwnTradingEligibility, assertArticleChildSafetyAdmitted } from '../utils/tradeAdmission';
import { assertArticleHygieneAdmitted } from '../utils/articleHygiene';
import { previewProductReviewContribution, commandProductReviewContribution, readProductReviewContributions } from '../utils/productReviewContributions';
import { previewProductReviewWorkflow, commandProductReviewWorkflow, readProductReviewCommunications, parseProductReviewEvidenceReference } from '../utils/productReviewWorkflow';
import { previewProductReviewEvidence, commandProductReviewEvidence, readProductReviewEvidence, readProductReviewEvidenceFile } from '../utils/productReviewEvidence';
import { previewProductReviewAdmission, commandProductReviewAdmission, readProductReviewAdmissionDecisions } from '../utils/productReviewAdmission';
import { previewProductPhysicalInstruction, commandProductPhysicalInstruction, readProductPhysicalInstructions } from '../utils/productPhysicalInstruction';
import {PRODUCT_MATERIAL_REVIEW_ENABLED} from '../utils/productReviewMaterial';
import {productParcelRequested, assertProductParcelNewOpen} from '../utils/productReviewParcel';
import {previewProductCommercialReturn, commandProductCommercialReturn, readProductCommercialReturnInstructions} from '../utils/productCommercialReturn';
import {previewProductRoutingReview, commandProductRoutingReview, readProductRoutingDecisions} from '../utils/productRoutingReview';
import {previewProductMixedOrders, commandProductMixedOrders, readProductMixedOrderHistory} from '../utils/productMixedOrders';
import { assertReportActor, previewArticleReport, observeArticleReport, articleReportTuple, verifyArticleReportSources,
  prepareArticleReportCapture, preserveReportEvidence, reportEvidenceReceipt, adminReportEvidenceProjection,
  readReportPrivateImage, reportEvidenceId, findArticleReportIntent, createArticleReportEvidenceAnchor,
  readArticleReportNonexecution, assertArticleReportOutcomeTuple, neutralizeArticleReport } from '../utils/reportEvidence';

import {MESSAGE_REPORT_OPERATIONS, handleMessageReport, readAdminMessageReport, messageReportProjection} from '../utils/messageReportEvidence';
import {CONTENT_MODERATION_OPERATIONS, handleContentModeration} from '../utils/contentModeration';
import {supportUid, supportCurrentAdminSession, supportAdmin, supportObject, supportHash, supportSourceHash} from '../utils/supportRequest';
import {checkRateLimit} from '../utils/rateLimit';
import {assertPrivateAccountSession, withPrivateAccountSession} from '../utils/privateAccountSession';
import {withDocumentaryProjection} from '../utils/documentaryProjection';

const REGION = 'northamerica-northeast1';

/** Local exposure remains closed until the native readers and notice router
 * are frozen together. This does not change payment/shipping feature flags. */
const PRODUCT_REVIEW_DISPATCH_ENABLED: boolean = true;
const PRODUCT_REVIEW_OPERATIONS = new Set(['productReviewPreview', 'productReviewContribution', 'readProductReviewContributions',
  'productReviewWorkflowPreview', 'productReviewWorkflowCommand', 'readProductReviewCommunications',
  'productReviewEvidencePreview', 'productReviewEvidenceCommand', 'readProductReviewEvidence', 'readProductReviewEvidenceFile',
  'productReviewAdmissionPreview', 'productReviewAdmissionCommand', 'readProductReviewAdmissionDecisions',
  'productPhysicalPreview', 'productPhysicalCommand', 'readProductPhysicalInstructions', 'productCommercialReturnPreview', 'productCommercialReturnCommand', 'readProductCommercialReturnInstructions']);
const PRODUCT_EVIDENCE_OPERATIONS = new Set(['productReviewEvidencePreview', 'productReviewEvidenceCommand', 'readProductReviewEvidence', 'readProductReviewEvidenceFile']);
const PRODUCT_ADMISSION_OPERATIONS = new Set(['productReviewAdmissionPreview', 'productReviewAdmissionCommand', 'readProductReviewAdmissionDecisions']);
const PRODUCT_PHYSICAL_OPERATIONS = new Set(['productPhysicalPreview', 'productPhysicalCommand', 'readProductPhysicalInstructions']);
const PRODUCT_MATERIAL_JOURNAL_OPERATIONS = new Set(['productReviewContribution', 'productReviewWorkflowCommand',
  'productReviewEvidenceCommand', 'productPhysicalCommand', 'productCommercialReturnCommand']);
async function dispatchProductReview(request: any, endpoint: 'submitReport' | 'triageReport') {
  const payload = request.data ?? {};
  if (payload.operation === 'productMixedOrdersPreview' || payload.operation === 'readProductMixedOrderHistory') {
    if (endpoint !== 'submitReport') throw new HttpsError('permission-denied', 'Endpoint de lecture du mélange incompatible.');
    return {handled: true as const, value: payload.operation === 'productMixedOrdersPreview'
      ? await previewProductMixedOrders(request) : await readProductMixedOrderHistory(request)};
  }
  if (payload.operation === 'productMixedOrdersCommand') {
    if (endpoint !== 'triageReport') throw new HttpsError('permission-denied', 'Endpoint de décision du mélange incompatible.');
    return {handled: true as const, value: await commandProductMixedOrders(request)};
  }
  if (payload.operation === 'productRoutingPreview' || payload.operation === 'readProductRoutingDecisions') {
    if (endpoint !== 'submitReport') throw new HttpsError('permission-denied', 'Endpoint de lecture du routage incompatible.');
    return {handled: true as const, value: payload.operation === 'productRoutingPreview'
      ? await previewProductRoutingReview(request) : await readProductRoutingDecisions(request)};
  }
  if (payload.operation === 'productRoutingCommand') {
    if (endpoint !== 'triageReport') throw new HttpsError('permission-denied', 'Endpoint de décision du routage incompatible.');
    return {handled: true as const, value: await commandProductRoutingReview(request)};
  }
  if (!PRODUCT_REVIEW_OPERATIONS.has(payload.operation)) return {handled: false as const};
  const capability = PRODUCT_PHYSICAL_OPERATIONS.has(payload.operation) ? 'product_review_physical_v1' : PRODUCT_EVIDENCE_OPERATIONS.has(payload.operation) ? 'product_review_evidence_v1' :
    PRODUCT_ADMISSION_OPERATIONS.has(payload.operation) ? 'product_review_admission_v1' : 'product_review_v1';
  if (payload.capability !== capability) throw new HttpsError('invalid-argument', 'Version explicite de l’examen de l’article requise.');
  const material = payload.materialCapability !== undefined || payload.command?.materialStatement !== undefined;
  const parcel = productParcelRequested(payload);
  if (payload.command?.parcelStatement !== undefined && !parcel || payload.command?.parcelAssessment !== undefined && !parcel ||
      parcel && PRODUCT_ADMISSION_OPERATIONS.has(payload.operation)) throw new HttpsError('invalid-argument', 'Capacité et contexte colis explicites requis.');
  if (!PRODUCT_MATERIAL_JOURNAL_OPERATIONS.has(payload.operation)) assertProductParcelNewOpen(parcel);
  if (material && (payload.materialCapability !== 'product_review_material_v1' ||
      !['productReviewPreview', 'productReviewContribution', 'readProductReviewContributions', 'productReviewWorkflowPreview', 'productReviewWorkflowCommand',
        'readProductReviewCommunications', 'productReviewEvidencePreview', 'productReviewEvidenceCommand', 'readProductReviewEvidence', 'readProductReviewEvidenceFile',
        'productCommercialReturnPreview', 'productCommercialReturnCommand', 'readProductCommercialReturnInstructions',
        'productPhysicalPreview', 'productPhysicalCommand', 'readProductPhysicalInstructions'].includes(payload.operation)))
    throw new HttpsError('invalid-argument', 'Version et opération explicites de comparaison matérielle requises.');
  // Journal helpers serve their exact native receipts/observe/neutralize FIRST,
  // then enforce the same stage before a NEW source, authority or IO.
  if (material && !PRODUCT_MATERIAL_REVIEW_ENABLED && !PRODUCT_MATERIAL_JOURNAL_OPERATIONS.has(payload.operation)) throw new HttpsError('failed-precondition', 'Le parcours de comparaison matérielle est en préparation.',
    {reason: 'product_material_review_not_exposed', capability: 'product_review_material_v1'});
  const context = payload.context ?? payload.command?.context;
  if (context?.kind === 'article_listing' && payload.listingCapability !== 'product_review_article_listing_v1' ||
      payload.listingCapability != null && payload.listingCapability !== 'product_review_article_listing_v1')
    throw new HttpsError('invalid-argument', 'Version explicite du contexte de prépublication requise.');
  if (payload.expectedUid !== request.auth.uid) throw new HttpsError('permission-denied', 'La session du dossier a changé.');
  if (!PRODUCT_REVIEW_DISPATCH_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours d’examen de l’article est en préparation.',
    {reason: 'product_review_not_exposed', capability});
  const own = endpoint === 'submitReport';
  if (['readProductReviewContributions', 'productReviewWorkflowPreview', 'readProductReviewCommunications', 'readProductReviewEvidence', 'readProductReviewEvidenceFile',
    'productReviewAdmissionPreview', 'readProductReviewAdmissionDecisions', 'productPhysicalPreview', 'readProductPhysicalInstructions', 'productCommercialReturnPreview', 'readProductCommercialReturnInstructions'].includes(payload.operation) &&
      payload.scope !== (own ? 'own' : 'admin')) throw new HttpsError('permission-denied', 'Portée de lecteur incompatible avec cet endpoint.');
  if (!own && ['productReviewPreview', 'productReviewContribution', 'productReviewEvidencePreview', 'productReviewEvidenceCommand'].includes(payload.operation))
    throw new HttpsError('invalid-argument', 'Une contribution appartient à son acteur SDK natif.');
  if (own && payload.operation === 'productReviewAdmissionCommand')
    throw new HttpsError('permission-denied', 'Une décision d’admission appartient à son opérateur natif.');
  if (own && payload.operation === 'productPhysicalCommand') throw new HttpsError('permission-denied', 'Une instruction de transport appartient à son opérateur natif.');
  if (payload.operation.startsWith('productCommercialReturn') || payload.operation === 'readProductCommercialReturnInstructions') {
    if (payload.materialCapability !== 'product_review_material_v1') throw new HttpsError('invalid-argument', 'Version commerciale matérielle requise.');
    if (own && payload.operation === 'productCommercialReturnCommand') throw new HttpsError('permission-denied', 'Une instruction commerciale appartient à son opérateur natif.');
  }
  if (payload.operation === 'productReviewWorkflowCommand' &&
      !(own ? ['respond', 'contest'] : ['ask_details', 'communicate_summary', 'issue_outcome']).includes(payload.command?.kind))
    throw new HttpsError('invalid-argument', 'Action d’examen incompatible avec cet endpoint.');
  // The transport capability is not part of the immutable business tuple.
  // Keep all other fields: each helper rejects extras and qualifies its actor.
  const {capability: _transportCapability, listingCapability: _listingCapability, ...data} = payload;
  const nativeRequest = {...request, data};
  let value;
  switch (payload.operation) {
    case 'productCommercialReturnPreview': value = await previewProductCommercialReturn(nativeRequest); break;
    case 'productCommercialReturnCommand': value = await commandProductCommercialReturn(nativeRequest); break;
    case 'readProductCommercialReturnInstructions': value = await readProductCommercialReturnInstructions(nativeRequest); break;
    case 'productReviewPreview': value = await previewProductReviewContribution(nativeRequest); break;
    case 'productReviewContribution': value = await commandProductReviewContribution(nativeRequest); break;
    case 'readProductReviewContributions': value = await readProductReviewContributions(nativeRequest); break;
    case 'productReviewWorkflowPreview': value = await previewProductReviewWorkflow(nativeRequest); break;
    case 'productReviewWorkflowCommand': value = await commandProductReviewWorkflow(nativeRequest); break;
    case 'readProductReviewCommunications': value = await readProductReviewCommunications(nativeRequest); break;
    case 'productReviewEvidencePreview': value = await previewProductReviewEvidence(nativeRequest); break;
    case 'productReviewEvidenceCommand': value = await commandProductReviewEvidence(nativeRequest); break;
    case 'readProductReviewEvidence': value = await readProductReviewEvidence(nativeRequest); break;
    case 'readProductReviewEvidenceFile': value = await readProductReviewEvidenceFile(nativeRequest); break;
    case 'productReviewAdmissionPreview': value = await previewProductReviewAdmission(nativeRequest); break;
    case 'productReviewAdmissionCommand': value = await commandProductReviewAdmission(nativeRequest); break;
    case 'readProductReviewAdmissionDecisions': value = await readProductReviewAdmissionDecisions(nativeRequest); break;
    case 'productPhysicalPreview': value = await previewProductPhysicalInstruction(nativeRequest); break;
    case 'productPhysicalCommand': value = await commandProductPhysicalInstruction(nativeRequest); break;
    case 'readProductPhysicalInstructions': value = await readProductPhysicalInstructions(nativeRequest); break;
    default: throw new HttpsError('invalid-argument', 'Opération d’examen inconnue.');
  }
  return {handled: true as const, value};
}

type ShopStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';

type ReportTargetType = 'user' | 'article' | 'message' | 'review';

const REPORT_TARGET_TYPES: ReadonlySet<ReportTargetType> = new Set([
  'user',
  'article',
  'message',
  'review',
]);

const REPORT_OUTCOMES: ReadonlySet<ReportStatus> = new Set([
  'reviewed',
  'resolved',
  'dismissed',
]);

/** Article decisions use current Auth claims and recheck the fallback in the
 * same transaction that writes the decision. A stale client claim is no grant. */
async function currentAdminClaim(uid: string): Promise<boolean> {
  const user = await auth.getUser(uid);
  if (user.disabled) throw new HttpsError('permission-denied', 'Compte administratif indisponible.');
  return user.customClaims?.admin === true;
}
async function recheckReportAdmin(tx: FirebaseFirestore.Transaction, uid: string, claim: boolean) {
  const user = (await tx.get(db.collection('users').doc(uid))).data();
  if (user?.isActive === false || (!claim && user?.isAdmin !== true)) {
    throw new HttpsError('permission-denied', 'Admin privileges required');
  }
}
/** A private report read needs a current session and current role. Keep this
 * separate from exact-own receipt recovery, which does not require a role. */
async function assertPendingReportReader(request: any, tx?: FirebaseFirestore.Transaction): Promise<void> {
  if (!tx) return db.runTransaction(current => assertPendingReportReader(request, current));
  const session = await assertPrivateAccountSession(request, tx);
  await supportAdmin(tx, session.uid, session.currentAdminClaim);
}
function documentRevision(snap: FirebaseFirestore.DocumentSnapshot): string {
  const time = snap.updateTime;
  if (!time) throw new HttpsError('failed-precondition', 'Cette source doit être relue.');
  return createHash('sha256').update(JSON.stringify([snap.id, time.seconds, time.nanoseconds])).digest('hex');
}
function safeId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('/')
      || value === '.' || value === '..' || /^__[\s\S]*__$/.test(value)
      || Buffer.byteLength(value, 'utf8') > 1500) {
    throw new HttpsError('invalid-argument', `${field} invalide.`);
  }
  return value;
}
const decisionDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function isoDate(value: any): string | null {
  return typeof value?.toDate === 'function' ? value.toDate().toISOString() : null;
}

type FavorableInput = { articleId: string; reportId: string; expectedOwnerId: string; expectedDecisionId: string;
  expectedModerationDecisionId: string; expectedArticleRevision: string; expectedReportRevision: string;
  expectedModerationRevision: string; expectedAppealId: string | null; expectedAppealRevision: string | null;
  requestId: string; action: 'approve'; ownerMessage: string; authorityNote: string; evidenceReferences: string[] };
const hashValue = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function favorableInput(raw: Record<string, unknown>): FavorableInput {
  if (raw.action !== 'approve' || !['confirm', 'observe', 'neutralize'].includes(raw.mode as string) ||
      typeof raw.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(raw.requestId) ||
      ![raw.expectedDecisionId, raw.expectedModerationDecisionId, raw.expectedArticleRevision,
        raw.expectedReportRevision, raw.expectedModerationRevision].every(hashValue) ||
      !(raw.expectedAppealId === null && raw.expectedAppealRevision === null ||
        typeof raw.expectedAppealId === 'string' && hashValue(raw.expectedAppealRevision)) ||
      typeof raw.ownerMessage !== 'string' || !raw.ownerMessage.trim() || raw.ownerMessage.trim().length > 2000 ||
      typeof raw.authorityNote !== 'string' || !raw.authorityNote.trim() || raw.authorityNote.trim().length > 2000 ||
      !Array.isArray(raw.evidenceReferences) || raw.evidenceReferences.length < 1 || raw.evidenceReferences.length > 10 ||
      raw.evidenceReferences.some(ref => typeof ref !== 'string' || !ref.trim() || ref.trim().length > 500))
    throw new HttpsError('invalid-argument', 'Décision favorable, sources, motif humain et références de preuve requis.');
  return { articleId: safeId(raw.articleId, 'Annonce'), reportId: safeId(raw.reportId, 'Signalement'),
    expectedOwnerId: safeId(raw.expectedOwnerId, 'Propriétaire'), expectedDecisionId: raw.expectedDecisionId as string,
    expectedModerationDecisionId: raw.expectedModerationDecisionId as string,
    expectedArticleRevision: raw.expectedArticleRevision as string, expectedReportRevision: raw.expectedReportRevision as string,
    expectedModerationRevision: raw.expectedModerationRevision as string,
    expectedAppealId: raw.expectedAppealId === null ? null : safeId(raw.expectedAppealId, 'Contestation'),
    expectedAppealRevision: raw.expectedAppealRevision as string | null, requestId: raw.requestId,
    action: 'approve', ownerMessage: raw.ownerMessage.trim(), authorityNote: raw.authorityNote.trim(),
    evidenceReferences: raw.evidenceReferences.map(ref => (ref as string).trim()) };
}
function nativeRestriction(proof: FirebaseFirestore.DocumentData | undefined, articleId: string, ownerId: string, decisionId: string) {
  return !!proof && proof.schemaVersion === 1 && proof.source === 'operator_report_review' && proof.articleId === articleId &&
    proof.ownerId === ownerId && hashValue(decisionId) && proof.decisionId === decisionId && ['hold', 'reject'].includes(proof.action) &&
    proof.moderationStatus === (proof.action === 'hold' ? 'pending' : 'rejected') && proof.decidedAt instanceof Timestamp &&
    hashValue(proof.observedArticleRevision) && hashValue(proof.observedReportRevision) && proof.legacyPointerPreserved !== true &&
    typeof proof.decidedBy === 'string' && !!proof.decidedBy;
}
async function favorableSources(tx: FirebaseFirestore.Transaction, articleId: string, reportId: string, targetDecisionId?: string) {
  const articleRef = db.collection('articles').doc(articleId), reportRef = db.collection('reports').doc(reportId),
    moderationRef = db.collection('article_moderation').doc(articleId);
  const [articleSnap, reportSnap, moderationSnap] = await tx.getAll(articleRef, reportRef, moderationRef);
  const article = articleSnap.data(), report = reportSnap.data(), current = moderationSnap.data();
  if (!article || !report || report.targetType !== 'article' || report.targetId !== articleId ||
      !current || current.articleId !== articleId || current.ownerId !== article.sellerId || !hashValue(current.decisionId))
    throw new HttpsError('failed-precondition', 'La provenance de ce dossier doit être rapprochée.');
  const decisionId = targetDecisionId ?? (hashValue(report.articleDecision?.liftedDecisionId)
    ? report.articleDecision.liftedDecisionId : report.articleDecision?.decisionId);
  if (!hashValue(decisionId)) throw new HttpsError('failed-precondition', 'La restriction examinée doit être identifiée.');
  const restrictiveSnap = await tx.get(moderationRef.collection('decisions').doc(decisionId));
  const restriction = restrictiveSnap.data() ?? (current.decisionId === decisionId ? current : undefined);
  if (!restriction || !['hold', 'reject'].includes(restriction.action) || restriction.articleId !== articleId ||
      restriction.ownerId !== article.sellerId || restriction.reportId !== reportId || restriction.decisionId !== decisionId)
    throw new HttpsError('failed-precondition', 'Cette référence ne désigne pas la restriction de ce signalement.');
  const candidate = current.appealStatus === 'pending' && (current.appealReportId ?? current.reportId) === reportId ? current.appealId
    : report.ownerAppeal?.decisionId === decisionId && report.ownerAppeal?.status !== 'reviewed' ? report.ownerAppeal.appealId : null;
  const appealRef = candidate ? moderationRef.collection('appeals').doc(safeId(candidate, 'Contestation')) : null;
  const appealSnap = appealRef ? await tx.get(appealRef) : null, appeal = appealSnap?.data() ?? null;
  if (appealRef && (!appeal || appeal.articleId !== articleId || appeal.ownerId !== article.sellerId ||
      ![decisionId, current.decisionId, current.appealDecisionId].includes(appeal.decisionId)))
    throw new HttpsError('failed-precondition', 'La contestation liée doit être rapprochée.');
  return { articleRef, reportRef, moderationRef, articleSnap, reportSnap, moderationSnap, restrictiveSnap, article, report, current,
    restriction, decisionId, appealRef, appealSnap, appeal,
    restrictionQualified: restrictiveSnap.exists && nativeRestriction(restriction, articleId, article.sellerId, decisionId) };
}
async function readFavorableArticleSource(request: any, raw: Record<string, unknown>) {
  const uid = request.auth.uid;
  if (raw.expectedAdminUid !== uid) throw new HttpsError('permission-denied', 'Le compte administratif a changé.');
  const articleId = safeId(raw.articleId, 'Annonce'), reportId = safeId(raw.reportId, 'Signalement');
  return db.runTransaction(async tx => {
    await assertPendingReportReader(request, tx);
    const s = await favorableSources(tx, articleId, reportId);
    return { protocol: 'article_moderation_review_v1', actorUid: uid, articleId, reportId, expectedOwnerId: s.article.sellerId,
      expectedDecisionId: s.decisionId, expectedModerationDecisionId: s.current.decisionId,
      expectedArticleRevision: documentRevision(s.articleSnap), expectedReportRevision: documentRevision(s.reportSnap),
      expectedModerationRevision: documentRevision(s.moderationSnap), expectedAppealId: s.appealRef?.id ?? null,
      expectedAppealRevision: s.appealSnap ? documentRevision(s.appealSnap) : null,
      restrictionEvidenceQualified: s.restrictionQualified, restriction: { action: s.restriction.action,
        ownerMessage: s.restriction.ownerMessage ?? null, evidenceReferences: s.restriction.evidenceReferences ?? [],
        decidedAt: isoDate(s.restriction.decidedAt) }, appeal: s.appeal ? { id: s.appealRef!.id, status: s.appeal.status,
        reason: s.appeal.reason ?? null, receivedAt: isoDate(s.appeal.receivedAt) } : null,
      listingReactivated: false, availabilityPermissionGranted: false };
  });
}
async function favorableArticleReview(request: any, raw: Record<string, unknown>) {
  const uid: string = request.auth.uid;
  const input = favorableInput(raw), decisionId = decisionDigest([uid, input.articleId, input.requestId]),
    payloadHash = decisionDigest([uid, Object.fromEntries(Object.keys(input).sort().map(key => [key, input[key as keyof FavorableInput]]))]),
    moderationRef = db.collection('article_moderation').doc(input.articleId),
    receiptRef = moderationRef.collection('decisions').doc(decisionId);
  const ownerNotice = (reactivated: boolean): OperationalNoticeInput => ({ userId: input.expectedOwnerId,
    eventKey: `article_moderation_favorable:${input.articleId}:${decisionId}`, type: 'article_moderation',
    title: 'Décision favorable enregistrée', message: `${input.ownerMessage}\n\n${reactivated
      ? 'La remise en visibilité a été enregistrée. Les commandes et leurs obligations restent distinctes.'
      : 'La décision favorable est enregistrée ; la remise en visibilité reste bloquée. Consultez le dossier pour les motifs et les recours.'}`,
    data: { ownerId: input.expectedOwnerId, articleId: input.articleId, decisionId, favorableRecorded: 'true', listingReactivated: reactivated ? 'true' : 'false',
      deepLink: `https://seconde.ca/article/moderation/${encodeURIComponent(input.articleId)}` } });
  const receipt = async (tx: FirebaseFirestore.Transaction, prior: FirebaseFirestore.DocumentData,
    current: FirebaseFirestore.DocumentData | undefined, replay: boolean) => {
    if (prior.protocol !== 'article_moderation_favorable_v1' || prior.schemaVersion !== 1 || prior.decisionId !== decisionId ||
        prior.actorUid !== uid || prior.requestId !== input.requestId || prior.payloadHash !== payloadHash ||
        prior.articleId !== input.articleId || prior.reportId !== input.reportId || prior.ownerId !== input.expectedOwnerId ||
        !(prior.decidedAt instanceof Timestamp) || !['approved', 'not_executed'].includes(prior.outcome))
      throw new HttpsError('unavailable', 'Le reçu original de cette intention doit être rapproché.');
    const notice = prior.outcome === 'approved' ? await readOperationalNoticeReceipt(tx, ownerNotice(prior.listingReactivated === true)) : null;
    if (prior.outcome === 'approved' && (!notice || !Array.isArray(prior.notificationIds) ||
        prior.notificationIds.length !== 1 || prior.notificationIds[0] !== notice.notificationId))
      throw new HttpsError('unavailable', 'Le reçu de l’avis propriétaire doit être rapproché.');
    return { protocol: 'article_moderation_favorable_v1', actorUid: uid, articleId: input.articleId, reportId: input.reportId,
      ownerId: input.expectedOwnerId, requestId: input.requestId, decisionId, payloadHash, outcome: prior.outcome,
      favorableRecorded: prior.outcome === 'approved', decisionCommitted: prior.outcome === 'approved',
      intentionNeutralized: prior.outcome === 'not_executed', lateRequestBlocked: prior.outcome === 'not_executed',
      reason: prior.outcome === 'not_executed' ? prior.reason : null, sourceExamined: prior.outcome === 'approved',
      liftedDecisionId: prior.outcome === 'approved' ? prior.liftedDecisionId : null,
      reviewedAppealId: prior.outcome === 'approved' ? prior.reviewedAppealId : null,
      listingReactivated: prior.outcome === 'approved' && prior.listingReactivated === true,
      availabilityPermissionGranted: false, availabilityBlockers: prior.outcome === 'approved' ? prior.availabilityBlockers : [],
      remainingRestrictionDecisionIds: prior.outcome === 'approved' ? prior.remainingRestrictionDecisionIds : [],
      ownerMessage: input.ownerMessage, decidedAt: isoDate(prior.decidedAt), replay, superseded: current?.decisionId !== decisionId,
      notificationCommitted: notice !== null, deviceDeliveryVerified: false, readingVerified: false,
      financialEffectsCommitted: false, orderProgressPermissionGranted: false, authenticityVerified: false, rightsVerified: false };
  };
  return withPrivateAccountSession(request, async () => {
  const result = await db.runTransaction(async tx => {
    await assertPendingReportReader(request, tx);
    const [priorSnap, currentSnap] = await tx.getAll(receiptRef, moderationRef);
    const prior = priorSnap.data(), current = currentSnap.data();
    if (prior) return receipt(tx, prior, current, true);
    if (raw.mode === 'observe') return { protocol: 'article_moderation_favorable_v1', actorUid: uid, articleId: input.articleId,
      reportId: input.reportId, ownerId: input.expectedOwnerId, requestId: input.requestId, decisionId, payloadHash,
      outcome: 'unrecorded', favorableRecorded: false, decisionCommitted: false, intentionNeutralized: false, lateRequestBlocked: false,
      sourceExamined: false, listingReactivated: false, availabilityPermissionGranted: false, financialEffectsCommitted: false,
      orderProgressPermissionGranted: false, authenticityVerified: false, rightsVerified: false };
    if (raw.accepted !== true) throw new HttpsError('invalid-argument', 'Confirmation explicite requise.');
    const base = { schemaVersion: 1, protocol: 'article_moderation_favorable_v1', articleId: input.articleId, reportId: input.reportId,
      ownerId: input.expectedOwnerId, actorUid: uid, decidedBy: uid, requestId: input.requestId, decisionId, payloadHash,
      ownerMessage: input.ownerMessage, authorityNote: input.authorityNote, evidenceReferences: input.evidenceReferences,
      input, source: 'operator_report_review', decidedAt: FieldValue.serverTimestamp() };
    const neutralize = (reason: string) => {
      if (current?.decisionId === decisionId) throw new HttpsError('unavailable', 'Le reçu de cette décision engagée doit être retrouvé.');
      tx.create(receiptRef, { ...base, outcome: 'not_executed', reason, sourceExamined: false,
        intentionNeutralized: true, lateRequestBlocked: true, listingReactivated: false });
      return { reread: true as const };
    };
    if (raw.mode === 'neutralize') return neutralize('intention_neutralized_before_effects');
    const s = await favorableSources(tx, input.articleId, input.reportId, input.expectedDecisionId);
    if (s.article.sellerId !== input.expectedOwnerId || s.current.decisionId !== input.expectedModerationDecisionId ||
        documentRevision(s.articleSnap) !== input.expectedArticleRevision || documentRevision(s.reportSnap) !== input.expectedReportRevision ||
        documentRevision(s.moderationSnap) !== input.expectedModerationRevision || (s.appealRef?.id ?? null) !== input.expectedAppealId ||
        (s.appealSnap ? documentRevision(s.appealSnap) : null) !== input.expectedAppealRevision) return neutralize('source_changed');
    const historical = await tx.get(moderationRef.collection('decisions').limit(101));
    const currentProofRef = moderationRef.collection('decisions').doc(s.current.decisionId);
    const currentProofSnap = s.current.decisionId === s.decisionId ? s.restrictiveSnap : await tx.get(currentProofRef);
    const linkedReports = await tx.get(db.collection('reports').where('targetId', '==', input.articleId).limit(101));
    const lifted = new Set<string>(historical.docs.filter(doc => { const p = doc.data(); return p.protocol === 'article_moderation_favorable_v1' &&
      p.outcome === 'approved' && p.ownerId === input.expectedOwnerId && p.articleId === input.articleId && p.decidedAt instanceof Timestamp;
    }).map(doc => doc.data().liftedDecisionId));
    lifted.add(input.expectedDecisionId);
    const remainingRestrictionDecisionIds = historical.docs.filter(doc => nativeRestriction(doc.data(), input.articleId, input.expectedOwnerId, doc.id) &&
      !lifted.has(doc.id)).map(doc => doc.id).sort();
    const blockers: string[] = [];
    if (!s.restrictionQualified || historical.size >= 101 || !currentProofSnap.exists || linkedReports.size >= 101 ||
        linkedReports.docs.some(doc => { const r = doc.data(); return r.targetType === 'article' &&
          ['hold', 'reject'].includes(r.articleDecision?.action) && !lifted.has(r.articleDecision?.decisionId) &&
          !historical.docs.some(proof => proof.id === r.articleDecision.decisionId && nativeRestriction(proof.data(), input.articleId, input.expectedOwnerId, proof.id));
        })) blockers.push('restriction_history_unqualified');
    if (remainingRestrictionDecisionIds.length) blockers.push('other_operator_restrictions');
    if (articlePrivacyWithdrawn(s.article)) blockers.push('privacy_withdrawal');
    if (s.article.isSold !== false) blockers.push('sold_or_sale_state_unqualified');
    const previouslyActive = s.restriction.observedArticle?.isActive === true;
    const unchangedOperatorWithdrawal = s.restriction.action === 'reject' && s.article.isActive === false &&
      s.restriction.decidedAt instanceof Timestamp && s.articleSnap.updateTime?.isEqual(s.restriction.decidedAt) === true;
    const preceding = currentProofSnap.data();
    // A second reject can observe an already hidden listing. Its exact
    // observed revision must still be the preceding native operator commit,
    // otherwise an owner withdrawal or unknown write breaks the continuity.
    const visibilityHistory = new Map(historical.docs.map(doc => [doc.id, doc.data()]));
    if (preceding) visibilityHistory.set(currentProofSnap.id, preceding);
    const restrictiveVisibilityContinues = (proof: FirebaseFirestore.DocumentData | undefined, expectedId: string, seen = new Set<string>()): boolean => {
      if (!proof || !nativeRestriction(proof, input.articleId, input.expectedOwnerId, expectedId) || seen.has(expectedId)) return false;
      if (proof.observedArticle?.isActive === true) return true;
      if (proof.observedArticle?.isActive !== false || !hashValue(proof.previousDecisionId)) return false;
      seen.add(expectedId);
      const previous = visibilityHistory.get(proof.previousDecisionId);
      if (!previous || !(previous.decidedAt instanceof Timestamp) || previous.decidedAt.toMillis() > proof.decidedAt.toMillis() ||
          proof.observedArticleRevision !== decisionDigest([input.articleId, previous.decidedAt.seconds, previous.decidedAt.nanoseconds])) return false;
      return restrictiveVisibilityContinues(previous, proof.previousDecisionId, seen);
    };
    const unchangedCurrentRejectWithdrawal = s.article.isActive === false && preceding?.action === 'reject' &&
      preceding.decisionId === s.current.decisionId && s.article.moderationSource === preceding.source &&
      s.article.moderationStatus === preceding.moderationStatus && preceding.decidedAt instanceof Timestamp &&
      s.articleSnap.updateTime?.isEqual(preceding.decidedAt) === true && restrictiveVisibilityContinues(preceding, currentProofSnap.id);
    const priorVisibilityContinues = preceding?.visibilityProofVersion === 1 && preceding.operatorVisibilityWithdrawal === true &&
      preceding.visibilityContinuityWasActive === true || preceding?.observedArticle?.isActive === true &&
      Array.isArray(preceding.availabilityBlockers) && !preceding.availabilityBlockers.includes('owner_withdrawal_or_visibility_history_unqualified');
    const unchangedFavorableWithdrawal = s.article.isActive === false && preceding?.protocol === 'article_moderation_favorable_v1' &&
      preceding.schemaVersion === 1 && preceding.action === 'approve' && preceding.outcome === 'approved' &&
      preceding.source === 'operator_report_review' && typeof preceding.actorUid === 'string' && !!preceding.actorUid &&
      typeof preceding.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(preceding.requestId) &&
      hashValue(preceding.observedArticleRevision) && hashValue(preceding.observedReportRevision) && hashValue(preceding.observedModerationRevision) &&
      preceding.articleId === input.articleId && preceding.ownerId === input.expectedOwnerId && preceding.decisionId === s.current.decisionId &&
      hashValue(preceding.payloadHash) && preceding.payloadHash === s.current.payloadHash && preceding.actorUid === s.current.actorUid &&
      preceding.requestId === s.current.requestId && preceding.listingReactivated === false && preceding.decidedAt instanceof Timestamp &&
      s.articleSnap.updateTime?.isEqual(preceding.decidedAt) === true && s.article.moderationSource === preceding.source &&
      s.article.moderationStatus === preceding.moderationStatus && priorVisibilityContinues;
    const visibilityContinuityWasActive = previouslyActive || unchangedCurrentRejectWithdrawal || unchangedFavorableWithdrawal;
    const visibilityWithdrawalQualified = s.article.isActive === true || unchangedOperatorWithdrawal || unchangedCurrentRejectWithdrawal || unchangedFavorableWithdrawal;
    if (!visibilityContinuityWasActive || !visibilityWithdrawalQualified) blockers.push('owner_withdrawal_or_visibility_history_unqualified');
    if (!Array.isArray(s.article.images) || s.article.images.length === 0) blockers.push('listing_images_unqualified');
    const guard = async (operation: () => void | Promise<void>, fallback: string) => {
      try { await operation(); } catch (error) { if (!(error instanceof HttpsError)) throw error;
        blockers.push(typeof (error.details as any)?.reason === 'string' ? (error.details as any).reason : fallback); }
    };
    await guard(() => assertNoLiveArticleTransaction(tx, input.articleId, s.article), 'agreement_or_financial_obligation');
    const eligibility = await readEligibilityEvidence(tx, input.expectedOwnerId);
    await guard(async () => await assertOwnTradingEligibility(eligibility, 'sell', tx, input.expectedOwnerId), 'seller_admission_required');
    await guard(() => assertArticleHygieneAdmitted(s.article), 'hygiene_declaration_required');
    await guard(() => assertArticleChildSafetyAdmitted(tx, input.articleId, s.article), 'article_child_safety_review_required');
    const availabilityBlockers = [...new Set(blockers)], listingReactivated = availabilityBlockers.length === 0;
    const notices = await prepareOperationalNotices(tx, [ownerNotice(listingReactivated)]);
    const orderRestrictionDecisionId = ['hold', 'reject'].includes(s.current.action) ? s.current.decisionId
      : hashValue(s.current.orderRestrictionDecisionId) ? s.current.orderRestrictionDecisionId : input.expectedDecisionId;
    const proof = { ...base, outcome: 'approved', action: 'approve', liftedDecisionId: input.expectedDecisionId,
      previousDecisionId: s.current.decisionId, orderRestrictionDecisionId, restrictionEvidenceQualified: s.restrictionQualified,
      observedArticleRevision: input.expectedArticleRevision, observedReportRevision: input.expectedReportRevision,
      observedModerationRevision: input.expectedModerationRevision, observedAppealRevision: input.expectedAppealRevision,
      moderationStatus: listingReactivated ? 'approved' : 'pending', listingReactivated, availabilityBlockers,
      visibilityProofVersion: 1, visibilityContinuityWasActive,
      operatorVisibilityWithdrawal: !listingReactivated && visibilityContinuityWasActive && visibilityWithdrawalQualified,
      remainingRestrictionDecisionIds, reviewedAppealId: s.appeal?.status === 'pending' ? s.appealRef!.id : null,
      notificationIds: notices.notificationIds,
      reviewedAppealReason: s.appeal?.reason ?? null, allegation: { reason: s.report.reason ?? null, description: s.report.description ?? null },
      observedArticle: { isActive: s.article.isActive ?? null, moderationStatus: s.article.moderationStatus ?? null },
      appealStatus: s.appeal?.status === 'pending' && s.current.appealId === s.appealRef?.id ? null : s.current.appealStatus ?? null,
      appealId: s.appeal?.status === 'pending' && s.current.appealId === s.appealRef?.id ? null : s.current.appealId ?? null,
      appealReceivedAt: s.appeal?.status === 'pending' && s.current.appealId === s.appealRef?.id ? null : s.current.appealReceivedAt ?? null,
      appealDecisionId: s.appeal?.status === 'pending' && s.current.appealId === s.appealRef?.id ? null : s.current.appealDecisionId ?? s.current.decisionId,
      appealReportId: s.appeal?.status === 'pending' && s.current.appealId === s.appealRef?.id ? null : s.current.appealReportId ?? s.current.reportId };
    // No order, balance, isSold or image mutation: only the operator's listing
    // visibility is restored when every independently checked guard permits it.
    if (!currentProofSnap.exists) tx.create(currentProofRef, { ...s.current, legacyPointerPreserved: true,
      legacySourceRevision: input.expectedModerationRevision, legacyPreservedAt: FieldValue.serverTimestamp() });
    tx.create(receiptRef, proof);
    tx.set(moderationRef, proof);
    tx.update(s.articleRef, { moderationStatus: proof.moderationStatus, moderationSource: 'operator_report_review',
      ...(listingReactivated ? { isActive: true } : { isActive: false }), updatedAt: FieldValue.serverTimestamp() });
    const reportUpdate: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
      status: 'resolved', reviewedBy: uid, reviewedAt: FieldValue.serverTimestamp(), resolution: input.authorityNote,
      articleDecision: { decisionId, articleId: input.articleId, action: 'approve', liftedDecisionId: input.expectedDecisionId,
        source: 'operator_report_review', decidedAt: FieldValue.serverTimestamp() } };
    if (s.appeal?.status === 'pending') {
      tx.update(s.appealRef!, { status: 'reviewed', reviewedBy: uid, reviewedAt: FieldValue.serverTimestamp(), resultingDecisionId: decisionId });
      reportUpdate.ownerAppeal = { ...s.report.ownerAppeal, appealId: s.appealRef!.id, status: 'reviewed', resultingDecisionId: decisionId,
        reviewedAt: FieldValue.serverTimestamp() };
    }
    tx.update(s.reportRef, reportUpdate);
    notices.commit();
    return { reread: true as const };
  });
  if (!('reread' in result)) {
    await assertPendingReportReader(request);
    return result;
  }
  const savedResult = await db.runTransaction(async tx => { await assertPendingReportReader(request, tx);
    const [saved, current] = await tx.getAll(receiptRef, moderationRef);
    if (!saved.exists) throw new HttpsError('unavailable', 'Le reçu doit être retrouvé.');
    return receipt(tx, saved.data()!, current.data(), false); });
  await assertPendingReportReader(request);
  return savedResult;
  });
}

/** Owner support stays accessible even when new trading is unavailable.
 * Internal allegations, reporter identity and evidence never leave this DTO. */
async function ownerArticleModeration(request: any, data: Record<string, unknown>) {
  const uid: string = request.auth.uid;
  const articleId = safeId(data.articleId, 'articleId');
  const contest = data.operation === 'contestArticleDecision';
  const requestId = contest ? safeId(data.requestId, 'requestId') : null;
  const reason = contest && typeof data.reason === 'string' ? data.reason.trim() : null;
  if (contest && (!reason || reason.length > 2000 || typeof data.decisionId !== 'string'
      || !/^[a-f0-9]{64}$/.test(data.decisionId))) {
    throw new HttpsError('invalid-argument', 'La décision et un motif de contestation de 2 000 caractères maximum sont requis.');
  }
  return withPrivateAccountSession(request, () => db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const article = (await tx.get(db.collection('articles').doc(articleId))).data();
    const ref = db.collection('article_moderation').doc(articleId);
    const record = (await tx.get(ref)).data();
    if (!article || article.sellerId !== uid || (record && record.ownerId !== uid)) {
      throw new HttpsError('permission-denied', 'Ce dossier ne vous appartient pas.');
    }
    if (!record) {
      if (contest) throw new HttpsError('failed-precondition', 'Aucune décision à contester.');
      return { ok: true, articleId, decision: null };
    }
    const favorable = record.protocol === 'article_moderation_favorable_v1' && record.schemaVersion === 1 && record.outcome === 'approved' &&
      record.action === 'approve' && record.decidedAt instanceof Timestamp;
    const liftedProof = favorable && hashValue(record.liftedDecisionId)
      ? (await tx.get(ref.collection('decisions').doc(record.liftedDecisionId))).data() : null;
    const liftedDecision = liftedProof?.ownerId === uid && liftedProof.articleId === articleId
      ? { id: record.liftedDecisionId, action: liftedProof.action, ownerMessage: liftedProof.ownerMessage ?? null,
        decidedAt: isoDate(liftedProof.decidedAt), sourceQualified: nativeRestriction(liftedProof, articleId, uid, record.liftedDecisionId) } : null;
    const dto = () => ({ id: record.decisionId, action: record.action, status: record.moderationStatus,
      ownerMessage: record.ownerMessage, decidedAt: isoDate(record.decidedAt),
      appealStatus: record.appealStatus ?? null, appealReceivedAt: isoDate(record.appealReceivedAt),
      favorableRecorded: favorable, listingReactivated: favorable && record.listingReactivated === true,
      availabilityPermissionGranted: false, availabilityBlockers: favorable && Array.isArray(record.availabilityBlockers) ? record.availabilityBlockers : [],
      reviewedAppealId: favorable ? record.reviewedAppealId ?? null : null,
      remainingRestrictionCount: favorable && Array.isArray(record.remainingRestrictionDecisionIds) ? record.remainingRestrictionDecisionIds.length : null,
      liftedDecision, currentListingState: { isActive: typeof article.isActive === 'boolean' ? article.isActive : null,
        isSold: typeof article.isSold === 'boolean' ? article.isSold : null, moderationStatus: article.moderationStatus ?? null } });
    if (!contest) return { ok: true, articleId, decision: dto() };
    const appealId = decisionDigest([uid, articleId, requestId]);
    const appealRef = ref.collection('appeals').doc(appealId);
    const prior = (await tx.get(appealRef)).data();
    const hash = decisionDigest([uid, articleId, requestId, data.decisionId, reason]);
    if (prior) {
      if (prior.inputHash !== hash) throw new HttpsError('already-exists', 'Cette requête désigne une autre contestation.');
      return { ok: true, articleId, appealId, recorded: true, replay: true, decision: dto() };
    }
    if (record.decisionId !== data.decisionId) {
      throw new HttpsError('aborted', 'La décision a changé. Relisez le dossier avant de contester.');
    }
    if (record.appealStatus === 'pending') {
      throw new HttpsError('failed-precondition', 'Une contestation est déjà en cours.');
    }
    const reportRef = db.collection('reports').doc(safeId(record.reportId, 'Signalement'));
    const report = (await tx.get(reportRef)).data();
    if (!report || report.targetType !== 'article' || report.targetId !== articleId) {
      throw new HttpsError('failed-precondition', 'Le dossier de décision doit être examiné.');
    }
    const appeal = { ownerId: uid, articleId, decisionId: data.decisionId, requestId, inputHash: hash,
      reason, status: 'pending', receivedAt: FieldValue.serverTimestamp() };
    tx.create(appealRef, appeal);
    tx.update(ref, { appealStatus: 'pending', appealId, appealReceivedAt: FieldValue.serverTimestamp(),
      appealDecisionId: data.decisionId, appealReportId: record.reportId });
    tx.update(reportRef, { status: 'reviewed', ownerAppeal: { appealId, ownerId: uid, reason,
      decisionId: data.decisionId, receivedAt: FieldValue.serverTimestamp() } });
    // A request for review never lifts the restriction or changes an order.
    return { ok: true, articleId, appealId, recorded: true, replay: false,
      decision: { ...dto(), appealStatus: 'pending', appealReceivedAt: null } };
  }));
}

async function partyOrderModeration(request: any, data: Record<string, unknown>) {
  const uid: string = request.auth.uid;
  const transactionId = safeId(data.transactionId, 'Commande');
  return withPrivateAccountSession(request, () => db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const order = (await tx.get(db.collection('transactions').doc(transactionId))).data();
    if (!order || ![order.buyerId, order.sellerId].includes(uid)) {
      throw new HttpsError('permission-denied', 'Cette commande ne vous appartient pas.');
    }
    const state = await readOrderModeration(tx, order);
    const commit = await prepareOrderModerationNotices(tx, transactionId, order, state);
    commit();
    return { ok: true, transactionId, moderation: state ? { articleId: state.articleId,
      decisionId: state.decisionId, action: state.action, message: state.message,
      instructionId: state.instructionId, decidedAt: state.decidedAt,
      progressAllowed: state.sourceQualified && state.action === 'continue' && state.otherBlockers.length === 0,
      additionalReviewRequired: state.otherBlockers.length > 0 } : null };
  }));
}

/** Resume from the private decision checkpoint; bounded pages, no silent cap.
 * The current source gates fulfillment even if delivery of these notices fails. */
async function notifyModeratedOrderPage(articleId: string, decisionId: string, request?: any) {
  const decisionRef = db.collection('article_moderation').doc(articleId);
  const receiptRef = decisionRef.collection('decisions').doc(decisionId);
  const checkpoint = await db.runTransaction(async tx => {
    if (request) await assertPendingReportReader(request, tx);
    const current = (await tx.get(decisionRef)).data(), receipt = (await tx.get(receiptRef)).data();
    if (current?.decisionId !== decisionId || !receipt || receipt.articleId !== articleId) return null;
    return { cursor: typeof receipt.orderNoticeCursor === 'string' ? receipt.orderNoticeCursor : null,
      complete: receipt.orderNoticesComplete === true };
  });
  if (!checkpoint || checkpoint.complete) return { noticesPending: false, superseded: !checkpoint };
  let query = db.collection('transactions').where('articleId', '==', articleId).orderBy(FieldPath.documentId()).limit(25);
  if (checkpoint.cursor) query = query.startAfter(checkpoint.cursor);
  if (request) await assertPendingReportReader(request);
  const page = await query.get();
  if (request) await assertPendingReportReader(request);
  for (const order of page.docs) {
    if (request) await assertPendingReportReader(request);
    await ensureOrderModerationNotices(order.id);
    if (request) await assertPendingReportReader(request);
  }
  return db.runTransaction(async tx => {
    if (request) await assertPendingReportReader(request, tx);
    const current = (await tx.get(decisionRef)).data(), receipt = (await tx.get(receiptRef)).data();
    if (current?.decisionId !== decisionId || !receipt) return { noticesPending: false, superseded: true };
    const cursor = typeof receipt.orderNoticeCursor === 'string' ? receipt.orderNoticeCursor : null;
    if (cursor !== checkpoint.cursor) return { noticesPending: receipt.orderNoticesComplete !== true, superseded: false };
    const complete = page.size < 25;
    tx.update(receiptRef, { orderNoticeCursor: page.docs.at(-1)?.id ?? checkpoint.cursor,
      orderNoticesComplete: complete, orderNoticesUpdatedAt: FieldValue.serverTimestamp() });
    return { noticesPending: !complete, superseded: false };
  });
}

/** Explicit read endpoint, safe even when a preceding server generation did
 * not understand the command's mode. Never forwards execute/neutralize. */
async function readOrderModerationReceipt(request: any) {
  const uid = supportUid(request), wrapper = supportObject(request.data, ['operation', 'expectedUid', 'expectedAdminUid', 'articleId', 'command']);
  const articleId = safeId(wrapper.articleId, 'Annonce du journal');
  if (wrapper.operation !== 'readOrderModerationReceipt' || wrapper.expectedAdminUid !== uid)
    throw new HttpsError('permission-denied', 'Le compte propriétaire du journal a changé.');
  const command = supportObject(wrapper.command, ['operation', 'capability', 'expectedUid', 'expectedAdminUid', 'articleId',
    'transactionId', 'requestId', 'mode', 'action', 'message', 'authorityNote', 'evidenceReferences',
    'expectedOrderRevision', 'expectedArticleDecisionId', 'continuationProof']);
  if (command.operation !== 'reviewOrderModeration' || command.expectedAdminUid !== uid ||
      command.expectedUid !== undefined && command.expectedUid !== uid ||
      command.articleId !== undefined && command.articleId !== articleId)
    throw new HttpsError('permission-denied', 'Le tuple original de cette instruction ne correspond pas au journal.');
  // Mode/articleId are transport context, absent from both published command
  // fingerprints. Preserve every original instruction field byte-for-byte.
  const observed = {...command, articleId, mode: 'observe'};
  return adminOrderModeration(uid, false, observed, {...request, data: observed});
}

async function previewOrderModerationContinuation(request: any) {
  const uid = supportUid(request), data = supportObject(request.data, ['operation', 'capability', 'expectedUid', 'expectedAdminUid', 'transactionId']);
  if (data.capability !== ORDER_CONTINUATION_CAPABILITY || data.expectedAdminUid !== uid)
    throw new HttpsError('invalid-argument', 'Version et opérateur courant requis.');
  const transactionId = safeId(data.transactionId, 'Commande');
  assertRecentAccountAuthentication(request.auth.token);
  await checkRateLimit(uid, true, {functionName: 'orderModerationContinuation', maxCallsAuthenticated: 15, maxCallsUnauthenticated: 0, windowMs: 60_000});
  return db.runTransaction(async tx => {
    await supportCurrentAdminSession(request);
    await recheckReportAdmin(tx, uid, false); assertRecentAccountAuthentication(request.auth.token);
    const profile = (await tx.get(db.collection('eligibility_profiles').doc(uid))).data(); await assertAccountSecurityOpen(profile, tx, uid);
    const snap = await tx.get(db.collection('transactions').doc(transactionId)), order = snap.data();
    if (!order) throw new HttpsError('not-found', 'Commande native introuvable.');
    const state = await readOrderModeration(tx, order);
    let source: Awaited<ReturnType<typeof readOrderContinuationSource>> | null = null;
    try {source = await readOrderContinuationSource(tx, transactionId, order);} catch { /* Unknown stays a pause/review, never proof of absence. */ }
    return {protocol: 'order_moderation_continuation_preview_v1', transactionId, articleId: safeId(order.articleId, 'Annonce liée'), ownerId: uid,
      expectedOrderRevision: documentRevision(snap), expectedArticleDecisionId: state?.decisionId ?? null,
      source: source && source.proof.caseVersion > 0 ? source.proof : null, evidenceReferences: source?.evidenceReferences ?? [],
      coverage: source?.coverage ?? null, canContinue: state?.sourceQualified === true && orderHasPaymentEvidence(order) &&
        state.otherBlockers.every(blocker => blocker === 'order_recourse') && source?.complete === true,
      ...ORDER_CONTINUATION_LIMITS};
  });
}

async function adminOrderModeration(uid: string, claim: boolean, data: Record<string, unknown>, request?: any) {
  if (data.operation === 'continueOrderNotices') {
    const articleId = safeId(data.articleId, 'Annonce');
    if (typeof data.decisionId !== 'string' || !/^[a-f0-9]{64}$/.test(data.decisionId)) throw new HttpsError('invalid-argument', 'Décision requise.');
    await db.runTransaction(tx => recheckReportAdmin(tx, uid, claim));
    return { ok: true, articleId, decisionId: data.decisionId, ...await notifyModeratedOrderPage(articleId, data.decisionId) };
  }
  if (data.operation === 'readModeratedOrders') {
    if (!request) throw new HttpsError('failed-precondition', 'Une session privée actuelle est requise.');
    const articleId = safeId(data.articleId, 'Annonce');
    const cursor = data.cursor == null ? null : safeId(data.cursor, 'Page');
    return db.runTransaction(async tx => {
      await assertPendingReportReader(request, tx);
      const decision = (await tx.get(db.collection('article_moderation').doc(articleId))).data();
      if (decision?.source !== 'operator_report_review' || decision.articleId !== articleId ||
          typeof decision.decisionId !== 'string' || !/^[a-f0-9]{64}$/.test(decision.decisionId)) {
        throw new HttpsError('failed-precondition', 'Aucune décision opérateur qualifiée liée.');
      }
      let query = db.collection('transactions').where('articleId', '==', articleId).orderBy(FieldPath.documentId()).limit(20);
      if (cursor) query = query.startAfter(cursor);
      const page = await tx.get(query);
      const orders = await Promise.all(page.docs.map(async snap => {
        const order = snap.data(), state = await readOrderModeration(tx, order);
        return { id: snap.id, revision: documentRevision(snap), articleId, buyerId: order.buyerId ?? null,
          sellerId: order.sellerId ?? null, status: order.status ?? null, deliveryType: order.deliveryType ?? null,
          paymentEvidence: orderHasPaymentEvidence(order), fundsReleased: !!order.fundsReleasedAt,
          hasLabel: !!order.shipEngineLabelId, moderation: state };
      }));
      return { ok: true, articleId, decisionId: decision.decisionId, orders,
        nextCursor: page.size === 20 ? page.docs.at(-1)!.id : null,
        noticesPending: (await tx.get(db.collection('article_moderation').doc(articleId)
          .collection('decisions').doc(decision.decisionId))).data()?.orderNoticesComplete !== true };
    });
  }
  const transactionId = safeId(data.transactionId, 'Commande');
  const requestId = safeId(data.requestId, 'Requête');
  const optIn = data.capability === ORDER_CONTINUATION_CAPABILITY, mode = optIn ? data.mode : data.mode ?? 'execute';
  if (data.capability !== undefined && !optIn || !['execute', 'observe', 'neutralize'].includes(mode as string) ||
      !optIn && mode === 'neutralize' || optIn && requestId.length < 16)
    throw new HttpsError('invalid-argument', 'Version et action de reprise explicites requises.');
  if (optIn) {
    supportUid(request);
    supportObject(data, ['operation', 'capability', 'expectedUid', 'expectedAdminUid', 'articleId', 'transactionId', 'requestId', 'mode',
      'action', 'message', 'authorityNote', 'evidenceReferences', 'expectedOrderRevision', 'expectedArticleDecisionId', 'continuationProof']);
  }
  if (data.expectedAdminUid !== uid) throw new HttpsError('permission-denied', 'Le compte administratif a changé.');
  if (!['pause', 'continue'].includes(data.action as string) || typeof data.expectedOrderRevision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.expectedOrderRevision) || typeof data.expectedArticleDecisionId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.expectedArticleDecisionId) || typeof data.message !== 'string' ||
      !data.message.trim() || data.message.trim().length > 2000 || typeof data.authorityNote !== 'string' ||
      !data.authorityNote.trim() || data.authorityNote.trim().length > 2000 || !Array.isArray(data.evidenceReferences) ||
      data.evidenceReferences.length < (optIn && data.action === 'pause' ? 0 : 1) || data.evidenceReferences.length > (optIn ? 100 : 10) ||
      !optIn && data.evidenceReferences.some(ref => typeof ref !== 'string' || !ref.trim() || ref.trim().length > 500)) {
    throw new HttpsError('invalid-argument', 'Instruction, motivation d’autorité, preuves et observations actuelles requises.');
  }
  const input = { action: data.action as 'pause' | 'continue', message: data.message.trim(), authorityNote: data.authorityNote.trim(),
    evidenceReferences: optIn ? data.evidenceReferences.map(parseProductReviewEvidenceReference) : data.evidenceReferences.map(ref => (ref as string).trim()),
    expectedOrderRevision: data.expectedOrderRevision, expectedArticleDecisionId: data.expectedArticleDecisionId,
    ...(optIn ? {capability: ORDER_CONTINUATION_CAPABILITY, continuationProof: data.action === 'continue' ? parseOrderContinuationProof(data.continuationProof) : null} : {}) };
  if (optIn && input.action === 'pause' && data.continuationProof !== null) throw new HttpsError('invalid-argument', 'Une pause ne requiert aucun nouveau corpus.');
  const inputHash = (optIn ? supportHash : decisionDigest)([uid, transactionId, requestId, input]);
  const instructionId = decisionDigest([uid, transactionId, requestId]);
  const articleId = optIn || data.articleId !== undefined ? safeId(data.articleId, 'Annonce') :
    safeId((await db.collection('transactions').doc(transactionId).get()).data()?.articleId, 'Annonce liée');
  const ref = db.collection('article_moderation').doc(articleId).collection('decisions').doc(input.expectedArticleDecisionId)
    .collection('orders').doc(transactionId).collection('instructions').doc(instructionId);
  const ownView = (prior: FirebaseFirestore.DocumentData | undefined) => {
    if (prior && (prior.inputHash !== inputHash || prior.decidedBy !== uid || prior.requestId !== requestId ||
        prior.transactionId !== transactionId || prior.articleId !== articleId || prior.id !== instructionId))
      throw new HttpsError('already-exists', 'Cette requête désigne une autre instruction.');
    if (!optIn) return {ok: true, transactionId, replay: true, superseded: true, instructionId, moderation: null};
    if (prior && (prior.protocol !== 'order_moderation_continuation_instruction_v1' ||
        !['committed', 'not_executed', 'neutralized'].includes(prior.state) || !(prior.recordedAt instanceof Timestamp) ||
        supportHash(prior.command) !== supportHash(input))) throw new HttpsError('failed-precondition', 'Le reçu propre doit être rapproché.');
    if (prior?.state === 'committed' && input.action === 'continue' &&
        !orderContinuationCaptureMatches(prior.continuationCapture, input.continuationProof, input.evidenceReferences))
      throw new HttpsError('failed-precondition', 'La capture documentaire historique de cette intention doit être rapprochée.');
    return {protocol: 'order_moderation_continuation_receipt_v1', ownerId: uid, transactionId, articleId, requestId,
      inputHash, instructionId, state: prior?.state ?? 'absent', recordedAt: prior?.recordedAt.toDate().toISOString() ?? null,
      reason: prior?.reason ?? null, action: input.action,
      sourceBoundAtCommit: prior?.state === 'committed' && input.action === 'continue' && !!prior.continuationCapture,
      ...ORDER_CONTINUATION_LIMITS};
  };
  // An exact own receipt precedes current Auth, role, profile and source gates.
  const saved = (await ref.get()).data();
  if (saved) return ownView(saved);
  if (mode === 'observe') {
    if (!optIn) throw new HttpsError('failed-precondition', 'Aucun reçu exact n’est enregistré ; cette absence ne permet pas d’acquitter l’intention historique.');
    return ownView(undefined);
  }
  await checkRateLimit(uid, true, {functionName: 'orderModerationContinuation', maxCallsAuthenticated: 15, maxCallsUnauthenticated: 0, windowMs: 60_000});
  if (mode === 'neutralize') return db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data(); if (prior) return ownView(prior);
    const record = {protocol: 'order_moderation_continuation_instruction_v1', state: 'neutralized', reason: 'owner_neutralized',
      id: instructionId, articleId, transactionId, requestId, inputHash, decidedBy: uid, command: input, recordedAt: Timestamp.now()};
    tx.create(ref, record); return ownView(record);
  });
  if (!request) throw new HttpsError('failed-precondition', 'Une session actuelle est requise.');
  assertRecentAccountAuthentication(request.auth.token);
  const result = await db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data(); if (prior) return ownView(prior);
    // Every TX retry re-reads CURRENT Auth after the exact own receipt. Legacy
    // expectedAdminUid supplies only admission context, never a new fingerprint.
    const currentClaim = await supportCurrentAdminSession(optIn ? request : {...request, data: {expectedUid: uid}});
    await recheckReportAdmin(tx, uid, false);
    const actorRole = await tx.get(db.collection('users').doc(uid));
    const profile = (await tx.get(db.collection('eligibility_profiles').doc(uid))).data(); await assertAccountSecurityOpen(profile, tx, uid);
    assertRecentAccountAuthentication(request.auth.token);
    const orderRef = db.collection('transactions').doc(transactionId), snap = await tx.get(orderRef), order = snap.data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    if (order.articleId !== articleId) throw new HttpsError('aborted', 'L’annonce native a changé.');
    const state = await readOrderModeration(tx, order);
    if (!state?.sourceQualified || state.decisionId !== input.expectedArticleDecisionId ||
        documentRevision(snap) !== input.expectedOrderRevision || !orderHasPaymentEvidence(order)) {
      throw new HttpsError('aborted', 'La commande ou la décision a changé. Relisez le dossier.');
    }
    if (input.action === 'continue' && state.otherBlockers.some(blocker => blocker !== 'order_recourse')) {
      throw new HttpsError('failed-precondition', 'Un autre recours, remboursement ou blocage de compte doit être traité séparément.');
    }
    if (input.action === 'continue' && !optIn) throw new HttpsError('failed-precondition',
      'Une nouvelle continuation doit être liée aux pièces natives du dossier, à leur version et à leur source.',
      {reason: 'order_continuation_native_corpus_required', capability: ORDER_CONTINUATION_CAPABILITY});
    const source = input.action === 'continue' ? await readOrderContinuationSource(tx, transactionId, order) : null;
    if (source && (!source.complete || supportHash(source.proof) !== supportHash(input.continuationProof) ||
        !orderContinuationSelectionMatches(input.evidenceReferences as ReturnType<typeof parseProductReviewEvidenceReference>[], source.evidenceReferences)))
      throw new HttpsError('aborted', 'Le corpus ou les pièces sélectionnées ont changé. Relisez le dossier.');
    // The commercial dispute is still authoritative. Recording permission to
    // continue this moderation dossier does not close it or move its hold.
    // Its normal resolution can subsequently recheck all independent guards.
    const instruction = { schemaVersion: 1, id: instructionId, articleId, decisionId: state.decisionId,
      buyerId: order.buyerId, sellerId: order.sellerId, action: input.action, message: input.message,
      decidedAt: Timestamp.now() };
    const nextState = { ...state, action: input.action, message: input.message, instructionId, decidedAt: null };
    const commitNotices = await prepareOrderModerationNotices(tx, transactionId, order, nextState);
    const continuationCapture = source ? {protocol: 'order_moderation_continuation_capture_v1', proof: source.proof,
      document: source.document, manifest: source.manifest, selectedEvidenceReferences: input.evidenceReferences, ...ORDER_CONTINUATION_LIMITS} : null;
    const record = { ...instruction, transactionId, requestId, inputHash, decidedBy: uid,
      authorityNote: input.authorityNote, evidenceReferences: input.evidenceReferences,
      observedOrderRevision: input.expectedOrderRevision,
      ...(optIn ? {protocol: 'order_moderation_continuation_instruction_v1', state: 'committed', reason: null,
        command: input, recordedAt: instruction.decidedAt, continuationCapture,
        operatorAuthority: {protocol: 'current_order_moderation_operator_v1', actorId: uid,
          authTime: request.auth.token.auth_time, authorityQualifiedAtCommit: true, nativeAdminClaimObserved: currentClaim,
          privateRoleRevision: actorRole.exists ? documentRevision(actorRole) : null, privateRoleSourceHash: supportSourceHash(actorRole.data() ?? null)}} : {})};
    tx.create(ref, record);
    tx.update(orderRef, { moderationInstruction: source ? {...instruction, continuation: {capability: ORDER_CONTINUATION_CAPABILITY,
      transactionId, receiptHash: supportSourceHash(record)}} : instruction });
    commitNotices();
    if (optIn) return ownView(record);
    return { replay: false, superseded: false, instructionId, moderation: nextState };
  });
  logger.info('[triageReport] order instruction recorded', { transactionId, instructionId, adminUid: uid, action: input.action });
  if (optIn) return result;
  return { ok: true, transactionId, ...result };
}

/** Owner info needed to notify after a status change. */
type ShopMutationResult = {
  ownerId: string | null;
  shopName: string | null;
  notificationCommitted: boolean;
  approvalSourceHash: string | null;
};

/** Only these shop decisions/linking pages use this current private authority.
 * Each retry joins the barrier and fallback role to its own read set. */
async function assertShopStatusModerator(request: any, tx?: FirebaseFirestore.Transaction): Promise<string> {
  if (!tx) return db.runTransaction(current => assertShopStatusModerator(request, current));
  const session = await assertPrivateAccountSession(request, tx);
  await recheckReportAdmin(tx, session.uid, session.currentAdminClaim);
  return session.uid;
}

/** Timestamps are generated by the commit, never hashed as FieldValue tokens.
 * Every substantive shop/decision/owner field must still match that approval. */
function shopApprovalSourceHash(data: FirebaseFirestore.DocumentData): string {
  return supportSourceHash({...data, updatedAt: null,
    verificationDetails: {...data.verificationDetails, verifiedAt: null}});
}

function shopDecisionNotice(shopId: string, ownerId: string, shopLabel: string, outcome: ShopStatus,
  reason: string | null, eventKey: string): OperationalNoticeInput {
  if (!['approved', 'rejected', 'suspended'].includes(outcome)) throw new HttpsError('invalid-argument', 'Décision boutique invalide.');
  const approved = outcome === 'approved';
  const verb = outcome === 'suspended' ? 'suspendue' : 'refusée';
  return { eventKey, userId: ownerId, type: approved ? 'shop_approved' : 'shop_rejected',
    title: approved ? 'Boutique approuvée' : outcome === 'suspended' ? 'Boutique suspendue' : 'Boutique refusée',
    message: approved ? `La décision d’approbation de ${shopLabel} a été enregistrée. Consultez votre boutique pour son état actuel.`
      : `${shopLabel} a été ${verb}${reason ? ` : ${reason}` : '.'}`,
    data: { shopId, outcome } };
}

/**
 * Internal helper: mutate a shop's validation status atomically.
 *
 * `verificationDetails` mirrors the shape the client service used to write
 * (reason? / verifiedAt / verifiedBy) so existing readers keep working. The
 * `reason` field is only set for reject/suspend (omitted entirely for approve —
 * never written as `undefined`).
 *
 * Commits the owner's notice with the decision and returns the owner for the
 * existing article-linking follow-up.
 * `ownerId` is `null` on an idempotent no-op (already in the requested state):
 * a replay of the same moderation action MUST NOT re-notify the owner.
 */
async function mutateShopStatus(
  shopId: string,
  nextStatus: ShopStatus,
  request: any,
  reason: string | null,
): Promise<ShopMutationResult> {
  return db.runTransaction(async (tx) => {
    const adminUid = await assertShopStatusModerator(request, tx);
    const ref = db.collection('shops').doc(shopId);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Boutique introuvable');
    }

    const data = snap.data() ?? {};
    const currentStatus = data.status as ShopStatus | undefined;
    if (currentStatus === nextStatus) {
      // Historical status alone does not prove a durable notification. A
      // native replay reads its exact frozen content, never recreates a notice.
      const prior = data.verificationDetails?.operationalNotice;
      let notificationCommitted = false;
      if (prior?.protocol === 'shop_decision_notice_v1') {
        if (prior.shopId !== shopId || prior.outcome !== nextStatus || typeof prior.eventKey !== 'string' ||
            typeof prior.ownerId !== 'string' || prior.ownerId !== data.ownerId || typeof prior.shopLabel !== 'string' ||
            !(prior.reason === null || typeof prior.reason === 'string')) {
          throw new HttpsError('failed-precondition', 'L’avis de cette décision nécessite un examen.');
        }
        const receipt = await readOperationalNoticeReceipt(tx,
          shopDecisionNotice(shopId, prior.ownerId, prior.shopLabel, nextStatus, prior.reason, prior.eventKey));
        if (!receipt) throw new HttpsError('failed-precondition', 'L’avis de cette décision nécessite un examen.');
        notificationCommitted = true;
      }
      return { ownerId: null, shopName: null, notificationCommitted, approvalSourceHash: null };
    }

    const ownerId = typeof data.ownerId === 'string' && data.ownerId ? data.ownerId : null;
    if (!ownerId) throw new HttpsError('failed-precondition', 'Le propriétaire de cette boutique nécessite un examen.');
    const shopName = typeof data.name === 'string' && data.name ? data.name : null;
    const shopLabel = shopName ?? 'Votre boutique';
    const eventKey = `shop:${shopId}:decision:${documentRevision(snap)}:${nextStatus}`;
    const notices = await prepareOperationalNotices(tx, [shopDecisionNotice(shopId, ownerId, shopLabel, nextStatus, reason, eventKey)]);

    const verificationDetails: Record<string, unknown> = {
      verifiedAt: FieldValue.serverTimestamp(),
      verifiedBy: adminUid,
      operationalNotice: { protocol: 'shop_decision_notice_v1', shopId, outcome: nextStatus,
        ownerId, shopLabel, reason, eventKey },
    };
    // Only attach a reason when we actually have one (reject/suspend).
    if (reason !== null) {
      verificationDetails.reason = reason;
    }

    const approvalSourceHash = nextStatus === 'approved' ? shopApprovalSourceHash({
      ...data, status: nextStatus, verificationDetails,
    }) : null;
    await assertShopStatusModerator(request, tx);

    tx.update(ref, {
      status: nextStatus,
      verificationDetails,
      updatedAt: FieldValue.serverTimestamp(),
    });

    notices.commit();
    return { ownerId, shopName, notificationCommitted: true, approvalSourceHash };
  });
}

/** A page is read and linked under the SAME source/session lock. A concurrent
 * suspension, owner/shop-profile edit or newer decision stops the old follow-up.
 * Only current seller-owned articles without a string shop link are touched. */
async function linkApprovedShopArticles(request: any, shopId: string, result: ShopMutationResult): Promise<number> {
  if (!result.ownerId || !result.approvalSourceHash) return 0;
  const ownerId = result.ownerId, sourceHash = result.approvalSourceHash;
  let cursor: string | null = null, linked = 0;
  for (;;) {
    const page = await db.runTransaction(async tx => {
      await assertShopStatusModerator(request, tx);
      const shop = (await tx.get(db.collection('shops').doc(shopId))).data();
      if (!shop || shop.status !== 'approved' || shop.ownerId !== ownerId ||
          shop.verificationDetails?.operationalNotice?.protocol !== 'shop_decision_notice_v1' ||
          !(shop.verificationDetails?.verifiedAt instanceof Timestamp) || shopApprovalSourceHash(shop) !== sourceHash) return null;
      // Existence/source only: no new age, residency or commercial admission is
      // imposed on the shop's old articles or its owner's historical dossier.
      const owner = await tx.get(db.collection('users').doc(ownerId));
      if (!owner.exists) return null;
      let query = db.collection('articles').where('sellerId', '==', ownerId).orderBy('__name__').limit(50);
      if (cursor) query = query.startAfter(cursor);
      const articles = await tx.get(query);
      await assertShopStatusModerator(request, tx);
      let count = 0;
      for (const article of articles.docs) {
        const current = article.data();
        if (current.sellerId !== ownerId || typeof current.shopId === 'string') continue;
        tx.update(article.ref, {shopId}); count++;
      }
      return {lastId: articles.docs.at(-1)?.id ?? null, size: articles.size, count};
    });
    await assertShopStatusModerator(request);
    if (!page) break;
    linked += page.count;
    if (page.size < 50 || page.lastId === null) break;
    cursor = page.lastId;
  }
  return linked;
}

/**
 * Reads + validates a required `shopId` string from the callable payload.
 */
function requireShopId(data: unknown): string {
  const shopId = (data as { shopId?: unknown } | null | undefined)?.shopId;
  if (typeof shopId !== 'string' || shopId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'shopId is required');
  }
  return shopId.trim();
}

/**
 * Reads an optional `reason` string (bound 1-500 chars when present).
 * Returns the trimmed reason or null (never undefined).
 */
function readReason(data: unknown, required: boolean): string | null {
  const raw = (data as { reason?: unknown } | null | undefined)?.reason;
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      throw new HttpsError('invalid-argument', 'reason is required');
    }
    return null;
  }
  if (typeof raw !== 'string') {
    throw new HttpsError('invalid-argument', 'reason must be a string');
  }
  const trimmed = raw.trim();
  if (required && trimmed.length === 0) {
    throw new HttpsError('invalid-argument', 'reason is required');
  }
  if (trimmed.length > 500) {
    throw new HttpsError('invalid-argument', 'reason too long (max 500)');
  }
  return trimmed.length > 0 ? trimmed : null;
}

// ============================================================
// B2 — SHOP MODERATION (approve / reject / suspend)
// ============================================================

/**
 * approveShop — admin-only. Sets a shop's status to 'approved'.
 */
export const approveShop = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    const shopId = requireShopId(request.data);
    const result = await mutateShopStatus(
      shopId,
      'approved',
      request,
      null,
    );

    // `shopId` n'est posé qu'à la création de l'article : ceux publiés pendant
    // l'examen de la boutique n'y entraient jamais, et aucune édition ne les
    // rattrapait. On les rattache ici. `ownerId` est null sur une
    // ré-approbation sans effet, donc le rattrapage ne rejoue pas.
    if (result.ownerId) {
      const linked = await linkApprovedShopArticles(request, shopId, result);
      if (linked > 0) {
        logger.info('[approveShop] articles rattachés à la boutique', {
          shopId,
          count: linked,
        });
      }
    }

    await assertShopStatusModerator(request);

    logger.info('[approveShop] shop approved', {
      shopId,
      adminUid: request.auth.uid,
    });
    return { ok: true as const, shopId, status: 'approved' as const, notificationCommitted: result.notificationCommitted,
      deviceDeliveryVerified: false, readingVerified: false };
  }),
);

/**
 * rejectShop — admin-only. Sets a shop's status to 'rejected' with a reason.
 */
export const rejectShop = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    const shopId = requireShopId(request.data);
    const reason = readReason(request.data, true);
    const result = await mutateShopStatus(
      shopId,
      'rejected',
      request,
      reason,
    );
    await assertShopStatusModerator(request);
    logger.info('[rejectShop] shop rejected', {
      shopId,
      adminUid: request.auth.uid,
    });
    return { ok: true as const, shopId, status: 'rejected' as const, notificationCommitted: result.notificationCommitted,
      deviceDeliveryVerified: false, readingVerified: false };
  }),
);

/**
 * suspendShop — admin-only. Sets a shop's status to 'suspended' with a reason.
 */
export const suspendShop = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    const shopId = requireShopId(request.data);
    const reason = readReason(request.data, true);
    const result = await mutateShopStatus(
      shopId,
      'suspended',
      request,
      reason,
    );
    await assertShopStatusModerator(request);
    logger.info('[suspendShop] shop suspended', {
      shopId,
      adminUid: request.auth.uid,
    });
    return { ok: true as const, shopId, status: 'suspended' as const, notificationCommitted: result.notificationCommitted,
      deviceDeliveryVerified: false, readingVerified: false };
  }),
);

// ============================================================
// B3 — REPORT TRIAGE
// ============================================================

/**
 * getPendingReports — admin-only. Lists open reports (status == 'pending'),
 * most recent first. Requires the reports(status ASC, createdAt DESC)
 * composite index (firestore.indexes.json).
 */
export const getPendingReports = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    const adminUid = request.auth!.uid;
    const payload = (request.data ?? {}) as Record<string, unknown>;
    // A fresh owner session may observe an exact own instruction after losing
    // the admin role. Do not route that receipt through dossier authorization.
    if (payload.operation === 'readOrderModerationReceipt') return readOrderModerationReceipt(request);
    await assertPendingReportReader(request);
    const finishAdminRead = async <T>(value: T): Promise<T> => {
      await assertPendingReportReader(request);
      return value;
    };
    if (payload.operation === 'previewOrderModerationContinuation') return finishAdminRead(await previewOrderModerationContinuation(request));
    if (payload.operation === 'readMessageReportEvidence') return finishAdminRead(await readAdminMessageReport(request));
    const messageEvidence = payload.capability === 'message_report_v1';
    if (messageEvidence) {supportUid(request); supportObject(payload, ['capability', 'expectedUid', 'limit']);}
    if (payload.operation === 'readReportEvidence') assertReportActor(adminUid, payload);
    if (payload.operation === 'readReportEvidence') {
      const reportId = safeId(payload.reportId, 'Signalement');
      const readEvidence = async () => db.runTransaction(async tx => {
        await assertPendingReportReader(request, tx);
        const report = (await tx.get(db.collection('reports').doc(reportId))).data();
        if (!report || report.targetType !== 'article') throw new HttpsError('not-found', 'Signalement d’annonce introuvable.');
        return adminReportEvidenceProjection(report, reportId, tx);
      });
      const evidence = await readEvidence();
      if (payload.mediaId === undefined) return finishAdminRead({ ...evidence, actorUid: adminUid });
      const mediaId = String(payload.mediaId);
      if (!evidence.media.some((media: { mediaId: string; state: string }) => media.mediaId === mediaId && media.state === 'preserved')) {
        throw new HttpsError('permission-denied', 'Ce média n’appartient pas au dossier examiné.');
      }
      const media = await readReportPrivateImage(reportId, mediaId);
      const after = await readEvidence();
      if (!after.media.some((item: { mediaId: string; privateGeneration?: string | null }) =>
        item.mediaId === mediaId && item.privateGeneration === media.generation) || after.contentHash !== evidence.contentHash) {
        throw new HttpsError('permission-denied', 'Le média ne correspond plus au dossier examiné.');
      }
      return finishAdminRead({ ...media, actorUid: adminUid });
    }
    if (payload.operation === 'readArticleModeration') return finishAdminRead(await readFavorableArticleSource(request, payload));
    if (payload.operation === 'readModeratedOrders') return finishAdminRead(await adminOrderModeration(adminUid, false, payload, request));
    if (payload.operation !== undefined) throw new HttpsError('invalid-argument', 'Opération administrative invalide.');

    const rawLimit = (request.data as { limit?: unknown } | null | undefined)?.limit;
    const limit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(Math.floor(rawLimit), 200) : 100;

    const reports = await db.runTransaction(async tx => {
      if (messageEvidence) {await supportCurrentAdminSession(request); await supportAdmin(tx, adminUid, false);}
      await assertPendingReportReader(request, tx);
      const snap = await tx.get(db.collection('reports')
        .where('status', 'in', ['pending', 'reviewed'])
        .orderBy('createdAt', 'desc').limit(limit));
      return Promise.all(snap.docs.map(async d => {
      const data = d.data();
      const createdAt = data.createdAt;
      let articleReview = null;
      let ownerAppeal = null;
      if (data.targetType === 'article' && typeof data.targetId === 'string'
          && data.targetId && !data.targetId.includes('/')) {
        const articleSnap = await tx.get(db.collection('articles').doc(data.targetId));
        const article = articleSnap.data();
        const moderation = (await tx.get(db.collection('article_moderation').doc(data.targetId))).data();
        if (moderation?.appealStatus === 'pending' && typeof moderation.appealId === 'string' &&
            (moderation.appealReportId ?? moderation.reportId) === d.id) {
          const appeal = (await tx.get(db.collection('article_moderation').doc(data.targetId)
            .collection('appeals').doc(safeId(moderation.appealId, 'Contestation')))).data();
          if (appeal && appeal.ownerId === article?.sellerId && appeal.decisionId === (moderation.appealDecisionId ?? moderation.decisionId)) {
            ownerAppeal = { appealId: moderation.appealId, ownerId: appeal.ownerId,
              reason: appeal.reason, decisionId: appeal.decisionId, receivedAt: isoDate(appeal.receivedAt) };
          }
        }
        if (article) articleReview = { articleId: articleSnap.id, ownerId: article.sellerId ?? null,
          revision: documentRevision(articleSnap), moderationStatus: article.moderationStatus ?? null,
          isActive: article.isActive ?? null, decisionSource: article.moderationSource ?? null,
          currentDecision: moderation ? { id: moderation.decisionId, action: moderation.action,
            ownerMessage: moderation.ownerMessage, evidenceReferences: moderation.evidenceReferences,
            appealStatus: moderation.appealStatus ?? null } : null };
      }
      return {
        id: d.id,
        revision: documentRevision(d),
        articleReview,
        ownerAppeal,
        articleEvidence: data.targetType === 'article' ? await adminReportEvidenceProjection(data, d.id, tx) : null,
        ...(messageEvidence ? {messageEvidence: data.targetType === 'message' ? await messageReportProjection(tx, d.id, data) : null} : {}),
        reporterId: data.reporterId ?? null,
        reporterName: data.reporterName ?? null,
        targetType: data.targetType ?? null,
        targetId: data.targetId ?? null,
        targetOwnerId: data.targetOwnerId ?? null,
        reason: data.reason ?? null,
        description: data.description ?? null,
        status: data.status ?? 'pending',
        createdAt:
          createdAt && typeof createdAt.toDate === 'function'
            ? createdAt.toDate().toISOString()
            : null,
      };
      }));
    });

    return finishAdminRead({ ok: true as const, reports, count: reports.length });
  }),
);

/**
 * triageReport — admin-only. Records the moderation outcome of a report and
 * stamps the admin-owned review fields. Runs in a transaction so the outcome
 * is computed from the live doc (a report already resolved by another admin is
 * not silently re-stamped).
 *
 * Input:
 *   reportId     (string, required)
 *   outcome      ('reviewed' | 'resolved' | 'dismissed', required)
 *   resolution   (string, optional — bound 1-500; omitted when absent)
 */
export const triageReport = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    if (CONTENT_MODERATION_OPERATIONS.has(request.data?.operation)) return handleContentModeration(request,'triageReport');
    // Product-review own receipts are serviced by the helper before any NEW
    // operator-role/business guard. NEW decisions recheck current native Auth.
    const productReview = await dispatchProductReview(request, 'triageReport');
    if (productReview.handled) return productReview.value;
    const payload = (request.data ?? {}) as Record<string, unknown>;
    if (payload.operation === 'reviewOrderModeration') return adminOrderModeration(request.auth.uid, false, payload, request);
    if ((payload.operation === 'reviewOrderModeration' || payload.operation === 'continueOrderNotices' || payload.operation === 'reviewArticleModeration') &&
        payload.expectedAdminUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Le compte administratif a changé. Relisez le dossier avec votre session actuelle.',
        { reason: 'administrative_actor_changed' });
    }
    if (payload.operation === 'reviewArticleModeration') return favorableArticleReview(request, payload);
    if (payload.operation === 'continueOrderNotices') {
      const claimAdmin = await currentAdminClaim(request.auth.uid);
      return adminOrderModeration(request.auth.uid, claimAdmin, payload);
    }
    if (payload.operation !== undefined) throw new HttpsError('invalid-argument', 'Opération administrative invalide.');

    return withPrivateAccountSession(request, async () => {
    const data = (request.data ?? {}) as {
      reportId?: unknown;
      outcome?: unknown;
      resolution?: unknown;
      articleDecision?: unknown;
    };

    if (typeof data.reportId !== 'string' || data.reportId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'reportId is required');
    }
    if (
      typeof data.outcome !== 'string' ||
      !REPORT_OUTCOMES.has(data.outcome as ReportStatus)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'outcome must be one of reviewed | resolved | dismissed',
      );
    }
    let resolution: string | null = null;
    if (
      data.resolution !== undefined &&
      data.resolution !== null &&
      data.resolution !== ''
    ) {
      if (typeof data.resolution !== 'string') {
        throw new HttpsError('invalid-argument', 'resolution must be a string');
      }
      const trimmed = data.resolution.trim();
      if (trimmed.length > 500) {
        throw new HttpsError('invalid-argument', 'resolution too long (max 500)');
      }
      resolution = trimmed.length > 0 ? trimmed : null;
    }

    const reportId = safeId(data.reportId.trim(), 'reportId');
    const outcome = data.outcome as ReportStatus;
    const adminUid = request.auth!.uid;
    let decision: { action: 'hold' | 'reject'; expectedArticleRevision: string;
      expectedReportRevision: string; expectedOwnerId: string; ownerMessage: string; evidenceReferences: string[] } | null = null;
    if (data.articleDecision !== undefined) {
      const raw = data.articleDecision as Record<string, unknown>;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
          || !['hold', 'reject'].includes(raw.action as string)
          || typeof raw.expectedArticleRevision !== 'string' || !/^[a-f0-9]{64}$/.test(raw.expectedArticleRevision)
          || typeof raw.expectedReportRevision !== 'string' || !/^[a-f0-9]{64}$/.test(raw.expectedReportRevision)
          || typeof raw.ownerMessage !== 'string' || !raw.ownerMessage.trim() || raw.ownerMessage.trim().length > 2000
          || !Array.isArray(raw.evidenceReferences) || raw.evidenceReferences.length < 1 || raw.evidenceReferences.length > 10
          || raw.evidenceReferences.some(ref => typeof ref !== 'string' || !ref.trim() || ref.trim().length > 500)) {
        throw new HttpsError('invalid-argument', 'Décision, sources de preuve, motivation et observations actuelles requises.');
      }
      if ((raw.action === 'hold' && outcome !== 'reviewed') || (raw.action === 'reject' && outcome !== 'resolved')) {
        throw new HttpsError('invalid-argument', 'Un examen correspond à reviewed ; un retrait décidé correspond à resolved.');
      }
      decision = { action: raw.action as 'hold' | 'reject', expectedArticleRevision: raw.expectedArticleRevision,
        expectedReportRevision: raw.expectedReportRevision, expectedOwnerId: safeId(raw.expectedOwnerId, 'Vendeur observé'),
        ownerMessage: raw.ownerMessage.trim(), evidenceReferences: raw.evidenceReferences.map(ref => (ref as string).trim()) };
    }

    const result = await db.runTransaction(async (tx) => {
      await assertPendingReportReader(request, tx);
      const ref = db.collection('reports').doc(reportId);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Signalement introuvable');
      }
      const report = snap.data()!;
      if (!['pending', 'reviewed', 'resolved', 'dismissed'].includes(report.status)) {
        throw new HttpsError('failed-precondition', 'L’état du signalement doit être examiné.');
      }
      let articleRef: FirebaseFirestore.DocumentReference | null = null;
      let moderationRef: FirebaseFirestore.DocumentReference | null = null;
      let receiptRef: FirebaseFirestore.DocumentReference | null = null;
      let proof: Record<string, unknown> | null = null;
      let decisionId: string | null = null;
      let appealRef: FirebaseFirestore.DocumentReference | null = null;
      let appeal: FirebaseFirestore.DocumentData | null = null;
      if (decision) {
        if (report.targetType !== 'article') throw new HttpsError('invalid-argument', 'Cette décision concerne uniquement une annonce signalée.');
        const articleId = safeId(report.targetId, 'Article signalé');
        articleRef = db.collection('articles').doc(articleId);
        const articleSnap = await tx.get(articleRef);
        const article = articleSnap.data();
        if (!article || article.sellerId !== decision.expectedOwnerId) {
          throw new HttpsError('aborted', 'L’annonce ou son propriétaire a changé. Relisez les sources.');
        }
        moderationRef = db.collection('article_moderation').doc(articleId);
        const previous = (await tx.get(moderationRef)).data();
        if (previous && previous.ownerId !== article.sellerId) {
          throw new HttpsError('failed-precondition', 'La provenance du dossier doit être examinée.');
        }
        decisionId = decisionDigest([reportId, outcome, resolution, decision]);
        receiptRef = moderationRef.collection('decisions').doc(decisionId);
        const prior = (await tx.get(receiptRef)).data();
        if (prior) {
          if (prior.reportId !== reportId || prior.ownerId !== article.sellerId || prior.decisionId !== decisionId) {
            throw new HttpsError('failed-precondition', 'La preuve de décision doit être examinée.');
          }
          return { decisionId, replay: true, superseded: previous?.decisionId !== decisionId, currentStatus: report.status };
        }
        if (documentRevision(snap) !== decision.expectedReportRevision
            || documentRevision(articleSnap) !== decision.expectedArticleRevision) {
          throw new HttpsError('aborted', 'Les sources ont changé depuis votre examen. Relisez le dossier.');
        }
        if (article.moderationStatus === 'rejected' && decision.action === 'hold') {
          throw new HttpsError('failed-precondition', 'Un retrait existant ne peut pas être remplacé par une simple mise en examen.');
        }
        if (previous?.appealStatus === 'pending') {
          appealRef = moderationRef.collection('appeals').doc(safeId(previous.appealId, 'Contestation'));
          appeal = (await tx.get(appealRef)).data() ?? null;
          if (!appeal || appeal.ownerId !== article.sellerId || appeal.decisionId !== previous.decisionId) {
            throw new HttpsError('failed-precondition', 'La provenance de la contestation doit être examinée.');
          }
        }
        proof = { schemaVersion: 1, articleId, ownerId: article.sellerId, reportId, decisionId,
          action: decision.action, moderationStatus: decision.action === 'hold' ? 'pending' : 'rejected',
          ownerMessage: decision.ownerMessage, evidenceReferences: decision.evidenceReferences,
          source: 'operator_report_review', decidedBy: adminUid, decidedAt: FieldValue.serverTimestamp(),
          observedArticleRevision: decision.expectedArticleRevision, observedReportRevision: decision.expectedReportRevision,
          allegation: { reason: report.reason ?? null, description: report.description ?? null },
          observedArticle: { title: article.title ?? null, brand: article.brand ?? null, brandStatus: article.brandStatus ?? null,
            description: article.description ?? null, moderationStatus: article.moderationStatus ?? null, isActive: article.isActive ?? null },
          previousDecisionId: previous?.decisionId ?? null,
          reviewedAppealId: appealRef?.id ?? null,
          reviewedAppealReason: appeal?.reason ?? null };
      }
      if (['resolved', 'dismissed'].includes(report.status)) {
        if (!decision && report.status === outcome && (resolution === null || report.resolution === resolution)) {
          return { decisionId: null, replay: true, superseded: false, currentStatus: report.status };
        }
        throw new HttpsError('failed-precondition', 'Ce signalement est déjà clôturé. Une contestation doit être examinée séparément.');
      }

      const update: Record<string, unknown> = {
        status: outcome,
        reviewedBy: adminUid,
        reviewedAt: FieldValue.serverTimestamp(),
      };
      // Only write a resolution when provided (never undefined to Firestore).
      if (resolution !== null) {
        update.resolution = resolution;
      }
      if (proof && decision && articleRef && moderationRef && receiptRef) {
        const articleUpdate: Record<string, unknown> = { moderationStatus: proof.moderationStatus,
          moderationSource: 'operator_report_review', updatedAt: FieldValue.serverTimestamp() };
        if (decision.action === 'reject') articleUpdate.isActive = false;
        // Public article gets only its availability state. Motivation and
        // evidence remain private; no orders, funds or media are touched.
        tx.update(articleRef, articleUpdate);
        tx.create(receiptRef, proof);
        tx.set(moderationRef, { ...proof, appealStatus: null, appealId: null, appealReceivedAt: null });
        update.articleDecision = { decisionId, articleId: proof.articleId, action: proof.action,
          source: proof.source, decidedAt: FieldValue.serverTimestamp() };
        update.targetOwnerId = proof.ownerId;
        if (appealRef && appeal) {
          tx.update(appealRef, { status: 'reviewed', reviewedBy: adminUid,
            reviewedAt: FieldValue.serverTimestamp(), resultingDecisionId: decisionId });
          update.ownerAppeal = { appealId: appealRef.id, ownerId: appeal.ownerId, reason: appeal.reason,
            decisionId: appeal.decisionId, status: 'reviewed', resultingDecisionId: decisionId,
            receivedAt: appeal.receivedAt, reviewedAt: FieldValue.serverTimestamp() };
        }
      }
      tx.update(ref, update);
      return { decisionId, replay: false, superseded: false, currentStatus: outcome };
    });

    logger.info('[triageReport] report triaged', {
      reportId,
      outcome,
      adminUid,
    });
    // Exact replay resumes any interrupted fan-out from the private checkpoint.
    // Restrictions have already committed and do not wait for notifications.
    let noticesPending = false;
    if (result.decisionId && !result.superseded) {
      await assertPendingReportReader(request);
      const report = (await db.collection('reports').doc(reportId).get()).data();
      if (typeof report?.targetId === 'string') {
        const page = await notifyModeratedOrderPage(safeId(report.targetId, 'Annonce'), result.decisionId, request);
        noticesPending = page.noticesPending;
      }
    }
    await assertPendingReportReader(request);
    return { ok: true as const, reportId, status: result.currentStatus, ...result, noticesPending };
    });
  },
);

// ============================================================
// B7 — REPORT SUBMISSION (anti-spam, server-side dedup)
// ============================================================

/**
 * submitReport — authenticated. Creates a moderation report for a target.
 *
 * ANTI-SPAM (Msg finding 39): the `reports` collection used to be created
 * client-side via addDoc, so a single reporter could spam unlimited reports
 * against the same target (a client-side hasUserReported() check is advisory
 * and racy). This callable enforces "1 report per reporter/target/type" with a
 * deterministic doc id (`${reporterId}_${targetType}_${targetId}`) checked
 * inside runTransaction — same atomic-dedup pattern as createReview. A replay
 * or repeated submission hits the existing doc and is rejected with
 * 'already-exists', so the client can map it to a "déjà signalé" message.
 *
 * Fields mirror the shape moderationService.createReport wrote and that
 * getPendingReports / the admin reports screen read (reporterId, reporterName,
 * targetType, targetId, targetOwnerId?, reason, description?, status,
 * createdAt). The moderation lifecycle (status/reviewedBy/reviewedAt/
 * resolution) stays admin-owned: the report always starts 'pending'.
 *
 * Input:
 *   targetType    ('user' | 'article' | 'message' | 'review', required)
 *   targetId      (string, required)
 *   reason        (string, required — ReportReason key, bound 1-100)
 *   description   (string, optional — bound 1-2000; omitted when absent)
 *   targetOwnerId (string, optional — omitted when absent)
 */
export const submitReport = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    if (CONTENT_MODERATION_OPERATIONS.has(request.data?.operation)) return handleContentModeration(request,'submitReport');
    const productReview = await dispatchProductReview(request, 'submitReport');
    if (productReview.handled) return productReview.value;
    const reporterId = request.auth.uid;
    const payload = (request.data ?? {}) as Record<string, unknown>;
    if (MESSAGE_REPORT_OPERATIONS.has(payload.operation as string)) return handleMessageReport(request);
    // New article-report modes bind the SDK actor before any database/storage IO.
    const reportAuthorization = async (tx?: FirebaseFirestore.Transaction) => { await assertPrivateAccountSession(request, tx); };
    if (payload.operation === 'previewArticleReport') return previewArticleReport(reporterId, payload, reportAuthorization);
    if (payload.operation === 'observeArticleReport') return observeArticleReport(reporterId, payload, reportAuthorization);
    if (payload.operation === 'neutralizeArticleReport') return neutralizeArticleReport(reporterId, payload, reportAuthorization);
    if (payload.operation === 'readOrderModeration') return partyOrderModeration(request, payload);
    if (payload.operation === 'readArticleDecision' || payload.operation === 'contestArticleDecision') {
      return ownerArticleModeration(request, payload);
    }
    if (payload.operation !== undefined) {
      throw new HttpsError('invalid-argument', 'Opération de signalement invalide.');
    }
    if (payload.targetType === 'article') assertReportActor(reporterId, payload);

    const data = (request.data ?? {}) as {
      targetType?: unknown;
      targetId?: unknown;
      reason?: unknown;
      description?: unknown;
      targetOwnerId?: unknown;
    };

    if (
      typeof data.targetType !== 'string' ||
      !REPORT_TARGET_TYPES.has(data.targetType as ReportTargetType)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'targetType must be one of user | article | message | review',
      );
    }
    if (typeof data.targetId !== 'string' || data.targetId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'targetId is required');
    }
    if (
      typeof data.reason !== 'string' ||
      data.reason.trim().length === 0 ||
      data.reason.trim().length > 100
    ) {
      throw new HttpsError('invalid-argument', 'reason is required (max 100)');
    }

    const targetType = data.targetType as ReportTargetType;
    const targetId = data.targetId.trim();
    safeId(targetId, 'targetId');
    const reason = data.reason.trim();

    // Optional fields — never written as undefined to Firestore.
    let description: string | null = null;
    if (
      data.description !== undefined &&
      data.description !== null &&
      data.description !== ''
    ) {
      if (typeof data.description !== 'string') {
        throw new HttpsError('invalid-argument', 'description must be a string');
      }
      const trimmed = data.description.trim();
      if (trimmed.length > 2000) {
        throw new HttpsError('invalid-argument', 'description too long (max 2000)');
      }
      description = trimmed.length > 0 ? trimmed : null;
    }

    let targetOwnerId: string | null = null;
    if (
      data.targetOwnerId !== undefined &&
      data.targetOwnerId !== null &&
      data.targetOwnerId !== ''
    ) {
      if (typeof data.targetOwnerId !== 'string') {
        throw new HttpsError('invalid-argument', 'targetOwnerId must be a string');
      }
      const trimmed = data.targetOwnerId.trim();
      targetOwnerId = trimmed.length > 0 ? trimmed : null;
    }

    if (targetType === 'article') {
      return withPrivateAccountSession(request, async () => {
      const tuple = articleReportTuple(reporterId, payload, reason, description);
      const ref = db.collection('reports').doc(tuple.reportId);
      const nonexecution = await readArticleReportNonexecution(reporterId, tuple.articleId, tuple.requestId);
      if (nonexecution) {
        assertArticleReportOutcomeTuple(nonexecution, tuple);
        return { ok: true, replay: true, ...nonexecution };
      }
      const existingIntent = await findArticleReportIntent(reporterId, tuple.articleId, tuple.requestId);
      const prior = existingIntent.report;
      if (prior) {
        const priorRef = db.collection('reports').doc(existingIntent.reportId);
        const receipt = await reportEvidenceReceipt(prior, existingIntent.reportId, reporterId, tuple.requestId);
        if (receipt.tupleHash !== tuple.tupleHash) throw new HttpsError('failed-precondition', 'Cette intention a déjà un autre contenu.');
        await preserveReportEvidence(existingIntent.reportId, reportAuthorization);
        return { ok: true, replay: true, ...await reportEvidenceReceipt((await priorRef.get()).data()!, existingIntent.reportId, reporterId, tuple.requestId) };
      }
      await verifyArticleReportSources(tuple, reportAuthorization);
      const replay = await withDocumentaryProjection({kind:'article_report',articleId:tuple.articleId,reportId:tuple.reportId,reporterId},()=>db.runTransaction(async tx => {
        await assertPrivateAccountSession(request, tx);
        const stopped = await readArticleReportNonexecution(reporterId, tuple.articleId, tuple.requestId, tx);
        if (stopped) {
          assertArticleReportOutcomeTuple(stopped, tuple);
          return { replay: true, reportId: tuple.reportId, nonexecution: stopped };
        }
        const currentIntent = await findArticleReportIntent(reporterId, tuple.articleId, tuple.requestId, tx);
        const existing = currentIntent.report;
        if (existing) {
          const receipt = await reportEvidenceReceipt(existing, currentIntent.reportId, reporterId, tuple.requestId, tx);
          if (receipt.tupleHash !== tuple.tupleHash) throw new HttpsError('failed-precondition', 'Cette intention a déjà un autre contenu.');
          return { replay: true, reportId: currentIntent.reportId, nonexecution: null };
        }
        const snap = await tx.get(db.collection('articles').doc(reportEvidenceId(targetId, 'Annonce')));
        const reporterSnap = await tx.get(db.collection('users').doc(reporterId));
        const reporterName = typeof reporterSnap.data()?.displayName === 'string' ? reporterSnap.data()!.displayName : 'Utilisateur';
        const articleEvidence = await prepareArticleReportCapture(tx, snap, tuple);
        createArticleReportEvidenceAnchor(tx, tuple.reportId, articleEvidence);
        tx.create(ref, { id: tuple.reportId, reporterId, reporterName, targetType, targetId,
          targetOwnerId: articleEvidence.sellerId, reason, description, status: 'pending',
          createdAt: articleEvidence.capturedAt, articleEvidence });
        return { replay: false, reportId: tuple.reportId, nonexecution: null };
      }));
      if (replay.nonexecution) return { ok: true, replay: true, ...replay.nonexecution };
      await preserveReportEvidence(replay.reportId, reportAuthorization);
      logger.info('article_report_evidence_captured', { reportId: replay.reportId, articleId: targetId, reporterId, replay: replay.replay });
      return { ok: true, replay: replay.replay, ...await reportEvidenceReceipt((await db.collection('reports').doc(replay.reportId).get()).data()!, replay.reportId, reporterId, tuple.requestId) };
      });
    }

    return withPrivateAccountSession(request, async () => {
    // Deterministic id enforces "1 per reporter/target/type" atomically:
    // concurrent or repeated submissions converge on the same doc and only the
    // first wins (existence checked inside the transaction).
    const reportId = `${reporterId}_${targetType}_${targetId}`;
    const ref = db.collection('reports').doc(reportId);

    await db.runTransaction(async (tx) => {
      await assertPrivateAccountSession(request, tx);
      const reporterSnap = await tx.get(db.collection('users').doc(reporterId));
      const reporterName = typeof reporterSnap.data()?.displayName === 'string'
        ? reporterSnap.data()!.displayName as string : 'Utilisateur';
      const existing = await tx.get(ref);
      if (existing.exists) {
        throw new HttpsError(
          'already-exists',
          'Vous avez déjà signalé cet élément.',
        );
      }
      const report: Record<string, unknown> = {
        id: reportId,
        reporterId,
        reporterName,
        targetType,
        targetId,
        reason,
        status: 'pending' as const,
        createdAt: FieldValue.serverTimestamp(),
      };
      if (description !== null) {
        report.description = description;
      }
      if (targetOwnerId !== null) {
        report.targetOwnerId = targetOwnerId;
      }

      tx.set(ref, report);
    });

    logger.info('[submitReport] report created', {
      reportId,
      reporterId,
      targetType,
      targetId,
    });
    return { ok: true as const, reportId, status: 'pending' as const };
    });
  },
);
