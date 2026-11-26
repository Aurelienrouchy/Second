import AsyncStorage from '@/utils/environmentStorage';
import { auth } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';
import { OrphanCaptureRefundService as Service, isOrphanCaptureRefundReference } from '@/services/orphanCaptureRefundService';
import { purchaseRefundEqual as equal } from '@/utils/purchaseRefundContract';
import type { OrphanCaptureRefundReference as Reference, OrphanCaptureRefundCommand as Command, OrphanCaptureRefundPreview as Preview } from '@/types/orphanCaptureRefund';

const key = (uid: string) => `second:orphan-capture-refund:v1:${encodeURIComponent(uid)}`;
const writes = new Map<string, Promise<void>>(), locks = new Set<string>();
const fail = () => new Error('Le suivi de cette capture doit être relu avec sa référence conservée. Aucun corps de commande restauré ne peut être renvoyé.');
function guard(uid: string, assertContext: () => void) {
  const owner = auth.currentUser, session = captureTradeSession(uid);
  const current = () => {assertTradeSessionCurrent(session); if (auth.currentUser !== owner) throw staleTradeOperation(); assertContext();}; current(); return current;
}
async function pending(uid: string, assertContext: () => void): Promise<Reference[]> {
  const current = guard(uid, assertContext), raw = await AsyncStorage.getItem(key(uid)); current(); if (raw === null) return [];
  let v: unknown; try {v = JSON.parse(raw);} catch {throw fail();}
  if (!Array.isArray(v) || v.length > 100 || !v.every(a => isOrphanCaptureRefundReference(a, uid)) || new Set(v.map(a => a.operationId)).size !== v.length || new Set(v.map(a => a.requestId)).size !== v.length) throw fail(); return v;
}
async function serialize(uid: string, work: () => Promise<void>) {
  const task = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(uid, task);
  try {await task;} finally {if (writes.get(uid) === task) writes.delete(uid);}
}
async function locked<T>(a: Reference, assertContext: () => void, work: (current: () => void) => Promise<T>) {
  const current = guard(a.uid, assertContext); if (!isOrphanCaptureRefundReference(a, a.uid)) throw fail();
  const slot = JSON.stringify([a.uid, a.operationId]); if (locks.has(slot)) throw fail(); locks.add(slot);
  try {const value = await work(current); current(); return value;} finally {locks.delete(slot);}
}
async function saved(a: Reference, current: () => void) {const found = (await pending(a.uid, current)).find(v => v.operationId === a.operationId); current(); if (!equal(found, a)) throw fail(); return a;}
export const OrphanCaptureRefundJournal = {
  pending,
  async read(uid: string, assertContext: () => void) {
    const current = guard(uid, assertContext), result = [];
    for (const reference of await pending(uid, current)) {const receipt = await Service.command(reference, 'observe', current); current(); result.push({reference, receipt});} return result;
  },
  execute(a: Reference, command: Command, assertContext: () => void) {
    return locked(a, assertContext, async current => {
      const expected = await Service.reference(a.uid, a.requestId, command, current); current(); if (!equal(expected, a)) throw fail();
      await serialize(a.uid, async () => {current(); const all = await pending(a.uid, current); current();
        // FIRST: even the same RID/body after a crash cannot execute twice.
        if (all.length >= 100 || all.some(v => v.operationId === a.operationId || v.requestId === a.requestId)) throw fail();
        await AsyncStorage.setItem(key(a.uid), JSON.stringify([...all, a])); current();});
      await saved(a, current); return Service.command(a, 'execute', current, command);
    });
  },
  service(a: Reference, mode: 'observe' | 'neutralize', assertContext: () => void) {
    return locked(a, assertContext, async current => {await saved(a, current); return Service.command(a, mode, current);});
  },
  resume(a: Reference, preview: Preview, assertContext: () => void) {
    return locked(a, assertContext, async current => {await saved(a, current); return Service.resume(a, preview, current);});
  },
  acknowledge(a: Reference, assertContext: () => void) {
    return locked(a, assertContext, async current => {
      await saved(a, current); const receipt = await Service.command(a, 'observe', current); current();
      if (!['not_executed', 'succeeded', 'failed', 'canceled'].includes(receipt.state)) throw fail();
      await serialize(a.uid, async () => {await saved(a, current); const all = await pending(a.uid, current); current(); await AsyncStorage.setItem(key(a.uid), JSON.stringify(all.filter(v => !equal(v, a)))); current();}); return receipt;
    });
  },
};
