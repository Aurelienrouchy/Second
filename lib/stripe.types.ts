import type { useStripe as useNativeStripe } from '@stripe/stripe-react-native';
import type { ComponentProps } from 'react';
import type { CardField as NativeCardField } from '@stripe/stripe-react-native';

type NativeStripe = ReturnType<typeof useNativeStripe>;
export type StripeCardFieldProps = ComponentProps<typeof NativeCardField>;

export interface UnsupportedPaymentPlatformError {
  code: 'UnsupportedPlatform';
  message: string;
  declineCode?: undefined;
  type?: undefined;
}

/** Existing Payment Sheet and server-manual card APIs, plus explicit web failure. */
export interface PaymentSheetAdapter {
  createPaymentMethod: (
    params: Parameters<NativeStripe['createPaymentMethod']>[0],
  ) => Promise<Awaited<ReturnType<NativeStripe['createPaymentMethod']>> | { error: UnsupportedPaymentPlatformError }>;
  handleNextAction: (
    clientSecret: string, returnURL?: string,
  ) => Promise<Awaited<ReturnType<NativeStripe['handleNextAction']>> | { error: UnsupportedPaymentPlatformError }>;
  initPaymentSheet: (
    params: Parameters<NativeStripe['initPaymentSheet']>[0],
  ) => Promise<Awaited<ReturnType<NativeStripe['initPaymentSheet']>> | { error: UnsupportedPaymentPlatformError }>;
  presentPaymentSheet: (
    options?: Parameters<NativeStripe['presentPaymentSheet']>[0],
  ) => Promise<Awaited<ReturnType<NativeStripe['presentPaymentSheet']>> | { error: UnsupportedPaymentPlatformError }>;
}
