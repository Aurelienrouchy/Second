import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice';

// Server-only collections: written exclusively by Cloud Functions (Admin SDK,
// which bypasses rules). No client read/write should ever succeed (admins may
// read some of them, but a plain authenticated user must not).
describe('server-only collections rules', () => {
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
      const db = ctx.firestore();
      await setDoc(doc(db, 'stripe_events', 'evt_1'), { processedAt: new Date() });
      await setDoc(doc(db, 'failed_operations', 'op_1'), {
        type: 'stripe_refund_failed',
        status: 'pending',
        refId: 'tx-1',
      });
      await setDoc(doc(db, 'platform_ledger', 'pl_1'), {
        type: 'shipping_cost_variance',
        delta: 3,
      });
      await setDoc(doc(db, 'rate_limits', 'alice_fn'), { count: 1 });
    });
  });

  it('denies authenticated user reading stripe_events', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(getDoc(doc(db, 'stripe_events', 'evt_1')));
  });

  it('denies authenticated user writing stripe_events', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'stripe_events', 'evt_hacker'), { processedAt: new Date() }),
    );
  });

  it('denies authenticated user reading failed_operations', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(getDoc(doc(db, 'failed_operations', 'op_1')));
  });

  it('denies authenticated user writing failed_operations', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'failed_operations', 'op_hacker'), { status: 'resolved' }),
    );
  });

  it('denies authenticated user reading platform_ledger', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(getDoc(doc(db, 'platform_ledger', 'pl_1')));
  });

  it('denies authenticated user reading rate_limits', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(getDoc(doc(db, 'rate_limits', 'alice_fn')));
  });

  it('denies authenticated user writing rate_limits', async () => {
    const db = (await getTestEnv()).authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'rate_limits', 'alice_fn'), { count: 0 }),
    );
  });
});
