import AsyncStorage from '@/utils/environmentStorage';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewEqual} from '@/services/productReviewService';
import {GlobalFinancialReconciliationService as Service, globalFinancialFailure, isGlobalFinancialJournalState} from '@/services/globalFinancialReconciliationService';
import type {GlobalFinancialJournalState, GlobalFinancialScope} from '@/types/globalFinancialReconciliation';

const slot = (uid: string) => `second:global-financial-reconciliation:v1:${encodeURIComponent(uid)}`;
const locks = new Set<string>();
const fenced = (uid: string, guard: () => void) => {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};};
async function read(uid: string, guard: () => void): Promise<GlobalFinancialJournalState | null> {
  const current = fenced(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid)); current();
  if (raw === null) return null;
  if (raw.length > 3000) throw globalFinancialFailure(); const value: unknown = JSON.parse(raw);
  if (!isGlobalFinancialJournalState(value, uid)) throw globalFinancialFailure(); return value;
}
async function same(state: GlobalFinancialJournalState, current: () => void) {if (!productReviewEqual(await read(state.uid, current), state)) throw globalFinancialFailure(); current();}
async function locked<T>(uid: string, work: () => Promise<T>) {if (locks.has(uid)) throw globalFinancialFailure(); locks.add(uid); try {return await work();} finally {locks.delete(uid);}}
export const GlobalFinancialReconciliationJournal = {
  read,
  async select(state: GlobalFinancialJournalState, guard: () => void) {
    if (!isGlobalFinancialJournalState(state, state.uid) || state.pending !== null) throw globalFinancialFailure();
    const current = fenced(state.uid, guard);
    return locked(state.uid, async () => {current(); const old = await read(state.uid, current); if (old?.pending) throw globalFinancialFailure();
      await Service.observe(state.uid, state.runReference, current); current(); await AsyncStorage.setItem(slot(state.uid), JSON.stringify(state)); current(); return state;});
  },
  async submit(state: GlobalFinancialJournalState, scope: GlobalFinancialScope | null, guard: () => void, verifyNew: () => void) {
    if (!isGlobalFinancialJournalState(state, state.uid) || !state.pending) throw globalFinancialFailure();
    const current = fenced(state.uid, guard);
    return locked(state.uid, async () => {
      current(); const old = await read(state.uid, current); if (old?.pending || state.pending?.action !== 'prepare' && (!old || !productReviewEqual(old.runReference, state.runReference))) throw globalFinancialFailure();
      verifyNew(); current(); await AsyncStorage.setItem(slot(state.uid), JSON.stringify(state)); current(); await same(state, current);
      const observed = await Service.observe(state.uid, state.runReference, current, state); current();
      if (observed.commandReceipt) return observed;
      verifyNew(); current(); await Service.execute(state, scope, current); current(); return Service.observe(state.uid, state.runReference, current, state);
    });
  },
  async observe(state: GlobalFinancialJournalState, guard: () => void) {const current = fenced(state.uid, guard); await same(state, current); return Service.observe(state.uid, state.runReference, current, state);},
  async resume(state: GlobalFinancialJournalState, scope: GlobalFinancialScope | null, guard: () => void, verifyResume: () => void) {
    if (!state.pending) throw globalFinancialFailure(); const current = fenced(state.uid, guard);
    return locked(state.uid, async () => {await same(state, current); const prior = await Service.observe(state.uid, state.runReference, current, state); current();
      if (prior.commandReceipt && ['completed', 'not_executed'].includes(prior.commandReceipt.status)) return prior;
      verifyResume(); current(); await Service.execute(state, scope, current); current(); return Service.observe(state.uid, state.runReference, current, state);});
  },
  async acknowledge(state: GlobalFinancialJournalState, guard: () => void) {
    if (!state.pending) throw globalFinancialFailure(); const current = fenced(state.uid, guard);
    return locked(state.uid, async () => {await same(state, current); const fresh = await Service.observe(state.uid, state.runReference, current, state); current();
      if (!fresh.commandReceipt || !['completed', 'not_executed'].includes(fresh.commandReceipt.status)) throw globalFinancialFailure(); await same(state, current);
      // A fresh exact native receipt clears only this pending descriptor. The run reference remains resumable.
      await AsyncStorage.setItem(slot(state.uid), JSON.stringify({...state, pending: null})); current(); return fresh;});
  },
};
