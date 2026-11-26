import AsyncStorage from '@/utils/environmentStorage';
import { auth } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';
import { ExceptionalRestitutionService as Service, isExceptionalRestitutionReference } from '@/services/exceptionalRestitutionService';
import { purchaseRefundEqual as equal } from '@/utils/purchaseRefundContract';
import type { ExceptionalRestitutionReference as Reference, ExceptionalRestitutionCommand as Command, ExceptionalRestitutionEvidenceBody as EvidenceBody } from '@/types/exceptionalRestitution';

const key = (uid: string) => `second:exceptional-restitution:v3:${encodeURIComponent(uid)}`;
const writes = new Map<string, Promise<void>>(), locks = new Set<string>();
const fail = () => new Error('La référence d’origine reste conservée. Relisez ou neutralisez le même suivi avant toute autre intention.');
const sameSlot = (a: Reference, b: Reference) => a.kind === b.kind && a.slotHash === b.slotHash;
function guard(uid: string, current: () => void) {
  const owner = auth.currentUser, session = captureTradeSession(uid);
  const check = () => {assertTradeSessionCurrent(session); if (auth.currentUser !== owner) throw staleTradeOperation(); current();}; check(); return check;
}
async function pending(uid: string, assertContext: () => void): Promise<Reference[]> {
  const current = guard(uid, assertContext), raw = await AsyncStorage.getItem(key(uid)); current(); if (raw === null) return [];
  let value: unknown; try {value = JSON.parse(raw);} catch {throw fail();}
  if (!Array.isArray(value) || value.length > 100 || !value.every(v => isExceptionalRestitutionReference(v, uid)) ||
    new Set(value.map(v => JSON.stringify([v.kind, v.slotHash]))).size !== value.length || new Set(value.map(v => v.requestId)).size !== value.length) throw fail();
  for (const reference of value) {await Service.validateReference(reference, current); current();} return value;
}
async function serialize(uid: string, work: () => Promise<void>) {
  const task = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(uid, task);
  try {await task;} finally {if (writes.get(uid) === task) writes.delete(uid);}
}
async function locked<T>(a: Reference, assertContext: () => void, work: (current: () => void) => Promise<T>) {
  const current = guard(a.uid, assertContext); if (!isExceptionalRestitutionReference(a, a.uid)) throw fail();
  const slot = JSON.stringify([a.uid, a.kind, a.slotHash]); if (locks.has(slot)) throw fail(); locks.add(slot);
  try {const value = await work(current); current(); return value;} finally {locks.delete(slot);}
}
async function saveNew(a: Reference, current: () => void) {
  await serialize(a.uid, async () => {
    current(); const references = await pending(a.uid, current); current();
    // FIRST survives crashes: even an identical saved reference cannot replay a
    // body supplied after restoration. Only observe/neutralize remain available.
    if (references.some(v => sameSlot(v, a) || v.requestId === a.requestId) || references.length >= 100) throw fail();
    await AsyncStorage.setItem(key(a.uid), JSON.stringify([...references, a])); current();
  }); current(); const saved = (await pending(a.uid, current)).find(v => sameSlot(v, a)); current(); if (!saved || !equal(saved, a)) throw fail();
}
async function saved(a: Reference, current: () => void) {const value = (await pending(a.uid, current)).find(v => sameSlot(v, a)); current(); if (!value || !equal(value, a)) throw fail(); return value;}
export const ExceptionalRestitutionJournal = {
  pending,
  async read(uid: string, current: () => void) {
    const commands = [], evidence = [];
    for (const reference of await pending(uid, current)) {
      if (reference.kind === 'command') commands.push({reference, receipt: await Service.command(reference, 'observe', current)});
      else evidence.push({reference, receipt: await Service.evidence(reference, 'observe', current)}); current();
    }
    return {commands, evidence};
  },
  execute(a: Reference, command: Command, assertContext: () => void) {
    return locked(a, assertContext, async current => {
      const expected = await Service.commandReference(a.uid, a.requestId, command, current); current(); if (!equal(expected, a)) throw fail();
      await saveNew(a, current); current(); return Service.command(a, 'execute', current, command);
    });
  },
  sendEvidence(a: Reference, body: EvidenceBody, assertContext: () => void) {
    return locked(a, assertContext, async current => {
      const expected = await Service.evidenceReference(a.uid, a.requestId, body, current); current(); if (!equal(expected, a)) throw fail();
      await saveNew(a, current); current(); return Service.evidence(a, 'execute', current, body);
    });
  },
  service(a: Reference, mode: 'observe' | 'neutralize', assertContext: () => void) {
    return locked(a, assertContext, async current => {const reference = await saved(a, current); current();
      return reference.kind === 'command' ? Service.command(reference, mode, current) : Service.evidence(reference, mode, current);
    });
  },
  acknowledge(a: Reference, assertContext: () => void) {
    return locked(a, assertContext, async current => {
      const reference = await saved(a, current); current();
      const receipt = reference.kind === 'command' ? await Service.command(reference, 'observe', current) : await Service.evidence(reference, 'observe', current); current();
      if (!(reference.kind === 'command' ? ['committed', 'not_executed'] : ['stored', 'stored_requires_review', 'not_executed']).includes(receipt.state)) throw fail();
      await serialize(a.uid, async () => {await saved(a, current); current(); const all = await pending(a.uid, current); current();
        await AsyncStorage.setItem(key(a.uid), JSON.stringify(all.filter(v => !equal(v, a)))); current();}); return receipt;
    });
  },
};
