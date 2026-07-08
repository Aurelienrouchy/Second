/**
 * Checkout — Shipping Address + Stripe Payment
 * 1. Enter shipping address  2. Select shipping option  3. Review price  4. Pay via Stripe
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform, Pressable, Switch,
  ActivityIndicator,
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
import { classifyStripePaymentError } from '@/utils/stripePaymentError';
import { getCallableErrorCode, mapCallableError } from '@/utils/callableError';
import { isPaidStatus } from '@/lib/transactionStatusMeta';
import { track } from '@/lib/analytics';

/** Default postal code used when seller location is unavailable */
const DEFAULT_SELLER_POSTAL_CODE = 'H2S3C4';

/** Canadian postal code pattern: A1A1A1 or A1A 1A1 */
const CA_POSTAL_RE = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

/** How long to wait for the webhook to flip status before proceeding anyway. */
const PAYMENT_CONFIRM_TIMEOUT_MS = 12000;
/** Delay between transaction status polls. */
const PAYMENT_CONFIRM_POLL_MS = 1500;

/**
 * True when the server rejected the payment because the selected shipping
 * rate has expired and must be re-quoted (re-tarification serveur).
 */
function isRateExpiredError(error: unknown): boolean {
  if (getCallableErrorCode(error) !== 'failed-precondition') return false;
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
  const [addressForm, setAddressForm] = useState<AddressFormValues>(() => {
    // Pre-fill from the user profile at mount.
    const user = useAuthStore.getState().user;
    if (!user) return INITIAL_ADDRESS;
    return {
      ...INITIAL_ADDRESS,
      fullName: user.displayName || '',
      address: user.address?.street || '',
      city: user.address?.city || '',
      province: user.address?.province || '',
      postalCode: user.address?.postalCode || '',
    };
  });
  const [estimates, setEstimates] = useState<ShippingEstimate[]>([]);
  const [selectedEstimate, setSelectedEstimate] = useState<ShippingEstimate | null>(null);
  const [showStripePayment, setShowStripePayment] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  /**
   * Server-authoritative buyer total (createStripeCheckout feeBreakdown). The
   * recap above (PriceBreakdown) is built from server-priced components
   * (getServiceFee + getShippingEstimate); this is the final total the backend
   * actually charges. Once known, it overrides the displayed recap total so the
   * buyer never sees a client-guessed amount diverge from the charge (F124).
   */
  const [serverBuyerTotal, setServerBuyerTotal] = useState<number | null>(null);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const [serviceFee, setServiceFee] = useState(0);
  /** Sales tax (TPS/TVQ) on the service fee — 0 when TAX_ENABLED=false. */
  const [taxTotal, setTaxTotal] = useState(0);
  /** True while polling Firestore for the webhook to flip status to 'paid'. */
  const [confirmingPayment, setConfirmingPayment] = useState(false);

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

  const handleSelectEstimate = useCallback(
    (estimate: ShippingEstimate) => {
      setSelectedEstimate(estimate);
      const parsedDays = parseInt(estimate.deliveryDays, 10);
      track('shipping_rate_selected', {
        carrier: estimate.carrier,
        service: estimate.serviceName,
        amount_cents: Math.round(estimate.amount * 100),
        delivery_days: Number.isFinite(parsedDays) ? parsedDays : undefined,
        is_fallback_rate: isFallbackRate(estimate.rateId),
        rate_index: estimates.findIndex((e) => e.rateId === estimate.rateId),
      });
    },
    [estimates],
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
        track('shipping_estimates_loaded', {
          article_id: article.id,
          rates_count: data.rates.length,
          is_fallback: false,
          first_rate_cents: Math.round((data.rates[0]?.amount ?? 0) * 100),
          postal_code_fsa: pc.slice(0, 3).toUpperCase(),
        });
      }
    } catch (e) {
      if (__DEV__) console.error('Error fetching shipping estimates:', e);
      setEstimates(FALLBACK_ESTIMATES);
      setSelectedEstimate(FALLBACK_ESTIMATES[0]);
      track('shipping_estimates_loaded', {
        article_id: article.id,
        rates_count: FALLBACK_ESTIMATES.length,
        is_fallback: true,
        first_rate_cents: Math.round((FALLBACK_ESTIMATES[0]?.amount ?? 0) * 100),
        postal_code_fsa: pc.slice(0, 3).toUpperCase(),
      });
    } finally {
      setLoadingEstimates(false);
    }
  }, [article, sellerPostalCode, addressForm.postalCode, addressForm.city, addressForm.province, addressForm.fullName]);

  useEffect(() => {
    if (addressForm.postalCode.replace(/\s/g, '').length >= 6) {
      (async () => {
        await fetchShippingEstimates();
      })();
    }
  }, [addressForm.postalCode, fetchShippingEstimates]);

  // --- Service fee -----------------------------------------------------------

  useEffect(() => {
    if (!finalPrice) return;
    httpsCallable(functions, 'getServiceFee')({ articlePrice: finalPrice, articleId: article?.id })
      .then((r) => {
        const d = r.data as { serviceFee: number; taxTotal?: number };
        setServiceFee(d.serviceFee || 0);
        setTaxTotal(typeof d.taxTotal === 'number' ? d.taxTotal : 0);
      })
      .catch(() => {
        setServiceFee(Math.max(2.00, Math.round((finalPrice * 0.05 + 1.50) * 100) / 100));
        setTaxTotal(0);
      });
  }, [finalPrice, article?.id]);

  // --- Derived ---------------------------------------------------------------

  const totalAmount = finalPrice
    ? finalPrice + (selectedEstimate?.amount || 0) + serviceFee + taxTotal
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

  /** Postal code is required and must match the Canadian format. */
  const postalCodeValid = CA_POSTAL_RE.test(addressForm.postalCode.trim());

  const canPay = !!(
    addressForm.fullName && addressForm.address && addressForm.city
    && addressForm.province && postalCodeValid && selectedEstimate
  );

  // --- Payment ---------------------------------------------------------------

  const handlePay = useCallback(async () => {
    if (!article || !selectedEstimate || submitting) return;
    const currentUser = auth.currentUser;
    if (!currentUser) { Alert.alert('Erreur', 'Vous devez être connecté pour acheter.'); return; }
    if (!canPay) { Alert.alert('Erreur', 'Veuillez remplir tous les champs obligatoires.'); return; }

    track('payment_submitted', {
      screen: 'checkout',
      article_id: article.id,
      final_price_cents: Math.round(finalPrice * 100),
      shipping_cents: Math.round((selectedEstimate.amount || 0) * 100),
      service_fee_cents: Math.round(serviceFee * 100),
      tax_cents: Math.round(taxTotal * 100),
      total_cents: totalAmountCents,
      uses_wallet: useWalletBalance,
      wallet_covers_all: walletCoversAll,
      card_amount_cents: Math.round(cardAmountDollars * 100),
      is_fallback_rate: isFallbackRate(selectedEstimate.rateId),
      has_negotiated_price: negotiatedPrice != null,
    });

    // ── ShipEngine indisponible (rate fallback_*) ──────────────────────────
    // Un tarif de repli ne permet pas d'acheter une vraie étiquette : on
    // bloque le paiement carte et on oriente vers la remise en main propre.
    if (isFallbackRate(selectedEstimate.rateId)) {
      const canMeetup = article.isHandDelivery !== false;
      const buttons = [
        {
          text: CHECKOUT_COPY.shippingDownCtaPrimary,
          onPress: () => {
            track('checkout_blocked', {
              article_id: article.id,
              guard_type: 'fallback_rate',
              cta_chosen: 'retry_rates',
            });
            fetchShippingEstimates();
          },
        },
        ...(canMeetup
          ? [{
              text: CHECKOUT_COPY.shippingDownCtaSecondary,
              onPress: () => {
                track('checkout_blocked', {
                  article_id: article.id,
                  guard_type: 'fallback_rate',
                  cta_chosen: 'switch_meetup',
                });
                track('checkout_delivery_selected', {
                  article_id: article.id,
                  delivery_type: 'meetup',
                  via: 'shipping_unavailable',
                  price_cents: Math.round(finalPrice * 100),
                });
                goToMeetup();
              },
            }]
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
        track('payment_init_failed', { failure_type: 'blocked_users' });
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
        track('wallet_payment_completed', {
          screen: 'checkout',
          transaction_id: transactionId,
          total_cents: totalAmountCents,
        });
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
      const data = result.data as {
        success: boolean;
        clientSecret: string;
        feeBreakdown?: { buyerTotal?: number };
      };
      if (!data.success || !data.clientSecret) throw new Error('Impossible de créer la session de paiement');

      setPendingTransactionId(transactionId);
      setPendingChatId(chat.id);
      const buyerTotal =
        typeof data.feeBreakdown?.buyerTotal === 'number' ? data.feeBreakdown.buyerTotal : null;
      setServerBuyerTotal(buyerTotal);
      setClientSecret(data.clientSecret);
      setShowStripePayment(true);
      track('payment_sheet_presented', {
        source: 'checkout',
        context_id: transactionId,
        server_buyer_total_cents: Math.round((buyerTotal ?? totalAmount) * 100),
        wallet_amount_cents: walletAmountCents > 0 ? walletAmountCents : undefined,
        is_retry: false,
      });
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

      // Map the callable error to the right title/message: a rate-limit
      // (resource-exhausted) must NOT read as "Article indisponible" (F129).
      // `failed-precondition` keeps the server message ("Cet article a déjà été
      // vendu"). Only a genuine article-unavailable error ejects the buyer back.
      const code = getCallableErrorCode(error);
      const articleUnavailable =
        code === 'failed-precondition' &&
        /vendu|indisponible|disponible/i.test(
          error instanceof Error ? error.message : '',
        );
      track('payment_init_failed', {
        transaction_id: createdTransactionId ?? undefined,
        failure_type: isRateExpiredError(error)
          ? 'rate_expired'
          : code === 'resource-exhausted'
            ? 'rate_limited'
            : articleUnavailable
              ? 'article_unavailable'
              : 'other',
        error_code: code ?? undefined,
      });

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

      const { title, message } = mapCallableError(error, {
        title: 'Paiement impossible',
        message: "Impossible d'initier le paiement. Veuillez réessayer.",
      });
      Alert.alert(
        articleUnavailable ? 'Article indisponible' : title,
        message,
        articleUnavailable
          ? [{ text: 'OK', onPress: () => router.back() }]
          : [{ text: 'OK' }],
      );
    } finally {
      setSubmitting(false);
    }
  }, [article, selectedEstimate, submitting, canPay, addressForm, serviceFee, finalPrice, router, walletCoversAll, useWalletBalance, walletAmountCents, totalAmount, queryClient, fetchShippingEstimates, goToMeetup]);

  const retryStripePayment = useCallback(async () => {
    if (!pendingTransactionId) return;
    track('payment_retried', {
      transaction_id: pendingTransactionId,
      uses_wallet: useWalletBalance,
    });
    try {
      setSubmitting(true);
      const result = await httpsCallable(functions, 'createStripeCheckout')({ transactionId: pendingTransactionId });
      const data = result.data as {
        success: boolean;
        clientSecret: string;
        feeBreakdown?: { buyerTotal?: number };
      };
      if (!data.success || !data.clientSecret) throw new Error('Impossible de relancer le paiement');
      const buyerTotal =
        typeof data.feeBreakdown?.buyerTotal === 'number' ? data.feeBreakdown.buyerTotal : null;
      setServerBuyerTotal(buyerTotal);
      setClientSecret(data.clientSecret);
      setShowStripePayment(true);
      track('payment_sheet_presented', {
        source: 'checkout',
        context_id: pendingTransactionId,
        server_buyer_total_cents: Math.round((buyerTotal ?? totalAmount) * 100),
        is_retry: true,
      });
    } catch (error: unknown) {
      if (__DEV__) console.error('Error retrying payment:', error);
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
      const msg = error instanceof Error ? error.message : 'Impossible de relancer le paiement.';
      Alert.alert('Erreur', msg);
    } finally {
      setSubmitting(false);
    }
  }, [pendingTransactionId, fetchShippingEstimates, useWalletBalance, totalAmount]);

  const cancelPendingTransaction = useCallback(async () => {
    if (pendingTransactionId) {
      let success = true;
      try {
        await TransactionService.updateTransactionStatus(pendingTransactionId, 'cancelled');
      } catch (cancelError) {
        success = false;
        if (__DEV__) console.error('Error cancelling transaction:', cancelError);
      }
      track('order_cancel_submitted', {
        transaction_id: pendingTransactionId,
        role: 'buyer',
        source: 'checkout_failure',
        status_at_cancel: 'pending_payment',
        total_cents: totalAmountCents,
        success,
      });
    }
    router.back();
  }, [pendingTransactionId, router, totalAmountCents]);

  const navigateToSuccess = useCallback(() => {
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
  }, [queryClient, router, pendingTransactionId, article, finalPrice, selectedEstimate, serviceFee, totalAmount, pendingChatId]);

  const handlePaymentResult = useCallback(async (result: StripePaymentResult) => {
    setShowStripePayment(false);
    setClientSecret(null);
    setServerBuyerTotal(null);

    if (!result.success) {
      // User explicitly dismissed the sheet — keep the transaction payable for
      // ~1h (no new tx) and tell the buyer they can resume (audit F102).
      if (result.error === 'cancelled') {
        Alert.alert(
          'Paiement annulé',
          'Votre commande reste réservée pendant environ 1 heure. Reprenez le paiement quand vous voulez, ou annulez pour libérer l\'article.',
          [
            { text: 'Reprendre', onPress: retryStripePayment },
            { text: 'Annuler la commande', style: 'destructive', onPress: cancelPendingTransaction },
          ],
        );
        return;
      }

      // Real failure — classify (carte refusée / 3DS abandonné / réseau) and
      // offer a retry on the SAME transaction (no new tx) rather than cancelling.
      const classified = classifyStripePaymentError(result);
      Alert.alert(
        classified.title,
        classified.message,
        [
          { text: 'Réessayer', onPress: retryStripePayment },
          { text: 'Annuler la commande', style: 'destructive', onPress: cancelPendingTransaction },
        ],
      );
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // The Payment Sheet succeeded on Stripe's side, but the transaction is
    // only marked 'paid' once the stripeWebhook fires server-side. Poll the
    // transaction status before showing the confirmation screen so we never
    // claim "Paiement confirmé" while the order is still pending_payment.
    if (!pendingTransactionId) {
      navigateToSuccess();
      return;
    }

    setConfirmingPayment(true);
    const startedAt = Date.now();
    while (Date.now() - startedAt < PAYMENT_CONFIRM_TIMEOUT_MS) {
      try {
        const trans = await TransactionService.getTransaction(pendingTransactionId);
        if (trans && isPaidStatus(trans.status)) {
          setConfirmingPayment(false);
          track('payment_confirmation_polled', {
            transaction_id: pendingTransactionId,
            outcome: 'confirmed',
            poll_duration_ms: Date.now() - startedAt,
          });
          navigateToSuccess();
          return;
        }
      } catch (e) {
        if (__DEV__) console.error('Error polling transaction status:', e);
      }
      await new Promise((r) => setTimeout(r, PAYMENT_CONFIRM_POLL_MS));
    }

    // Webhook is lagging — proceed to the confirmation screen anyway (the
    // payment did succeed; the order detail will reflect the final status).
    setConfirmingPayment(false);
    track('payment_confirmation_polled', {
      transaction_id: pendingTransactionId,
      outcome: 'timeout',
      poll_duration_ms: Date.now() - startedAt,
    });
    navigateToSuccess();
  }, [pendingTransactionId, retryStripePayment, cancelPendingTransaction, navigateToSuccess]);

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
          <Text style={styles.guardTitle}>Cet article n&apos;est plus disponible</Text>
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
    <View style={styles.container}>
      <ScreenHeader title="Paiement" onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ShippingAddressForm
          values={addressForm}
          onChangeField={handleAddressChange}
          postalCodeError={addressForm.postalCode.trim().length > 0 && !postalCodeValid}
        />
        <ShippingEstimateList
          estimates={estimates}
          selectedEstimate={selectedEstimate}
          onSelect={handleSelectEstimate}
          loading={loadingEstimates}
          postalCodeLength={addressForm.postalCode.length}
        />
        <PriceBreakdown
          articlePrice={finalPrice}
          selectedEstimate={selectedEstimate}
          serviceFee={serviceFee}
          totalAmount={serverBuyerTotal ?? totalAmount}
          taxTotal={taxTotal}
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
                  onValueChange={(enabled) => {
                    setUseWalletBalance(enabled);
                    track('wallet_payment_toggled', {
                      screen: 'checkout',
                      enabled,
                      wallet_balance_cents: walletBalanceCents,
                      total_cents: totalAmountCents,
                      covers_all: walletBalanceCents >= totalAmountCents,
                    });
                  }}
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
        disabled={showStripePayment}
      />

      {clientSecret && (
        <StripePayment
          clientSecret={clientSecret}
          visible={showStripePayment}
          onResult={handlePaymentResult}
          analyticsSource="checkout"
          analyticsContextId={pendingTransactionId ?? undefined}
          analyticsAmountCents={Math.round(cardAmountDollars * 100)}
        />
      )}
      </KeyboardAvoidingView>

      {confirmingPayment && (
        <View style={styles.confirmOverlay}>
          <ActivityIndicator size="large" color={colors.rust} />
          <Text style={styles.confirmTitle}>Confirmation du paiement…</Text>
          <Text style={styles.confirmSubtitle}>
            Ne fermez pas l&apos;application, nous finalisons votre commande.
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
  container: { flex: 1, backgroundColor: colors.surfaceWarm },
  flex: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  confirmOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surfaceWarm,
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
