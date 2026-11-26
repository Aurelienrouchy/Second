import AsyncStorage from '@/utils/environmentStorage';
import {productReviewEqual} from '@/services/productReviewService';
import {PrivacyOperationsService as Service, isPrivacyAttempt, privacyFailure, privacyGuard} from '@/services/privacyOperationsService';
import type {PrivacyAttempt, PrivacyCommand, PrivacyReceipt} from '@/types/privacyOperations';
const slot = (uid: string) => `second:privacy-operations:v2:${JSON.stringify(uid)}`;
const locks = new Set<string>();
async function read(uid: string, guard: () => void): Promise<PrivacyAttempt | null> {
  const current = privacyGuard(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid)); current();
  if (raw === null) return null; const v: unknown = JSON.parse(raw); if (!isPrivacyAttempt(v, uid)) throw privacyFailure(); return v;
}
async function same(a: PrivacyAttempt, guard: () => void) {if (!productReviewEqual(await read(a.uid, guard), a)) throw privacyFailure(); guard();}
async function locked<T>(a: PrivacyAttempt, work: () => Promise<T>): Promise<T> {const key = slot(a.uid); if (locks.has(key)) throw privacyFailure(); locks.add(key); try {return await work();} finally {locks.delete(key);}}
/** Only UID/RID/action/case/hash persist. No command, field, path or personal value. */
export const PrivacyOperationsJournal = {
  read,
  async submit(a: PrivacyAttempt, command: PrivacyCommand, guard: () => void, verifyNew: () => void): Promise<PrivacyReceipt> {
    const current = privacyGuard(a.uid, guard); current(); if (!isPrivacyAttempt(a, a.uid)) throw privacyFailure();
    return locked(a, async () => {
      const prior = await read(a.uid, current); current(); if (prior) throw new Error('Rapprochez votre instruction conservée avant une nouvelle opération.');
      if (!productReviewEqual(await Service.attempt(a.uid, a.descriptor.caseId, command, current, a.requestId), a)) throw privacyFailure(); current(); verifyNew();
      await AsyncStorage.setItem(slot(a.uid), JSON.stringify(a)); current(); await same(a, current);
      const first = await Service.command(a, 'observe', current); current(); if (first.state !== 'unrecorded') return first;
      verifyNew(); current(); return Service.command(a, 'execute', current, command);
    });
  },
  async observe(a: PrivacyAttempt, guard: () => void) {const current = privacyGuard(a.uid, guard); await same(a, current); return Service.command(a, 'observe', current);},
  async neutralize(a: PrivacyAttempt, guard: () => void) {const current = privacyGuard(a.uid, guard); return locked(a, async () => {await same(a, current); const first = await Service.command(a, 'observe', current); current(); return first.state === 'unrecorded' ? Service.command(a, 'neutralize', current) : first;});},
  async acknowledge(a: PrivacyAttempt, guard: () => void) {const current = privacyGuard(a.uid, guard); return locked(a, async () => {await same(a, current); const receipt = await Service.command(a, 'observe', current); current(); if (receipt.state === 'unrecorded') throw privacyFailure(); await same(a, current); await AsyncStorage.removeItem(slot(a.uid)); current(); return receipt;});},
};
