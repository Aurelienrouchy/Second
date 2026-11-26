import React from 'react';
import type { StripeProviderProps } from '@stripe/stripe-react-native';
import type { PaymentSheetAdapter, UnsupportedPaymentPlatformError, StripeCardFieldProps } from './stripe.types';

export function StripeProvider({ children }: StripeProviderProps) {
  return React.createElement(React.Fragment, null, children);
}

/** Browser links stay with the app router; there is no native 3DS callback. */
export async function handleURLCallback(_url: string): Promise<boolean> {
  return false;
}

function unavailable(): { error: UnsupportedPaymentPlatformError } {
  return { error: { code: 'UnsupportedPlatform', message: 'Les paiements ne sont pas disponibles sur le web.' } };
}

const webPaymentSheet: PaymentSheetAdapter = {
  createPaymentMethod: async () => unavailable(),
  handleNextAction: async () => unavailable(),
  initPaymentSheet: async () => unavailable(),
  presentPaymentSheet: async () => unavailable(),
};
export function CardField(_props: StripeCardFieldProps): null { return null; }

/** Fail explicitly if a payment surface is reached; never simulate success. */
export function useStripe(): PaymentSheetAdapter {
  return webPaymentSheet;
}
