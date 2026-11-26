import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';

export interface CashCasePreview {
  protocol: 'cash_case_preview_v1'; previewId: string; actorUid: string; transactionId: string; expectedDisputeId: string;
  decisionType: 'buyer_upheld'; sourceHash: string; sourceVersion: 1; buyerId: string; sellerId: string;
  cashAgreementId: string; reservationReleaseId: string; reservationReleased: true; reservationRestored: false;
  moneyMovementPlanned: false; outsidePaymentVerified: false; physicalHandoverVerified: false; remainingOpenDisputeIds: string[];
}
export interface CashCaseAttempt {
  version: 1; adminUid: string; transactionId: string; disputeId: string; requestId: string; previewId: string;
  expectedSourceHash: string; note: string; decisionType: 'buyer_upheld'; cashAgreementId: string; reservationReleaseId: string;
}
interface CashIdentity {
  protocol: 'cash_case_decision_v1'; transactionId: string; expectedDisputeId: string; actorUid: string; requestId: string;
  previewId: string; sourceHash: string; decisionId: string; payloadHash: string; note: string; decisionType: 'buyer_upheld';
  moneyMoved: false; reservationRestored: false; outsidePaymentVerified: false; physicalHandoverVerified: false; retryPermissionGranted: false;
}
export type CashCaseDecision = CashIdentity & (
  | { outcome: 'unrecorded'; decisionCommitted: false; effectsCommitted: false; intentionNeutralized: false; lateRequestBlocked: false; notificationCommitted: false }
  | { outcome: 'not_executed'; buyerId: string; sellerId: string; committedAt: string; decisionCommitted: false; effectsCommitted: false;
      intentionNeutralized: true; lateRequestBlocked: true; nonExecutionQualified: true; reason: 'source_changed' | 'intention_neutralized_before_effects';
      observedSourceHash: string | null; sourceExamined?: false; notificationCommitted: false }
  | { outcome: 'recorded'; buyerId: string; sellerId: string; committedAt: string; decisionCommitted: true; effectsCommitted: true;
      intentionNeutralized: false; lateRequestBlocked: true; cashAgreementId: string; reservationReleaseId: string; reservationReleased: true;
      disputesClosed: 1; disputeIds: string[]; remainingOpenDisputeIds: string[]; notificationCommitted: true; notificationIds: string[];
      deviceDeliveryVerified: false; readingVerified: false }
);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const reference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(reference) && new Set(v).size === v.length;
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const unknown = () => new Error('Cette intention de rencontre doit être relue avec son dossier, son aperçu et sa note d’origine.');
const key = (uid: string) => `second:cash-case-decision:v1:${encodeURIComponent(uid)}`;
const active = new Set<string>(), writes = new Map<string, Promise<void>>();
export function parseCashCasePreview(v: unknown, uid: string, transactionId: string, disputeId: string): CashCasePreview {
  if (!record(v) || v.protocol !== 'cash_case_preview_v1' || !hash(v.previewId) || v.actorUid !== uid || v.transactionId !== transactionId ||
      v.expectedDisputeId !== disputeId || v.decisionType !== 'buyer_upheld' || !hash(v.sourceHash) || v.sourceVersion !== 1 ||
      !reference(v.buyerId) || !reference(v.sellerId) || v.buyerId === v.sellerId || !hash(v.cashAgreementId) || !hash(v.reservationReleaseId) ||
      v.reservationReleased !== true || v.reservationRestored !== false || v.moneyMovementPlanned !== false || v.outsidePaymentVerified !== false ||
      v.physicalHandoverVerified !== false || !ids(v.remainingOpenDisputeIds) || v.remainingOpenDisputeIds.includes(disputeId)) throw unknown();
  return v as unknown as CashCasePreview;
}
export function validCashCaseAttempt(v: unknown, uid: string): v is CashCaseAttempt {
  return record(v) && Object.keys(v).every(k => ['version', 'adminUid', 'transactionId', 'disputeId', 'requestId', 'previewId', 'expectedSourceHash',
    'note', 'decisionType', 'cashAgreementId', 'reservationReleaseId'].includes(k)) && v.version === 1 && v.adminUid === uid &&
    reference(v.transactionId) && reference(v.disputeId) && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) &&
    hash(v.previewId) && hash(v.expectedSourceHash) && typeof v.note === 'string' && v.note.trim() === v.note && v.note.length >= 1 && v.note.length <= 500 &&
    v.decisionType === 'buyer_upheld' && hash(v.cashAgreementId) && hash(v.reservationReleaseId);
}
const matches = (a: CashCaseAttempt, b: CashCaseAttempt) => Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every(k => a[k as keyof CashCaseAttempt] === b[k as keyof CashCaseAttempt]);
export function cashCaseInput(a: CashCaseAttempt) {
  return { transactionId: a.transactionId, expectedDisputeId: a.disputeId, adminUid: a.adminUid, requestId: a.requestId,
    previewId: a.previewId, expectedSourceHash: a.expectedSourceHash, note: a.note, decisionType: a.decisionType };
}
export async function parseCashCaseDecision(v: unknown, a: CashCaseAttempt): Promise<CashCaseDecision> {
  const input = cashCaseInput(a);
  const [decisionId, payloadHash] = await Promise.all([
    digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(['cash_no_show', a.transactionId, a.adminUid, a.requestId])),
    digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(Object.fromEntries(Object.keys(input).sort().map(k => [k, input[k as keyof typeof input]])))),
  ]);
  if (!record(v) || v.protocol !== 'cash_case_decision_v1' || v.transactionId !== a.transactionId || v.expectedDisputeId !== a.disputeId ||
      v.actorUid !== a.adminUid || v.requestId !== a.requestId || v.previewId !== a.previewId || v.sourceHash !== a.expectedSourceHash ||
      v.decisionId !== decisionId || v.payloadHash !== payloadHash || v.note !== a.note || v.decisionType !== a.decisionType || v.moneyMoved !== false ||
      v.reservationRestored !== false || v.outsidePaymentVerified !== false || v.physicalHandoverVerified !== false || v.retryPermissionGranted !== false) throw unknown();
  if (v.outcome === 'unrecorded') {
    if (v.decisionCommitted !== false || v.effectsCommitted !== false || v.intentionNeutralized !== false || v.lateRequestBlocked !== false || v.notificationCommitted !== false) throw unknown();
  } else {
    if (!reference(v.buyerId) || !reference(v.sellerId) || v.buyerId === v.sellerId || !time(v.committedAt)) throw unknown();
    if (v.outcome === 'not_executed') {
      if (v.decisionCommitted !== false || v.effectsCommitted !== false || v.intentionNeutralized !== true || v.lateRequestBlocked !== true ||
          v.nonExecutionQualified !== true || v.notificationCommitted !== false || !(v.reason === 'source_changed' && hash(v.observedSourceHash) ||
            v.reason === 'intention_neutralized_before_effects' && v.sourceExamined === false && v.observedSourceHash === null)) throw unknown();
    } else if (v.outcome === 'recorded') {
      if (v.decisionCommitted !== true || v.effectsCommitted !== true || v.intentionNeutralized !== false || v.lateRequestBlocked !== true ||
          v.cashAgreementId !== a.cashAgreementId || v.reservationReleaseId !== a.reservationReleaseId || v.reservationReleased !== true ||
          v.disputesClosed !== 1 || !ids(v.disputeIds) || v.disputeIds.length !== 1 || v.disputeIds[0] !== a.disputeId ||
          !ids(v.remainingOpenDisputeIds) || v.remainingOpenDisputeIds.includes(a.disputeId) || v.notificationCommitted !== true ||
          !ids(v.notificationIds) || v.notificationIds.length !== 2 || v.deviceDeliveryVerified !== false || v.readingVerified !== false) throw unknown();
    } else throw unknown();
  }
  return v as unknown as CashCaseDecision;
}
export async function readCashCaseAttempts(uid: string, assertContext: () => void): Promise<CashCaseAttempt[]> {
  const session = captureTradeSession(uid); assertContext();
  const raw = await AsyncStorage.getItem(key(uid)); assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return [];
  let value: unknown; try { value = JSON.parse(raw); } catch { throw unknown(); }
  if (!Array.isArray(value) || !value.every(v => validCashCaseAttempt(v, uid)) || new Set(value.map(v => v.transactionId)).size !== value.length) throw unknown();
  return value;
}
export async function runCashCaseDecision<T>(uid: string, transactionId: string, assertContext: () => void, work: () => Promise<T>): Promise<T> {
  const session = captureTradeSession(uid), slot = JSON.stringify([uid, transactionId]); assertContext();
  if (!reference(transactionId) || active.has(slot)) throw unknown(); active.add(slot);
  try { assertTradeSessionCurrent(session); return await work(); } finally { active.delete(slot); }
}
async function serialize(uid: string, work: () => Promise<void>) {
  const pending = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(uid, pending);
  try { await pending; } finally { if (writes.get(uid) === pending) writes.delete(uid); }
}
export async function rememberCashCaseAttempt(a: CashCaseAttempt, assertContext: () => void) {
  const session = captureTradeSession(a.adminUid);
  await serialize(session.uid, async () => {
    assertTradeSessionCurrent(session); assertContext(); if (!validCashCaseAttempt(a, session.uid)) throw unknown();
    const all = await readCashCaseAttempts(session.uid, assertContext), old = all.find(v => v.transactionId === a.transactionId);
    if (old && !matches(old, a)) throw unknown(); assertTradeSessionCurrent(session); assertContext();
    await AsyncStorage.setItem(key(session.uid), JSON.stringify(old ? all : [...all, a])); assertTradeSessionCurrent(session); assertContext();
  });
}
export async function acknowledgeCashCaseAttempt(a: CashCaseAttempt, receipt: CashCaseDecision, assertContext: () => void) {
  const session = captureTradeSession(a.adminUid);
  await serialize(session.uid, async () => {
    assertTradeSessionCurrent(session); assertContext();
    const qualified = await parseCashCaseDecision(receipt, a); assertTradeSessionCurrent(session); assertContext();
    if (qualified.outcome === 'unrecorded') throw unknown();
    const all = await readCashCaseAttempts(session.uid, assertContext), old = all.find(v => v.transactionId === a.transactionId);
    if (!old || !matches(old, a)) throw unknown(); assertTradeSessionCurrent(session); assertContext();
    await AsyncStorage.setItem(key(session.uid), JSON.stringify(all.filter(v => v.transactionId !== a.transactionId)));
    assertTradeSessionCurrent(session); assertContext();
  });
}
