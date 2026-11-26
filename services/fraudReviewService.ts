import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { FraudReviewCases, FraudReviewClock, FraudReviewCursor, FraudReviewDetail, FraudReviewObservation,
  FraudReviewScope, FraudReviewSource, FraudReviewTransport, FraudHumanReview, FraudDecisionAttempt, FraudDecisionCommand,
  FraudDecisionPreview, FraudDecisionReceipt, FraudDecisionSource } from '@/types/fraudReview';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const failure = () => new Error('Les sources de cet examen doivent être relues. Aucune décision ni effet financier n’est confirmé.');
const effects = ['guiltEstablished', 'identityDecision', 'financialEffectAuthorized', 'inventoryReleaseAuthorized', 'guardReleased', 'recipientReceiptVerified', 'bankReceiptVerified'];
const noEffects = (v: Record<string, unknown>) => effects.every(key => v[key] === (key === 'identityDecision' ? 'none' : false));
function documentId(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.includes('/') || v === '.' || v === '..') return false;
  try {return encodeURIComponent(v).replace(/%[a-fA-F0-9]{2}/g, '_').length <= 1500;} catch {return false;}
}
function revision(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{1,20}:\d{1,9}$/.test(v)) return false;
  const [seconds, nanos] = v.split(':').map(Number);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 && Number.isSafeInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000;
}
function clock(v: unknown, allowed: FraudReviewClock['qualification'][] = ['native_timestamp']): v is FraudReviewClock {
  return object(v) && exact(v, ['qualification', 'at']) && (v.qualification === 'unknown' ? v.at === null :
    allowed.includes(v.qualification as FraudReviewClock['qualification']) && iso(v.at));
}
export function isFraudReviewSource(v: unknown): v is FraudReviewSource {
  return object(v) && exact(v, ['caseRevision', 'caseSourceHash', 'orderRevision', 'orderSourceHash']) &&
    (v.caseRevision === null || revision(v.caseRevision)) && hash(v.caseSourceHash) &&
    (v.orderRevision === null && v.orderSourceHash === null || revision(v.orderRevision) && hash(v.orderSourceHash));
}
export const sameFraudReviewSource = (a: FraudReviewSource, b: FraudReviewSource) => a.caseRevision === b.caseRevision && a.caseSourceHash === b.caseSourceHash &&
  a.orderRevision === b.orderRevision && a.orderSourceHash === b.orderSourceHash;
function cursor(v: unknown): v is FraudReviewCursor {return object(v) && exact(v, ['lastId']) && documentId(v.lastId);}
function pagination(v: unknown, limit: 10 | 20, items: number, prior?: FraudReviewCursor | null) {
  return object(v) && exact(v, ['inspected', 'limit', 'hasMore', 'nextCursor']) && v.limit === limit && cents(v.inspected) && v.inspected <= limit &&
    items <= v.inspected && typeof v.hasMore === 'boolean' && (v.hasMore ? v.inspected === limit && cursor(v.nextCursor) && v.nextCursor.lastId !== prior?.lastId : v.nextCursor === null);
}
function human(v: unknown): v is FraudHumanReview {
  if (!object(v) || !exact(v, ['qualification', 'action', 'decisionId', 'decidedAt', 'appliesToLatestObservation']) || !clock(v.decidedAt) || typeof v.appliesToLatestObservation !== 'boolean') return false;
  return v.qualification === 'native_human_receipt' ? ['retain_review', 'close_review_for_sources'].includes(String(v.action)) &&
    typeof v.decisionId === 'string' && /^fd_[a-f0-9]{64}$/.test(v.decisionId) && v.decidedAt.qualification === 'native_timestamp' :
    ['unknown', 'unrecorded'].includes(String(v.qualification)) && v.action === null && v.decisionId === null && v.decidedAt.qualification === 'unknown' && v.appliesToLatestObservation === false;
}
function publicState(v: Record<string, unknown>) {
  if (!human(v.humanReview)) return false;
  return v.qualification === 'native_case' ? v.publicState === (v.humanReview.appliesToLatestObservation && v.humanReview.action === 'close_review_for_sources'
    ? 'review_closed_for_sources' : 'human_review_required') : v.qualification === 'unknown' && v.publicState === 'unknown';
}
function summary(v: unknown, transactionId: string | null, scope: FraudReviewScope) {
  return object(v) && exact(v, ['caseId', 'transactionId', 'qualification', 'publicState', 'humanReview', 'firstObservedAt', 'source', ...effects]) && documentId(v.caseId) &&
    (v.transactionId === null || id(v.transactionId)) && (scope === 'admin' || v.transactionId === transactionId) &&
    (v.qualification !== 'native_case' || /^fr_[a-f0-9]{64}$/.test(v.caseId)) && publicState(v) &&
    clock(v.firstObservedAt) && isFraudReviewSource(v.source) && noEffects(v);
}
function observation(v: unknown): v is FraudReviewObservation {
  if (!object(v) || !exact(v, ['observationId', 'qualification', 'recordedAt', 'attribution', 'payment', 'signalCreatedAt', 'signalOccurredAt',
    'physicalDepositTimeVerified', 'nonDepositVerified', 'reviewStillRequired', ...effects]) || !documentId(v.observationId) ||
    !['native_observation', 'unknown'].includes(String(v.qualification)) || v.qualification === 'native_observation' && !hash(v.observationId) ||
    !clock(v.recordedAt) || !['native_order_qualified_at_observation', 'unknown'].includes(String(v.attribution)) || !clock(v.signalCreatedAt, ['provider_object_created']) ||
    !clock(v.signalOccurredAt, []) || v.physicalDepositTimeVerified !== false || v.nonDepositVerified !== false || v.reviewStillRequired !== true || !noEffects(v)) return false;
  if (v.qualification === 'unknown' && (v.recordedAt.qualification !== 'unknown' || v.signalCreatedAt.qualification !== 'unknown' || v.attribution !== 'unknown')) return false;
  const p = v.payment;
  if (!object(p) || !exact(p, ['qualification', 'currency', 'captureState', 'amountCents', 'capturedCents', 'occurredAt', 'bankReceiptVerified']) ||
    p.currency !== 'CAD' || !clock(p.occurredAt, []) || p.bankReceiptVerified !== false) return false;
  return v.attribution === 'unknown' ? p.qualification === 'unknown' && p.captureState === 'unknown' && p.amountCents === null && p.capturedCents === null :
    v.qualification === 'native_observation' && p.qualification === 'provider_get_qualified_at_observation' && cents(p.amountCents) && p.amountCents > 0 && cents(p.capturedCents) &&
    (p.captureState === 'captured' ? p.capturedCents === p.amountCents : p.captureState === 'authorized' && p.capturedCents === 0);
}
function transport(v: unknown): v is FraudReviewTransport {
  if (!object(v) || !exact(v, ['qualification', 'currentSource', 'capture', 'providerStatusCode', 'recordedAt', 'providerReadAt', 'providerEventAt',
    'physicalDepositTimeVerified', 'nonDepositVerified', 'recipientReceiptVerified']) || typeof v.currentSource !== 'boolean' ||
    !clock(v.recordedAt) || !clock(v.providerReadAt, ['provider_read']) || !clock(v.providerEventAt, ['provider_event']) ||
    v.physicalDepositTimeVerified !== false || v.nonDepositVerified !== false || v.recipientReceiptVerified !== false ||
    (v.providerStatusCode !== null && (typeof v.providerStatusCode !== 'string' || !/^[A-Z_]{1,64}$/.test(v.providerStatusCode)))) return false;
  if (v.qualification === 'unknown') return v.currentSource === false && v.capture === null && v.providerStatusCode === null &&
    v.recordedAt.qualification === 'unknown' && v.providerReadAt.qualification === 'unknown' && v.providerEventAt.qualification === 'unknown';
  const c = v.capture;
  return v.qualification === 'native_capture' && v.recordedAt.qualification === 'native_timestamp' && v.providerReadAt.qualification === 'provider_read' &&
    object(c) && exact(c, ['captureId', 'displayHash', 'sourceHash', 'readId', 'readVersion']) && typeof c.captureId === 'string' &&
    /^tracking_[a-f0-9]{64}$/.test(c.captureId) && hash(c.displayHash) && hash(c.sourceHash) && id(c.readId) && cents(c.readVersion) && c.readVersion > 0;
}
function parseCases(v: unknown, uid: string, scope: FraudReviewScope, transactionId: string | null, prior?: FraudReviewCursor | null): FraudReviewCases {
  if (!object(v) || !exact(v, ['protocol', 'ownerId', 'transactionId', 'readAt', 'items', 'pagination', 'coverage', ...effects]) ||
    v.protocol !== (scope === 'admin' ? 'fraud_admin_cases_v1' : 'fraud_owner_cases_v1') || v.ownerId !== uid || v.transactionId !== transactionId || !iso(v.readAt) ||
    !Array.isArray(v.items) || v.items.length > 10 || !v.items.every(item => summary(item, transactionId, scope)) ||
    new Set(v.items.map(item => item.caseId)).size !== v.items.length || !pagination(v.pagination, 10, v.items.length, prior) ||
    !object(v.coverage) || !exact(v.coverage, ['source', 'exhaustiveRiskHistoryVerified']) || v.coverage.source !== 'native_case_records' ||
    v.coverage.exhaustiveRiskHistoryVerified !== false || !noEffects(v)) throw failure();
  return v as unknown as FraudReviewCases;
}
function parseDetail(v: unknown, uid: string, scope: FraudReviewScope, transactionId: string | null, caseId: string, source: FraudReviewSource,
  prior?: FraudReviewCursor | null): FraudReviewDetail {
  if (!object(v) || !exact(v, ['protocol', 'ownerId', 'transactionId', 'caseId', 'readAt', 'source', 'qualification', 'publicState', 'humanReview', 'guard', 'items', 'currentTransport',
    'pagination', 'coverage', 'resolution', ...effects]) || v.protocol !== (scope === 'admin' ? 'fraud_admin_case_v1' : 'fraud_owner_case_v1') ||
    v.ownerId !== uid || v.transactionId !== transactionId || v.caseId !== caseId || !iso(v.readAt) || !isFraudReviewSource(v.source) || !sameFraudReviewSource(v.source, source) ||
    v.qualification === 'native_case' && !/^fr_[a-f0-9]{64}$/.test(caseId) || !publicState(v) ||
    !object(v.guard) || !exact(v.guard, ['qualification', 'reviewMarkerPresent', 'restrictionEnforcementVerified']) ||
    !['native_review_guard', 'unknown', 'absent'].includes(String(v.guard.qualification)) || typeof v.guard.reviewMarkerPresent !== 'boolean' ||
    v.guard.qualification === 'native_review_guard' && v.guard.reviewMarkerPresent !== true || v.guard.qualification === 'absent' && v.guard.reviewMarkerPresent !== false ||
    v.guard.restrictionEnforcementVerified !== false || !Array.isArray(v.items) || v.items.length > 20 || !v.items.every(observation) ||
    new Set(v.items.map(item => item.observationId)).size !== v.items.length || (v.currentTransport !== null && !transport(v.currentTransport)) ||
    !pagination(v.pagination, 20, v.items.length, prior) || !object(v.coverage) || !exact(v.coverage, ['source', 'chronologicalOrderVerified', 'exhaustiveRiskHistoryVerified']) ||
    v.coverage.source !== 'native_observations' || v.coverage.chronologicalOrderVerified !== false || v.coverage.exhaustiveRiskHistoryVerified !== false ||
    !object(v.resolution) || !exact(v.resolution, ['state', 'resolvedAt', 'legalDeadline']) || v.resolution.state !== v.publicState ||
    !clock(v.resolution.resolvedAt) || !clock(v.resolution.legalDeadline, []) || !noEffects(v)) throw failure();
  if (!human(v.humanReview) || (v.humanReview.appliesToLatestObservation && v.humanReview.action === 'close_review_for_sources' ?
    v.resolution.resolvedAt.at !== v.humanReview.decidedAt.at || v.resolution.resolvedAt.qualification !== 'native_timestamp' : v.resolution.resolvedAt.qualification !== 'unknown')) throw failure();
  return v as unknown as FraudReviewDetail;
}
async function rpc(uid: string, input: Record<string, unknown>, assertContext: () => void) {
  const session = captureTradeSession(uid); assertContext();
  const result = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({...input, expectedUid: session.uid});
  assertTradeSessionCurrent(session); assertContext(); return result.data;
}
const decisionFlags = ['guiltEstablished', 'financialEffectAuthorized', 'inventoryReleaseAuthorized', 'identityDecision', 'independentHoldsReleased', 'currentGuardStateVerified'];
const decisionNoEffects = (v: Record<string, unknown>) => decisionFlags.every(key => v[key] === (key === 'identityDecision' ? 'none' : false));
function decisionSource(v: unknown): v is FraudDecisionSource {
  return object(v) && exact(v, ['orderRevision', 'orderSourceHash', 'caseSetHash']) && revision(v.orderRevision) && hash(v.orderSourceHash) && hash(v.caseSetHash);
}
function decisionReference(v: unknown) {
  if (!object(v) || !exact(v, ['caseId', 'caseRevision', 'caseSourceHash', 'observationId', 'observationRevision', 'observationHash', 'reviewKey', 'qualification',
    'humanAction', 'humanDecisionId']) || !documentId(v.caseId) || (v.caseRevision !== null && !revision(v.caseRevision)) || !hash(v.caseSourceHash) ||
    !(v.observationId === null && v.observationRevision === null && v.observationHash === null || hash(v.observationId) && revision(v.observationRevision) && v.observationHash === v.observationId) ||
    (v.reviewKey !== null && !hash(v.reviewKey)) || !['native_current_case', 'unknown'].includes(String(v.qualification)) ||
    !['retain_review', 'close_review_for_sources', 'unknown', 'unreviewed'].includes(String(v.humanAction)) ||
    (v.humanDecisionId !== null && (typeof v.humanDecisionId !== 'string' || !/^fd_[a-f0-9]{64}$/.test(v.humanDecisionId))) ||
    ['retain_review', 'close_review_for_sources'].includes(String(v.humanAction)) && v.humanDecisionId === null) return false;
  return v.qualification !== 'native_current_case' || /^fr_[a-f0-9]{64}$/.test(v.caseId) && revision(v.caseRevision) && hash(v.observationId) && hash(v.reviewKey);
}
function parsePreview(v: unknown, uid: string, transactionId: string): FraudDecisionPreview {
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'transactionId', 'readAt', 'source', 'cases', 'coverage', 'canCloseOwnReview', 'canRetainReview', 'markerQualification', 'options', ...decisionFlags]) ||
    v.protocol !== 'fraud_review_preview_v1' || v.actorId !== uid || v.transactionId !== transactionId || !iso(v.readAt) || !decisionSource(v.source) ||
    !Array.isArray(v.cases) || v.cases.length > 30 || !v.cases.every(decisionReference) || new Set(v.cases.map(entry => entry.caseId)).size !== v.cases.length ||
    !object(v.coverage) || !exact(v.coverage, ['inspected', 'limit', 'hasMore', 'completeCurrentCaseSet', 'source', 'exhaustiveRiskHistoryVerified']) ||
    v.coverage.inspected !== v.cases.length || v.coverage.limit !== 30 || typeof v.coverage.hasMore !== 'boolean' ||
    v.coverage.completeCurrentCaseSet !== !v.coverage.hasMore || v.coverage.hasMore && v.cases.length !== 30 || v.coverage.source !== 'currently_attributed_native_cases' ||
    v.coverage.exhaustiveRiskHistoryVerified !== false || typeof v.canCloseOwnReview !== 'boolean' || typeof v.canRetainReview !== 'boolean' ||
    !['native_or_absent', 'unknown'].includes(String(v.markerQualification)) || v.canRetainReview && !v.cases.length ||
    v.canCloseOwnReview && (!v.canRetainReview || !v.coverage.completeCurrentCaseSet || v.markerQualification !== 'native_or_absent' || v.cases.some(entry => entry.qualification !== 'native_current_case')) ||
    !Array.isArray(v.options) || v.options.length !== 2 || v.options[0] !== 'retain_review' || v.options[1] !== 'close_review_for_sources' || !decisionNoEffects(v)) throw failure();
  return v as unknown as FraudDecisionPreview;
}
function command(v: unknown): v is FraudDecisionCommand {
  return object(v) && exact(v, ['transactionId', 'source', 'action', 'reason', 'acknowledged']) && id(v.transactionId) && decisionSource(v.source) &&
    ['retain_review', 'close_review_for_sources'].includes(String(v.action)) && typeof v.reason === 'string' && v.reason === v.reason.trim() &&
    v.reason.length > 0 && v.reason.length <= 2000 && v.acknowledged === true;
}
function attempt(v: unknown, uid: string): v is FraudDecisionAttempt {
  return object(v) && exact(v, ['version', 'uid', 'requestId', 'command']) && v.version === 1 && v.uid === uid && typeof v.requestId === 'string' &&
    /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && command(v.command);
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])]));
  return v;
}
export const fraudDecisionCommandHash = (v: FraudDecisionCommand) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
async function parseReceipt(v: unknown, a: FraudDecisionAttempt, assertCurrent: () => void): Promise<FraudDecisionReceipt> {
  const [payloadHash, nativeId] = await Promise.all([fraudDecisionCommandHash(a.command), digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([a.uid, a.requestId]))]);
  assertCurrent();
  if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'payloadHash', 'transactionId', 'action', 'state', 'decisionId', 'recordedAt', 'reason', 'ownMarkerRemovedAtCommit', ...decisionFlags]) ||
    v.protocol !== 'fraud_review_command_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || v.payloadHash !== payloadHash ||
    v.transactionId !== a.command.transactionId || v.action !== a.command.action || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) ||
    typeof v.ownMarkerRemovedAtCommit !== 'boolean' || v.ownMarkerRemovedAtCommit && (v.state !== 'committed' || v.action !== 'close_review_for_sources') || !decisionNoEffects(v)) throw failure();
  if (v.state === 'unrecorded' ? v.decisionId !== null || v.recordedAt !== null || v.reason !== null || v.ownMarkerRemovedAtCommit : !iso(v.recordedAt) ||
    (v.state === 'committed' ? v.decisionId !== `fd_${nativeId}` || v.reason !== null : v.decisionId !== null || v.ownMarkerRemovedAtCommit ||
      !['requester_neutralized', 'native_order_source_unqualified', 'source_changed', 'no_attributed_case', 'case_set_or_marker_unqualified'].includes(String(v.reason)))) throw failure();
  return v as unknown as FraudDecisionReceipt;
}
const journalKey = (uid: string) => `second:fraud-review-command:v1:${encodeURIComponent(uid)}`;
const locks = new Set<string>(), writes = new Map<string, Promise<void>>();
async function serialize(uid: string, work: () => Promise<void>) {
  const pending = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(uid, pending);
  try {await pending;} finally {if (writes.get(uid) === pending) writes.delete(uid);}
}
async function readPending(uid: string, assertContext: () => void): Promise<FraudDecisionAttempt[]> {
  const session = captureTradeSession(uid); assertContext(); const raw = await AsyncStorage.getItem(journalKey(uid)); assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return []; let v: unknown; try {v = JSON.parse(raw);} catch {throw failure();}
  if (!Array.isArray(v) || !v.every(entry => attempt(entry, uid)) || new Set(v.map(entry => entry.command.transactionId)).size !== v.length) throw failure();
  return v;
}
async function commandRpc(a: FraudDecisionAttempt, operation: 'execute' | 'observe' | 'neutralize', assertContext: () => void) {
  if (!attempt(a, a.uid)) throw failure(); const session = captureTradeSession(a.uid), assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
  const v = await rpc(a.uid, {mode: 'fraud_admin_decision_command', requestId: a.requestId, operation, command: a.command}, assertCurrent);
  return parseReceipt(v, a, assertCurrent);
}
async function locked<T>(a: FraudDecisionAttempt, assertContext: () => void, work: () => Promise<T>) {
  const session = captureTradeSession(a.uid), key = JSON.stringify([a.uid, a.command.transactionId]); assertContext(); if (locks.has(key) || !attempt(a, a.uid)) throw failure(); locks.add(key);
  try {assertTradeSessionCurrent(session); return await work();} finally {locks.delete(key);}
}
export const FraudReviewService = {
  async list(uid: string, scope: FraudReviewScope, transactionId: string | null, next: FraudReviewCursor | null, assertContext: () => void) {
    if (!['owner', 'admin'].includes(scope) || (scope === 'owner' ? !id(transactionId) : transactionId !== null) || next !== null && !cursor(next)) throw failure();
    const v = await rpc(uid, {mode: scope === 'admin' ? 'fraud_admin_cases_observe' : 'fraud_cases_observe',
      ...(scope === 'owner' ? {transactionId} : {}), ...(next ? {cursor: next} : {})}, assertContext);
    return parseCases(v, uid, scope, transactionId, next);
  },
  async detail(uid: string, scope: FraudReviewScope, transactionId: string | null, caseId: string, expectedSource: FraudReviewSource, next: FraudReviewCursor | null,
    assertContext: () => void) {
    if (!['owner', 'admin'].includes(scope) || (scope === 'owner' ? !id(transactionId) : transactionId !== null && !id(transactionId)) || !documentId(caseId) ||
      !isFraudReviewSource(expectedSource) || expectedSource.caseRevision === null || next !== null && !cursor(next)) throw failure();
    const v = await rpc(uid, {mode: scope === 'admin' ? 'fraud_admin_case_observe' : 'fraud_case_observe', caseId, expectedSource,
      ...(scope === 'owner' ? {transactionId} : {}), ...(next ? {cursor: next} : {})}, assertContext);
    return parseDetail(v, uid, scope, transactionId, caseId, expectedSource, next);
  },
  async preview(uid: string, transactionId: string, assertContext: () => void): Promise<FraudDecisionPreview> {
    if (!id(transactionId)) throw failure(); return parsePreview(await rpc(uid, {mode: 'fraud_admin_decision_preview', transactionId}, assertContext), uid, transactionId);
  },
  pending: readPending,
  observe: (a: FraudDecisionAttempt, assertContext: () => void) => commandRpc(a, 'observe', assertContext),
  async execute(a: FraudDecisionAttempt, assertContext: () => void) {
    return locked(a, assertContext, async () => {
      const session = captureTradeSession(a.uid);
      await serialize(a.uid, async () => {const all = await readPending(a.uid, assertContext), prior = all.find(entry => entry.command.transactionId === a.command.transactionId);
        if (prior) throw failure(); assertTradeSessionCurrent(session); assertContext();
        await AsyncStorage.setItem(journalKey(a.uid), JSON.stringify([...all, a])); assertTradeSessionCurrent(session); assertContext();});
      await commandRpc(a, 'execute', assertContext); return commandRpc(a, 'observe', assertContext);
    });
  },
  async neutralize(a: FraudDecisionAttempt, assertContext: () => void) {
    return locked(a, assertContext, async () => {const all = await readPending(a.uid, assertContext), prior = all.find(entry => entry.command.transactionId === a.command.transactionId);
      if (!prior || JSON.stringify(canonical(prior)) !== JSON.stringify(canonical(a))) throw failure();
      await commandRpc(a, 'neutralize', assertContext); return commandRpc(a, 'observe', assertContext);});
  },
  async acknowledge(a: FraudDecisionAttempt, assertContext: () => void) {
    return locked(a, assertContext, async () => {const session = captureTradeSession(a.uid), receipt = await commandRpc(a, 'observe', assertContext);
      if (receipt.state === 'unrecorded') throw failure();
      await serialize(a.uid, async () => {const all = await readPending(a.uid, assertContext), prior = all.find(entry => entry.command.transactionId === a.command.transactionId);
        if (!prior || JSON.stringify(canonical(prior)) !== JSON.stringify(canonical(a))) throw failure(); assertTradeSessionCurrent(session); assertContext();
        await AsyncStorage.setItem(journalKey(a.uid), JSON.stringify(all.filter(entry => entry.command.transactionId !== a.command.transactionId)));
        assertTradeSessionCurrent(session); assertContext();}); return receipt;});
  },
};
