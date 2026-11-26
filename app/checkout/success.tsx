/**
 * Checkout — Success Screen
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Shows confirmation after:
 * - Meetup confirmed (meetup_pending transaction created)
 * - Payment confirmed (shipping transaction paid)
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Button, ScreenHeader } from '@/components/ui';
import { useAuthenticatedSession } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransactionService } from '@/services/transactionService';
import { hasConfirmedPurchasePayment } from '@/services/manualPaymentService';

import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { formatPrice, formatPriceWithCurrency } from '@/utils/formatPrice';
import {readScopedQuery} from '@/utils/readScopedQuery';
import type { Transaction, TransactionDeliveryType } from '@/types';
import { track } from '@/lib/analytics';

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
  const transactionId = typeof params.transactionId === 'string' ? params.transactionId : '';

  const isMeetup = deliveryType === 'meetup';
  const { uid } = useAuthenticatedSession();
  const generation = getAuthSessionGeneration();
  const proofContext = useShippingPurchaseContext(transactionId, uid);
  const confirmationQuery = useQuery<Transaction>({
    queryKey: ['shipping-confirmation', uid, generation, transactionId, proofContext.focusRevision],
    enabled: !isMeetup && !!uid && !!transactionId && proofContext.focused, staleTime: 0, gcTime: 0, retry: false,
    refetchInterval: query => proofContext.focused && query.state.data?.status === 'pending_payment' &&
      query.state.dataUpdateCount + query.state.errorUpdateCount < 8 ? 2000 : false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = proofContext.capture(); return () => proofContext.assertCurrent(operation);
    }, async current => {
      const order = await TransactionService.getTransaction(transactionId, {expectedUid: uid!, assertCurrent: current});
      current();
      if (!order || order.id !== transactionId || order.buyerId !== uid) throw new Error('Commande inaccessible.');
      return order;
    }),
  });
  const confirmedOrder = proofContext.focused && confirmationQuery.isSuccess && !confirmationQuery.isFetching && !confirmationQuery.isError && confirmationQuery.data && uid &&
    hasConfirmedPurchasePayment(confirmationQuery.data, uid) ? confirmationQuery.data : null;
  const routedOrder = useRef<string | null>(null);
  useEffect(() => {
    if (isMeetup || !uid || !confirmedOrder) return;
    const navigationKey = JSON.stringify([uid, generation, confirmedOrder.id, proofContext.focusRevision]);
    if (routedOrder.current === navigationKey) return;
    try { proofContext.capture(); } catch { return; }
    routedOrder.current = navigationKey;
    router.replace({pathname: '/orders/[id]', params: {id: confirmedOrder.id}});
  }, [uid, generation, confirmedOrder, isMeetup, proofContext, router]);

  const viewedRef = useRef(false);
  useEffect(() => {
    if (!isMeetup && !confirmedOrder) return;
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('order_confirmation_viewed', {
      delivery_type: deliveryType,
      transaction_id: transactionId || undefined,
      total_cents: confirmedOrder ? Math.round(confirmedOrder.totalAmount * 100) : totalAmount != null ? Math.round(parseFloat(totalAmount) * 100) : undefined,
      has_chat_id: !!chatId,
    });
  }, [deliveryType, transactionId, totalAmount, chatId, isMeetup, confirmedOrder]);

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
    if (!isMeetup && confirmationQuery.data?.buyerId === uid) {
      try { proofContext.capture(); } catch { return; }
      router.replace({ pathname: '/orders/[id]', params: { id: transactionId } });
      return;
    }
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

  if (!isMeetup) return <View style={styles.container}>
    <ScreenHeader title="Suivi du paiement" onBack={() => router.back()} />
    <View style={styles.shippingContent}>
      <Text style={styles.title}>{confirmedOrder ? 'Paiement enregistré' : confirmationQuery.isError ? 'Suivi indisponible' : 'Paiement en cours'}</Text>
      <Text style={styles.shippingBody}>{confirmedOrder
        ? 'Ouverture du suivi de votre commande…'
        : confirmationQuery.isError ? 'Impossible de retrouver le paiement pour le moment. Actualisez son suivi.'
        : 'Nous attendons la confirmation de votre paiement. Votre commande reste accessible.'}</Text>
      {confirmedOrder && <Text style={styles.shippingBody}>Total de la commande : {formatPriceWithCurrency(confirmedOrder.totalAmount)}</Text>}
      {confirmationQuery.data && <Button onPress={handleViewOrder}>Consulter cette commande</Button>}
      {uid && transactionId && !confirmedOrder && <Button variant="secondary" disabled={confirmationQuery.isFetching} onPress={() => {
        try {proofContext.capture();} catch {return;}
        void confirmationQuery.refetch();
      }}>Actualiser</Button>}
      <Button variant="secondary" onPress={() => router.replace('/my-orders')}>Mes commandes</Button>
      <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter l’équipe</Button>
    </View>
  </View>;

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
          <Text style={styles.secondaryLinkText}>Retour à l&apos;accueil</Text>
        </Pressable>
      </View>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  shippingContent: { flex: 1, padding: spacing.lg, gap: spacing.md, justifyContent: 'center' },
  shippingBody: { ...typography.bodySmall, color: colors.foregroundSecondary },
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
