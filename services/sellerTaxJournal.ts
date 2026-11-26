import AsyncStorage from '@/utils/environmentStorage';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {isSellerTaxAttempt, sellerTaxEqual, sellerTaxFailure, sellerTaxHash, SellerTaxService} from '@/services/sellerTaxService';
import type {SellerTaxAttempt, SellerTaxResponse} from '@/types/sellerTax';

const slot = (uid: string) => `second:seller-tax-command:v1:${encodeURIComponent(uid)}`;
const locks = new Set<string>();
const fenced = (uid: string, guard: () => void) => {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};};
async function read(uid: string, guard: () => void): Promise<SellerTaxAttempt | null> {
  const current = fenced(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid)); current();
  if (raw === null) return null;
  if (raw.length > 5000) throw sellerTaxFailure();
  const value: unknown = JSON.parse(raw);
  if (!isSellerTaxAttempt(value, uid) || value.inputHash !== await sellerTaxHash({subject: value.scope.subject, ownerId: value.scope.ownerId, year: value.scope.year, command: value.command})) throw sellerTaxFailure();
  current(); return value;
}
async function same(attempt: SellerTaxAttempt, current: () => void) {
  if (!sellerTaxEqual(await read(attempt.uid, current), attempt)) throw sellerTaxFailure(); current();
}
async function locked<T>(uid: string, operation: () => Promise<T>) {
  if (locks.has(uid)) throw sellerTaxFailure(); locks.add(uid);
  try {return await operation();} finally {locks.delete(uid);}
}
export const sellerTaxTerminal = (response: SellerTaxResponse) => response.commandReceipt?.status === 'completed' || response.commandReceipt?.status === 'not_executed';
export const SellerTaxJournal = {
  read,
  async submit(attempt: SellerTaxAttempt, guard: () => void, verifySource: () => void) {
    const current = fenced(attempt.uid, guard);
    return locked(attempt.uid, async () => {
      if (!isSellerTaxAttempt(attempt, attempt.uid) || await read(attempt.uid, current)) throw sellerTaxFailure();
      verifySource(); current(); await AsyncStorage.setItem(slot(attempt.uid), JSON.stringify(attempt)); current(); await same(attempt, current);
      const prior = await SellerTaxService.command(attempt, 'observe', current); current();
      if (prior.commandReceipt !== null) return prior;
      verifySource(); current(); await SellerTaxService.command(attempt, 'execute', current); current();
      return SellerTaxService.command(attempt, 'observe', current);
    });
  },
  async observe(attempt: SellerTaxAttempt, guard: () => void) {
    const current = fenced(attempt.uid, guard); await same(attempt, current); return SellerTaxService.command(attempt, 'observe', current);
  },
  async resume(attempt: SellerTaxAttempt, guard: () => void) {
    const current = fenced(attempt.uid, guard);
    return locked(attempt.uid, async () => {await same(attempt, current);
      const prior = await SellerTaxService.command(attempt, 'observe', current); current(); if (sellerTaxTerminal(prior)) return prior;
      await SellerTaxService.command(attempt, 'execute', current); current(); return SellerTaxService.command(attempt, 'observe', current);
    });
  },
  async neutralize(attempt: SellerTaxAttempt, guard: () => void) {
    const current = fenced(attempt.uid, guard);
    return locked(attempt.uid, async () => {await same(attempt, current);
      const prior = await SellerTaxService.command(attempt, 'observe', current); current(); if (sellerTaxTerminal(prior)) return prior;
      await SellerTaxService.command(attempt, 'neutralize', current); current(); return SellerTaxService.command(attempt, 'observe', current);
    });
  },
  async acknowledge(attempt: SellerTaxAttempt, guard: () => void) {
    const current = fenced(attempt.uid, guard);
    return locked(attempt.uid, async () => {await same(attempt, current);
      const fresh = await SellerTaxService.command(attempt, 'observe', current); current(); if (!sellerTaxTerminal(fresh)) throw sellerTaxFailure();
      await same(attempt, current); await AsyncStorage.removeItem(slot(attempt.uid)); current(); return fresh;
    });
  },
};
