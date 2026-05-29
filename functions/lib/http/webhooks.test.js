"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
 *  4. handleChargeRefunded => debit correct bucket + reverse_transfer on refund.
 *  (transactionExpiration + walletWithdraw + shipping re-pricing live in their
 *   own *.test.ts files.)
 */
const vitest_1 = require("vitest");
const firestoreMock_1 = require("../utils/testHelpers/firestoreMock");
// ---------------------------------------------------------------------------
// Mock state. vi.mock factories are hoisted above imports, so they may only
// reference symbols produced by vi.hoisted. We hoist a single mutable holder
// (sync, no imports — safe at hoist time) and populate it from the module body
// BELOW, before the unit-under-test is imported. The factories read through the
// holder LAZILY (only when the mocked module is first loaded, i.e. after this
// body has run), so the late assignment is visible.
// ---------------------------------------------------------------------------
const holder = vitest_1.vi.hoisted(() => ({
    fs: null,
    stripeMock: null,
    pushCalls: [],
}));
const fs = (0, firestoreMock_1.createFirestoreMock)();
const stripeMock = (0, firestoreMock_1.createStripeMock)();
const pushCalls = holder.pushCalls;
holder.fs = fs;
holder.stripeMock = stripeMock;
vitest_1.vi.mock('../config/firebase', () => ({
    db: fs.db,
    FieldValue: fs.FieldValue,
}));
vitest_1.vi.mock('../config/stripe', () => ({
    getStripe: () => stripeMock.client,
}));
vitest_1.vi.mock('../config/shipEngine', () => ({
    // No label creation exercised in these tests (we use meetup/non-shipping or
    // assert before the label step). Returning null defers to sweepPendingLabels.
    getShipEngine: () => null,
}));
vitest_1.vi.mock('../utils/notifications', () => ({
    sendPushNotification: (...a) => {
        pushCalls.push(a);
        return Promise.resolve();
    },
}));
vitest_1.vi.mock('firebase-functions/logger', () => ({
    info: () => { },
    error: () => { },
    warn: () => { },
    debug: () => { },
}));
vitest_1.vi.mock('firebase-functions/v2/https', () => {
    class _HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
            this.name = 'HttpsError';
        }
    }
    return {
        // onRequest returns the raw (req,res) handler so we can call it directly.
        onRequest: (_opts, handler) => handler,
        // wallet.ts (imported transitively for getOrCreateSellerWallet) registers
        // onCall handlers at module load; return the raw handler too.
        onCall: (_opts, handler) => handler,
        HttpsError: _HttpsError,
    };
});
// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------
const webhooks_1 = require("./webhooks");
const handler = webhooks_1.stripeWebhook;
function makeRes() {
    const res = {
        statusCode: null,
        body: undefined,
        jsonBody: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
        json(body) {
            this.jsonBody = body;
            if (this.statusCode === null)
                this.statusCode = 200;
            return this;
        },
    };
    return res;
}
function makeReq() {
    return {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        rawBody: Buffer.from('{}'),
    };
}
/**
 * Stub Stripe.constructEvent to return a fixed event, then invoke the webhook.
 */
async function deliverEvent(event) {
    stripeMock.impl.constructEvent = () => event;
    const res = makeRes();
    await handler(makeReq(), res);
    return res;
}
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SECRET = 'whsec_test';
(0, vitest_1.beforeEach)(() => {
    fs.reset();
    stripeMock.reset();
    pushCalls.length = 0;
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});
function piSucceededEvent(opts) {
    var _a, _b;
    return {
        id: opts.eventId,
        type: 'payment_intent.succeeded',
        data: {
            object: {
                id: (_a = opts.paymentIntentId) !== null && _a !== void 0 ? _a : 'pi_test',
                amount: opts.amountCents,
                amount_received: opts.amountCents,
                latest_charge: 'ch_test',
                metadata: Object.assign({ transactionId: opts.transactionId }, ((_b = opts.metadata) !== null && _b !== void 0 ? _b : {})),
            },
        },
    };
}
// ===========================================================================
// 1. Replay of the same event.id => no double credit (dedup stripe_events)
// ===========================================================================
(0, vitest_1.describe)('Stripe webhook — event dedup (stripe_events)', () => {
    (0, vitest_1.it)('credits the seller exactly once for a meetup (non-shipping) sale', async () => {
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
        (0, vitest_1.expect)(res1.statusCode).toBe(200);
        (0, vitest_1.expect)(res1.jsonBody).toEqual({ received: true });
        // Seller credited 4500 cents in pendingBalance.
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(4500);
        // tx marked paid + sellerCreditedCents persisted.
        (0, vitest_1.expect)(fs.getDoc('transactions/tx1').status).toBe('paid');
        (0, vitest_1.expect)(fs.getDoc('transactions/tx1').sellerCreditedCents).toBe(4500);
        const creditWritesAfterFirst = fs.sumIncrements('wallets/seller1', 'pendingBalance');
        (0, vitest_1.expect)(creditWritesAfterFirst).toBe(4500);
        // --- REPLAY the exact same event.id ---
        const res2 = await deliverEvent(event);
        (0, vitest_1.expect)(res2.statusCode).toBe(200);
        (0, vitest_1.expect)(res2.jsonBody).toEqual({ received: true });
        // Pending balance UNCHANGED — no double credit.
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(4500);
        (0, vitest_1.expect)(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(4500);
    });
    (0, vitest_1.it)('creates a stripe_events marker the first time only', async () => {
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
        const markerWrites1 = fs.countWrites((op) => op.path === 'stripe_events/evt_marker' && op.method === 'create');
        (0, vitest_1.expect)(markerWrites1).toBe(1);
        (0, vitest_1.expect)(fs.getDoc('stripe_events/evt_marker')).toBeDefined();
        await deliverEvent(event);
        // Still exactly one create — the replay short-circuits on the existing marker.
        const markerWrites2 = fs.countWrites((op) => op.path === 'stripe_events/evt_marker' && op.method === 'create');
        (0, vitest_1.expect)(markerWrites2).toBe(1);
    });
});
// ===========================================================================
// 2. Amount mismatch => not paid + failed_operations + deterministic 200
// ===========================================================================
(0, vitest_1.describe)('Stripe webhook — amount mismatch (deterministic dead-letter)', () => {
    (0, vitest_1.it)('does NOT mark paid, writes a failed_operations dead-letter, ACKs 200', async () => {
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
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        (0, vitest_1.expect)(res.jsonBody).toEqual({ received: true });
        // Transaction NOT marked paid.
        (0, vitest_1.expect)(fs.getDoc('transactions/tx1').status).toBe('pending_payment');
        // Seller NOT credited.
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(0);
        // A failed_operations dead-letter was written with type amount_mismatch.
        const deadLetters = fs.writeOps.filter((op) => op.path.startsWith('failed_operations/') &&
            op.method === 'set' &&
            op.data.type === 'amount_mismatch');
        (0, vitest_1.expect)(deadLetters.length).toBe(1);
        (0, vitest_1.expect)(deadLetters[0].data.refId).toBe('tx1');
        // Underpayment must NOT auto-refund (business decision).
        (0, vitest_1.expect)(deadLetters[0].data.payload.autoRefund).toBe(false);
        // No Stripe refund issued for an underpayment.
        (0, vitest_1.expect)(stripeMock.calls.refundsCreate.length).toBe(0);
    });
    (0, vitest_1.it)('auto-refunds the buyer (idempotent key) when buyer OVERPAID', async () => {
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
        let refundOpts;
        stripeMock.impl.refundsCreate = (...a) => {
            refundOpts = a[1];
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
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        // Still not paid, seller not credited.
        (0, vitest_1.expect)(fs.getDoc('transactions/tx1').status).toBe('pending_payment');
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(0);
        // Auto-refund issued with a deterministic idempotency key.
        (0, vitest_1.expect)(stripeMock.calls.refundsCreate.length).toBe(1);
        const refundArgs = stripeMock.calls.refundsCreate[0][0];
        (0, vitest_1.expect)(refundArgs.payment_intent).toBe('pi_over');
        (0, vitest_1.expect)(refundArgs.reverse_transfer).toBe(true);
        (0, vitest_1.expect)(refundOpts.idempotencyKey).toBe('rf_mismatch_tx1');
        // Dead-letter records autoRefund: true.
        const dl = fs.writeOps.find((op) => op.path.startsWith('failed_operations/') && op.data.type === 'amount_mismatch');
        (0, vitest_1.expect)(dl.data.payload.autoRefund).toBe(true);
    });
});
// ===========================================================================
// 3. Swap top-up => exactly one fund movement (no double credit, no transfer)
// ===========================================================================
(0, vitest_1.describe)('Stripe webhook — swap top-up (single fund movement)', () => {
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
    function swapTopUpEvent(eventId) {
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
    (0, vitest_1.it)('credits payee pendingBalance ONCE with the base amount (fee kept)', async () => {
        seedSwap();
        const event = swapTopUpEvent('evt_swap1');
        const res = await deliverEvent(event);
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        // Base 1000 credited to pendingBalance (escrow), fee 200 kept by platform.
        (0, vitest_1.expect)(fs.getDoc('wallets/userB').pendingBalance).toBe(1000);
        // Swap advanced to accepted.
        (0, vitest_1.expect)(fs.getDoc('swaps/swap1').status).toBe('accepted');
        // No Stripe transfer / destination charge involved (cash top-up is a plain
        // platform charge; the credit is an internal ledger movement only).
        (0, vitest_1.expect)(stripeMock.calls.transfersCreate.length).toBe(0);
        (0, vitest_1.expect)(fs.sumIncrements('wallets/userB', 'pendingBalance')).toBe(1000);
    });
    (0, vitest_1.it)('replay of the swap top-up event does not double-credit', async () => {
        seedSwap();
        const event = swapTopUpEvent('evt_swap_replay');
        await deliverEvent(event);
        (0, vitest_1.expect)(fs.getDoc('wallets/userB').pendingBalance).toBe(1000);
        // Replay same event.id — dedup short-circuits before the handler runs.
        await deliverEvent(event);
        (0, vitest_1.expect)(fs.getDoc('wallets/userB').pendingBalance).toBe(1000);
        (0, vitest_1.expect)(fs.sumIncrements('wallets/userB', 'pendingBalance')).toBe(1000);
    });
    (0, vitest_1.it)('rejects (throws -> 500) on swap top-up amount mismatch, no credit', async () => {
        seedSwap();
        const event = swapTopUpEvent('evt_swap_bad');
        // Tamper amount: charged 999 but expected 1200 (1000 + 200 fee).
        event.data.object.amount = 999;
        event.data.object.amount_received = 999;
        const res = await deliverEvent(event);
        // The swap top-up handler THROWS on mismatch -> outer catch -> 500.
        (0, vitest_1.expect)(res.statusCode).toBe(500);
        // No credit applied.
        (0, vitest_1.expect)(fs.getDoc('wallets/userB').pendingBalance).toBe(0);
        (0, vitest_1.expect)(fs.getDoc('swaps/swap1').status).toBe('payment_pending');
    });
});
// ===========================================================================
// 4. handleChargeRefunded => debit correct bucket + reverse_transfer
// ===========================================================================
(0, vitest_1.describe)('Stripe webhook — charge.refunded (bucket debit + reverse_transfer)', () => {
    function refundEvent(opts) {
        var _a;
        return {
            id: opts.eventId,
            type: 'charge.refunded',
            data: {
                object: {
                    id: 'ch_refund',
                    payment_intent: opts.paymentIntentId,
                    refunds: { data: [{ id: (_a = opts.refundId) !== null && _a !== void 0 ? _a : 'rf_ch' }] },
                },
            },
        };
    }
    (0, vitest_1.it)('debits the seller pendingBalance bucket by exactly sellerCreditedCents', async () => {
        var _a;
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
        const res = await deliverEvent(refundEvent({ eventId: 'evt_ref', paymentIntentId: 'pi_ref' }));
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        // Debited exactly from pendingBalance.
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(0);
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').balance).toBe(0);
        // No phantom debt (held enough in pending).
        (0, vitest_1.expect)((_a = fs.getDoc('wallets/seller1').sellerDebt) !== null && _a !== void 0 ? _a : 0).toBe(0);
        // Transaction marked refunded.
        (0, vitest_1.expect)(fs.getDoc('transactions/tx_ref').status).toBe('refunded');
        (0, vitest_1.expect)(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);
    });
    (0, vitest_1.it)('records sellerDebt when the seller already withdrew (balance short)', async () => {
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
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').sellerDebt).toBe(4500);
        (0, vitest_1.expect)(fs.sumIncrements('wallets/seller1', 'sellerDebt')).toBe(4500);
    });
    (0, vitest_1.it)('refunds the wallet portion to the buyer for a mixed payment', async () => {
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
        (0, vitest_1.expect)(fs.getDoc('wallets/buyer1').balance).toBe(3000);
        (0, vitest_1.expect)(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(2000);
        // Seller debited pending.
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(0);
    });
    (0, vitest_1.it)('is idempotent: replaying charge.refunded does not double-debit', async () => {
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
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(0);
        (0, vitest_1.expect)(fs.getDoc('transactions/tx_idem').status).toBe('refunded');
        // Stripe re-delivers a DIFFERENT event.id for the same charge, so dedup does
        // NOT short-circuit; the per-status 'refunded' guard must. The live store now
        // reflects status='refunded' from the first run.
        await deliverEvent(refundEvent({ eventId: 'evt_idem_b', paymentIntentId: 'pi_idem' }));
        // No second debit — the guard skipped the already-refunded transaction.
        (0, vitest_1.expect)(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(0);
    });
});
//# sourceMappingURL=webhooks.test.js.map