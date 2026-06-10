/**
 * Integration-style tests for walletWithdraw GUARDS (critical financial path).
 *
 * Complements callable/wallet.test.ts (which covers the happy path / basic
 * validation) by exercising the safety guards that protect the platform from
 * paying out money that may need to be clawed back. Focus (chantier item 6):
 *  - Refuse withdrawal while ANY of the seller's sales is disputed.
 *  - Refuse withdrawal while the seller carries a sellerDebt.
 *  - Funds in heldBalance are NOT withdrawable (only `balance` is).
 *  - The Stripe transfer + payout carry a deterministic idempotency key.
 *
 * Uses the shared in-memory harness so the disputed-sale query (sellerId + a
 * `disputed == true` filter) resolves against the live store realistically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from '../utils/testHelpers/firestoreMock';

// See webhooks.test.ts for the lazy-holder rationale.
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

vi.mock('../config/shipEngine', () => ({
  getShipEngine: () => null,
}));

vi.mock('../utils/rateLimit', () => ({
  // No-op rate limiter for tests.
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

import { walletWithdraw } from './wallet';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callWithdraw = walletWithdraw as unknown as CallableHandler;

/** Seed a fully payout-enabled seller + active wallet with a withdrawable balance. */
function seedSeller(opts?: {
  balance?: number;
  heldBalance?: number;
  pendingBalance?: number;
  sellerDebt?: number;
}) {
  const { balance = 5000, heldBalance = 0, pendingBalance = 0, sellerDebt = 0 } = opts ?? {};
  fs.setDoc('users/seller1', {
    stripeAccountId: 'acct_seller1',
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeBankAccountLast4: '4242',
  });
  fs.setDoc('wallets/seller1', {
    balance,
    heldBalance,
    pendingBalance,
    sellerDebt,
    status: 'active',
    currency: 'cad',
  });
}

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  stripeMock.impl.transfersCreate = async () => ({ id: 'tr_ok' });
  stripeMock.impl.payoutsCreate = async () => ({ id: 'po_ok' });
});

// ===========================================================================
// 6a. Dispute guard
// ===========================================================================

describe('walletWithdraw — dispute guard', () => {
  it('refuses withdrawal while a sale is disputed', async () => {
    seedSeller({ balance: 5000 });
    // An active dispute on one of the seller's sales.
    fs.setDoc('transactions/txd', {
      sellerId: 'seller1',
      buyerId: 'buyer1',
      status: 'disputed',
      disputed: true,
    });

    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })
    ).rejects.toThrow('litige');

    // No money moved.
    expect(stripeMock.calls.transfersCreate.length).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(5000);
  });

  it('allows withdrawal when the only disputed sale belongs to ANOTHER seller', async () => {
    seedSeller({ balance: 5000 });
    // Disputed sale for a different seller — must not block seller1.
    fs.setDoc('transactions/txd', {
      sellerId: 'someoneElse',
      buyerId: 'buyer1',
      status: 'disputed',
      disputed: true,
    });

    const result = await callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } });
    expect(result.success).toBe(true);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);
  });

  // F10: a meetup no-show dispute is cash-in-hand (no escrow) and must NOT
  // freeze all of a seller's withdrawals — otherwise anyone can grief a seller
  // for free by reporting a no-show on a meetup tx they created.
  it('does NOT block withdrawal when the only disputed sale is a meetup no-show', async () => {
    seedSeller({ balance: 5000 });
    fs.setDoc('transactions/txmeet', {
      sellerId: 'seller1',
      buyerId: 'buyer1',
      status: 'disputed',
      disputed: true,
      deliveryType: 'meetup',
    });

    const result = await callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } });
    expect(result.success).toBe(true);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);
  });

  // A real financial dispute STILL blocks even if a meetup dispute also exists.
  it('blocks when a financial (non-meetup) dispute exists alongside a meetup one', async () => {
    seedSeller({ balance: 5000 });
    fs.setDoc('transactions/txmeet', {
      sellerId: 'seller1',
      buyerId: 'buyer1',
      status: 'disputed',
      disputed: true,
      deliveryType: 'meetup',
    });
    fs.setDoc('transactions/txship', {
      sellerId: 'seller1',
      buyerId: 'buyer2',
      status: 'disputed',
      disputed: true,
      deliveryType: 'shipping',
    });

    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripeMock.calls.transfersCreate.length).toBe(0);
  });
});

// ===========================================================================
// B4. Restricted-account guard (KYC remediation in flight)
// ===========================================================================

describe('walletWithdraw — restricted account guard (B4)', () => {
  it('refuses withdrawal when stripeRequirementsDisabledReason is set (payouts flag still true)', async () => {
    seedSeller({ balance: 5000 });
    // Stripe flagged a disabled_reason but has not yet flipped payouts_enabled.
    fs.setDoc('users/seller1', {
      stripeAccountId: 'acct_seller1',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeAccountStatus: 'restricted',
      stripeRequirementsDisabledReason: 'requirements.past_due',
    });

    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })
    ).rejects.toThrow('restreint');

    // No money moved.
    expect(stripeMock.calls.transfersCreate.length).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(5000);
  });

  it('refuses withdrawal when stripeAccountStatus is restricted (no disabledReason field present)', async () => {
    seedSeller({ balance: 5000 });
    fs.setDoc('users/seller1', {
      stripeAccountId: 'acct_seller1',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeAccountStatus: 'restricted',
    });

    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripeMock.calls.transfersCreate.length).toBe(0);
  });

  it('allows withdrawal for an active account with no restriction markers', async () => {
    seedSeller({ balance: 5000 });
    // seedSeller already sets stripeAccountStatus absent / not restricted.
    const result = await callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } });
    expect(result.success).toBe(true);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);
  });
});

// ===========================================================================
// 6b. sellerDebt guard
// ===========================================================================

describe('walletWithdraw — sellerDebt guard', () => {
  it('refuses withdrawal while the seller carries a debt', async () => {
    seedSeller({ balance: 5000, sellerDebt: 1500 });

    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })
    ).rejects.toThrow('solde dû');

    expect(stripeMock.calls.transfersCreate.length).toBe(0);
  });
});

// ===========================================================================
// 6c. heldBalance is NOT withdrawable
// ===========================================================================

describe('walletWithdraw — heldBalance is non-withdrawable', () => {
  it('refuses an amount that exceeds withdrawable balance even if held funds exist', async () => {
    // balance 1000 (withdrawable), heldBalance 9000 (locked in dispute window).
    seedSeller({ balance: 1000, heldBalance: 9000 });

    // Try to withdraw 5000 — only 1000 is actually withdrawable.
    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 5000 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(
      callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 5000 } })
    ).rejects.toThrow('Solde insuffisant');

    // heldBalance untouched, no transfer.
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(9000);
    expect(stripeMock.calls.transfersCreate.length).toBe(0);
  });

  it('debits only `balance` and never touches heldBalance on a valid withdrawal', async () => {
    seedSeller({ balance: 5000, heldBalance: 3000 });

    const result = await callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } });
    expect(result.success).toBe(true);

    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);
    // heldBalance unchanged.
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(3000);
    expect(fs.sumIncrements('wallets/seller1', 'balance')).toBe(-2000);
    expect(fs.sumIncrements('wallets/seller1', 'heldBalance')).toBe(0);
  });
});

// ===========================================================================
// 6d. Deterministic idempotency keys on transfer + payout
// ===========================================================================

describe('walletWithdraw — idempotency keys present', () => {
  it('passes a deterministic idempotencyKey to transfers.create and payouts.create', async () => {
    seedSeller({ balance: 5000 });

    await callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } });

    expect(stripeMock.calls.transfersCreate.length).toBe(1);
    expect(stripeMock.calls.payoutsCreate.length).toBe(1);

    const transferOpts = stripeMock.calls.transfersCreate[0][1] as Record<string, unknown>;
    expect(transferOpts.idempotencyKey).toMatch(/^tr_/);

    const payoutOpts = stripeMock.calls.payoutsCreate[0][1] as Record<string, unknown>;
    // stripe-node v22: single RequestOptions carries Connect account + key.
    expect(payoutOpts.stripeAccount).toBe('acct_seller1');
    expect(payoutOpts.idempotencyKey).toMatch(/^po_/);

    // Transfer + payout share the same stable ledger-entry suffix (no drift).
    const trKey = transferOpts.idempotencyKey as string;
    const poKey = payoutOpts.idempotencyKey as string;
    expect(trKey.replace(/^tr_/, '')).toBe(poKey.replace(/^po_/, ''));

    // A withdrawal_requests doc was created in 'processing'.
    const wrWrite = fs.writeOps.find(
      (op) => op.path.startsWith('withdrawal_requests/') && op.data.status === 'processing'
    );
    expect(wrWrite).toBeDefined();
    expect(wrWrite!.data.amount).toBe(2000);
  });
});
