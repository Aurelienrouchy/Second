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
const vitest_1 = require("vitest");
const { fs, stripeMock } = await vitest_1.vi.hoisted(async () => {
    const { createFirestoreMock, createStripeMock } = await Promise.resolve().then(() => __importStar(require('../utils/testHelpers/firestoreMock')));
    return {
        fs: createFirestoreMock(),
        stripeMock: createStripeMock(),
    };
});
vitest_1.vi.mock('../config/firebase', () => ({
    db: fs.db,
    FieldValue: fs.FieldValue,
}));
vitest_1.vi.mock('../config/stripe', () => ({
    getStripe: () => stripeMock.client,
}));
vitest_1.vi.mock('../config/shipEngine', () => ({
    getShipEngine: () => null,
}));
vitest_1.vi.mock('../utils/rateLimit', () => ({
    // No-op rate limiter for tests.
    checkRateLimit: async () => { },
    resolveCallerKey: (request) => {
        var _a, _b;
        return ({
            callerKey: (_b = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : 'anon',
            isAuthenticated: !!request.auth,
        });
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
        onCall: (_opts, handler) => handler,
        HttpsError: _HttpsError,
    };
});
const wallet_1 = require("./wallet");
const callWithdraw = wallet_1.walletWithdraw;
/** Seed a fully payout-enabled seller + active wallet with a withdrawable balance. */
function seedSeller(opts) {
    const { balance = 5000, heldBalance = 0, pendingBalance = 0, sellerDebt = 0 } = opts !== null && opts !== void 0 ? opts : {};
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
(0, vitest_1.beforeEach)(() => {
    fs.reset();
    stripeMock.reset();
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    stripeMock.impl.transfersCreate = async () => ({ id: 'tr_ok' });
    stripeMock.impl.payoutsCreate = async () => ({ id: 'po_ok' });
});
// ===========================================================================
// 6a. Dispute guard
// ===========================================================================
(0, vitest_1.describe)('walletWithdraw — dispute guard', () => {
    (0, vitest_1.it)('refuses withdrawal while a sale is disputed', async () => {
        seedSeller({ balance: 5000 });
        // An active dispute on one of the seller's sales.
        fs.setDoc('transactions/txd', {
            sellerId: 'seller1',
            buyerId: 'buyer1',
            status: 'disputed',
            disputed: true,
        });
        await (0, vitest_1.expect)(callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })).rejects.toThrow('litige');
        // No money moved.
        (0, vitest_1.expect)(stripeMock.calls.transfersCreate.length).toBe(0);
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').balance).toBe(5000);
    });
    (0, vitest_1.it)('allows withdrawal when the only disputed sale belongs to ANOTHER seller', async () => {
        seedSeller({ balance: 5000 });
        // Disputed sale for a different seller — must not block seller1.
        fs.setDoc('transactions/txd', {
            sellerId: 'someoneElse',
            buyerId: 'buyer1',
            status: 'disputed',
            disputed: true,
        });
        const result = await callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').balance).toBe(3000);
    });
});
// ===========================================================================
// 6b. sellerDebt guard
// ===========================================================================
(0, vitest_1.describe)('walletWithdraw — sellerDebt guard', () => {
    (0, vitest_1.it)('refuses withdrawal while the seller carries a debt', async () => {
        seedSeller({ balance: 5000, sellerDebt: 1500 });
        await (0, vitest_1.expect)(callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } })).rejects.toThrow('solde dû');
        (0, vitest_1.expect)(stripeMock.calls.transfersCreate.length).toBe(0);
    });
});
// ===========================================================================
// 6c. heldBalance is NOT withdrawable
// ===========================================================================
(0, vitest_1.describe)('walletWithdraw — heldBalance is non-withdrawable', () => {
    (0, vitest_1.it)('refuses an amount that exceeds withdrawable balance even if held funds exist', async () => {
        // balance 1000 (withdrawable), heldBalance 9000 (locked in dispute window).
        seedSeller({ balance: 1000, heldBalance: 9000 });
        // Try to withdraw 5000 — only 1000 is actually withdrawable.
        await (0, vitest_1.expect)(callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 5000 } })).rejects.toMatchObject({ code: 'failed-precondition' });
        await (0, vitest_1.expect)(callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 5000 } })).rejects.toThrow('Solde insuffisant');
        // heldBalance untouched, no transfer.
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').heldBalance).toBe(9000);
        (0, vitest_1.expect)(stripeMock.calls.transfersCreate.length).toBe(0);
    });
    (0, vitest_1.it)('debits only `balance` and never touches heldBalance on a valid withdrawal', async () => {
        seedSeller({ balance: 5000, heldBalance: 3000 });
        const result = await callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').balance).toBe(3000);
        // heldBalance unchanged.
        (0, vitest_1.expect)(fs.getDoc('wallets/seller1').heldBalance).toBe(3000);
        (0, vitest_1.expect)(fs.sumIncrements('wallets/seller1', 'balance')).toBe(-2000);
        (0, vitest_1.expect)(fs.sumIncrements('wallets/seller1', 'heldBalance')).toBe(0);
    });
});
// ===========================================================================
// 6d. Deterministic idempotency keys on transfer + payout
// ===========================================================================
(0, vitest_1.describe)('walletWithdraw — idempotency keys present', () => {
    (0, vitest_1.it)('passes a deterministic idempotencyKey to transfers.create and payouts.create', async () => {
        seedSeller({ balance: 5000 });
        await callWithdraw({ auth: { uid: 'seller1' }, data: { amount: 2000 } });
        (0, vitest_1.expect)(stripeMock.calls.transfersCreate.length).toBe(1);
        (0, vitest_1.expect)(stripeMock.calls.payoutsCreate.length).toBe(1);
        const transferOpts = stripeMock.calls.transfersCreate[0][1];
        (0, vitest_1.expect)(transferOpts.idempotencyKey).toMatch(/^tr_/);
        const payoutOpts = stripeMock.calls.payoutsCreate[0][1];
        // stripe-node v22: single RequestOptions carries Connect account + key.
        (0, vitest_1.expect)(payoutOpts.stripeAccount).toBe('acct_seller1');
        (0, vitest_1.expect)(payoutOpts.idempotencyKey).toMatch(/^po_/);
        // Transfer + payout share the same stable ledger-entry suffix (no drift).
        const trKey = transferOpts.idempotencyKey;
        const poKey = payoutOpts.idempotencyKey;
        (0, vitest_1.expect)(trKey.replace(/^tr_/, '')).toBe(poKey.replace(/^po_/, ''));
        // A withdrawal_requests doc was created in 'processing'.
        const wrWrite = fs.writeOps.find((op) => op.path.startsWith('withdrawal_requests/') && op.data.status === 'processing');
        (0, vitest_1.expect)(wrWrite).toBeDefined();
        (0, vitest_1.expect)(wrWrite.data.amount).toBe(2000);
    });
});
//# sourceMappingURL=walletWithdraw.guards.test.js.map