import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {functions} from '@/config/firebaseConfig';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewEqual, productReviewHash, productReviewDocumentId} from '@/services/productReviewService';
import {isSellerActivityItem, isSellerActivityRecordSource, isSellerActivityDateFact, sellerActivityDocumentAfter} from '@/services/sellerActivityFactsService';
import {SELLER_ACTIVITY_REVIEW_CAPABILITY, SELLER_ACTIVITY_REVIEW_CRITERIA_VERSION, SELLER_ACTIVITY_REVIEW_CRITERIA_CODES} from '@/types/sellerActivityReview';
import type {SellerActivityAnchor, SellerActivityPeriod, SellerActivityReviewAttempt, SellerActivityReviewCommand, SellerActivityReviewPreview, SellerActivityReviewReceipt, SellerActivityAdminOrigin} from '@/types/sellerActivityReview';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && !!v.trim() && v === v.trim() && v.length <= max;
const id = productReviewDocumentId;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v && Date.parse(v) >= 0;
const nullable = (v: unknown, test: (v: unknown) => boolean) => v === null || test(v);
const effects = {fraudEstablished: false, professionalClassification: null, taxRegistrationEstablished: false, financialEffect: 'none', inventoryEffect: 'none', automaticThresholdApplied: false} as const;
const noInference = (v: Record<string, unknown>) => Object.entries(effects).every(([k, expected]) => v[k] === expected);
export const sellerActivityReviewFailure = () => new Error('Relisez les faits, la portée et l’habilitation actuels. Aucun seuil ne conclut une fraude ou un statut professionnel.');
export const isSellerActivityReviewId = (v: unknown): v is string => typeof v === 'string' && /^review_activity_review_[a-f0-9]{64}$/.test(v);
export const isEligibilityReviewReference = (v: unknown): v is string => typeof v === 'string' && /^review_(?:activity_review_)?[a-f0-9]{64}$/.test(v);
export const isSellerActivityAnchor = (v: unknown): v is SellerActivityAnchor => object(v) && exact(v, ['kind', 'id']) && ['article', 'order'].includes(String(v.kind)) && id(v.id);
export const isSellerActivityPeriod = (v: unknown): v is SellerActivityPeriod => object(v) && exact(v, ['fromInclusive', 'toExclusive']) && iso(v.fromInclusive) && iso(v.toExclusive) && v.fromInclusive < v.toExclusive && Date.parse(v.toExclusive) <= Date.now();
export function isSellerActivityReviewAttempt(v: unknown, uid: string): v is SellerActivityReviewAttempt {return object(v) && exact(v, ['version', 'uid', 'requestId', 'payloadHash']) && v.version === 1 && v.uid === uid && id(uid) && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && hash(v.payloadHash);}
export function isSellerActivityReviewCommand(v: unknown): v is SellerActivityReviewCommand {
  return object(v) && exact(v, ['anchor', 'period', 'cursor', 'expectedSourceHash', 'expectedEligibilityVersion', 'criteriaVersion', 'criteriaCodes', 'ownerReason', 'internalNote']) &&
    isSellerActivityAnchor(v.anchor) && isSellerActivityPeriod(v.period) && nullable(v.cursor, id) && hash(v.expectedSourceHash) && hash(v.expectedEligibilityVersion) && v.criteriaVersion === SELLER_ACTIVITY_REVIEW_CRITERIA_VERSION &&
    Array.isArray(v.criteriaCodes) && v.criteriaCodes.length > 0 && v.criteriaCodes.length <= 4 && v.criteriaCodes.every(c => (SELLER_ACTIVITY_REVIEW_CRITERIA_CODES as readonly unknown[]).includes(c)) && new Set(v.criteriaCodes).size === v.criteriaCodes.length && text(v.ownerReason) && nullable(v.internalNote, text);
}
export function parseSellerActivityReviewPreview(v: unknown, uid: string, anchor: SellerActivityAnchor, period: SellerActivityPeriod, cursor: string | null): SellerActivityReviewPreview {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'sellerId', 'readAt', 'anchor', 'period', 'cursor', 'facts', 'eligibilityVersion', 'sourceHash', 'criteriaVersion', 'criteria', 'reviewScope', 'reviewRequiredByOperator', ...Object.keys(effects)]) ||
    v.protocol !== SELLER_ACTIVITY_REVIEW_CAPABILITY || v.actorId !== uid || !id(v.sellerId) || !iso(v.readAt) || !object(v.anchor) || !exact(v.anchor, ['kind', 'id', 'sellerId', 'revision', 'sourceHash']) ||
    v.anchor.kind !== anchor.kind || v.anchor.id !== anchor.id || v.anchor.sellerId !== v.sellerId || typeof v.anchor.revision !== 'string' || !/^\d{1,20}:\d{1,9}$/.test(v.anchor.revision) || !hash(v.anchor.sourceHash) ||
    !productReviewEqual(v.period, period) || v.cursor !== cursor || !hash(v.eligibilityVersion) || !hash(v.sourceHash) || v.criteriaVersion !== SELLER_ACTIVITY_REVIEW_CRITERIA_VERSION || !noInference(v) ||
    v.reviewScope !== 'sell' || v.reviewRequiredByOperator !== true || !Array.isArray(v.criteria) || v.criteria.length !== 4 || !v.criteria.every((c, i) => object(c) && exact(c, ['code', 'label']) && c.code === SELLER_ACTIVITY_REVIEW_CRITERIA_CODES[i] && text(c.label, 300))) throw sellerActivityReviewFailure();
  const f = v.facts;
  if (!object(f) || !exact(f, ['profile', 'items', 'pagination', 'coverage', 'activityDeclaration']) || !object(f.profile) || !exact(f.profile, ['source', 'recordedCreatedAt', 'authCreatedAt']) ||
    !isSellerActivityRecordSource(f.profile.source, true) || !isSellerActivityDateFact(f.profile.recordedCreatedAt, v.readAt) || !object(f.profile.authCreatedAt)) throw sellerActivityReviewFailure();
  const auth = f.profile.authCreatedAt;
  if (!exact(auth, ['qualification', 'at', 'reason', 'source']) || auth.source !== 'firebase_auth' || (auth.qualification === 'unknown' ? auth.at !== null || !text(auth.reason, 200) :
    auth.qualification !== 'native_auth_metadata' || !iso(auth.at) || auth.at > v.readAt || auth.reason !== null) || !Array.isArray(f.items) || f.items.length > 20) throw sellerActivityReviewFailure();
  const items = f.items;
  if (!items.every(item => {if (!object(item)) return false; const {periodMembership, ...native} = item; return isSellerActivityItem(native, String(v.readAt)) && periodMembership === (native.createdAt.at === null ? 'unknown' : native.createdAt.at >= period.fromInclusive && native.createdAt.at < period.toExclusive ? 'inside' : 'outside');})) throw sellerActivityReviewFailure();
  const p = f.pagination, c = f.coverage, declaration = f.activityDeclaration;
  if (!object(p) || !exact(p, ['inspected', 'limit', 'hasMore', 'nextCursor']) || p.inspected !== items.length || p.limit !== 20 || p.hasMore !== (items.length === 20) ||
    (p.hasMore ? !object(p.nextCursor) || !exact(p.nextCursor, ['lastId', 'scopeHash']) || p.nextCursor.lastId !== items.at(-1)?.transactionId || !hash(p.nextCursor.scopeHash) : p.nextCursor !== null) ||
    !object(c) || !exact(c, ['source', 'order', 'chronologicalOrderVerified', 'exhaustiveHistoryVerified', 'accountingSnapshot', 'globalTotalsProvided', 'firstInspectedId', 'lastInspectedId', 'afterId', 'period', 'periodDateField', 'unknownDatesIncluded', 'periodCoverageVerified']) ||
    c.source !== 'native_transactions_for_seller' || c.order !== 'document_id' || c.chronologicalOrderVerified !== false || c.exhaustiveHistoryVerified !== false || c.accountingSnapshot !== false || c.globalTotalsProvided !== false ||
    c.firstInspectedId !== (items[0]?.transactionId ?? null) || c.lastInspectedId !== (items.at(-1)?.transactionId ?? null) || c.afterId !== cursor || !productReviewEqual(c.period, period) || c.periodDateField !== 'transactions.createdAt' || c.unknownDatesIncluded !== true || c.periodCoverageVerified !== false ||
    !object(declaration) || !exact(declaration, ['kind', 'qualification', 'legallyVerified', 'source']) || !isSellerActivityRecordSource(declaration.source, true) || ![null, 'personal', 'professional'].includes(declaration.kind as 'personal' | null) || declaration.qualification !== (declaration.kind === null ? 'unknown' : 'recorded_declaration_only') || declaration.legallyVerified !== false) throw sellerActivityReviewFailure();
  let prior = cursor; for (const item of items) {const current = String(item.transactionId); if (prior !== null && !sellerActivityDocumentAfter(current, prior)) throw sellerActivityReviewFailure(); prior = current;}
  return v as unknown as SellerActivityReviewPreview; // All closed facts and period membership are qualified above.
}
export function parseSellerActivityReviewReceipt(v: unknown, attempt: SellerActivityReviewAttempt): SellerActivityReviewReceipt {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'payloadHash', 'state', 'committed', 'replay', 'reviewId', 'signalId', 'reason', 'recordedAt', 'notice', ...Object.keys(effects)]) || v.protocol !== SELLER_ACTIVITY_REVIEW_CAPABILITY ||
    v.actorId !== attempt.uid || v.requestId !== attempt.requestId || v.payloadHash !== attempt.payloadHash || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) || v.committed !== (v.state === 'committed') || typeof v.replay !== 'boolean' || !noInference(v)) throw sellerActivityReviewFailure();
  if (v.state === 'unrecorded' ? v.recordedAt !== null || v.reviewId !== null || v.signalId !== null || v.reason !== null || v.notice !== null : !iso(v.recordedAt)) throw sellerActivityReviewFailure();
  if (v.state === 'not_executed' && (v.reviewId !== null || v.signalId !== null || !text(v.reason, 200) || v.notice !== null)) throw sellerActivityReviewFailure();
  const n = v.notice;
  if (v.state === 'committed' && (!isSellerActivityReviewId(v.reviewId) || typeof v.signalId !== 'string' || !/^signal_activity_review_[a-f0-9]{64}$/.test(v.signalId) || v.reason !== null || !object(n) ||
    !exact(n, ['notificationId', 'inAppCommitted', 'deviceDeliveryVerified', 'readingVerified', ...(Object.hasOwn(n, 'committedAt') ? ['committedAt'] : [])]) || !text(n.notificationId, 200) || n.inAppCommitted !== true || n.deviceDeliveryVerified !== false || n.readingVerified !== false || Object.hasOwn(n, 'committedAt') && !iso(n.committedAt))) throw sellerActivityReviewFailure();
  return v as unknown as SellerActivityReviewReceipt; // Native owner tuple and every receipt field are qualified above.
}
export function parseSellerActivityAdminOrigin(v: unknown, recordedAt: unknown): SellerActivityAdminOrigin | null {
  if (v === null || v === undefined) return null;
  if (!object(v) || !exact(v, ['protocol', 'sourceHash', 'criteriaVersion', 'criteriaCodes', 'signalIds', 'openedBy', 'reviewedSource']) || v.protocol !== SELLER_ACTIVITY_REVIEW_CAPABILITY ||
    !hash(v.sourceHash) || !id(v.openedBy) || v.criteriaVersion !== SELLER_ACTIVITY_REVIEW_CRITERIA_VERSION || !Array.isArray(v.criteriaCodes) || !v.criteriaCodes.length || v.criteriaCodes.length > 4 ||
    !v.criteriaCodes.every(c => (SELLER_ACTIVITY_REVIEW_CRITERIA_CODES as readonly unknown[]).includes(c)) || new Set(v.criteriaCodes).size !== v.criteriaCodes.length || !Array.isArray(v.signalIds) || v.signalIds.length !== 1 ||
    typeof v.signalIds[0] !== 'string' || !/^signal_activity_review_[a-f0-9]{64}$/.test(v.signalIds[0]) || !object(v.reviewedSource) || !exact(v.reviewedSource, ['anchor', 'period', 'cursor', 'facts', 'eligibilityVersion']) || !iso(recordedAt)) throw sellerActivityReviewFailure();
  const source = v.reviewedSource;
  if (!object(source.anchor) || !isSellerActivityPeriod(source.period) || !nullable(source.cursor, id)) throw sellerActivityReviewFailure();
  const anchor = {kind: source.anchor.kind, id: source.anchor.id}; if (!isSellerActivityAnchor(anchor)) throw sellerActivityReviewFailure();
  // Qualify the stored source with the same closed facts codec. These display
  // context fields are not persisted, source-hashed or inferred as new evidence.
  parseSellerActivityReviewPreview({protocol: v.protocol, actorId: v.openedBy, sellerId: source.anchor.sellerId, readAt: recordedAt, ...source,
    sourceHash: v.sourceHash, criteriaVersion: v.criteriaVersion, criteria: SELLER_ACTIVITY_REVIEW_CRITERIA_CODES.map(code => ({code, label: code})), reviewScope: 'sell', reviewRequiredByOperator: true, ...effects},
    v.openedBy, anchor, source.period, source.cursor as string | null);
  return v as unknown as SellerActivityAdminOrigin; // Original source and private metadata are fully qualified above.
}
async function rpc(uid: string, name: 'readSupportRequests' | 'administerSupportRequest', data: Record<string, unknown>, guard: () => void) {const s = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(s); guard();}; current();
  const response = await httpsCallable<Record<string, unknown>, unknown>(functions, name)({capability: SELLER_ACTIVITY_REVIEW_CAPABILITY, expectedUid: uid, expectedAdminUid: uid, ...data}); current(); return response.data;}
export const SellerActivityReviewService = {
  async preview(uid: string, anchor: SellerActivityAnchor, period: SellerActivityPeriod, cursor: string | null, guard: () => void) {if (!isSellerActivityAnchor(anchor) || !isSellerActivityPeriod(period) || !nullable(cursor, id)) throw sellerActivityReviewFailure();
    return parseSellerActivityReviewPreview(await rpc(uid, 'readSupportRequests', {mode: 'seller_activity_review_preview', anchor, period, cursor}, guard), uid, anchor, period, cursor);},
  async attempt(uid: string, requestId: string, command: SellerActivityReviewCommand, guard: () => void): Promise<SellerActivityReviewAttempt> {if (!isSellerActivityReviewCommand(command)) throw sellerActivityReviewFailure(); const payloadHash = await productReviewHash(command); guard();
    const attempt: SellerActivityReviewAttempt = {version: 1, uid, requestId, payloadHash}; if (!isSellerActivityReviewAttempt(attempt, uid)) throw sellerActivityReviewFailure(); return attempt;},
  async command(attempt: SellerActivityReviewAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void, command?: SellerActivityReviewCommand) {if (!isSellerActivityReviewAttempt(attempt, attempt.uid)) throw sellerActivityReviewFailure();
    if (mode === 'execute' && (!isSellerActivityReviewCommand(command) || await productReviewHash(command) !== attempt.payloadHash)) throw sellerActivityReviewFailure(); guard();
    const receipt = parseSellerActivityReviewReceipt(await rpc(attempt.uid, 'administerSupportRequest', {mode, requestId: attempt.requestId, ...(mode === 'execute' ? {command} : {descriptor: {payloadHash: attempt.payloadHash}})}, guard), attempt);
    if (receipt.state === 'committed') {const identity = await productReviewHash([attempt.uid, attempt.requestId]); guard(); if (receipt.reviewId !== `review_activity_review_${identity}` || receipt.signalId !== `signal_activity_review_${identity}`) throw sellerActivityReviewFailure();}
    guard(); return receipt;},
};
