/**
 * Tests for confirmSwapReception race-safety (F54).
 *
 * When BOTH parties confirm reception, the swap completes and the top-up
 * complement moves pending -> held on the payee wallet EXACTLY once. Two
 * sequential confirmations (the realistic serialization of concurrent ones via
 * Firestore optimistic concurrency) must NOT double-move the funds: the second
 * confirmation re-reads the swap, sees status='completed' (no longer 'shipping'),
 * and fails its status guard — a no-op for the money move.
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

vi.mock('./wallet', () => ({
  getOrCreateSellerWallet: async (tx: any, sellerId: string) => {
    const walletRef = holder.fs!.db.collection('wallets').doc(sellerId);
    const snap = await tx.get(walletRef);
    if (snap.exists) {
      return { walletRef, walletData: snap.data()!, isNew: false };
    }
    const newWallet = { balance: 0, pendingBalance: 0, heldBalance: 0 };
    tx.set(walletRef, newWallet);
    return { walletRef, walletData: newWallet, isNew: true };
  },
}));

vi.mock('./reviews', () => ({
  updateUserRating: async () => {},
}));

vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: (request: { auth?: { uid?: string } }) => ({
    callerKey: request.auth?.uid ?? 'anon',
    isAuthenticated: !!request.auth,
  }),
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

import { confirmSwapReception } from './swaps';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callConfirm = confirmSwapReception as unknown as CallableHandler;

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
});

function seedShippingSwap() {
  fs.setDoc('swaps/s1', {
    initiatorId: 'P', // payer
    receiverId: 'Q', // payee
    initiatorItems: [{ articleId: 'a1' }],
    receiverItems: [{ articleId: 'a2' }],
    cashTopUp: { amount: 5000, payerId: 'P' },
    topUpPaymentIntentId: 'pi_1',
    topUpPaidAt: { __ts: true },
    status: 'shipping',
  });
  // Payee wallet holds the top-up complement in pendingBalance (escrow).
  fs.setDoc('wallets/Q', { balance: 0, pendingBalance: 5000, heldBalance: 0, status: 'active' });
}

describe('confirmSwapReception — race-safe pending -> held (F54)', () => {
  it('moves the top-up complement pending -> held exactly once when both confirm', async () => {
    seedShippingSwap();

    // First party (payer P) confirms — not both yet, no money move.
    await callConfirm({ auth: { uid: 'P' }, data: { swapId: 's1' } });
    expect(fs.getDoc('wallets/Q')!.pendingBalance).toBe(5000);
    expect(fs.getDoc('wallets/Q')!.heldBalance).toBe(0);
    expect(fs.getDoc('swaps/s1')!.status).toBe('shipping');

    // Second party (payee Q) confirms — both received → completed + pending->held.
    await callConfirm({ auth: { uid: 'Q' }, data: { swapId: 's1' } });
    expect(fs.getDoc('swaps/s1')!.status).toBe('completed');
    expect(fs.getDoc('wallets/Q')!.pendingBalance).toBe(0);
    expect(fs.getDoc('wallets/Q')!.heldBalance).toBe(5000);
  });

  it('a duplicate confirmation after completion is a no-op (no double held move)', async () => {
    seedShippingSwap();
    await callConfirm({ auth: { uid: 'P' }, data: { swapId: 's1' } });
    await callConfirm({ auth: { uid: 'Q' }, data: { swapId: 's1' } });
    expect(fs.getDoc('wallets/Q')!.heldBalance).toBe(5000);

    // A stale/duplicate confirmation re-reads status='completed' and is rejected
    // by the status guard — heldBalance must NOT move again.
    await expect(
      callConfirm({ auth: { uid: 'P' }, data: { swapId: 's1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('wallets/Q')!.heldBalance).toBe(5000);
    expect(fs.getDoc('wallets/Q')!.pendingBalance).toBe(0);
  });
});
