/**
 * Checkout — Shipping Address + Helcim Payment
 * 1. Enter shipping address  2. Select shipping option  3. Review price  4. Pay via Helcim
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import * as Haptics from 'expo-haptics';

import { colors, fonts } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { firestore, functions, auth } from '@/config/firebaseConfig';
import { Article, ShippingAddress } from '@/types';
import { TransactionService } from '@/services/transactionService';
import { ChatService } from '@/services/chatService';
import { ModerationService } from '@/services/moderationService';
import { HelcimPayment, HelcimPaymentResult } from '@/components/HelcimPayment';
import {
  ShippingAddressForm,
  ShippingEstimateList,
  PriceBreakdown,
  PayButton,
  ShippingCheckoutSkeleton,
  INITIAL_ADDRESS,
  FALLBACK_ESTIMATES,
} from '@/features/checkout-shipping';
import type { ShippingEstimate, AddressFormValues } from '@/features/checkout-shipping';

/** Default postal code used when seller location is unavailable */
const DEFAULT_SELLER_POSTAL_CODE = 'H2S3C4';

/** Canadian postal code pattern: A1A1A1 or A1A 1A1 */
const CA_POSTAL_RE = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

// =============================================================================
// SCREEN
// =============================================================================

export default function ShippingCheckoutScreen() {
  const router = useRouter();
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
  const [showHelcimPayment, setShowHelcimPayment] = useState(false);
  const [checkoutToken, setCheckoutToken] = useState<string | null>(null);
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const [serviceFee, setServiceFee] = useState(0);

  // --- Auth guard -------------------------------------------------------------

  useEffect(() => {
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
      .catch(() => setServiceFee(Math.round(finalPrice * 0.05 * 100) / 100));
  }, [finalPrice]);

  // --- Derived ---------------------------------------------------------------

  const totalAmount = finalPrice
    ? finalPrice + (selectedEstimate?.amount || 0) + serviceFee
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
        selectedEstimate.amount, shippingAddress, chat.id, serviceFee, selectedEstimate.rateId,
      );

      const result = await httpsCallable(functions, 'createHelcimCheckout')({ transactionId });
      const data = result.data as { success: boolean; checkoutToken: string };
      if (!data.success || !data.checkoutToken) throw new Error('Impossible de créer la session de paiement');

      setPendingTransactionId(transactionId);
      setPendingChatId(chat.id);
      setCheckoutToken(data.checkoutToken);
      setShowHelcimPayment(true);
    } catch (error: unknown) {
      if (__DEV__) console.error('Error initiating payment:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

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
  }, [article, selectedEstimate, submitting, canPay, addressForm, serviceFee, finalPrice, router]);

  const handlePaymentResult = useCallback(async (result: HelcimPaymentResult) => {
    setShowHelcimPayment(false);
    setCheckoutToken(null);

    if (!result.success) {
      if (pendingTransactionId) {
        await TransactionService.updateTransactionStatus(pendingTransactionId, 'cancelled');
      }
      Alert.alert('Paiement échoué', result.error || 'Veuillez réessayer.');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
  }, [pendingTransactionId, pendingChatId, article, selectedEstimate, serviceFee, totalAmount, finalPrice, router]);

  // --- Render ----------------------------------------------------------------

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
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Article introuvable</Text>
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
      </ScrollView>

      <PayButton
        totalAmount={totalAmount}
        canPay={canPay}
        submitting={submitting}
        onPress={handlePay}
        bottomInset={insets.bottom}
      />

      {checkoutToken && (
        <HelcimPayment
          checkoutToken={checkoutToken}
          visible={showHelcimPayment}
          onResult={handlePaymentResult}
          onClose={() => { setShowHelcimPayment(false); setCheckoutToken(null); }}
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
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 },
});
