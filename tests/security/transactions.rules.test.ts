import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice';
const BOB = 'bob';
const CHARLIE = 'charlie';
const TX_ID = 'tx-1';

const baseTx = {
  articleId: 'article-1',
  buyerId: ALICE,
  sellerId: BOB,
  amount: 50,
  status: 'meetup_pending',
};

describe('transactions rules', () => {
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
      await setDoc(doc(ctx.firestore(), 'transactions', TX_ID), baseTx);
    });
  });

  it('allows buyer to read their own transaction', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, 'transactions', TX_ID)));
  });

  it('allows seller to read their own transaction', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertSucceeds(getDoc(doc(db, 'transactions', TX_ID)));
  });

  it('denies a third party reading the transaction', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(CHARLIE).firestore();
    await assertFails(getDoc(doc(db, 'transactions', TX_ID)));
  });

  it('allows seller to update status to meetup_confirmed', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'transactions', TX_ID), { status: 'meetup_confirmed' }),
    );
  });

  it('denies user updating status to "paid" (CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { status: 'paid' }),
    );
  });

  it('denies user updating status to "cancelled" (CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { status: 'cancelled' }),
    );
  });

  it('allows seller meetup confirmation with meetupConfirmedAt + updatedAt', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'transactions', TX_ID), {
        status: 'meetup_confirmed',
        meetupConfirmedAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it('denies buyer self-confirming a meetup (seller-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { status: 'meetup_confirmed' }),
    );
  });

  it('denies client setting disputed=true (CF-only sensitive field)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { disputed: true }),
    );
  });

  it('denies client setting fundsReleaseAt (escrow release is CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { fundsReleaseAt: new Date() }),
    );
  });

  it('denies client writing trackingNumber (shipping is CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { trackingNumber: 'fake-1Z' }),
    );
  });

  it('denies client clearing labelCreationPending (CF-only sensitive field)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { labelCreationPending: false }),
    );
  });

  it('denies client mutating meetupSpot (immutable after creation)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), {
        meetupSpot: { name: 'X', address: 'Y', category: 'cafe' },
      }),
    );
  });

  it('denies client lowering the transaction amount', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'transactions', TX_ID), { amount: 1 }),
    );
  });
});
