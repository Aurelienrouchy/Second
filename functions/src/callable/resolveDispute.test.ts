/**
 * Tests for the RESOLUTION RAIL added in wave 4 (payments.ts):
 *
 *  - resolveDispute (F27/F88 + F10 + F26): admin-only close in favor of the
 *    seller WITHOUT a refund. Closes the linked dispute doc(s), restores
 *    statusBeforeDispute, clears `disputed`, releases any disputeFreezeCents from
 *    heldBalance -> balance (F37).
 *  - adminRefundTransaction (F27/F88): marks linked OPEN disputes 'resolved' so
 *    the admin list + deletion gate stop seeing them.
 *  - sellerCancelTransaction (F74): seller-only refund of a paid/label_created
 *    order before the first carrier scan; refused once 'shipped'.
 *
 * Uses the shared in-memory harness so the disputes query + wallet cascade run
 * against a realistic live store.
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

// issueTransactionRefund is mocked: it records the call args and performs the
// minimal side effect (mark the tx 'refunded', relist the article) so the
// adminRefundTransaction dispute-closing + sellerCancel relist can be asserted.
const refundMock = vi.hoisted(() => ({
  calls: [] as Array<{ txId: string; opts: Record<string, unknown> }>,
}));
vi.mock('../utils/refund', () => ({
  issueTransactionRefund: async (
    txId: string,
    preData: Record<string, unknown>,
    opts: Record<string, unknown>
  ) => {
    refundMock.calls.push({ txId, opts });
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

import { resolveDispute, adminRefundTransaction, sellerCancelTransaction } from './payments';

type CallableHandler = (request: {
  auth?: { uid: string; token?: Record<string, unknown> } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

const callResolve = resolveDispute as unknown as CallableHandler;
const callAdminRefund = adminRefundTransaction as unknown as CallableHandler;
const callSellerCancel = sellerCancelTransaction as unknown as CallableHandler;

function seedAdmin(uid = 'admin1') {
  fs.setDoc(`users/${uid}`, { isAdmin: true });
}

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  refundMock.calls.length = 0;
  process.env.STRIPE_SECRET_KEY = 'sk_test';
});

// ===========================================================================
// resolveDispute — admin guard
// ===========================================================================

describe('resolveDispute — auth', () => {
  it('requires authentication', async () => {
    await expect(
      callResolve({ auth: null, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses a non-admin caller', async () => {
    fs.setDoc('users/u1', { isAdmin: false });
    fs.setDoc('transactions/tx1', { status: 'disputed', sellerId: 's1', buyerId: 'b1' });
    await expect(
      callResolve({ auth: { uid: 'u1', token: {} }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('accepts an admin via custom claim', async () => {
    fs.setDoc('transactions/tx1', {
      status: 'disputed',
      statusBeforeDispute: 'meetup_pending',
      sellerId: 's1',
      buyerId: 'b1',
      deliveryType: 'meetup',
    });
    const res = await callResolve({
      auth: { uid: 'admin1', token: { admin: true } },
      data: { transactionId: 'tx1' },
    });
    expect(res.success).toBe(true);
  });
});

// ===========================================================================
// resolveDispute — meetup no-show (no escrow)
// ===========================================================================

describe('resolveDispute — meetup no-show', () => {
  it('restores statusBeforeDispute, clears disputed, closes the dispute doc', async () => {
    seedAdmin();
    fs.setDoc('transactions/tx1', {
      status: 'disputed',
      statusBeforeDispute: 'meetup_confirmed',
      sellerId: 's1',
      buyerId: 'b1',
      deliveryType: 'meetup',
    });
    fs.setDoc('disputes/d1', {
      transactionId: 'tx1',
      status: 'open',
      type: 'meetup_no_show',
    });

    const res = await callResolve({
      auth: { uid: 'admin1', token: {} },
      data: { transactionId: 'tx1', note: 'no proof of no-show' },
    });

    expect(res.success).toBe(true);
    expect(res.restored).toBe('meetup_confirmed');
    expect(res.disputesClosed).toBe(1);

    const tx = fs.getDoc('transactions/tx1')!;
    expect(tx.status).toBe('meetup_confirmed');
    expect(tx.disputed).toBe(false);
    expect(tx.disputeOutcome).toBe('dismissed');

    const dispute = fs.getDoc('disputes/d1')!;
    expect(dispute.status).toBe('resolved');
    expect(dispute.resolution).toBe('dismissed');
    expect(dispute.resolvedBy).toBe('admin1');

    // No escrow for a meetup → no wallet movement.
    expect(fs.countWrites((op) => op.path.startsWith('wallets/'))).toBe(0);
  });
});

// ===========================================================================
// resolveDispute — chargeback hold release (F37)
// ===========================================================================

describe('resolveDispute — releases the chargeback hold', () => {
  it('moves disputeFreezeCents from heldBalance back to balance', async () => {
    seedAdmin();
    fs.setDoc('transactions/tx1', {
      status: 'disputed',
      statusBeforeDispute: 'delivered',
      sellerId: 's1',
      buyerId: 'b1',
      deliveryType: 'shipping',
      disputeFreezeCents: 4000,
    });
    fs.setDoc('wallets/s1', {
      balance: 1000,
      heldBalance: 4000,
      pendingBalance: 0,
      status: 'active',
    });

    const res = await callResolve({
      auth: { uid: 'admin1', token: {} },
      data: { transactionId: 'tx1' },
    });

    expect(res.releasedCents).toBe(4000);
    const w = fs.getDoc('wallets/s1')!;
    expect(w.heldBalance).toBe(0);
    expect(w.balance).toBe(5000);

    const tx = fs.getDoc('transactions/tx1')!;
    expect(tx.status).toBe('delivered');
    expect(tx.disputed).toBe(false);
    expect(tx.disputeFreezeCents).toBe(0);
  });

  it('caps the release to whatever is actually in heldBalance', async () => {
    seedAdmin();
    fs.setDoc('transactions/tx1', {
      status: 'disputed',
      statusBeforeDispute: 'delivered',
      sellerId: 's1',
      buyerId: 'b1',
      disputeFreezeCents: 4000,
    });
    // Only 1500 is actually held (the rest drained elsewhere).
    fs.setDoc('wallets/s1', { balance: 0, heldBalance: 1500, status: 'active' });

    const res = await callResolve({ auth: { uid: 'admin1', token: {} }, data: { transactionId: 'tx1' } });
    expect(res.releasedCents).toBe(1500);
    expect(fs.getDoc('wallets/s1')!.heldBalance).toBe(0);
    expect(fs.getDoc('wallets/s1')!.balance).toBe(1500);
  });
});

// ===========================================================================
// resolveDispute — return leg
// ===========================================================================

describe('resolveDispute — return leg', () => {
  it('resolves a return_requested in favor of the seller (no freeze to release)', async () => {
    seedAdmin();
    fs.setDoc('transactions/tx1', {
      status: 'return_requested',
      statusBeforeDispute: 'delivered',
      sellerId: 's1',
      buyerId: 'b1',
      disputed: true,
    });
    fs.setDoc('disputes/d1', {
      transactionId: 'tx1',
      status: 'open',
      type: 'return_not_delivered',
    });

    const res = await callResolve({ auth: { uid: 'admin1', token: {} }, data: { transactionId: 'tx1' } });
    expect(res.success).toBe(true);
    expect(res.restored).toBe('delivered');
    expect(fs.getDoc('transactions/tx1')!.disputed).toBe(false);
    expect(fs.getDoc('disputes/d1')!.status).toBe('resolved');
  });
});

// ===========================================================================
// resolveDispute — status precondition
// ===========================================================================

describe('resolveDispute — precondition', () => {
  it('refuses a transaction that is not disputed/return_requested', async () => {
    seedAdmin();
    fs.setDoc('transactions/tx1', { status: 'delivered', sellerId: 's1', buyerId: 'b1' });
    await expect(
      callResolve({ auth: { uid: 'admin1', token: {} }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('refuses a missing transaction', async () => {
    seedAdmin();
    await expect(
      callResolve({ auth: { uid: 'admin1', token: {} }, data: { transactionId: 'nope' } })
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

// ===========================================================================
// adminRefundTransaction — closes the linked dispute (F27/F88)
// ===========================================================================

describe('adminRefundTransaction — closes linked disputes', () => {
  it('marks the linked OPEN dispute resolved after refunding', async () => {
    seedAdmin();
    fs.setDoc('transactions/tx1', {
      status: 'disputed',
      sellerId: 's1',
      buyerId: 'b1',
      totalAmount: 50,
      stripePaymentIntentId: 'pi_1',
    });
    fs.setDoc('disputes/d1', {
      transactionId: 'tx1',
      status: 'open',
      type: 'meetup_no_show',
    });

    const res = await callAdminRefund({
      auth: { uid: 'admin1', token: {} },
      data: { transactionId: 'tx1' },
    });
    expect(res.success).toBe(true);

    // Refund core was invoked with the admin idempotency key.
    expect(refundMock.calls.length).toBe(1);
    expect(refundMock.calls[0].opts.idempotencyKey).toBe('rf_admin_tx1');

    // Linked dispute closed.
    const dispute = fs.getDoc('disputes/d1')!;
    expect(dispute.status).toBe('resolved');
    expect(dispute.resolution).toBe('refunded');
    expect(dispute.resolvedBy).toBe('admin1');
  });

  it('does not touch an already-resolved dispute', async () => {
    seedAdmin();
    fs.setDoc('transactions/tx1', {
      status: 'disputed',
      sellerId: 's1',
      buyerId: 'b1',
      totalAmount: 50,
      stripePaymentIntentId: 'pi_1',
    });
    fs.setDoc('disputes/d1', {
      transactionId: 'tx1',
      status: 'resolved',
      resolution: 'dismissed',
    });

    await callAdminRefund({ auth: { uid: 'admin1', token: {} }, data: { transactionId: 'tx1' } });
    // Still resolved/dismissed (the closer only touches OPEN docs).
    expect(fs.getDoc('disputes/d1')!.resolution).toBe('dismissed');
  });
});

// ===========================================================================
// sellerCancelTransaction — F74
// ===========================================================================

describe('sellerCancelTransaction — F74', () => {
  it('requires authentication', async () => {
    await expect(
      callSellerCancel({ auth: null, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses a caller who is not the seller', async () => {
    fs.setDoc('transactions/tx1', { status: 'paid', sellerId: 's1', buyerId: 'b1' });
    await expect(
      callSellerCancel({ auth: { uid: 'b1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(refundMock.calls.length).toBe(0);
  });

  it('refunds + relists a paid order for the seller', async () => {
    fs.setDoc('transactions/tx1', {
      status: 'paid',
      sellerId: 's1',
      buyerId: 'b1',
      totalAmount: 50,
      articleId: 'a1',
      stripePaymentIntentId: 'pi_1',
    });

    const res = await callSellerCancel({
      auth: { uid: 's1' },
      data: { transactionId: 'tx1', reason: 'item broken' },
    });
    expect(res.success).toBe(true);

    expect(refundMock.calls.length).toBe(1);
    expect(refundMock.calls[0].opts.idempotencyKey).toBe('rf_seller_tx1');
    expect(refundMock.calls[0].opts.relistArticle).toBe(true);
  });

  it('allows cancellation at label_created (still pre-ship)', async () => {
    fs.setDoc('transactions/tx1', {
      status: 'label_created',
      sellerId: 's1',
      buyerId: 'b1',
      totalAmount: 50,
      stripePaymentIntentId: 'pi_1',
    });
    const res = await callSellerCancel({ auth: { uid: 's1' }, data: { transactionId: 'tx1' } });
    expect(res.success).toBe(true);
    expect(refundMock.calls.length).toBe(1);
  });

  it('refuses cancellation once shipped (carrier already scanned)', async () => {
    fs.setDoc('transactions/tx1', {
      status: 'shipped',
      sellerId: 's1',
      buyerId: 'b1',
      totalAmount: 50,
      stripePaymentIntentId: 'pi_1',
    });
    await expect(
      callSellerCancel({ auth: { uid: 's1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(refundMock.calls.length).toBe(0);
  });

  it('is idempotent on an already-refunded order', async () => {
    fs.setDoc('transactions/tx1', {
      status: 'refunded',
      sellerId: 's1',
      buyerId: 'b1',
      totalAmount: 50,
    });
    const res = await callSellerCancel({ auth: { uid: 's1' }, data: { transactionId: 'tx1' } });
    expect(res.alreadyRefunded).toBe(true);
    expect(refundMock.calls.length).toBe(0);
  });
});
