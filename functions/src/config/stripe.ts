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
    stripeInstance = new Stripe(secretKey);
    stripeInstanceKey = secretKey;
  }
  return stripeInstance;
};
