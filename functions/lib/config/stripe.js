"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStripe = void 0;
/**
 * Stripe client initialization
 * Firebase Functions v7
 */
const stripe_1 = __importDefault(require("stripe"));
let stripeClient = null;
/**
 * Get Stripe client instance (lazy initialization)
 */
const getStripe = () => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeClient && stripeSecretKey) {
        stripeClient = new stripe_1.default(stripeSecretKey, {
            apiVersion: '2025-12-15.clover',
        });
    }
    return stripeClient;
};
exports.getStripe = getStripe;
//# sourceMappingURL=stripe.js.map