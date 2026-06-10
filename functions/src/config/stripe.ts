/**
 * Stripe Connect client initialization
 * Stripe Connect Custom accounts for marketplace payments
 *
 * Architecture (single-rail / separate charges & transfers):
 * - Each seller has a Stripe Connect Custom account (created silently)
 * - Payments are PLATFORM charges (no destination transfer at capture); the
 *   seller is credited in the wallet ledger and paid out by a single
 *   platform->connected transfer at withdrawal time
 * - Platform keeps the buyer protection fee (5% + 1.50$) and the shippingCost
 *   used to pay the ShipEngine label
 * - Bank accounts collected in-app (addBankAccount callable)
 * - Payouts controlled via manual schedule + walletWithdraw callable
 */

import Stripe from 'stripe';
import * as logger from 'firebase-functions/logger';

type StripeClient = InstanceType<typeof Stripe>;

let stripeInstance: StripeClient | null = null;
let stripeInstanceKey: string | null = null;

/**
 * Returns the Stripe SDK singleton.
 * Reads STRIPE_SECRET_KEY from environment (injected via Firebase Secrets).
 * Returns null if the key is not configured (e.g. in test environments).
 *
 * The singleton is invalidated if the secret key changes (e.g. after rotation),
 * preventing stale credentials from being used in warm function containers.
 */
export const getStripe = (): StripeClient | null => {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    logger.error('STRIPE_SECRET_KEY not found in environment');
    return null;
  }
  // Invalidate cached instance if the key changed (secret rotation)
  if (!stripeInstance || stripeInstanceKey !== secretKey) {
    const keyPrefix = secretKey.substring(0, 12);
    logger.info('Initializing Stripe SDK', { keyPrefix: `${keyPrefix}...` });
    // Pin the API version coherent with stripe ^22 (Dahlia release) so the
    // shape of webhook payloads / API responses cannot drift under us.
    // maxNetworkRetries: Stripe retries are idempotent (uses idempotency keys
    // internally), safe to retry transient network/5xx failures.
    // timeout: cap each request at 20s to avoid hanging the webhook handler.
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2026-04-22.dahlia',
      maxNetworkRetries: 2,
      timeout: 20000,
    });
    stripeInstanceKey = secretKey;
  }
  return stripeInstance;
};
