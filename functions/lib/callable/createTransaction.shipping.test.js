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
 * Integration-style tests for createTransaction SERVER-SIDE shipping re-pricing.
 *
 * Focus (chantier item 7): a client-supplied `shippingCost` is NEVER trusted —
 * the server re-quotes the rate from ShipEngine using the supplied (real)
 * rateId and persists ITS amount as the authoritative shipping cost on the
 * transaction + totalAmount. A minored client `shippingCost` must be ignored.
 *
 * Also covers the guards that protect this path: a fallback rateId is rejected,
 * and an expired/unknown rateId (not found in fresh rates) is rejected.
 */
const vitest_1 = require("vitest");
const { fs, shipEngineMock } = await vitest_1.vi.hoisted(async () => {
    const { createFirestoreMock } = await Promise.resolve().then(() => __importStar(require('../utils/testHelpers/firestoreMock')));
    return {
        fs: createFirestoreMock(),
        // Swappable ShipEngine getRates stub + call capture.
        shipEngineMock: {
            getRatesImpl: null,
            getRatesCalls: [],
        },
    };
});
vitest_1.vi.mock('../config/firebase', () => ({
    db: fs.db,
    FieldValue: fs.FieldValue,
}));
vitest_1.vi.mock('../config/stripe', () => ({
    getStripe: () => ({}),
}));
vitest_1.vi.mock('../config/shipEngine', () => ({
    getShipEngine: () => ({
        getRates: (...a) => {
            shipEngineMock.getRatesCalls.push(a);
            if (!shipEngineMock.getRatesImpl)
                throw new Error('getRates not stubbed');
            return shipEngineMock.getRatesImpl(...a);
        },
    }),
}));
vitest_1.vi.mock('../utils/rateLimit', () => ({
    checkRateLimit: async () => { },
    resolveCallerKey: (request) => {
        var _a, _b;
        return ({
            callerKey: (_b = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) !== null && _b !== void 0 ? _b : 'anon',
            isAuthenticated: !!request.auth,
        });
    },
}));
vitest_1.vi.mock('../utils/trackingTransition', () => ({
    applyTrackingOutcome: () => { },
    DELIVERABLE_STATUSES: new Set(),
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
const payments_1 = require("./payments");
const callCreate = payments_1.createTransaction;
const VALID_ADDRESS = {
    name: 'Acheteur Test',
    street: '123 rue Principale',
    city: 'Montreal',
    province: 'QC',
    postalCode: 'H2X 1Y4',
    country: 'CA',
    phone: '5145551234',
};
/** Seed an available shipping article + a payout-enabled seller. */
function seedArticleAndSeller(price = 50) {
    fs.setDoc('articles/art1', {
        sellerId: 'seller1',
        price,
        isSold: false,
        isActive: true,
        weight: '0.5',
        dimensions: { length: '30', width: '25', height: '10' },
        location: { postalCode: 'H2X 1Y4', city: 'Montreal', province: 'QC' },
    });
    fs.setDoc('users/seller1', {
        displayName: 'Vendeur Test',
        stripeAccountId: 'acct_seller1',
        stripeChargesEnabled: true,
        phoneNumber: '5145559876',
        addresses: [
            {
                isDefault: true,
                street: '999 rue du Vendeur',
                city: 'Montreal',
                province: 'QC',
                postalCode: 'H3Z 2Y7',
            },
        ],
    });
}
function rate(rateId, amount) {
    return {
        rateId,
        carrierCode: 'canada_post',
        carrierFriendlyName: 'Canada Post',
        serviceType: 'expedited',
        estimatedDeliveryDays: 3,
        deliveryType: 'shipping',
        shippingAmount: { amount, currency: 'cad' },
    };
}
(0, vitest_1.beforeEach)(() => {
    fs.reset();
    shipEngineMock.getRatesImpl = null;
    shipEngineMock.getRatesCalls.length = 0;
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.SHIPENGINE_API_KEY = 'se_test';
});
// ===========================================================================
// 7. Server re-pricing ignores a minored client shippingCost
// ===========================================================================
(0, vitest_1.describe)('createTransaction — server-side shipping re-pricing', () => {
    (0, vitest_1.it)('ignores a minored client shippingCost and uses the server rate', async () => {
        seedArticleAndSeller(50);
        // ShipEngine returns the REAL rate of 14.99 for the supplied rateId.
        shipEngineMock.getRatesImpl = () => [rate('se_rate_real', 14.99), rate('se_rate_other', 9.99)];
        const result = await callCreate({
            auth: { uid: 'buyer1' },
            data: {
                articleId: 'art1',
                deliveryType: 'shipping',
                amount: 50,
                // Malicious/buggy client tries to pay almost nothing for shipping.
                shippingCost: 0.01,
                shippingAddress: VALID_ADDRESS,
                shipEngineRateId: 'se_rate_real',
                chatId: 'chat1',
            },
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        const txId = result.transactionId;
        const tx = fs.getDoc(`transactions/${txId}`);
        // The persisted shipping cost is the SERVER rate, not the client's 0.01.
        (0, vitest_1.expect)(tx.shippingCost).toBe(14.99);
        // totalAmount = amount(50) + serverShipping(14.99) + serviceFee.
        // serviceFee for a 50$ article = 50*0.05 + 1.50 = 4.00 (see utils/fees).
        (0, vitest_1.expect)(tx.serviceFee).toBe(4.0);
        (0, vitest_1.expect)(tx.totalAmount).toBeCloseTo(50 + 14.99 + 4.0, 2);
        (0, vitest_1.expect)(tx.sellerPayout).toBe(50);
        // Article was locked.
        (0, vitest_1.expect)(fs.getDoc('articles/art1').isSold).toBe(true);
        // ShipEngine was actually consulted for the re-quote.
        (0, vitest_1.expect)(shipEngineMock.getRatesCalls.length).toBe(1);
    });
    (0, vitest_1.it)('rejects a fallback rateId before any pricing', async () => {
        seedArticleAndSeller(50);
        await (0, vitest_1.expect)(callCreate({
            auth: { uid: 'buyer1' },
            data: {
                articleId: 'art1',
                deliveryType: 'shipping',
                amount: 50,
                shippingCost: 5,
                shippingAddress: VALID_ADDRESS,
                shipEngineRateId: 'fallback_se_rate',
            },
        })).rejects.toMatchObject({ code: 'failed-precondition' });
        // No re-quote attempted, article untouched.
        (0, vitest_1.expect)(shipEngineMock.getRatesCalls.length).toBe(0);
        (0, vitest_1.expect)(fs.getDoc('articles/art1').isSold).toBe(false);
    });
    (0, vitest_1.it)('rejects when the supplied rateId is not found in fresh rates (expired)', async () => {
        seedArticleAndSeller(50);
        // Fresh rates no longer contain the supplied rateId.
        shipEngineMock.getRatesImpl = () => [rate('se_rate_new1', 12.5), rate('se_rate_new2', 18.0)];
        await (0, vitest_1.expect)(callCreate({
            auth: { uid: 'buyer1' },
            data: {
                articleId: 'art1',
                deliveryType: 'shipping',
                amount: 50,
                shippingCost: 12.5,
                shippingAddress: VALID_ADDRESS,
                shipEngineRateId: 'se_rate_expired',
            },
        })).rejects.toMatchObject({ code: 'failed-precondition' });
        // Re-quote was attempted but the rateId did not match — article not locked.
        (0, vitest_1.expect)(shipEngineMock.getRatesCalls.length).toBe(1);
        (0, vitest_1.expect)(fs.getDoc('articles/art1').isSold).toBe(false);
    });
    (0, vitest_1.it)('meetup transactions have no shipping cost and no service fee', async () => {
        fs.setDoc('articles/art2', {
            sellerId: 'seller1',
            price: 30,
            isSold: false,
            isActive: true,
        });
        fs.setDoc('users/seller1', { displayName: 'Vendeur', stripeChargesEnabled: true });
        const result = await callCreate({
            auth: { uid: 'buyer1' },
            data: {
                articleId: 'art2',
                deliveryType: 'meetup',
                amount: 30,
                meetupSpot: { name: 'Cafe', category: 'public', neighborhood: 'Plateau' },
            },
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        const tx = fs.getDoc(`transactions/${result.transactionId}`);
        (0, vitest_1.expect)(tx.shippingCost).toBe(0);
        (0, vitest_1.expect)(tx.serviceFee).toBe(0);
        (0, vitest_1.expect)(tx.totalAmount).toBe(30);
        (0, vitest_1.expect)(tx.status).toBe('meetup_pending');
        // No ShipEngine call for meetup.
        (0, vitest_1.expect)(shipEngineMock.getRatesCalls.length).toBe(0);
    });
});
//# sourceMappingURL=createTransaction.shipping.test.js.map