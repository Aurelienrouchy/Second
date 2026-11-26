import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { CommercialClaimReviewService as Service, isCommercialClaimReviewAttempt, commercialClaimReviewFailure } from '@/services/commercialClaimReviewService';
import type { CommercialClaimReviewAttempt } from '@/types/commercialClaimReview';

const key = (uid: string) => `second:commercial-claim-review:v1:${JSON.stringify([uid])}`;
const locks = new Set<string>();
function fence(uid: string, guard: () => void) {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};}
async function locked<T>(uid: string, work: () => Promise<T>) {if (locks.has(uid)) throw commercialClaimReviewFailure(); locks.add(uid); try {return await work();} finally {locks.delete(uid);}}
async function read(uid: string, guard: () => void): Promise<CommercialClaimReviewAttempt | null> {
  const current = fence(uid, guard); current(); const raw = await AsyncStorage.getItem(key(uid)); current();
  if (raw === null) return null; const value: unknown = JSON.parse(raw);
  if (!isCommercialClaimReviewAttempt(value, uid)) throw commercialClaimReviewFailure(); return value;
}
export const CommercialClaimReviewJournal = {
  read,
  async prepare(attempt: CommercialClaimReviewAttempt, guard: () => void) {
    if (!isCommercialClaimReviewAttempt(attempt, attempt.uid)) throw commercialClaimReviewFailure(); const current = fence(attempt.uid, guard);
    return locked(attempt.uid, async () => {
      current(); if (await read(attempt.uid, current)) throw commercialClaimReviewFailure(); current();
      await AsyncStorage.setItem(key(attempt.uid), JSON.stringify(attempt)); current();
    });
  },
  async executeNew(attempt: CommercialClaimReviewAttempt, guard: () => void, verifyNew: () => Promise<void>) {
    const current = fence(attempt.uid, guard);
    return locked(attempt.uid, async () => {
      current(); if (!productReviewEqual(await read(attempt.uid, current), attempt)) throw commercialClaimReviewFailure(); current();
      await verifyNew(); current(); await Service.command(attempt, 'execute', current); current();
      return Service.command(attempt, 'observe', current);
    });
  },
  async observe(attempt: CommercialClaimReviewAttempt, guard: () => void) {const current = fence(attempt.uid, guard); current(); return Service.command(attempt, 'observe', current);},
  async neutralize(attempt: CommercialClaimReviewAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt.uid, async () => {
      current(); if (!productReviewEqual(await read(attempt.uid, current), attempt)) throw commercialClaimReviewFailure(); current();
      await Service.command(attempt, 'neutralize', current); current(); return Service.command(attempt, 'observe', current);
    });
  },
  async acknowledge(attempt: CommercialClaimReviewAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt.uid, async () => {
      current(); const receipt = await Service.command(attempt, 'observe', current); current();
      if (receipt.state === 'unrecorded' || !receipt.recordedAt || !productReviewEqual(await read(attempt.uid, current), attempt)) throw commercialClaimReviewFailure(); current();
      await AsyncStorage.removeItem(key(attempt.uid)); current(); return receipt;
    });
  },
};
