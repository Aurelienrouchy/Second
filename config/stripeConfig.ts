import { runtimeEnvironment, type AppEnvironment } from './firebaseEnvironment';
import { PAYMENTS_ENABLED } from './featureFlags';
import { getCheckoutReturnUrl } from '@/functions/src/shared/checkoutRedirect';

// Stripe publishable key.
//
// This is a PUBLIC key (Stripe publishable keys are safe to ship in the
// client bundle), but it is environment-specific: TEST for dev/preview
// builds, LIVE for production. The active key is selected per build channel
// via the EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env var (set it in the EAS
// `production` build profile / env to the pk_live_… key).
//
// The fallback belongs to the dedicated Seconde Dev sandbox. Production
// payments require an explicitly configured LIVE key; there is no test-mode
// fallback when that rail is open. With payments closed, StripeProvider still
// mounts, so a harmless TEST key keeps browsing available on incomplete builds.
const FALLBACK_TEST_PUBLISHABLE_KEY =
  'pk_test_51UUxsw0kghMArvqhE54V2N87Qz1EhmVG7knQtxBaNyF1v1GjSYvot7ynMoQzHI2hRzCMPpGHd9DdQs9O5cn4AJmr00LUmnsoRx';

export function resolveStripePublishableKey(options: {
  environment: AppEnvironment;
  paymentsEnabled: boolean;
  configuredKey?: string;
}): string {
  const keyPattern = options.environment === 'production' ? /^pk_live_[A-Za-z0-9]+$/ : /^pk_test_[A-Za-z0-9]+$/;
  if (options.configuredKey && options.configuredKey === options.configuredKey.trim() && keyPattern.test(options.configuredKey)) {
    return options.configuredKey;
  }
  if (options.paymentsEnabled) {
    if (options.environment === 'production') {
      throw new Error('Les paiements en production exigent une clé publique Stripe de production explicitement configurée (pk_live_).');
    }
    if (options.configuredKey) {
      throw new Error('Seconde Dev refuse une clé Stripe de production ou invalide. Configurez une clé de test (pk_test_).');
    }
  }
  return FALLBACK_TEST_PUBLISHABLE_KEY;
}

export const STRIPE_PUBLISHABLE_KEY = resolveStripePublishableKey({
  environment: runtimeEnvironment.name,
  paymentsEnabled: PAYMENTS_ENABLED,
  configuredKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
});

// App URL scheme (app.config.js `scheme`) — used by Stripe for the 3DS /
// redirect-payment return URL. Kept in sync with the StripePayment returnURL
// (`seconde-dev://checkout/success` in Dev, `seconde://checkout/success` in prod).
export const STRIPE_URL_SCHEME = runtimeEnvironment.appScheme;
export const CHECKOUT_RETURN_URL = getCheckoutReturnUrl(runtimeEnvironment.name);
