import type { useStripe as useNativeStripe } from '@stripe/stripe-react-native';

type NativeStripe = ReturnType<typeof useNativeStripe>;

export interface UnsupportedPaymentPlatformError {
  code: 'UnsupportedPlatform';
  message: string;
  declineCode?: undefined;
  type?: undefined;
}

/** Only the Payment Sheet operations used by the app, plus explicit web failure. */
export interface PaymentSheetAdapter {
  initPaymentSheet: (
    params: Parameters<NativeStripe['initPaymentSheet']>[0],
  ) => Promise<Awaited<ReturnType<NativeStripe['initPaymentSheet']>> | { error: UnsupportedPaymentPlatformError }>;
  presentPaymentSheet: (
    options?: Parameters<NativeStripe['presentPaymentSheet']>[0],
  ) => Promise<Awaited<ReturnType<NativeStripe['presentPaymentSheet']>> | { error: UnsupportedPaymentPlatformError }>;
}
