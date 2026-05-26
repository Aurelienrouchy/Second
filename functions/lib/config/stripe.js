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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStripe = void 0;
const stripe_1 = __importDefault(require("stripe"));
let stripeInstance = null;
/**
 * Returns the Stripe SDK singleton.
 * Reads STRIPE_SECRET_KEY from environment (injected via Firebase Secrets).
 * Returns null if the key is not configured (e.g. in test environments).
 */
const getStripe = () => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        console.error('STRIPE_SECRET_KEY not found in environment');
        return null;
    }
    if (!stripeInstance) {
        stripeInstance = new stripe_1.default(secretKey);
    }
    return stripeInstance;
};
exports.getStripe = getStripe;
//# sourceMappingURL=stripe.js.map