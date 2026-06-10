/**
 * Payment Screen — Stripe Payment Sheet
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Used when navigating to an existing pending_payment transaction.
 * Creates a Stripe checkout session and presents the native Payment Sheet.
 */

import React, { useCallback, useEffect, useState } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';

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
import { mapCallableError } from '@/utils/callableError';
import { isPaidStatus } from '@/lib/transactionStatusMeta';

// =============================================================================
// CONSTANTS
// =============================================================================

/** How long to wait for the webhook to flip status before proceeding anyway. */
const PAYMENT_CONFIRM_TIMEOUT_MS = 12000;
/** Delay between transaction status polls. */
const PAYMENT_CONFIRM_POLL_MS = 1500;

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Reasons a pending_payment transaction cannot be paid on this screen.
 * Returned by the queryFn (no side effects) and acted on by an effect.
 */
type NotPayableReason = 'not_found' | 'forbidden' | 'already_processed';

export default function PaymentScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useUser();
  const queryClient = useQueryClient();

  const [isCreatingCheckout, setIsCreatingCheckout] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

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
    data: queryResult,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.payments.transaction(transactionId ?? ''),
    // Pure read — no Alert / router side effects here, so a refetch never fires
    // a parasitic "déjà traitée" alert nor an extra back navigation (F121).
    queryFn: async () => {
      const trans = await TransactionService.getTransaction(transactionId!);
      if (!trans) return { transaction: null, notPayable: 'not_found' as const };
      if (trans.buyerId !== user?.id) {
        return { transaction: null, notPayable: 'forbidden' as const };
      }
      if (trans.status !== 'pending_payment') {
        return { transaction: null, notPayable: 'already_processed' as const };
      }
      return { transaction: trans, notPayable: null };
    },
    enabled: !!transactionId && !!user,
    staleTime: 2 * 60 * 1000, // 2 min
  });

  const transaction = queryResult?.transaction ?? null;
  const notPayable: NotPayableReason | null = queryResult?.notPayable ?? null;

  // React to a not-payable transaction once (outside the queryFn). When the
  // transaction is no longer payable (e.g. already paid in another tab/webhook),
  // refresh the orders list so it shows up there, then return to the previous
  // screen — without ever surfacing a misleading error on a successful payment.
  useEffect(() => {
    if (!notPayable) return;
    if (notPayable === 'already_processed') {
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      router.back();
      return;
    }
    const message =
      notPayable === 'forbidden'
        ? "Vous n'êtes pas autorisé pour cette transaction."
        : 'Transaction introuvable.';
    Alert.alert('Erreur', message, [{ text: 'OK', onPress: () => router.back() }]);
  }, [notPayable, queryClient, router]);

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

      // Full wallet payment. payWithWallet is server-authoritative and flips the
      // transaction to 'paid' synchronously (no webhook wait), so we can confirm
      // immediately. Invalidate orders/payments so the new order appears in
      // my-orders (F120). Single navigation to success — no double back (F121).
      if (walletCoversAll) {
        await WalletService.payWithWallet(transaction.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
        router.replace({
          pathname: '/checkout/success' as any,
          params: {
            transactionId: transaction.id,
            deliveryType: transaction.deliveryType ?? 'shipping',
            amount: String(transaction.amount ?? ''),
            shippingCost: String(transaction.shippingCost ?? 0),
            serviceFee: String(serviceFee),
            totalAmount: String(totalAmount),
            chatId: transaction.chatId ?? '',
          },
        });
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

  // F122 — Cancel an abandoned pending_payment from this screen instead of
  // leaving the article locked (isSold) until the 1h expiry. cancelPendingTransaction
  // (vague 3) cancels the PaymentIntent and refunds any wallet portion, then
  // re-lists the article. Confirmation required (irreversible).
  const handleCancel = useCallback(() => {
    if (!transactionId || isCancelling) return;
    Alert.alert(
      'Annuler la commande',
      "L'article sera de nouveau disponible à l'achat. Vous pourrez le racheter plus tard s'il est toujours en vente.",
      [
        { text: 'Continuer le paiement', style: 'cancel' },
        {
          text: 'Annuler la commande',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsCancelling(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              await httpsCallable(functions, 'cancelPendingTransaction')({ transactionId });
              queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
              queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.back();
            } catch (error: unknown) {
              if (__DEV__) console.error('Error cancelling transaction:', error);
              const { title, message } = mapCallableError(error, {
                title: 'Annulation impossible',
                message: 'Impossible d’annuler cette commande pour le moment.',
              });
              Alert.alert(title, message);
            } finally {
              setIsCancelling(false);
            }
          },
        },
      ],
    );
  }, [transactionId, isCancelling, queryClient, router]);

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

      // Make the new order visible in my-orders/payments regardless of which
      // confirmation branch we land on (F120).
      const invalidateOrders = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
      };

      // Genuine confirmation: the webhook has flipped the status to paid+.
      const confirmAndExit = () => {
        invalidateOrders();
        Alert.alert(
          'Paiement confirmé !',
          'L\'étiquette d\'expédition sera générée automatiquement. Le vendeur sera notifié.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      };

      // Honest fallback when the webhook lags past the timeout: the card was
      // charged but the order isn't confirmed yet. We do NOT claim success
      // (F120) — we tell the buyer it is being confirmed and point them to
      // their orders, where the final status will appear.
      const pendingConfirmExit = () => {
        invalidateOrders();
        Alert.alert(
          'Paiement en cours de confirmation',
          'Votre paiement a bien été pris en compte. La confirmation de votre commande peut prendre quelques instants — vous la retrouverez dans « Mes commandes ».',
          [{ text: 'Voir mes commandes', onPress: () => router.replace('/my-orders') }],
        );
      };

      // The Payment Sheet succeeded on Stripe's side, but the transaction is
      // only marked 'paid' once stripeWebhook fires server-side. Poll the
      // status before confirming so we never claim success while still
      // pending_payment.
      if (!transactionId) {
        pendingConfirmExit();
        return;
      }

      setConfirmingPayment(true);
      const startedAt = Date.now();
      while (Date.now() - startedAt < PAYMENT_CONFIRM_TIMEOUT_MS) {
        try {
          const trans = await TransactionService.getTransaction(transactionId);
          if (trans && isPaidStatus(trans.status)) {
            setConfirmingPayment(false);
            confirmAndExit();
            return;
          }
        } catch (e) {
          if (__DEV__) console.error('Error polling transaction status:', e);
        }
        await new Promise((r) => setTimeout(r, PAYMENT_CONFIRM_POLL_MS));
      }

      // Webhook lagging past the timeout — be honest (not a fake success).
      setConfirmingPayment(false);
      pendingConfirmExit();
    },
    [router, transactionId, retryStripePayment, queryClient]
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

        {/* Cancel — frees the article immediately instead of waiting for the
            1h expiry (F122). */}
        <Pressable
          style={styles.cancelLink}
          onPress={handleCancel}
          disabled={isCancelling || isCreatingCheckout || showStripePayment}
          hitSlop={8}
        >
          {isCancelling ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : (
            <Text style={styles.cancelLinkText}>Annuler la commande</Text>
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
  cancelLink: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  cancelLinkText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.muted,
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
