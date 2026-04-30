import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice';

const baseUser = {
  email: 'alice@example.com',
  displayName: 'Alice',
  isAdmin: false,
  role: 'user',
};

describe('users rules', () => {
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
      await setDoc(doc(ctx.firestore(), 'users', ALICE), baseUser);
    });
  });

  it('allows user to update their own displayName', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', ALICE), { displayName: 'Alice Updated' }),
    );
  });

  it('denies user from self-elevating with isAdmin: true', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(updateDoc(doc(db, 'users', ALICE), { isAdmin: true }));
  });

  it('denies user from self-elevating with role: "admin"', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(updateDoc(doc(db, 'users', ALICE), { role: 'admin' }));
  });

  it('denies create with isAdmin: true', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        email: 'alice@example.com',
        displayName: 'Alice',
        isAdmin: true,
      }),
    );
  });
});
