import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const OWNER = 'owner';
const STRANGER = 'stranger';
const ADMIN = 'admin';
const SHOP_ID = 'shop-1';

const baseShop = {
  id: SHOP_ID,
  ownerId: OWNER,
  name: 'Friperie du Plateau',
  description: 'Vintage curated pieces',
  type: 'friperie',
  status: 'pending',
  reviewCount: 0,
  articlesCount: 0,
};

describe('shops rules — self-approval & forfait lock (B1/B2/B3)', () => {
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
      await setDoc(doc(ctx.firestore(), 'shops', SHOP_ID), baseShop);
      // Firestore-fallback admin (no custom claim) — isAdmin field.
      await setDoc(doc(ctx.firestore(), 'users', ADMIN), {
        email: 'admin@example.com',
        displayName: 'Admin',
        isAdmin: true,
      });
    });
  });

  // ---- create ----

  it('allows owner to create a pending shop', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'shops', 'new-shop'), {
        ownerId: OWNER,
        name: 'New Shop',
        status: 'pending',
      }),
    );
  });

  it('allows owner to create a shop without an explicit status', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'shops', 'new-shop-2'), {
        ownerId: OWNER,
        name: 'New Shop 2',
      }),
    );
  });

  it('denies owner creating an already-approved shop (self-approval at create)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', 'new-shop-3'), {
        ownerId: OWNER,
        name: 'Sneaky Shop',
        status: 'approved',
      }),
    );
  });

  it('denies owner setting verificationDetails at create', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', 'new-shop-4'), {
        ownerId: OWNER,
        name: 'Sneaky Shop',
        status: 'pending',
        verificationDetails: { verifiedBy: OWNER, verifiedAt: new Date() },
      }),
    );
  });

  it('denies owner granting itself a paid forfait at create', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', 'new-shop-5'), {
        ownerId: OWNER,
        name: 'Sneaky Shop',
        status: 'pending',
        plan: 'premium',
      }),
    );
  });

  // ---- update: owner cannot self-approve / self-upgrade ----

  it('allows owner to update non-sensitive profile fields', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'shops', SHOP_ID), {
        name: 'Friperie du Plateau (renamed)',
        description: 'Updated description',
      }),
    );
  });

  it('denies owner self-approving (status -> approved)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertFails(
      updateDoc(doc(db, 'shops', SHOP_ID), { status: 'approved' }),
    );
  });

  it('denies owner setting verificationDetails on update', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertFails(
      updateDoc(doc(db, 'shops', SHOP_ID), {
        verificationDetails: { verifiedBy: OWNER },
      }),
    );
  });

  it('denies owner upgrading its own forfait (plan/feesTier)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertFails(
      updateDoc(doc(db, 'shops', SHOP_ID), { plan: 'premium' }),
    );
    await assertFails(
      updateDoc(doc(db, 'shops', SHOP_ID), { feesTier: 'pro' }),
    );
  });

  it('denies owner self-attributing a paid tier or tierPaidUntil (F134, CF-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(OWNER).firestore();
    // The tier (lowers buyer fees) and its paid-until expiry are CF-only: only
    // the shop_tier webhook (Admin SDK) may set them after payment succeeds.
    await assertFails(
      updateDoc(doc(db, 'shops', SHOP_ID), { tier: 'premium' }),
    );
    await assertFails(
      updateDoc(doc(db, 'shops', SHOP_ID), {
        tierPaidUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      }),
    );
    await assertFails(
      updateDoc(doc(db, 'shops', SHOP_ID), {
        tier: 'pro',
        tierPaidUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      }),
    );
  });

  it('denies owner granting itself a tier at create time (F134)', async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    const db = env.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', 'new-shop-tier'), {
        ownerId: OWNER,
        name: 'Sneaky Shop',
        status: 'pending',
        tier: 'premium',
        tierPaidUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      }),
    );
  });

  it('denies a stranger updating a shop they do not own', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(STRANGER).firestore();
    await assertFails(
      updateDoc(doc(db, 'shops', SHOP_ID), { name: 'Hijacked' }),
    );
  });

  // ---- update: admin can moderate ----

  it('allows an admin (custom claim) to approve a shop', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext('admin-claim', { admin: true }).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'shops', SHOP_ID), {
        status: 'approved',
        verificationDetails: { verifiedBy: 'admin-claim' },
      }),
    );
  });

  it('allows an admin (Firestore isAdmin fallback) to suspend a shop', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'shops', SHOP_ID), {
        status: 'suspended',
        verificationDetails: { reason: 'policy violation', verifiedBy: ADMIN },
      }),
    );
  });

  it('allows an admin to assign a paid forfait', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext('admin-claim', { admin: true }).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'shops', SHOP_ID), { plan: 'premium' }),
    );
  });
});
