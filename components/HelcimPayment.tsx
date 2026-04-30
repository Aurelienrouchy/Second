/**
 * HelcimPayment — WebView wrapper for HelcimPay.js
 *
 * Since Helcim doesn't have a React Native SDK, we use a WebView
 * to load HelcimPay.js which handles card input securely (PCI compliant).
 *
 * Flow:
 * 1. Parent provides a checkoutToken (from Cloud Function)
 * 2. WebView loads a minimal HTML page with HelcimPay.js
 * 3. User enters card details in the Helcim modal
 * 4. On success/failure, postMessage sends result back to RN
 * 5. Parent handles the result (navigate to success or show error)
 */

import React, { useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radius, spacing } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

export interface HelcimPaymentResult {
  success: boolean;
  transactionId?: number;
  approvalCode?: string;
  cardNumber?: string;
  cardType?: string;
  error?: string;
}

interface HelcimPaymentProps {
  /** Checkout token from createHelcimCheckout Cloud Function */
  checkoutToken: string;
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when payment succeeds or fails */
  onResult: (result: HelcimPaymentResult) => void;
  /** Called when user closes the modal */
  onClose: () => void;
  /** Total amount for display */
  totalAmount: number;
}

// =============================================================================
// HTML TEMPLATE — Minimal page that loads HelcimPay.js
// =============================================================================

function getHelcimHTML(checkoutToken: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #FAF8F4;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 16px;
    }
    #loading {
      text-align: center;
      color: #8C8880;
      font-size: 14px;
    }
    #loading .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #F5F0E8;
      border-top-color: #C4603A;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <p>Chargement du paiement sécurisé...</p>
  </div>

  <!-- HelcimPay.js SDK -->
  <script src="https://js.helcim.com/helcim-pay.js"></script>
  <script>
    (function() {
      try {
        // Initialize HelcimPay.js with the checkout token
        const helcimPay = new window.HelcimPay();

        // Listen for payment events
        window.addEventListener('message', function(event) {
          // HelcimPay.js sends messages when payment completes
          if (event.data && typeof event.data === 'object') {
            const data = event.data;

            if (data.eventName === 'helcim-pay-success') {
              // Payment successful
              window.ReactNativeWebView.postMessage(JSON.stringify({
                success: true,
                transactionId: data.transactionId,
                approvalCode: data.approvalCode,
                cardNumber: data.cardNumber,
                cardType: data.cardType,
              }));
            } else if (data.eventName === 'helcim-pay-error') {
              // Payment failed
              window.ReactNativeWebView.postMessage(JSON.stringify({
                success: false,
                error: data.error || 'Le paiement a échoué',
              }));
            } else if (data.eventName === 'helcim-pay-close') {
              // User closed the modal
              window.ReactNativeWebView.postMessage(JSON.stringify({
                success: false,
                error: 'cancelled',
              }));
            }
          }
        });

        // Open the payment modal
        document.getElementById('loading').innerHTML = '';
        helcimPay.appendHelcimPayIframe('${checkoutToken}');

      } catch (err) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          success: false,
          error: 'Erreur d\\'initialisation: ' + err.message,
        }));
      }
    })();
  </script>
</body>
</html>`;
}

// =============================================================================
// COMPONENT
// =============================================================================

const HelcimPaymentComponent: React.FC<HelcimPaymentProps> = ({
  checkoutToken,
  visible,
  onResult,
  onClose,
  totalAmount,
}) => {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as HelcimPaymentResult;

        if (data.error === 'cancelled') {
          onClose();
          return;
        }

        onResult(data);
      } catch {
        onResult({
          success: false,
          error: 'Erreur de communication avec le système de paiement',
        });
      }
    },
    [onResult, onClose]
  );

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={20} color={colors.charcoal} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Ionicons name="lock-closed" size={14} color={colors.success} />
            <Text style={styles.headerTitle}>Paiement sécurisé</Text>
          </View>
          <Text style={styles.headerAmount}>{totalAmount.toFixed(2)}$</Text>
        </View>

        {/* WebView with HelcimPay.js */}
        <WebView
          ref={webViewRef}
          source={{ html: getHelcimHTML(checkoutToken) }}
          onMessage={handleMessage}
          style={styles.webView}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
          // Security
          originWhitelist={['*']}
          mixedContentMode="compatibility"
          // Prevent navigation away
          onShouldStartLoadWithRequest={(request) => {
            // Allow Helcim domains and our HTML
            if (
              request.url.includes('helcim.com') ||
              request.url.startsWith('about:') ||
              request.url.startsWith('data:')
            ) {
              return true;
            }
            return false;
          }}
        />

        {/* Footer */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.securityBadge}>
            <Ionicons name="shield-checkmark" size={16} color={colors.success} />
            <Text style={styles.securityText}>
              Paiement traité par Helcim — vos données bancaires ne transitent jamais par Seconde
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export const HelcimPayment = React.memo(HelcimPaymentComponent);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.cream,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
  },
  headerAmount: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 18,
    color: colors.rust,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.cream,
  },
  securityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  securityText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 15,
  },
});

export default HelcimPayment;
