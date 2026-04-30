/**
 * Payment Screen — Helcim HelcimPay.js
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Used when navigating to an existing pending_payment transaction.
 * Creates a Helcim checkout session and opens the payment WebView.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { httpsCallable } from 'firebase/functions';

import { ScreenHeader } from '@/components/ui';
import { HelcimPayment, HelcimPaymentResult } from '@/components/HelcimPayment';
import { functions } from '@/config/firebaseConfig';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { TransactionService } from '@/services/transactionService';
import { Transaction } from '@/types';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PaymentScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);

  // Helcim
  const [checkoutToken, setCheckoutToken] = useState<string | null>(null);
  const [showHelcimPayment, setShowHelcimPayment] = useState(false);

  // =============================================================================
  // LOAD TRANSACTION
  // =============================================================================

  useEffect(() => {
    loadTransaction();
  }, [transactionId]);

  const loadTransaction = async () => {
    if (!transactionId) return;

    try {
      setIsLoading(true);
      const trans = await TransactionService.getTransaction(transactionId);

      if (!trans) {
        Alert.alert('Erreur', 'Transaction introuvable');
        router.back();
        return;
      }

      if (trans.buyerId !== user?.id) {
        Alert.alert('Erreur', 'Vous n\'êtes pas autorisé pour cette transaction');
        router.back();
        return;
      }

      if (trans.status !== 'pending_payment') {
        Alert.alert('Information', 'Cette transaction a déjà été traitée');
        router.back();
        return;
      }

      setTransaction(trans);
    } catch (error) {
      console.error('Error loading transaction:', error);
      Alert.alert('Erreur', 'Impossible de charger la transaction');
      router.back();
    } finally {
      setIsLoading(false);
    }
  };

  // =============================================================================
  // HELCIM PAYMENT
  // =============================================================================

  const handlePay = async () => {
    if (!transaction || isCreatingCheckout) return;

    try {
      setIsCreatingCheckout(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const createCheckout = httpsCallable(functions, 'createHelcimCheckout');
      const result = await createCheckout({ transactionId: transaction.id });
      const data = result.data as { success: boolean; checkoutToken: string };

      if (!data.success || !data.checkoutToken) {
        throw new Error('Impossible de créer la session de paiement');
      }

      setCheckoutToken(data.checkoutToken);
      setShowHelcimPayment(true);
    } catch (error: any) {
      console.error('Error creating checkout:', error);
      Alert.alert('Erreur', error.message || 'Impossible d\'initier le paiement.');
    } finally {
      setIsCreatingCheckout(false);
    }
  };

  const handlePaymentResult = useCallback(
    async (result: HelcimPaymentResult) => {
      setShowHelcimPayment(false);
      setCheckoutToken(null);

      if (!result.success) {
        if (result.error !== 'cancelled') {
          Alert.alert('Paiement échoué', result.error || 'Veuillez réessayer.');
        }
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Paiement confirmé !',
        'L\'étiquette d\'expédition sera générée automatiquement. Le vendeur sera notifié.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    },
    [router]
  );

  // =============================================================================
  // DERIVED
  // =============================================================================

  const serviceFee = transaction?.serviceFee || 0;
  const totalAmount = transaction?.totalAmount || 0;

  // =============================================================================
  // RENDER
  // =============================================================================

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.charcoal} />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  if (!transaction) return null;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Paiement" onBack={() => router.back()} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Order Summary */}
        <Text style={styles.sectionTitle}>RÉCAPITULATIF</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Article</Text>
            <Text style={styles.summaryValue}>{transaction.amount.toFixed(2)}$</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Livraison</Text>
            <Text style={styles.summaryValue}>{transaction.shippingCost.toFixed(2)}$</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Frais de protection Seconde</Text>
            <Text style={styles.summaryValue}>{serviceFee.toFixed(2)}$</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total à payer</Text>
            <Text style={styles.totalValue}>{totalAmount.toFixed(2)}$</Text>
          </View>
        </View>

        {/* Shipping Address */}
        {transaction.shippingAddress && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>ADRESSE DE LIVRAISON</Text>
            <View style={styles.addressCard}>
              <Ionicons name="location-outline" size={18} color={colors.muted} />
              <View style={styles.addressText}>
                <Text style={styles.addressName}>{transaction.shippingAddress.name}</Text>
                <Text style={styles.addressLine}>{transaction.shippingAddress.street}</Text>
                <Text style={styles.addressLine}>
                  {transaction.shippingAddress.postalCode} {transaction.shippingAddress.city}
                </Text>
              </View>
            </View>
          </>
        )}

        {/* Security info */}
        <View style={styles.securityBox}>
          <Ionicons name="shield-checkmark" size={18} color={colors.success} />
          <View style={styles.securityTextContainer}>
            <Text style={styles.securityTitle}>Protection Seconde</Text>
            <Text style={styles.securityDesc}>
              Paiement sécurisé par Helcim. Vos données bancaires ne transitent jamais par Seconde. Remboursement si l'article ne correspond pas.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Footer — Pay button */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.payButton, isCreatingCheckout && styles.payButtonDisabled]}
          onPress={handlePay}
          disabled={isCreatingCheckout}
        >
          {isCreatingCheckout ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name="lock-closed-outline" size={16} color={colors.cream} />
              <Text style={styles.payButtonText}>
                PAYER {totalAmount.toFixed(2)}$
              </Text>
            </>
          )}
        </Pressable>
        <Text style={styles.disclaimer}>
          En confirmant, vous acceptez les conditions générales de vente de Seconde
        </Text>
      </View>

      {/* Helcim Payment Modal */}
      {checkoutToken && (
        <HelcimPayment
          checkoutToken={checkoutToken}
          visible={showHelcimPayment}
          onResult={handlePaymentResult}
          onClose={() => {
            setShowHelcimPayment(false);
            setCheckoutToken(null);
          }}
          totalAmount={totalAmount}
        />
      )}
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
  },

  // Section title
  sectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    marginBottom: 12,
    textTransform: 'uppercase',
  },

  // Summary card
  summaryCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryLabel: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    flex: 1,
  },
  summaryValue: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  totalLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
  },
  totalValue: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    color: colors.rust,
  },

  // Address card
  addressCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.md,
  },
  addressText: {
    flex: 1,
  },
  addressName: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
    marginBottom: 4,
  },
  addressLine: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },

  // Security box
  securityBox: {
    flexDirection: 'row',
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  securityTextContainer: {
    flex: 1,
  },
  securityTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
    marginBottom: 4,
  },
  securityDesc: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.foregroundSecondary,
    lineHeight: 16,
  },

  // Footer
  footer: {
    backgroundColor: colors.cream,
    paddingTop: spacing.md,
    paddingHorizontal: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rust,
    paddingVertical: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  disclaimer: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 14,
  },
});
