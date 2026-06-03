/**
 * StripePayment — Native Payment Sheet via @stripe/stripe-react-native
 *
 * Stripe's Payment Sheet is fully native. No Modal or WebView needed
 * — the SDK presents the sheet on top of the app automatically.
 *
 * Flow:
 * 1. Parent obtains a clientSecret from the createStripeCheckout CF
 * 2. When `visible` turns true, we init + present the Payment Sheet
 * 3. On success/error/cancel, we call onResult / onClose
 */

import { useCallback, useEffect, useRef } from 'react';
import { useStripe } from '@stripe/stripe-react-native';

// =============================================================================
// TYPES
// =============================================================================

export interface StripePaymentResult {
  success: boolean;
  error?: string;
}

interface StripePaymentProps {
  /** PaymentIntent client secret from createStripeCheckout Cloud Function */
  clientSecret: string;
  /** When true, initialise and present the Payment Sheet */
  visible: boolean;
  /**
   * Called when payment succeeds, fails or is cancelled. A user-initiated
   * cancellation is surfaced as { success: false, error: 'cancelled' }.
   */
  onResult: (result: StripePaymentResult) => void;
  /** Called when the parent should tear down the sheet (state reset). */
  onClose: () => void;
  /** Total amount — used for display in the sheet */
  totalAmount: number;
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * StripePayment is a headless component — it renders nothing.
 * The Stripe Payment Sheet is presented natively by the SDK.
 */
function StripePaymentComponent({
  clientSecret,
  visible,
  onResult,
  onClose: _onClose,
  totalAmount: _totalAmount,
}: StripePaymentProps) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const isPresentingRef = useRef(false);

  const handlePayment = useCallback(async () => {
    if (isPresentingRef.current) return;
    isPresentingRef.current = true;

    try {
      // 1. Initialise the Payment Sheet
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: 'Seconde',
        // Apple Pay / Google Pay will be enabled automatically
        // if the user has them configured on their device
        applePay: {
          merchantCountryCode: 'CA',
        },
        googlePay: {
          merchantCountryCode: 'CA',
          testEnv: __DEV__,
        },
        style: 'alwaysLight',
        returnURL: 'seconde://checkout/success',
      });

      if (initError) {
        if (__DEV__) console.error('Stripe initPaymentSheet error:', initError);
        onResult({ success: false, error: initError.message });
        return;
      }

      // 2. Present the Payment Sheet
      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        // User cancelled — surface a stable 'cancelled' code so the
        // consumer can distinguish a dismissal from a real failure.
        if (presentError.code === 'Canceled') {
          onResult({ success: false, error: 'cancelled' });
          return;
        }
        onResult({ success: false, error: presentError.message });
        return;
      }

      // 3. Payment succeeded
      onResult({ success: true });
    } catch (err) {
      if (__DEV__) console.error('Stripe payment error:', err);
      const message = err instanceof Error ? err.message : 'Erreur de paiement inattendue';
      onResult({ success: false, error: message });
    } finally {
      isPresentingRef.current = false;
    }
  }, [clientSecret, initPaymentSheet, presentPaymentSheet, onResult]);

  useEffect(() => {
    if (visible && clientSecret) {
      handlePayment();
    }
    // When the sheet is hidden, reset the guard so a future re-open
    // (e.g. retry after a failed payment) presents the sheet again.
    if (!visible) {
      isPresentingRef.current = false;
    }
  }, [visible, clientSecret, handlePayment]);

  // Headless component — Stripe SDK presents the sheet natively
  return null;
}

export const StripePayment = StripePaymentComponent;
