import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { RETURN_TO_SENDER_STATEMENT_VERSION } from '@/types/returnToSender';
import type { ReturnToSenderAttempt, ReturnToSenderCase, ReturnToSenderCases, ReturnToSenderFinancialRecording, ReturnToSenderReceipt,
  ReturnToSenderSource, ReturnToSenderSourceReference, ReturnToSenderSupportReference, ReturnToSenderReport, ReturnToSenderSupportSource } from '@/types/returnToSender';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const caseId = (v: unknown): v is string => typeof v === 'string' && /^rts_[a-f0-9]{64}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 4000;
const failure = () => new Error('Ce signalement et ses sources restent à vérifier. Conservez exactement la même intention avant une nouvelle déclaration.');
export function isReturnToSenderRevision(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) return false;
  const [seconds, nanos] = v.split(':').map(Number);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 && Number.isSafeInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000;
}
export function isReturnToSenderSourceReference(v: unknown): v is ReturnToSenderSourceReference {
  if (!object(v) || !exact(v, ['orderRevision', 'sourceHash', 'financialSourceHash', 'capture', 'captureQualification']) || !isReturnToSenderRevision(v.orderRevision) ||
    !hash(v.sourceHash) || !hash(v.financialSourceHash) || !['native_capture', 'absent', 'historical_unknown'].includes(String(v.captureQualification)) ||
    (v.captureQualification === 'native_capture') !== (v.capture !== null)) return false;
  const c = v.capture;
  return c === null || object(c) && exact(c, ['captureId', 'displayHash', 'sourceHash', 'readVersion']) && typeof c.captureId === 'string' &&
    /^tracking_[a-f0-9]{64}$/.test(c.captureId) && hash(c.displayHash) && hash(c.sourceHash) && Number.isSafeInteger(c.readVersion) && (c.readVersion as number) > 0;
}
export function isReturnToSenderFinancialRecording(v: unknown): v is ReturnToSenderFinancialRecording {
  return object(v) && exact(v, ['refundSource', 'releaseSource', 'moneyReturnedVerified', 'bankReceiptVerified', 'financialEffectAuthorized']) &&
    ['absent', 'record_present_unverified'].includes(String(v.refundSource)) && ['absent', 'native_timestamp_recorded', 'historical_unknown'].includes(String(v.releaseSource)) &&
    v.moneyReturnedVerified === false && v.bankReceiptVerified === false && v.financialEffectAuthorized === false;
}
export function isReturnToSenderSupportReference(v: unknown): v is ReturnToSenderSupportReference {
  return object(v) && exact(v, ['kind', 'transactionId', 'caseId', 'caseRevision', 'caseHash', 'financialSourceHash', 'orderRevision']) &&
    v.kind === 'return_to_sender_report' && id(v.transactionId) && caseId(v.caseId) && isReturnToSenderRevision(v.caseRevision) &&
    hash(v.caseHash) && hash(v.financialSourceHash) && isReturnToSenderRevision(v.orderRevision);
}
const flags = ['reportVerified', 'returnToSenderVerified', 'recipientReceiptVerified', 'contentsVerified', 'financialEffectAuthorized', 'inventoryReleaseAuthorized'];
export const returnToSenderSourceReference = (v: ReturnToSenderSource): ReturnToSenderSourceReference => ({orderRevision: v.orderRevision, sourceHash: v.sourceHash,
  financialSourceHash: v.financialSourceHash, capture: v.capture, captureQualification: v.captureQualification});
export function parseReturnToSenderSource(v: unknown, uid: string, transactionId: string): ReturnToSenderSource {
  if (!object(v) || !exact(v, ['protocol', 'ownerId', 'transactionId', 'orderRevision', 'sourceHash', 'financialSourceHash', 'financialRecording', 'capture',
    'captureQualification', 'currentCapture', 'transportContext', ...flags]) || v.protocol !== 'return_to_sender_source_v1' || v.ownerId !== uid || v.transactionId !== transactionId ||
    !isReturnToSenderSourceReference({orderRevision: v.orderRevision, sourceHash: v.sourceHash, financialSourceHash: v.financialSourceHash, capture: v.capture, captureQualification: v.captureQualification}) ||
    !isReturnToSenderFinancialRecording(v.financialRecording) || typeof v.currentCapture !== 'boolean' || typeof v.transportContext !== 'boolean' ||
    v.currentCapture && v.captureQualification !== 'native_capture' || flags.some(key => v[key] !== false)) throw failure();
  return v as unknown as ReturnToSenderSource;
}
export function isReturnToSenderReport(v: unknown, transactionId: string): v is ReturnToSenderReport {
  return object(v) && exact(v, ['protocol', 'caseId', 'transactionId', 'reporterId', 'version', 'narrative', 'statementVersion', 'source', 'recordedAt',
    ...flags, 'guardReleased']) && v.protocol === 'return_to_sender_case_v1' && caseId(v.caseId) && v.transactionId === transactionId &&
    id(v.reporterId) && v.version === 1 && text(v.narrative) && v.statementVersion === RETURN_TO_SENDER_STATEMENT_VERSION && isReturnToSenderSourceReference(v.source) &&
    iso(v.recordedAt) && flags.every(key => v[key] === false) && v.guardReleased === false;
}
export function isReturnToSenderCase(v: unknown, transactionId: string): v is ReturnToSenderCase {
  if (!object(v)) return false;
  const {caseRevision, caseHash, ...report} = v;
  return isReturnToSenderReport(report, transactionId) && (caseRevision === null || isReturnToSenderRevision(caseRevision)) && hash(caseHash);
}
export function isReturnToSenderSupportSource(v: unknown, transactionId: string): v is ReturnToSenderSupportSource {
  return object(v) && exact(v, ['protocol', 'reference', 'report', 'financialRecording', 'recipientReceiptVerified', 'contentsVerified', 'financialEffectAuthorized', 'inventoryReleaseAuthorized']) &&
    v.protocol === 'return_to_sender_support_source_v1' && isReturnToSenderSupportReference(v.reference) && v.reference.transactionId === transactionId &&
    isReturnToSenderReport(v.report, transactionId) && v.report.caseId === v.reference.caseId && isReturnToSenderFinancialRecording(v.financialRecording) &&
    v.recipientReceiptVerified === false && v.contentsVerified === false && v.financialEffectAuthorized === false && v.inventoryReleaseAuthorized === false;
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])]));
  return v;
}
export const returnToSenderCommandHash = (command: ReturnToSenderAttempt['command']) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(command)));
function attempt(v: unknown, uid: string, transactionId: string): v is ReturnToSenderAttempt {
  if (!object(v) || !exact(v, ['version', 'uid', 'requestId', 'command']) || v.version !== 1 || v.uid !== uid || typeof v.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) || !object(v.command)) return false;
  const c = v.command;
  return exact(c, ['transactionId', 'narrative', 'statementVersion', 'accepted', 'source']) && id(c.transactionId) && c.transactionId === transactionId &&
    text(c.narrative) && c.statementVersion === RETURN_TO_SENDER_STATEMENT_VERSION && c.accepted === true && isReturnToSenderSourceReference(c.source);
}
async function receipt(v: unknown, a: ReturnToSenderAttempt, assertCurrent: () => void): Promise<ReturnToSenderReceipt> {
  const expectedHash = await returnToSenderCommandHash(a.command); assertCurrent();
  if (!object(v) || !exact(v, ['protocol', 'ownerId', 'requestId', 'transactionId', 'payloadHash', 'state', 'caseId', 'recordedAt', 'reason', 'financialEffectAuthorized', 'inventoryReleaseAuthorized']) ||
    v.protocol !== 'return_to_sender_command_v1' || v.ownerId !== a.uid || v.requestId !== a.requestId || v.transactionId !== a.command.transactionId || v.payloadHash !== expectedHash ||
    !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) || v.financialEffectAuthorized !== false || v.inventoryReleaseAuthorized !== false) throw failure();
  if (v.state === 'unrecorded' ? v.caseId !== null || v.recordedAt !== null || v.reason !== null : !iso(v.recordedAt) ||
    (v.state === 'committed' ? !caseId(v.caseId) || v.reason !== null : v.caseId !== null || !['command_neutralized', 'source_changed', 'transport_context_unqualified', 'guard_source_unqualified', 'case_capacity_requires_review'].includes(String(v.reason)))) throw failure();
  return v as unknown as ReturnToSenderReceipt;
}
const key = (uid: string, transactionId: string) => `second:return-to-sender:v1:${JSON.stringify([uid, transactionId])}`;
const locks = new Set<string>();
const writes = new Map<string, Promise<void>>();
async function serialize(slot: string, work: () => Promise<void>) {
  const pending = (writes.get(slot) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(slot, pending);
  try {await pending;} finally {if (writes.get(slot) === pending) writes.delete(slot);}
}
async function rpc(a: ReturnToSenderAttempt, operation: 'execute' | 'observe' | 'neutralize', assertContext: () => void) {
  const session = captureTradeSession(a.uid), assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();}; assertCurrent();
  if (!attempt(a, a.uid, a.command.transactionId)) throw failure();
  const result = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({mode: 'return_to_sender_command', expectedUid: a.uid,
    requestId: a.requestId, operation, command: a.command}); assertCurrent(); return receipt(result.data, a, assertCurrent);
}
export const ReturnToSenderService = {
  async source(uid: string, transactionId: string, assertContext: () => void): Promise<ReturnToSenderSource> {
    const session = captureTradeSession(uid); assertContext(); if (!id(transactionId)) throw failure();
    const result = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({mode: 'return_to_sender_source_observe', expectedUid: uid, transactionId});
    assertTradeSessionCurrent(session); assertContext(); return parseReturnToSenderSource(result.data, uid, transactionId);
  },
  async cases(uid: string, transactionId: string, scope: 'owner' | 'admin', assertContext: () => void): Promise<ReturnToSenderCases> {
    const session = captureTradeSession(uid); assertContext(); if (!id(transactionId) || !['owner', 'admin'].includes(scope)) throw failure();
    const result = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({mode: 'return_to_sender_cases_observe', expectedUid: uid, transactionId, scope});
    assertTradeSessionCurrent(session); assertContext(); const v = result.data;
    if (!object(v) || !exact(v, ['protocol', 'ownerId', 'transactionId', 'sourceRevision', 'financialSourceHash', 'financialRecording', 'guardPresent', 'items', 'financialEffectAuthorized', 'inventoryReleaseAuthorized']) ||
      v.protocol !== 'return_to_sender_cases_v1' || v.ownerId !== uid || v.transactionId !== transactionId || (v.sourceRevision !== null && !isReturnToSenderRevision(v.sourceRevision)) ||
      !hash(v.financialSourceHash) || !isReturnToSenderFinancialRecording(v.financialRecording) || typeof v.guardPresent !== 'boolean' ||
      !Array.isArray(v.items) || v.items.length > 20 || !v.items.every(item => isReturnToSenderCase(item, transactionId)) ||
      new Set(v.items.map(item => item.caseId)).size !== v.items.length || v.financialEffectAuthorized !== false || v.inventoryReleaseAuthorized !== false) throw failure();
    return v as unknown as ReturnToSenderCases;
  },
  async journal(uid: string, transactionId: string, assertContext: () => void): Promise<ReturnToSenderAttempt | null> {
    const session = captureTradeSession(uid); assertContext(); const raw = await AsyncStorage.getItem(key(uid, transactionId)); assertTradeSessionCurrent(session); assertContext();
    if (raw === null) return null; const v: unknown = JSON.parse(raw); if (!attempt(v, uid, transactionId)) throw failure(); return v;
  },
  async execute(a: ReturnToSenderAttempt, assertContext: () => void, resume = false) {
    const session = captureTradeSession(a.uid), slot = key(a.uid, a.command.transactionId);
    if (locks.has(slot) || !attempt(a, a.uid, a.command.transactionId)) throw failure(); locks.add(slot);
    try {
      await serialize(slot, async () => {
        const prior = await this.journal(a.uid, a.command.transactionId, assertContext);
        if (resume && !prior || prior && (prior.requestId !== a.requestId || await returnToSenderCommandHash(prior.command) !== await returnToSenderCommandHash(a.command))) throw failure();
        assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.setItem(slot, JSON.stringify(a)); assertTradeSessionCurrent(session); assertContext();
      });
      await rpc(a, 'execute', assertContext); return rpc(a, 'observe', assertContext);
    } finally {locks.delete(slot);}
  },
  observe: (a: ReturnToSenderAttempt, assertContext: () => void) => rpc(a, 'observe', assertContext),
  async neutralize(a: ReturnToSenderAttempt, assertContext: () => void) {
    const session = captureTradeSession(a.uid), slot = key(a.uid, a.command.transactionId); if (locks.has(slot)) throw failure(); locks.add(slot);
    try {
      await serialize(slot, async () => {const prior = await this.journal(a.uid, a.command.transactionId, assertContext);
        if (!prior || prior.requestId !== a.requestId || await returnToSenderCommandHash(prior.command) !== await returnToSenderCommandHash(a.command)) throw failure();
        assertTradeSessionCurrent(session); assertContext();});
      await rpc(a, 'neutralize', assertContext); return rpc(a, 'observe', assertContext);
    } finally {locks.delete(slot);}
  },
  async acknowledge(a: ReturnToSenderAttempt, assertContext: () => void) {
    const session = captureTradeSession(a.uid), slot = key(a.uid, a.command.transactionId); if (locks.has(slot)) throw failure(); locks.add(slot);
    try {const observed = await rpc(a, 'observe', assertContext); if (observed.state === 'unrecorded') throw failure();
      await serialize(slot, async () => {const prior = await this.journal(a.uid, a.command.transactionId, assertContext);
        if (!prior || prior.requestId !== a.requestId || await returnToSenderCommandHash(prior.command) !== observed.payloadHash) throw failure();
        assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.removeItem(slot); assertTradeSessionCurrent(session); assertContext();}); return observed;
    } finally {locks.delete(slot);}
  },
};
