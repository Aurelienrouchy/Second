"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shippoApiKey = exports.stripeSecretKey = exports.geminiApiKey = void 0;
/**
 * Firebase Functions Secrets
 * Firebase Functions v7 - using defineSecret from params module
 */
const params_1 = require("firebase-functions/params");
// Define secrets for v7
exports.geminiApiKey = (0, params_1.defineSecret)('GEMINI_API_KEY');
exports.stripeSecretKey = (0, params_1.defineSecret)('STRIPE_SECRET_KEY');
exports.shippoApiKey = (0, params_1.defineSecret)('SHIPPO_API_KEY');
//# sourceMappingURL=secrets.js.map