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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { useQuery } from '@tanstack/react-query';

import { ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { StripePayment, StripePaymentResult } from '@/components/StripePayment';
import { functions } from '@/config/firebaseConfig';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { useUser } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { WalletService } from '@/services/walletService';
import { TransactionService } from '@/services/transactionService';
import { queryKeys } from '@/lib/queryKeys';
import { formatPrice, formatPriceWithCurrency } from '@/utils/formatPrice';
import { classifyStripePaymentError } from '@/utils/stripePaymentError';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Transaction statuses that confirm the buyer's payment has been captured
 * server-side (set by stripeWebhook). Any of these means it is safe to show
 * the confirmation.
 */
const PAID_STATUSES = new Set<string>([
  'paid', 'label_created', 'shipped', 'delivered', 'completed',
]);

/** How long to wait for the webhook to flip status before proceeding anyway. */
const PAYMENT_CONFIRM_TIMEOUT_MS = 12000;
/** Delay between transaction status polls. */
const PAYMENT_CONFIRM_POLL_MS = 1500;

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PaymentScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useUser();

  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);

  // Stripe
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showStripePayment, setShowStripePayment] = useState(false);
  /** Server-authoritative buyer total (from createStripeCheckout feeBreakdown). */
  const [serverBuyerTotal, setServerBuyerTotal] = useState<number | null>(null);
  /** True while polling Firestore for the webhook to flip status to 'paid'. */
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  // Wallet
  const { wallet } = useWallet(!!user);
  const [useWalletBalance, setUseWalletBalance] = useState(false);

  // =============================================================================
  // LOAD TRANSACTION
  // =============================================================================

  const {
    data: transaction = null,
    isLoading,
    isError,
    refetch,
  } = useQuery({
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
  // DERIVED
  // =============================================================================

  const serviceFee = transaction?.serviceFee || 0;
  const taxTotal = transaction?.taxTotal || 0;
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
      const data = result.data as {
        success: boolean;
        clientSecret: string;
        feeBreakdown?: { buyerTotal?: number };
      };

      if (!data.success || !data.clientSecret) {
        throw new Error('Impossible de créer la session de paiement');
      }

      setServerBuyerTotal(
        typeof data.feeBreakdown?.buyerTotal === 'number' ? data.feeBreakdown.buyerTotal : null,
      );
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

  // Re-present the Payment Sheet on the SAME transaction (no new tx). The
  // backend keeps the transaction payable for ~1h after a failed attempt
  // (audit F102), so createStripeCheckout returns a fresh clientSecret for the
  // same pending_payment transaction. Wallet selection is preserved.
  const retryStripePayment = useCallback(async () => {
    if (!transactionId) return;
    try {
      setIsCreatingCheckout(true);
      const checkoutParams: Record<string, unknown> = { transactionId };
      if (useWalletBalance && walletAmountCents > 0) {
        checkoutParams.walletAmount = walletAmountCents;
      }
      const result = await httpsCallable(functions, 'createStripeCheckout')(checkoutParams);
      const data = result.data as {
        success: boolean;
        clientSecret: string;
        feeBreakdown?: { buyerTotal?: number };
      };
      if (!data.success || !data.clientSecret) {
        throw new Error('Impossible de relancer le paiement');
      }
      setServerBuyerTotal(
        typeof data.feeBreakdown?.buyerTotal === 'number' ? data.feeBreakdown.buyerTotal : null,
      );
      setClientSecret(data.clientSecret);
      setShowStripePayment(true);
    } catch (error: unknown) {
      if (__DEV__) console.error('Error retrying payment:', error);
      const msg = error instanceof Error ? error.message : 'Impossible de relancer le paiement.';
      Alert.alert('Erreur', msg);
    } finally {
      setIsCreatingCheckout(false);
    }
  }, [transactionId, useWalletBalance, walletAmountCents]);

  const handlePaymentResult = useCallback(
    async (result: StripePaymentResult) => {
      setShowStripePayment(false);
      setClientSecret(null);
      setServerBuyerTotal(null);

      if (!result.success) {
        // User explicitly dismissed the sheet — the transaction stays payable
        // for ~1h (no new tx needed), so we just inform without an error tone.
        if (result.error === 'cancelled') {
          Alert.alert(
            'Paiement annulé',
            'Votre commande reste réservée pendant environ 1 heure. Vous pouvez reprendre le paiement à tout moment.',
          );
          return;
        }

        // A real failure — classify (carte refusée / 3DS abandonné / réseau)
        // and offer a retry on the SAME transaction.
        const classified = classifyStripePaymentError(result);
        Alert.alert(
          classified.title,
          classified.message,
          classified.retryable
            ? [
                { text: 'Plus tard', style: 'cancel' },
                { text: 'Réessayer', onPress: retryStripePayment },
              ]
            : [{ text: 'OK' }],
        );
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const confirmAndExit = () => {
        Alert.alert(
          'Paiement confirmé !',
          'L\'étiquette d\'expédition sera générée automatiquement. Le vendeur sera notifié.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      };

      // The Payment Sheet succeeded on Stripe's side, but the transaction is
      // only marked 'paid' once stripeWebhook fires server-side. Poll the
      // status before confirming so we never claim success while still
      // pending_payment.
      if (!transactionId) {
        confirmAndExit();
        return;
      }

      setConfirmingPayment(true);
      const startedAt = Date.now();
      while (Date.now() - startedAt < PAYMENT_CONFIRM_TIMEOUT_MS) {
        try {
          const trans = await TransactionService.getTransaction(transactionId);
          if (trans && PAID_STATUSES.has(trans.status)) {
            setConfirmingPayment(false);
            confirmAndExit();
            return;
          }
        } catch (e) {
          if (__DEV__) console.error('Error polling transaction status:', e);
        }
        await new Promise((r) => setTimeout(r, PAYMENT_CONFIRM_POLL_MS));
      }

      // Webhook lagging — confirm anyway; the order detail reflects final status.
      setConfirmingPayment(false);
      confirmAndExit();
    },
    [router, transactionId, retryStripePayment]
  );

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

  if (isError) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Paiement" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.muted} />
          <Text style={styles.errorTitle}>Erreur de connexion</Text>
          <Text style={styles.errorSubtitle}>
            Impossible de charger cette transaction. Vérifiez votre connexion et réessayez.
          </Text>
          <Pressable style={styles.errorButton} onPress={() => refetch()}>
            <Text style={styles.errorButtonText}>Réessayer</Text>
          </Pressable>
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

          {taxTotal > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>TPS + TVQ</Text>
              <Text style={styles.summaryValue}>{formatPrice(taxTotal)}</Text>
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total à payer</Text>
            <Text style={styles.totalValue}>{formatPriceWithCurrency(totalAmount)}</Text>
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

        {/* Wallet section */}
        {wallet?.hasWallet && wallet.balance > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>PORTE-MONNAIE</Text>
            <View style={styles.walletCard}>
              <View style={styles.walletRow}>
                <View style={styles.walletRowLeft}>
                  <Ionicons name="wallet-outline" size={20} color={colors.primary} />
                  <View>
                    <Text style={styles.walletLabel}>Utiliser mon porte-monnaie</Text>
                    <Text style={styles.walletBalance}>
                      Solde : {(wallet.balance / 100).toFixed(2).replace('.', ',')} $
                    </Text>
                  </View>
                </View>
                <Switch
                  value={useWalletBalance}
                  onValueChange={setUseWalletBalance}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.white}
                />
              </View>
              {useWalletBalance && !walletCoversAll && (
                <Text style={styles.walletRemainder}>
                  Reste a payer par carte : {cardAmountDollars.toFixed(2).replace('.', ',')} $
                </Text>
              )}
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
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={[styles.payButton, (isCreatingCheckout || showStripePayment) && styles.payButtonDisabled]}
          onPress={handlePay}
          disabled={isCreatingCheckout || showStripePayment}
        >
          {isCreatingCheckout ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons
                name={walletCoversAll ? 'wallet-outline' : 'lock-closed-outline'}
                size={16}
                color={colors.cream}
              />
              <Text style={styles.payButtonText}>
                {walletCoversAll
                  ? 'PAYER AVEC LE PORTE-MONNAIE'
                  : useWalletBalance
                    ? `PAYER ${formatPriceWithCurrency(cardAmountDollars)} PAR CARTE`
                    : `PAYER ${formatPriceWithCurrency(totalAmount)}`}
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
            setServerBuyerTotal(null);
          }}
          totalAmount={serverBuyerTotal ?? totalAmount}
        />
      )}

      {confirmingPayment && (
        <View style={styles.confirmOverlay}>
          <ActivityIndicator size="large" color={colors.rust} />
          <Text style={styles.confirmTitle}>Confirmation du paiement…</Text>
          <Text style={styles.confirmSubtitle}>
            Ne fermez pas l'application, nous finalisons votre commande.
          </Text>
        </View>
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
  confirmOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: spacing.sm,
  },
  confirmTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    color: colors.charcoal,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  confirmSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Error state
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  errorTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    color: colors.charcoal,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  errorButton: {
    marginTop: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.charcoal,
    borderRadius: radius.md,
  },
  errorButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.cream,
    textTransform: 'uppercase',
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

  // Wallet
  walletCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  walletRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  walletLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },
  walletBalance: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  walletRemainder: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.primary,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
