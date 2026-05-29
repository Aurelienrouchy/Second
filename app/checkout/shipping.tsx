/**
 * Checkout — Shipping Address + Stripe Payment
 * 1. Enter shipping address  2. Select shipping option  3. Review price  4. Pay via Stripe
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform, Pressable, Switch,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import * as Haptics from 'expo-haptics';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { firestore, functions, auth } from '@/config/firebaseConfig';
import { Article, ShippingAddress } from '@/types';
import { TransactionService } from '@/services/transactionService';
import { ChatService } from '@/services/chatService';
import { ModerationService } from '@/services/moderationService';
import { WalletService } from '@/services/walletService';
import { StripePayment, StripePaymentResult } from '@/components/StripePayment';
import {
  ShippingAddressForm,
  ShippingEstimateList,
  PriceBreakdown,
  PayButton,
  ShippingCheckoutSkeleton,
  INITIAL_ADDRESS,
  FALLBACK_ESTIMATES,
  isFallbackRate,
  CHECKOUT_COPY,
} from '@/features/checkout-shipping';
import type { ShippingEstimate, AddressFormValues } from '@/features/checkout-shipping';
import { homeKeys } from '@/features/home/query-keys';
import { useAuthStore } from '@/store/authStore';
import { useWallet } from '@/hooks/useWallet';
import { SHIPPING_ENABLED } from '@/config/featureFlags';

/** Default postal code used when seller location is unavailable */
const DEFAULT_SELLER_POSTAL_CODE = 'H2S3C4';

/** Canadian postal code pattern: A1A1A1 or A1A 1A1 */
const CA_POSTAL_RE = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

/**
 * Resolve a Firebase callable error into its stable code suffix.
 * httpsCallable wraps server HttpsError into FirebaseError with
 * code = "functions/<code>" (e.g. "functions/failed-precondition").
 */
function getCallableErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

/**
 * True when the server rejected the payment because the selected shipping
 * rate has expired and must be re-quoted (re-tarification serveur).
 */
function isRateExpiredError(error: unknown): boolean {
  if (getCallableErrorCode(error) !== 'functions/failed-precondition') return false;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('tarif') || message.includes('expir') || message.includes('rate');
}

// =============================================================================
// SCREEN
// =============================================================================

export default function ShippingCheckoutScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { articleId, chatId: paramChatId, negotiatedPrice } = useLocalSearchParams<{
    articleId: string;
    chatId?: string;
    negotiatedPrice?: string;
  }>();

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingEstimates, setLoadingEstimates] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressFormValues>(INITIAL_ADDRESS);
  const [estimates, setEstimates] = useState<ShippingEstimate[]>([]);
  const [selectedEstimate, setSelectedEstimate] = useState<ShippingEstimate | null>(null);
  const [showStripePayment, setShowStripePayment] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const [serviceFee, setServiceFee] = useState(0);

  // ── Wallet ──────────────────────────────────────────────────────────────────
  const { wallet } = useWallet(!!auth.currentUser);
  const [useWalletBalance, setUseWalletBalance] = useState(false);

  // --- Auth guard -------------------------------------------------------------

  useEffect(() => {
    // Garde-fou deep link : le shipping est désactivé, on renvoie au checkout.
    if (!SHIPPING_ENABLED) {
      router.replace('/checkout');
      return;
    }
    if (!auth.currentUser) {
      router.replace('/(tabs)');
    }
  }, [router]);

  // --- Pre-fill address from user profile -----------------------------------

  useEffect(() => {
    const user = useAuthStore.getState().user;
    if (!user) return;
    setAddressForm((prev) => ({
      ...prev,
      fullName: prev.fullName || user.displayName || '',
      address: prev.address || user.address?.street || '',
      city: prev.city || user.address?.city || '',
      province: prev.province || user.address?.province || '',
      postalCode: prev.postalCode || user.address?.postalCode || '',
    }));
  }, []);

  // --- Negotiated price (from accepted offer) --------------------------------

  const finalPrice = article
    ? (negotiatedPrice ? parseFloat(negotiatedPrice) : article.price)
    : 0;

  // Use seller's location from the article if it looks like a postal code
  const sellerPostalCode =
    (article?.location && CA_POSTAL_RE.test(article.location.trim())
      ? article.location.trim().replace(/\s/g, '').toUpperCase()
      : null)
    || DEFAULT_SELLER_POSTAL_CODE;

  const handleAddressChange = useCallback(
    <K extends keyof AddressFormValues>(field: K, value: AddressFormValues[K]) => {
      setAddressForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  // --- Navigate to hand-delivery (meetup) checkout ---------------------------

  const goToMeetup = useCallback(() => {
    if (!article) return;
    router.replace({
      pathname: '/checkout/meetup' as any,
      params: { articleId: article.id },
    });
  }, [article, router]);

  // --- Load article ----------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(firestore, 'articles', articleId as string));
        if (snap.exists()) setArticle({ id: snap.id, ...snap.data() } as Article);
      } catch (e) {
        if (__DEV__) console.error('Error loading article:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [articleId]);

  // --- Shipping estimates ----------------------------------------------------

  const fetchShippingEstimates = useCallback(async () => {
    const pc = addressForm.postalCode.replace(/\s/g, '');
    if (!article || pc.length < 6) return;
    try {
      setLoadingEstimates(true);
      const result = await httpsCallable(functions, 'getShippingEstimate')({
        fromAddress: { postalCode: sellerPostalCode },
        toAddress: {
          postalCode: addressForm.postalCode,
          city: addressForm.city,
          province: addressForm.province,
          name: addressForm.fullName,
        },
        weight: article.weight || 0.5,
        dimensions: article.dimensions || { length: 30, width: 25, height: 10 },
      });
      const data = result.data as { success: boolean; rates: ShippingEstimate[] };
      if (data.success && data.rates?.length > 0) {
        setEstimates(data.rates);
        setSelectedEstimate(data.rates[0]);
      }
    } catch (e) {
      if (__DEV__) console.error('Error fetching shipping estimates:', e);
      setEstimates(FALLBACK_ESTIMATES);
      setSelectedEstimate(FALLBACK_ESTIMATES[0]);
    } finally {
      setLoadingEstimates(false);
    }
  }, [article, sellerPostalCode, addressForm.postalCode, addressForm.city, addressForm.province, addressForm.fullName]);

  useEffect(() => {
    if (addressForm.postalCode.replace(/\s/g, '').length >= 6) fetchShippingEstimates();
  }, [addressForm.postalCode, fetchShippingEstimates]);

  // --- Service fee -----------------------------------------------------------

  useEffect(() => {
    if (!finalPrice) return;
    httpsCallable(functions, 'getServiceFee')({ articlePrice: finalPrice })
      .then((r) => {
        const d = r.data as { serviceFee: number };
        setServiceFee(d.serviceFee || 0);
      })
      .catch(() => setServiceFee(Math.max(2.00, Math.round((finalPrice * 0.05 + 1.50) * 100) / 100)));
  }, [finalPrice]);

  // --- Derived ---------------------------------------------------------------

  const totalAmount = finalPrice
    ? finalPrice + (selectedEstimate?.amount || 0) + serviceFee
    : 0;

  /** Total in cents for wallet comparison (backend amounts are in cents). */
  const totalAmountCents = Math.round(totalAmount * 100);

  /** Wallet balance available (in cents). */
  const walletBalanceCents = wallet?.hasWallet ? wallet.balance : 0;

  /** Whether wallet can cover the full amount. */
  const walletCoversAll = useWalletBalance && walletBalanceCents >= totalAmountCents;

  /** Amount (in dollars) that must be paid by card when using partial wallet. */
  const cardAmountDollars = useWalletBalance
    ? Math.max(0, (totalAmountCents - walletBalanceCents) / 100)
    : totalAmount;

  /** Wallet amount that will be used (in cents), capped at total. */
  const walletAmountCents = useWalletBalance
    ? Math.min(walletBalanceCents, totalAmountCents)
    : 0;

  const canPay = !!(
    addressForm.fullName && addressForm.address && addressForm.city
    && addressForm.postalCode && selectedEstimate
  );

  // --- Payment ---------------------------------------------------------------

  const handlePay = useCallback(async () => {
    if (!article || !selectedEstimate || submitting) return;
    const currentUser = auth.currentUser;
    if (!currentUser) { Alert.alert('Erreur', 'Vous devez être connecté pour acheter.'); return; }
    if (!canPay) { Alert.alert('Erreur', 'Veuillez remplir tous les champs obligatoires.'); return; }

    // ── ShipEngine indisponible (rate fallback_*) ──────────────────────────
    // Un tarif de repli ne permet pas d'acheter une vraie étiquette : on
    // bloque le paiement carte et on oriente vers la remise en main propre.
    if (isFallbackRate(selectedEstimate.rateId)) {
      const buttons = [
        { text: CHECKOUT_COPY.shippingDownCtaPrimary, onPress: fetchShippingEstimates },
        ...(article.isHandDelivery !== false
          ? [{ text: CHECKOUT_COPY.shippingDownCtaSecondary, onPress: goToMeetup }]
          : []),
      ];
      Alert.alert(CHECKOUT_COPY.shippingDownTitle, CHECKOUT_COPY.shippingDownBody, buttons);
      return;
    }

    let createdTransactionId: string | null = null;

    try {
      setSubmitting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Check if users are blocked before proceeding
      const blocked = await ModerationService.areUsersBlocked(currentUser.uid, article.sellerId);
      if (blocked) {
        Alert.alert('Action impossible', 'Vous ne pouvez pas acheter cet article.');
        return;
      }

      const shippingAddress: ShippingAddress = {
        name: addressForm.fullName,
        street: addressForm.apartment
          ? `${addressForm.address}, ${addressForm.apartment}`
          : addressForm.address,
        city: addressForm.city,
        province: addressForm.province,
        postalCode: addressForm.postalCode,
        country: 'CA',
      };

      const chat = await ChatService.createOrGetChat(currentUser.uid, article.sellerId, article.id);
      const transactionId = await TransactionService.createShippingTransaction(
        article.id, currentUser.uid, article.sellerId, finalPrice,
        selectedEstimate.amount, shippingAddress, selectedEstimate.rateId, chat.id, serviceFee,
      );
      createdTransactionId = transactionId;

      // ── Full wallet payment ─────────────────────────────────────────────
      if (walletCoversAll) {
        await WalletService.payWithWallet(transactionId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: homeKeys.all });
        router.replace({
          pathname: '/checkout/success' as any,
          params: {
            transactionId,
            deliveryType: 'shipping',
            articleTitle: article.title || '',
            amount: String(finalPrice),
            shippingCost: String(selectedEstimate.amount || 0),
            serviceFee: String(serviceFee),
            totalAmount: String(totalAmount),
            chatId: chat.id,
          },
        });
        return;
      }

      // ── Stripe checkout (optionally with partial wallet) ────────────────
      const checkoutParams: Record<string, unknown> = { transactionId };
      if (useWalletBalance && walletAmountCents > 0) {
        checkoutParams.walletAmount = walletAmountCents;
      }

      const result = await httpsCallable(functions, 'createStripeCheckout')(checkoutParams);
      const data = result.data as { success: boolean; clientSecret: string };
      if (!data.success || !data.clientSecret) throw new Error('Impossible de créer la session de paiement');

      setPendingTransactionId(transactionId);
      setPendingChatId(chat.id);
      setClientSecret(data.clientSecret);
      setShowStripePayment(true);
    } catch (error: unknown) {
      if (__DEV__) console.error('Error initiating payment:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      // If the transaction was created but Stripe checkout failed,
      // cancel it so the article is not left blocked in pending_payment.
      if (createdTransactionId) {
        try {
          await TransactionService.updateTransactionStatus(createdTransactionId, 'cancelled');
        } catch (cancelError) {
          if (__DEV__) console.error('Error cancelling orphan transaction:', cancelError);
        }
      }

      // ── Tarif de livraison expiré (re-tarification serveur) ──────────────
      // Le serveur a invalidé le rateId : on propose de réactualiser
      // l'estimation pour obtenir un tarif à jour avant de repayer.
      if (isRateExpiredError(error)) {
        Alert.alert(
          CHECKOUT_COPY.rateExpiredTitle,
          CHECKOUT_COPY.rateExpiredBody,
          [
            { text: CHECKOUT_COPY.rateExpiredCtaSecondary, style: 'cancel' },
            { text: CHECKOUT_COPY.rateExpiredCtaPrimary, onPress: fetchShippingEstimates },
          ],
        );
        return;
      }

      // Cloud Function errors arrive as FirebaseError with a readable
      // message (e.g. "Cet article a deja ete vendu"). Surface it so
      // the buyer understands why the purchase failed.
      const msg = error instanceof Error ? error.message : 'Impossible d\'initier le paiement.';
      Alert.alert('Article indisponible', msg, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } finally {
      setSubmitting(false);
    }
  }, [article, selectedEstimate, submitting, canPay, addressForm, serviceFee, finalPrice, router, walletCoversAll, useWalletBalance, walletAmountCents, totalAmount, queryClient, fetchShippingEstimates, goToMeetup]);

  const retryStripePayment = useCallback(async () => {
    if (!pendingTransactionId) return;
    try {
      setSubmitting(true);
      const result = await httpsCallable(functions, 'createStripeCheckout')({ transactionId: pendingTransactionId });
      const data = result.data as { success: boolean; clientSecret: string };
      if (!data.success || !data.clientSecret) throw new Error('Impossible de relancer le paiement');
      setClientSecret(data.clientSecret);
      setShowStripePayment(true);
    } catch (error: unknown) {
      if (__DEV__) console.error('Error retrying payment:', error);
      const msg = error instanceof Error ? error.message : 'Impossible de relancer le paiement.';
      Alert.alert('Erreur', msg);
    } finally {
      setSubmitting(false);
    }
  }, [pendingTransactionId]);

  const cancelPendingTransaction = useCallback(async () => {
    if (pendingTransactionId) {
      try {
        await TransactionService.updateTransactionStatus(pendingTransactionId, 'cancelled');
      } catch (cancelError) {
        if (__DEV__) console.error('Error cancelling transaction:', cancelError);
      }
    }
    router.back();
  }, [pendingTransactionId, router]);

  const handlePaymentResult = useCallback(async (result: StripePaymentResult) => {
    setShowStripePayment(false);
    setClientSecret(null);

    if (!result.success) {
      // User explicitly cancelled the payment sheet — do nothing
      if (result.error === 'cancelled') return;

      // Payment failed — offer retry instead of immediately cancelling
      Alert.alert(
        'Le paiement a echoue',
        result.error || 'Voulez-vous reessayer ?',
        [
          { text: 'Reessayer', onPress: retryStripePayment },
          { text: 'Annuler', style: 'destructive', onPress: cancelPendingTransaction },
        ],
      );
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    queryClient.invalidateQueries({ queryKey: homeKeys.all });
    router.replace({
      pathname: '/checkout/success' as any,
      params: {
        transactionId: pendingTransactionId || '',
        deliveryType: 'shipping',
        articleTitle: article?.title || '',
        amount: String(finalPrice),
        shippingCost: String(selectedEstimate?.amount || 0),
        serviceFee: String(serviceFee),
        totalAmount: String(totalAmount),
        chatId: pendingChatId || '',
      },
    });
  }, [pendingTransactionId, pendingChatId, article, selectedEstimate, serviceFee, totalAmount, finalPrice, router, retryStripePayment, cancelPendingTransaction]);

  // --- Render ----------------------------------------------------------------

  // Shipping désactivé : ne rien rendre (la redirection est gérée plus haut).
  if (!SHIPPING_ENABLED) {
    return null;
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Paiement" onBack={() => router.back()} />
        <ShippingCheckoutSkeleton />
      </View>
    );
  }

  if (!article) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Paiement" onBack={() => router.back()} />
        <View style={styles.guardContainer}>
          <Text style={styles.errorText}>Article introuvable</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (article.isSold) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Paiement" onBack={() => router.back()} />
        <View style={styles.guardContainer}>
          <Ionicons name="bag-check-outline" size={40} color={colors.muted} />
          <Text style={styles.guardTitle}>Cet article n'est plus disponible</Text>
          <Text style={styles.guardSubtitle}>Il a déjà été vendu.</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (auth.currentUser && auth.currentUser.uid === article.sellerId) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Paiement" onBack={() => router.back()} />
        <View style={styles.guardContainer}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.muted} />
          <Text style={styles.guardTitle}>Vous ne pouvez pas acheter votre propre article</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Paiement" onBack={() => router.back()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ShippingAddressForm values={addressForm} onChangeField={handleAddressChange} />
        <ShippingEstimateList
          estimates={estimates}
          selectedEstimate={selectedEstimate}
          onSelect={setSelectedEstimate}
          loading={loadingEstimates}
          postalCodeLength={addressForm.postalCode.length}
        />
        <PriceBreakdown
          articlePrice={finalPrice}
          selectedEstimate={selectedEstimate}
          serviceFee={serviceFee}
          totalAmount={totalAmount}
        />

        {/* Wallet section */}
        {wallet?.hasWallet && wallet.balance > 0 && (
          <View style={styles.walletSection}>
            <Text style={styles.walletSectionTitle}>PORTE-MONNAIE</Text>
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
          </View>
        )}
      </ScrollView>

      <PayButton
        totalAmount={walletCoversAll ? 0 : cardAmountDollars}
        canPay={canPay}
        submitting={submitting}
        onPress={handlePay}
        bottomInset={insets.bottom}
        walletCoversAll={walletCoversAll}
        useWallet={useWalletBalance}
      />

      {clientSecret && (
        <StripePayment
          clientSecret={clientSecret}
          visible={showStripePayment}
          onResult={handlePaymentResult}
          onClose={() => { setShowStripePayment(false); setClientSecret(null); }}
          totalAmount={totalAmount}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceWarm },
  centered: { justifyContent: 'center', alignItems: 'center' },
  errorText: { fontFamily: fonts.sans, fontSize: 14, color: colors.muted },
  guardContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  guardTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    color: colors.charcoal,
    textAlign: 'center',
  },
  guardSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  backBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.charcoal,
    borderRadius: radius.md,
  },
  backBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 },

  // ── Wallet section ─────────────────────────────────────────────────────────

  walletSection: {
    marginTop: spacing.lg,
  },
  walletSectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  walletCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
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
