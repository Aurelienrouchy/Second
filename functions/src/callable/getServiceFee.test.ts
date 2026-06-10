/**
 * Tests for getServiceFee (F96 — honest paid-shop buyer-fee reduction).
 *
 * getServiceFee is a display-only callable. F96: when given the articleId it now
 * resolves the SELLER's active shop tier reduction server-side (same authority as
 * createTransaction/createStripeCheckout) so the displayed fee matches the charge.
 * Without articleId, or with no active shop tier, it returns the full fee.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
}));

const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

vi.mock('../config/stripe', () => ({ getStripe: () => ({}) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({}) }));

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

vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../utils/refund', () => ({ issueTransactionRefund: async () => ({ success: true }) }));

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

import { getServiceFee } from './payments';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const call = getServiceFee as unknown as CallableHandler;

function inMonths(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
}

beforeEach(() => {
  fs.reset();
});

describe('getServiceFee — F96 paid-shop reduction', () => {
  it('returns the FULL fee when no articleId is provided (legacy)', async () => {
    const res = await call({ auth: { uid: 'u1' }, data: { articlePrice: 50 } });
    // 50$ → 50*0.05 + 1.50 = 4.00 (>= 2.00 min).
    expect(res.serviceFee).toBe(4.0);
    expect(res.feeReduction).toBe(0);
  });

  it('applies the pro (50%) reduction when the seller has an ACTIVE pro shop', async () => {
    fs.setDoc('articles/art1', { sellerId: 'seller1', shopId: 'shop1', price: 50 });
    fs.setDoc('shops/shop1', {
      ownerId: 'seller1',
      status: 'approved',
      tier: 'pro',
      tierPaidUntil: inMonths(3),
    });

    const res = await call({ auth: { uid: 'u1' }, data: { articlePrice: 50, articleId: 'art1' } });
    // Full 4.00 → pro reduction 0.5 → 2.00.
    expect(res.serviceFee).toBe(2.0);
    expect(res.feeReduction).toBe(0.5);
  });

  it('ignores an EXPIRED shop tier → full fee', async () => {
    fs.setDoc('articles/art1', { sellerId: 'seller1', shopId: 'shop1', price: 50 });
    fs.setDoc('shops/shop1', {
      ownerId: 'seller1',
      status: 'approved',
      tier: 'premium',
      tierPaidUntil: inMonths(-1),
    });

    const res = await call({ auth: { uid: 'u1' }, data: { articlePrice: 50, articleId: 'art1' } });
    expect(res.serviceFee).toBe(4.0);
    expect(res.feeReduction).toBe(0);
  });

  it('returns the full fee when the article is missing', async () => {
    const res = await call({ auth: { uid: 'u1' }, data: { articlePrice: 50, articleId: 'ghost' } });
    expect(res.serviceFee).toBe(4.0);
    expect(res.feeReduction).toBe(0);
  });

  it('rejects a missing/invalid articlePrice', async () => {
    await expect(call({ auth: { uid: 'u1' }, data: {} })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});
