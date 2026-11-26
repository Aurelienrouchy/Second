/** Private, source-bound evidence for one reported chat message. Exposure is
 * declared, not verified; this module grants no financial or fault authority. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
import {supportUid, supportObject, supportHash, supportSourceHash, supportRequestId, supportRevision,
  supportCurrentAdminSession, supportAdmin} from './supportRequest';
import {assertRecentAccountAuthentication} from './eligibility';
import {CONTENT_SAFETY_CAPABILITY, CONTENT_SAFETY_ENABLED, contentCaseRef, readNativeReview} from './reviewVisibility';

const HASH = /^[a-f0-9]{64}$/;
const native = (v: any): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const flags = {exposureVerified: false, externalPaymentVerified: false, faultEstablished: false,
  refundAuthorized: false, recoveryVerified: false} as const;
export const MESSAGE_REPORT_OPERATIONS = new Set(['previewMessageReport', 'messageReportCommand']);
const receiptRef = (uid: string, requestId: string) => db.collection('message_report_commands').doc(supportHash([uid, requestId]));
function docId(v: unknown): string {
  if (typeof v !== 'string' || !v || v.trim() !== v || v.includes('/') || v === '.' || v === '..' || /^__.*__$/.test(v) || Buffer.byteLength(v, 'utf8') > 1500)
    throw new HttpsError('invalid-argument', 'Référence native invalide.');
  return v;
}
type Exposure = {linkOpened: 'declared_yes' | 'declared_no' | 'unknown'; informationShared: 'declared_yes' | 'declared_no' | 'unknown';
  externalPaymentDeclared: 'declared_yes' | 'declared_no' | 'unknown'};
type Command = {chatId: string; messageId: string; transactionId: string | null; previewId: string; sourceHash: string;
  sourceRevision: string; reason: string; description: string | null; exposure: Exposure; acknowledged: true;
  contentSafety?: {protocol: 'content_safety_statement_v1'; urgency: 'yes'|'no'|'unknown'; linkedReviewId: string|null}};
function parseCommand(value: unknown): Command {
  const d = supportObject(value, ['chatId', 'messageId', 'transactionId', 'previewId', 'sourceHash', 'sourceRevision',
    'reason', 'description', 'exposure', 'acknowledged', 'contentSafety']);
  const safety = d.contentSafety === undefined ? null : supportObject(d.contentSafety, ['protocol', 'urgency', 'linkedReviewId']);
  if (safety && (safety.protocol !== 'content_safety_statement_v1' || !['yes','no','unknown'].includes(safety.urgency) ||
      !['review_pressure','refund_pressure','threat','personal_information'].includes(d.reason) || d.description?.length > 1000))
    throw new HttpsError('invalid-argument', 'Motif et urgence déclarée explicites requis.');
  const e = supportObject(d.exposure, ['linkOpened', 'informationShared', 'externalPaymentDeclared']);
  if (![d.previewId, d.sourceHash, d.sourceRevision].every(v => typeof v === 'string' && HASH.test(v)) ||
      typeof d.reason !== 'string' || !d.reason.trim() || d.reason.length > 100 ||
      d.description !== null && (typeof d.description !== 'string' || d.description.length > 2000) ||
      !Object.values(e).every(v => ['declared_yes', 'declared_no', 'unknown'].includes(v as string)) || Object.keys(e).length !== 3 || d.acknowledged !== true)
    throw new HttpsError('invalid-argument', 'Déclaration et sources du message requises.');
  return {chatId: docId(d.chatId), messageId: docId(d.messageId), transactionId: d.transactionId === null ? null : docId(d.transactionId),
    previewId: d.previewId, sourceHash: d.sourceHash, sourceRevision: d.sourceRevision, reason: d.reason.trim(),
    description: d.description === null || !d.description.trim() ? null : d.description.trim(), exposure: e as Exposure, acknowledged: true,
    ...(safety ? {contentSafety: {protocol:'content_safety_statement_v1' as const, urgency:safety.urgency,
      linkedReviewId:safety.linkedReviewId === null ? null : docId(safety.linkedReviewId)}} : {})};
}
function messageReportId(uid: string, messageId: string) {
  const legacy = `${uid}_message_${messageId}`;
  return Buffer.byteLength(legacy, 'utf8') <= 1500 ? legacy : `message_${supportHash([uid, messageId])}`;
}
async function messageSource(tx: FirebaseFirestore.Transaction, uid: string, chatId: string, messageId: string, requestedOrderId: string | null, linkedReviewId?: string|null) {
  // Qualify the conversation BEFORE reading a supplied message/order ID. No
  // third-party existence, body, author or order fields cross this boundary.
  const chatSnap = await tx.get(db.collection('chats').doc(chatId)), chat = chatSnap.data(), participants = chat?.participants;
  if (!Array.isArray(participants) || participants.length !== 2 || new Set(participants).size !== 2 ||
      !participants.includes(uid) || participants.some(v => typeof v !== 'string' || !v || v.includes('/')))
    throw new HttpsError('permission-denied', 'Conversation participante indisponible.');
  const snap = await tx.get(db.collection('messages').doc(messageId)), m = snap.data();
  const missing = {qualification: 'unknown' as const, sourceHash: null, sourceRevision: null, privateSource: null};
  if (!m || m.chatId !== chatId || !participants.includes(m.senderId) || !['text', 'image', 'offer'].includes(m.type) ||
      m.receiverId != null && m.receiverId !== participants.find(v => v !== m.senderId) ||
      m.participants != null && (!Array.isArray(m.participants) || m.participants.length !== 2 || new Set(m.participants).size !== 2 ||
        m.participants.some((v: unknown) => !participants.includes(v))) ||
      m.type === 'text' && (typeof m.content !== 'string' || !m.content) || !snap.createTime || !snap.updateTime || !chatSnap.updateTime)
    return missing;
  // One exact native message only. Never copy chat.lastMessage or other messages.
  if (Buffer.byteLength(JSON.stringify(m), 'utf8') > 400_000) return missing;
  let order: {qualification: string; transactionId: string | null; revision: string | null; status: string | null; deliveryType: string | null} =
    {qualification: requestedOrderId ? 'unknown' : 'not_requested', transactionId: null, revision: null, status: null, deliveryType: null};
  if (requestedOrderId) {
    const os = await tx.get(db.collection('transactions').doc(requestedOrderId)), o = os.data();
    if (o && participants.includes(o.buyerId) && participants.includes(o.sellerId) && o.buyerId !== o.sellerId &&
        o.chatId === chatId && (chat?.transactionId == null || chat.transactionId === requestedOrderId) &&
        (m.offer?.transactionId == null || m.offer.transactionId === requestedOrderId))
      order = {qualification: 'native_linked_order', transactionId: requestedOrderId, revision: supportRevision(os),
        status: typeof o.status === 'string' ? o.status : null, deliveryType: typeof o.deliveryType === 'string' ? o.deliveryType : null};
  }
  const linked = linkedReviewId ? await readNativeReview(tx, linkedReviewId) : null;
  if (linkedReviewId && (!linked || !linked.parties.every(p => participants.includes(p)) ||
      requestedOrderId !== null && (linked.kind !== 'order' || linked.review.transactionId !== requestedOrderId))) return missing;
  const privateSource = {protocol: 'message_report_native_source_v1', actorId: uid, chatId, messageId,
    chatRevision: supportRevision(chatSnap), messageRevision: supportRevision(snap),
    participantIds: participants.slice().sort(), messageCreatedAt: snap.createTime, messageData: m,
    requestedTransactionId: requestedOrderId, order,
    ...(linkedReviewId === undefined ? {} : {linkedReview: linked ? {reviewId:linkedReviewId, sourceHash:linked.sourceHash,
      revision:supportRevision(linked.snap), transactionId:linked.review.transactionId, transactionKind:linked.kind} : null})};
  try {return {qualification: 'native_message' as const, sourceHash: supportSourceHash(privateSource),
    sourceRevision: supportHash([supportRevision(chatSnap), supportRevision(snap), order.revision]), privateSource};}
  catch (e) {if (e instanceof HttpsError && e.code === 'failed-precondition') return missing; throw e;}
}
function sourceView(s: Awaited<ReturnType<typeof messageSource>>, chatId: string, messageId: string) {
  return {protocol: 'message_report_source_v1', qualification: s.qualification, chatId, messageId,
    sourceHash: s.sourceHash, sourceRevision: s.sourceRevision, messageRevision: s.privateSource?.messageRevision ?? null,
    chatRevision: s.privateSource?.chatRevision ?? null, senderId: s.privateSource?.messageData.senderId ?? null,
    messageType: s.privateSource?.messageData.type ?? null,
    text: typeof s.privateSource?.messageData.content === 'string' ? s.privateSource.messageData.content : null,
    imagePresent: s.privateSource?.messageData.type === 'image', order: s.privateSource?.order ?? null, ...flags};
}
function previewId(uid: string, s: Awaited<ReturnType<typeof messageSource>>) {
  return s.qualification === 'native_message' ? supportHash(['message_report_v1', uid, s.sourceHash, s.sourceRevision]) : null;
}
function view(r: any, report?: any) {
  const reportStatus = report && report.reporterId === r.actorId && report.targetType === 'message' && report.targetId === r.command.messageId &&
    ['pending', 'reviewed', 'resolved', 'dismissed'].includes(report.status) ? report.status : null;
  return {protocol: 'message_report_command_v1', actorId: r.actorId, requestId: r.requestId, command: r.command,
    payloadHash: r.payloadHash, state: r.state, reason: r.reason, reportId: r.reportId, captureId: r.captureId,
    captureHash: r.captureHash, reportStatus, recordedAt: native(r.recordedAt) ? r.recordedAt.toDate().toISOString() : null, ...flags};
}
export async function handleMessageReport(request: any) {
  return withPrivateAccountSession(request,async()=>{
  const uid = supportUid(request), raw = request.data;
  if (raw.capability !== 'message_report_v1') throw new HttpsError('invalid-argument', 'Version explicite du signalement message requise.');
  const safety = raw.contentSafetyCapability === CONTENT_SAFETY_CAPABILITY;
  if (raw.contentSafetyCapability !== undefined && !safety) throw new HttpsError('invalid-argument', 'Version de sécurité du contenu requise.');
  if (raw.operation === 'previewMessageReport') {
    supportObject(raw, ['operation', 'capability', 'contentSafetyCapability', 'expectedUid', 'chatId', 'messageId', 'transactionId', 'linkedReviewId']);
    if (!safety && raw.linkedReviewId !== undefined) throw new HttpsError('invalid-argument', 'Liaison explicite requise.');
    if (safety && !CONTENT_SAFETY_ENABLED) throw new HttpsError('failed-precondition','Parcours de sécurité en préparation.',{reason:'content_safety_not_exposed'});
    const chatId = docId(raw.chatId), messageId = docId(raw.messageId), transactionId = raw.transactionId == null ? null : docId(raw.transactionId);
    const linkedReviewId = safety ? raw.linkedReviewId == null ? null : docId(raw.linkedReviewId) : undefined;
    return db.runTransaction(async tx => {await assertPrivateAccountSession(request,tx);const s = await messageSource(tx, uid, chatId, messageId, transactionId, linkedReviewId);
      return {protocol: 'message_report_preview_v1', actorId: uid, previewId: previewId(uid, s), source: sourceView(s, chatId, messageId),
        ...(safety?{contentSafety:{capability:CONTENT_SAFETY_CAPABILITY,linkedReviewId:linkedReviewId??null,
          linkedReviewQualification:linkedReviewId?s.privateSource?.linkedReview?'native_linked_review':'unknown':'not_requested'}}:{}),...flags};});
  }
  if (raw.operation !== 'messageReportCommand') throw new HttpsError('invalid-argument', 'Opération message inconnue.');
  supportObject(raw, ['operation', 'capability', 'contentSafetyCapability', 'expectedUid', 'requestId', 'mode', 'command']);
  const command = parseCommand(raw.command), requestId = supportRequestId(raw.requestId), payloadHash = supportHash(command);
  if (safety !== (command.contentSafety !== undefined)) throw new HttpsError('invalid-argument','Conservez la version de l’intention originale.');
  if (!['execute', 'observe', 'neutralize'].includes(raw.mode)) throw new HttpsError('invalid-argument', 'Mode du journal invalide.');
  return db.runTransaction(async tx => {await assertPrivateAccountSession(request,tx);
    const ref = receiptRef(uid, requestId), previous = (await tx.get(ref)).data();
    if (previous) {
      if (previous.protocol !== 'message_report_command_v1' || previous.actorId !== uid || previous.requestId !== requestId ||
          previous.payloadHash !== payloadHash || supportHash(previous.command) !== payloadHash || !native(previous.recordedAt) ||
          !['committed', 'not_executed'].includes(previous.state)) throw new HttpsError('already-exists', 'Cette intention possède un autre contenu.');
      const report = previous.reportId ? (await tx.get(db.collection('reports').doc(previous.reportId))).data() : null;
      return view(previous, report);
    }
    const base = {protocol: 'message_report_command_v1', actorId: uid, requestId, command, payloadHash,
      state: 'unrecorded', reason: null, reportId: null, captureId: null, captureHash: null, recordedAt: null};
    if (raw.mode === 'observe') return view(base);
    const refuse = (reason: string) => {const r = {...base, state: 'not_executed', reason, recordedAt: Timestamp.now()};
      tx.create(ref, r); return view(r);};
    if (raw.mode === 'neutralize') return refuse('requester_neutralized');
    if (safety && !CONTENT_SAFETY_ENABLED) return refuse('content_safety_not_exposed');
    try {await supportCurrentAdminSession(request);} catch (e) {
      if (e instanceof HttpsError && e.code === 'permission-denied' || (e as {code?: string})?.code === 'auth/user-not-found')
        return refuse('participant_session_unavailable'); throw e;
    }
    let s: Awaited<ReturnType<typeof messageSource>>;
    try {s = await messageSource(tx, uid, command.chatId, command.messageId, command.transactionId, command.contentSafety?.linkedReviewId);} catch (e) {
      if (e instanceof HttpsError && e.code === 'permission-denied') return refuse('message_source_unavailable'); throw e;
    }
    if (s.qualification !== 'native_message') return refuse('message_source_unavailable');
    if (s.sourceHash !== command.sourceHash || s.sourceRevision !== command.sourceRevision || previewId(uid, s) !== command.previewId)
      return refuse('source_changed');
    const reportId = messageReportId(uid, command.messageId), reportRef = db.collection('reports').doc(reportId), existing = await tx.get(reportRef);
    if (existing.exists) return refuse('report_already_exists');
    const now = Timestamp.now(), captureId = 'message_' + supportHash([uid, requestId]);
    const caseRef = command.contentSafety ? contentCaseRef('message', command.messageId) : null;
    const caseData = caseRef ? (await tx.get(caseRef)).data() : null;
    if (caseData && (caseData.protocol !== 'content_moderation_case_v1' || caseData.targetType !== 'message' || caseData.targetId !== command.messageId ||
        !Number.isSafeInteger(caseData.version) || caseData.version < 1 || caseData.version >= Number.MAX_SAFE_INTEGER - 1)) return refuse('content_case_unknown');
    const capture = {protocol: 'message_report_capture_v1', reportId, actorId: uid, requestId, commandHash: payloadHash,
      source: s.privateSource, sourceHash: s.sourceHash, sourceRevision: s.sourceRevision, exposure: command.exposure,
      reason: command.reason, description: command.description, capturedAt: now};
    const captureHash = supportSourceHash(capture), captureRef = reportRef.collection('native_evidence').doc(captureId);
    if ((await tx.get(captureRef)).exists) return refuse('capture_identity_conflict');
    const r = {...base, state: 'committed', reportId, captureId, captureHash, recordedAt: now};
    tx.create(reportRef, {id: reportId, reporterId: uid, reporterName: 'Un membre', targetType: 'message', targetId: command.messageId,
      targetOwnerId: s.privateSource!.messageData.senderId, reason: command.reason, description: command.description, status: 'pending', createdAt: now,
      messageEvidence: {protocol: 'message_report_reference_v1', captureId, captureHash},
      ...(command.contentSafety ? {contentSafety:command.contentSafety} : {})});
    tx.create(captureRef, {...capture, captureHash}); tx.create(ref, r);
    if (caseRef) tx.set(caseRef, {...(caseData ?? {}),protocol:'content_moderation_case_v1',targetType:'message',targetId:command.messageId,
      version:(caseData?.version ?? 0)+1,original:caseData?.original ?? null});
    return view(r, {reporterId: uid, targetType: 'message', targetId: command.messageId, status: 'pending'});
  });
  });
}
/** The full native message stays in the denied anchor. The authorized reader
 * returns the selected content, not arbitrary offer addresses or hidden maps. */
function capturedMessageView(source: any) {
  const m = source.messageData, text = (v: unknown) => typeof v === 'string' ? v : null;
  const size = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  return {protocol: 'message_report_captured_content_v1', actorId: source.actorId, chatId: source.chatId, messageId: source.messageId,
    chatRevision: source.chatRevision, messageRevision: source.messageRevision, participantIds: source.participantIds,
    messageCreatedAt: native(source.messageCreatedAt) ? source.messageCreatedAt.toDate().toISOString() : null,
    message: {senderId: m.senderId, receiverId: text(m.receiverId), type: m.type, content: text(m.content),
      image: m.type === 'image' ? {url: text(m.image?.url), width: size(m.image?.width), height: size(m.image?.height),
        thumbnail: text(m.image?.thumbnail)} : null,
      offer: m.type === 'offer' ? {amount: size(m.offer?.amount), status: text(m.offer?.status), message: text(m.offer?.message)} : null},
    requestedTransactionId: source.requestedTransactionId, order: source.order};
}

/** Reports were historically client-writable. Only the server-only anchor AND
 * its own immutable journal can qualify a native message, never a report flag. */
export async function messageReportProjection(tx: FirebaseFirestore.Transaction, reportId: string, report: any, full = false) {
  const pointer = report?.messageEvidence;
  const unknown = {protocol: 'message_report_evidence_v1', reportId, qualification: 'unknown', sourceCurrentQualification: 'unknown',
    capturedAt: null, chatId: null, messageId: null, sourceHash: null, sourceRevision: null, exposure: null, source: null, ...flags};
  if (report?.targetType !== 'message' || pointer?.protocol !== 'message_report_reference_v1' ||
      !/^message_[a-f0-9]{64}$/.test(pointer.captureId ?? '') || !HASH.test(pointer.captureHash ?? '')) return unknown;
  const c = (await tx.get(db.collection('reports').doc(reportId).collection('native_evidence').doc(pointer.captureId))).data();
  if (!c || c.protocol !== 'message_report_capture_v1' || c.reportId !== reportId || c.actorId !== report.reporterId ||
      c.source?.messageId !== report.targetId || c.source?.messageData?.senderId !== report.targetOwnerId ||
      !native(c.capturedAt) || c.captureHash !== pointer.captureHash || !HASH.test(c.commandHash ?? '') || c.sourceHash !== supportSourceHash(c.source)) return unknown;
  const {captureHash: _hash, ...body} = c;
  if (supportSourceHash(body) !== c.captureHash) return unknown;
  const receipt = (await tx.get(receiptRef(c.actorId, c.requestId))).data();
  if (!receipt || receipt.protocol !== 'message_report_command_v1' || receipt.actorId !== c.actorId || receipt.requestId !== c.requestId ||
      !native(receipt.recordedAt) || receipt.state !== 'committed' || receipt.reportId !== reportId || receipt.captureId !== pointer.captureId ||
      receipt.captureHash !== c.captureHash || receipt.payloadHash !== c.commandHash || supportHash(receipt.command) !== c.commandHash ||
      receipt.command.reason !== c.reason || receipt.command.description !== c.description || report.reason !== c.reason ||
      (report.description ?? null) !== c.description) return unknown;
  let current = 'unknown';
  if (full) try {const s = await messageSource(tx, c.actorId, c.source.chatId, c.source.messageId, c.source.requestedTransactionId, receipt.command.contentSafety?.linkedReviewId);
    current = s.qualification === 'native_message' ? s.sourceHash === c.sourceHash ? 'same_native_source' : 'changed' : 'unknown';
  } catch (e) {if (!(e instanceof HttpsError && e.code === 'permission-denied')) throw e;}
  return {protocol: 'message_report_evidence_v1', reportId, qualification: 'native_capture', sourceCurrentQualification: current,
    capturedAt: c.capturedAt.toDate().toISOString(), chatId: c.source.chatId, messageId: c.source.messageId,
    sourceHash: c.sourceHash, sourceRevision: c.sourceRevision, exposure: c.exposure,
    source: full ? capturedMessageView(c.source) : null, ...flags};
}
export async function readAdminMessageReport(request: any) {
  return withPrivateAccountSession(request,async()=>{
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'capability', 'expectedUid', 'reportId']);
  if (raw.capability !== 'message_report_v1') throw new HttpsError('invalid-argument', 'Version message requise.');
  const reportId = docId(raw.reportId);
  return db.runTransaction(async tx => {await assertPrivateAccountSession(request,tx);await supportCurrentAdminSession(request); assertRecentAccountAuthentication(request.auth.token); await supportAdmin(tx, uid, false);
    const report = (await tx.get(db.collection('reports').doc(reportId))).data();
    if (!report || report.targetType !== 'message') throw new HttpsError('not-found', 'Signalement message indisponible.');
    const projection=await messageReportProjection(tx, reportId, report, true);
    await assertPrivateAccountSession(request,tx);await supportCurrentAdminSession(request);await supportAdmin(tx,uid,false);
    return {...projection, actorId: uid};});
  });
}
