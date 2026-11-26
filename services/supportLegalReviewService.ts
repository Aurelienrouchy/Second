import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {CryptoDigestAlgorithm, digestStringAsync, randomUUID} from 'expo-crypto';
import {auth, functions} from '@/config/firebaseConfig';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {productReviewByteHash, productReviewEncodeBytes} from '@/services/productReviewEvidenceService';
import {isAuthorityCase, isAuthorityPackageReference, isAuthoritySelectedEntry, isAuthoritySelection} from '@/services/authorityRequestService';
import {isDeclaredSupportAccountId} from '@/utils/supportAccountIdentity';
import {confidentialObject as object, confidentialExact as exact, confidentialId as id, confidentialHash as hash,
  confidentialRid as rid, confidentialDate as date, confidentialInteger as integer, isSupportConfidentialTarget, isSupportOpaqueReference} from '@/utils/supportConfidentialityContract';
import {SUPPORT_LEGAL_REVIEW_CAPABILITY, type LegalReviewArea, type LegalReviewAttempt, type LegalReviewCommand, type LegalReviewReceipt,
  type LegalReviewResult, type LegalReviewReference, type LegalEvidenceRef, type LegalProofRead, type LegalExaminations,
  type LegalOriginalSource, type LegalOriginalSelection, type LegalAuthorityDetail, type LegalAuthorityCursors,
  type LegalAuthorizationRecord, type LegalSendRecord, type LegalExternalReceiptRecord, type LegalDisclosurePayload} from '@/types/supportLegalReview';

export const LEGAL_EVIDENCE_PURPOSES = ['identity', 'power', 'legal_basis', 'delegation', 'human_send', 'external_receipt'] as const;
export const LEGAL_REVIEW_CHANNELS = ['secure_email', 'registered_mail', 'secure_portal', 'in_person'] as const;
const actions = {confidential_original: ['read_original_field'], authority_request: ['upload_evidence', 'read_evidence', 'authorize_package', 'read_authorized_package', 'attest_human_send', 'record_external_receipt']};
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && !!v.trim() && v.trim() === v && v.length <= max;
const revision = (v: unknown): v is string => typeof v === 'string' && /^\d+:\d+$/.test(v) && Number.isSafeInteger(Number(v.split(':')[0])) && Number(v.split(':')[0]) <= 253402300799 && Number(v.split(':')[1]) < 1_000_000_000;
const source = (v: unknown) => object(v) && exact(v, ['version', 'sourceHash']) && integer(v.version) && hash(v.sourceHash);
const originalContext = (v: unknown) => object(v) && exact(v, ['revision', 'version', 'sourceHash']) && revision(v.revision) && integer(v.version) && hash(v.sourceHash);
export const legalReviewFailure = () => new Error('Relisez les sources privées et le reçu exact. Aucun accès, envoi externe ou pouvoir juridique n’est déduit d’un résultat inconnu.');
export const newLegalReviewId = () => randomUUID();
export const legalReviewReceipt = (result: LegalReviewResult): LegalReviewReceipt => result.protocol === 'support_legal_review_receipt_v2' ? result : result.receipt;
export const isLegalReviewReference = (v: unknown, prefix = ''): v is LegalReviewReference => object(v) && exact(v, ['id', 'contentHash']) && id(v.id) && (!prefix || new RegExp('^' + prefix + '[a-f0-9]{64}$').test(v.id)) && hash(v.contentHash);
export const isLegalEvidenceRef = (v: unknown): v is LegalEvidenceRef => object(v) && exact(v, ['evidenceId', 'generation', 'sha256', 'sizeBytes']) && /^spe_[a-f0-9]{64}$/.test(String(v.evidenceId)) && typeof v.generation === 'string' && /^[1-9]\d{0,19}$/.test(v.generation) && hash(v.sha256) && integer(v.sizeBytes) && v.sizeBytes <= 5 * 1024 * 1024;
const proof = (v: unknown): v is LegalProofRead => object(v) && exact(v, ['readReference', 'evidence']) && isLegalReviewReference(v.readReference, 'authority_read_') && isLegalEvidenceRef(v.evidence);
const proofCapture = (v: unknown) => object(v) && exact(v, ['readReference', 'evidence', 'evidenceSourceHash', 'purpose']) && proof({readReference: v.readReference, evidence: v.evidence}) && hash(v.evidenceSourceHash) && LEGAL_EVIDENCE_PURPOSES.includes(v.purpose as typeof LEGAL_EVIDENCE_PURPOSES[number]);
export function isLegalExaminations(v: unknown): v is LegalExaminations {
  return object(v) && exact(v, ['identity', 'power', 'legalBasis', 'delegation']) && Object.values(v).every(e => object(e) && exact(e, ['state', 'reason', 'proofReads']) && ['supported', 'unknown', 'insufficient'].includes(String(e.state)) && text(e.reason, 2000) && Array.isArray(e.proofReads) && e.proofReads.length <= 3 && e.proofReads.every(proof) && new Set(e.proofReads.map(p => p.evidence.evidenceId)).size === e.proofReads.length && (e.state !== 'supported' || e.proofReads.length > 0));
}
function originalFamily(path: string, action?: string): string | null {
  if (path === 'command.narrative') return action === 'submit' ? 'narrative' : action === 'withdraw' ? 'withdrawalReason' : ['clarify', 'link_evidence'].includes(action ?? '') ? 'latestClarification' : null;
  const parts = path.split('.'), key = parts.at(-1)!;
  if (key === 'reason') return parts.includes('accountReview') ? 'accountReview.reason' : parts.includes('transportInstruction') ? 'transportInstruction.reason' : null;
  if (key === 'description') return parts.some(v => ['privacyScope', 'declaredScope'].includes(v)) ? 'privacyScope.description' : null;
  return key;
}
const recipient = (v: unknown) => object(v) && exact(v, ['name', 'organization', 'contact', 'capacity']) && text(v.name, 300) && text(v.organization, 300) && text(v.contact, 500) && text(v.capacity, 1000);
export function isLegalReviewCommand(v: unknown, area: LegalReviewArea): v is LegalReviewCommand {
  if (!object(v) || !Object.hasOwn(actions, area) || !actions[area].includes(String(v.action))) return false;
  if (area === 'confidential_original') return exact(v, ['action', 'target', 'context', 'purpose', 'reason', 'necessityAccepted', 'minimizationAccepted']) && isSupportConfidentialTarget(v.target) && v.target.qualification === 'native_field' && originalContext(v.context) && ['support_handling', 'privacy_rights', 'security_review'].includes(String(v.purpose)) && text(v.reason, 2000) && v.necessityAccepted === true && v.minimizationAccepted === true;
  const extra: Record<string, string[]> = {upload_evidence: ['purpose', 'jpegBase64'], read_evidence: ['evidence'], authorize_package: ['packageReference', 'review', 'reason'], read_authorized_package: ['packageReference', 'authorizationReference'], attest_human_send: ['packageReference', 'authorizationReference', 'recipient', 'channel', 'sentAt', 'externalReference', 'proofRead', 'reason'], record_external_receipt: ['sendReference', 'receivedAt', 'externalReference', 'proofRead', 'reason']};
  if (!exact(v, ['action', 'caseId', 'source', ...extra[String(v.action)]]) || typeof v.caseId !== 'string' || !/^authority_[a-f0-9]{64}$/.test(v.caseId) || !source(v.source)) return false;
  if (v.action === 'upload_evidence') return LEGAL_EVIDENCE_PURPOSES.includes(v.purpose as typeof LEGAL_EVIDENCE_PURPOSES[number]) && typeof v.jpegBase64 === 'string' && v.jpegBase64.length > 0 && v.jpegBase64.length <= Math.ceil(5 * 1024 * 1024 / 3) * 4;
  if (v.action === 'read_evidence') return isLegalEvidenceRef(v.evidence);
  if (v.action === 'authorize_package') return isAuthorityPackageReference(v.packageReference) && isLegalExaminations(v.review) && text(v.reason);
  if (v.action === 'read_authorized_package') return isAuthorityPackageReference(v.packageReference) && isLegalReviewReference(v.authorizationReference, 'authority_auth_');
  if (v.action === 'attest_human_send') return isAuthorityPackageReference(v.packageReference) && isLegalReviewReference(v.authorizationReference, 'authority_auth_') && recipient(v.recipient) && LEGAL_REVIEW_CHANNELS.includes(v.channel as typeof LEGAL_REVIEW_CHANNELS[number]) && date(v.sentAt) && text(v.externalReference, 300) && proof(v.proofRead) && text(v.reason);
  return isLegalReviewReference(v.sendReference, 'authority_event_') && date(v.receivedAt) && text(v.externalReference, 300) && proof(v.proofRead) && text(v.reason);
}
export const isLegalReviewAttempt = (v: unknown, uid: string, area: LegalReviewArea): v is LegalReviewAttempt => object(v) && exact(v, ['version', 'uid', 'area', 'requestId', 'descriptor']) && v.version === 2 && v.uid === uid && isDeclaredSupportAccountId(uid) && v.area === area && Object.hasOwn(actions, area) && rid(v.requestId) && object(v.descriptor) && exact(v.descriptor, ['caseId', 'action', 'payloadHash']) && id(v.descriptor.caseId) && actions[area].includes(String(v.descriptor.action)) && hash(v.descriptor.payloadHash);
export function legalReviewGuard(uid: string, caller: () => void) {
  const session = captureTradeSession(uid), user = auth.currentUser;
  return () => {assertTradeSessionCurrent(session); caller(); if (!user || auth.currentUser !== user) throw legalReviewFailure();};
}
async function call(uid: string, area: LegalReviewArea, body: Record<string, unknown>, guard: () => void, recent: boolean) {
  const current = legalReviewGuard(uid, guard); current();
  if (recent) {const user = auth.currentUser!, token = await user.getIdTokenResult(true); current(); const at = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
    if (auth.currentUser !== user || token.claims.admin !== true || !integer(at) || at > now || now - at > 300) throw new Error('Confirmez votre identité actuelle, puis relisez les sources et les pièces.');}
  const result = await httpsCallable<unknown, unknown>(functions, body.mode ? 'administerSupportRequest' : 'readSupportRequests')({expectedUid: uid, capability: SUPPORT_LEGAL_REVIEW_CAPABILITY, area, ...body}); current(); return result.data;
}
function parseReceipt(v: unknown, attempt: LegalReviewAttempt): LegalReviewReceipt {
  if (!object(v) || !exact(v, ['protocol', 'area', 'actorId', 'requestId', 'caseId', 'action', 'payloadHash', 'state', 'committed', 'replayed', 'recordedAt', 'reasonCode', 'reference', 'evidence', 'storageOutcome', 'originalRedisclosed', 'legalAuthorityVerified', 'financialEffect']) || v.protocol !== 'support_legal_review_receipt_v2' || v.area !== attempt.area || v.actorId !== attempt.uid || v.requestId !== attempt.requestId || v.caseId !== attempt.descriptor.caseId || v.action !== attempt.descriptor.action || v.payloadHash !== attempt.descriptor.payloadHash || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) || v.committed !== (v.state === 'committed') || typeof v.replayed !== 'boolean' || !(v.recordedAt === null || date(v.recordedAt)) || ![null, 'command_neutralized', 'source_changed', 'examinations_unknown'].includes(v.reasonCode as string | null) || !(v.reference === null || isLegalReviewReference(v.reference)) || !(v.evidence === null || isLegalEvidenceRef(v.evidence)) || v.storageOutcome !== 'not_asserted' || v.originalRedisclosed !== false || v.legalAuthorityVerified !== false || v.financialEffect !== 'none') throw legalReviewFailure();
  if (v.state === 'committed' ? !date(v.recordedAt) || v.reference === null || v.reasonCode !== null : v.reference !== null || v.evidence !== null || v.state === 'unrecorded' && (v.recordedAt !== null || v.reasonCode !== null || v.replayed !== false) || v.state === 'not_executed' && (!date(v.recordedAt) || v.reasonCode === null)) throw legalReviewFailure();
  const evidenceAction = ['upload_evidence', 'read_evidence'].includes(attempt.descriptor.action);
  if (v.state === 'committed' && (evidenceAction ? !isLegalEvidenceRef(v.evidence) : v.evidence !== null)) throw legalReviewFailure();
  return v as unknown as LegalReviewReceipt;
}
function decodeJpeg(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value || value.length % 4 || value.length > Math.ceil(5 * 1024 * 1024 / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw legalReviewFailure();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', size = value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0), bytes = new Uint8Array(size); let offset = 0;
  for (let i = 0; i < value.length; i += 4) {const a = alphabet.indexOf(value[i]), b = alphabet.indexOf(value[i + 1]), c = alphabet.indexOf(value[i + 2]), d = alphabet.indexOf(value[i + 3]); bytes[offset++] = a << 2 | b >> 4; if (offset < size) bytes[offset++] = (b & 15) << 4 | Math.max(c, 0) >> 2; if (offset < size) bytes[offset++] = (Math.max(c, 0) & 3) << 6 | Math.max(d, 0);}
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217 || productReviewEncodeBytes(bytes) !== value) throw legalReviewFailure(); return bytes;
}
const exclusions = ['addresses', 'member_contacts', 'identity_documents', 'bank_details', 'payment_provider_identifiers', 'messages', 'support_correspondence', 'confidential_evidence'];
function disclosure(v: unknown, caseId: string): v is LegalDisclosurePayload {
  if (!object(v) || !exact(v, ['protocol', 'caseId', 'packageReference', 'selection', 'items', 'excludedCategories', 'legalAuthorityVerified']) || v.protocol !== 'authority_disclosure_payload_v2' || v.caseId !== caseId || !isAuthorityPackageReference(v.packageReference) || !isAuthoritySelection(v.selection) || !Array.isArray(v.items) || v.items.length !== v.selection.transactionIds.length || !productReviewEqual(v.excludedCategories, exclusions) || v.legalAuthorityVerified !== false) return false;
  const selected = v.selection;
  return v.items.every((item, index) => object(item) && exact(item, ['transactionId', 'fields']) && item.transactionId === selected.transactionIds[index] && object(item.fields) && exact(item.fields, selected.fields) && Object.entries(item.fields).every(([field, value]) => object(value) && value.qualification === 'native' && isAuthoritySelectedEntry(field, value) && (field !== 'transactionId' || value.value === item.transactionId)));
}
/** A tagged source hash for this plain JSON payload only; no Timestamp conversion
 * or authority is inferred from a displayed server artifact. */
async function jsonSourceHash(value: unknown): Promise<string> {
  let nodes = 0;
  const copy = (v: unknown, depth: number): unknown => {if (++nodes > 20_000 || depth > 32) throw legalReviewFailure(); if (v === null) return ['null']; if (typeof v === 'string') return ['string', v]; if (typeof v === 'boolean') return ['boolean', v]; if (typeof v === 'number' && Number.isFinite(v)) return ['number', Object.is(v, -0) ? '-0' : v]; if (Array.isArray(v)) return ['array', v.map(child => copy(child, depth + 1))]; if (object(v)) return ['map', Object.keys(v).sort().map(k => [k, copy(v[k], depth + 1)])]; throw legalReviewFailure();};
  const serialized = JSON.stringify(copy(value, 0)); if (serialized.length > 2_000_000) throw legalReviewFailure(); return digestStringAsync(CryptoDigestAlgorithm.SHA256, serialized);
}
function authorizationRecord(v: unknown, caseId: string): v is LegalAuthorizationRecord {
  return object(v) && exact(v, ['protocol', 'actorId', 'authTime', 'caseId', 'source', 'packageReference', 'payloadContentHash', 'review', 'proofs', 'reason', 'recordedAt', 'authorizationScope', 'humanExaminationsRecorded', 'corporateDelegationAutomaticallyInferred', 'legalAuthorityVerified', 'externalCommunicationPerformed', 'financialEffect']) && v.protocol === 'authority_package_authorization_v2' && v.caseId === caseId && isDeclaredSupportAccountId(v.actorId) && integer(v.authTime) && source(v.source) && isAuthorityPackageReference(v.packageReference) && hash(v.payloadContentHash) && isLegalExaminations(v.review) && Object.values(v.review).every(e => e.state === 'supported') && Array.isArray(v.proofs) && v.proofs.length >= 4 && v.proofs.length <= 12 && v.proofs.every(proofCapture) && text(v.reason) && date(v.recordedAt) && v.authorizationScope === 'exact_current_package_only' && v.humanExaminationsRecorded === true && v.corporateDelegationAutomaticallyInferred === false && v.legalAuthorityVerified === false && v.externalCommunicationPerformed === false && v.financialEffect === 'none';
}
function eventRecord(v: unknown, caseId: string): v is LegalSendRecord | LegalExternalReceiptRecord {
  if (!object(v)) return false; const send = v.protocol === 'authority_human_send_attestation_v2', ack = v.protocol === 'authority_external_receipt_recorded_v2';
  return (send || ack) && exact(v, ['protocol', 'actorId', 'caseId', 'source', 'authorizationReference', 'packageReference', 'payloadContentHash', 'recipient', 'channel', 'externalReference', 'proof', 'reason', 'recordedAt', 'legalAuthorityVerified', 'financialEffect', ...(send ? ['sentAt', 'humanSendAttested', 'externalCommunicationIndependentlyVerified'] : ['sendReference', 'receivedAt', 'externalAcknowledgmentRecorded', 'externalReceiptIndependentlyVerified', 'currentDisclosurePermissionGranted'])]) && v.caseId === caseId && isDeclaredSupportAccountId(v.actorId) && source(v.source) && isLegalReviewReference(v.authorizationReference, 'authority_auth_') && isAuthorityPackageReference(v.packageReference) && hash(v.payloadContentHash) && recipient(v.recipient) && LEGAL_REVIEW_CHANNELS.includes(v.channel as typeof LEGAL_REVIEW_CHANNELS[number]) && text(v.externalReference, 300) && proofCapture(v.proof) && object(v.proof) && v.proof.purpose === (send ? 'human_send' : 'external_receipt') && text(v.reason) && date(v.recordedAt) && v.legalAuthorityVerified === false && v.financialEffect === 'none' && (send ? date(v.sentAt) && v.humanSendAttested === true && v.externalCommunicationIndependentlyVerified === false : date(v.receivedAt) && isLegalReviewReference(v.sendReference, 'authority_event_') && v.externalAcknowledgmentRecorded === true && v.externalReceiptIndependentlyVerified === false && v.currentDisclosurePermissionGranted === false);
}
function page(v: unknown, cursor: string | null, item: (value: unknown) => boolean, key: (value: Record<string, unknown>) => unknown): boolean {
  if (!object(v) || !exact(v, ['items', 'hasMore', 'cursor']) || !Array.isArray(v.items) || v.items.length > 20 || typeof v.hasMore !== 'boolean' || v.hasMore !== (v.cursor !== null) || v.cursor !== null && !id(v.cursor) || v.hasMore && (v.items.length !== 20 || v.cursor !== key(v.items.at(-1)))) return false;
  let prior = cursor ?? ''; for (const entry of v.items) {if (!item(entry) || !object(entry)) return false; const next = key(entry); if (typeof next !== 'string' || next <= prior) return false; prior = next;} return true;
}
export const SupportLegalReviewService = {
  async attempt(uid: string, area: LegalReviewArea, requestId: string, command: LegalReviewCommand, guard: () => void): Promise<LegalReviewAttempt> {
    const current = legalReviewGuard(uid, guard); current(); if (!isLegalReviewCommand(command, area) || !rid(requestId)) throw legalReviewFailure();
    const payloadHash = await productReviewHash(command); current(); const caseId = command.action === 'read_original_field' ? command.target.supportRequestId : command.caseId;
    return {version: 2, uid, area, requestId, descriptor: {caseId, action: command.action, payloadHash}};
  },
  async command(attempt: LegalReviewAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void, command?: LegalReviewCommand): Promise<LegalReviewResult> {
    const current = legalReviewGuard(attempt.uid, guard); current(); if (!isLegalReviewAttempt(attempt, attempt.uid, attempt.area) || mode === 'execute' && (!isLegalReviewCommand(command, attempt.area) || !productReviewEqual(await this.attempt(attempt.uid, attempt.area, attempt.requestId, command, current), attempt)) || mode !== 'execute' && command !== undefined) throw legalReviewFailure(); current();
    const raw = await call(attempt.uid, attempt.area, {mode, requestId: attempt.requestId, descriptor: attempt.descriptor, ...(mode === 'execute' ? {command} : {})}, current, false); current();
    const qualifiedReceipt = async (value: unknown) => {
      const receipt = parseReceipt(value, attempt);
      if (receipt.state === 'committed') {
        const action = attempt.descriptor.action, upload = action === 'upload_evidence';
        const prefix = {read_original_field: 'confidential_access_', upload_evidence: 'spe_', read_evidence: 'authority_read_', authorize_package: 'authority_auth_', read_authorized_package: 'authority_access_', attest_human_send: 'authority_event_', record_external_receipt: 'authority_event_'}[action];
        const expected = prefix + await productReviewHash(upload ? [attempt.descriptor.caseId, attempt.uid, attempt.requestId] : [attempt.uid, attempt.requestId]); current();
        if (receipt.reference?.id !== expected || upload && receipt.evidence?.evidenceId !== expected) throw legalReviewFailure();
        if (command?.action === 'upload_evidence') {const bytes = decodeJpeg(command.jpegBase64); if (receipt.evidence?.sizeBytes !== bytes.length || receipt.evidence.sha256 !== await productReviewByteHash(bytes)) throw legalReviewFailure(); current();}
      }
      return receipt;
    };
    if (object(raw) && raw.protocol === 'support_legal_review_receipt_v2') return qualifiedReceipt(raw);
    if (mode !== 'execute' || !command || !object(raw)) throw legalReviewFailure();
    const receipt = await qualifiedReceipt(raw.receipt); current(); if (receipt.state !== 'committed' || receipt.replayed) throw legalReviewFailure();
    if (command.action === 'read_original_field') {
      if (!exact(raw, ['protocol', 'actorId', 'caseId', 'field', 'original', 'accessAudited', 'auditReference', 'receipt', 'authorizationScope', 'legalAuthorityVerified', 'corporateDelegationInferred', 'financialEffect']) || raw.protocol !== 'support_confidential_original_v2' || raw.actorId !== attempt.uid || raw.caseId !== attempt.descriptor.caseId || raw.field !== command.target.field || typeof raw.original !== 'string' || !raw.original || raw.original.length > 256_000 || raw.accessAudited !== true || !isLegalReviewReference(raw.auditReference, 'confidential_access_') || !productReviewEqual(raw.auditReference, receipt.reference) || raw.authorizationScope !== 'current_exact_field_only' || raw.legalAuthorityVerified !== false || raw.corporateDelegationInferred !== false || raw.financialEffect !== 'none' || await productReviewHash(['support_confidential_text_v1', originalFamily(command.target.field, command.target.command?.action), raw.original.trim()]) !== command.target.fieldHash) throw legalReviewFailure(); current();
    } else if (command.action === 'read_evidence') {
      if (!exact(raw, ['protocol', 'actorId', 'caseId', 'evidence', 'readReference', 'purpose', 'jpegBase64', 'receipt']) || raw.protocol !== 'authority_evidence_read_result_v2' || raw.actorId !== attempt.uid || raw.caseId !== attempt.descriptor.caseId || !productReviewEqual(raw.evidence, command.evidence) || !productReviewEqual(receipt.evidence, command.evidence) || !isLegalReviewReference(raw.readReference, 'authority_read_') || !productReviewEqual(raw.readReference, receipt.reference) || !LEGAL_EVIDENCE_PURPOSES.includes(raw.purpose as typeof LEGAL_EVIDENCE_PURPOSES[number])) throw legalReviewFailure();
      const bytes = decodeJpeg(raw.jpegBase64); if (bytes.length !== command.evidence.sizeBytes || await productReviewByteHash(bytes) !== command.evidence.sha256) throw legalReviewFailure(); current();
    } else if (command.action === 'read_authorized_package') {
      if (!exact(raw, ['protocol', 'actorId', 'caseId', 'payload', 'payloadContentHash', 'receipt', 'externalCommunicationPerformed', 'legalAuthorityVerified']) || raw.protocol !== 'authority_authorized_package_read_v2' || raw.actorId !== attempt.uid || raw.caseId !== attempt.descriptor.caseId || !disclosure(raw.payload, attempt.descriptor.caseId) || !productReviewEqual(raw.payload.packageReference, command.packageReference) || !hash(raw.payloadContentHash) || await jsonSourceHash(raw.payload) !== raw.payloadContentHash || raw.externalCommunicationPerformed !== false || raw.legalAuthorityVerified !== false) throw legalReviewFailure(); current();
    } else throw legalReviewFailure();
    return raw as unknown as LegalReviewResult;
  },
  async originalSource(uid: string, selection: LegalOriginalSelection, guard: () => void): Promise<LegalOriginalSource> {
    const current = legalReviewGuard(uid, guard); current(); if (!id(selection.caseId) || selection.reference !== null && (!isSupportOpaqueReference(selection.reference) || selection.reference.supportRequestId !== selection.caseId)) throw legalReviewFailure();
    const v = await call(uid, 'confidential_original', {operation: 'source_observe', caseId: selection.caseId, ...(selection.reference ? {reference: selection.reference} : {})}, current, true); current();
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'caseId', 'fields', 'context', 'original', 'legalAuthorityVerified', 'authorizationScope']) || v.protocol !== 'support_confidential_source_v2' || v.actorId !== uid || v.caseId !== selection.caseId || !originalContext(v.context) || v.original !== null || v.legalAuthorityVerified !== false || v.authorizationScope !== 'one_exact_field_per_instruction' || !Array.isArray(v.fields) || v.fields.length > 20 || !v.fields.every(f => object(f) && exact(f, ['target', 'canProtectOwnField', 'canConfineField', 'confined']) && isSupportConfidentialTarget(f.target) && f.target.supportRequestId === selection.caseId && productReviewEqual(f.target.command, selection.reference) && typeof f.canProtectOwnField === 'boolean' && typeof f.canConfineField === 'boolean' && typeof f.confined === 'boolean') || new Set(v.fields.map(f => f.target.field)).size !== v.fields.length) throw legalReviewFailure();
    for (const f of v.fields) {if (f.target.sourceHash !== await productReviewHash({...f.target, sourceHash: null})) throw legalReviewFailure(); current();}
    return v as unknown as LegalOriginalSource;
  },
  async authorityDetail(uid: string, caseId: string, cursors: LegalAuthorityCursors, guard: () => void): Promise<LegalAuthorityDetail> {
    const current = legalReviewGuard(uid, guard); current(); if (!/^authority_[a-f0-9]{64}$/.test(caseId) || Object.values(cursors).some(c => c !== null && !id(c))) throw legalReviewFailure();
    const v = await call(uid, 'authority_request', {operation: 'detail', caseId, ...cursors}, current, true); current();
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'caseId', 'source', 'case', 'evidence', 'authorizations', 'events', 'legalAuthorityVerified', 'externalCommunicationPerformed', 'financialEffect']) || v.protocol !== 'authority_request_detail_v2' || v.actorId !== uid || v.caseId !== caseId || !source(v.source) || !isAuthorityCase(v.case) || v.case.id !== caseId || !productReviewEqual(v.case.source, v.source) || v.legalAuthorityVerified !== false || v.externalCommunicationPerformed !== false || v.financialEffect !== 'none' || !page(v.evidence, cursors.evidenceCursor, e => object(e) && exact(e, ['evidence', 'purpose', 'uploadedAt']) && isLegalEvidenceRef(e.evidence) && LEGAL_EVIDENCE_PURPOSES.includes(e.purpose as typeof LEGAL_EVIDENCE_PURPOSES[number]) && (e.uploadedAt === null || date(e.uploadedAt)), e => object(e.evidence) ? e.evidence.evidenceId : null) || !page(v.authorizations, cursors.authorizationCursor, e => object(e) && exact(e, ['reference', 'record']) && isLegalReviewReference(e.reference, 'authority_auth_') && authorizationRecord(e.record, caseId), e => object(e.reference) ? e.reference.id : null) || !page(v.events, cursors.eventCursor, e => object(e) && exact(e, ['reference', 'record']) && isLegalReviewReference(e.reference, 'authority_event_') && eventRecord(e.record, caseId), e => object(e.reference) ? e.reference.id : null)) throw legalReviewFailure();
    return v as unknown as LegalAuthorityDetail;
  },
};
