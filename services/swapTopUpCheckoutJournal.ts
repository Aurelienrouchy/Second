import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { SwapTopUpCheckoutService as Service, isSwapTopUpAttempt, swapTopUpFailure } from '@/services/swapTopUpCheckoutService';
import type { SwapTopUpAttempt, SwapTopUpScope } from '@/types/swapTopUpCheckout';

const slot = (uid: string, scope: SwapTopUpScope) => `second:swap-topup-manual:v1:${JSON.stringify([uid, scope])}`;
const locks = new Set<string>();
function fence(uid: string, guard: () => void) {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};}
async function read(uid: string, scope: SwapTopUpScope, guard: () => void): Promise<SwapTopUpAttempt | null> {
  const current = fence(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid, scope)); current();
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw); if (!isSwapTopUpAttempt(value, uid, scope)) throw swapTopUpFailure(); return value;
}
async function locked<T>(attempt: SwapTopUpAttempt, work: () => Promise<T>) {
  const key = slot(attempt.uid, attempt.command.scope); if (locks.has(key)) throw swapTopUpFailure(); locks.add(key);
  try {return await work();} finally {locks.delete(key);}
}
async function same(attempt: SwapTopUpAttempt, current: () => void) {
  if (!productReviewEqual(await read(attempt.uid, attempt.command.scope, current), attempt)) throw swapTopUpFailure(); current();
}
export const SwapTopUpCheckoutJournal = {
  read,
  async prepare(attempt: SwapTopUpAttempt, guard: () => void) {
    if (!isSwapTopUpAttempt(attempt, attempt.uid, attempt.command.scope)) throw swapTopUpFailure();
    const current = fence(attempt.uid, guard);
    return locked(attempt, async () => {
      if (await read(attempt.uid, attempt.command.scope, current)) throw swapTopUpFailure(); current();
      // Exact keys admit tokenized payment-method IDs, never secrets or card details.
      await AsyncStorage.setItem(slot(attempt.uid, attempt.command.scope), JSON.stringify(attempt)); current(); await same(attempt, current);
    });
  },
  /** Called once by a NEW explicit choice. Every later recovery is observe GET-only. */
  async executeNew(attempt: SwapTopUpAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt, async () => {await same(attempt, current); current(); return Service.command(attempt, 'execute', current);});
  },
  async observe(attempt: SwapTopUpAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard); current(); return Service.command(attempt, 'observe', current);
  },
  async neutralize(attempt: SwapTopUpAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt, async () => {await same(attempt, current); await Service.command(attempt, 'neutralize', current); current(); return Service.command(attempt, 'observe', current);});
  },
  async acknowledge(attempt: SwapTopUpAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt, async () => {
      const receipt = await Service.command(attempt, 'observe', current); current();
      if (!['received', 'not_executed'].includes(receipt.state) || receipt.recordedAt === null) throw swapTopUpFailure();
      await same(attempt, current); await AsyncStorage.removeItem(slot(attempt.uid, attempt.command.scope)); current(); return receipt;
    });
  },
};
