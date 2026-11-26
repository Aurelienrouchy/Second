import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {functions} from '@/config/firebaseConfig';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {isDeclaredSupportAccountId} from '@/utils/supportAccountIdentity';
import {productReviewEqual, productReviewHash, productReviewDocumentId} from '@/services/productReviewService';
import {AUTHORITY_REQUEST_CAPABILITY, AUTHORITY_PACKAGE_FIELDS} from '@/types/authorityRequest';
import type {AuthorityAttempt, AuthorityCase, AuthorityCommand, AuthorityDetail, AuthorityEffects, AuthorityList, AuthorityPackage, AuthorityPackageReference, AuthorityPreview, AuthorityReceipt, AuthorityReception, AuthorityReview, AuthoritySelection, AuthoritySource} from '@/types/authorityRequest';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const caseId = (v: unknown): v is string => typeof v === 'string' && /^authority_[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 4000): v is string => typeof v === 'string' && !!v.trim() && v === v.trim() && v.length <= max;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nullable = (v: unknown, check: (value: unknown) => boolean) => v === null || check(v);
const effectValues: AuthorityEffects = {privateDocumentaryOnly: true, legalAuthorityVerified: false, disclosureAuthorized: false, externalCommunicationPerformed: false, recipientReceiptVerified: false, targetNotified: false, sourcePreservationPerformed: false, financialEffect: 'none'};
const effects = (v: Record<string, unknown>) => Object.entries(effectValues).every(([key, value]) => v[key] === value);
export const authorityFailure = () => new Error('Relisez le dossier privé et votre habilitation actuelle. Aucune communication externe n’est réalisée.');
const source = (v: unknown): v is AuthoritySource => object(v) && exact(v, ['version', 'sourceHash']) && count(v.version) && v.version > 0 && hash(v.sourceHash);
const evidence = (v: unknown) => Array.isArray(v) && v.length <= 10 && v.every(e => object(e) && exact(e, ['reference', 'description']) && text(e.reference, 300) && text(e.description, 1000)) && new Set(v.map(e => e.reference)).size === v.length;
function reception(v: unknown): v is AuthorityReception {
  return object(v) && exact(v, ['requester', 'externalReference', 'externallyReceivedAt', 'summary', 'evidenceReferences']) && object(v.requester) && exact(v.requester, ['name', 'organization', 'contact', 'capacity']) && text(v.requester.name, 300) && text(v.requester.organization, 300) && text(v.requester.contact, 500) && text(v.requester.capacity, 1000) && text(v.externalReference, 300) && nullable(v.externallyReceivedAt, iso) && text(v.summary) && evidence(v.evidenceReferences);
}
function review(v: unknown): v is AuthorityReview {
  return object(v) && exact(v, ['identity', 'power', 'legalBasis', 'delegation']) && Object.values(v).every(e => object(e) && exact(e, ['state', 'reason', 'evidenceReferences']) && ['unknown', 'declared_reviewed'].includes(String(e.state)) && text(e.reason, 2000) && Array.isArray(e.evidenceReferences) && e.evidenceReferences.length <= 10 && e.evidenceReferences.every(r => text(r, 300)) && new Set(e.evidenceReferences).size === e.evidenceReferences.length && (e.state !== 'declared_reviewed' || e.evidenceReferences.length > 0));
}
function selection(v: unknown): v is AuthoritySelection {
  return object(v) && exact(v, ['transactionIds', 'fields', 'period']) && Array.isArray(v.transactionIds) && v.transactionIds.length > 0 && v.transactionIds.length <= 10 && v.transactionIds.every(id => text(id, 128) && productReviewDocumentId(id)) && new Set(v.transactionIds).size === v.transactionIds.length && Array.isArray(v.fields) && v.fields.length > 0 && v.fields.length <= AUTHORITY_PACKAGE_FIELDS.length && v.fields.every(f => (AUTHORITY_PACKAGE_FIELDS as readonly unknown[]).includes(f)) && new Set(v.fields).size === v.fields.length && (v.period === null || object(v.period) && exact(v.period, ['from', 'to']) && iso(v.period.from) && iso(v.period.to) && v.period.from <= v.period.to);
}
export function isAuthorityCommand(v: unknown): v is AuthorityCommand {
  if (!object(v)) return false;
  if (v.action === 'receive') return exact(v, ['action', 'reception']) && reception(v.reception) && (v.reception.externallyReceivedAt === null || Date.parse(v.reception.externallyReceivedAt) <= Date.now());
  const action = String(v.action), extra = action === 'record_review' ? ['review', ...(Object.hasOwn(v, 'evidenceReferences') ? ['evidenceReferences'] : [])] : action === 'record_scope' ? ['selection'] : action === 'prepare_package' ? ['previewHash'] : [];
  return ['record_review', 'request_details', 'refuse', 'record_scope', 'prepare_package'].includes(action) && exact(v, ['action', 'caseId', 'source', 'reason', ...extra]) && caseId(v.caseId) && source(v.source) && text(v.reason) && (action !== 'record_review' || review(v.review) && (!Object.hasOwn(v, 'evidenceReferences') || evidence(v.evidenceReferences))) && (action !== 'record_scope' || selection(v.selection)) && (action !== 'prepare_package' || hash(v.previewHash));
}
export function isAuthorityAttempt(v: unknown, uid: string): v is AuthorityAttempt {
  return object(v) && exact(v, ['version', 'uid', 'requestId', 'descriptor']) && v.version === 1 && v.uid === uid && isDeclaredSupportAccountId(uid) && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && object(v.descriptor) && exact(v.descriptor, ['caseId', 'action', 'payloadHash']) && caseId(v.descriptor.caseId) && ['receive', 'record_review', 'request_details', 'refuse', 'record_scope', 'prepare_package'].includes(String(v.descriptor.action)) && hash(v.descriptor.payloadHash);
}
function packageReference(v: unknown): v is AuthorityPackageReference {
  return object(v) && exact(v, ['id', 'contentHash', 'version', 'sourceHash']) && typeof v.id === 'string' && /^authority_package_[a-f0-9]{64}$/.test(v.id) && hash(v.contentHash) && count(v.version) && v.version > 0 && hash(v.sourceHash);
}
function caseView(v: unknown): v is AuthorityCase {
  return object(v) && exact(v, ['protocol', 'id', 'source', 'stage', 'initiatedByAdminId', 'receivedAt', 'updatedAt', 'reception', 'requesterVerified', 'externalEvidenceOriginalsStored', 'review', 'selection', 'privateReason', 'preservation', 'latestPackage', ...Object.keys(effectValues)]) && v.protocol === 'authority_request_case_v1' && caseId(v.id) && source(v.source) && ['received', 'review_recorded', 'details_requested', 'refused', 'scope_recorded', 'package_prepared', 'unknown'].includes(String(v.stage)) && isDeclaredSupportAccountId(v.initiatedByAdminId) && iso(v.receivedAt) && iso(v.updatedAt) && reception(v.reception) && v.requesterVerified === false && v.externalEvidenceOriginalsStored === false && nullable(v.review, review) && nullable(v.selection, selection) && nullable(v.privateReason, text) && object(v.preservation) && exact(v.preservation, ['state', 'scope', 'sourcePreservationPerformed']) && v.preservation.state === 'documentary_request_only' && productReviewEqual(v.preservation.scope, v.selection) && v.preservation.sourcePreservationPerformed === false && nullable(v.latestPackage, packageReference) && effects(v);
}
function receipt(v: unknown, attempt?: AuthorityAttempt): v is AuthorityReceipt {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'caseId', 'action', 'payloadHash', 'state', 'committed', 'replay', 'resultVersion', 'reason', 'recordedAt', 'packageReference', ...Object.keys(effectValues)]) || v.protocol !== 'authority_request_command_v1' || !isDeclaredSupportAccountId(v.actorId) || !text(v.requestId, 128) || !caseId(v.caseId) || !hash(v.payloadHash) || !['receive', 'record_review', 'request_details', 'refuse', 'record_scope', 'prepare_package'].includes(String(v.action)) || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) || v.committed !== (v.state === 'committed') || typeof v.replay !== 'boolean' || !nullable(v.resultVersion, count) || !nullable(v.reason, text) || !nullable(v.recordedAt, iso) || !nullable(v.packageReference, packageReference) || !effects(v)) return false;
  if (v.state === 'unrecorded' ? v.resultVersion !== null || v.recordedAt !== null || v.reason !== null || v.packageReference !== null : !iso(v.recordedAt)) return false;
  if (v.state === 'committed' && (!count(v.resultVersion) || v.resultVersion < 1)) return false;
  if (v.state !== 'committed' && (v.resultVersion !== null || v.packageReference !== null)) return false;
  return !attempt || v.actorId === attempt.uid && v.requestId === attempt.requestId && v.caseId === attempt.descriptor.caseId && v.action === attempt.descriptor.action && v.payloadHash === attempt.descriptor.payloadHash;
}
function selectedEntry(field: string, v: unknown): boolean {
  if (!object(v) || !exact(v, ['qualification', 'value']) || !['native', 'unknown'].includes(String(v.qualification))) return false;
  if (field === 'amounts') {
    if (!object(v.value) || !exact(v.value, ['unit', 'currency', 'amount', 'shippingCost', 'serviceFee', 'totalAmount', 'providerSettlementVerified']) || v.value.unit !== 'dollars' || ![null, 'CAD'].includes(v.value.currency as string | null) || v.value.providerSettlementVerified !== false) return false;
    const amount = v.value;
    if (!['amount', 'shippingCost', 'serviceFee', 'totalAmount'].every(key => amount[key] === null || typeof amount[key] === 'number' && Number.isFinite(amount[key]) && amount[key] >= 0 && amount[key] <= 1_000_000)) return false;
    const known = amount.currency === 'CAD' && ['amount', 'shippingCost', 'serviceFee', 'totalAmount'].every(key => amount[key] !== null);
    return v.qualification === (known ? 'native' : 'unknown');
  }
  if (v.value === null) return v.qualification === 'unknown';
  if (v.qualification !== 'native') return false;
  if (field === 'createdAt') return iso(v.value);
  if (field === 'deliveryType') return ['meetup', 'shipping'].includes(String(v.value));
  if (field === 'buyerId' || field === 'sellerId') return isDeclaredSupportAccountId(v.value);
  if (field === 'transactionId') return text(v.value, 200) && productReviewDocumentId(v.value);
  return text(v.value, field === 'articleTitle' ? 300 : 100);
}
function snapshot(v: unknown, id: string, prepared = false): boolean {
  if (!object(v) || !exact(v, ['protocol', 'caseId', 'caseSource', 'selection', 'items', 'excludedCategories', 'periodBasis', 'missingValuesRemainUnknown', ...Object.keys(effectValues), ...(prepared ? ['preparedBy', 'preparedAt', 'decision'] : [])]) || v.protocol !== 'authority_request_package_snapshot_v1' || v.caseId !== id || !source(v.caseSource) || !selection(v.selection) || !effects(v) || v.periodBasis !== 'native_transaction_createdAt_only' || v.missingValuesRemainUnknown !== true || !Array.isArray(v.items) || v.items.length !== v.selection.transactionIds.length || !Array.isArray(v.excludedCategories) || !productReviewEqual(v.excludedCategories, ['addresses', 'member_contacts', 'identity_documents', 'bank_details', 'payment_provider_identifiers', 'messages', 'support_correspondence', 'confidential_evidence'])) return false;
  const selected = v.selection;
  return v.items.every((item, i) => object(item) && exact(item, ['transactionId', 'sourceRevision', 'sourceHash', 'periodState', 'fields', 'omittedFields']) && item.transactionId === selected.transactionIds[i] && nullable(item.sourceRevision, text) && hash(item.sourceHash) && ['missing_source', 'not_filtered', 'unknown_date', 'outside_period', 'within_period'].includes(String(item.periodState)) && object(item.fields) && exact(item.fields, ['not_filtered', 'within_period'].includes(String(item.periodState)) ? selected.fields : []) && Object.entries(item.fields).every(([key, value]) => selectedEntry(key, value) && (key !== 'transactionId' || object(value) && value.value === item.transactionId)) && Array.isArray(item.omittedFields) && productReviewEqual(item.omittedFields, AUTHORITY_PACKAGE_FIELDS.filter(f => !selected.fields.includes(f))));
}
function preparedPackage(v: unknown, id: string): v is AuthorityPackage {
  return object(v) && exact(v, ['protocol', 'caseId', 'reference', 'document', ...Object.keys(effectValues)]) && v.protocol === 'authority_request_package_v1' && v.caseId === id && packageReference(v.reference) && snapshot(v.document, id, true) && object(v.document) && isDeclaredSupportAccountId(v.document.preparedBy) && object(v.document.decision) && exact(v.document.decision, ['action', 'reason', 'source', 'requestId', 'resultVersion']) && v.document.decision.action === 'prepare_package' && text(v.document.decision.reason) && source(v.document.decision.source) && text(v.document.decision.requestId, 128) && v.document.decision.resultVersion === v.reference.version && effects(v);
}
async function call(uid: string, name: 'readSupportRequests' | 'administerSupportRequest', body: Record<string, unknown>, guard: () => void) {
  const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
  const response = await httpsCallable<Record<string, unknown>, unknown>(functions, name)({expectedUid: uid, capability: AUTHORITY_REQUEST_CAPABILITY, ...body}); current(); return response.data;
}
export const AuthorityRequestService = {
  async attempt(uid: string, requestId: string, command: AuthorityCommand, guard: () => void): Promise<AuthorityAttempt> {
    if (!isAuthorityCommand(command)) throw authorityFailure();
    const payloadHash = await productReviewHash(command); guard();
    const id = command.action === 'receive' ? `authority_${await productReviewHash([uid, requestId])}` : command.caseId; guard();
    const result: AuthorityAttempt = {version: 1, uid, requestId, descriptor: {caseId: id, action: command.action, payloadHash}};
    if (!isAuthorityAttempt(result, uid)) throw authorityFailure(); return result;
  },
  async command(attempt: AuthorityAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void, command?: AuthorityCommand, verifyNew?: () => void): Promise<AuthorityReceipt> {
    if (!isAuthorityAttempt(attempt, attempt.uid)) throw authorityFailure();
    if (mode === 'execute') {if (!isAuthorityCommand(command) || await productReviewHash(command) !== attempt.descriptor.payloadHash) throw authorityFailure(); guard();}
    if (mode === 'execute') {verifyNew?.(); guard();}
    const raw = await call(attempt.uid, 'administerSupportRequest', {requestId: attempt.requestId, descriptor: attempt.descriptor, mode, ...(mode === 'execute' ? {command} : {})}, guard);
    if (!receipt(raw, attempt)) throw authorityFailure(); return raw;
  },
  async list(uid: string, cursor: string | null, guard: () => void): Promise<AuthorityList> {
    const raw = await call(uid, 'readSupportRequests', {operation: 'list', ...(cursor ? {cursor} : {})}, guard);
    if (!object(raw) || !exact(raw, ['protocol', 'actorId', 'items', 'hasMore', 'cursor', 'inspectedCount', 'hiddenOrUnknownCount', 'completeSelectedPage', 'completeHistory', ...Object.keys(effectValues)]) || raw.protocol !== 'authority_request_list_v1' || raw.actorId !== uid || !Array.isArray(raw.items) || !raw.items.every(caseView) || typeof raw.hasMore !== 'boolean' || !nullable(raw.cursor, productReviewDocumentId) || raw.hasMore !== (raw.cursor !== null) || !count(raw.inspectedCount) || raw.inspectedCount > 20 || !count(raw.hiddenOrUnknownCount) || raw.hiddenOrUnknownCount + raw.items.length !== raw.inspectedCount || raw.completeSelectedPage !== true || typeof raw.completeHistory !== 'boolean' || !effects(raw) || cursor !== null && raw.cursor !== null && String(raw.cursor) >= cursor) throw authorityFailure();
    return raw as unknown as AuthorityList; // All external fields are qualified above.
  },
  async detail(uid: string, id: string, eventsCursor: string | null, guard: () => void): Promise<AuthorityDetail> {
    const raw = await call(uid, 'readSupportRequests', {operation: 'detail', caseId: id, ...(eventsCursor ? {eventsCursor} : {})}, guard);
    if (!object(raw) || !exact(raw, ['protocol', 'actorId', 'case', 'events', 'earlierEventsExist', 'eventsCursor', 'latestPackage', 'packageQualification', ...Object.keys(effectValues)]) || raw.protocol !== 'authority_request_detail_v1' || raw.actorId !== uid || !caseView(raw.case) || raw.case.id !== id || !Array.isArray(raw.events) || raw.events.length > 10 || !raw.events.every(e => object(e) && productReviewDocumentId(e.id) && (e.qualification === 'unknown' && exact(e, ['id', 'qualification']) || e.qualification === 'package_reference_only' && exact(e, ['id', 'qualification', 'packageReference']) && nullable(e.packageReference, packageReference) || e.qualification === 'native' && exact(e, ['id', 'qualification', 'receipt', 'command']) && receipt(e.receipt) && e.receipt.caseId === id && nullable(e.command, isAuthorityCommand))) || typeof raw.earlierEventsExist !== 'boolean' || !nullable(raw.eventsCursor, productReviewDocumentId) || raw.earlierEventsExist !== (raw.eventsCursor !== null) || !nullable(raw.latestPackage, v => preparedPackage(v, id)) || !['native_private_snapshot', 'unknown', 'not_prepared'].includes(String(raw.packageQualification)) || !effects(raw)) throw authorityFailure();
    const result = raw as unknown as AuthorityDetail; // The complete private projection is validated above.
    for (const event of result.events) if (event.qualification === 'native' && event.command) {
      if (await productReviewHash(event.command) !== event.receipt.payloadHash || event.command.action !== event.receipt.action || event.command.action !== 'receive' && event.command.caseId !== id) throw authorityFailure(); guard();
    }
    return result;
  },
  async preview(uid: string, id: string, expected: AuthoritySource, guard: () => void): Promise<AuthorityPreview> {
    const raw = await call(uid, 'readSupportRequests', {operation: 'preview_package', caseId: id, source: expected}, guard);
    if (!object(raw) || !exact(raw, ['protocol', 'actorId', 'caseId', 'preview', ...Object.keys(effectValues)]) || raw.protocol !== 'authority_request_preview_read_v1' || raw.actorId !== uid || raw.caseId !== id || !effects(raw) || !object(raw.preview) || !exact(raw.preview, ['protocol', 'caseSource', 'sourceHash', 'snapshot', ...Object.keys(effectValues)]) || raw.preview.protocol !== 'authority_request_package_preview_v1' || !source(raw.preview.caseSource) || !productReviewEqual(raw.preview.caseSource, expected) || !hash(raw.preview.sourceHash) || !snapshot(raw.preview.snapshot, id) || !effects(raw.preview)) throw authorityFailure();
    return raw.preview as unknown as AuthorityPreview; // Native snapshot and exact source qualified above.
  },
  async package(uid: string, id: string, reference: AuthorityPackageReference, guard: () => void): Promise<AuthorityPackage | null> {
    const raw = await call(uid, 'readSupportRequests', {operation: 'read_package', caseId: id, packageReference: reference}, guard);
    if (!object(raw) || !exact(raw, ['protocol', 'actorId', 'caseId', 'package', 'qualification', ...Object.keys(effectValues)]) || raw.protocol !== 'authority_request_package_read_v1' || raw.actorId !== uid || raw.caseId !== id || !effects(raw) || (raw.package === null ? raw.qualification !== 'unknown' : !preparedPackage(raw.package, id) || !productReviewEqual(raw.package.reference, reference) || raw.qualification !== 'native_private_snapshot')) throw authorityFailure();
    return raw.package as AuthorityPackage | null; // Exact prepared reference qualified above.
  },
};

// Shared strict V1 projections used by the isolated legal review V2 reader.
export {caseView as isAuthorityCase, packageReference as isAuthorityPackageReference, selection as isAuthoritySelection, selectedEntry as isAuthoritySelectedEntry};
