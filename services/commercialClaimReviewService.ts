import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual, productReviewHash } from '@/services/productReviewService';
import { COMMERCIAL_CLAIM_REVIEW_CAPABILITY, type CommercialClaimNewContribution, type CommercialClaimReviewAttempt,
  type CommercialClaimReviewCommand, type CommercialClaimReviewEntry, type CommercialClaimReviewHistory,
  type CommercialClaimReviewReceipt, type CommercialClaimReviewReference, type CommercialClaimReviewSourceReference,
  type CommercialClaimSelectionPage, type CommercialClaimReviewSource } from '@/types/commercialClaimReview';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const id = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= 128 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const nativeId = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const text = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v && v.length <= 4000;
const documentId = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v) && Array.from(v).reduce((bytes, c) => bytes + (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4), 0) <= 1500;
const compareIds = (a: string, b: string) => {const x = Array.from(a), y = Array.from(b); for (let i = 0; i < Math.min(x.length, y.length); i++) {const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!; if (d) return d;} return x.length - y.length;};
const effects = ['financialEffectAuthorized', 'claimClosed', 'fundsReleased', 'inventoryPermissionGranted', 'legalDeadlineExtended', 'originalDecisionReversed'];
const noEffects = (v: Record<string, unknown>) => effects.every(key => v[key] === false);
export const commercialClaimReviewFailure = () => new Error('La plainte d’origine, son retrait et ses sources doivent être relus. Aucune clôture ni décision financière n’est confirmée.');
export function isCommercialClaimReviewReference(v: unknown): v is CommercialClaimReviewReference {
  return object(v) && exact(v, ['entryId', 'contentHash']) && nativeId(v.entryId, 'cr') && hash(v.contentHash);
}
function sourceReference(v: unknown): v is CommercialClaimReviewSourceReference {
  return object(v) && exact(v, ['sourceHash', 'claimRevision', 'claimHash', 'reviewVersion', 'reviewHash', 'corpusHash', 'membersHash']) && ['sourceHash', 'claimHash', 'reviewHash', 'corpusHash', 'membersHash'].every(key => hash(v[key])) && typeof v.claimRevision === 'string' && /^\d+:\d+$/.test(v.claimRevision) && count(v.reviewVersion);
}
function newContribution(v: unknown): v is CommercialClaimNewContribution {
  return object(v) && exact(v, ['id', 'contentHash', 'topic', ...('materialCapability' in v ? ['materialCapability'] : []), ...('parcelCapability' in v ? ['parcelCapability'] : [])]) && nativeId(v.id, 'pc') && hash(v.contentHash) && (v.topic === 'authenticity' || v.topic === 'nonconformity' && v.materialCapability === 'product_review_material_v1') && (!('materialCapability' in v) || v.materialCapability === 'product_review_material_v1') && (!('parcelCapability' in v) || v.parcelCapability === 'product_review_parcel_v1');
}
export function isCommercialClaimReviewCommand(v: unknown): v is CommercialClaimReviewCommand {
  return object(v) && exact(v, ['transactionId', 'claimId', 'action', 'source', 'narrative', 'withdrawal', 'newContribution', 'acknowledged']) && id(v.transactionId) && id(v.claimId) && sourceReference(v.source) && text(v.narrative) && v.acknowledged === true && (v.action === 'withdraw_claim' ? v.withdrawal === null && v.newContribution === null : v.action === 'request_reexamination' && isCommercialClaimReviewReference(v.withdrawal) && newContribution(v.newContribution));
}
export function isCommercialClaimReviewAttempt(v: unknown, uid: string): v is CommercialClaimReviewAttempt {
  return object(v) && exact(v, ['version', 'uid', 'requestId', 'capability', 'command']) && v.version === 1 && v.uid === uid && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && v.capability === COMMERCIAL_CLAIM_REVIEW_CAPABILITY && isCommercialClaimReviewCommand(v.command);
}
function entry(v: unknown): v is CommercialClaimReviewEntry {
  return object(v) && exact(v, ['reference', 'claimId', 'action', 'narrative', 'withdrawal', 'newContribution', 'recordedAt', 'originalClaimStatus', 'historicalOnly', ...effects]) && isCommercialClaimReviewReference(v.reference) && id(v.claimId) && text(v.narrative) && iso(v.recordedAt) && ['open', 'resolved'].includes(String(v.originalClaimStatus)) && v.historicalOnly === true && noEffects(v) && (v.action === 'withdraw_claim' ? v.withdrawal === null && v.newContribution === null : v.action === 'request_reexamination' && isCommercialClaimReviewReference(v.withdrawal) && newContribution(v.newContribution));
}
function page(v: unknown, uid: string, transactionId: string, scope: 'own' | 'admin', mode: 'source_observe' | 'history_observe', cursor: {lastId: string} | null): v is CommercialClaimSelectionPage | CommercialClaimReviewHistory {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'transactionId', 'items', 'nextCursor', 'coverage', ...effects]) || v.protocol !== (mode === 'source_observe' ? 'commercial_claim_review_claims_v1' : 'commercial_claim_review_history_v1') || v.actorId !== uid || v.transactionId !== transactionId || v.scope !== scope || !noEffects(v) || !Array.isArray(v.items) || v.items.length > 20 || !(v.nextCursor === null || object(v.nextCursor) && exact(v.nextCursor, ['lastId']) && documentId(v.nextCursor.lastId)) || !object(v.coverage) || !exact(v.coverage, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoryVerified']) || v.coverage.inspected !== v.items.length || v.coverage.limit !== 20 || v.coverage.hasMore !== (v.nextCursor !== null) || v.coverage.exhaustiveHistoryVerified !== false) return false;
  const ids: string[] = [];
  for (const row of v.items) {
    if (!object(row)) return false;
    if (mode === 'source_observe') {
      if (!exact(row, ['qualification', 'claimId', 'status', 'reason', 'createdAt']) || !documentId(row.claimId) || (row.qualification === 'native_original_claim' ? !nativeId(row.claimId, 'problem') || !['open', 'resolved'].includes(String(row.status)) || !['not_received_despite_delivered', 'not_as_described', 'damaged', 'other'].includes(String(row.reason)) || !iso(row.createdAt) : row.qualification !== 'unknown' || [row.status, row.reason, row.createdAt].some(value => value !== null))) return false;
      ids.push(row.claimId);
    } else if (row.qualification === 'native_recorded_entry') {
      if (!exact(row, ['qualification', 'entry']) || !entry(row.entry)) return false; ids.push(row.entry.reference.entryId);
    } else {
      if (!exact(row, ['qualification', 'entryId', 'entry']) || row.qualification !== 'unknown' || !documentId(row.entryId) || row.entry !== null) return false; ids.push(row.entryId);
    }
  }
  return ids.every((value, index) => (index === 0 || compareIds(value, ids[index - 1]) > 0) && (!cursor || compareIds(value, cursor.lastId) > 0)) && (v.nextCursor === null || v.coverage.inspected === 20 && v.nextCursor.lastId === ids.at(-1));
}
async function call(uid: string, body: Record<string, unknown>, guard: () => void, admin = false): Promise<unknown> {
  const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
  const user = auth.currentUser; if (!user || user.uid !== uid) throw commercialClaimReviewFailure();
  if (admin) {
    const token = await user.getIdTokenResult(true); current(); const time = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
    if (auth.currentUser !== user || token.claims.admin !== true || typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0 || time > now || now - time > 300) throw new Error('Confirmez votre identité opérateur avant de lire cette plainte privée.');
  } else {await user.getIdToken(); current();}
  const response = await httpsCallable<unknown, unknown>(functions, 'reportTransactionProblem')({capability: COMMERCIAL_CLAIM_REVIEW_CAPABILITY, expectedUid: uid, ...body}); current(); return response.data;
}
export const CommercialClaimReviewService = {
  async source(uid: string, transactionId: string, claimId: string, scope: 'own' | 'admin', guard: () => void): Promise<CommercialClaimReviewSource> {
    if (!id(transactionId) || !nativeId(claimId, 'problem')) throw commercialClaimReviewFailure();
    const value = await call(uid, {mode: 'source_observe', transactionId, claimId, scope}, guard, scope === 'admin');
    if (!object(value) || !exact(value, ['protocol', 'actorId', 'scope', 'transactionId', 'claimId', 'qualification', 'source', ...effects]) || value.protocol !== 'commercial_claim_review_source_v1' || value.actorId !== uid || value.scope !== scope || value.transactionId !== transactionId || value.claimId !== claimId || !noEffects(value)) throw commercialClaimReviewFailure();
    if (value.qualification === 'unknown' && value.source === null) return value as unknown as CommercialClaimReviewSource;
    const s = value.source;
    if (value.qualification !== 'native_original_claim' || !object(s) || !exact(s, ['reference', 'originalDisputeId', 'originalCreatedAt', 'currentStatus', 'caseId', 'documentarySourceHash', 'materialCapability', 'parcelCapability', 'initialResolution', 'reviewState', 'latestReference', 'newContributionCandidates', 'documentaryComplete', 'operatorAdmissionRequired']) || !sourceReference(s.reference) || s.originalDisputeId !== claimId || !iso(s.originalCreatedAt) || !['open', 'resolved'].includes(String(s.currentStatus)) || !nativeId(s.caseId, 'pr') || !hash(s.documentarySourceHash) || s.materialCapability !== 'product_review_material_v1' || s.parcelCapability !== 'product_review_parcel_v1' || !['unrecorded', 'withdrawn', 'reexamination_requested'].includes(String(s.reviewState)) || (s.reviewState === 'unrecorded' ? s.latestReference !== null : !isCommercialClaimReviewReference(s.latestReference)) || !Array.isArray(s.newContributionCandidates) || s.newContributionCandidates.length > 100 || !s.newContributionCandidates.every(c => newContribution(c) && c.materialCapability === s.materialCapability && c.parcelCapability === s.parcelCapability) || new Set(s.newContributionCandidates.map(c => (c as CommercialClaimNewContribution).id)).size !== s.newContributionCandidates.length || s.reviewState !== 'withdrawn' && s.newContributionCandidates.length > 0 || typeof s.documentaryComplete !== 'boolean' || s.operatorAdmissionRequired !== true) throw commercialClaimReviewFailure();
    if (s.currentStatus === 'open' ? s.initialResolution !== null : !object(s.initialResolution) || !exact(s.initialResolution, ['resolution', 'resolvedAt']) || !(s.initialResolution.resolution === null || ['dismissed', 'refunded', 'buyer_upheld'].includes(String(s.initialResolution.resolution))) || !(s.initialResolution.resolvedAt === null || iso(s.initialResolution.resolvedAt))) throw commercialClaimReviewFailure();
    const caseId = `pr_${await productReviewHash(['order', transactionId])}`; guard(); if (s.caseId !== caseId) throw commercialClaimReviewFailure();
    return value as unknown as CommercialClaimReviewSource;
  },
  async claims(uid: string, transactionId: string, scope: 'own' | 'admin', cursor: {lastId: string} | null, guard: () => void): Promise<CommercialClaimSelectionPage> {
    if (!id(transactionId) || cursor && !documentId(cursor.lastId)) throw commercialClaimReviewFailure();
    const value = await call(uid, {mode: 'source_observe', transactionId, scope, cursor}, guard, scope === 'admin');
    if (!page(value, uid, transactionId, scope, 'source_observe', cursor)) throw commercialClaimReviewFailure();
    guard(); return value as CommercialClaimSelectionPage;
  },
  async history(uid: string, transactionId: string, scope: 'own' | 'admin', cursor: {lastId: string} | null, guard: () => void): Promise<CommercialClaimReviewHistory> {
    if (!id(transactionId) || cursor && !documentId(cursor.lastId)) throw commercialClaimReviewFailure();
    const value = await call(uid, {mode: 'history_observe', transactionId, scope, cursor}, guard, scope === 'admin');
    if (!page(value, uid, transactionId, scope, 'history_observe', cursor)) throw commercialClaimReviewFailure();
    guard(); return value as CommercialClaimReviewHistory;
  },
  async command(attempt: CommercialClaimReviewAttempt, action: 'execute' | 'observe' | 'neutralize', guard: () => void): Promise<CommercialClaimReviewReceipt> {
    if (!isCommercialClaimReviewAttempt(attempt, attempt.uid)) throw commercialClaimReviewFailure();
    const payloadHash = await productReviewHash(attempt.command); guard();
    const expectedEntry = `cr_${await productReviewHash([attempt.uid, attempt.requestId])}`; guard();
    const value = await call(attempt.uid, {mode: 'command', requestId: attempt.requestId, action, command: attempt.command}, guard);
    if (!object(value) || !exact(value, ['protocol', 'actorId', 'requestId', 'command', 'payloadHash', 'state', 'reason', 'reference', 'recordedAt', ...effects]) || value.protocol !== 'commercial_claim_review_command_v1' || value.actorId !== attempt.uid || value.requestId !== attempt.requestId || !productReviewEqual(value.command, attempt.command) || value.payloadHash !== payloadHash || !['unrecorded', 'committed', 'not_executed'].includes(String(value.state)) || !noEffects(value)) throw commercialClaimReviewFailure();
    if (value.state === 'unrecorded' ? [value.reason, value.reference, value.recordedAt].some(v => v !== null) : !iso(value.recordedAt) || (value.state === 'committed' ? value.reason !== null || !isCommercialClaimReviewReference(value.reference) || value.reference.entryId !== expectedEntry : !text(value.reason) || value.reference !== null)) throw commercialClaimReviewFailure();
    guard(); return value as unknown as CommercialClaimReviewReceipt;
  },
};
