import { auth } from '@/config/firebaseConfig';
import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { RefundRepairService, isRefundRepairAttempt, canAcknowledgeRefundRepair, RefundRepairManualService, isRefundRepairManualAttempt, isRefundRepairManualEvidenceAttempt } from '@/services/refundRepairService';
import { purchaseRefundEqual } from '@/utils/purchaseRefundContract';
import type { RefundRepairAttempt, RefundRepairManualAttempt, RefundRepairManualEvidenceAttempt } from '@/types/refundRepair';
const key = (uid: string) => `second:refund-repair:v1:${encodeURIComponent(uid)}`;
const writes = new Map<string, Promise<void>>(), locks = new Set<string>();
const fail = () => new Error('Le suivi exact de cette obligation reste conservé. Aucun nouvel envoi n’est possible avant sa relecture.');
const sameObligation = (a: RefundRepairAttempt, b: RefundRepairAttempt) => a.command.transactionId === b.command.transactionId && a.command.refundIntentId === b.command.refundIntentId;
async function pending(uid: string, assertContext: () => void): Promise<RefundRepairAttempt[]> {const session = captureTradeSession(uid); assertContext(); const raw = await AsyncStorage.getItem(key(uid)); assertTradeSessionCurrent(session); assertContext(); if (raw === null) return [];
  let value: unknown; try {value = JSON.parse(raw);} catch {throw fail();} if (!Array.isArray(value) || !value.every(a => isRefundRepairAttempt(a, uid)) || new Set(value.map(a => JSON.stringify([a.command.transactionId, a.command.refundIntentId]))).size !== value.length) throw fail(); return value;
}
async function serialize(uid: string, task: () => Promise<void>) {const operation = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(task); writes.set(uid, operation); try {await operation;} finally {if (writes.get(uid) === operation) writes.delete(uid);}}
async function locked<T>(a: RefundRepairAttempt, assertContext: () => void, task: () => Promise<T>) {const session = captureTradeSession(a.uid), slot = JSON.stringify([a.uid, a.command.transactionId, a.command.refundIntentId]); assertContext(); if (locks.has(slot)) throw fail(); locks.add(slot); try {const value = await task(); assertTradeSessionCurrent(session); assertContext(); return value;} finally {locks.delete(slot);}}
export const RefundRepairJournal = {
  pending,
  async read(uid: string, assertContext: () => void) {const all = await pending(uid, assertContext); const entries = []; for (const attempt of all) {const receipt = await RefundRepairService.command(attempt, 'observe', assertContext); assertContext(); entries.push({attempt, receipt});} return entries;},
  execute(a: RefundRepairAttempt, assertContext: () => void) {return locked(a, assertContext, async () => {
    const session = captureTradeSession(a.uid); if (!isRefundRepairAttempt(a, a.uid)) throw fail();
    await serialize(a.uid, async () => {assertTradeSessionCurrent(session); assertContext(); const all = await pending(a.uid, assertContext), old = all.find(v => sameObligation(v, a)); if (old && !purchaseRefundEqual(old, a)) throw fail(); assertContext(); if (!old) {await AsyncStorage.setItem(key(a.uid), JSON.stringify([...all, a])); assertTradeSessionCurrent(session); assertContext();}});
    assertTradeSessionCurrent(session); assertContext(); const saved = (await pending(a.uid, assertContext)).find(v => sameObligation(v, a)); if (!saved || !purchaseRefundEqual(saved, a)) throw fail(); return RefundRepairService.command(saved, 'execute', assertContext);
  });},
  service(a: RefundRepairAttempt, mode: 'observe' | 'neutralize' | 'recover', assertContext: () => void) {return locked(a, assertContext, async () => {const saved = (await pending(a.uid, assertContext)).find(v => sameObligation(v, a)); if (!saved || !purchaseRefundEqual(saved, a)) throw fail(); return RefundRepairService.command(saved, mode, assertContext);});},
  acknowledge(a: RefundRepairAttempt, assertContext: () => void) {return locked(a, assertContext, async () => {
    const saved = (await pending(a.uid, assertContext)).find(v => sameObligation(v, a)); if (!saved || !purchaseRefundEqual(saved, a)) throw fail();
    const receipt = await RefundRepairService.command(saved, 'observe', assertContext); assertContext(); if (!canAcknowledgeRefundRepair(receipt)) throw fail();
    const session = captureTradeSession(a.uid); await serialize(a.uid, async () => {assertTradeSessionCurrent(session); assertContext(); const all = await pending(a.uid, assertContext), current = all.find(v => sameObligation(v, a)); if (!current || !purchaseRefundEqual(current, a)) throw fail();
      await AsyncStorage.setItem(key(a.uid), JSON.stringify(all.filter(v => !sameObligation(v, a)))); assertTradeSessionCurrent(session); assertContext();}); return receipt;
  });},
};

// Separate V2 slots: no enrichment, migration or reinterpretation of V1 data.
const manualKeys = (uid: string, proof: boolean) => `second:refund-repair:manual:v2:${proof ? 'evidence:' : ''}${encodeURIComponent(uid)}`;
const manualWrites = new Map<string, Promise<void>>(), manualLocks = new Set<string>();
async function manualSerialize(uid: string, task: () => Promise<void>) {
  const next = (manualWrites.get(uid) ?? Promise.resolve()).catch(() => undefined).then(task); manualWrites.set(uid, next);
  try {await next;} finally {if (manualWrites.get(uid) === next) manualWrites.delete(uid);}
}
async function manualPending<T>(uid: string, proof: boolean, validate: (v: unknown, uid: string) => v is T, assertContext: () => void): Promise<T[]> {
  const owner = auth.currentUser, session = captureTradeSession(uid); assertContext(); const raw = await AsyncStorage.getItem(manualKeys(uid, proof)); assertTradeSessionCurrent(session); if (auth.currentUser !== owner) throw fail(); assertContext();
  if (raw === null) return []; let value: unknown; try {value = JSON.parse(raw);} catch {throw fail();}
  if (!Array.isArray(value) || value.length > 50 || !value.every(v => validate(v, uid))) throw fail(); return value;
}
const manualObligation = (a: RefundRepairManualAttempt) => JSON.stringify([a.command.transactionId, a.command.refundIntentId]);
const evidenceObligation = (a: RefundRepairManualEvidenceAttempt) => JSON.stringify([a.context.transactionId, a.context.refundIntentId, a.context.purpose]);
async function manualLocked<T>(uid: string, slot: string, assertContext: () => void, task: (current: () => void) => Promise<T>): Promise<T> {
  const owner = auth.currentUser, session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); if (auth.currentUser !== owner) throw fail(); assertContext();};
  current(); const key = JSON.stringify([uid, slot]); if (manualLocks.has(key)) throw fail(); manualLocks.add(key);
  try {const result = await task(current); current(); return result;} finally {manualLocks.delete(key);}
}
const manualCommands = async (uid: string, current: () => void) => {
  const values = await manualPending(uid, false, isRefundRepairManualAttempt, current);
  if (new Set(values.map(manualObligation)).size !== values.length) throw fail(); return values;
};
const manualEvidence = async (uid: string, current: () => void) => {
  const values = await manualPending(uid, true, isRefundRepairManualEvidenceAttempt, current);
  if (new Set(values.map(evidenceObligation)).size !== values.length) throw fail(); return values;
};
export const RefundRepairManualJournal = {
  pending: manualCommands,
  evidencePending: manualEvidence,
  async read(uid: string, current: () => void) {
    const entries = []; for (const attempt of await manualCommands(uid, current)) {const receipt = await RefundRepairManualService.command(attempt, 'observe', current); current(); entries.push({attempt, receipt});} return entries;
  },
  async readEvidence(uid: string, current: () => void) {
    const entries = []; for (const attempt of await manualEvidence(uid, current)) {const receipt = await RefundRepairManualService.evidence(attempt, 'observe', current); current(); entries.push({attempt, receipt});} return entries;
  },
  execute(a: RefundRepairManualAttempt, current: () => void) {
    return manualLocked(a.uid, manualObligation(a), current, async current => {
      if (!isRefundRepairManualAttempt(a, a.uid)) throw fail();
      await manualSerialize(a.uid, async () => {current(); const entries = await manualCommands(a.uid, current), existing = entries.find(v => manualObligation(v) === manualObligation(a));
        if (existing && !purchaseRefundEqual(existing, a)) throw fail(); if (!existing) {if (entries.length >= 50) throw fail(); current(); await AsyncStorage.setItem(manualKeys(a.uid, false), JSON.stringify([...entries, a])); current();}});
      const saved = (await manualCommands(a.uid, current)).find(v => manualObligation(v) === manualObligation(a)); if (!saved || !purchaseRefundEqual(saved, a)) throw fail();
      return RefundRepairManualService.command(saved, 'execute', current);
    });
  },
  service(a: RefundRepairManualAttempt, mode: 'observe' | 'recover' | 'neutralize', current: () => void) {
    return manualLocked(a.uid, manualObligation(a), current, async current => {const saved = (await manualCommands(a.uid, current)).find(v => manualObligation(v) === manualObligation(a));
      if (!saved || !purchaseRefundEqual(saved, a)) throw fail(); return RefundRepairManualService.command(saved, mode, current);});
  },
  acknowledge(a: RefundRepairManualAttempt, current: () => void) {
    return manualLocked(a.uid, manualObligation(a), current, async current => {const receipt = await RefundRepairManualService.command(a, 'observe', current); current();
      if (!['committed', 'not_executed'].includes(receipt.state)) throw fail();
      await manualSerialize(a.uid, async () => {const entries = await manualCommands(a.uid, current), saved = entries.find(v => manualObligation(v) === manualObligation(a));
        if (!saved || !purchaseRefundEqual(saved, a)) throw fail(); current(); await AsyncStorage.setItem(manualKeys(a.uid, false), JSON.stringify(entries.filter(v => manualObligation(v) !== manualObligation(a)))); current();}); return receipt;});
  },
  sendEvidence(a: RefundRepairManualEvidenceAttempt, payload: Parameters<typeof RefundRepairManualService.evidence>[3], current: () => void) {
    return manualLocked(a.uid, `evidence:${evidenceObligation(a)}`, current, async current => {
      if (!isRefundRepairManualEvidenceAttempt(a, a.uid) || !payload) throw fail();
      await manualSerialize(a.uid, async () => {const entries = await manualEvidence(a.uid, current), existing = entries.find(v => evidenceObligation(v) === evidenceObligation(a));
        if (existing) throw fail(); if (entries.length >= 50) throw fail(); current(); await AsyncStorage.setItem(manualKeys(a.uid, true), JSON.stringify([...entries, a])); current();});
      const saved = (await manualEvidence(a.uid, current)).find(v => evidenceObligation(v) === evidenceObligation(a)); if (!saved || !purchaseRefundEqual(saved, a)) throw fail();
      return RefundRepairManualService.evidence(saved, 'execute', current, payload);
    });
  },
  evidenceService(a: RefundRepairManualEvidenceAttempt, mode: 'observe' | 'neutralize' | 'acknowledge', current: () => void) {
    return manualLocked(a.uid, `evidence:${evidenceObligation(a)}`, current, async current => {const saved = (await manualEvidence(a.uid, current)).find(v => evidenceObligation(v) === evidenceObligation(a));
      if (!saved || !purchaseRefundEqual(saved, a)) throw fail(); const receipt = await RefundRepairManualService.evidence(saved, mode === 'neutralize' ? 'neutralize' : 'observe', current); current();
      if (mode === 'acknowledge') {if (!['stored', 'stored_requires_review', 'not_executed'].includes(receipt.state)) throw fail();
        await manualSerialize(a.uid, async () => {const entries = await manualEvidence(a.uid, current), entry = entries.find(v => evidenceObligation(v) === evidenceObligation(a));
          if (!entry || !purchaseRefundEqual(entry, a)) throw fail(); current(); await AsyncStorage.setItem(manualKeys(a.uid, true), JSON.stringify(entries.filter(v => evidenceObligation(v) !== evidenceObligation(a)))); current();});}
      return receipt;});
  },
};
