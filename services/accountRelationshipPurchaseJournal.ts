import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { AccountRelationshipReviewService as Service, isRelationshipPurchaseAttempt, relationshipFailure } from '@/services/accountRelationshipReviewService';
import type { RelationshipPurchaseAttempt } from '@/types/accountRelationshipReview';

const slot = (uid: string) => `second:relationship-purchase-retirement:v1:${encodeURIComponent(uid)}`;
const locks = new Set<string>();
function fence(uid: string, guard: () => void) {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};}
async function read(uid: string, guard: () => void): Promise<RelationshipPurchaseAttempt | null> {
  const current = fence(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid)); current();
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw); if (!isRelationshipPurchaseAttempt(value, uid)) throw relationshipFailure(); return value;
}
async function same(attempt: RelationshipPurchaseAttempt, current: () => void) {
  if (!productReviewEqual(await read(attempt.uid, current), attempt)) throw relationshipFailure(); current();
}
async function locked<T>(uid: string, work: () => Promise<T>) {
  if (locks.has(uid)) throw relationshipFailure(); locks.add(uid); try {return await work();} finally {locks.delete(uid);}
}
/** One durable exact operation. After any attempted RPC, recovery is GET only. */
export const AccountRelationshipPurchaseJournal = {
  read,
  async submit(attempt: RelationshipPurchaseAttempt, guard: () => void, verifyNew: () => Promise<void>) {
    if (!isRelationshipPurchaseAttempt(attempt, attempt.uid)) throw relationshipFailure();
    const current = fence(attempt.uid, guard);
    return locked(attempt.uid, async () => {
      current(); if (await read(attempt.uid, current)) throw new Error('Relisez votre intention d’achat conservée avant toute nouvelle instruction.'); current();
      // No secret/provider payload is stored. Persist before every possible RPC.
      await AsyncStorage.setItem(slot(attempt.uid), JSON.stringify(attempt)); current(); await same(attempt, current);
      const prior = await Service.purchaseObserve(attempt, current); current();
      if (prior.state !== 'unrecorded') return prior;
      await verifyNew(); current();
      await Service.purchaseRetire(attempt, 'execute', current); current();
      return Service.purchaseObserve(attempt, current);
    });
  },
  async observe(attempt: RelationshipPurchaseAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard); await same(attempt, current); current(); return Service.purchaseObserve(attempt, current);
  },
  async neutralize(attempt: RelationshipPurchaseAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt.uid, async () => {
      await same(attempt, current); const prior = await Service.purchaseObserve(attempt, current); current();
      // No provider/intent retry after authorization or an unknown outcome.
      if (prior.state !== 'unrecorded') return prior;
      await Service.purchaseRetire(attempt, 'neutralize', current); current();
      return Service.purchaseObserve(attempt, current);
    });
  },
  async acknowledge(attempt: RelationshipPurchaseAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt.uid, async () => {
      await same(attempt, current); const receipt = await Service.purchaseObserve(attempt, current); current();
      if (!['received', 'not_executed'].includes(receipt.state)) throw new Error('L’issue reste à rapprocher en lecture. Conservez cette intention exacte.');
      await same(attempt, current); await AsyncStorage.removeItem(slot(attempt.uid)); current(); return receipt;
    });
  },
};
