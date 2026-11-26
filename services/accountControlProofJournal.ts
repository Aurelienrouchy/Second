import AsyncStorage from '@/utils/environmentStorage';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {AccountControlProofService as Service, accountControlFailure, accountControlHash, isAccountControlAttempt, isAccountControlJournalState} from '@/services/accountControlProofService';
import type {AccountControlAttempt, AccountControlCommand, AccountControlJournalState, AccountControlReference, AccountControlResponse} from '@/types/accountControlProof';
const slot = (uid: string) => `second:account-control-proof:v1:${encodeURIComponent(uid)}`, locks = new Set<string>();
const fenced = (uid: string, guard: () => void) => {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};};
async function read(uid: string, guard: () => void): Promise<AccountControlJournalState | null> {const current = fenced(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid)); current();
  if (raw === null) return null; if (raw.length > 2000) throw accountControlFailure(); const value: unknown = JSON.parse(raw); if (!isAccountControlJournalState(value, uid)) throw accountControlFailure(); return value;}
async function same(state: AccountControlJournalState, current: () => void) {const old = await read(state.uid, current); if (await accountControlHash(old) !== await accountControlHash(state)) throw accountControlFailure(); current();}
async function write(state: AccountControlJournalState, current: () => void) {if (!isAccountControlJournalState(state, state.uid)) throw accountControlFailure(); current(); await AsyncStorage.setItem(slot(state.uid), JSON.stringify(state)); current();}
async function locked<T>(uid: string, run: () => Promise<T>) {if (locks.has(uid)) throw accountControlFailure(); locks.add(uid); try {return await run();} finally {locks.delete(uid);}}
const referenceOf = (v: AccountControlResponse): AccountControlReference | null => v.proof ? {supportRequestId: v.proof.supportRequestId, proofId: v.proof.proofId, sourceHash: v.proof.sourceHash} : null;
function pending(state: AccountControlJournalState): AccountControlAttempt {if (!state.pending) throw accountControlFailure(); return state.pending;}
export const AccountControlProofJournal = {
  read,
  async submit(attempt: AccountControlAttempt, command: AccountControlCommand, guard: () => void, verify: () => void) {const current = fenced(attempt.uid, guard); return locked(attempt.uid, async () => {
    if (!isAccountControlAttempt(attempt, attempt.uid)) throw accountControlFailure(); const old = await read(attempt.uid, current); if (old?.pending) throw accountControlFailure(); verify(); current();
    const state: AccountControlJournalState = {version: 1, uid: attempt.uid, reference: old?.reference ?? null, pending: attempt}; await write(state, current); await same(state, current);
    const prior = await Service.command(attempt, 'observe', current); current(); if (prior.receipt) return prior;
    verify(); current(); await Service.command(attempt, 'execute', current, command); current(); return Service.command(attempt, 'observe', current);
  });},
  async observe(state: AccountControlJournalState, guard: () => void) {const current = fenced(state.uid, guard); await same(state, current); return Service.command(pending(state), 'observe', current);},
  async resume(state: AccountControlJournalState, command: AccountControlCommand, guard: () => void, verify: () => void) {const current = fenced(state.uid, guard); return locked(state.uid, async () => {
    await same(state, current); const attempt = pending(state), prior = await Service.command(attempt, 'observe', current); current(); if (prior.receipt) return prior;
    verify(); current(); await Service.command(attempt, 'execute', current, command); current(); return Service.command(attempt, 'observe', current);
  });},
  async neutralize(state: AccountControlJournalState, guard: () => void) {const current = fenced(state.uid, guard); return locked(state.uid, async () => {
    await same(state, current); const attempt = pending(state), prior = await Service.command(attempt, 'observe', current); current(); if (prior.receipt) return prior;
    await Service.command(attempt, 'neutralize', current); current(); return Service.command(attempt, 'observe', current);
  });},
  async acknowledge(state: AccountControlJournalState, guard: () => void) {const current = fenced(state.uid, guard); return locked(state.uid, async () => {
    await same(state, current); const fresh = await Service.command(pending(state), 'observe', current); current(); if (!fresh.receipt || !['completed', 'not_executed'].includes(fresh.receipt.state)) throw accountControlFailure();
    await same(state, current); await write({...state, reference: referenceOf(fresh) ?? state.reference, pending: null}, current); return fresh;
  });},
};
