"use strict";
/**
 * Stripe Connect client initialization
 * Stripe Connect Custom accounts for marketplace payments
 *
 * Architecture:
 * - Each seller has a Stripe Connect Custom account (created silently)
 * - Payments via destination charges with application_fee_amount
 * - Platform takes the buyer protection fee (5% + 1.50$)
 * - Bank accounts collected in-app (addBankAccount callable)
 * - Payouts controlled via manual schedule + requestWithdrawal callable
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStripe = void 0;
const stripe_1 = __importDefault(require("stripe"));
const logger = __importStar(require("firebase-functions/logger"));
let stripeInstance = null;
let stripeInstanceKey = null;
/**
 * Returns the Stripe SDK singleton.
 * Reads STRIPE_SECRET_KEY from environment (injected via Firebase Secrets).
 * Returns null if the key is not configured (e.g. in test environments).
 *
 * The singleton is invalidated if the secret key changes (e.g. after rotation),
 * preventing stale credentials from being used in warm function containers.
 */
const getStripe = () => {
    var _a;
    const secretKey = (_a = process.env.STRIPE_SECRET_KEY) === null || _a === void 0 ? void 0 : _a.trim();
    if (!secretKey) {
        logger.error('STRIPE_SECRET_KEY not found in environment');
        return null;
    }
    // Invalidate cached instance if the key changed (secret rotation)
    if (!stripeInstance || stripeInstanceKey !== secretKey) {
        const keyPrefix = secretKey.substring(0, 12);
        logger.info('Initializing Stripe SDK', { keyPrefix: `${keyPrefix}...` });
        stripeInstance = new stripe_1.default(secretKey);
        stripeInstanceKey = secretKey;
    }
    return stripeInstance;
};
exports.getStripe = getStripe;
//# sourceMappingURL=stripe.js.map