/**
 * Tests for createStripeCheckout mixed wallet+card edge cases.
 *  - F24: when the CARD remainder of a mixed payment would fall below Stripe's
 *         CAD 50¢ minimum, reject BEFORE debiting the wallet (no invalid PI, no
 *         confusing debit/revert round-trip).
 *  - F23: when Stripe PI creation fails, the wallet re-credit AND the
 *         walletAmountUsed/paidVia purge happen in ONE transaction (so no refund
 *         path can later re-credit a phantom wallet portion).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripe: null as ReturnType<typeof import('../utils/testHelpers/firestoreMock').createStripeMock> | null,
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock = createStripeMock();
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

vi.mock('../config/stripe', () => ({
  getStripe: () => holder.stripe!.client,
}));

vi.mock('../config/shipEngine', () => ({
  getShipEngine: () => ({}),
}));

// calculateFees returns a controlled buyerTotal so we can size the card remainder
// precisely. The other fee exports are unused on this path but must exist.
const feeHolder = vi.hoisted(() => ({ buyerTotal: 10 }));
vi.mock('../utils/fees', () => ({
  calculateFees: () => ({
    articlePrice: feeHolder.buyerTotal,
    shippingCost: 0,
    serviceFee: 0,
    serviceFeePercent: 0,
    taxTotal: 0,
    taxGst: 0,
    taxQst: 0,
    sellerPayout: feeHolder.buyerTotal,
    buyerTotal: feeHolder.buyerTotal,
  }),
  calculateServiceFee: () => 0,
  getServiceFeeConfig: () => ({}),
  calculateTaxOnServiceFee: () => 0,
  getTaxConfig: () => ({ enabled: false }),
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

vi.mock('../utils/notifications', () => ({
  sendPushNotification: async () => {},
}));

vi.mock('../utils/refund', () => ({
  issueTransactionRefund: async () => ({ success: true }),
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

import { createStripeCheckout } from './payments';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const call = createStripeCheckout as unknown as CallableHandler;

function seedPending(opts?: { walletBalance?: number }) {
  fs.setDoc('transactions/tx1', {
    buyerId: 'buyer1',
    sellerId: 'seller1',
    status: 'pending_payment',
    amount: feeHolder.buyerTotal,
    shippingCost: 0,
    articleId: 'article1',
  });
  fs.setDoc('wallets/buyer1', {
    balance: opts?.walletBalance ?? 100000,
    pendingBalance: 0,
    status: 'active',
    currency: 'cad',
  });
  fs.setDoc('users/seller1', { stripeAccountId: 'acct_seller1' });
}

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  feeHolder.buyerTotal = 10; // $10 = 1000 cents
});

describe('createStripeCheckout — F24 mixed sub-minimum card remainder', () => {
  it('rejects when the card remainder would be below the 50¢ Stripe minimum (no wallet debit)', async () => {
    seedPending();
    // total = 1000c, wallet = 970c → card remainder = 30c (< 50c).
    await expect(
      call({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1', walletAmount: 970 } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Wallet was NOT debited (guard fired before the debit).
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(100000);
    // No PaymentIntent was created.
    expect(stripeMock.calls.paymentIntentsCreate.length).toBe(0);
  });

  it('allows a mixed payment whose card remainder clears 50¢', async () => {
    seedPending();
    stripeMock.impl.paymentIntentsCreate = async () => ({
      id: 'pi_mixed_ok',
      client_secret: 'pi_mixed_ok_secret',
    });
    // total = 1000c, wallet = 900c → card remainder = 100c (>= 50c) — OK.
    const res = await call({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1', walletAmount: 900 },
    });
    expect(res.success).toBe(true);
    // Wallet debited 900c.
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(99100);
    expect(stripeMock.calls.paymentIntentsCreate.length).toBe(1);
  });
});

describe('createStripeCheckout — F23 atomic revert on Stripe failure', () => {
  it('re-credits the wallet AND purges walletAmountUsed/paidVia atomically', async () => {
    seedPending();
    // PI creation fails → the F05/F23 revert path runs.
    stripeMock.impl.paymentIntentsCreate = async () => {
      throw new Error('card_declined');
    };

    await expect(
      call({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1', walletAmount: 600 } })
    ).rejects.toThrow();

    // Wallet re-credited to its original balance (debited 600, then refunded 600).
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(100000);
    // The transaction's wallet markers were cleared so no later refund path can
    // re-credit a phantom wallet portion (F23).
    const tx = fs.getDoc('transactions/tx1')!;
    expect(tx.walletAmountUsed).toBeUndefined();
    expect(tx.paidVia).toBeUndefined();
  });
});
