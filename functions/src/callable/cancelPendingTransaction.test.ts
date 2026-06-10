/**
 * Tests for cancelPendingTransaction — F73 (double-credit wallet).
 *
 * A mixed wallet+card 'pending_payment' transaction holds an uncaptured Stripe
 * PaymentIntent whose clientSecret the buyer still controls. Cancelling must:
 *   1. cancel the PaymentIntent so no late capture is possible, AND
 *   2. purge walletAmountUsed/paidVia so that even if the card DOES capture late
 *      (race), issueTransactionRefund cannot re-credit the wallet a 2nd time.
 *
 * Both guards are exercised here, plus the no-double-credit proof: after a
 * cancel, simulating a late PI.succeeded -> issueTransactionRefund path must NOT
 * find a wallet portion to re-credit.
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

vi.mock('../utils/fees', () => ({
  calculateFees: () => ({}),
  calculateServiceFee: () => 0,
  getServiceFeeConfig: () => ({}),
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

// issueTransactionRefund is mocked so we can drive the "late capture" path and
// assert the wallet portion it computes from the (now purged) transaction.
const refundMock = vi.hoisted(() => ({ lastWalletPortion: null as number | null }));
vi.mock('../utils/refund', () => ({
  issueTransactionRefund: async (
    _txId: string,
    preData: Record<string, unknown>
  ) => {
    const walletAmountUsed =
      typeof preData.walletAmountUsed === 'number' ? preData.walletAmountUsed : 0;
    const paidVia = preData.paidVia;
    const hasWalletPortion =
      walletAmountUsed > 0 &&
      (paidVia === 'wallet' || paidVia === 'wallet_and_card' || paidVia === 'mixed');
    refundMock.lastWalletPortion = hasWalletPortion ? walletAmountUsed : 0;
    return { success: true };
  },
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

import { cancelPendingTransaction } from './payments';
import { issueTransactionRefund } from '../utils/refund';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callCancel = cancelPendingTransaction as unknown as CallableHandler;

function seedMixedPending(opts?: { piStatus?: string; walletCents?: number }) {
  const { walletCents = 3000 } = opts ?? {};
  fs.setDoc('transactions/tx1', {
    buyerId: 'buyer1',
    sellerId: 'seller1',
    status: 'pending_payment',
    totalAmount: 50,
    walletAmountUsed: walletCents,
    paidVia: 'wallet_and_card',
    stripePaymentIntentId: 'pi_123',
    articleId: 'article1',
  });
  fs.setDoc('wallets/buyer1', {
    balance: 0,
    pendingBalance: 0,
    status: 'active',
    currency: 'cad',
  });
  fs.setDoc('articles/article1', { isSold: true });
}

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  refundMock.lastWalletPortion = null;
  // Default: PI is cancelable (not captured / in flight).
  stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'requires_payment_method' });
  stripeMock.impl.paymentIntentsCancel = async () => ({ id: 'pi_123', status: 'canceled' });
});

describe('cancelPendingTransaction — F73 PI cancel + wallet purge', () => {
  it('requires authentication', async () => {
    await expect(
      callCancel({ auth: null, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('cancels the Stripe PaymentIntent for a mixed pending_payment tx', async () => {
    seedMixedPending();

    const result = await callCancel({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });
    expect(result.success).toBe(true);

    expect(stripeMock.calls.paymentIntentsRetrieve.length).toBe(1);
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(1);
    expect(stripeMock.calls.paymentIntentsCancel[0][0]).toBe('pi_123');
  });

  it('purges walletAmountUsed and paidVia after refunding the wallet portion', async () => {
    seedMixedPending({ walletCents: 3000 });

    await callCancel({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } });

    // Wallet re-credited exactly once.
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(3000);

    // The transaction no longer carries the wallet markers.
    const tx = fs.getDoc('transactions/tx1')!;
    expect(tx.status).toBe('cancelled');
    expect(tx.walletAmountUsed).toBeUndefined();
    expect(tx.paidVia).toBeUndefined();
  });

  it('NO double-credit: a late PI capture after cancel finds no wallet portion', async () => {
    seedMixedPending({ walletCents: 3000 });

    await callCancel({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } });

    // Simulate the webhook "cancelled_needs_refund" path: it reads the (now
    // purged) transaction and calls issueTransactionRefund with that data.
    const purged = fs.getDoc('transactions/tx1')!;
    await issueTransactionRefund('tx1', { ...purged, stripePaymentIntentId: 'pi_123' }, {
      reason: 'cancelled_payment_succeeded_late',
      idempotencyKey: 'rf_tx1',
    } as never);

    // The refund path must NOT re-credit any wallet portion (it was purged).
    expect(refundMock.lastWalletPortion).toBe(0);

    // And the wallet balance is still credited exactly once across everything.
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(3000);
  });

  it('refuses to cancel when the PaymentIntent is already captured (succeeded)', async () => {
    seedMixedPending();
    stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'succeeded' });

    await expect(
      callCancel({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Must NOT cancel, must NOT refund the wallet (the card is captured).
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(0);
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(0);
    expect(fs.getDoc('transactions/tx1')!.status).toBe('pending_payment');
  });

  it('does not cancel a PI that is already canceled (idempotent)', async () => {
    seedMixedPending();
    stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'canceled' });

    const result = await callCancel({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });
    expect(result.success).toBe(true);
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(0);
    // Wallet still refunded.
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(3000);
  });

  it('aborts (no wallet refund) when PI cancel throws', async () => {
    seedMixedPending();
    stripeMock.impl.paymentIntentsCancel = async () => {
      throw new Error('PI just succeeded, cannot cancel');
    };

    await expect(
      callCancel({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(0);
    expect(fs.getDoc('transactions/tx1')!.status).toBe('pending_payment');
  });

  it('cancelling twice does not double-credit the wallet', async () => {
    seedMixedPending({ walletCents: 3000 });

    await callCancel({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } });
    // Second call: status is now 'cancelled' -> not in cancellableStatuses.
    await expect(
      callCancel({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(3000);
  });

  it('cancels a card-only pending_payment without crediting any wallet', async () => {
    fs.setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 50,
      paidVia: 'card',
      stripePaymentIntentId: 'pi_card',
      articleId: 'article1',
    });
    fs.setDoc('wallets/buyer1', { balance: 0, status: 'active' });
    fs.setDoc('articles/article1', { isSold: true });

    const result = await callCancel({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });
    expect(result.success).toBe(true);
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(1);
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(0);
    // No wallet markers to purge on a card-only tx.
    const tx = fs.getDoc('transactions/tx1')!;
    expect(tx.status).toBe('cancelled');
  });

  it('cancels a meetup_pending (no PaymentIntent) with no Stripe call', async () => {
    fs.setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'meetup_pending',
      totalAmount: 50,
      articleId: 'article1',
    });
    fs.setDoc('articles/article1', { isSold: true });

    const result = await callCancel({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });
    expect(result.success).toBe(true);
    expect(stripeMock.calls.paymentIntentsRetrieve.length).toBe(0);
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(0);
  });
});
