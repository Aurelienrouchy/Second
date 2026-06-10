/**
 * Tests for the SWAP DISPUTE RESOLUTION RAIL added in wave 5 (callable/swaps.ts):
 *
 *  - openSwapDispute (F48 hardened): freezes the swap (NO auto-refund), accepts
 *    accepted/photos_pending/shipping/completed(in-window), bounds the post-
 *    completion window (rejects once topUpReleasedAt set), single dispute.
 *  - resolveSwapDispute (F48): admin-only double guard. refund_payer issues the
 *    idempotent Stripe refund + releases articles + cancels; release_payee moves
 *    the payee complement to withdrawable balance + marks articles sold +
 *    completes. Rejects a non-disputed swap (idempotent on replay).
 *
 * Uses the shared in-memory harness. getOrCreateSellerWallet is mocked to operate
 * on the same mock transaction so wallet bucket moves are asserted on the
 * committed store.
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

// getOrCreateSellerWallet operates on the SAME mock transaction so bucket moves
// are real (asserted on the committed store).
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

import { openSwapDispute, resolveSwapDispute } from './swaps';

type CallableHandler = (request: {
  auth?: { uid: string; token?: Record<string, unknown> } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

const callOpen = openSwapDispute as unknown as CallableHandler;
const callResolve = resolveSwapDispute as unknown as CallableHandler;

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  process.env.STRIPE_SECRET_KEY = 'sk_test';
});

function seedAdmin(uid = 'admin1') {
  fs.setDoc(`users/${uid}`, { isAdmin: true });
}

// Base top-up swap (payer = initiator 'P', payee = receiver 'Q').
function seedSwap(id: string, overrides: Record<string, unknown> = {}) {
  fs.setDoc(`swaps/${id}`, {
    initiatorId: 'P',
    receiverId: 'Q',
    initiatorItems: [{ articleId: 'a1', title: 'A1' }],
    receiverItems: [{ articleId: 'a2', title: 'A2' }],
    cashTopUp: { amount: 5000, payerId: 'P' },
    topUpPaymentIntentId: 'pi_1',
    topUpPaidAt: { __ts: true },
    status: 'shipping',
    ...overrides,
  });
}

// ===========================================================================
// openSwapDispute — hardening (F48 / F51)
// ===========================================================================

describe('openSwapDispute — guards', () => {
  it('requires authentication', async () => {
    await expect(callOpen({ auth: null, data: { swapId: 's1', reason: 'x' } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects a non-participant', async () => {
    seedSwap('s1');
    await expect(
      callOpen({ auth: { uid: 'stranger' }, data: { swapId: 's1', reason: 'x' } })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('accepts a dispute from accepted (F51 — payer stranded post-payment)', async () => {
    seedSwap('s1', { status: 'accepted' });
    const res = await callOpen({ auth: { uid: 'P' }, data: { swapId: 's1', reason: 'silence' } });
    expect(res.success).toBe(true);
    expect(fs.getDoc('swaps/s1')!.status).toBe('disputed');
    expect(fs.getDoc('swaps/s1')!.statusBeforeDispute).toBe('accepted');
  });

  it('does NOT auto-refund on open (freeze only — closes the exploit)', async () => {
    seedSwap('s1', { status: 'completed', topUpFundsHeldAt: { __ts: true } });
    await callOpen({ auth: { uid: 'P' }, data: { swapId: 's1', reason: 'item not as described' } });
    expect(fs.getDoc('swaps/s1')!.status).toBe('disputed');
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
  });

  it('rejects a dispute after the window (topUpReleasedAt set)', async () => {
    seedSwap('s1', { status: 'completed', topUpReleasedAt: { __ts: true } });
    await expect(
      callOpen({ auth: { uid: 'P' }, data: { swapId: 's1', reason: 'late' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects re-opening an already disputed swap (single dispute)', async () => {
    seedSwap('s1', { status: 'disputed' });
    await expect(
      callOpen({ auth: { uid: 'P' }, data: { swapId: 's1', reason: 'again' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

// ===========================================================================
// resolveSwapDispute — admin guard
// ===========================================================================

describe('resolveSwapDispute — auth', () => {
  it('requires authentication', async () => {
    await expect(
      callResolve({ auth: null, data: { swapId: 's1', issue: 'refund_payer' } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses a non-admin caller', async () => {
    fs.setDoc('users/u1', { isAdmin: false });
    seedSwap('s1', { status: 'disputed' });
    await expect(
      callResolve({ auth: { uid: 'u1', token: {} }, data: { swapId: 's1', issue: 'refund_payer' } })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects an invalid issue', async () => {
    seedSwap('s1', { status: 'disputed' });
    await expect(
      callResolve({ auth: { uid: 'admin1', token: { admin: true } }, data: { swapId: 's1', issue: 'nope' } })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects resolving a non-disputed swap', async () => {
    seedSwap('s1', { status: 'shipping' });
    await expect(
      callResolve({
        auth: { uid: 'admin1', token: { admin: true } },
        data: { swapId: 's1', issue: 'refund_payer' },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

// ===========================================================================
// resolveSwapDispute — refund_payer
// ===========================================================================

describe('resolveSwapDispute — refund_payer', () => {
  it('refunds the payer (idempotent key) and cancels the swap', async () => {
    seedSwap('s1', { status: 'disputed', partyId: undefined });
    const res = await callResolve({
      auth: { uid: 'admin1', token: { admin: true } },
      data: { swapId: 's1', issue: 'refund_payer' },
    });
    expect(res.success).toBe(true);
    expect(fs.getDoc('swaps/s1')!.status).toBe('cancelled');
    expect(fs.getDoc('swaps/s1')!.disputeOutcome).toBe('refund_payer');
    // Stripe refund issued exactly once with the deterministic swap key.
    expect(stripeMock.calls.refundsCreate.length).toBe(1);
    const [, opts] = stripeMock.calls.refundsCreate[0] as [unknown, { idempotencyKey: string }];
    expect(opts.idempotencyKey).toBe('rf_swap_s1');
  });

  it('does NOT mark articles sold on refund_payer', async () => {
    fs.setDoc('articles/a1', { sellerId: 'P', isSold: false });
    fs.setDoc('articles/a2', { sellerId: 'Q', isSold: false });
    seedSwap('s1', { status: 'disputed' });
    await callResolve({
      auth: { uid: 'admin1', token: { admin: true } },
      data: { swapId: 's1', issue: 'refund_payer' },
    });
    expect(fs.getDoc('articles/a1')!.isSold).toBe(false);
    expect(fs.getDoc('articles/a2')!.isSold).toBe(false);
  });
});

// ===========================================================================
// resolveSwapDispute — release_payee
// ===========================================================================

describe('resolveSwapDispute — release_payee', () => {
  it('moves the held complement to withdrawable balance + completes + marks sold', async () => {
    // Payee Q has the 5000c complement in heldBalance (post-reception, in window).
    fs.setDoc('wallets/Q', { balance: 0, pendingBalance: 0, heldBalance: 5000 });
    fs.setDoc('articles/a1', { sellerId: 'P', isSold: false });
    fs.setDoc('articles/a2', { sellerId: 'Q', isSold: false });
    seedSwap('s1', { status: 'disputed', topUpFundsHeldAt: { __ts: true } });

    const res = await callResolve({
      auth: { uid: 'admin1', token: { admin: true } },
      data: { swapId: 's1', issue: 'release_payee' },
    });

    expect(res.success).toBe(true);
    expect(res.movedCents).toBe(5000);
    const wallet = fs.getDoc('wallets/Q')!;
    expect(wallet.heldBalance).toBe(0);
    expect(wallet.balance).toBe(5000);
    const swap = fs.getDoc('swaps/s1')!;
    expect(swap.status).toBe('completed');
    expect(swap.topUpReleasedAt).toBeTruthy();
    expect(fs.getDoc('articles/a1')!.isSold).toBe(true);
    expect(fs.getDoc('articles/a2')!.isSold).toBe(true);
  });

  it('drains from pendingBalance when funds never reached held (pre-reception dispute)', async () => {
    // Pre-reception: complement still in pendingBalance, no topUpFundsHeldAt.
    fs.setDoc('wallets/Q', { balance: 0, pendingBalance: 5000, heldBalance: 0 });
    seedSwap('s1', { status: 'disputed', statusBeforeDispute: 'accepted' });

    const res = await callResolve({
      auth: { uid: 'admin1', token: { admin: true } },
      data: { swapId: 's1', issue: 'release_payee' },
    });

    expect(res.movedCents).toBe(5000);
    const wallet = fs.getDoc('wallets/Q')!;
    expect(wallet.pendingBalance).toBe(0);
    expect(wallet.balance).toBe(5000);
  });

  it('does not issue a Stripe refund on release_payee', async () => {
    fs.setDoc('wallets/Q', { balance: 0, pendingBalance: 0, heldBalance: 5000 });
    seedSwap('s1', { status: 'disputed', topUpFundsHeldAt: { __ts: true } });
    await callResolve({
      auth: { uid: 'admin1', token: { admin: true } },
      data: { swapId: 's1', issue: 'release_payee' },
    });
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
  });
});

// ===========================================================================
// resolveSwapDispute — idempotence (no double payout / refund on replay)
// ===========================================================================

describe('resolveSwapDispute — idempotence', () => {
  it('rejects a second resolution (swap no longer disputed)', async () => {
    fs.setDoc('wallets/Q', { balance: 0, pendingBalance: 0, heldBalance: 5000 });
    seedSwap('s1', { status: 'disputed', topUpFundsHeldAt: { __ts: true } });

    await callResolve({
      auth: { uid: 'admin1', token: { admin: true } },
      data: { swapId: 's1', issue: 'release_payee' },
    });
    // Replay must fail the precondition (status is now 'completed').
    await expect(
      callResolve({
        auth: { uid: 'admin1', token: { admin: true } },
        data: { swapId: 's1', issue: 'release_payee' },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Balance moved exactly once.
    expect(fs.getDoc('wallets/Q')!.balance).toBe(5000);
  });
});

// Silence unused warning for the admin seeder (used via token claim in most tests).
void seedAdmin;
