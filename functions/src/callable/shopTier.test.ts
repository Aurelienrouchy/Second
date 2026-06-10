/**
 * F134 — purchaseShopTier callable.
 *
 * Drives the REAL exported callable through the in-memory Firestore + Stripe mock.
 * Asserts: owner-only guard, server-side price computation, and a DIRECT PLATFORM
 * CHARGE PaymentIntent (no transfer_data) tagged metadata.type === 'shop_tier'.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripeMock: null as StripeMock | null,
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock: StripeMock = createStripeMock();
holder.fs = fs;
holder.stripeMock = stripeMock;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

vi.mock('../config/stripe', () => ({
  getStripe: () => holder.stripeMock!.client,
}));

vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: (request: { auth?: { uid?: string } }) => ({
    callerKey: request.auth?.uid ?? 'anon',
    isAuthenticated: !!request.auth,
  }),
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

vi.mock('firebase-functions/v2/https', () => {
  class _HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  }
  return {
    onCall: (_opts: unknown, handler: unknown) => handler,
    HttpsError: _HttpsError,
  };
});

import { purchaseShopTier } from './shopTier';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callPurchase = purchaseShopTier as unknown as CallableHandler;

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  process.env.STRIPE_SECRET_KEY = 'sk_test';
});

describe('purchaseShopTier (F134)', () => {
  it('creates a direct platform charge PI tagged shop_tier for the shop owner', async () => {
    fs.setDoc('shops/shop1', { ownerId: 'owner1', name: 'Friperie', status: 'approved' });
    stripeMock.impl.paymentIntentsCreate = async () => ({
      id: 'pi_tier_1',
      client_secret: 'pi_tier_1_secret',
    });

    const res = await callPurchase({
      auth: { uid: 'owner1' },
      data: { shopId: 'shop1', tier: 'pro', periodMonths: 3 },
    });

    expect(res.success).toBe(true);
    expect(res.clientSecret).toBe('pi_tier_1_secret');
    expect(res.tier).toBe('pro');
    expect(res.periodMonths).toBe(3);
    // pro default 2999/mo * 3 = 8997 cents.
    expect(res.amountCents).toBe(8997);

    // Exactly ONE PaymentIntent created, as a DIRECT PLATFORM CHARGE.
    expect(stripeMock.calls.paymentIntentsCreate.length).toBe(1);
    const piArgs = stripeMock.calls.paymentIntentsCreate[0][0] as Record<string, any>;
    expect(piArgs.amount).toBe(8997);
    expect(piArgs.currency).toBe('cad');
    expect(piArgs.metadata.type).toBe('shop_tier');
    expect(piArgs.metadata.shopId).toBe('shop1');
    expect(piArgs.metadata.tier).toBe('pro');
    expect(piArgs.metadata.periodMonths).toBe('3');
    // No transfer_data / on_behalf_of (vague 1 single-rail model).
    expect(piArgs.transfer_data).toBeUndefined();
    expect(piArgs.on_behalf_of).toBeUndefined();
    expect(piArgs.application_fee_amount).toBeUndefined();
  });

  it('rejects a non-owner', async () => {
    fs.setDoc('shops/shop1', { ownerId: 'owner1', name: 'Friperie', status: 'approved' });
    await expect(
      callPurchase({
        auth: { uid: 'stranger' },
        data: { shopId: 'shop1', tier: 'pro', periodMonths: 1 },
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(stripeMock.calls.paymentIntentsCreate.length).toBe(0);
  });

  it('rejects an invalid tier', async () => {
    fs.setDoc('shops/shop1', { ownerId: 'owner1', status: 'approved' });
    await expect(
      callPurchase({
        auth: { uid: 'owner1' },
        data: { shopId: 'shop1', tier: 'basic', periodMonths: 1 },
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects an out-of-range periodMonths', async () => {
    fs.setDoc('shops/shop1', { ownerId: 'owner1', status: 'approved' });
    await expect(
      callPurchase({
        auth: { uid: 'owner1' },
        data: { shopId: 'shop1', tier: 'premium', periodMonths: 0 },
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('requires authentication', async () => {
    await expect(
      callPurchase({ auth: null, data: { shopId: 'shop1', tier: 'pro', periodMonths: 1 } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
