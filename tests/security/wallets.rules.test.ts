import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice';
const BOB = 'bob';

// The wallet ("porte-monnaie") is the seller-balance ledger. Balances
// (balance, pendingBalance, heldBalance, sellerDebt) move ONLY via Cloud
// Functions (Admin SDK). Clients may read their own wallet but never write it.
describe('wallets rules', () => {
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
      await setDoc(doc(ctx.firestore(), 'wallets', ALICE), {
        userId: ALICE,
        balance: 0,
        pendingBalance: 0,
        heldBalance: 0,
        sellerDebt: 0,
      });
    });
  });

  it('allows the owner to read their wallet', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'wallets', ALICE)));
  });

  it('denies a third party reading the wallet', async () => {
    const db = (await getTestEnv()).authenticatedContext(BOB).firestore();
    await assertFails(getDoc(doc(db, 'wallets', ALICE)));
  });

  it('denies the owner inflating their own balance', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'wallets', ALICE), { balance: 999999 }),
    );
  });

  it('denies the owner clearing their sellerDebt', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'wallets', ALICE), { sellerDebt: 0, balance: 100 }),
    );
  });

  it('denies the owner moving heldBalance to withdrawable balance', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'wallets', ALICE), { heldBalance: 0, balance: 500 }),
    );
  });
});
