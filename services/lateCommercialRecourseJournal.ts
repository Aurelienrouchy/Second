import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { isLateCommercialAttempt, LateCommercialRecourseService } from '@/services/lateCommercialRecourseService';
import type { LateCommercialAttempt } from '@/types/lateCommercialRecourse';

const key = (uid: string) => `second:late-commercial-recourse:v1:${JSON.stringify([uid])}`;
const locks = new Set<string>();
const unknown = () => new Error('Le reçu de la même instruction reste à vérifier. Conservez son identifiant avant toute autre instruction.');
function fence(uid: string, assertContext: () => void) {
  const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); assertContext();};
}
async function read(uid: string, assertContext: () => void): Promise<LateCommercialAttempt | null> {
  const assertCurrent = fence(uid, assertContext); assertCurrent();
  const raw = await AsyncStorage.getItem(key(uid)); assertCurrent(); if (raw === null) return null;
  const value: unknown = JSON.parse(raw); if (!isLateCommercialAttempt(value, uid)) throw unknown(); return value;
}
async function locked<T>(uid: string, work: () => Promise<T>) {
  if (locks.has(uid)) throw unknown(); locks.add(uid); try {return await work();} finally {locks.delete(uid);}
}
function same(a: LateCommercialAttempt | null, b: LateCommercialAttempt) {return !!a && productReviewEqual(a, b);}
export const LateCommercialRecourseJournal = {
  read,
  async execute(attempt: LateCommercialAttempt, assertContext: () => void, resume = false) {
    if (!isLateCommercialAttempt(attempt, attempt.uid)) throw unknown();
    const assertCurrent = fence(attempt.uid, assertContext);
    return locked(attempt.uid, async () => {
      assertCurrent(); const previous = await read(attempt.uid, assertCurrent); assertCurrent();
      if (previous && !same(previous, attempt) || resume && !previous) throw unknown();
      await AsyncStorage.setItem(key(attempt.uid), JSON.stringify(attempt)); assertCurrent();
      await LateCommercialRecourseService.command(attempt, 'execute', assertCurrent); assertCurrent();
      return LateCommercialRecourseService.command(attempt, 'observe', assertCurrent);
    });
  },
  async observe(attempt: LateCommercialAttempt, assertContext: () => void) {
    const assertCurrent = fence(attempt.uid, assertContext); assertCurrent();
    return LateCommercialRecourseService.command(attempt, 'observe', assertCurrent);
  },
  async neutralize(attempt: LateCommercialAttempt, assertContext: () => void) {
    const assertCurrent = fence(attempt.uid, assertContext);
    return locked(attempt.uid, async () => {
      assertCurrent(); if (!same(await read(attempt.uid, assertCurrent), attempt)) throw unknown(); assertCurrent();
      await LateCommercialRecourseService.command(attempt, 'neutralize', assertCurrent); assertCurrent();
      return LateCommercialRecourseService.command(attempt, 'observe', assertCurrent);
    });
  },
  async acknowledge(attempt: LateCommercialAttempt, assertContext: () => void) {
    const assertCurrent = fence(attempt.uid, assertContext);
    return locked(attempt.uid, async () => {
      const receipt = await LateCommercialRecourseService.command(attempt, 'observe', assertCurrent); assertCurrent();
      if (receipt.state === 'unrecorded' || !same(await read(attempt.uid, assertCurrent), attempt)) throw unknown(); assertCurrent();
      await AsyncStorage.removeItem(key(attempt.uid)); assertCurrent(); return receipt;
    });
  },
};
