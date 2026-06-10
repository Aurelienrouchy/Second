/**
 * Integration-style tests for the Stripe webhook (critical financial paths).
 *
 * These drive the REAL exported `stripeWebhook` onRequest handler through a
 * mocked Express req/res, with an in-memory Firestore + a swappable Stripe mock.
 * The handler's own helpers (creditSellerForSale, reconcileShippingCost,
 * writeFailedOperation, getOrCreateSellerWallet) run for real against the mock
 * db — only the I/O boundaries (Firestore, Stripe, ShipEngine, push) are mocked.
 *
 * Coverage (per chantier brief):
 *  1. handlePaymentIntentSucceeded replay (same event.id) => no double credit.
 *  2. Amount mismatch => tx NOT 'paid' + failed_operations dead-letter + ACK 200.
 *  3. Swap top-up => ONE fund movement (no double credit, no transfer_data).
 *  4. handleChargeRefunded => debit correct bucket on a (full) platform refund.
 *  (transactionExpiration + walletWithdraw + shipping re-pricing live in their
 *   own *.test.ts files.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type {
  WriteOp,
  MockFirestore,
  StripeMock,
} from '../utils/testHelpers/firestoreMock';

// ---------------------------------------------------------------------------
// Mock state. vi.mock factories are hoisted above imports, so they may only
// reference symbols produced by vi.hoisted. We hoist a single mutable holder
// (sync, no imports — safe at hoist time) and populate it from the module body
// BELOW, before the unit-under-test is imported. The factories read through the
// holder LAZILY (only when the mocked module is first loaded, i.e. after this
// body has run), so the late assignment is visible.
// ---------------------------------------------------------------------------
const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripeMock: null as StripeMock | null,
  pushCalls: [] as unknown[][],
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock: StripeMock = createStripeMock();
const pushCalls = holder.pushCalls;
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
  // No label creation exercised in these tests (we use meetup/non-shipping or
  // assert before the label step). Returning null defers to sweepPendingLabels.
  getShipEngine: () => null,
}));

vi.mock('../utils/notifications', () => ({
  sendPushNotification: (...a: unknown[]) => {
    holder.pushCalls.push(a);
    return Promise.resolve();
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
    // onRequest returns the raw (req,res) handler so we can call it directly.
    onRequest: (_opts: unknown, handler: unknown) => handler,
    // wallet.ts (imported transitively for getOrCreateSellerWallet) registers
    // onCall handlers at module load; return the raw handler too.
    onCall: (_opts: unknown, handler: unknown) => handler,
    HttpsError: _HttpsError,
  };
});

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------
import { stripeWebhook } from './webhooks';

type RawHandler = (req: unknown, res: unknown) => Promise<void>;
const handler = stripeWebhook as unknown as RawHandler;

// ---------------------------------------------------------------------------
// Express req/res test doubles
// ---------------------------------------------------------------------------
interface FakeRes {
  statusCode: number | null;
  body: unknown;
  jsonBody: unknown;
  status(code: number): FakeRes;
  send(body: unknown): FakeRes;
  json(body: unknown): FakeRes;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: null,
    body: undefined,
    jsonBody: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
    json(body: unknown) {
      this.jsonBody = body;
      if (this.statusCode === null) this.statusCode = 200;
      return this;
    },
  };
  return res;
}

function makeReq(): { method: string; headers: Record<string, string>; rawBody: Buffer } {
  return {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    rawBody: Buffer.from('{}'),
  };
}

/**
 * Stub Stripe.constructEvent to return a fixed event, then invoke the webhook.
 */
async function deliverEvent(event: Record<string, unknown>): Promise<FakeRes> {
  stripeMock.impl.constructEvent = () => event;
  const res = makeRes();
  await handler(makeReq(), res);
  return res;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SECRET = 'whsec_test';

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  pushCalls.length = 0;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

function piSucceededEvent(opts: {
  eventId: string;
  transactionId: string;
  amountCents: number;
  paymentIntentId?: string;
  metadata?: Record<string, string>;
}): Record<string, unknown> {
  return {
    id: opts.eventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: opts.paymentIntentId ?? 'pi_test',
        amount: opts.amountCents,
        amount_received: opts.amountCents,
        latest_charge: 'ch_test',
        metadata: { transactionId: opts.transactionId, ...(opts.metadata ?? {}) },
      },
    },
  };
}

// ===========================================================================
// 1. Replay of the same event.id => no double credit (dedup stripe_events)
// ===========================================================================

describe('Stripe webhook — event dedup (stripe_events)', () => {
  it('credits the seller exactly once for a meetup (non-shipping) sale', async () => {
    // A meetup/non-shipping tx is credited immediately at PI.succeeded.
    fs.setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 50, // dollars
      sellerPayout: 45, // dollars
      deliveryType: 'meetup',
      articleId: 'article1',
      chatId: null,
    });
    fs.setDoc('wallets/seller1', {
      balance: 0,
      pendingBalance: 0,
      status: 'active',
      currency: 'cad',
    });

    const event = piSucceededEvent({
      eventId: 'evt_1',
      transactionId: 'tx1',
      amountCents: 5000,
    });

    const res1 = await deliverEvent(event);
    expect(res1.statusCode).toBe(200);
    expect(res1.jsonBody).toEqual({ received: true });

    // Seller credited 4500 cents in pendingBalance.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);
    // tx marked paid + sellerCreditedCents persisted.
    expect(fs.getDoc('transactions/tx1')!.status).toBe('paid');
    expect(fs.getDoc('transactions/tx1')!.sellerCreditedCents).toBe(4500);

    const creditWritesAfterFirst = fs.sumIncrements('wallets/seller1', 'pendingBalance');
    expect(creditWritesAfterFirst).toBe(4500);

    // --- REPLAY the exact same event.id ---
    const res2 = await deliverEvent(event);
    expect(res2.statusCode).toBe(200);
    expect(res2.jsonBody).toEqual({ received: true });

    // Pending balance UNCHANGED — no double credit.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(4500);
  });

  it('regularises sellerDebt before crediting pendingBalance (F39)', async () => {
    // A meetup sale credits the seller at PI.succeeded. The seller carries a debt
    // (e.g. an earlier lost dispute after withdrawal). The credit must pay down the
    // debt FIRST; only the remainder lands in pendingBalance.
    fs.setDoc('transactions/tx_debt_repay', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 50,
      sellerPayout: 45, // 4500 cents credit
      deliveryType: 'meetup',
      articleId: 'article1',
      chatId: null,
    });
    fs.setDoc('wallets/seller1', {
      balance: 0,
      pendingBalance: 0,
      sellerDebt: 3000, // owes 3000 cents
      status: 'active',
      currency: 'cad',
    });

    await deliverEvent(
      piSucceededEvent({ eventId: 'evt_debt_repay', transactionId: 'tx_debt_repay', amountCents: 5000 })
    );

    const w = fs.getDoc('wallets/seller1')!;
    // 3000 of the 4500 credit cleared the debt; 1500 went to pendingBalance.
    expect(w.sellerDebt).toBe(0);
    expect(w.pendingBalance).toBe(1500);
    expect(fs.sumIncrements('wallets/seller1', 'sellerDebt')).toBe(-3000);
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(1500);
    // A dedicated debt_repayment ledger entry was written.
    const repay = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('wallets/seller1/ledger/') && op.data.type === 'debt_repayment'
    );
    expect(repay).toBeDefined();
    expect(repay!.data.amount).toBe(3000);
  });

  it('creates a stripe_events marker the first time only', async () => {
    fs.setDoc('transactions/tx1', {
      buyerId: 'b',
      sellerId: 's',
      status: 'pending_payment',
      totalAmount: 10,
      sellerPayout: 9,
      deliveryType: 'meetup',
      articleId: 'a',
    });
    fs.setDoc('wallets/s', { balance: 0, pendingBalance: 0, status: 'active' });

    const event = piSucceededEvent({ eventId: 'evt_marker', transactionId: 'tx1', amountCents: 1000 });

    await deliverEvent(event);
    const markerWrites1 = fs.countWrites(
      (op: WriteOp) => op.path === 'stripe_events/evt_marker' && op.method === 'create'
    );
    expect(markerWrites1).toBe(1);
    expect(fs.getDoc('stripe_events/evt_marker')).toBeDefined();

    await deliverEvent(event);
    // Still exactly one create — the replay short-circuits on the existing marker.
    const markerWrites2 = fs.countWrites(
      (op: WriteOp) => op.path === 'stripe_events/evt_marker' && op.method === 'create'
    );
    expect(markerWrites2).toBe(1);
  });
});

// ===========================================================================
// 2. Amount mismatch => not paid + failed_operations + deterministic 200
// ===========================================================================

describe('Stripe webhook — amount mismatch (deterministic dead-letter)', () => {
  it('does NOT mark paid, writes a failed_operations dead-letter, ACKs 200', async () => {
    fs.setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 50, // expected 5000 cents
      sellerPayout: 45,
      deliveryType: 'meetup',
      articleId: 'article1',
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    // Buyer UNDERPAID: charged 40$ instead of 50$.
    const event = piSucceededEvent({
      eventId: 'evt_mismatch',
      transactionId: 'tx1',
      amountCents: 4000,
    });

    const res = await deliverEvent(event);

    // Deterministic 200 (so Stripe stops retrying a non-self-healing error).
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ received: true });

    // Transaction NOT marked paid.
    expect(fs.getDoc('transactions/tx1')!.status).toBe('pending_payment');
    // Seller NOT credited.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);

    // A failed_operations dead-letter was written with type amount_mismatch.
    const deadLetters = fs.writeOps.filter(
      (op: WriteOp) =>
        op.path.startsWith('failed_operations/') &&
        op.method === 'set' &&
        op.data.type === 'amount_mismatch'
    );
    expect(deadLetters.length).toBe(1);
    expect(deadLetters[0].data.refId).toBe('tx1');
    // Underpayment must NOT auto-refund (business decision).
    expect((deadLetters[0].data.payload as Record<string, unknown>).autoRefund).toBe(false);
    // No Stripe refund issued for an underpayment.
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
  });

  it('auto-refunds the buyer (idempotent key) when buyer OVERPAID', async () => {
    fs.setDoc('transactions/tx1', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 50, // expected 5000 cents
      sellerPayout: 45,
      deliveryType: 'meetup',
      articleId: 'article1',
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    let refundOpts: Record<string, unknown> | undefined;
    stripeMock.impl.refundsCreate = (...a: unknown[]) => {
      refundOpts = a[1] as Record<string, unknown>;
      return { id: 'rf_over' };
    };

    // Buyer OVERPAID: charged 60$ instead of 50$.
    const event = piSucceededEvent({
      eventId: 'evt_over',
      transactionId: 'tx1',
      amountCents: 6000,
      paymentIntentId: 'pi_over',
    });

    const res = await deliverEvent(event);
    expect(res.statusCode).toBe(200);

    // The overpaid auto-refund now reuses the shared issueTransactionRefund core,
    // which finalizes the transaction to a clean terminal 'refunded' state (the
    // buyer's money was returned, the tx is closed) instead of leaving it dangling
    // in 'pending_payment' to later expire. The seller was never credited
    // (no sellerCreditedCents), so the core's debit target is 0 — pendingBalance
    // stays 0 (no false debit).
    expect(fs.getDoc('transactions/tx1')!.status).toBe('refunded');
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);

    // Auto-refund issued with a deterministic idempotency key. Single-rail model:
    // a plain platform-charge refund (NO reverse_transfer).
    expect(stripeMock.calls.refundsCreate.length).toBe(1);
    const refundArgs = stripeMock.calls.refundsCreate[0][0] as Record<string, unknown>;
    expect(refundArgs.payment_intent).toBe('pi_over');
    expect(refundArgs.reverse_transfer).toBeUndefined();
    expect(refundOpts!.idempotencyKey).toBe('rf_mismatch_tx1');

    // Dead-letter records autoRefund: true.
    const dl = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('failed_operations/') && op.data.type === 'amount_mismatch'
    )!;
    expect((dl.data.payload as Record<string, unknown>).autoRefund).toBe(true);
  });
});

// ===========================================================================
// 3. Swap top-up => exactly one fund movement (no double credit, no transfer)
// ===========================================================================

describe('Stripe webhook — swap top-up (single fund movement)', () => {
  function seedSwap() {
    fs.setDoc('swaps/swap1', {
      status: 'payment_pending',
      initiatorId: 'userA',
      receiverId: 'userB',
      topUpFee: 200, // cents
    });
    fs.setDoc('wallets/userB', {
      balance: 0,
      pendingBalance: 0,
      status: 'active',
      currency: 'cad',
    });
  }

  function swapTopUpEvent(eventId: string): Record<string, unknown> {
    return {
      id: eventId,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_swap',
          amount: 1200, // base 1000 + fee 200
          amount_received: 1200,
          latest_charge: 'ch_swap',
          metadata: {
            type: 'swap_topup',
            swapId: 'swap1',
            payeeId: 'userB',
            topUpAmount: '1000', // base amount in cents (fee excluded)
          },
        },
      },
    };
  }

  it('credits payee pendingBalance ONCE with the base amount (fee kept)', async () => {
    seedSwap();
    const event = swapTopUpEvent('evt_swap1');

    const res = await deliverEvent(event);
    expect(res.statusCode).toBe(200);

    // Base 1000 credited to pendingBalance (escrow), fee 200 kept by platform.
    expect(fs.getDoc('wallets/userB')!.pendingBalance).toBe(1000);
    // Swap advanced to accepted.
    expect(fs.getDoc('swaps/swap1')!.status).toBe('accepted');

    // No Stripe transfer / destination charge involved (cash top-up is a plain
    // platform charge; the credit is an internal ledger movement only).
    expect(stripeMock.calls.transfersCreate.length).toBe(0);
    expect(fs.sumIncrements('wallets/userB', 'pendingBalance')).toBe(1000);
  });

  it('replay of the swap top-up event does not double-credit', async () => {
    seedSwap();
    const event = swapTopUpEvent('evt_swap_replay');

    await deliverEvent(event);
    expect(fs.getDoc('wallets/userB')!.pendingBalance).toBe(1000);

    // Replay same event.id — dedup short-circuits before the handler runs.
    await deliverEvent(event);
    expect(fs.getDoc('wallets/userB')!.pendingBalance).toBe(1000);
    expect(fs.sumIncrements('wallets/userB', 'pendingBalance')).toBe(1000);
  });

  it('dead-letters (ACK 200, no credit) on a swap top-up UNDERPAYMENT', async () => {
    seedSwap();
    const event = swapTopUpEvent('evt_swap_bad');
    // Tamper amount: charged 999 but expected 1200 (1000 + 200 fee) => UNDERPAID.
    (((event.data as Record<string, unknown>).object as Record<string, unknown>).amount as number) = 999;
    (((event.data as Record<string, unknown>).object as Record<string, unknown>).amount_received as number) = 999;

    const res = await deliverEvent(event);
    // A swap top-up amount mismatch is a DETERMINISTIC error (the captured charge
    // and the stored base+fee never change on a Stripe retry). The handler MUST
    // NOT 500 — it dead-letters and ACKs 200 so Stripe stops re-delivering for ~3
    // days, mirroring the purchase amount_mismatch path.
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ received: true });

    // No credit applied — the handler returns BEFORE the pendingBalance increment.
    expect(fs.getDoc('wallets/userB')!.pendingBalance).toBe(0);
    // Swap left in payment_pending (the mismatch branch never advances status).
    expect(fs.getDoc('swaps/swap1')!.status).toBe('payment_pending');
    // topUpRefundReconciledAt pre-set so a later charge.refunded short-circuits
    // (no wallet debit — we never credited it).
    expect(fs.getDoc('swaps/swap1')!.topUpRefundReconciledAt).toBeDefined();

    // UNDERPAYMENT is a business decision (refund vs chase the balance), so NO
    // auto-refund: a manual-reconciliation dead-letter is written instead.
    const deadLetters = fs.writeOps.filter(
      (op: WriteOp) =>
        op.path.startsWith('failed_operations/') &&
        op.method === 'set' &&
        op.data.type === 'amount_mismatch'
    );
    expect(deadLetters.length).toBe(1);
    expect(deadLetters[0].data.refId).toBe('swap1');
    const payload = deadLetters[0].data.payload as Record<string, unknown>;
    expect(payload.autoRefund).toBe(false);
    expect(payload.isMixedCharge).toBe(true);
    expect(payload.kind).toBe('swap_topup_amount_mismatch');

    // No Stripe refund issued for an underpayment.
    expect(stripeMock.calls.refundsCreate.length).toBe(0);
  });
});

// ===========================================================================
// 4. handleChargeRefunded => debit correct bucket on a full platform refund
// ===========================================================================

describe('Stripe webhook — charge.refunded (bucket debit, full vs partial)', () => {
  function refundEvent(opts: {
    eventId: string;
    paymentIntentId: string;
    refundId?: string;
    amount?: number;
    amountRefunded?: number;
  }): Record<string, unknown> {
    // Default to a FULL refund (amount === amount_refunded) so existing bucket
    // tests exercise the full reconciliation path.
    const amount = opts.amount ?? 5000;
    const amountRefunded = opts.amountRefunded ?? amount;
    return {
      id: opts.eventId,
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_refund',
          payment_intent: opts.paymentIntentId,
          amount,
          amount_refunded: amountRefunded,
          refunds: { data: [{ id: opts.refundId ?? 'rf_ch' }] },
        },
      },
    };
  }

  it('debits the seller pendingBalance bucket by exactly sellerCreditedCents', async () => {
    // Seller funds still in pendingBalance (paid, not yet delivered/released).
    fs.setDoc('transactions/tx_ref', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'paid',
      totalAmount: 50,
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      paidVia: 'card',
      deliveryType: 'shipping',
      articleId: 'article1',
      stripePaymentIntentId: 'pi_ref',
    });
    fs.setDoc('wallets/seller1', {
      balance: 0,
      pendingBalance: 4500,
      heldBalance: 0,
      status: 'active',
    });
    // The refund is matched by querying transactions where stripePaymentIntentId.
    fs.setQuery('transactions', [
      {
        id: 'tx_ref',
        data: {
          buyerId: 'buyer1',
          sellerId: 'seller1',
          status: 'paid',
          totalAmount: 50,
          sellerPayout: 45,
          sellerCreditedCents: 4500,
          paidVia: 'card',
          deliveryType: 'shipping',
          articleId: 'article1',
          stripePaymentIntentId: 'pi_ref',
        },
      },
    ]);

    const res = await deliverEvent(
      refundEvent({ eventId: 'evt_ref', paymentIntentId: 'pi_ref' })
    );
    expect(res.statusCode).toBe(200);

    // Debited exactly from pendingBalance.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(0);
    // No phantom debt (held enough in pending).
    expect(fs.getDoc('wallets/seller1')!.sellerDebt ?? 0).toBe(0);
    // Transaction marked refunded.
    expect(fs.getDoc('transactions/tx_ref')!.status).toBe('refunded');

    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);
  });

  it('records sellerDebt when the seller already withdrew (balance short)', async () => {
    fs.setDoc('transactions/tx_debt', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'delivered',
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      paidVia: 'card',
      deliveryType: 'shipping',
      articleId: 'a',
      stripePaymentIntentId: 'pi_debt',
    });
    // Seller withdrew everything: nothing left in any bucket.
    fs.setDoc('wallets/seller1', {
      balance: 0,
      pendingBalance: 0,
      heldBalance: 0,
      status: 'active',
    });
    fs.setQuery('transactions', [
      {
        id: 'tx_debt',
        data: {
          sellerId: 'seller1',
          buyerId: 'buyer1',
          status: 'delivered',
          sellerPayout: 45,
          sellerCreditedCents: 4500,
          paidVia: 'card',
          deliveryType: 'shipping',
          articleId: 'a',
          stripePaymentIntentId: 'pi_debt',
        },
      },
    ]);

    await deliverEvent(refundEvent({ eventId: 'evt_debt', paymentIntentId: 'pi_debt' }));

    // Full shortfall recorded as debt (never masked with min()).
    expect(fs.getDoc('wallets/seller1')!.sellerDebt).toBe(4500);
    expect(fs.sumIncrements('wallets/seller1', 'sellerDebt')).toBe(4500);
  });

  it('refunds the wallet portion to the buyer for a mixed payment', async () => {
    fs.setDoc('transactions/tx_mixed', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'paid',
      totalAmount: 50,
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      paidVia: 'wallet_and_card',
      walletAmountUsed: 2000, // cents
      deliveryType: 'meetup',
      articleId: 'a',
      stripePaymentIntentId: 'pi_mixed',
    });
    fs.setDoc('wallets/buyer1', { balance: 1000, status: 'active' });
    fs.setDoc('wallets/seller1', {
      balance: 0,
      pendingBalance: 4500,
      heldBalance: 0,
      status: 'active',
    });
    fs.setQuery('transactions', [
      {
        id: 'tx_mixed',
        data: {
          buyerId: 'buyer1',
          sellerId: 'seller1',
          status: 'paid',
          totalAmount: 50,
          sellerPayout: 45,
          sellerCreditedCents: 4500,
          paidVia: 'wallet_and_card',
          walletAmountUsed: 2000,
          deliveryType: 'meetup',
          articleId: 'a',
          stripePaymentIntentId: 'pi_mixed',
        },
      },
    ]);

    await deliverEvent(refundEvent({ eventId: 'evt_mixed', paymentIntentId: 'pi_mixed' }));

    // Buyer wallet portion (2000 cents) re-credited.
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(3000);
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(2000);
    // Seller debited pending.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
  });

  it('is idempotent: replaying charge.refunded does not double-debit', async () => {
    const txData = {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'paid',
      totalAmount: 50,
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      paidVia: 'card',
      deliveryType: 'shipping',
      articleId: 'a',
      stripePaymentIntentId: 'pi_idem',
    };
    fs.setDoc('transactions/tx_idem', txData);
    fs.setDoc('wallets/seller1', {
      balance: 0,
      pendingBalance: 4500,
      heldBalance: 0,
      status: 'active',
    });

    await deliverEvent(refundEvent({ eventId: 'evt_idem_a', paymentIntentId: 'pi_idem' }));
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
    expect(fs.getDoc('transactions/tx_idem')!.status).toBe('refunded');

    // Stripe re-delivers a DIFFERENT event.id for the same charge, so dedup does
    // NOT short-circuit; the per-status 'refunded' guard must. The live store now
    // reflects status='refunded' from the first run.
    await deliverEvent(refundEvent({ eventId: 'evt_idem_b', paymentIntentId: 'pi_idem' }));
    // No second debit — the guard skipped the already-refunded transaction.
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
  });

  // F101/F28: charge.refunded fires for partial refunds too — must NOT unwind.
  it('does NOT unwind the sale on a PARTIAL charge.refunded (review dead-letter)', async () => {
    fs.setDoc('transactions/tx_partial', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'paid',
      totalAmount: 50,
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      paidVia: 'card',
      deliveryType: 'shipping',
      articleId: 'article1',
      stripePaymentIntentId: 'pi_partial',
    });
    fs.setDoc('wallets/seller1', {
      balance: 0,
      pendingBalance: 4500,
      heldBalance: 0,
      status: 'active',
    });

    // Partial commercial gesture: refunded 500 of 5000.
    const res = await deliverEvent(
      refundEvent({
        eventId: 'evt_partial',
        paymentIntentId: 'pi_partial',
        amount: 5000,
        amountRefunded: 500,
      })
    );
    expect(res.statusCode).toBe(200);

    // Sale untouched: still paid, seller credit intact, no debit.
    expect(fs.getDoc('transactions/tx_partial')!.status).toBe('paid');
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(0);

    // A review dead-letter was written (autoRefund:false, kind partial).
    const dl = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('failed_operations/') &&
        op.data.type === 'amount_mismatch' &&
        (op.data.payload as Record<string, unknown>).kind === 'partial_charge_refund'
    );
    expect(dl).toBeDefined();
    expect((dl!.data.payload as Record<string, unknown>).autoRefund).toBe(false);
  });
});

// ===========================================================================
// 5. charge.dispute.created / closed — hold lifecycle (F37, F38)
// ===========================================================================

describe('Stripe webhook — dispute hold lifecycle', () => {
  function disputeCreatedEvent(opts: {
    eventId: string;
    paymentIntentId: string;
    disputeId?: string;
  }): Record<string, unknown> {
    return {
      id: opts.eventId,
      type: 'charge.dispute.created',
      data: {
        object: {
          id: opts.disputeId ?? 'dp_1',
          payment_intent: opts.paymentIntentId,
          reason: 'fraudulent',
          amount: 4500,
        },
      },
    };
  }

  function disputeClosedEvent(opts: {
    eventId: string;
    paymentIntentId: string;
    status: string;
    disputeId?: string;
  }): Record<string, unknown> {
    return {
      id: opts.eventId,
      type: 'charge.dispute.closed',
      data: {
        object: {
          id: opts.disputeId ?? 'dp_1',
          payment_intent: opts.paymentIntentId,
          status: opts.status,
        },
      },
    };
  }

  it('WON dispute releases the exact frozen hold (held -> balance)', async () => {
    // Funds were released to balance, then a dispute froze them into heldBalance.
    fs.setDoc('transactions/tx_won', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'completed',
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      paidVia: 'card',
      deliveryType: 'shipping',
      articleId: 'a',
      stripePaymentIntentId: 'pi_won',
    });
    fs.setDoc('wallets/seller1', {
      balance: 4500,
      pendingBalance: 0,
      heldBalance: 0,
      status: 'active',
    });

    await deliverEvent(disputeCreatedEvent({ eventId: 'evt_dc_won', paymentIntentId: 'pi_won' }));
    // Hold applied: 4500 moved balance -> held, persisted on the tx.
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(4500);
    expect(fs.getDoc('transactions/tx_won')!.disputeFreezeCents).toBe(4500);

    await deliverEvent(
      disputeClosedEvent({ eventId: 'evt_dx_won', paymentIntentId: 'pi_won', status: 'won' })
    );
    // F37: the exact hold is released back to withdrawable balance.
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(4500);
    expect(fs.getDoc('transactions/tx_won')!.disputed).toBe(false);
    expect(fs.getDoc('transactions/tx_won')!.status).toBe('completed');
  });

  it('warning_closed releases the hold like a won dispute', async () => {
    fs.setDoc('transactions/tx_warn', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'completed',
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      paidVia: 'card',
      deliveryType: 'shipping',
      stripePaymentIntentId: 'pi_warn',
    });
    fs.setDoc('wallets/seller1', {
      balance: 4500,
      pendingBalance: 0,
      heldBalance: 0,
      status: 'active',
    });

    await deliverEvent(disputeCreatedEvent({ eventId: 'evt_dc_warn', paymentIntentId: 'pi_warn' }));
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(4500);

    await deliverEvent(
      disputeClosedEvent({
        eventId: 'evt_dx_warn',
        paymentIntentId: 'pi_warn',
        status: 'warning_closed',
      })
    );
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(4500);
  });

  it('LOST dispute cascades the debit including pendingBalance (F38)', async () => {
    // Chargeback on a still-pending sale: the seller credit sits in pendingBalance.
    // The freeze at created moves nothing (balance is 0), and the LOST debit must
    // drain pendingBalance first — not other funds, not a false debt.
    fs.setDoc('transactions/tx_lost', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'shipped',
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      paidVia: 'card',
      deliveryType: 'shipping',
      stripePaymentIntentId: 'pi_lost',
    });
    fs.setDoc('wallets/seller1', {
      balance: 0,
      pendingBalance: 4500,
      heldBalance: 0,
      status: 'active',
    });

    await deliverEvent(disputeCreatedEvent({ eventId: 'evt_dc_lost', paymentIntentId: 'pi_lost' }));
    // Nothing in balance to freeze.
    expect(fs.getDoc('transactions/tx_lost')!.disputeFreezeCents).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);

    await deliverEvent(
      disputeClosedEvent({ eventId: 'evt_dx_lost', paymentIntentId: 'pi_lost', status: 'lost' })
    );
    // F38: debit drained pendingBalance — no other-bucket debit, no false debt.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.sellerDebt ?? 0).toBe(0);
    expect(fs.getDoc('transactions/tx_lost')!.status).toBe('refunded');
  });

  it('LOST dispute on an UNCREDITED tx releases the frozen surplus (F37)', async () => {
    // The tx was frozen (funds were in balance) but never credited for THIS sale
    // (sellerCreditedCents = 0). The LOST debit target is 0, so the frozen amount
    // must be returned to balance, not stranded in heldBalance.
    fs.setDoc('transactions/tx_lost2', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'completed',
      sellerPayout: 45,
      // no sellerCreditedCents
      paidVia: 'card',
      deliveryType: 'shipping',
      stripePaymentIntentId: 'pi_lost2',
    });
    fs.setDoc('wallets/seller1', {
      balance: 4500,
      pendingBalance: 0,
      heldBalance: 0,
      status: 'active',
    });

    await deliverEvent(disputeCreatedEvent({ eventId: 'evt_dc_l2', paymentIntentId: 'pi_lost2' }));
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(4500);
    expect(fs.getDoc('transactions/tx_lost2')!.disputeFreezeCents).toBe(4500);

    await deliverEvent(
      disputeClosedEvent({ eventId: 'evt_dx_l2', paymentIntentId: 'pi_lost2', status: 'lost' })
    );
    // Debit target 0 (uncredited), so the surplus hold is released back.
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(0);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(4500);
    expect(fs.getDoc('wallets/seller1')!.sellerDebt ?? 0).toBe(0);
  });
});

// ===========================================================================
// 6. payout.failed — re-credit wallet + reverse transfer (F36, F99)
// ===========================================================================

describe('Stripe webhook — payout.failed recovery', () => {
  function payoutFailedEvent(opts: {
    eventId: string;
    withdrawalRequestId: string;
    payoutId?: string;
    userId?: string;
  }): Record<string, unknown> {
    return {
      id: opts.eventId,
      type: 'payout.failed',
      data: {
        object: {
          id: opts.payoutId ?? 'po_failed',
          failure_message: 'invalid bank account',
          metadata: {
            withdrawalRequestId: opts.withdrawalRequestId,
            firebaseUserId: opts.userId ?? 'seller1',
          },
        },
      },
    };
  }

  it('re-credits the wallet AND reverses the persisted transfer', async () => {
    fs.setDoc('withdrawal_requests/wr1', {
      userId: 'seller1',
      amount: 2000, // cents
      status: 'processing',
      stripeTransferId: 'tr_wr1',
      stripePayoutId: 'po_failed',
      stripeAccountId: 'acct_1',
    });
    fs.setDoc('wallets/seller1', { balance: 0, status: 'active' });

    const res = await deliverEvent(
      payoutFailedEvent({ eventId: 'evt_po_fail', withdrawalRequestId: 'wr1' })
    );
    expect(res.statusCode).toBe(200);

    // Wallet re-credited.
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(2000);
    // Request marked failed.
    expect(fs.getDoc('withdrawal_requests/wr1')!.status).toBe('failed');
    // F99: the platform->connected transfer was reversed with the deterministic key.
    expect(stripeMock.calls.transfersCreateReversal.length).toBe(1);
    expect(stripeMock.calls.transfersCreateReversal[0][0]).toBe('tr_wr1');
    const revOpts = stripeMock.calls.transfersCreateReversal[0][2] as Record<string, unknown>;
    expect(revOpts.idempotencyKey).toBe('rev_tr_wr1');
  });

  it('is idempotent: a replayed payout.failed does not double-credit', async () => {
    fs.setDoc('withdrawal_requests/wr2', {
      userId: 'seller1',
      amount: 3000,
      status: 'processing',
      stripeTransferId: 'tr_wr2',
    });
    fs.setDoc('wallets/seller1', { balance: 0, status: 'active' });

    await deliverEvent(
      payoutFailedEvent({ eventId: 'evt_po_a', withdrawalRequestId: 'wr2', payoutId: 'po_a' })
    );
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);

    // Stripe re-delivers a different event.id for the same payout — dedup does NOT
    // short-circuit; the request status guard ('failed' != 'processing') must.
    await deliverEvent(
      payoutFailedEvent({ eventId: 'evt_po_b', withdrawalRequestId: 'wr2', payoutId: 'po_a' })
    );
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);
    expect(fs.sumIncrements('wallets/seller1', 'balance')).toBe(3000);
  });
});

// ===========================================================================
// 7. F3/F98 — marker is written ONLY after the handler succeeds.
//    A thrown handler returns 500 with NO marker, so Stripe's retry re-runs it.
// ===========================================================================

describe('Stripe webhook — idempotence marker after success (F3)', () => {
  it('does NOT persist the marker when the handler throws (event is replayable)', async () => {
    fs.setDoc('transactions/tx_f3', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 50,
      sellerPayout: 45,
      deliveryType: 'meetup',
      articleId: 'a',
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    const event = piSucceededEvent({
      eventId: 'evt_f3',
      transactionId: 'tx_f3',
      amountCents: 5000,
    });

    // Force the handler to throw on the FIRST delivery (simulates a Firestore
    // UNAVAILABLE / contention / the old read-after-write throw).
    const realRunTransaction = fs.db.runTransaction;
    fs.db.runTransaction = (async () => {
      throw new Error('simulated Firestore failure');
    }) as typeof fs.db.runTransaction;

    const res1 = await deliverEvent(event);
    // Top-level catch returns 500 so Stripe re-delivers.
    expect(res1.statusCode).toBe(500);
    // No marker was written — the event is NOT considered handled.
    expect(fs.getDoc('stripe_events/evt_f3')).toBeUndefined();
    // No credit happened.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);

    // Stripe retries the SAME event.id. The handler now succeeds.
    fs.db.runTransaction = realRunTransaction;
    const res2 = await deliverEvent(event);
    expect(res2.statusCode).toBe(200);
    // The handler ran this time — seller credited, tx paid.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);
    expect(fs.getDoc('transactions/tx_f3')!.status).toBe('paid');
    // Marker now persisted exactly once.
    const markerWrites = fs.countWrites(
      (op: WriteOp) => op.path === 'stripe_events/evt_f3' && op.method === 'create'
    );
    expect(markerWrites).toBe(1);
  });
});

// ===========================================================================
// 8. F100 — two endpoint secrets (platform + Connect). The event is accepted
//    when EITHER secret verifies; rejected (401) only when NONE do.
// ===========================================================================

describe('Stripe webhook — dual signing secrets (F100)', () => {
  function deliverWithSecretAware(
    event: Record<string, unknown>,
    validSecret: string
  ): Promise<FakeRes> {
    // constructEvent succeeds only when called with the matching secret.
    stripeMock.impl.constructEvent = (...a: unknown[]) => {
      const secret = a[2] as string;
      if (secret !== validSecret) {
        throw new Error('No signatures found matching the expected signature');
      }
      return event;
    };
    const res = makeRes();
    return handler(makeReq(), res).then(() => res);
  }

  function seedMeetupTx(txId: string) {
    fs.setDoc(`transactions/${txId}`, {
      buyerId: 'b',
      sellerId: 's',
      status: 'pending_payment',
      totalAmount: 10,
      sellerPayout: 9,
      deliveryType: 'meetup',
      articleId: 'a',
    });
    fs.setDoc('wallets/s', { balance: 0, pendingBalance: 0, status: 'active' });
  }

  it('accepts an event signed with the CONNECT secret (platform secret fails)', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect';
    seedMeetupTx('tx_connect');

    const event = piSucceededEvent({
      eventId: 'evt_connect',
      transactionId: 'tx_connect',
      amountCents: 1000,
    });

    const res = await deliverWithSecretAware(event, 'whsec_connect');
    expect(res.statusCode).toBe(200);
    // Handler ran (proves the event was accepted via the 2nd secret).
    expect(fs.getDoc('transactions/tx_connect')!.status).toBe('paid');
  });

  it('accepts an event signed with the PLATFORM secret', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect';
    seedMeetupTx('tx_platform');

    const event = piSucceededEvent({
      eventId: 'evt_platform',
      transactionId: 'tx_platform',
      amountCents: 1000,
    });

    const res = await deliverWithSecretAware(event, 'whsec_platform');
    expect(res.statusCode).toBe(200);
    expect(fs.getDoc('transactions/tx_platform')!.status).toBe('paid');
  });

  it('rejects (401) when NEITHER secret verifies', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect';

    const event = piSucceededEvent({
      eventId: 'evt_bad_sig',
      transactionId: 'tx_x',
      amountCents: 1000,
    });

    const res = await deliverWithSecretAware(event, 'whsec_some_other_secret');
    expect(res.statusCode).toBe(401);
  });

  afterEach(() => {
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  });
});

// ===========================================================================
// 9. F102 — payment_intent.payment_failed is emitted PER attempt. Cancel only
//    when the live PaymentIntent is TERMINAL ('canceled'), not on a retry.
// ===========================================================================

describe('Stripe webhook — payment_failed is per-attempt (F102)', () => {
  function paymentFailedEvent(opts: {
    eventId: string;
    transactionId: string;
    paymentIntentId?: string;
  }): Record<string, unknown> {
    return {
      id: opts.eventId,
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: opts.paymentIntentId ?? 'pi_fail',
          last_payment_error: { message: 'card_declined' },
          metadata: { transactionId: opts.transactionId },
        },
      },
    };
  }

  function seedPending(txId: string) {
    fs.setDoc(`transactions/${txId}`, {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 50,
      articleId: 'article1',
    });
    fs.setDoc('articles/article1', { isSold: true });
  }

  it('does NOT cancel the transaction on a retryable attempt (PI not terminal)', async () => {
    seedPending('tx_retry');
    // Live PI is still retryable (buyer can fix the card in the same sheet).
    stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'requires_payment_method' });

    const res = await deliverEvent(
      paymentFailedEvent({ eventId: 'evt_fail_retry', transactionId: 'tx_retry' })
    );
    expect(res.statusCode).toBe(200);

    // Transaction untouched: still pending_payment, article still locked.
    expect(fs.getDoc('transactions/tx_retry')!.status).toBe('pending_payment');
    expect(fs.getDoc('articles/article1')!.isSold).toBe(true);
  });

  it('cancels and releases the article when the PI is TERMINAL (canceled)', async () => {
    seedPending('tx_terminal');
    stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'canceled' });

    const res = await deliverEvent(
      paymentFailedEvent({ eventId: 'evt_fail_terminal', transactionId: 'tx_terminal' })
    );
    expect(res.statusCode).toBe(200);

    expect(fs.getDoc('transactions/tx_terminal')!.status).toBe('cancelled');
    expect(fs.getDoc('transactions/tx_terminal')!.cancelReason).toBe('payment_failed');
    expect(fs.getDoc('articles/article1')!.isSold).toBe(false);
  });

  it('restores the buyer wallet portion on a TERMINAL mixed-payment failure', async () => {
    fs.setDoc('transactions/tx_mixed_fail', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      totalAmount: 50,
      articleId: 'article1',
      paidVia: 'wallet_and_card',
      walletAmountUsed: 2000, // cents
    });
    fs.setDoc('articles/article1', { isSold: true });
    fs.setDoc('wallets/buyer1', { balance: 500, status: 'active' });
    stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'canceled' });

    const res = await deliverEvent(
      paymentFailedEvent({ eventId: 'evt_mixed_fail', transactionId: 'tx_mixed_fail' })
    );
    expect(res.statusCode).toBe(200);

    expect(fs.getDoc('transactions/tx_mixed_fail')!.status).toBe('cancelled');
    // Wallet portion (2000) restored to the buyer (no read-after-write throw).
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(2500);
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(2000);
  });
});
