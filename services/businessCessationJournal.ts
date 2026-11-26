import AsyncStorage from '@/utils/environmentStorage';
import { auth } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';
import { BusinessCessationService as Service, isBusinessCessationReference } from '@/services/businessCessationService';
import { purchaseRefundEqual as equal } from '@/utils/purchaseRefundContract';
import type { BusinessCessationAccess as Access, BusinessCessationReference as Reference, BusinessCessationCommand as Command } from '@/types/businessCessation';

const key = (uid: string, access: Access) => `second:business-cessation:v1:${encodeURIComponent(uid)}:${access}`;
const writes = new Map<string, Promise<void>>(), locks = new Set<string>();
const fail = () => new Error('La référence de continuité reste conservée. Relisez ou neutralisez cette même intention ; son ancien corps ne doit pas être renvoyé.');
function guard(uid: string, callback: () => void) {const sdk = auth.currentUser, session = captureTradeSession(uid);
  const current = () => {assertTradeSessionCurrent(session); if (auth.currentUser !== sdk) throw staleTradeOperation(); callback();}; current(); return current;}
async function pending(uid: string, access: Access, callback: () => void): Promise<Reference[]> {
  const current = guard(uid, callback); if (!['admin', 'owner'].includes(access)) throw fail(); const raw = await AsyncStorage.getItem(key(uid, access)); current(); if (raw === null) return [];
  let v: unknown; try {v = JSON.parse(raw);} catch {throw fail();}
  if (!Array.isArray(v) || v.length > 100 || !v.every(a => isBusinessCessationReference(a, uid, access)) || new Set(v.map(a => a.requestId)).size !== v.length) throw fail(); return v;
}
async function serialize(slot: string, work: () => Promise<void>) {const task = (writes.get(slot) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(slot, task);
  try {await task;} finally {if (writes.get(slot) === task) writes.delete(slot);}}
async function locked<T>(a: Reference, callback: () => void, work: (current: () => void) => Promise<T>) {
  const current = guard(a.uid, callback); if (!isBusinessCessationReference(a, a.uid)) throw fail(); const slot = key(a.uid, a.access); if (locks.has(slot)) throw fail(); locks.add(slot);
  try {const result = await work(current); current(); return result;} finally {locks.delete(slot);}
}
async function saved(a: Reference, current: () => void) {const found = (await pending(a.uid, a.access, current)).find(v => v.requestId === a.requestId); current(); if (!equal(found, a)) throw fail();}
export const BusinessCessationJournal = {
  pending,
  async read(uid: string, access: Access, callback: () => void) {const current = guard(uid, callback), entries = [];
    for (const reference of await pending(uid, access, current)) {const receipt = await Service.command(reference, 'observe', current); current(); entries.push({reference, receipt});} return entries;},
  execute(a: Reference, command: Command, callback: () => void) {
    return locked(a, callback, async current => {
      const expected = await Service.reference(a.uid, a.access, a.requestId, command, current); current(); if (!equal(a, expected)) throw fail();
      const slot = key(a.uid, a.access); await serialize(slot, async () => {const all = await pending(a.uid, a.access, current); current();
        // FIRST survives module restoration, even for exactly the same body.
        if (all.length >= 100 || all.some(v => v.requestId === a.requestId)) throw fail();
        await AsyncStorage.setItem(slot, JSON.stringify([...all, a])); current();});
      await saved(a, current); return Service.command(a, 'execute', current, command);
    });
  },
  service(a: Reference, mode: 'observe' | 'neutralize', callback: () => void) {
    return locked(a, callback, async current => {await saved(a, current); return Service.command(a, mode, current);});
  },
  resume(a: Reference, callback: () => void) {
    return locked(a, callback, async current => {await saved(a, current); const receipt = await Service.command(a, 'observe', current); current();
      if (receipt.state !== 'pending') throw fail(); return Service.command(a, 'resume', current);});
  },
  acknowledge(a: Reference, callback: () => void) {
    return locked(a, callback, async current => {await saved(a, current); const receipt = await Service.command(a, 'observe', current); current();
      if (!['recorded', 'not_executed'].includes(receipt.state)) throw fail();
      await serialize(key(a.uid, a.access), async () => {await saved(a, current); const all = await pending(a.uid, a.access, current); current();
        await AsyncStorage.setItem(key(a.uid, a.access), JSON.stringify(all.filter(v => !equal(v, a)))); current();}); return receipt;});
  },
};
