/**
 * Integration-style tests for the buyer RECOURSE callables (anti-fraud core).
 *
 * Module under test: callable/recourse.ts — requestRefund,
 * reportTransactionProblem, requestReturn. The downstream return-leg refund
 * (utils/returnRefund.ts:processReturnDelivered) is exercised here too, because
 * the return flow's anti-fraud guarantee is "no refund until the carrier
 * confirms the seller got the item back".
 *
 * PRINCIPLE (baked, non-negotiable): we NEVER refund on the buyer's word. An
 * auto-refund is only triggered by an OBJECTIVE carrier signal — a confirmed
 * delivery failure / lost parcel, or a confirmed reception of the return.
 *
 * Priorities (anti-fraud guards):
 *   1. requestRefund REJECTED if status === 'delivered' (failed-precondition).
 *   2. requestRefund OK + idempotent if 'delivery_failed' / 'lost' (one Stripe
 *      refund, correct seller debit).
 *   3. requestRefund rejected if caller != buyer.
 *   4. reportTransactionProblem makes NO money movement; sets disputed=true and
 *      opens a disputes doc.
 *   5. requestReturn buys a return label, status 'return_requested', NO immediate
 *      refund; the refund fires ONLY when returnTrackingNumber -> DELIVERED, and
 *      the refunded amount = total - returnLabelCost.
 *   6. requestReturn rejected out of window / if not 'delivered' / if not shipping.
 *
 * The REAL refund core (utils/refund.ts) and REAL return-leg handler
 * (utils/returnRefund.ts) run against the in-memory harness so seller-debit /
 * Stripe-refund assertions reflect production money movement, not stubs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from '../utils/testHelpers/firestoreMock';

// ---------------------------------------------------------------------------
// Hoisted holder — vi.mock factories are hoisted above imports and may only
// reference hoisted symbols. (Same lazy-holder pattern as the other financial
// integration tests: walletWithdraw.guards.test.ts / webhooks.test.ts.)
// ---------------------------------------------------------------------------

interface ShipEngineMock {
  createReturnLabelImpl: null | ((...a: unknown[]) => unknown);
  createReturnLabelCalls: unknown[][];
  configured: boolean;
}

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripeMock: null as StripeMock | null,
  shipEngine: {
    createReturnLabelImpl: null as null | ((...a: unknown[]) => unknown),
    createReturnLabelCalls: [] as unknown[][],
    configured: true,
  } as ShipEngineMock,
  pushCalls: [] as Array<{ userId: string; title: string; body: string }>,
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock: StripeMock = createStripeMock();
holder.fs = fs;
holder.stripeMock = stripeMock;
const shipEngine = holder.shipEngine;

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
  getShipEngine: () =>
    holder.shipEngine.configured
      ? {
          createReturnLabel: (...a: unknown[]) => {
            holder.shipEngine.createReturnLabelCalls.push(a);
            if (!holder.shipEngine.createReturnLabelImpl) {
              throw new Error('createReturnLabel not stubbed for this test');
            }
            return holder.shipEngine.createReturnLabelImpl(...a);
          },
        }
      : null,
}));

vi.mock('../utils/rateLimit', () => ({
  // No-op rate limiter for tests (the guard logic is covered by its own suite).
  checkRateLimit: async () => {},
  resolveCallerKey: (request: { auth?: { uid?: string } }) => ({
    callerKey: request.auth?.uid ?? 'anon',
    isAuthenticated: !!request.auth,
  }),
}));

vi.mock('../utils/notifications', () => ({
  sendPushNotification: async (userId: string, title: string, body: string) => {
    holder.pushCalls.push({ userId, title, body });
  },
  createInAppNotification: async () => {},
  buildDeepLink: () => '',
  sendSwapNotification: async () => {},
}));

// payments.ts (imported transitively by recourse.ts for resolveSellerOriginAddress)
// pulls in utils/trackingTransition at module-load; stub it so the import graph
// resolves without the real transition machine.
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

// ---------------------------------------------------------------------------
// Module under test (raw handlers thanks to the onCall mock) + the real
// return-leg refund handler (carrier DELIVERED signal).
// ---------------------------------------------------------------------------
import { requestRefund, reportTransactionProblem, requestReturn } from './recourse';
import { processReturnDelivered } from '../utils/returnRefund';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

const callRequestRefund = requestRefund as unknown as CallableHandler;
const callReportProblem = reportTransactionProblem as unknown as CallableHandler;
const callRequestReturn = requestReturn as unknown as CallableHandler;

// ---------------------------------------------------------------------------
// Seeders
// ---------------------------------------------------------------------------

/**
 * Seed a destination-charge transaction (card-paid via Stripe) plus its seller
 * wallet already credited to pendingBalance, so a refund must claw back exactly
 * `sellerCreditedCents`.
 */
function seedCardTransaction(opts?: {
  status?: string;
  totalAmount?: number; // DOLLARS
  sellerCreditedCents?: number; // CENTS already credited to the seller
  sellerPending?: number; // CENTS in seller pendingBalance
  deliveryType?: string;
  fundsReleaseAtMs?: number | null;
  fundsReleasedAt?: unknown;
}) {
  const {
    status = 'delivery_failed',
    totalAmount = 50,
    sellerCreditedCents = 4500,
    sellerPending = 4500,
    deliveryType = 'shipping',
    fundsReleaseAtMs = Date.now() + 7 * 24 * 60 * 60 * 1000,
    fundsReleasedAt = undefined,
  } = opts ?? {};

  const txData: Record<string, unknown> = {
    buyerId: 'buyer1',
    sellerId: 'seller1',
    status,
    deliveryType,
    totalAmount,
    sellerCreditedCents,
    paidVia: 'card',
    stripePaymentIntentId: 'pi_123',
    articleId: 'article1',
    articleTitle: 'Veste vintage',
  };
  if (fundsReleaseAtMs !== null) {
    // A REAL firebase-admin Timestamp instance — recourse.ts gates the 7-day
    // window with `fundsReleaseAt instanceof Timestamp`, so a plain
    // `{ toMillis }` stub would silently skip the check (false negative).
    txData.fundsReleaseAt = Timestamp.fromMillis(fundsReleaseAtMs);
  }
  if (fundsReleasedAt !== undefined) {
    txData.fundsReleasedAt = fundsReleasedAt;
  }
  fs.setDoc('transactions/tx1', txData);

  fs.setDoc('wallets/seller1', {
    balance: 0,
    heldBalance: 0,
    pendingBalance: sellerPending,
    sellerDebt: 0,
    status: 'active',
    currency: 'cad',
  });
}

/** Seed the article + seller user docs a return label needs (addresses). */
function seedReturnAddresses() {
  fs.setDoc('articles/article1', {
    weight: '0.6',
    dimensions: { length: 30, width: 25, height: 10 },
    location: {},
  });
  fs.setDoc('users/seller1', {
    displayName: 'Vendeuse',
    phoneNumber: '5145551234',
    addresses: [
      {
        isDefault: true,
        street: '123 rue Saint-Denis',
        city: 'Montreal',
        province: 'QC',
        postalCode: 'H2X 1K9',
      },
    ],
  });
  // Buyer shipping address lives on the transaction.
  const tx = fs.getDoc('transactions/tx1')!;
  fs.setDoc('transactions/tx1', {
    ...tx,
    shippingAddress: {
      name: 'Acheteur',
      street: '789 avenue du Parc',
      city: 'Laval',
      province: 'QC',
      postalCode: 'H7N 2A1',
      phone: '4385559876',
    },
  });
}

const RETURN_LABEL = {
  labelId: 'lbl_return_1',
  trackingNumber: 'TRK_RETURN_1',
  labelDownload: { href: 'https://labels.test/return1.pdf' },
  carrierCode: 'canada_post',
  shipmentCost: 8, // DOLLARS — the buyer bears this on the return refund
  insuranceCost: 0,
};

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  holder.pushCalls.length = 0;
  shipEngine.createReturnLabelCalls.length = 0;
  shipEngine.createReturnLabelImpl = null;
  shipEngine.configured = true;
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.SHIPENGINE_API_KEY = 'se_test';
});

// ===========================================================================
// 1 + 3. requestRefund — anti-fraud gate + buyer-only
// ===========================================================================

describe('requestRefund — anti-fraud gate', () => {
  it('requires authentication', async () => {
    await expect(
      callRequestRefund({ auth: null, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('REJECTS a refund on a DELIVERED order (no refund on "delivered" — core anti-fraud)', async () => {
    seedCardTransaction({ status: 'delivered' });

    await expect(
      callRequestRefund({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // ZERO money moved: no Stripe refund, seller wallet untouched, status intact.
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);
    expect(fs.getDoc('transactions/tx1')!.status).toBe('delivered');
  });

  it('REJECTS a refund on a shipped (in-transit) order', async () => {
    seedCardTransaction({ status: 'shipped' });

    await expect(
      callRequestRefund({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
  });

  it('rejects if the caller is NOT the buyer', async () => {
    seedCardTransaction({ status: 'delivery_failed' });

    await expect(
      callRequestRefund({ auth: { uid: 'someoneElse' }, data: { transactionId: 'tx1' } })
    ).rejects.toMatchObject({ code: 'permission-denied' });

    expect(stripeMock.calls.refundsCreate.length).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);
  });

  it('rejects when transactionId is missing', async () => {
    await expect(
      callRequestRefund({ auth: { uid: 'buyer1' }, data: {} })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects when the transaction does not exist', async () => {
    await expect(
      callRequestRefund({ auth: { uid: 'buyer1' }, data: { transactionId: 'ghost' } })
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

// ===========================================================================
// 2. requestRefund — OK + idempotent on a carrier-confirmed failure
// ===========================================================================

describe('requestRefund — carrier-confirmed failure/lost', () => {
  it('refunds on delivery_failed: ONE Stripe refund (reverse_transfer) + exact seller debit + status refunded', async () => {
    seedCardTransaction({
      status: 'delivery_failed',
      totalAmount: 50,
      sellerCreditedCents: 4500,
      sellerPending: 4500,
    });

    const result = await callRequestRefund({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });
    expect(result.success).toBe(true);

    // Exactly ONE Stripe refund, on the right PI. Single-rail model: every charge
    // is a platform charge, so the refund is a PLAIN refunds.create — NO
    // reverse_transfer / refund_application_fee (the seller is debited via the
    // wallet cascade, not via a connected-account transfer reversal).
    expect(stripeMock.calls.refundsCreate.length).toBe(1);
    const refundArgs = stripeMock.calls.refundsCreate[0][0] as Record<string, unknown>;
    expect(refundArgs.payment_intent).toBe('pi_123');
    expect(refundArgs.reverse_transfer).toBeUndefined();
    expect(refundArgs.refund_application_fee).toBeUndefined();
    // Deterministic idempotency key.
    const refundOpts = stripeMock.calls.refundsCreate[0][1] as Record<string, unknown>;
    expect(refundOpts.idempotencyKey).toBe('rf_buyer_tx1');

    // Seller debited EXACTLY sellerCreditedCents (4500) from pendingBalance.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.sellerDebt ?? 0).toBe(0);
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);

    // Transaction marked refunded.
    expect(fs.getDoc('transactions/tx1')!.status).toBe('refunded');

    // Article is NOT re-listed (parcel lost/failed): no isSold:false write.
    const relistWrite = fs.writeOps.find(
      (op) => op.path === 'articles/article1' && op.data.isSold === false
    );
    expect(relistWrite).toBeUndefined();
  });

  it('refunds on lost as well', async () => {
    seedCardTransaction({ status: 'lost' });

    const result = await callRequestRefund({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });
    expect(result.success).toBe(true);
    expect(stripeMock.calls.refundsCreate.length).toBe(1);
    expect(fs.getDoc('transactions/tx1')!.status).toBe('refunded');
  });

  it('debits the shortfall to sellerDebt when pendingBalance is insufficient', async () => {
    // Seller credited 4500 but only 1000 left in pending (already partially paid out).
    seedCardTransaction({
      status: 'delivery_failed',
      sellerCreditedCents: 4500,
      sellerPending: 1000,
    });

    await callRequestRefund({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } });

    const sw = fs.getDoc('wallets/seller1')!;
    expect(sw.pendingBalance).toBe(0); // drained
    expect(sw.sellerDebt).toBe(3500); // 4500 - 1000 shortfall recorded as debt
  });

  it('is idempotent: a second call no-ops (already refunded), no double Stripe refund', async () => {
    seedCardTransaction({ status: 'delivery_failed' });

    await callRequestRefund({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } });
    expect(stripeMock.calls.refundsCreate.length).toBe(1);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);

    // Second invocation: status is now 'refunded' -> early no-op.
    const second = await callRequestRefund({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1' },
    });
    expect(second).toMatchObject({ alreadyRefunded: true });

    // Still exactly ONE refund, seller not debited twice.
    expect(stripeMock.calls.refundsCreate.length).toBe(1);
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);
  });
});

// ===========================================================================
// 4. reportTransactionProblem — NO money movement, opens a dispute
// ===========================================================================

describe('reportTransactionProblem — freeze only, no money movement', () => {
  it('requires authentication', async () => {
    await expect(
      callReportProblem({ auth: null, data: { transactionId: 'tx1', reason: 'damaged' } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('makes NO money movement, sets disputed=true and opens a disputes doc', async () => {
    seedCardTransaction({ status: 'delivered' });

    const result = await callReportProblem({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1', reason: 'not_as_described', details: 'Trou non mentionné' },
    });
    expect(result.success).toBe(true);
    expect(typeof result.disputeId).toBe('string');

    // ZERO money movement: no Stripe refund, no wallet write at all.
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
    expect(stripeMock.calls.transfersCreate.length).toBe(0);
    const walletWrite = fs.writeOps.find((op) => op.path.startsWith('wallets/'));
    expect(walletWrite).toBeUndefined();
    // Seller pendingBalance untouched.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);

    // Transaction is frozen: disputed flag + status + statusBeforeDispute + report.
    const tx = fs.getDoc('transactions/tx1')!;
    expect(tx.disputed).toBe(true);
    expect(tx.status).toBe('disputed');
    expect(tx.statusBeforeDispute).toBe('delivered');
    expect((tx.buyerReport as Record<string, unknown>).reason).toBe('not_as_described');
    expect((tx.buyerReport as Record<string, unknown>).details).toBe('Trou non mentionné');

    // A disputes doc was opened for admin review.
    const disputeWrite = fs.writeOps.find(
      (op) => op.path.startsWith('disputes/') && op.method === 'set'
    );
    expect(disputeWrite).toBeDefined();
    expect(disputeWrite!.data.transactionId).toBe('tx1');
    expect(disputeWrite!.data.status).toBe('open');
    expect(disputeWrite!.data.reason).toBe('not_as_described');
  });

  it('rejects an invalid reason', async () => {
    seedCardTransaction({ status: 'delivered' });
    await expect(
      callReportProblem({
        auth: { uid: 'buyer1' },
        data: { transactionId: 'tx1', reason: 'i_changed_my_mind' },
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects if the caller is not the buyer', async () => {
    seedCardTransaction({ status: 'delivered' });
    await expect(
      callReportProblem({
        auth: { uid: 'intruder' },
        data: { transactionId: 'tx1', reason: 'damaged' },
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('refuses a re-report on an already-disputed transaction', async () => {
    seedCardTransaction({ status: 'delivered' });
    await callReportProblem({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1', reason: 'damaged' },
    });

    await expect(
      callReportProblem({
        auth: { uid: 'buyer1' },
        data: { transactionId: 'tx1', reason: 'other' },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

// ===========================================================================
// 5. requestReturn — buys a label, freezes funds, NO immediate refund;
//    refund fires only on the carrier DELIVERED signal (total - returnLabelCost)
// ===========================================================================

describe('requestReturn — return label, no immediate refund', () => {
  function setupDeliveredReturnable() {
    seedCardTransaction({
      status: 'delivered',
      deliveryType: 'shipping',
      totalAmount: 50,
      sellerCreditedCents: 4500,
      sellerPending: 4500,
      fundsReleaseAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    seedReturnAddresses();
    shipEngine.createReturnLabelImpl = async () => RETURN_LABEL;
  }

  it('creates a return label, sets status return_requested, freezes funds, NO refund yet', async () => {
    setupDeliveredReturnable();

    const result = await callRequestReturn({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1', reason: 'not_as_described' },
    });

    expect(result.success).toBe(true);
    expect(result.returnTrackingNumber).toBe('TRK_RETURN_1');
    expect(result.returnLabelCost).toBe(8);

    // A return label WAS bought (origin = buyer, destination = seller).
    expect(shipEngine.createReturnLabelCalls.length).toBe(1);
    const [shipFrom, shipTo] = shipEngine.createReturnLabelCalls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(shipFrom.postalCode).toBe('H7N 2A1'); // buyer
    expect(shipTo.postalCode).toBe('H2X1K9'); // seller (normalized, no space)

    // Transaction: return-leg fields persisted, status frozen.
    const tx = fs.getDoc('transactions/tx1')!;
    expect(tx.status).toBe('return_requested');
    expect(tx.disputed).toBe(true);
    expect(tx.returnLabelId).toBe('lbl_return_1');
    expect(tx.returnTrackingNumber).toBe('TRK_RETURN_1');
    expect(tx.returnLabelCost).toBe(8);
    expect(tx.returnReason).toBe('not_as_described');

    // CRITICAL: NO money moved at this stage.
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);
  });

  it('refunds ONLY when the return tracking goes DELIVERED, refunding total - returnLabelCost', async () => {
    setupDeliveredReturnable();

    await callRequestReturn({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1', reason: 'not_as_described' },
    });
    // Still no refund before the carrier confirms reception.
    expect(stripeMock.calls.refundsCreate.length).toBe(0);

    // Carrier confirms the RETURN parcel was DELIVERED back to the seller.
    const outcome = await processReturnDelivered('tx1', 'webhook');
    expect(outcome.refunded).toBe(true);

    // Exactly ONE Stripe refund, of total - returnLabelCost = 5000 - 800 = 4200c.
    expect(stripeMock.calls.refundsCreate.length).toBe(1);
    const refundArgs = stripeMock.calls.refundsCreate[0][0] as Record<string, unknown>;
    expect(refundArgs.payment_intent).toBe('pi_123');
    expect(refundArgs.amount).toBe(4200); // partial card refund (buyer bears the $8 label)
    const refundOpts = stripeMock.calls.refundsCreate[0][1] as Record<string, unknown>;
    expect(refundOpts.idempotencyKey).toBe('rf_return_tx1');

    // Seller debited their full payout (4500), transaction refunded.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
    expect(fs.getDoc('transactions/tx1')!.status).toBe('refunded');
  });

  it('return-leg refund is idempotent: a replayed DELIVERED signal does not double-refund', async () => {
    setupDeliveredReturnable();
    await callRequestReturn({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1', reason: 'damaged' },
    });

    const first = await processReturnDelivered('tx1', 'webhook');
    expect(first.refunded).toBe(true);
    expect(stripeMock.calls.refundsCreate.length).toBe(1);

    // Replay (e.g. poller after the webhook): status is 'refunded' -> no-op.
    const second = await processReturnDelivered('tx1', 'poller');
    expect(second.refunded).toBe(false);
    expect(stripeMock.calls.refundsCreate.length).toBe(1);
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);
  });

  it('is idempotent at request time: a second requestReturn no-ops (no second label)', async () => {
    setupDeliveredReturnable();

    await callRequestReturn({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1', reason: 'not_as_described' },
    });
    expect(shipEngine.createReturnLabelCalls.length).toBe(1);

    const second = await callRequestReturn({
      auth: { uid: 'buyer1' },
      data: { transactionId: 'tx1', reason: 'not_as_described' },
    });
    expect(second).toMatchObject({ alreadyRequested: true });
    // No second paid label bought.
    expect(shipEngine.createReturnLabelCalls.length).toBe(1);
  });
});

// ===========================================================================
// 6. requestReturn — rejected out of window / not delivered / not shipping
// ===========================================================================

describe('requestReturn — preconditions', () => {
  it('requires authentication', async () => {
    await expect(
      callRequestReturn({ auth: null, data: { transactionId: 'tx1', reason: 'damaged' } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects an invalid return reason', async () => {
    seedCardTransaction({ status: 'delivered' });
    await expect(
      callRequestReturn({
        auth: { uid: 'buyer1' },
        data: { transactionId: 'tx1', reason: 'changed_my_mind' },
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects if the order is NOT delivered (e.g. still shipped)', async () => {
    seedCardTransaction({ status: 'shipped', deliveryType: 'shipping' });
    seedReturnAddresses();
    shipEngine.createReturnLabelImpl = async () => RETURN_LABEL;

    await expect(
      callRequestReturn({
        auth: { uid: 'buyer1' },
        data: { transactionId: 'tx1', reason: 'not_as_described' },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // No label bought, no money moved.
    expect(shipEngine.createReturnLabelCalls.length).toBe(0);
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
  });

  it('rejects a non-shipping (meetup) delivery', async () => {
    seedCardTransaction({ status: 'delivered', deliveryType: 'meetup' });
    seedReturnAddresses();
    shipEngine.createReturnLabelImpl = async () => RETURN_LABEL;

    await expect(
      callRequestReturn({
        auth: { uid: 'buyer1' },
        data: { transactionId: 'tx1', reason: 'not_as_described' },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(shipEngine.createReturnLabelCalls.length).toBe(0);
  });

  it('rejects once the 7-day window has elapsed (fundsReleaseAt in the past)', async () => {
    seedCardTransaction({
      status: 'delivered',
      deliveryType: 'shipping',
      fundsReleaseAtMs: Date.now() - 60 * 1000, // window closed
    });
    seedReturnAddresses();
    shipEngine.createReturnLabelImpl = async () => RETURN_LABEL;

    await expect(
      callRequestReturn({
        auth: { uid: 'buyer1' },
        data: { transactionId: 'tx1', reason: 'not_as_described' },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(shipEngine.createReturnLabelCalls.length).toBe(0);
  });

  it('rejects once the funds have already been released (fundsReleasedAt set)', async () => {
    seedCardTransaction({
      status: 'delivered',
      deliveryType: 'shipping',
      fundsReleaseAtMs: Date.now() + 60 * 1000,
      fundsReleasedAt: { toMillis: () => Date.now() - 1000 },
    });
    seedReturnAddresses();
    shipEngine.createReturnLabelImpl = async () => RETURN_LABEL;

    await expect(
      callRequestReturn({
        auth: { uid: 'buyer1' },
        data: { transactionId: 'tx1', reason: 'not_as_described' },
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(shipEngine.createReturnLabelCalls.length).toBe(0);
  });

  it('rejects if the caller is not the buyer', async () => {
    seedCardTransaction({ status: 'delivered', deliveryType: 'shipping' });
    seedReturnAddresses();
    shipEngine.createReturnLabelImpl = async () => RETURN_LABEL;

    await expect(
      callRequestReturn({
        auth: { uid: 'intruder' },
        data: { transactionId: 'tx1', reason: 'not_as_described' },
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(shipEngine.createReturnLabelCalls.length).toBe(0);
  });
});
