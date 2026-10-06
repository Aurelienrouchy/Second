import { useStripe as useNativeStripe } from '@stripe/stripe-react-native';
import type { PaymentSheetAdapter } from './stripe.types';

export { StripeProvider, handleURLCallback } from '@stripe/stripe-react-native';

/** Keep the native SDK object, callbacks and presentation behavior unchanged. */
export function useStripe(): PaymentSheetAdapter {
  return useNativeStripe();
}
