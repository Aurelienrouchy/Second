/**
 * Payment Screen — Stripe Payment Sheet
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Used when navigating to an existing pending_payment transaction.
 * Creates a Stripe checkout session and presents the native Payment Sheet.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useQuery } from '@tanstack/react-query';

import { ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { StripePayment, StripePaymentResult } from '@/components/StripePayment';
import { functions } from '@/config/firebaseConfig';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { useUser } from '@/contexts/AuthContext';
import { useWallet } from '@/hooks/useWallet';
import { WalletService } from '@/services/walletService';
import { TransactionService } from '@/services/transactionService';
import { queryKeys } from '@/lib/queryKeys';
import { formatPrice } from '@/utils/formatPrice';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PaymentScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const router = useRouter();
  const user = useUser();

  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);

  // Stripe
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showStripePayment, setShowStripePayment] = useState(false);

  // Wallet
  const { wallet } = useWallet(!!user);
  const [useWalletBalance, setUseWalletBalance] = useState(false);

  // =============================================================================
  // LOAD TRANSACTION
  // =============================================================================

  const { data: transaction = null, isLoading } = useQuery({
    queryKey: queryKeys.payments.transaction(transactionId ?? ''),
    queryFn: async () => {
      const trans = await TransactionService.getTransaction(transactionId!);

      if (!trans) {
        Alert.alert('Erreur', 'Transaction introuvable');
        router.back();
        return null;
      }

      if (trans.buyerId !== user?.id) {
        Alert.alert('Erreur', 'Vous n\'etes pas autorise pour cette transaction');
        router.back();
        return null;
      }

      if (trans.status !== 'pending_payment') {
        Alert.alert('Information', 'Cette transaction a deja ete traitee');
        router.back();
        return null;
      }

      return trans;
    },
    enabled: !!transactionId && !!user,
    staleTime: 2 * 60 * 1000, // 2 min
  });

  // =============================================================================
  // STRIPE PAYMENT
  // =============================================================================

  const handlePay = async () => {
    if (!transaction || isCreatingCheckout) return;

    try {
      setIsCreatingCheckout(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Full wallet payment
      if (walletCoversAll) {
        await WalletService.payWithWallet(transaction.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Paiement confirme !',
          "L'etiquette d'expedition sera generee automatiquement. Le vendeur sera notifie.",
          [{ text: 'OK', onPress: () => router.back() }],
        );
        return;
      }

      // Stripe checkout (optionally with partial wallet)
      const checkoutParams: Record<string, unknown> = { transactionId: transaction.id };
      if (useWalletBalance && walletAmountCents > 0) {
        checkoutParams.walletAmount = walletAmountCents;
      }

      const createCheckout = httpsCallable(functions, 'createStripeCheckout');
      const result = await createCheckout(checkoutParams);
      const data = result.data as { success: boolean; clientSecret: string };

      if (!data.success || !data.clientSecret) {
        throw new Error('Impossible de créer la session de paiement');
      }

      setClientSecret(data.clientSecret);
      setShowStripePayment(true);
    } catch (error: unknown) {
      if (__DEV__) console.error('Error creating checkout:', error);
      const msg = error instanceof Error ? error.message : "Impossible d'initier le paiement.";
      Alert.alert('Erreur', msg);
    } finally {
      setIsCreatingCheckout(false);
    }
  };

  const handlePaymentResult = useCallback(
    async (result: StripePaymentResult) => {
      setShowStripePayment(false);
      setClientSecret(null);

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

  // Wallet derived
  const totalAmountCents = Math.round(totalAmount * 100);
  const walletBalanceCents = wallet?.hasWallet ? wallet.balance : 0;
  const walletCoversAll = useWalletBalance && walletBalanceCents >= totalAmountCents;
  const cardAmountDollars = useWalletBalance
    ? Math.max(0, (totalAmountCents - walletBalanceCents) / 100)
    : totalAmount;
  const walletAmountCents = useWalletBalance
    ? Math.min(walletBalanceCents, totalAmountCents)
    : 0;

  // =============================================================================
  // RENDER
  // =============================================================================

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Paiement" onBack={() => router.back()} />
        <View style={styles.skeletonContent}>
          {/* Section title skeleton */}
          <Skeleton width={100} height={10} style={{ marginBottom: 12 }} />
          {/* Summary card skeleton */}
          <View style={styles.skeletonSummary}>
            <View style={styles.skeletonRow}>
              <Skeleton width="40%" height={13} />
              <Skeleton width={60} height={13} />
            </View>
            <View style={styles.skeletonRow}>
              <Skeleton width="30%" height={13} />
              <Skeleton width={60} height={13} />
            </View>
            <View style={styles.skeletonRow}>
              <Skeleton width="55%" height={13} />
              <Skeleton width={60} height={13} />
            </View>
            <Skeleton width="100%" height={1} style={{ marginVertical: spacing.sm }} />
            <View style={styles.skeletonRow}>
              <Skeleton width="35%" height={14} />
              <Skeleton width={80} height={22} />
            </View>
          </View>
          {/* Address skeleton */}
          <Skeleton width={140} height={10} style={{ marginTop: spacing.lg, marginBottom: 12 }} />
          <View style={styles.skeletonAddress}>
            <Skeleton width={18} height={18} borderRadius={9} />
            <View style={{ flex: 1 }}>
              <Skeleton width="50%" height={14} />
              <Skeleton width="70%" height={13} style={{ marginTop: spacing.xs }} />
              <Skeleton width="40%" height={13} style={{ marginTop: spacing.xs }} />
            </View>
          </View>
        </View>
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
            <Text style={styles.summaryValue}>{formatPrice(transaction.amount)}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Livraison</Text>
            <Text style={styles.summaryValue}>{formatPrice(transaction.shippingCost)}</Text>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Frais de protection Seconde</Text>
            <Text style={styles.summaryValue}>{formatPrice(serviceFee)}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total à payer</Text>
            <Text style={styles.totalValue}>{formatPrice(totalAmount)}</Text>
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
              Paiement sécurisé par Stripe. Vos données bancaires ne transitent jamais par Seconde. Remboursement si l'article ne correspond pas.
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
                PAYER {formatPrice(totalAmount)}
              </Text>
            </>
          )}
        </Pressable>
        <Text style={styles.disclaimer}>
          En confirmant, vous acceptez les conditions générales de vente de Seconde
        </Text>
      </View>

      {/* Stripe Payment Sheet */}
      {clientSecret && (
        <StripePayment
          clientSecret={clientSecret}
          visible={showStripePayment}
          onResult={handlePaymentResult}
          onClose={() => {
            setShowStripePayment(false);
            setClientSecret(null);
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
  skeletonContent: {
    padding: 20,
  },
  skeletonSummary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skeletonAddress: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.md,
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
