/**
 * Stripe client initialization
 * Firebase Functions v7
 */
import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

/**
 * Get Stripe client instance (lazy initialization)
 */
export const getStripe = (): Stripe | null => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeClient && stripeSecretKey) {
    stripeClient = new Stripe(stripeSecretKey, {
      apiVersion: '2025-12-15.clover',
    });
  }
  return stripeClient;
};

export type { Stripe };
