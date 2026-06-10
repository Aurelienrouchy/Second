/**
 * Integration-style tests for createTransaction SERVER-SIDE shipping re-pricing.
 *
 * Focus (chantier item 7): a client-supplied `shippingCost` is NEVER trusted —
 * the server re-quotes the rate from ShipEngine using the supplied (real)
 * rateId and persists ITS amount as the authoritative shipping cost on the
 * transaction + totalAmount. A minored client `shippingCost` must be ignored.
 *
 * Also covers the guards that protect this path: a fallback rateId is rejected,
 * and an expired/unknown rateId (not found in fresh rates) is rejected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

interface ShipEngineMock {
  getRatesImpl: null | ((...a: unknown[]) => unknown);
  getRatesCalls: unknown[][];
}

// See webhooks.test.ts for the lazy-holder rationale.
const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  shipEngineMock: {
    getRatesImpl: null as null | ((...a: unknown[]) => unknown),
    getRatesCalls: [] as unknown[][],
  } as ShipEngineMock,
}));

const fs: MockFirestore = createFirestoreMock();
const shipEngineMock = holder.shipEngineMock;
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

vi.mock('../config/stripe', () => ({
  getStripe: () => ({}),
}));

vi.mock('../config/shipEngine', () => ({
  getShipEngine: () => ({
    getRates: (...a: unknown[]) => {
      holder.shipEngineMock.getRatesCalls.push(a);
      if (!holder.shipEngineMock.getRatesImpl) throw new Error('getRates not stubbed');
      return holder.shipEngineMock.getRatesImpl(...a);
    },
  }),
}));

vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: (request: { auth?: { uid?: string } }) => ({
    callerKey: request.auth?.uid ?? 'anon',
    isAuthenticated: !!request.auth,
  }),
}));

vi.mock('../utils/trackingTransition', () => ({
  applyTrackingOutcome: () => {},
  DELIVERABLE_STATUSES: new Set<string>(),
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

import { createTransaction } from './payments';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callCreate = createTransaction as unknown as CallableHandler;

const VALID_ADDRESS = {
  name: 'Acheteur Test',
  street: '123 rue Principale',
  city: 'Montreal',
  province: 'QC',
  postalCode: 'H2X 1Y4',
  country: 'CA',
  phone: '5145551234',
};

/** Seed an available shipping article + a payout-enabled seller. */
function seedArticleAndSeller(price = 50) {
  fs.setDoc('articles/art1', {
    sellerId: 'seller1',
    price,
    isSold: false,
    isActive: true,
    weight: '0.5',
    dimensions: { length: '30', width: '25', height: '10' },
    location: { postalCode: 'H2X 1Y4', city: 'Montreal', province: 'QC' },
  });
  fs.setDoc('users/seller1', {
    displayName: 'Vendeur Test',
    stripeAccountId: 'acct_seller1',
    stripeChargesEnabled: true,
    phoneNumber: '5145559876',
    addresses: [
      {
        isDefault: true,
        street: '999 rue du Vendeur',
        city: 'Montreal',
        province: 'QC',
        postalCode: 'H3Z 2Y7',
      },
    ],
  });
}

function rate(rateId: string, amount: number) {
  return {
    rateId,
    carrierCode: 'canada_post',
    carrierFriendlyName: 'Canada Post',
    serviceType: 'expedited',
    estimatedDeliveryDays: 3,
    deliveryType: 'shipping',
    shippingAmount: { amount, currency: 'cad' },
  };
}

beforeEach(() => {
  fs.reset();
  shipEngineMock.getRatesImpl = null;
  shipEngineMock.getRatesCalls.length = 0;
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.SHIPENGINE_API_KEY = 'se_test';
  // F137: these tests exercise the shipping rail, which is OFF by default.
  process.env.SHIPPING_ENABLED = 'true';
});

// ===========================================================================
// 7. Server re-pricing ignores a minored client shippingCost
// ===========================================================================

describe('createTransaction — server-side shipping re-pricing', () => {
  it('ignores a minored client shippingCost and uses the server rate', async () => {
    seedArticleAndSeller(50);
    // ShipEngine returns the REAL rate of 14.99 for the supplied rateId.
    shipEngineMock.getRatesImpl = () => [rate('se_rate_real', 14.99), rate('se_rate_other', 9.99)];

    const result = await callCreate({
      auth: { uid: 'buyer1' },
      data: {
        articleId: 'art1',
        deliveryType: 'shipping',
        amount: 50,
        // Malicious/buggy client tries to pay almost nothing for shipping.
        shippingCost: 0.01,
        shippingAddress: VALID_ADDRESS,
        shipEngineRateId: 'se_rate_real',
        chatId: 'chat1',
      },
    });

    expect(result.success).toBe(true);
    const txId = result.transactionId as string;
    const tx = fs.getDoc(`transactions/${txId}`)!;

    // The persisted shipping cost is the SERVER rate, not the client's 0.01.
    expect(tx.shippingCost).toBe(14.99);
    // totalAmount = amount(50) + serverShipping(14.99) + serviceFee.
    // serviceFee for a 50$ article = 50*0.05 + 1.50 = 4.00 (see utils/fees).
    expect(tx.serviceFee).toBe(4.0);
    expect(tx.totalAmount).toBeCloseTo(50 + 14.99 + 4.0, 2);
    expect(tx.sellerPayout).toBe(50);

    // Article was locked.
    expect(fs.getDoc('articles/art1')!.isSold).toBe(true);
    // ShipEngine was actually consulted for the re-quote.
    expect(shipEngineMock.getRatesCalls.length).toBe(1);
  });

  it('rejects a fallback rateId before any pricing', async () => {
    seedArticleAndSeller(50);

    await expect(
      callCreate({
        auth: { uid: 'buyer1' },
        data: {
          articleId: 'art1',
          deliveryType: 'shipping',
          amount: 50,
          shippingCost: 5,
          shippingAddress: VALID_ADDRESS,
          shipEngineRateId: 'fallback_se_rate',
        },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // No re-quote attempted, article untouched.
    expect(shipEngineMock.getRatesCalls.length).toBe(0);
    expect(fs.getDoc('articles/art1')!.isSold).toBe(false);
  });

  it('rejects when the supplied rateId is not found in fresh rates (expired)', async () => {
    seedArticleAndSeller(50);
    // Fresh rates no longer contain the supplied rateId.
    shipEngineMock.getRatesImpl = () => [rate('se_rate_new1', 12.5), rate('se_rate_new2', 18.0)];

    await expect(
      callCreate({
        auth: { uid: 'buyer1' },
        data: {
          articleId: 'art1',
          deliveryType: 'shipping',
          amount: 50,
          shippingCost: 12.5,
          shippingAddress: VALID_ADDRESS,
          shipEngineRateId: 'se_rate_expired',
        },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Re-quote was attempted but the rateId did not match — article not locked.
    expect(shipEngineMock.getRatesCalls.length).toBe(1);
    expect(fs.getDoc('articles/art1')!.isSold).toBe(false);
  });

  it('meetup transactions have no shipping cost and no service fee', async () => {
    fs.setDoc('articles/art2', {
      sellerId: 'seller1',
      price: 30,
      isSold: false,
      isActive: true,
    });
    fs.setDoc('users/seller1', { displayName: 'Vendeur', stripeChargesEnabled: true });

    const result = await callCreate({
      auth: { uid: 'buyer1' },
      data: {
        articleId: 'art2',
        deliveryType: 'meetup',
        amount: 30,
        meetupSpot: { name: 'Cafe', category: 'public', neighborhood: 'Plateau' },
      },
    });

    expect(result.success).toBe(true);
    const tx = fs.getDoc(`transactions/${result.transactionId as string}`)!;
    expect(tx.shippingCost).toBe(0);
    expect(tx.serviceFee).toBe(0);
    expect(tx.totalAmount).toBe(30);
    expect(tx.status).toBe('meetup_pending');
    // No ShipEngine call for meetup.
    expect(shipEngineMock.getRatesCalls.length).toBe(0);
  });
});

// ===========================================================================
// F134 — paid-shop buyer-fee reduction only honoured for an ACTIVE forfait
// ===========================================================================

describe('createTransaction — paid-shop tier expiry (F134)', () => {
  function inMonths(n: number): Date {
    const d = new Date();
    d.setMonth(d.getMonth() + n);
    return d;
  }

  it('applies the pro reduction (50%) when the forfait is active', async () => {
    seedArticleAndSeller(50);
    // Approved shop owned by the seller, pro tier, paid into the future.
    fs.setDoc('shops/shop1', {
      ownerId: 'seller1',
      status: 'approved',
      tier: 'pro',
      tierPaidUntil: inMonths(2),
    });
    shipEngineMock.getRatesImpl = () => [rate('se_rate_real', 10)];

    const result = await callCreate({
      auth: { uid: 'buyer1' },
      data: {
        articleId: 'art1',
        deliveryType: 'shipping',
        amount: 50,
        shippingCost: 10,
        shippingAddress: VALID_ADDRESS,
        shipEngineRateId: 'se_rate_real',
      },
    });

    const tx = fs.getDoc(`transactions/${result.transactionId as string}`)!;
    // Full fee for a 50$ article = 4.00; pro reduction 0.5 → 2.00.
    expect(tx.serviceFee).toBe(2.0);
    expect(tx.buyerFeeReduction).toBe(0.5);
  });

  it('IGNORES an expired forfait (tierPaidUntil in the past) → full fee', async () => {
    seedArticleAndSeller(50);
    fs.setDoc('shops/shop1', {
      ownerId: 'seller1',
      status: 'approved',
      tier: 'pro',
      tierPaidUntil: inMonths(-1), // expired last month
    });
    shipEngineMock.getRatesImpl = () => [rate('se_rate_real', 10)];

    const result = await callCreate({
      auth: { uid: 'buyer1' },
      data: {
        articleId: 'art1',
        deliveryType: 'shipping',
        amount: 50,
        shippingCost: 10,
        shippingAddress: VALID_ADDRESS,
        shipEngineRateId: 'se_rate_real',
      },
    });

    const tx = fs.getDoc(`transactions/${result.transactionId as string}`)!;
    // Expired tier → no reduction → full 4.00 fee.
    expect(tx.serviceFee).toBe(4.0);
    expect(tx.buyerFeeReduction).toBe(0);
  });

  it('IGNORES a tier with no tierPaidUntil at all → full fee', async () => {
    seedArticleAndSeller(50);
    fs.setDoc('shops/shop1', {
      ownerId: 'seller1',
      status: 'approved',
      tier: 'premium', // would be 100% reduction IF active, but never paid
    });
    shipEngineMock.getRatesImpl = () => [rate('se_rate_real', 10)];

    const result = await callCreate({
      auth: { uid: 'buyer1' },
      data: {
        articleId: 'art1',
        deliveryType: 'shipping',
        amount: 50,
        shippingCost: 10,
        shippingAddress: VALID_ADDRESS,
        shipEngineRateId: 'se_rate_real',
      },
    });

    const tx = fs.getDoc(`transactions/${result.transactionId as string}`)!;
    expect(tx.serviceFee).toBe(4.0);
    expect(tx.buyerFeeReduction).toBe(0);
  });
});

// ===========================================================================
// F137 — server-authoritative SHIPPING_ENABLED flag on createTransaction
// ===========================================================================

describe('createTransaction — F137 server shipping flag', () => {
  it('REFUSES a shipping transaction when SHIPPING_ENABLED is OFF', async () => {
    seedArticleAndSeller(50);
    process.env.SHIPPING_ENABLED = 'false';
    shipEngineMock.getRatesImpl = () => [rate('se_rate_real', 14.99)];

    await expect(
      callCreate({
        auth: { uid: 'buyer1' },
        data: {
          articleId: 'art1',
          deliveryType: 'shipping',
          amount: 50,
          shippingCost: 14.99,
          shippingAddress: VALID_ADDRESS,
          shipEngineRateId: 'se_rate_real',
          chatId: 'chat1',
        },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Refused EARLY: no re-pricing, article never locked.
    expect(shipEngineMock.getRatesCalls.length).toBe(0);
    expect(fs.getDoc('articles/art1')!.isSold).toBe(false);
  });

  it('ALLOWS meetup even when SHIPPING_ENABLED is OFF', async () => {
    fs.setDoc('articles/art2', {
      sellerId: 'seller1',
      price: 30,
      isSold: false,
      isActive: true,
    });
    fs.setDoc('users/seller1', { displayName: 'Vendeur', stripeChargesEnabled: true });
    process.env.SHIPPING_ENABLED = 'false';

    const result = await callCreate({
      auth: { uid: 'buyer1' },
      data: {
        articleId: 'art2',
        deliveryType: 'meetup',
        amount: 30,
        meetupSpot: { name: 'Cafe', category: 'public', neighborhood: 'Plateau' },
      },
    });

    expect(result.success).toBe(true);
    const tx = fs.getDoc(`transactions/${result.transactionId as string}`)!;
    expect(tx.status).toBe('meetup_pending');
    expect(tx.shippingCost).toBe(0);
  });

  it('ALLOWS a shipping transaction when SHIPPING_ENABLED is ON', async () => {
    seedArticleAndSeller(50);
    process.env.SHIPPING_ENABLED = 'true';
    shipEngineMock.getRatesImpl = () => [rate('se_rate_real', 14.99)];

    const result = await callCreate({
      auth: { uid: 'buyer1' },
      data: {
        articleId: 'art1',
        deliveryType: 'shipping',
        amount: 50,
        shippingCost: 14.99,
        shippingAddress: VALID_ADDRESS,
        shipEngineRateId: 'se_rate_real',
        chatId: 'chat1',
      },
    });

    expect(result.success).toBe(true);
    expect(fs.getDoc('articles/art1')!.isSold).toBe(true);
  });
});

// ===========================================================================
// F136 — reject a price RAISE mid-checkout not covered by an accepted offer
// ===========================================================================

describe('createTransaction — F136 atomic price re-validation', () => {
  it('rejects when the seller raises the price between pre-read and the transaction', async () => {
    // Buyer sees & pays the listed price (50). At pre-read amount == listedPrice,
    // so the accepted-offer check never runs (negotiatedOfferVerified = false).
    seedArticleAndSeller(50);

    // Mutate the LIVE article price to 80 just before the runTransaction. The
    // re-pricing getRates call sits between the pre-read and the transaction, so
    // we use it as a deterministic hook to simulate the concurrent price raise.
    shipEngineMock.getRatesImpl = () => {
      fs.setDoc('articles/art1', {
        sellerId: 'seller1',
        price: 80, // raised mid-checkout
        isSold: false,
        isActive: true,
        weight: '0.5',
        dimensions: { length: '30', width: '25', height: '10' },
        location: { postalCode: 'H2X 1Y4', city: 'Montreal', province: 'QC' },
      });
      // Re-seed the seller (setDoc replaces the whole doc, not the collection).
      fs.setDoc('users/seller1', {
        displayName: 'Vendeur Test',
        stripeAccountId: 'acct_seller1',
        stripeChargesEnabled: true,
        phoneNumber: '5145559876',
        addresses: [
          { isDefault: true, street: '999 rue du Vendeur', city: 'Montreal', province: 'QC', postalCode: 'H3Z 2Y7' },
        ],
      });
      return [rate('se_rate_real', 14.99)];
    };

    await expect(
      callCreate({
        auth: { uid: 'buyer1' },
        data: {
          articleId: 'art1',
          deliveryType: 'shipping',
          amount: 50, // stale price, no accepted offer
          shippingCost: 14.99,
          shippingAddress: VALID_ADDRESS,
          shipEngineRateId: 'se_rate_real',
          chatId: 'chat1',
        },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Article NOT locked — the stale-price purchase was refused.
    expect(fs.getDoc('articles/art1')!.isSold).toBe(false);
  });
});
