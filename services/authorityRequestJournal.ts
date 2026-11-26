import AsyncStorage from '@/utils/environmentStorage';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {productReviewEqual} from '@/services/productReviewService';
import {AuthorityRequestService as Service, authorityFailure, isAuthorityAttempt} from '@/services/authorityRequestService';
import type {AuthorityAttempt, AuthorityCommand} from '@/types/authorityRequest';

const slot = (uid: string) => `second:authority-request:v1:${encodeURIComponent(uid)}`;
const locks = new Set<string>();
const fence = (uid: string, guard: () => void) => {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};};
async function read(uid: string, guard: () => void): Promise<AuthorityAttempt | null> {
  const current = fence(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid)); current();
  if (raw === null) return null; const value: unknown = JSON.parse(raw);
  if (!isAuthorityAttempt(value, uid)) throw authorityFailure(); return value;
}
async function same(attempt: AuthorityAttempt, guard: () => void) {if (!productReviewEqual(await read(attempt.uid, guard), attempt)) throw authorityFailure(); guard();}
async function locked<T>(uid: string, work: () => Promise<T>): Promise<T> {if (locks.has(uid)) throw authorityFailure(); locks.add(uid); try {return await work();} finally {locks.delete(uid);}}
export const AuthorityRequestJournal = {
  read,
  async submit(attempt: AuthorityAttempt, command: AuthorityCommand, guard: () => void, verifyNew: () => void, onRpcStart?: () => void) {
    const current = fence(attempt.uid, guard);
    if (!isAuthorityAttempt(attempt, attempt.uid)) throw authorityFailure();
    return locked(attempt.uid, async () => {
      current(); if (await read(attempt.uid, current)) throw new Error('Rapprochez votre instruction privée conservée avant une nouvelle instruction.'); current();
      // Only UID, nonce and descriptor persist. No identity, contact, narrative or evidence.
      verifyNew(); current(); await AsyncStorage.setItem(slot(attempt.uid), JSON.stringify(attempt)); current(); await same(attempt, current);
      onRpcStart?.(); const prior = await Service.command(attempt, 'observe', current); current(); if (prior.state !== 'unrecorded') return prior;
      verifyNew(); current(); await Service.command(attempt, 'execute', current, command, verifyNew); current();
      return Service.command(attempt, 'observe', current);
    });
  },
  async observe(attempt: AuthorityAttempt, guard: () => void) {const current = fence(attempt.uid, guard); await same(attempt, current); return Service.command(attempt, 'observe', current);},
  async neutralize(attempt: AuthorityAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt.uid, async () => {await same(attempt, current); const prior = await Service.command(attempt, 'observe', current); current(); if (prior.state !== 'unrecorded') return prior; await Service.command(attempt, 'neutralize', current); current(); return Service.command(attempt, 'observe', current);});
  },
  async acknowledge(attempt: AuthorityAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt.uid, async () => {await same(attempt, current); const receipt = await Service.command(attempt, 'observe', current); current(); if (!['committed', 'not_executed'].includes(receipt.state)) throw authorityFailure(); await same(attempt, current); await AsyncStorage.removeItem(slot(attempt.uid)); current(); return receipt;});
  },
};
