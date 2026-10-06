import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

// A runtime import of the SDK would reproduce the web native-module failure.
jest.mock('@stripe/stripe-react-native', () => { throw new Error('Native Stripe SDK must not load in the web adapter'); });
jest.mock('@/lib/stripe', () => jest.requireActual('@/lib/stripe.web'));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

import { StripeProvider, handleURLCallback, useStripe } from '@/lib/stripe.web';
import { StripePayment } from '@/components/StripePayment';

describe('Stripe web adapter', () => {
  it('renders the application without initializing the native SDK', () => {
    const screen = render(<StripeProvider publishableKey="test-public-placeholder" urlScheme="seconde"><Text>Application</Text></StripeProvider>);
    expect(screen.getByText('Application')).toBeTruthy();
  });

  it('leaves deep links with the app router rather than claiming a payment callback', async () => {
    await expect(handleURLCallback('seconde://checkout/success')).resolves.toBe(false);
    await expect(handleURLCallback('https://seconde.ca/article/test')).resolves.toBe(false);
  });

  it('fails explicitly for both payment operations and never reports payment success', async () => {
    const stripe = useStripe();
    const initialized = await stripe.initPaymentSheet({ paymentIntentClientSecret: 'test-only-placeholder', merchantDisplayName: 'Seconde' });
    const presented = await stripe.presentPaymentSheet();
    const expected = { error: { code: 'UnsupportedPlatform', message: 'Les paiements ne sont pas disponibles sur le web.' } };
    expect(initialized).toEqual(expected);
    expect(presented).toEqual(expected);
  });

  it('surfaces the unavailable result through the existing payment component only when shown', async () => {
    const onResult = jest.fn();
    const screen = render(<StripePayment visible={false} clientSecret="test-only-placeholder" onResult={onResult} />);
    expect(onResult).not.toHaveBeenCalled();
    screen.rerender(<StripePayment visible clientSecret="test-only-placeholder" onResult={onResult} />);
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult).toHaveBeenCalledWith({ success: false, error: 'Les paiements ne sont pas disponibles sur le web.', errorCode: 'UnsupportedPlatform', declineCode: undefined, errorType: undefined });
  });
});
