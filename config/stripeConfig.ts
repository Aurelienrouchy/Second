// Stripe publishable key.
//
// This is a PUBLIC key (Stripe publishable keys are safe to ship in the
// client bundle), but it is environment-specific: TEST for dev/preview
// builds, LIVE for production. The active key is selected per build channel
// via the EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env var (set it in the EAS
// `production` build profile / env to the pk_live_… key).
//
// The fallback below is the TEST key only — the LIVE key is NEVER committed
// in clear text. A build that forgets to set the env var falls back to test
// mode (fails closed: no real charges) rather than leaking a live key.
const FALLBACK_TEST_PUBLISHABLE_KEY =
  'pk_test_51Tb2161XFt8vzcX800vEUgn6RKlkXN3LI4iBcowYS1vBlxTbg5b5LtJAri8MU6py18dmoyPBzJ5Vvbucmon6Kkfs00ty1agdzD';

export const STRIPE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
  FALLBACK_TEST_PUBLISHABLE_KEY;

// Apple Pay merchant identifier — MUST match the value configured in the
// `@stripe/stripe-react-native` config plugin (app.config.js). The native
// SDK reads it from the StripeProvider prop at runtime (no Info.plist
// fallback): a missing value makes initPaymentSheet throw `missingMerchantId`
// on iOS — which fails the ENTIRE sheet init, not just Apple Pay. See F116.
export const STRIPE_MERCHANT_IDENTIFIER = 'merchant.com.seconde.app';

// App URL scheme (app.config.js `scheme`) — used by Stripe for the 3DS /
// redirect-payment return URL. Kept in sync with the StripePayment returnURL
// (`seconde://checkout/success`).
export const STRIPE_URL_SCHEME = 'seconde';
