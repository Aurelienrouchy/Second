"use strict";
/**
 * Helcim Payment API client
 * REST API integration for payment processing (replacing Stripe)
 * Documentation: https://devdocs.helcim.com/
 *
 * Flow for React Native:
 * 1. Server creates a checkout session → returns checkoutToken
 * 2. Client opens WebView with HelcimPay.js using that token
 * 3. HelcimPay.js handles card input securely (PCI compliant)
 * 4. On success, Helcim calls our webhook + returns to app
 * 5. Webhook processes the payment and creates shipping label
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HelcimClient = exports.getHelcim = void 0;
const crypto_1 = __importDefault(require("crypto"));
// =============================================================================
// CLIENT
// =============================================================================
class HelcimClient {
    constructor(config) {
        this.config = config;
    }
    async request(method, endpoint, body) {
        const url = `${this.config.baseUrl}${endpoint}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'api-token': this.config.apiToken,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Helcim API error (${response.status}): ${errorBody}`);
        }
        return response.json();
    }
    // ===========================================================================
    // CHECKOUT SESSION — Create a token for HelcimPay.js
    // ===========================================================================
    /**
     * Initialize a HelcimPay.js checkout session
     * Returns a checkoutToken that the React Native WebView uses
     * to securely collect card details.
     */
    async createCheckoutSession(params) {
        const response = await this.request('POST', '/v2/helcim-pay/initialize', {
            paymentType: params.paymentType,
            amount: params.amount,
            currency: params.currency,
            customerCode: params.customerCode,
            invoiceNumber: params.invoiceNumber,
            taxAmount: params.taxAmount || 0,
        });
        return {
            checkoutToken: response.checkoutToken,
            secretToken: response.secretToken,
        };
    }
    // ===========================================================================
    // PAYMENT PROCESSING — Direct API (server-to-server)
    // ===========================================================================
    /**
     * Process a direct payment (for server-side processing with token)
     * Used when we already have a card token from HelcimPay.js
     */
    async processPayment(params) {
        const response = await this.request('POST', '/v2/payment/purchase', {
            amount: params.amount,
            currency: params.currency,
            cardToken: params.cardToken,
            customerCode: params.customerCode,
            invoiceNumber: params.invoiceNumber,
        });
        return {
            transactionId: response.transactionId,
            type: response.type,
            amount: response.amount,
            currency: response.currency,
            status: response.status,
            approvalCode: response.approvalCode,
            cardNumber: response.cardNumber,
            cardType: response.cardType,
            dateCreated: response.dateCreated,
            customerCode: response.customerCode,
            invoiceNumber: response.invoiceNumber,
        };
    }
    // ===========================================================================
    // REFUND
    // ===========================================================================
    async refund(params) {
        return this.request('POST', '/v2/payment/refund', {
            originalTransactionId: params.originalTransactionId,
            amount: params.amount,
            ipAddress: params.ipAddress || '0.0.0.0',
        });
    }
    // ===========================================================================
    // TRANSACTION LOOKUP
    // ===========================================================================
    async getTransaction(transactionId) {
        return this.request('GET', `/v2/card-transactions/${transactionId}`);
    }
    // ===========================================================================
    // VERIFICATION — Verify webhook signature
    // ===========================================================================
    /**
     * Verify that a webhook payload is authentic
     * Helcim sends a hash in the x-helcim-signature header
     */
    static verifyWebhookSignature(payload, signature, secretToken) {
        const expectedSignature = crypto_1.default
            .createHmac('sha256', secretToken)
            .update(payload)
            .digest('hex');
        if (signature.length !== expectedSignature.length) {
            return false;
        }
        return crypto_1.default.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedSignature, 'utf8'));
    }
}
exports.HelcimClient = HelcimClient;
// =============================================================================
// SINGLETON
// =============================================================================
let helcimClient = null;
const getHelcim = () => {
    const apiToken = process.env.HELCIM_API_TOKEN;
    const baseUrl = process.env.HELCIM_BASE_URL || 'https://api.helcim.com';
    if (!helcimClient && apiToken) {
        helcimClient = new HelcimClient({ apiToken, baseUrl });
    }
    return helcimClient;
};
exports.getHelcim = getHelcim;
//# sourceMappingURL=helcim.js.map