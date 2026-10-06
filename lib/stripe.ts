// TypeScript/default entry; Metro selects stripe.web on web and stripe.native
// on iOS/Android before this fallback. Keep runtime SDK imports in native only.
export { StripeProvider, handleURLCallback, useStripe } from './stripe.native';
