"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Integration-style tests for expireOrphanedTransactions (scheduled refunds).
 *
 * Drives the REAL onSchedule handler against an in-memory Firestore + a Stripe
 * mock. Focus (per chantier brief, item 5):
 *  - Refund is idempotent: a 2nd run does NOT issue a 2nd Stripe refund nor
 *    double-debit/credit wallets.
 *  - A 'pending_payment' tx whose PaymentIntent is 'succeeded' is NOT expired
 *    (expiry must never race a captured payment).
 */
const vitest_1 = require("vitest");
const { fs, stripeMock, pushCalls } = await vitest_1.vi.hoisted(async () => {
    const { createFirestoreMock, createStripeMock } = await Promise.resolve().then(() => __importStar(require('../utils/testHelpers/firestoreMock')));
    return {
        fs: createFirestoreMock(),
        stripeMock: createStripeMock(),
        pushCalls: [],
    };
});
vitest_1.vi.mock('../config/firebase', () => ({
    db: fs.db,
    FieldValue: fs.FieldValue,
}));
vitest_1.vi.mock('../config/stripe', () => ({
    getStripe: () => stripeMock.client,
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
vitest_1.vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts, handler) => handler,
}));
const transactionExpiration_1 = require("./transactionExpiration");
const runScheduler = transactionExpiration_1.expireOrphanedTransactions;
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
(0, vitest_1.beforeEach)(() => {
    fs.reset();
    stripeMock.reset();
    pushCalls.length = 0;
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    // Default: PI retrieve returns a non-in-flight status (safe to expire).
    stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'requires_payment_method' });
    stripeMock.impl.paymentIntentsCancel = async () => ({ id: 'pi_cancelled' });
});
// ===========================================================================
// 5a. paid-not-shipped refund is idempotent across runs
// ===========================================================================
(0, vitest_1.describe)('expireOrphanedTransactions — paid-not-shipped refund idempotency', () => {
    function seedPaidNotShipped() {
        const createdAt = new Date(Date.now() - EIGHT_DAYS_MS);
        fs.setDoc('transactions/txp', {
            buyerId: 'buyer1',
            sellerId: 'seller1',
            status: 'paid',
            sellerPayout: 45, // dollars
            totalAmount: 50,
            paidVia: 'card',
            deliveryType: 'shipping',
            articleId: 'article1',
            stripePaymentIntentId: 'pi_paid',
            createdAt,
        });
        fs.setDoc('articles/article1', { isSold: true });
        fs.setDoc('wallets/seller1', {
            balance: 0,
            pendingBalance: 4500, // seller credited at label time
            status: 'active',
        });
    }
    (0, vitest_1.it)('refunds once and finalizes to refunded', async () => {
        seedPaidNotShipped();
        let refundCount = 0;
        stripeMock.impl.refundsCreate = (...a) => {
            refundCount++;
            return { id: 'rf_paid' };
        };
        await runScheduler();
        // One Stripe refund with reverse_transfer for a destination (card) charge.
        (0, vitest_1.expect)(refundCount).toBe(1);
        const refundArgs = stripeMock.calls.refundsCreate[0][0];
        (0, vitest_1.expect)(refundArgs.payment_intent).toBe('pi_paid');
        (0, vitest_1.expect)(refundArgs.reverse_transfer).toBe(true);
        const refundOpts = stripeMock.calls.refundsCreate[0][1];
        (0, vitest_1.expect)(refundOpts.idempotencyKey).toBe('rf_txp');
        // Final state: refunded, article released, seller pending debited.
        (0, vitest_1.expect)(fs.getDoc('transactions/txp').status).toBe('refunded');
        (0, vitest_1.expect)(fs.getDoc('articles/article1').isSold).toBe(false);
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(0);
        (0, vitest_1.expect)(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);
    });
    (0, vitest_1.it)('a 2nd scheduled run does NOT double-refund nor double-debit', async () => {
        seedPaidNotShipped();
        let refundCount = 0;
        stripeMock.impl.refundsCreate = () => {
            refundCount++;
            return { id: 'rf_paid' };
        };
        await runScheduler();
        (0, vitest_1.expect)(refundCount).toBe(1);
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(0);
        // Second run: the tx is now 'refunded' — no status matches the 'paid' query,
        // so refundPaidNotShipped never runs again.
        await runScheduler();
        (0, vitest_1.expect)(refundCount).toBe(1); // still one
        (0, vitest_1.expect)(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500); // unchanged
        (0, vitest_1.expect)(fs.getDoc('transactions/txp').status).toBe('refunded');
    });
    (0, vitest_1.it)('resumes a refund_in_progress without issuing a 2nd Stripe refund', async () => {
        // Crash recovery: tx already flagged refund_in_progress + stripeRefundId set.
        fs.setDoc('transactions/txr', {
            buyerId: 'buyer1',
            sellerId: 'seller1',
            status: 'refund_in_progress',
            sellerPayout: 45,
            paidVia: 'card',
            deliveryType: 'shipping',
            articleId: 'a',
            stripePaymentIntentId: 'pi_resume',
            stripeRefundId: 'rf_already', // already refunded on a prior crashed run
            createdAt: new Date(Date.now() - EIGHT_DAYS_MS),
        });
        fs.setDoc('articles/a', { isSold: true });
        fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 4500, status: 'active' });
        let refundCount = 0;
        stripeMock.impl.refundsCreate = () => {
            refundCount++;
            return { id: 'rf_new' };
        };
        await runScheduler();
        // No new Stripe refund (existing stripeRefundId reused).
        (0, vitest_1.expect)(refundCount).toBe(0);
        (0, vitest_1.expect)(fs.getDoc('transactions/txr').status).toBe('refunded');
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').pendingBalance).toBe(0);
    });
    (0, vitest_1.it)('passes NO reverse_transfer for a mixed wallet+card charge', async () => {
        fs.setDoc('transactions/txm', {
            buyerId: 'buyer1',
            sellerId: 'seller1',
            status: 'paid',
            sellerPayout: 45,
            paidVia: 'wallet_and_card',
            walletAmountUsed: 2000, // cents
            deliveryType: 'shipping',
            articleId: 'a',
            stripePaymentIntentId: 'pi_mixed',
            createdAt: new Date(Date.now() - EIGHT_DAYS_MS),
        });
        fs.setDoc('articles/a', { isSold: true });
        fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 4500, status: 'active' });
        fs.setDoc('wallets/buyer1', { balance: 500, status: 'active' });
        stripeMock.impl.refundsCreate = () => ({ id: 'rf_mixed' });
        await runScheduler();
        const refundArgs = stripeMock.calls.refundsCreate[0][0];
        (0, vitest_1.expect)(refundArgs.payment_intent).toBe('pi_mixed');
        // Mixed charge is a direct platform charge — nothing to reverse.
        (0, vitest_1.expect)(refundArgs.reverse_transfer).toBeUndefined();
        (0, vitest_1.expect)(refundArgs.refund_application_fee).toBeUndefined();
        // Buyer wallet portion (2000 cents) refunded.
        (0, vitest_1.expect)(fs.getDoc('wallets/buyer1').balance).toBe(2500);
    });
});
// ===========================================================================
// 5b. pending_payment with a succeeded PI is NOT expired
// ===========================================================================
(0, vitest_1.describe)('expireOrphanedTransactions — does not expire in-flight payments', () => {
    function seedPendingPayment(piStatus) {
        fs.setDoc('transactions/txpend', {
            buyerId: 'buyer1',
            sellerId: 'seller1',
            status: 'pending_payment',
            deliveryType: 'shipping',
            articleId: 'article1',
            stripePaymentIntentId: 'pi_pend',
            createdAt: new Date(Date.now() - TWO_HOURS_MS), // older than 1h cutoff
        });
        fs.setDoc('articles/article1', { isSold: true });
        stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: piStatus });
    }
    (0, vitest_1.it)('does NOT cancel a pending_payment whose PI is succeeded', async () => {
        seedPendingPayment('succeeded');
        await runScheduler();
        // Left untouched — the PI.succeeded webhook will finish the job.
        (0, vitest_1.expect)(fs.getDoc('transactions/txpend').status).toBe('pending_payment');
        (0, vitest_1.expect)(fs.getDoc('articles/article1').isSold).toBe(true);
        // The PI is NOT cancelled (it already captured).
        (0, vitest_1.expect)(stripeMock.calls.paymentIntentsCancel.length).toBe(0);
    });
    (0, vitest_1.it)('does NOT cancel a pending_payment whose PI requires_capture', async () => {
        seedPendingPayment('requires_capture');
        await runScheduler();
        (0, vitest_1.expect)(fs.getDoc('transactions/txpend').status).toBe('pending_payment');
        (0, vitest_1.expect)(stripeMock.calls.paymentIntentsCancel.length).toBe(0);
    });
    (0, vitest_1.it)('DOES cancel + expire a pending_payment whose PI is abandoned', async () => {
        seedPendingPayment('requires_payment_method');
        await runScheduler();
        // PI cancelled to block any late capture, then tx expired + article released.
        (0, vitest_1.expect)(stripeMock.calls.paymentIntentsCancel.length).toBe(1);
        (0, vitest_1.expect)(fs.getDoc('transactions/txpend').status).toBe('cancelled');
        (0, vitest_1.expect)(fs.getDoc('transactions/txpend').cancelReason).toBe('pending_payment_expired_1h');
        (0, vitest_1.expect)(fs.getDoc('articles/article1').isSold).toBe(false);
    });
    (0, vitest_1.it)('skips a labelCreationPending paid tx (owned by sweepPendingLabels)', async () => {
        fs.setDoc('transactions/txlp', {
            buyerId: 'buyer1',
            sellerId: 'seller1',
            status: 'paid',
            sellerPayout: 45,
            paidVia: 'card',
            deliveryType: 'shipping',
            articleId: 'a',
            labelCreationPending: true,
            stripePaymentIntentId: 'pi_lp',
            createdAt: new Date(Date.now() - EIGHT_DAYS_MS),
        });
        fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });
        let refundCount = 0;
        stripeMock.impl.refundsCreate = () => {
            refundCount++;
            return { id: 'rf' };
        };
        await runScheduler();
        // Not refunded here — the sweep job owns it.
        (0, vitest_1.expect)(refundCount).toBe(0);
        (0, vitest_1.expect)(fs.getDoc('transactions/txlp').status).toBe('paid');
    });
});
//# sourceMappingURL=transactionExpiration.test.js.map