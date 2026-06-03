import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
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

  it('allows create WITHOUT username (server assigns it later)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'users', ALICE), {
        email: 'alice@example.com',
        displayName: 'Alice',
      }),
    );
  });

  it('denies create with a client-supplied username', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        email: 'alice@example.com',
        displayName: 'Alice',
        username: 'alice',
      }),
    );
  });

  it('denies user from adding/changing their own username', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(updateDoc(doc(db, 'users', ALICE), { username: 'alice' }));
  });

  it('denies any client read of the usernames registry', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'usernames', 'alice'), {
        uid: ALICE,
      });
    });
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(getDoc(doc(db, 'usernames', 'alice')));
  });

  it('denies any client write to the usernames registry', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'usernames', 'alice'), { uid: ALICE }),
    );
  });

  // ---------------------------------------------------------------------------
  // P0: Stripe financial gates must be locked against client writes (update).
  // These fields are the ONLY gates read by walletWithdraw / createTransaction /
  // swaps, and are written EXCLUSIVELY server-side (Stripe webhook + onboarding
  // callables via Admin SDK). A client write would let a seller redirect their
  // payout (stripeAccountId) or force activation booleans true to skip KYC.
  // ---------------------------------------------------------------------------
  it('denies user from redirecting their payout via stripeAccountId (update)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), { stripeAccountId: 'acct_attacker' }),
    );
  });

  it('denies user from forcing stripeChargesEnabled / stripePayoutsEnabled true (update)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), {
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      }),
    );
  });

  it('denies user from self-setting other stripe* gate fields (update)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), { stripeAccountStatus: 'active' }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), { stripeDetailsSubmitted: true }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), { stripeBankAccountAdded: true }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), { stripeBankAccountLast4: '4242' }),
    );
  });

  // P1: same lock must apply at CREATE so a forged initial doc can't bypass it.
  it('denies create with self-attributed stripe* fields', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        email: 'alice@example.com',
        displayName: 'Alice',
        stripeAccountId: 'acct_attacker',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      }),
    );
  });

  // P1: trust signals served by getUserPublicProfile are server-managed.
  it('denies user from forging trust signals (rating/reviewCount/isVerified/sellerLikesCount) on update', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(updateDoc(doc(db, 'users', ALICE), { rating: 5 }));
    await assertFails(updateDoc(doc(db, 'users', ALICE), { reviewCount: 999 }));
    await assertFails(updateDoc(doc(db, 'users', ALICE), { isVerified: true }));
    await assertFails(updateDoc(doc(db, 'users', ALICE), { sellerLikesCount: 999 }));
  });

  it('denies create with forged trust signals', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        email: 'alice@example.com',
        displayName: 'Alice',
        isVerified: true,
        rating: 5,
        reviewCount: 999,
        sellerLikesCount: 999,
      }),
    );
  });

  // P3 (server-only): dateOfBirth is the Loi 25 consent-gate + age-gate, set
  // ONLY in the server-side signup setDoc. A client must never self-set it.
  it('denies user from self-setting dateOfBirth (update)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), { dateOfBirth: '2000-01-01' }),
    );
  });

  // accountType ('user' | 'shop') is intentionally NOT protected — it is a
  // legitimate client write (userService.updateAccountType) and is not a
  // financial gate. This guards against an over-broad lock regression.
  it('allows user to update their own accountType (legitimate, not a financial gate)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', ALICE), { accountType: 'shop' }),
    );
  });
});
