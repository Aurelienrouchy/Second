/**
 * Tests for expireStalePostAcceptanceSwaps (wave 5, F51/F52).
 *
 * Unwinds money-bearing swaps stuck in accepted/photos_pending/shipping after
 * the 14-day delay: refunds the paid top-up (idempotent rf_swap_${id}), releases
 * swapPartyItems, transitions to 'expired'. Idempotent: a swap whose status moved
 * on between the query and the per-swap transaction is skipped (no refund).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripe: null as StripeMock | null,
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock: StripeMock = createStripeMock();
holder.fs = fs;
holder.stripe = stripeMock;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    fromMillis: (ms: number) => ({ toMillis: () => ms, __ts: true }),
  },
}));

vi.mock('../config/stripe', () => ({
  getStripe: () => holder.stripe!.client,
}));

vi.mock('../utils/fees', () => ({
  calculateFees: () => ({ serviceFee: 0, serviceFeePercent: 0, buyerTotal: 0 }),
}));

vi.mock('../callable/wallet', () => ({
  getOrCreateSellerWallet: async () => ({ walletRef: null, walletData: {}, isNew: false }),
}));

vi.mock('../callable/reviews', () => ({
  updateUserRating: async () => {},
}));

vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: () => ({ callerKey: 'x', isAuthenticated: true }),
}));

vi.mock('../utils/notifications', () => ({
  sendPushNotification: async () => {},
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
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

import { expireStalePostAcceptanceSwaps } from './swaps';

type Scheduled = () => Promise<void>;
const run = expireStalePostAcceptanceSwaps as unknown as Scheduled;

const OLD = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); // 15 days ago

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  process.env.STRIPE_SECRET_KEY = 'sk_test';
});

describe('expireStalePostAcceptanceSwaps', () => {
  it('expires a stale paid swap, refunds the top-up (idempotent key) and frees items', async () => {
    fs.setDoc('swaps/s1', {
      initiatorId: 'P',
      receiverId: 'Q',
      initiatorItems: [{ articleId: 'a1' }],
      receiverItems: [{ articleId: 'a2' }],
      partyId: 'generalist',
      cashTopUp: { amount: 5000, payerId: 'P' },
      topUpPaymentIntentId: 'pi_1',
      topUpPaidAt: { __ts: true },
      status: 'accepted',
      updatedAt: OLD,
    });
    // swapPartyItems locked by the swap (isPending: true).
    fs.setDoc('swapPartyItems/i1', {
      partyId: 'generalist',
      articleId: 'a1',
      sellerId: 'P',
      isPending: true,
    });
    fs.setDoc('swapPartyItems/i2', {
      partyId: 'generalist',
      articleId: 'a2',
      sellerId: 'Q',
      isPending: true,
    });

    await run();

    const swap = fs.getDoc('swaps/s1')!;
    expect(swap.status).toBe('expired');
    expect(swap.cancelReason).toBe('post_acceptance_expired_14d_from_accepted');
    // Refund issued exactly once with the deterministic swap key.
    expect(stripeMock.calls.refundsCreate.length).toBe(1);
    const [, opts] = stripeMock.calls.refundsCreate[0] as [unknown, { idempotencyKey: string }];
    expect(opts.idempotencyKey).toBe('rf_swap_s1');
    // Items released.
    expect(fs.getDoc('swapPartyItems/i1')!.isPending).toBe(false);
    expect(fs.getDoc('swapPartyItems/i2')!.isPending).toBe(false);
  });

  it('does not refund a never-paid stale swap', async () => {
    fs.setDoc('swaps/s2', {
      initiatorId: 'P',
      receiverId: 'Q',
      initiatorItems: [{ articleId: 'a1' }],
      receiverItems: [{ articleId: 'a2' }],
      status: 'photos_pending',
      // no cashTopUp / topUpPaidAt
      updatedAt: OLD,
    });

    await run();

    expect(fs.getDoc('swaps/s2')!.status).toBe('expired');
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
  });

  it('leaves recent swaps untouched (within the 14-day window)', async () => {
    fs.setDoc('swaps/s3', {
      initiatorId: 'P',
      receiverId: 'Q',
      initiatorItems: [{ articleId: 'a1' }],
      receiverItems: [{ articleId: 'a2' }],
      status: 'shipping',
      updatedAt: new Date(), // now
    });

    await run();

    expect(fs.getDoc('swaps/s3')!.status).toBe('shipping');
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
  });

  it('does not touch a disputed swap (only accepted/photos_pending/shipping)', async () => {
    fs.setDoc('swaps/s4', {
      initiatorId: 'P',
      receiverId: 'Q',
      initiatorItems: [{ articleId: 'a1' }],
      receiverItems: [{ articleId: 'a2' }],
      cashTopUp: { amount: 5000, payerId: 'P' },
      topUpPaymentIntentId: 'pi_1',
      topUpPaidAt: { __ts: true },
      status: 'disputed',
      updatedAt: OLD,
    });

    await run();

    expect(fs.getDoc('swaps/s4')!.status).toBe('disputed');
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
  });
});
