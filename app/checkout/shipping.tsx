/**
 * Checkout — Shipping Address + Helcim Payment
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * 1. Enter shipping address
 * 2. Select shipping option (ShipEngine multi-carrier estimates)
 * 3. Review price breakdown with service fees
 * 4. Pay via Helcim (HelcimPay.js WebView)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import { ScreenHeader } from '@/components/ui';
import { firestore, functions, auth } from '@/config/firebaseConfig';
import { Article, ShippingAddress } from '@/types';
import { TransactionService } from '@/services/transactionService';
import { ChatService } from '@/services/chatService';
import { HelcimPayment, HelcimPaymentResult } from '@/components/HelcimPayment';

// =============================================================================
// TYPES
// =============================================================================

interface ShippingEstimate {
  rateId: string;
  carrier: string;
  carrierCode: string;
  serviceName: string;
  amount: number;
  deliveryDays: string;
  deliveryType: 'home' | 'pickup_point';
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ShippingCheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const articleId = params.articleId as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadingEstimates, setLoadingEstimates] = useState(false);

  // Address form
  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [apartment, setApartment] = useState('');
  const [city, setCity] = useState('Montreal');
  const [postalCode, setPostalCode] = useState('');
  const [province, setProvince] = useState('QC');

  // Shipping
  const [estimates, setEstimates] = useState<ShippingEstimate[]>([]);
  const [selectedEstimate, setSelectedEstimate] = useState<ShippingEstimate | null>(null);

  // Helcim payment
  const [showHelcimPayment, setShowHelcimPayment] = useState(false);
  const [checkoutToken, setCheckoutToken] = useState<string | null>(null);

  // Service fee
  const [serviceFee, setServiceFee] = useState(0);

  // =============================================================================
  // LOAD ARTICLE
  // =============================================================================

  useEffect(() => {
    async function loadArticle() {
      try {
        const articleRef = doc(firestore, 'articles', articleId);
        const articleDoc = await getDoc(articleRef);
        if (articleDoc.exists()) {
          setArticle({ id: articleDoc.id, ...articleDoc.data() } as Article);
        }
      } catch (error) {
        console.error('Error loading article:', error);
      } finally {
        setLoading(false);
      }
    }
    loadArticle();
  }, [articleId]);

  // =============================================================================
  // SHIPPING ESTIMATES — Multi-carrier via ShipEngine
  // =============================================================================

  const fetchShippingEstimates = useCallback(async () => {
    if (!article || !postalCode || postalCode.replace(/\s/g, '').length < 6) return;

    try {
      setLoadingEstimates(true);
      const getEstimate = httpsCallable(functions, 'getShippingEstimate');
      const result = await getEstimate({
        fromAddress: { postalCode: 'H2S3C4' }, // Default seller postal code (will be fetched from seller profile)
        toAddress: { postalCode, city, province, name: fullName },
        weight: article.weight || 0.5,
        dimensions: article.dimensions || { length: 30, width: 25, height: 10 },
      });

      const data = result.data as { success: boolean; rates: ShippingEstimate[] };
      if (data.success && data.rates?.length > 0) {
        setEstimates(data.rates);
        setSelectedEstimate(data.rates[0]);
      }
    } catch (error) {
      console.error('Error fetching shipping estimates:', error);
      // Fallback estimates
      const fallback: ShippingEstimate[] = [
        {
          rateId: 'fallback_standard',
          carrier: 'Intelcom',
          carrierCode: 'intelcom_ca',
          serviceName: 'Standard',
          amount: 8.50,
          deliveryDays: '3-5 jours ouvrables',
          deliveryType: 'home',
        },
        {
          rateId: 'fallback_express',
          carrier: 'Intelcom',
          carrierCode: 'intelcom_ca',
          serviceName: 'Express',
          amount: 14.50,
          deliveryDays: '1-2 jours ouvrables',
          deliveryType: 'home',
        },
      ];
      setEstimates(fallback);
      setSelectedEstimate(fallback[0]);
    } finally {
      setLoadingEstimates(false);
    }
  }, [article, postalCode, city, province, fullName]);

  useEffect(() => {
    if (postalCode.replace(/\s/g, '').length >= 6) {
      fetchShippingEstimates();
    }
  }, [postalCode, fetchShippingEstimates]);

  // =============================================================================
  // SERVICE FEE CALCULATION
  // =============================================================================

  useEffect(() => {
    if (!article) return;
    const getServiceFeeCall = httpsCallable(functions, 'getServiceFee');
    getServiceFeeCall({ articlePrice: article.price })
      .then((result) => {
        const data = result.data as { serviceFee: number };
        setServiceFee(data.serviceFee || 0);
      })
      .catch(() => {
        // Fallback: 5% du prix
        setServiceFee(Math.round(article.price * 0.05 * 100) / 100);
      });
  }, [article]);

  // =============================================================================
  // PAYMENT — Helcim checkout flow
  // =============================================================================

  // Stored transaction ID for the payment flow
  const [pendingTransactionId, setPendingTransactionId] = useState<string | null>(null);
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);

  const handlePay = async () => {
    if (!article || !selectedEstimate || submitting) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert('Erreur', 'Vous devez être connecté pour acheter.');
      return;
    }

    if (!fullName || !address || !city || !postalCode) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs obligatoires.');
      return;
    }

    try {
      setSubmitting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const shippingAddress: ShippingAddress = {
        name: fullName,
        street: apartment ? `${address}, ${apartment}` : address,
        city,
        postalCode,
        country: 'CA',
      };

      // Create or get chat
      const chat = await ChatService.createOrGetChat(
        currentUser.uid,
        article.sellerId,
        article.id,
      );

      // Create transaction (includes service fee)
      const transactionId = await TransactionService.createShippingTransaction(
        article.id,
        currentUser.uid,
        article.sellerId,
        article.price,
        selectedEstimate.amount,
        shippingAddress,
        chat.id,
        serviceFee,
        selectedEstimate.rateId,
      );

      // Create Helcim checkout session via Cloud Function
      const createCheckout = httpsCallable(functions, 'createHelcimCheckout');
      const result = await createCheckout({ transactionId });
      const data = result.data as { success: boolean; checkoutToken: string };

      if (!data.success || !data.checkoutToken) {
        throw new Error('Impossible de créer la session de paiement');
      }

      // Store transaction info and open Helcim payment modal
      setPendingTransactionId(transactionId);
      setPendingChatId(chat.id);
      setCheckoutToken(data.checkoutToken);
      setShowHelcimPayment(true);
    } catch (error: any) {
      console.error('Error initiating payment:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', error.message || 'Impossible d\'initier le paiement.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Helcim payment result (called from WebView)
  const handlePaymentResult = useCallback(
    async (result: HelcimPaymentResult) => {
      setShowHelcimPayment(false);
      setCheckoutToken(null);

      if (!result.success) {
        if (pendingTransactionId) {
          await TransactionService.updateTransactionStatus(pendingTransactionId, 'cancelled');
        }
        Alert.alert('Paiement échoué', result.error || 'Veuillez réessayer.');
        return;
      }

      // Payment succeeded — Helcim webhook handles the rest (label, balance, etc.)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      router.replace({
        pathname: '/checkout/success' as any,
        params: {
          transactionId: pendingTransactionId || '',
          deliveryType: 'shipping',
          articleTitle: article?.title || '',
          amount: String(article?.price || 0),
          shippingCost: String(selectedEstimate?.amount || 0),
          serviceFee: String(serviceFee),
          totalAmount: String(totalAmount),
          chatId: pendingChatId || '',
        },
      });
    },
    [pendingTransactionId, pendingChatId, article, selectedEstimate, serviceFee, router]
  );

  // =============================================================================
  // DERIVED
  // =============================================================================

  const totalAmount = article
    ? article.price + (selectedEstimate?.amount || 0) + serviceFee
    : 0;

  const canPay = fullName && address && city && postalCode && selectedEstimate;

  // =============================================================================
  // RENDER
  // =============================================================================

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.charcoal} />
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
        {/* Address section */}
        <Text style={styles.sectionTitle}>ADRESSE DE LIVRAISON</Text>
        <View style={styles.formGroup}>
          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>NOM COMPLET</Text>
            <TextInput
              style={styles.fieldInput}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Jean Dupont"
              placeholderTextColor={colors.muted}
              autoCapitalize="words"
            />
          </View>
          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>ADRESSE</Text>
            <TextInput
              style={styles.fieldInput}
              value={address}
              onChangeText={setAddress}
              placeholder="123 rue Exemple"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>APPARTEMENT (OPTIONNEL)</Text>
            <TextInput
              style={styles.fieldInput}
              value={apartment}
              onChangeText={setApartment}
              placeholder="Apt 2B"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.formFieldRow}>
            <View style={[styles.formFieldHalf, styles.formFieldHalfLeft]}>
              <Text style={styles.fieldLabel}>VILLE</Text>
              <TextInput
                style={styles.fieldInput}
                value={city}
                onChangeText={setCity}
                placeholderTextColor={colors.muted}
              />
            </View>
            <View style={styles.formFieldHalf}>
              <Text style={styles.fieldLabel}>CODE POSTAL</Text>
              <TextInput
                style={styles.fieldInput}
                value={postalCode}
                onChangeText={setPostalCode}
                placeholder="H2J 2K1"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
              />
            </View>
          </View>
        </View>

        {/* Shipping estimates */}
        <Text style={styles.sectionTitle}>LIVRAISON</Text>

        {loadingEstimates && (
          <View style={styles.estimateLoading}>
            <ActivityIndicator size="small" color={colors.charcoal} />
            <Text style={styles.estimateLoadingText}>Calcul des frais...</Text>
          </View>
        )}

        {!loadingEstimates && estimates.map((est, index) => {
          const isSelected = selectedEstimate?.serviceName === est.serviceName;
          return (
            <Pressable
              key={`est-${index}`}
              style={[styles.estimateCard, isSelected && styles.estimateCardSelected]}
              onPress={() => setSelectedEstimate(est)}
            >
              <View style={[styles.radio, isSelected && styles.radioSelected]}>
                {isSelected && <View style={styles.radioInner} />}
              </View>
              <View style={styles.estimateInfo}>
                <Text style={styles.estimateName}>{est.carrier} {est.serviceName}</Text>
                <Text style={styles.estimateDelay}>{est.deliveryDays}</Text>
              </View>
              <Text style={styles.estimatePrice}>{formatPrice(est.amount)}</Text>
            </Pressable>
          );
        })}

        {!loadingEstimates && estimates.length === 0 && postalCode.length >= 6 && (
          <Text style={styles.noEstimates}>
            Entrez votre code postal pour voir les options de livraison
          </Text>
        )}

        {/* Price breakdown */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>RÉCAPITULATIF</Text>
        <View style={styles.priceBreakdown}>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Article</Text>
            <Text style={styles.priceValue}>{formatPrice(article.price)}</Text>
          </View>
          {selectedEstimate && (
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>
                Livraison ({selectedEstimate.carrier} {selectedEstimate.serviceName})
              </Text>
              <Text style={styles.priceValue}>{formatPrice(selectedEstimate.amount)}</Text>
            </View>
          )}
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Frais de protection Seconde</Text>
            <Text style={styles.priceValue}>{formatPrice(serviceFee)}</Text>
          </View>
          <View style={styles.priceDivider} />
          <View style={styles.priceRowTotal}>
            <Text style={styles.priceTotalLabel}>Total</Text>
            <Text style={styles.priceTotalValue}>{formatPrice(totalAmount)}</Text>
          </View>
        </View>

        {/* Security notice */}
        <View style={styles.securityNotice}>
          <Ionicons name="shield-checkmark" size={16} color={colors.success} />
          <Text style={styles.securityNoticeText}>
            Paiement sécurisé par Helcim — Vos données bancaires ne sont jamais stockées par Seconde
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[
            styles.ctaButton,
            (!canPay || submitting) && styles.ctaButtonDisabled,
          ]}
          onPress={handlePay}
          disabled={!canPay || submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name="lock-closed-outline" size={16} color={colors.cream} />
              <Text style={styles.ctaButtonText}>
                PAYER {formatPrice(totalAmount)}
              </Text>
            </>
          )}
        </Pressable>
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
    </KeyboardAvoidingView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },


  // Scroll
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
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

  // Form
  formGroup: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginBottom: 20,
  },
  formField: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  formFieldRow: {
    flexDirection: 'row',
  },
  formFieldHalf: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  formFieldHalfLeft: {
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  fieldLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  fieldInput: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
    padding: 0,
  },

  // Shipping estimates
  estimateLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    justifyContent: 'center',
  },
  estimateLoadingText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  estimateCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 14,
    marginBottom: 8,
    alignItems: 'center',
  },
  estimateCardSelected: {
    borderColor: colors.charcoal,
    borderWidth: 2,
    padding: 13,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: colors.charcoal,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.charcoal,
  },
  estimateInfo: { flex: 1 },
  estimateName: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
    marginBottom: 2,
  },
  estimateDelay: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  estimatePrice: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 16,
    color: colors.charcoal,
  },
  noEstimates: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 16,
  },

  // Security notice
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  securityNoticeText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 15,
  },

  // Price breakdown
  priceBreakdown: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 16,
    marginTop: 4,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  priceLabel: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
  },
  priceValue: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },
  priceDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  priceRowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceTotalLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
  },
  priceTotalValue: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    color: colors.rust,
  },

  // Footer
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rust,
    paddingVertical: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  ctaButtonDisabled: {
    opacity: 0.6,
  },
  ctaButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
});
