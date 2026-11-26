import AsyncStorage from '@/utils/environmentStorage';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { productReviewEqual } from '@/services/productReviewService';
import { AccountRelationshipReviewService, isRelationshipAttempt, relationshipFailure } from '@/services/accountRelationshipReviewService';
import type { RelationshipAttempt, RelationshipScope } from '@/types/accountRelationshipReview';

const slot = (uid: string, scope: RelationshipScope) => `second:account-relationship:v1:${JSON.stringify([uid, scope])}`;
const locks = new Set<string>();
function fence(uid: string, guard: () => void) {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};}
async function read(uid: string, scope: RelationshipScope, guard: () => void): Promise<RelationshipAttempt | null> {
  const current = fence(uid, guard); current(); const raw = await AsyncStorage.getItem(slot(uid, scope)); current();
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw); if (!isRelationshipAttempt(value, uid, scope)) throw relationshipFailure(); return value;
}
async function locked<T>(attempt: RelationshipAttempt, work: () => Promise<T>) {
  const key = slot(attempt.uid, attempt.command.scope); if (locks.has(key)) throw relationshipFailure(); locks.add(key);
  try {return await work();} finally {locks.delete(key);}
}
async function same(attempt: RelationshipAttempt, current: () => void) {
  if (!productReviewEqual(await read(attempt.uid, attempt.command.scope, current), attempt)) throw relationshipFailure(); current();
}
export const AccountRelationshipReviewJournal = {
  read,
  async prepare(attempt: RelationshipAttempt, guard: () => void) {
    if (!isRelationshipAttempt(attempt, attempt.uid, attempt.command.scope)) throw relationshipFailure();
    const current = fence(attempt.uid, guard);
    return locked(attempt, async () => {
      const previous = await read(attempt.uid, attempt.command.scope, current); current();
      if (previous && !productReviewEqual(previous, attempt)) throw relationshipFailure();
      await AsyncStorage.setItem(slot(attempt.uid, attempt.command.scope), JSON.stringify(attempt)); current(); await same(attempt, current);
    });
  },
  async resume(attempt: RelationshipAttempt, guard: () => void, verifyNew: () => Promise<void>) {
    const current = fence(attempt.uid, guard);
    return locked(attempt, async () => {
      await same(attempt, current);
      const prior = await AccountRelationshipReviewService.command(attempt, 'observe', current); current();
      if (prior.state !== 'unrecorded') return prior;
      await verifyNew(); current();
      await AccountRelationshipReviewService.command(attempt, 'execute', current); current();
      return AccountRelationshipReviewService.command(attempt, 'observe', current);
    });
  },
  async observe(attempt: RelationshipAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard); current(); return AccountRelationshipReviewService.command(attempt, 'observe', current);
  },
  async neutralize(attempt: RelationshipAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt, async () => {await same(attempt, current); await AccountRelationshipReviewService.command(attempt, 'neutralize', current); current(); return AccountRelationshipReviewService.command(attempt, 'observe', current);});
  },
  async acknowledge(attempt: RelationshipAttempt, guard: () => void) {
    const current = fence(attempt.uid, guard);
    return locked(attempt, async () => {
      const receipt = await AccountRelationshipReviewService.command(attempt, 'observe', current); current();
      if (receipt.state === 'unrecorded') throw relationshipFailure();
      await same(attempt, current); await AsyncStorage.removeItem(slot(attempt.uid, attempt.command.scope)); current(); return receipt;
    });
  },
};
