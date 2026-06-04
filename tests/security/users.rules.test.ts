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

  // CHOSEN-USERNAME PIVOT: the user now picks a handle on the signup route, but
  // reservation is still 100% server-side (recordSignupConsent runTransaction).
  // A client must NOT be able to pre-squat a registry entry to reserve a handle
  // out-of-band, even pointing it at their own uid.
  it('denies a client from pre-reserving a chosen handle in the registry (self uid)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'usernames', 'cooluser'), { uid: ALICE }),
    );
  });

  // ANTI-ENUMERATION: even when a registry entry exists (server-created), a
  // client cannot read it to map handle -> uid. The availability probe goes
  // through the checkUsernameAvailability callable (Admin SDK), which returns
  // only a boolean.
  it('denies a client read of an existing registry entry (no handle->uid enumeration)', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'usernames', 'cooluser'), {
        uid: 'someone-else',
      });
    });
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(getDoc(doc(db, 'usernames', 'cooluser')));
  });

  // The chosen handle still lands on users/{uid}.username, written ONLY by the
  // server (recordSignupConsent). A client cannot self-write it at update time
  // even after the pivot (immutability + server-authoritative reservation).
  it('denies a client from writing their chosen username onto their user doc (update)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), { username: 'cooluser' }),
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

  // P3 (server-only): dateOfBirth is the Loi 25 consent-gate + age-gate, written
  // EXCLUSIVELY server-side by the recordSignupConsent callable (Admin SDK). A
  // client must never self-set it — neither at create nor at update.
  it('denies user from self-setting dateOfBirth (update)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), { dateOfBirth: '2000-01-01' }),
    );
  });

  // ---------------------------------------------------------------------------
  // CREATE coverage — this is the regression that broke prod signup (Google /
  // Apple / email): the create rule was widened to forbid `id` + `createdAt`
  // (which every legitimate signup setDoc seeds), so all account creation got
  // permission-denied. These tests lock the create contract: the 3 client signup
  // paths must succeed, every privilege/financial/trust field stays forbidden at
  // create, and `id`/`createdAt` are anti-forged (id == uid, createdAt ==
  // request.time).
  // ---------------------------------------------------------------------------
  it('allows owner to create their doc with id == uid + createdAt serverTimestamp (Google/Apple signup shape)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        isActive: true,
        authProvider: 'google',
      }),
    );
  });

  it('allows the same create shape with a profileImage', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        isActive: true,
        authProvider: 'apple',
        profileImage: 'https://example.com/a.jpg',
      }),
    );
  });

  it('denies create with isAdmin: true (privilege field)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        isActive: true,
        isAdmin: true,
      }),
    );
  });

  it('denies create with role: "admin" (privilege field)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        role: 'admin',
      }),
    );
  });

  it('denies create with a client-supplied username (server-assigned)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        username: 'x',
      }),
    );
  });

  it('denies create with self-attributed stripeAccountId (payout redirect)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        stripeAccountId: 'acct_x',
      }),
    );
  });

  it('denies create with stripeChargesEnabled: true (KYC skip)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        stripeChargesEnabled: true,
      }),
    );
  });

  it('denies create with forged trust signal isVerified: true', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        isVerified: true,
      }),
    );
  });

  it('denies create with forged trust signal rating: 5', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        rating: 5,
      }),
    );
  });

  it('denies create with self-supplied dateOfBirth (server-only consent field)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
        dateOfBirth: '2000-01-01',
      }),
    );
  });

  it('denies create with id != uid (anti-forge: foreign id in path)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: 'bob',
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('denies a non-owner from creating someone else\'s doc', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    // Bob (authenticated as 'bob') tries to create users/alice.
    const db = env.authenticatedContext('bob').firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('denies create with a backdated createdAt (anti-forge: createdAt != request.time)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(ALICE).firestore();
    // A fixed past Timestamp can never equal request.time at create.
    await assertFails(
      setDoc(doc(db, 'users', ALICE), {
        id: ALICE,
        email: 'alice@example.com',
        displayName: 'Alice',
        createdAt: Timestamp.fromDate(new Date('2000-01-01T00:00:00Z')),
      }),
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
