const mockInitPaymentSheet = jest.fn();
const mockPresentPaymentSheet = jest.fn();
const mockHandleURLCallback = jest.fn();
const mockStripe = { initPaymentSheet: mockInitPaymentSheet, presentPaymentSheet: mockPresentPaymentSheet };
const mockUseStripe = jest.fn(() => mockStripe);

jest.mock('@stripe/stripe-react-native', () => ({
  StripeProvider: jest.fn(),
  handleURLCallback: (...args: unknown[]) => mockHandleURLCallback(...args),
  useStripe: () => mockUseStripe(),
}));

import { StripeProvider as NativeStripeProvider } from '@stripe/stripe-react-native';
import { StripeProvider, handleURLCallback, useStripe } from '@/lib/stripe.native';

describe('Stripe native adapter', () => {
  it('keeps the original provider, SDK hook object and payment results', async () => {
    mockInitPaymentSheet.mockResolvedValue({});
    const cancelled = { error: { code: 'Canceled', message: 'cancelled' } };
    mockPresentPaymentSheet.mockResolvedValue(cancelled);
    expect(StripeProvider).toBe(NativeStripeProvider);
    const stripe = useStripe();
    expect(mockUseStripe).toHaveBeenCalledTimes(1);
    expect(stripe).toBe(mockStripe);
    const parameters = { paymentIntentClientSecret: 'test-only-placeholder', merchantDisplayName: 'Seconde' };
    await expect(stripe.initPaymentSheet(parameters)).resolves.toEqual({});
    expect(mockInitPaymentSheet).toHaveBeenCalledWith(parameters);
    await expect(stripe.presentPaymentSheet()).resolves.toBe(cancelled);
  });

  it('forwards native 3DS callback URLs without changing the SDK outcome', async () => {
    mockHandleURLCallback.mockResolvedValue(true);
    await expect(handleURLCallback('seconde://checkout/success')).resolves.toBe(true);
    expect(mockHandleURLCallback).toHaveBeenCalledWith('seconde://checkout/success');
  });
});
