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

import crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

interface HelcimConfig {
  apiToken: string;
  baseUrl: string;
}

export interface HelcimCheckoutRequest {
  /** Amount in dollars (e.g. 25.50) */
  amount: number;
  /** CAD */
  currency: string;
  /** 'purchase' for immediate charge */
  paymentType: 'purchase' | 'preauth';
  /** Metadata to identify the transaction */
  customerCode?: string;
  invoiceNumber?: string;
  /** Tax amount in dollars */
  taxAmount?: number;
}

export interface HelcimCheckoutResponse {
  /** Token used by HelcimPay.js to open the payment modal */
  checkoutToken: string;
  /** Secret token for server-side verification */
  secretToken: string;
}

export interface HelcimTransaction {
  transactionId: number;
  type: string;
  amount: number;
  currency: string;
  status: string;
  approvalCode: string;
  cardNumber: string; // Masked: ****1234
  cardType: string;
  dateCreated: string;
  customerCode?: string;
  invoiceNumber?: string;
}

export interface HelcimRefundRequest {
  originalTransactionId: number;
  amount: number;
  ipAddress?: string;
}

// =============================================================================
// CLIENT
// =============================================================================

class HelcimClient {
  private config: HelcimConfig;

  constructor(config: HelcimConfig) {
    this.config = config;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
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
      throw new Error(
        `Helcim API error (${response.status}): ${errorBody}`
      );
    }

    return response.json() as Promise<T>;
  }

  // ===========================================================================
  // CHECKOUT SESSION — Create a token for HelcimPay.js
  // ===========================================================================

  /**
   * Initialize a HelcimPay.js checkout session
   * Returns a checkoutToken that the React Native WebView uses
   * to securely collect card details.
   */
  async createCheckoutSession(
    params: HelcimCheckoutRequest
  ): Promise<HelcimCheckoutResponse> {
    const response = await this.request<{
      checkoutToken: string;
      secretToken: string;
    }>('POST', '/v2/helcim-pay/initialize', {
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
  async processPayment(params: {
    amount: number;
    currency: string;
    cardToken: string;
    customerCode?: string;
    invoiceNumber?: string;
  }): Promise<HelcimTransaction> {
    const response = await this.request<{
      transactionId: number;
      type: string;
      amount: number;
      currency: string;
      status: string;
      approvalCode: string;
      cardNumber: string;
      cardType: string;
      dateCreated: string;
      customerCode?: string;
      invoiceNumber?: string;
    }>('POST', '/v2/payment/purchase', {
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

  async refund(params: HelcimRefundRequest): Promise<HelcimTransaction> {
    return this.request<HelcimTransaction>('POST', '/v2/payment/refund', {
      originalTransactionId: params.originalTransactionId,
      amount: params.amount,
      ipAddress: params.ipAddress || '0.0.0.0',
    });
  }

  // ===========================================================================
  // TRANSACTION LOOKUP
  // ===========================================================================

  async getTransaction(transactionId: number): Promise<HelcimTransaction> {
    return this.request<HelcimTransaction>(
      'GET',
      `/v2/card-transactions/${transactionId}`
    );
  }

  // ===========================================================================
  // VERIFICATION — Verify webhook signature
  // ===========================================================================

  /**
   * Verify that a webhook payload is authentic
   * Helcim sends a hash in the x-helcim-signature header
   */
  static verifyWebhookSignature(
    payload: string,
    signature: string,
    secretToken: string
  ): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', secretToken)
      .update(payload)
      .digest('hex');
    if (signature.length !== expectedSignature.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8')
    );
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let helcimClient: HelcimClient | null = null;

export const getHelcim = (): HelcimClient | null => {
  const apiToken = process.env.HELCIM_API_TOKEN;
  const baseUrl =
    process.env.HELCIM_BASE_URL || 'https://api.helcim.com';

  if (!helcimClient && apiToken) {
    helcimClient = new HelcimClient({ apiToken, baseUrl });
  }

  return helcimClient;
};

export { HelcimClient };
