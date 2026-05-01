import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice';
const BOB = 'bob';

const baseBalance = (uid: string) => ({
  userId: uid,
  availableBalance: 100,
  pendingBalance: 0,
  totalEarnings: 100,
  transactions: [],
});

describe('seller_balances rules', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'seller_balances', ALICE), baseBalance(ALICE));
      await setDoc(doc(ctx.firestore(), 'seller_balances', BOB), baseBalance(BOB));
    });
  });

  it('allows owner to read their own balance', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'seller_balances', ALICE)));
  });

  it('denies owner from writing/updating their own balance directly (CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'seller_balances', ALICE), { availableBalance: 9999 }),
    );
  });

  it('denies user A reading user B balance', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(getDoc(doc(db, 'seller_balances', BOB)));
  });
});
