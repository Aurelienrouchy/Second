/** First actual furnishing of an accepted return document, not label creation.
 * Deadlines are documentary. No expiry here changes money, fault or stock. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {createHash} from 'node:crypto';
import {db} from '../config/firebase';
import {getShipEngine, savedLifecycleLabelIdentity, type CurrentLabelDocumentIdentity} from '../config/shipEngine';
import {RETURN_DEPOSIT_TERMS, returnDepositCalendarDeadline} from './returnDepositTerms';
import {returnHash, committedReturnReceipt} from './returnRequest';
import {supportAdmin, supportCurrentAdminSession, supportHash, supportId, supportObject, supportRequestId,
  supportSourceHash, supportText, supportUid} from './supportRequest';
import {assertAccountSecurityOpen, assertRecentAccountAuthentication} from './eligibility';
import {prepareOperationalNotices, readOperationalNoticeReceipts, type OperationalNoticeInput} from './notifications';
import {checkRateLimit} from './rateLimit';
import {isDevCommerceShippingTestRuntime} from '../config/runtimeEnvironment';

export const RETURN_DEPOSIT_DEADLINE_CAPABILITY = 'return_deposit_deadline_v1';
export function hasReturnDepositTerms(order: FirebaseFirestore.DocumentData): boolean {
  const q = order.returnRequest?.quote;
  return !!q && (Object.prototype.hasOwnProperty.call(q, 'depositTerms') || Object.prototype.hasOwnProperty.call(q, 'depositTermsHash')) ||
    Object.prototype.hasOwnProperty.call(order.returnRequest?.acceptance ?? {}, 'returnDepositTermsHash');
}
type NativeSource = {snapshot: FirebaseFirestore.DocumentSnapshot; identity: CurrentLabelDocumentIdentity | null; unique: boolean};
export type ReturnDepositSourceReader = (tx: FirebaseFirestore.Transaction, id: string) => Promise<NativeSource>;
const base = (id: string) => db.collection('transactions').doc(id);
const clockRef = (id: string) => base(id).collection('return_deposit').doc('current');
const receiptRef = (id: string, uid: string, rid: string) => base(id).collection('return_deposit_commands').doc(supportHash([uid, rid]));
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && Number.isSafeInteger(v.toMillis()) && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const effects = {financialEffectAuthorized: false, refundDecisionGranted: false, faultEstablished: false,
  shippingPermissionGranted: false, contentsReceivedConfirmed: false};
type Command = {action: 'make_available' | 'extend'; sourceHash: string; expectedVersion: number; expectedLabelId: string;
  newDueAtMs: number | null; motivation: string | null; partyMessage: string | null; acknowledged: true};
function parseCommand(raw: unknown): Command {
  const c = supportObject(raw, ['action', 'sourceHash', 'expectedVersion', 'expectedLabelId', 'newDueAtMs', 'motivation', 'partyMessage', 'acknowledged']);
  if (!['make_available', 'extend'].includes(c.action) || !hash(c.sourceHash) || !Number.isSafeInteger(c.expectedVersion) ||
      c.expectedVersion < 0 || c.acknowledged !== true ||
      (c.action === 'make_available' ? c.expectedVersion !== 0 || c.newDueAtMs !== null || c.motivation !== null || c.partyMessage !== null
        : !Number.isSafeInteger(c.newDueAtMs) || c.newDueAtMs < 0 || c.newDueAtMs > Date.UTC(2100, 0, 1)))
    throw new HttpsError('invalid-argument', 'Source, étiquette et instruction exacte requises.');
  return {action: c.action, sourceHash: c.sourceHash, expectedVersion: c.expectedVersion, expectedLabelId: supportId(c.expectedLabelId),
    newDueAtMs: c.newDueAtMs, motivation: c.action === 'extend' ? supportText(c.motivation, 'Motivation', 2000) : null,
    partyMessage: c.action === 'extend' ? supportText(c.partyMessage, 'Message aux membres', 2000) : null, acknowledged: true};
}
function receiptView(id: string, uid: string, rid: string, c: Command, value: any) {
  if (value && (value.protocol !== 'return_deposit_command_v1' || value.transactionId !== id || value.ownerId !== uid ||
      value.requestId !== rid || value.payloadHash !== supportHash(c) || supportHash(value.command) !== supportHash(c) ||
      !native(value.recordedAt) || !['committed', 'not_executed', 'neutralized'].includes(value.state)))
    throw new HttpsError('failed-precondition', 'Le reçu de cette instruction doit être rapproché.');
  return {protocol: 'return_deposit_deadline_receipt_v1', transactionId: id, ownerId: uid, requestId: rid, command: c,
    payloadHash: supportHash(c), state: value?.state ?? 'absent', recordedAt: value?.recordedAt.toDate().toISOString() ?? null,
    reason: value?.reason ?? null, clockVersion: value?.clockVersion ?? null, ...effects};
}
function acceptedTerms(id: string, order: FirebaseFirestore.DocumentData) {
  const r = order.returnRequest, q = r?.quote, a = r?.acceptance;
  return committedReturnReceipt(id, order) && q?.depositTermsHash === returnHash(RETURN_DEPOSIT_TERMS) &&
    returnHash(q.depositTerms ?? null) === returnHash(RETURN_DEPOSIT_TERMS) && a?.returnDepositTermsHash === q.depositTermsHash &&
    a.actorUid === order.buyerId && a.quoteId === q.quoteId && a.rateId === q.rateId && native(a.acceptedAt);
}
/** Exact public download host/path documented by ShipEngine. No client URL,
 * API key, Authorization header, arbitrary port or redirected request. */
export function qualifiedReturnPdfUrl(value: unknown, expectedDevLabelId?: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  if (expectedDevLabelId !== undefined && !/^se-devsim-[a-f0-9]{32}$/.test(expectedDevLabelId)) return null;
  try {
    const url = new URL(value);
    // The generated Dev PDF has a different origin from real carrier files.
    // Qualify only its exact project, private object and native label identity.
    if (url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com' && !url.port && !url.username && !url.password && !url.hash &&
        isDevCommerceShippingTestRuntime()) {
      const path = url.pathname.match(/^\/v0\/b\/seconde-dev\.firebasestorage\.app\/o\/dev-commerce-labels%2[Ff](se-devsim-[a-f0-9]{32})\.pdf$/);
      if (path && (expectedDevLabelId === undefined || path[1] === expectedDevLabelId) && url.searchParams.size === 2 &&
          url.searchParams.get('alt') === 'media' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(url.searchParams.get('token') ?? ''))
        return url.toString();
    }
    if (expectedDevLabelId !== undefined) return null;
    return url.protocol === 'https:' && url.hostname === 'api.shipengine.com' && !url.port && !url.username && !url.password && !url.hash &&
      /^\/v1\/downloads\/[A-Za-z0-9_/-]+\.pdf$/.test(url.pathname) &&
      [...url.searchParams].every(([k, v]) => k === 'download' && ['0', '1'].includes(v) || k === 'rotation' && ['0', '90', '180', '270'].includes(v)) ? url.toString() : null;
  } catch {return null;}
}
export async function readReturnPdfAvailability(url: string, expectedDevLabelId?: string): Promise<{documentHash: string; urlHash: string; byteLength: number; observedAtMs: number} | null> {
  const qualified = qualifiedReturnPdfUrl(url, expectedDevLabelId);
  if (!qualified) return null;
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 8000), maxBytes = 2 * 1024 * 1024;
  try {
    const response = await fetch(qualified, {method: 'GET', redirect: 'error', signal: abort.signal, headers: {Accept: 'application/pdf'}});
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const length = response.headers.get('content-length');
    if (response.status !== 200 || contentType !== 'application/pdf' || !response.body ||
        length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {await response.body?.cancel(); return null;}
    const reader = response.body.getReader(), digest = createHash('sha256'); let bytes = 0, prefix = Buffer.alloc(0);
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {await reader.cancel(); return null;}
      if (prefix.length < 5) prefix = Buffer.concat([prefix, Buffer.from(chunk.value).subarray(0, 5 - prefix.length)]);
      digest.update(chunk.value);
    }
    if (bytes < 5 || prefix.toString('ascii') !== '%PDF-' || length !== null && bytes !== Number(length)) return null;
    return {documentHash: digest.digest('hex'), urlHash: supportHash(qualified), byteLength: bytes, observedAtMs: Date.now()};
  } catch {return null;} finally {clearTimeout(timer);}
}
type PdfAvailability = NonNullable<Awaited<ReturnType<typeof readReturnPdfAvailability>>>;
type BuyerSessionWitness = {ownerId: string; authTimeMs: number; qualifiedAt: Timestamp};
/** The same current, non-voided label is read on both sides of the bounded
 * public PDF GET. This checks availability, never physical usability. */
export async function qualifyReturnLabelDocument(identity: CurrentLabelDocumentIdentity, includeDocumentUrl = false): Promise<(PdfAvailability & {documentUrl?: string}) | null> {
  const engine = getShipEngine(); if (!engine) return null;
  const before = await engine.readCurrentLabelDocument(identity);
  if (before.observation !== 'document_available' || !before.documentUrl) return null;
  const pdf = await readReturnPdfAvailability(before.documentUrl,
    /^se-devsim-[a-f0-9]{32}$/.test(identity.labelId) ? identity.labelId : undefined); if (!pdf) return null;
  const after = await engine.readCurrentLabelDocument(identity);
  return after.observation === 'document_available' && after.documentUrl === before.documentUrl
    ? includeDocumentUrl ? {...pdf, documentUrl: before.documentUrl} : pdf : null;
}
function notices(id: string, order: any, entry: any): OperationalNoticeInput[] {
  return [order.buyerId, order.sellerId].map(userId => ({eventKey: `return_deposit_v1:${id}:${entry.commandId}`, userId,
    type: 'product_review_update', title: entry.action === 'make_available' ? 'Étiquette de retour mise à disposition' : 'Délai de dépôt prolongé',
    message: entry.action === 'make_available' ? 'Le document de retour actuel a été vérifié accessible et mis à votre disposition dans cette commande. Le délai accepté est de sept jours calendaires à la même heure au Québec. Une prolongation motivée reste possible ; dépasser ce délai ne décide ni faute ni remboursement.' : entry.partyMessage,
    data: {ownerId: userId, transactionId: id}}));
}
async function qualifyClock(tx: FirebaseFirestore.Transaction, id: string, order: any, raw: any) {
  if (!raw) return null;
  if (raw.protocol !== 'return_deposit_clock_v1' || raw.transactionId !== id || raw.buyerId !== order.buyerId || raw.sellerId !== order.sellerId ||
      !acceptedTerms(id, order) || raw.termsHash !== returnHash(RETURN_DEPOSIT_TERMS) || !Array.isArray(raw.entries) || raw.entries.length < 1 ||
      raw.entries.length > 20 || raw.version !== raw.entries.length || !native(raw.availableAt) ||
      raw.entries[0].action !== 'make_available' || !['native_label_commit', 'member_document_furnishing_v1'].includes(raw.entries[0].origin) ||
      raw.entries[0].actorId !== order.buyerId || !raw.entries[0].recordedAt?.isEqual(raw.availableAt)) return null;
  let dueAtMs = returnDepositCalendarDeadline(raw.availableAt.toMillis());
  for (let index = 0; index < raw.entries.length; index++) {
    const e = raw.entries[index];
    const deferred = index === 0 && e.origin === 'member_document_furnishing_v1';
    const nativeCommit = index === 0 && (e.origin === 'native_label_commit' || deferred);
    if (!native(e.recordedAt) || e.version !== index + 1 || !hash(e.commandId) || !hash(e.commandHash) ||
        e.commandId !== supportHash(nativeCommit ? [e.origin, id, e.actorId, e.requestId] : [e.actorId, e.requestId]) || (index > 0 && (e.action !== 'extend' || e.priorEntryHash !== supportSourceHash(raw.entries[index - 1]) ||
          !Number.isSafeInteger(e.newDueAtMs) || e.newDueAtMs <= (dueAtMs ?? raw.availableAt.toMillis()) ||
          typeof e.motivation !== 'string' || !e.motivation.trim() || typeof e.partyMessage !== 'string' || !e.partyMessage.trim()))) return null;
    if (nativeCommit) {
      if (e.requestId !== order.returnRequest.requestId || (!deferred && !order.returnRequest.committedAt?.isEqual(e.recordedAt)) ||
          e.commandHash !== furnishingSourceHash(id, order) || e.labelId !== order.returnRequest.labelProof.labelId ||
          e.pdf?.urlHash !== supportHash(qualifiedReturnPdfUrl(order.returnRequest.labelProof.labelUrl)) ||
          e.buyerSession?.ownerId !== order.buyerId || !Number.isSafeInteger(e.buyerSession?.authTimeMs) || e.buyerSession.authTimeMs <= 0 ||
          !native(e.buyerSession.qualifiedAt) || e.buyerSession.authTimeMs > e.buyerSession.qualifiedAt.toMillis() ||
          e.buyerSession.qualifiedAt.toMillis() > e.recordedAt.toMillis() ||
          e.recordedAt.toMillis() - e.buyerSession.qualifiedAt.toMillis() > 60_000) return null;
      if (deferred) {
        const {readConvenienceReturnCostResolution} = await import('./convenienceReturnIncident');
        const resolution = await readConvenienceReturnCostResolution(tx, id, order);
        if (!resolution || resolution.document.documentFurnishing !== 'buyer_read_required' ||
            e.resolutionId !== resolution.document.resolutionId || !e.labelCommittedAt?.isEqual(order.returnRequest.committedAt) ||
            e.labelCommittedAt.toMillis() > e.recordedAt.toMillis()) return null;
      }
    } else {
      const receipt = (await tx.get(receiptRef(id, e.actorId, e.requestId))).data();
      if (!receipt || receipt.state !== 'committed' || receipt.payloadHash !== e.commandHash || receipt.clockVersion !== index + 1 ||
          !receipt.recordedAt?.isEqual(e.recordedAt) || receipt.command?.action !== e.action ||
          receiptView(id, e.actorId, e.requestId, parseCommand(receipt.command), receipt).state !== 'committed') return null;
      if (receipt.command.expectedVersion !== index || receipt.command.expectedLabelId !== e.labelId ||
          index > 0 && (receipt.operatorValidated !== true || receipt.command.newDueAtMs !== e.newDueAtMs ||
            receipt.command.motivation !== e.motivation || receipt.command.partyMessage !== e.partyMessage)) return null;
    }
    if (index === 0 && (!hash(e.pdf?.documentHash) || !hash(e.pdf?.urlHash) || !Number.isSafeInteger(e.pdf?.byteLength) || e.pdf.byteLength < 5 ||
        e.pdf.byteLength > 2 * 1024 * 1024 || !Number.isSafeInteger(e.pdf?.observedAtMs) || e.pdf.observedAtMs > e.recordedAt.toMillis() ||
        e.recordedAt.toMillis() - e.pdf.observedAtMs > 60_000 || e.labelId !== raw.baseLabelId ||
        dueAtMs !== e.newDueAtMs)) return null;
    if (index > 0) dueAtMs = e.newDueAtMs;
    const noticeReceipts = await readOperationalNoticeReceipts(tx, notices(id, order, e));
    if (noticeReceipts.some(r => !r) || supportHash(noticeReceipts.map(r => r!.notificationId)) !== supportHash(e.notificationIds)) return null;
  }
  return {raw, dueAtMs};
}
function furnishingSourceHash(id: string, order: FirebaseFirestore.DocumentData): string {
  const r = order.returnRequest;
  return supportSourceHash({protocol: 'return_document_furnishing_source_v1', transactionId: id,
    buyerId: order.buyerId, sellerId: order.sellerId, requestId: r.requestId, sourceHash: r.sourceHash,
    quote: r.quote, acceptance: r.acceptance, labelProof: r.labelProof, committedAt: r.committedAt});
}
/** Called before the FIRST ready-label write. All reads/notices are prepared
 * before writes; the caller commits this together with its label proof/URL. */
export async function prepareInitialReturnDocumentFurnishing(tx: FirebaseFirestore.Transaction, id: string,
  prospective: FirebaseFirestore.DocumentData, pdf: PdfAvailability | null, buyerSession: BuyerSessionWitness | null, memberFurnishedAt?: Timestamp) {
  if (!hasReturnDepositTerms(prospective)) return {commit: () => {}};
  const r = prospective.returnRequest, at = memberFurnishedAt ?? r?.committedAt, deferred = memberFurnishedAt !== undefined;
  let resolution: any = null;
  if (deferred) {
    const {readConvenienceReturnCostResolution} = await import('./convenienceReturnIncident');
    resolution = await readConvenienceReturnCostResolution(tx, id, prospective);
    if (!resolution || resolution.document.documentFurnishing !== 'buyer_read_required' || !native(r?.committedAt) || r.committedAt.toMillis() > at.toMillis())
      throw new HttpsError('failed-precondition', 'La fourniture différée doit être liée à la résolution native du coût.');
  }
  if (!acceptedTerms(id, prospective) || !native(at) || !pdf || pdf.observedAtMs > at.toMillis() ||
      at.toMillis() - pdf.observedAtMs > 60_000 || pdf.urlHash !== supportHash(qualifiedReturnPdfUrl(r.labelProof.labelUrl)) ||
      buyerSession?.ownerId !== prospective.buyerId || !native(buyerSession?.qualifiedAt) || buyerSession.qualifiedAt.toMillis() > at.toMillis() ||
      !Number.isSafeInteger(buyerSession.authTimeMs) || buyerSession.authTimeMs <= 0 || buyerSession.authTimeMs > buyerSession.qualifiedAt.toMillis() ||
      at.toMillis() - buyerSession.qualifiedAt.toMillis() > 60_000)
    throw new HttpsError('failed-precondition', 'La première fourniture effective du document doit être qualifiée avant sa mise à disposition.');
  // Never manufacture a later first date for an already exposed/unknown source.
  const existing = await tx.get(clockRef(id));
  if (existing.exists) {
    if (deferred && await qualifyClock(tx, id, prospective, existing.data())) return {commit: () => {}};
    throw new HttpsError('failed-precondition', 'La première fourniture existante doit être rapprochée.');
  }
  const origin = deferred ? 'member_document_furnishing_v1' : 'native_label_commit';
  const entry = {action: 'make_available', origin, actorId: prospective.buyerId, requestId: r.requestId,
    commandId: supportHash([origin, id, prospective.buyerId, r.requestId]), commandHash: furnishingSourceHash(id, prospective),
    version: 1, recordedAt: at, labelId: r.labelProof.labelId, pdf, buyerSession,
    newDueAtMs: returnDepositCalendarDeadline(at.toMillis()), motivation: null, partyMessage: null,
    ...(deferred ? {resolutionId: resolution.document.resolutionId, labelCommittedAt: r.committedAt} : {})};
  const prepared = await prepareOperationalNotices(tx, notices(id, prospective, entry));
  return {commit: () => {
    tx.create(clockRef(id), {protocol: 'return_deposit_clock_v1', transactionId: id, buyerId: prospective.buyerId,
      sellerId: prospective.sellerId, availableAt: at, baseLabelId: r.labelProof.labelId,
      termsHash: returnHash(RETURN_DEPOSIT_TERMS), version: 1, entries: [{...entry, notificationIds: prepared.notificationIds}]});
    prepared.commit();
  }};
}
/** E16/DTO guard for a new-policy historical inconsistency. Absence never
 * authorizes a late button-created first clock. Legacy terms are unchanged. */
export async function returnDocumentFurnished(tx: FirebaseFirestore.Transaction, id: string, order: FirebaseFirestore.DocumentData): Promise<boolean> {
  if (!hasReturnDepositTerms(order)) return true;
  return !!await qualifyClock(tx, id, order, (await tx.get(clockRef(id))).data());
}
/** Pure timing/label gate, AFTER the native clock/instruction is qualified.
 * A replacement never restarts the first date. Only an exact later operator
 * instruction can cover its current label and future deposit deadline. */
export function returnDepositInstructionAllowsNewDeposit(dueAtMs: number | null, instructionLabelId: string | null,
  currentLabelId: string | null, nowMs = Date.now()): boolean {
  return Number.isSafeInteger(dueAtMs) && Number.isSafeInteger(nowMs) && nowMs >= 0 && (dueAtMs as number) > nowMs &&
    typeof instructionLabelId === 'string' && instructionLabelId.length > 0 && instructionLabelId === currentLabelId;
}
export async function returnDepositAllowsNewDeposit(tx: FirebaseFirestore.Transaction, id: string, order: FirebaseFirestore.DocumentData): Promise<boolean> {
  if (!hasReturnDepositTerms(order)) return true;
  const clock = await qualifyClock(tx, id, order, (await tx.get(clockRef(id))).data());
  if (!clock) return false;
  const currentLabelId = Object.prototype.hasOwnProperty.call(order.labelLifecycleCurrent ?? {}, 'return')
    ? savedLifecycleLabelIdentity(id, order, 'return')?.labelId ?? null : typeof order.returnLabelId === 'string' ? order.returnLabelId : null;
  return returnDepositInstructionAllowsNewDeposit(clock.dueAtMs, clock.raw.entries.at(-1)?.labelId ?? null, currentLabelId);
}
function currentSourceHash(source: NativeSource, clock: any) {
  return supportSourceHash({order: source.snapshot.data(), revision: source.snapshot.updateTime,
    identity: source.identity, unique: source.unique, clock: clock ?? null});
}
export async function handleReturnDepositDeadline(request: any, readSource: ReturnDepositSourceReader) {
  const uid = supportUid(request), input = supportObject(request.data, ['capability', 'expectedUid', 'expectedAdminUid', 'transactionId', 'mode', 'scope', 'requestId', 'command']);
  const id = supportId(input.transactionId), mode = input.mode, operator = input.scope === 'operator';
  if (input.capability !== RETURN_DEPOSIT_DEADLINE_CAPABILITY || !['owner', 'operator'].includes(input.scope) ||
      !['preview', 'execute', 'observe', 'neutralize'].includes(mode) || operator && input.expectedAdminUid !== uid ||
      !operator && input.expectedAdminUid !== undefined) throw new HttpsError('invalid-argument', 'Version, action et périmètre explicites requis.');
  const c = mode === 'preview' ? null : parseCommand(input.command), rid = c ? supportRequestId(input.requestId) : null;
  const rref = c ? receiptRef(id, uid, rid!) : null;
  if (rref) {
    const old = (await rref.get()).data();
    if (old) return receiptView(id, uid, rid!, c!, old);
    if (mode === 'observe') return receiptView(id, uid, rid!, c!, null);
  }
  await checkRateLimit(uid, true, {functionName: 'returnDepositDeadline', maxCallsAuthenticated: 15, maxCallsUnauthenticated: 0, windowMs: 60_000});
  const terminal = (state: 'neutralized' | 'not_executed' | 'committed', reason: string | null, version: number | null = null, at = Timestamp.now()) => ({
    protocol: 'return_deposit_command_v1', transactionId: id, ownerId: uid, requestId: rid, command: c, payloadHash: supportHash(c), state,
    reason, clockVersion: version, recordedAt: at});
  if (mode === 'neutralize') return db.runTransaction(async tx => {
    const old = (await tx.get(rref!)).data(); if (old) return receiptView(id, uid, rid!, c!, old);
    const record = terminal('neutralized', 'owner_neutralized'); tx.create(rref!, record); return receiptView(id, uid, rid!, c!, record);
  });
  let currentAdminClaim = false;
  if (operator) {
    currentAdminClaim = await supportCurrentAdminSession(request);
    if (mode === 'execute') assertRecentAccountAuthentication(request.auth.token);
  }
  const read = async (tx: FirebaseFirestore.Transaction) => {
    const source = await readSource(tx, id), order = source.snapshot.data();
    if (!order) throw new HttpsError('not-found', 'Commande native introuvable.');
    if (operator) await supportAdmin(tx, uid, currentAdminClaim);
    else if (![order.buyerId, order.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Commande privée réservée à ses membres.');
    const raw = (await tx.get(clockRef(id))).data(), clock = raw ? await qualifyClock(tx, id, order, raw) : null;
    const termsAccepted = acceptedTerms(id, order), sourceHash = currentSourceHash(source, raw);
    // Initial availability is committed with the label itself. A later owner
    // acknowledgement cannot choose/rebase that first furnishing date.
    const available = false;
    return {source, order, raw, clock, termsAccepted, sourceHash, available};
  };
  const before = await db.runTransaction(read);
  if (mode === 'preview') return {protocol: 'return_deposit_deadline_preview_v1', transactionId: id, ownerId: uid,
    role: operator ? 'operator' : uid === before.order.buyerId ? 'buyer' : 'seller',
    source: {sourceHash: before.sourceHash, version: before.clock ? before.raw!.version : before.raw ? null : 0},
    terms: before.termsAccepted ? RETURN_DEPOSIT_TERMS : null, termsAccepted: before.termsAccepted,
    qualification: before.raw ? before.clock ? 'qualified' : 'unknown' : before.termsAccepted ? 'unknown' : 'historical_terms_not_recorded',
    clock: before.clock ? {version: before.raw!.version, availableAt: before.raw!.availableAt.toDate().toISOString(),
      dueAt: before.clock.dueAtMs === null ? null : new Date(before.clock.dueAtMs).toISOString(),
      baseLabelId: before.raw!.baseLabelId, currentLabelId: before.source.identity?.labelId ?? null,
      currentLabelMatches: before.raw!.entries.at(-1)?.labelId === before.source.identity?.labelId,
      reviewRequired: !returnDepositInstructionAllowsNewDeposit(before.clock.dueAtMs,
        before.raw!.entries.at(-1)?.labelId ?? null, before.source.identity?.labelId ?? null),
      extensions: before.raw!.entries.slice(1).map((e: any) => ({recordedAt: e.recordedAt.toDate().toISOString(), newDueAt: new Date(e.newDueAtMs).toISOString(),
        motivation: operator ? e.motivation : null, partyMessage: e.partyMessage}))} : null,
    currentLabelId: before.source.identity?.labelId ?? null,
    canMakeAvailable: !operator && uid === before.order.buyerId && before.available,
    canExtend: operator && !!before.clock && before.raw!.entries.length < 20 && before.source.identity !== null && before.source.unique,
    physicalEvidence: {carrierDepositVerified: false, parcelDeliveredAt: native(before.order.returnDeliveredAt) ? before.order.returnDeliveredAt.toDate().toISOString() : null,
      parcelDeliveryDeclared: !!before.order.returnDeliveredAt, contentsReceivedConfirmed: false}, ...effects};
  const expected = (s: typeof before) => c!.sourceHash === s.sourceHash && c!.expectedVersion === (s.clock ? s.raw!.version : s.raw ? null : 0) &&
    c!.expectedLabelId === s.source.identity?.labelId;
  return db.runTransaction(async tx => {
    const old = (await tx.get(rref!)).data(); if (old) return receiptView(id, uid, rid!, c!, old);
    const fresh = await read(tx), profile = (await tx.get(db.collection('eligibility_profiles').doc(uid))).data(); await assertAccountSecurityOpen(profile, tx, uid);
    if (operator) assertRecentAccountAuthentication(request.auth.token);
    const validExtension = c!.action === 'extend' && operator && !!fresh.clock && fresh.raw!.entries.length < 20 &&
      c!.newDueAtMs! > Math.max(fresh.clock.dueAtMs ?? fresh.raw!.availableAt.toMillis(), Date.now());
    if (!expected(fresh) || !validExtension) {
      const record = terminal('not_executed', !expected(fresh) ? 'current_source_changed' : c!.action === 'make_available' ?
        'first_document_availability_requires_native_label_commit' : 'motivated_extension_not_qualified');
      tx.create(rref!, record); return receiptView(id, uid, rid!, c!, record);
    }
    const now = Timestamp.now(), version = (fresh.clock ? fresh.raw!.version : 0) + 1;
    const entry = {action: c!.action, actorId: uid, requestId: rid, commandId: supportHash([uid, rid]), commandHash: supportHash(c),
      version, recordedAt: now, labelId: c!.expectedLabelId,
      newDueAtMs: c!.newDueAtMs, motivation: c!.motivation, partyMessage: c!.partyMessage,
      priorEntryHash: supportSourceHash(fresh.raw!.entries.at(-1))};
    const prepared = await prepareOperationalNotices(tx, notices(id, fresh.order, entry));
    const savedEntry = {...entry, notificationIds: prepared.notificationIds}, record = {...terminal('committed', null, version, now), operatorValidated: operator};
    tx.update(clockRef(id), {version, entries: [...fresh.raw!.entries, savedEntry]});
    tx.create(rref!, record); prepared.commit(); return receiptView(id, uid, rid!, c!, record);
  });
}
