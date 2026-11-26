/** Commercial return permission; no money, stock or physical-safety authority. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportAdmin, supportCurrentAdminSession, supportHash, supportId, supportObject, supportRequestId, supportSourceHash, supportText, supportUid} from './supportRequest';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from './eligibility';
import {assertStoredAccountSecuritySession} from './storedAccountSecuritySession';
import {PRODUCT_REVIEW_EFFECTS, productReviewCaseId, productReviewCaseRef, productReviewSourceView} from './productReviewSource';
import {readProductReviewDocumentarySet, parseProductReviewEvidenceReference} from './productReviewWorkflow';
import {prepareOperationalNotices, readOperationalNoticeReceipts} from './notifications';
import {effectivePurchaseReleaseAt} from './purchasePolicy';
import {committedReturnReceipt, qualifiedReturnRequest} from './returnRequest';
import {PRODUCT_MATERIAL_REVIEW_ENABLED, productMaterialRequested} from './productReviewMaterial';
import {PRODUCT_PARCEL_REVIEW_ENABLED, productParcelRequested, assertProductParcelNewOpen} from './productReviewParcel';

const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const context = (id: string) => ({kind: 'order' as const, id});
const decisionId = (uid: string, requestId: string) => 'pri_' + supportHash([uid, requestId]);
type Set = Awaited<ReturnType<typeof readProductReviewDocumentarySet>>;
export type CommercialReturnReference = {instructionId: string; contentHash: string};
export function parseCommercialReturnReference(value: unknown): CommercialReturnReference {
  const r = supportObject(value, ['instructionId', 'contentHash']);
  if (!/^pri_[a-f0-9]{64}$/.test(r.instructionId ?? '') || !hash(r.contentHash)) throw new HttpsError('invalid-argument', 'Instruction commerciale native exacte requise.');
  return {instructionId: r.instructionId, contentHash: r.contentHash};
}
export function commercialReturnExpectedStatus(order: FirebaseFirestore.DocumentData) {
  const basis = order.returnRequest?.commercialReturnBasis;
  return basis?.parcelCapability === 'product_review_parcel_v1' && ['delivered', 'disputed'].includes(basis.commercialStatusAtInstruction)
    ? basis.commercialStatusAtInstruction as 'delivered'|'disputed' : order.returnRequest?.commercialReturn ? 'disputed' : 'delivered';
}
function memberHash(set: Set) {const {sourceHash: _sourceHash, ...members} = set.manifest; return supportSourceHash(members);}
/** Private native presence is a conservative NEW-effect gate, not physical truth. */
export async function productMaterialReturnContextRequired(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData) {
  if (Object.prototype.hasOwnProperty.call(order, 'productCommercialReturnInstruction') ||
      Object.prototype.hasOwnProperty.call(order.returnRequest ?? {}, 'commercialReturn') ||
      ['nonconformity', 'parcel_delivery'].includes(order.buyerReport?.productReview?.topic)) return true;
  return !(await tx.get(productReviewCaseRef(context(transactionId)).collection('contributions')
    .where('document.topic', 'in', ['nonconformity', 'parcel_delivery']).limit(1))).empty;
}
async function current(tx: FirebaseFirestore.Transaction, transactionId: string, disputeId: string, supplied?: FirebaseFirestore.DocumentData, parcel = false) {
  const order = supplied ?? (await tx.get(db.collection('transactions').doc(transactionId))).data();
  if (!order) throw new HttpsError('not-found', 'Commande native indisponible.');
  const set = await readProductReviewDocumentarySet(tx, context(transactionId), true, parcel);
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).orderBy('__name__').limit(101));
  const claim = claims.docs.find(d => d.id === disputeId), d = claim?.data(), link = d?.productReview;
  const parcelClaim = link?.topic === 'parcel_delivery';
  const linked = set.contributionRows.find(r => r.id === link?.contributionId);
  const report = d && d.reportOwnerId === order.buyerId && typeof d.reportRequestId === 'string'
    ? (await tx.get(db.collection('transactions').doc(transactionId).collection('problem_requests').doc(supportHash([order.buyerId, d.reportRequestId])))).data() : null;
  const disputeQualified = claims.size <= 100 && claims.docs.every(row => {const data = row.data(); return data.transactionId === transactionId &&
    data.buyerId === order.buyerId && data.sellerId === order.sellerId && native(data.createdAt) && ['open', 'resolved', 'closed', 'dismissed'].includes(data.status);}) &&
    !!d && d.status === 'open' && d.transactionId === transactionId &&
    d.buyerId === order.buyerId && d.sellerId === order.sellerId && native(d.createdAt) && (link?.topic === 'nonconformity' || parcel && parcelClaim) &&
    link.caseId === set.source.caseId && !!linked?.proof && linked.proof.actorId === order.buyerId && linked.proof.topic === link.topic &&
    (parcelClaim ? linked.proof.command.parcelStatement?.leg === 'forward' && linked.proof.command.parcelStatement.receipt === 'received' : !!linked.proof.command.materialStatement) && linked.contentHash === link.contributionHash &&
    report?.protocol === (parcelClaim ? 'transaction_parcel_report_v1' : 'transaction_problem_report_v1') && report.state === 'committed' && report.disputeId === disputeId &&
    report.ownerId === order.buyerId && report.transactionId === transactionId && report.requestId === d.reportRequestId &&
    disputeId === 'problem_' + supportHash([order.buyerId, transactionId, d.reportRequestId]) && hash(report.payloadHash) &&
    report.committed === true && report.freezeCommitted === true && report.financialEffect === 'none' && report.reason === null &&
    typeof report.reportedAt === 'string' && Number.isSafeInteger(Date.parse(report.reportedAt)) &&
    Date.parse(report.reportedAt) >= 0 && Date.parse(report.reportedAt) <= Date.now() &&
    report.payloadHash === d.reportPayloadHash && supportHash(report.productReview) === supportHash(link);
  const initialReleaseAt = effectivePurchaseReleaseAt(order, transactionId);
  const timely = disputeQualified && initialReleaseAt instanceof Timestamp && Number.isSafeInteger(initialReleaseAt.toMillis()) &&
    initialReleaseAt.toMillis() >= 0 && d!.createdAt.toMillis() < initialReleaseAt.toMillis();
  const buyerReport = order.buyerReport;
  const buyerReportQualified = disputeQualified && buyerReport?.protocol === (parcelClaim ? 'transaction_parcel_report_v1' : 'transaction_problem_report_v1') &&
    buyerReport.disputeId === disputeId && buyerReport.requestId === d!.reportRequestId && buyerReport.payloadHash === d!.reportPayloadHash &&
    buyerReport.reason === d!.reason && supportHash(buyerReport.details ?? null) === supportHash(d!.details ?? null) &&
    supportHash(buyerReport.productReview) === supportHash(link) && native(buyerReport.reportedAt) && buyerReport.reportedAt.isEqual(d!.createdAt);
  const semanticSourceHash = supportSourceHash({protocol: 'product_commercial_return_source_v1', transactionId,
    buyerId: order.buyerId, sellerId: order.sellerId, articleId: order.articleId ?? null, articleSource: set.source.document.articleSource,
    caseSourceHash: supportSourceHash(set.root ?? null), caseVersion: set.root?.version ?? null, membersHash: memberHash(set),
    ...(parcel && 'parcelSources' in set.source.document ? {parcelSourceHash: supportSourceHash({contractRoute: set.source.document.parcelSources?.contractRoute,
      forward: set.source.document.parcelSources?.legs.find(l => l.leg === 'forward')}),
      commercialEntryStatus: order.returnRequest?.commercialReturnBasis?.commercialStatusAtInstruction ?? order.status} : {}),
    ...(Object.prototype.hasOwnProperty.call(order,'operationalRoutes') || Object.prototype.hasOwnProperty.call(order,'labelRouteReview')
      ? {routeAmendmentSourceHash:supportSourceHash({operationalRoutes:order.operationalRoutes??null,review:order.labelRouteReview??null})} : {}),
    disputeId, disputesHash: supportSourceHash(claims.docs.map(d => [d.id, d.data()])),
    factsHash: supportSourceHash(Object.fromEntries(['articleSnapshot', 'shippingSnapshot', 'shippingAddress', 'shipEngineLabelId',
      'shipEngineRateId', 'deliveryType', 'deliveredAt', 'fundsReleaseAt', 'fundsReleasedAt', 'currency', 'amount', 'totalAmount', 'sellerPayout',
      'sellerCreditedCents', 'paidAt', 'paidVia', 'stripePaymentIntentId', 'capturedCardCents', 'walletAmountUsed', 'bankDispute',
      'disputeId', 'disputeOutcome', 'deliveryCorrection', 'trackingReviewRequired', 'trackingReviewReason', 'productPhysicalReview',
      'moderationInstruction', 'labelReconciliationRequired', 'refundLegacyReconciliationRequired', 'purchasePolicyReviewRequired']
      .concat(parcel ? ['parcelRecourseGuard'] : []).map(key => [key, order[key] ?? null])))});
  return {order, set, disputeQualified, buyerReportQualified, semanticSourceHash, membersHash: memberHash(set), initialReleaseAt, reportedAt: d?.createdAt ?? null,
    contributionReferences: set.contributionRows.filter(r => r.proof).map(r => ({id: r.id, contentHash: r.contentHash!})),
    evidenceReferences: set.evidenceRows.flatMap(r => r.reference ? [r.reference] : []),
    canInstruct: timely && set.documentaryComplete && (order.status === 'disputed' || parcel && order.status === 'delivered' || order.status === 'return_requested' && committedReturnReceipt(transactionId, order)) &&
      (order.returnRequest == null || qualifiedReturnRequest(transactionId, order)) &&
      order.disputed === true && order.deliveryType === 'shipping' && order.fundsReleasedAt == null};
}
type Command = {transactionId: string; disputeId: string; returnRequestId: string | null; previewId: string; sourceHash: string; semanticSourceHash: string;
  caseVersion: number; corpusHash: string; membersHash: string; contributionReferences: {id: string; contentHash: string}[];
  evidenceReferences: Set['evidenceRows'][number]['reference'][]; action: 'maintain_review' | 'refuse_return' | 'instruct_return'; privateNote: string; partyMessage: string; acknowledged: true;
  parcelCapability?: 'product_review_parcel_v1'};
function input(value: unknown): Command {
  const c = supportObject(value, ['transactionId', 'disputeId', 'returnRequestId', 'previewId', 'sourceHash', 'semanticSourceHash', 'caseVersion', 'corpusHash', 'membersHash',
    'contributionReferences', 'evidenceReferences', 'action', 'privateNote', 'partyMessage', 'acknowledged', 'parcelCapability']);
  const parcel = productParcelRequested(c);
  if (![c.previewId, c.sourceHash, c.semanticSourceHash, c.corpusHash, c.membersHash].every(hash) || !Number.isSafeInteger(c.caseVersion) || c.caseVersion < 1 ||
      !['maintain_review', 'refuse_return', 'instruct_return'].includes(c.action) || c.acknowledged !== true ||
      !Array.isArray(c.contributionReferences) || c.contributionReferences.length > 100 || !Array.isArray(c.evidenceReferences) || c.evidenceReferences.length > 100)
    throw new HttpsError('invalid-argument', 'Aperçu, corpus, motivation et choix exacts requis.');
  return {transactionId: supportId(c.transactionId), disputeId: supportId(c.disputeId), returnRequestId: c.returnRequestId == null ? null : supportRequestId(c.returnRequestId), previewId: c.previewId,
    sourceHash: c.sourceHash, semanticSourceHash: c.semanticSourceHash, caseVersion: c.caseVersion, corpusHash: c.corpusHash, membersHash: c.membersHash,
    contributionReferences: c.contributionReferences.map((v: unknown) => {const r = supportObject(v, ['id', 'contentHash']);
      if (!/^pc_[a-f0-9]{64}$/.test(r.id ?? '') || !hash(r.contentHash)) throw new HttpsError('invalid-argument', 'Contribution native exacte requise.');
      return {id: r.id as string, contentHash: r.contentHash as string};}), evidenceReferences: c.evidenceReferences.map(parseProductReviewEvidenceReference), action: c.action,
    privateNote: supportText(c.privateNote, 'Motivation privée', 4000), partyMessage: supportText(c.partyMessage, 'Message aux parties', 4000), acknowledged: true,
    ...(parcel ? {parcelCapability: 'product_review_parcel_v1' as const} : {})};
}
const notices = (id: string, d: any) => [d.buyerId, d.sellerId].map(userId => ({eventKey: `product_commercial_return_v1:${id}`, userId,
  type: 'product_review_update', title: 'Instruction commerciale sur le retour', message: d.command.partyMessage,
  data: {ownerId: userId, transactionId: d.command.transactionId, productReviewCaseId: d.caseId, contextKind: 'order', contextId: d.command.transactionId}}));
async function proof(tx: FirebaseFirestore.Transaction, transactionId: string, id: string, value: any) {
  const d = value?.document;
  if (value?.protocol !== 'product_commercial_return_instruction_v1' || d?.protocol !== value.protocol || d.instructionId !== id ||
      d.caseId !== productReviewCaseId(context(transactionId)) || d.command?.transactionId !== transactionId || !native(d.recordedAt) ||
      id !== decisionId(d.actorId, d.requestId) || d.payloadHash !== supportHash(d.command) || value.contentHash !== supportSourceHash(d) ||
      d.operatorAuthority?.actorId !== d.actorId || d.operatorAuthority?.authorityQualifiedAtCommit !== true || !native(d.operatorAuthority?.verifiedAt) ||
      !Number.isSafeInteger(d.operatorAuthority.authTime) || d.operatorAuthority.authTime < 1 ||
      d.operatorAuthority.authTime * 1000 > d.operatorAuthority.verifiedAt.toMillis() ||
      typeof d.actorId !== 'string' || !d.actorId || d.actorId.length > 128 || d.actorId.includes('/') ||
      typeof d.buyerId !== 'string' || !d.buyerId || d.buyerId.includes('/') || typeof d.sellerId !== 'string' || !d.sellerId || d.sellerId.includes('/') || d.buyerId === d.sellerId) return null;
  let parsed: Command; try {supportRequestId(d.requestId); parsed = input(d.command);} catch {return null;}
  if (supportHash(parsed) !== d.payloadHash) return null;
  const receipt = (await tx.get(db.collection('product_review_workflow_commands').doc(supportHash([d.actorId, d.requestId])))).data();
  const preview = (await tx.get(productReviewCaseRef(context(transactionId)).collection('commercial_return_previews').doc(d.command.previewId))).data();
  if (receipt?.protocol !== 'product_commercial_return_command_v1' || receipt.state !== 'committed' || receipt.instructionId !== id ||
      receipt.actorId !== d.actorId || receipt.payloadHash !== d.payloadHash || !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(d.recordedAt) ||
      !preview || preview.protocol !== 'product_commercial_return_preview_v1' || !native(preview.recordedAt) || preview.actorId !== d.actorId || preview.transactionId !== transactionId || preview.disputeId !== d.command.disputeId ||
      preview.sourceHash !== d.command.sourceHash || preview.semanticSourceHash !== d.command.semanticSourceHash || preview.membersHash !== d.command.membersHash ||
      preview.corpusHash !== d.command.corpusHash || preview.caseVersion !== d.command.caseVersion ||
      (preview.parcelCapability ?? null) !== (d.command.parcelCapability ?? null) ||
      preview.returnRequestId !== d.command.returnRequestId ||
      supportHash(preview.contributionReferences) !== supportHash(d.command.contributionReferences) || supportHash(preview.evidenceReferences) !== supportHash(d.command.evidenceReferences) ||
      d.command.action === 'instruct_return' && preview.canInstruct !== true) return null;
  const receipts = await readOperationalNoticeReceipts(tx, notices(id, d));
  if (!Array.isArray(receipt.notificationIds) || receipt.notificationIds.length !== 2 || receipts.some((r, i) => !r || r.notificationId !== receipt.notificationIds[i])) return null;
  return {document: d, contentHash: value.contentHash};
}
export type CommercialReturnContestReference = CommercialReturnReference & {caseVersion: number};
/** Historical documentary origin only. It grants no current return or money permission. */
export async function readProductCommercialReturnInstructionProof(tx: FirebaseFirestore.Transaction, transactionId: string, reference: CommercialReturnContestReference) {
  const p = await proof(tx, transactionId, reference.instructionId,
    (await tx.get(productReviewCaseRef(context(transactionId)).collection('commercial_return_instructions').doc(reference.instructionId))).data());
  if (!p || p.contentHash !== reference.contentHash || p.document.command.caseVersion !== reference.caseVersion) return null;
  const d = p.document;
  return {reference, buyerId: d.buyerId as string, sellerId: d.sellerId as string, action: d.command.action as Command['action'],
    partyMessage: d.command.partyMessage as string, sourceHash: d.command.sourceHash as string, recordedAt: d.recordedAt as Timestamp};
}
export async function readCommercialReturnAdmission(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData, expected?: CommercialReturnReference) {
  const base = {protocol: 'product_commercial_return_guard_v1', allowed: false, qualification: 'unknown', reference: null as CommercialReturnReference | null,
    buyerReportQualified: false,
    basis: null as {protocol: string; transactionId: string; disputeId: string; buyerId: string; sellerId: string; instructionId: string; contentHash: string;
      reportedAt: Timestamp; initialReleaseAt: Timestamp; instructedAt: Timestamp; semanticSourceHash: string;
      parcelCapability?: 'product_review_parcel_v1'; commercialStatusAtInstruction?: 'delivered'|'disputed'} | null};
  if (!PRODUCT_MATERIAL_REVIEW_ENABLED) return base;
  const p = order.productCommercialReturnInstruction;
  if (p == null) return {...base, qualification: 'no_current_instruction'};
  let ref: CommercialReturnReference; try {ref = parseCommercialReturnReference(p);} catch {return base;}
  const qualified = await proof(tx, transactionId, ref.instructionId, (await tx.get(productReviewCaseRef(context(transactionId)).collection('commercial_return_instructions').doc(ref.instructionId))).data());
  if (!qualified || qualified.contentHash !== ref.contentHash || qualified.document.buyerId !== order.buyerId || qualified.document.sellerId !== order.sellerId) return base;
  const parcel = qualified.document.command.parcelCapability === 'product_review_parcel_v1';
  if (parcel && !PRODUCT_PARCEL_REVIEW_ENABLED) return base;
  try {
    const actorId = qualified.document.actorId;
    const session = await assertStoredAccountSecuritySession(tx, actorId, qualified.document.operatorAuthority.authTime);
    await supportAdmin(tx, actorId, session.currentAdminClaim);
  } catch {return base;}
  const command = qualified.document.command;
  let now: Awaited<ReturnType<typeof current>>;
  try {now = await current(tx, transactionId, command.disputeId, order, parcel);} catch (error) {
    if (error instanceof HttpsError && ['not-found', 'failed-precondition', 'invalid-argument'].includes(error.code)) return base;
    throw error;
  }
  if (expected && supportHash(expected) !== supportHash(ref)) {
    const old = await proof(tx, transactionId, expected.instructionId, (await tx.get(productReviewCaseRef(context(transactionId)).collection('commercial_return_instructions').doc(expected.instructionId))).data());
    if (!old || old.contentHash !== expected.contentHash || old.document.command.action !== 'instruct_return' ||
        old.document.command.disputeId !== command.disputeId || old.document.buyerId !== order.buyerId || old.document.sellerId !== order.sellerId ||
        !order.returnRequest || command.returnRequestId !== order.returnRequest.requestId || supportHash(order.returnRequest.commercialReturn) !== supportHash(expected)) return base;
  }
  if (command.returnRequestId !== null && command.returnRequestId !== order.returnRequest?.requestId) return base;
  const allowed = command.action === 'instruct_return' && now.canInstruct && now.semanticSourceHash === command.semanticSourceHash &&
    now.membersHash === command.membersHash && now.set.root?.version === command.caseVersion;
  return {...base, allowed, buyerReportQualified: allowed && now.buyerReportQualified, qualification: allowed ? 'native_current_instruction' : 'no_current_instruction', reference: ref,
    basis: allowed ? {protocol: 'product_commercial_return_basis_v1', transactionId, disputeId: command.disputeId,
      buyerId: order.buyerId, sellerId: order.sellerId, instructionId: ref.instructionId, contentHash: ref.contentHash,
      reportedAt: now.reportedAt, initialReleaseAt: now.initialReleaseAt!, instructedAt: qualified.document.recordedAt, semanticSourceHash: command.semanticSourceHash,
      ...(parcel ? {parcelCapability: 'product_review_parcel_v1' as const, commercialStatusAtInstruction: (order.returnRequest?.commercialReturnBasis?.commercialStatusAtInstruction ??
        (order.status === 'delivered' ? 'delivered' : 'disputed')) as 'delivered'|'disputed'} : {})} : null};
}
async function operator(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
  await supportCurrentAdminSession(request); await supportAdmin(tx, uid, false); assertRecentAccountAuthentication(request.auth.token);
  await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);
  return {actorId: uid, authTime: request.auth.token.auth_time, authorityQualifiedAtCommit: true, verifiedAt: Timestamp.now()};
}
function view(uid: string, requestId: string, command: Command, receipt?: any) {
  return {protocol: 'product_commercial_return_command_v1', actorId: uid, requestId, payloadHash: supportHash(command), caseId: productReviewCaseId(context(command.transactionId)),
    state: receipt?.state ?? 'unrecorded', reason: receipt?.reason ?? null, instructionReference: receipt?.instructionReference ?? null,
    recordedAt: native(receipt?.recordedAt) ? receipt.recordedAt.toDate().toISOString() : null, currentInstructionVerified: false, ...PRODUCT_REVIEW_EFFECTS};
}
export async function previewProductCommercialReturn(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'transactionId', 'disputeId', 'scope', 'materialCapability', 'parcelCapability']);
  const transactionId = supportId(raw.transactionId), disputeId = supportId(raw.disputeId);
  const parcel = productParcelRequested(raw); assertProductParcelNewOpen(parcel);
  if (!productMaterialRequested(raw)) throw new HttpsError('invalid-argument', 'Version matérielle explicite requise.');
  if (!['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Portée explicite requise.');
  return db.runTransaction(async tx => {
    if (raw.scope === 'admin') await operator(tx, request, uid);
    const now = await current(tx, transactionId, disputeId, undefined, parcel);
    if (raw.scope === 'own' && ![now.order.buyerId, now.order.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Commande non attribuée à votre compte.');
    const {buyerReportQualified: _buyerReportQualified, ...nativeAdmission} = await readCommercialReturnAdmission(tx, transactionId, now.order);
    // An instruction remains tied to its own opt-in/source scope. Historical G
    // authority is not a current V4 permission; its native receipt remains intact.
    const admission = parcel && nativeAdmission.allowed &&
      (nativeAdmission.basis?.parcelCapability !== 'product_review_parcel_v1' ||
       nativeAdmission.basis.semanticSourceHash !== now.semanticSourceHash || nativeAdmission.basis.disputeId !== disputeId)
      ? {...nativeAdmission, allowed: false, qualification: 'no_current_instruction', basis: null} : nativeAdmission;
    const result = {protocol: 'product_commercial_return_preview_v1', actorId: uid, scope: raw.scope, transactionId, disputeId, returnRequestId: now.order.returnRequest?.requestId ?? null,
      source: productReviewSourceView(now.set.source, uid), sourceHash: now.set.source.sourceHash, semanticSourceHash: now.semanticSourceHash,
      caseVersion: now.set.root?.version ?? 0, corpusHash: now.set.corpusHash, membersHash: now.membersHash,
      contributionReferences: raw.scope === 'admin' ? now.contributionReferences : [], evidenceReferences: raw.scope === 'admin' ? now.evidenceReferences : [],
      coverage: {...now.set.coverage, ...now.set.documentaryCoverage}, documentaryComplete: now.set.documentaryComplete, canInstruct: now.canInstruct,
      admission: {...admission, basis: admission.basis ? {...admission.basis, reportedAt: admission.basis.reportedAt.toDate().toISOString(),
        initialReleaseAt: admission.basis.initialReleaseAt.toDate().toISOString(), instructedAt: admission.basis.instructedAt.toDate().toISOString()} : null},
      options: raw.scope === 'admin' ? ['maintain_review', 'refuse_return', 'instruct_return'] : [],
      ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {}), ...PRODUCT_REVIEW_EFFECTS};
    if (raw.scope === 'own') return {...result, previewId: null};
    const previewId = supportHash([uid, transactionId, disputeId, result.sourceHash, result.semanticSourceHash, result.corpusHash, result.membersHash]);
    const ref = productReviewCaseRef(context(transactionId)).collection('commercial_return_previews').doc(previewId), prior = await tx.get(ref);
    if (!prior.exists) tx.create(ref, {protocol: 'product_commercial_return_preview_v1', actorId: uid, transactionId, disputeId, previewId, sourceHash: result.sourceHash, semanticSourceHash: result.semanticSourceHash,
      caseVersion: result.caseVersion, returnRequestId: result.returnRequestId, corpusHash: result.corpusHash, membersHash: result.membersHash, contributionReferences: result.contributionReferences,
      evidenceReferences: result.evidenceReferences, canInstruct: result.canInstruct, ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {}), recordedAt: Timestamp.now()});
    return {...result, previewId};
  });
}
export async function commandProductCommercialReturn(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'requestId', 'action', 'command', 'materialCapability', 'parcelCapability']);
  const requestId = supportRequestId(raw.requestId), command = input(raw.command), id = decisionId(uid, requestId), payloadHash = supportHash(command);
  const parcel = productParcelRequested(raw);
  if (parcel !== (command.parcelCapability === 'product_review_parcel_v1')) throw new HttpsError('invalid-argument', 'Capacité de l’instruction colis exacte requise.');
  if (!productMaterialRequested(raw)) throw new HttpsError('invalid-argument', 'Version matérielle explicite requise.');
  if (!['execute', 'observe', 'neutralize'].includes(raw.action)) throw new HttpsError('invalid-argument', 'Action explicite requise.');
  const ref = db.collection('product_review_workflow_commands').doc(supportHash([uid, requestId])), caseRef = productReviewCaseRef(context(command.transactionId));
  return db.runTransaction(async tx => {
    const receipt = (await tx.get(ref)).data();
    if (receipt) {
      if (receipt.protocol !== 'product_commercial_return_command_v1' || receipt.actorId !== uid || receipt.requestId !== requestId || receipt.payloadHash !== payloadHash ||
          supportHash(receipt.command) !== payloadHash || !native(receipt.recordedAt) || !['committed', 'not_executed'].includes(receipt.state)) throw new HttpsError('already-exists', 'Une autre intention correspond à cette référence.');
      if (receipt.state === 'committed' && !await proof(tx, command.transactionId, id, (await tx.get(caseRef.collection('commercial_return_instructions').doc(id))).data()))
        throw new HttpsError('unavailable', 'Reçu d’instruction à rapprocher.');
      return view(uid, requestId, command, receipt);
    }
    const registered = (await tx.get(caseRef.collection('commercial_return_previews').doc(command.previewId))).data();
    if (!registered || registered.protocol !== 'product_commercial_return_preview_v1' || registered.actorId !== uid ||
        registered.transactionId !== command.transactionId || registered.disputeId !== command.disputeId || registered.sourceHash !== command.sourceHash ||
        registered.semanticSourceHash !== command.semanticSourceHash || registered.corpusHash !== command.corpusHash || registered.membersHash !== command.membersHash ||
        registered.returnRequestId !== command.returnRequestId || (registered.parcelCapability ?? null) !== (command.parcelCapability ?? null) ||
        registered.caseVersion !== command.caseVersion || supportHash(registered.contributionReferences) !== supportHash(command.contributionReferences) ||
        supportHash(registered.evidenceReferences) !== supportHash(command.evidenceReferences)) throw new HttpsError('permission-denied', 'Seul votre aperçu natif exact enregistre cette intention.');
    if (raw.action === 'observe') return view(uid, requestId, command);
    const recordedAt = Timestamp.now(), noEffect = (reason: string) => {const r = {protocol: 'product_commercial_return_command_v1', actorId: uid, requestId, command, payloadHash,
      state: 'not_executed', reason, instructionReference: null, instructionId: null, recordedAt}; tx.create(ref, r); return view(uid, requestId, command, r);};
    if (raw.action === 'neutralize') return noEffect('requester_neutralized');
    if (!PRODUCT_MATERIAL_REVIEW_ENABLED) return noEffect('product_material_review_not_exposed');
    if (parcel && !PRODUCT_PARCEL_REVIEW_ENABLED) return noEffect('product_parcel_review_not_exposed');
    const authority = await operator(tx, request, uid);
    let now: Awaited<ReturnType<typeof current>>;
    try {now = await current(tx, command.transactionId, command.disputeId, undefined, parcel);} catch (error) {
      if (error instanceof HttpsError && ['not-found', 'failed-precondition', 'invalid-argument'].includes(error.code)) return noEffect('incomplete_case_history');
      throw error;
    }
    const preview = (await tx.get(caseRef.collection('commercial_return_previews').doc(command.previewId))).data();
    if (!preview || preview.actorId !== uid || preview.transactionId !== command.transactionId || preview.disputeId !== command.disputeId ||
        preview.sourceHash !== command.sourceHash || preview.semanticSourceHash !== command.semanticSourceHash || preview.corpusHash !== command.corpusHash ||
        preview.membersHash !== command.membersHash || preview.caseVersion !== command.caseVersion ||
        preview.returnRequestId !== command.returnRequestId || (preview.parcelCapability ?? null) !== (command.parcelCapability ?? null) ||
        supportHash(preview.contributionReferences) !== supportHash(command.contributionReferences) || supportHash(preview.evidenceReferences) !== supportHash(command.evidenceReferences))
      return noEffect('reference_unqualified');
    if (now.set.source.sourceHash !== command.sourceHash || now.semanticSourceHash !== command.semanticSourceHash || now.membersHash !== command.membersHash ||
        now.set.corpusHash !== command.corpusHash || now.set.root?.version !== command.caseVersion ||
        (now.order.returnRequest?.requestId ?? null) !== command.returnRequestId) return noEffect('source_changed');
    if (!now.disputeQualified || command.action === 'instruct_return' && !now.canInstruct) return noEffect('incomplete_case_history');
    const document = {protocol: 'product_commercial_return_instruction_v1', instructionId: id, caseId: now.set.source.caseId, actorId: uid, requestId,
      buyerId: now.order.buyerId, sellerId: now.order.sellerId, command, payloadHash, operatorAuthority: authority, recordedAt, ...PRODUCT_REVIEW_EFFECTS};
    const contentHash = supportSourceHash(document), instructionReference = {instructionId: id, contentHash};
    const prepared = await prepareOperationalNotices(tx, notices(id, document));
    if ((await tx.get(caseRef.collection('commercial_return_instructions').doc(id))).exists) throw new HttpsError('unavailable', 'Instruction sans reçu à rapprocher.');
    tx.create(caseRef.collection('commercial_return_instructions').doc(id), {protocol: document.protocol, document, contentHash});
    tx.update(db.collection('transactions').doc(command.transactionId), {productCommercialReturnInstruction: instructionReference});
    const r = {protocol: 'product_commercial_return_command_v1', actorId: uid, requestId, command, payloadHash, instructionId: id, instructionReference,
      state: 'committed', reason: null, recordedAt, notificationIds: prepared.notificationIds}; tx.create(ref, r); prepared.commit(); return view(uid, requestId, command, r);
  });
}

export async function readProductCommercialReturnInstructions(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'transactionId', 'scope', 'cursor', 'materialCapability', 'parcelCapability']);
  const transactionId = supportId(raw.transactionId), cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  const parcel = productParcelRequested(raw);
  if (!productMaterialRequested(raw)) throw new HttpsError('invalid-argument', 'Version matérielle explicite requise.');
  if (!['own', 'admin'].includes(raw.scope) || cursor !== null && (typeof cursor !== 'string' || !cursor || Buffer.byteLength(cursor) > 1500 || cursor.includes('/') || ['.', '..'].includes(cursor) || /^__.*__$/.test(cursor)))
    throw new HttpsError('invalid-argument', 'Portée et page explicites requises.');
  return db.runTransaction(async tx => {
    if (raw.scope === 'admin') await operator(tx, request, uid);
    const caseRef = productReviewCaseRef(context(transactionId)), root = (await tx.get(caseRef)).data();
    if (root?.protocol !== 'product_review_case_v1' || root.caseId !== productReviewCaseId(context(transactionId)) ||
        raw.scope === 'own' && ![root.nativeActors?.buyerId, root.nativeActors?.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Dossier natif non attribué.');
    let query: FirebaseFirestore.Query = caseRef.collection('commercial_return_instructions').orderBy('__name__').limit(21);
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query), inspected = page.docs.slice(0, 20), entries = [];
    for (const row of inspected) {
      const p = await proof(tx, transactionId, row.id, row.data()), d = p?.document;
      if (!d || !parcel && d.command.parcelCapability != null || raw.scope === 'own' && ![d.buyerId, d.sellerId].includes(uid)) {entries.push({qualification: 'unknown', instructionId: row.id, instruction: null}); continue;}
      entries.push({qualification: 'native_commercial_return_instruction', instruction: {instructionReference: {instructionId: row.id, contentHash: p!.contentHash},
        transactionId, disputeId: d.command.disputeId, caseId: d.caseId, action: d.command.action, partyMessage: d.command.partyMessage,
        sourceHash: d.command.sourceHash, semanticSourceHash: d.command.semanticSourceHash, membersHash: d.command.membersHash, corpusHash: d.command.corpusHash,
        caseVersion: d.command.caseVersion, recordedAt: d.recordedAt.toDate().toISOString(),
        ...(raw.scope === 'admin' ? {privateNote: d.command.privateNote, contributionReferences: d.command.contributionReferences, evidenceReferences: d.command.evidenceReferences} : {}),
        currentInstructionVerified: false, ...PRODUCT_REVIEW_EFFECTS}});
    }
    return {protocol: 'product_commercial_return_instructions_page_v1', actorId: uid, transactionId, scope: raw.scope, entries,
      readAt: Timestamp.now().toDate().toISOString(), nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null,
      coverage: {inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false}, ...PRODUCT_REVIEW_EFFECTS};
  });
}
