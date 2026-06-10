/**
 * Checkout — Success Screen
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Shows confirmation after:
 * - Meetup confirmed (meetup_pending transaction created)
 * - Payment confirmed (shipping transaction paid)
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPrice, formatPriceWithCurrency } from '@/utils/formatPrice';
import { TransactionDeliveryType } from '@/types';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function CheckoutSuccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const deliveryType = params.deliveryType as TransactionDeliveryType;
  const articleTitle = params.articleTitle as string;
  const amount = params.amount as string;
  const shippingCost = params.shippingCost as string | undefined;
  const serviceFee = params.serviceFee as string | undefined;
  const totalAmount = params.totalAmount as string | undefined;
  const spotName = params.spotName as string | undefined;
  const chatId = params.chatId as string | undefined;
  const transactionId = params.transactionId as string;

  const isMeetup = deliveryType === 'meetup';

  // =============================================================================
  // HANDLERS
  // =============================================================================

  const handleContactSeller = () => {
    if (chatId) {
      router.replace(`/chat/${chatId}`);
    } else {
      router.replace('/(tabs)');
    }
  };

  const handleViewOrder = () => {
    // TODO: create /order/[id] screen for detailed order view
    if (chatId && isMeetup) {
      router.replace(`/chat/${chatId}`);
    } else {
      router.replace('/my-orders');
    }
  };

  const handleGoHome = () => {
    router.replace('/(tabs)');
  };

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <View style={styles.container} testID="checkout-success-screen">
      <View style={[styles.statusBarSpacer, { height: insets.top }]} />

      {/* Center content */}
      <View style={styles.centerContent}>
        {/* Checkmark */}
        <View style={styles.checkCircle}>
          <Ionicons name="checkmark" size={32} color={colors.success} />
        </View>

        {/* Title — for meetup, an offer was sent (not yet confirmed): the
            seller must accept it before the transaction exists (F8/F17). */}
        <Text style={styles.title}>
          {isMeetup ? 'Demande envoyée' : 'Paiement confirmé'}
        </Text>
        <Text style={styles.subtitle}>
          {isMeetup
            ? 'Votre demande de rencontre a été envoyée au vendeur. Vous serez notifié·e dès qu\'il l\'aura acceptée — convenez ensuite d\'un créneau par messagerie.'
            : 'Le vendeur a été notifié et préparera l\'expédition de votre article. Vous recevrez un numéro de suivi.'}
        </Text>

        {/* Summary card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Article</Text>
            <Text style={styles.summaryValue}>{articleTitle}</Text>
          </View>

          {isMeetup ? (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Prix</Text>
                <Text style={[styles.summaryValue, styles.summaryPrice]}>{formatPrice(parseFloat(amount || '0'))}</Text>
              </View>
              {spotName && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Lieu</Text>
                  <Text style={styles.summaryValue}>{spotName}</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Type</Text>
                <View style={styles.meetupBadge}>
                  <Text style={styles.meetupBadgeText}>MEETUP</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Prix</Text>
                <Text style={styles.summaryValue}>{formatPrice(parseFloat(amount || '0'))}</Text>
              </View>
              {serviceFee && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Frais de service</Text>
                  <Text style={styles.summaryValue}>{formatPrice(parseFloat(serviceFee || '0'))}</Text>
                </View>
              )}
              {shippingCost && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Livraison</Text>
                  <Text style={styles.summaryValue}>{formatPrice(parseFloat(shippingCost || '0'))}</Text>
                </View>
              )}
              {totalAmount && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Total payé</Text>
                  <Text style={[styles.summaryValue, styles.summaryPrice]}>
                    {formatPriceWithCurrency(parseFloat(totalAmount || '0'))}
                  </Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Type</Text>
                <View style={styles.shippingBadge}>
                  <Text style={styles.shippingBadgeText}>EXPÉDITION</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </View>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          testID="checkout-success-contact-seller"
          style={styles.ctaButton}
          onPress={isMeetup ? handleContactSeller : handleViewOrder}
        >
          {isMeetup ? (
            <>
              <Ionicons name="chatbubble-outline" size={16} color={colors.cream} />
              <Text style={styles.ctaButtonText}>CONTACTER LE VENDEUR</Text>
            </>
          ) : (
            <Text style={styles.ctaButtonText}>VOIR MA COMMANDE</Text>
          )}
        </Pressable>
        <Pressable style={styles.secondaryLink} onPress={handleGoHome}>
          <Text style={styles.secondaryLinkText}>Retour à l'accueil</Text>
        </Pressable>
      </View>
    </View>
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
  statusBarSpacer: {
    // Dynamic height via insets.top
  },

  // Center content
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.successLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: fonts.displayMedium,
    fontSize: 26,
    color: colors.charcoal,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 32,
    maxWidth: 280,
  },

  // Summary card
  summaryCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 16,
    width: '100%',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  summaryValue: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.charcoal,
    flexShrink: 1,
    textAlign: 'right',
    maxWidth: '60%',
  },
  summaryPrice: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 16,
    color: colors.rust,
  },

  // Badges
  meetupBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
  },
  meetupBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.sage,
    textTransform: 'uppercase',
  },
  shippingBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
  },
  shippingBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.rust,
    textTransform: 'uppercase',
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
    backgroundColor: colors.charcoal,
    paddingVertical: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  ctaButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  secondaryLink: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryLinkText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.72,
  },
});
