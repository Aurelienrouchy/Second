/**
 * Shop Tier Upgrade Screen (F134)
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Le propriétaire d'une boutique achète / renouvelle un forfait payant
 * (basic gratuit / pro / premium). Le bénéfice vendu = réduction des frais
 * ACHETEUR (pro 50%, premium 100% — la commission vendeur reste 0%). Le
 * paiement est une charge plateforme directe : `purchaseShopTier` retourne un
 * clientSecret confirmé via le Payment Sheet (composant StripePayment partagé).
 * Le forfait n'est appliqué (tier + tierPaidUntil) qu'APRÈS confirmation du
 * paiement, côté serveur (webhook).
 */

import React, { useCallback, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { StripePayment, StripePaymentResult } from '@/components/StripePayment';
import { ShopService } from '@/services/shopService';
import { Shop } from '@/types';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { useUser } from '@/hooks/useAuth';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';

// =============================================================================
// CONSTANTS
// =============================================================================

type PaidTier = 'pro' | 'premium';

interface TierMeta {
  key: 'basic' | 'pro' | 'premium';
  name: string;
  /** Monthly price IN CENTS — display only (server is the source of truth). */
  monthlyCents: number;
  benefit: string;
  features: string[];
  accent: string;
}

/**
 * Display config. Prices mirror the server defaults in
 * functions/src/callable/shopTier.ts (pro 2999¢, premium 7999¢) but the actual
 * charged amount comes from the callable (`amountCents`) — never trusted here.
 */
const TIERS: readonly TierMeta[] = [
  {
    key: 'basic',
    name: 'Standard',
    monthlyCents: 0,
    benefit: 'Frais acheteur standard',
    features: ['0% de commission vendeur', 'Boutique vérifiée', 'Présence sur la carte'],
    accent: colors.muted,
  },
  {
    key: 'pro',
    name: 'Le Comptoir',
    monthlyCents: 2999,
    benefit: '-50% de frais acheteur',
    features: [
      '0% de commission vendeur',
      'Frais de protection acheteur réduits de moitié',
      'Visibilité renforcée',
    ],
    accent: colors.sage,
  },
  {
    key: 'premium',
    name: 'La Maison',
    monthlyCents: 7999,
    benefit: '0% de frais acheteur',
    features: [
      '0% de commission vendeur',
      'Aucun frais de protection pour vos acheteurs',
      'Mise en avant prioritaire',
    ],
    accent: colors.rust,
  },
] as const;

const PERIOD_OPTIONS: readonly number[] = [1, 3, 6, 12];

function formatCents(cents: number): string {
  return formatPriceWithCurrency(cents / 100);
}

function formatTierName(tier: string | undefined): string {
  return TIERS.find((t) => t.key === tier)?.name ?? 'Standard';
}

// =============================================================================
// SCREEN
// =============================================================================

export default function ShopUpgradeScreen() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useUser();

  const [selectedTier, setSelectedTier] = useState<PaidTier>('pro');
  const [periodMonths, setPeriodMonths] = useState<number>(1);
  const [isPurchasing, setIsPurchasing] = useState(false);
  // Snapshot "now" once at mount — the active-tier banner is a display-only
  // comparison; reading Date.now() during render is impure (React Compiler).
  const [mountedAt] = useState(() => Date.now());

  // Stripe Payment Sheet state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showStripePayment, setShowStripePayment] = useState(false);

  const {
    data: shop = null,
    isLoading,
    refetch,
  } = useQuery<Shop | null>({
    queryKey: queryKeys.shops.detail(shopId ?? ''),
    queryFn: () => ShopService.getShopById(shopId!),
    enabled: !!shopId,
    staleTime: 30 * 1000,
  });

  const isOwner = !!shop && !!user && shop.ownerId === user.id;

  const activeTierLabel = useMemo(() => {
    if (!shop) return null;
    const tier = shop.tier ?? 'basic';
    if (tier === 'basic') return 'Forfait actuel : Standard';
    const until = shop.tierPaidUntil;
    const isActive = !!until && until.getTime() > mountedAt;
    if (!isActive) {
      return `Forfait ${formatTierName(tier)} expiré`;
    }
    const untilLabel = until!.toLocaleDateString(APP_LOCALE, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return `Forfait ${formatTierName(tier)} actif jusqu'au ${untilLabel}`;
  }, [shop, mountedAt]);

  const selectedMeta = TIERS.find((t) => t.key === selectedTier)!;
  const estimatedTotalCents = selectedMeta.monthlyCents * periodMonths;

  // ---------------------------------------------------------------------------
  // Purchase flow
  // ---------------------------------------------------------------------------

  const currentTier = shop?.tier;

  const handlePurchase = useCallback(async () => {
    if (!shopId || isPurchasing) return;
    try {
      setIsPurchasing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const result = await ShopService.purchaseShopTier(shopId, selectedTier, periodMonths);
      if (!result.success || !result.clientSecret) {
        throw new Error('Impossible de créer le paiement du forfait');
      }
      track('shop_upgrade_submitted', {
        shop_id: shopId,
        tier: selectedTier,
        period_months: periodMonths as 1 | 3 | 6 | 12,
        estimated_total_cents: estimatedTotalCents,
        current_tier: currentTier ?? 'basic',
        success: true,
      });
      // amountCents is server-authoritative; the native sheet displays the
      // PaymentIntent amount directly.
      setClientSecret(result.clientSecret);
      setShowStripePayment(true);
    } catch (error: unknown) {
      if (__DEV__) console.error('Error purchasing shop tier:', error);
      track('shop_upgrade_submitted', {
        shop_id: shopId,
        tier: selectedTier,
        period_months: periodMonths as 1 | 3 | 6 | 12,
        estimated_total_cents: estimatedTotalCents,
        current_tier: shop?.tier ?? 'basic',
        success: false,
      });
      const msg = error instanceof Error ? error.message : "Impossible d'initier le paiement.";
      Alert.alert('Erreur', msg);
    } finally {
      setIsPurchasing(false);
    }
  }, [shopId, selectedTier, periodMonths, isPurchasing, estimatedTotalCents, shop?.tier]);

  const handlePaymentResult = useCallback(
    (result: StripePaymentResult) => {
      setShowStripePayment(false);
      setClientSecret(null);

      if (!result.success) {
        if (result.error !== 'cancelled') {
          Alert.alert('Paiement échoué', result.error || 'Veuillez réessayer.');
        }
        return;
      }

      // The webhook stamps tier + tierPaidUntil after the PaymentIntent
      // succeeds; refetch so the active-tier banner reflects it.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Forfait activé !',
        'Votre paiement a été confirmé. Votre forfait sera actif dans quelques instants.',
        [{ text: 'OK', onPress: () => refetch() }],
      );
    },
    [refetch],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Forfait boutique" onBack={() => router.back()} />
        <View style={styles.skeletonContent}>
          <Skeleton width="60%" height={14} style={{ marginBottom: spacing.lg }} />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={120} borderRadius={radius.md} style={{ marginBottom: spacing.md }} />
          ))}
        </View>
      </View>
    );
  }

  if (!shop || !isOwner) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Forfait boutique" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.muted} />
          <Text style={styles.errorTitle}>Accès réservé</Text>
          <Text style={styles.errorSubtitle}>
            Seul le propriétaire de la boutique peut gérer son forfait.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Forfait boutique" onBack={() => router.back()} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Active tier banner */}
        {!!activeTierLabel && (
          <View style={styles.activeBanner}>
            <Ionicons name="ribbon-outline" size={18} color={colors.primary} />
            <Text style={styles.activeBannerText}>{activeTierLabel}</Text>
          </View>
        )}

        <Text style={styles.intro}>
          Boostez votre boutique en réduisant les frais de vos acheteurs. La commission vendeur
          reste à 0% — le forfait est un argument de vente.
        </Text>

        {/* Tier cards */}
        {TIERS.map((tier) => {
          const isSelectable = tier.key !== 'basic';
          const isSelected = isSelectable && selectedTier === tier.key;
          const isCurrent = (shop.tier ?? 'basic') === tier.key;
          return (
            <Pressable
              key={tier.key}
              style={[
                styles.tierCard,
                isSelected && { borderColor: tier.accent, borderWidth: 2 },
                !isSelectable && styles.tierCardDisabled,
              ]}
              onPress={() => isSelectable && setSelectedTier(tier.key as PaidTier)}
              disabled={!isSelectable}
            >
              <View style={styles.tierHeader}>
                <View style={styles.tierTitleRow}>
                  <Text style={styles.tierName}>{tier.name}</Text>
                  {isCurrent && (
                    <View style={styles.currentBadge}>
                      <Text style={styles.currentBadgeText}>Actuel</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.tierPrice, { color: tier.accent }]}>
                  {tier.monthlyCents === 0 ? 'Gratuit' : `${formatCents(tier.monthlyCents)}/mois`}
                </Text>
              </View>

              <Text style={[styles.tierBenefit, { color: tier.accent }]}>{tier.benefit}</Text>

              <View style={styles.tierFeatures}>
                {tier.features.map((feature) => (
                  <View key={feature} style={styles.featureRow}>
                    <Ionicons name="checkmark-circle" size={16} color={tier.accent} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>

              {isSelectable && (
                <View style={[styles.radio, isSelected && { borderColor: tier.accent }]}>
                  {isSelected && <View style={[styles.radioDot, { backgroundColor: tier.accent }]} />}
                </View>
              )}
            </Pressable>
          );
        })}

        {/* Period selector */}
        <Text style={styles.sectionTitle}>DURÉE</Text>
        <View style={styles.periodRow}>
          {PERIOD_OPTIONS.map((months) => {
            const isSelected = periodMonths === months;
            return (
              <Pressable
                key={months}
                style={[styles.periodChip, isSelected && styles.periodChipActive]}
                onPress={() => setPeriodMonths(months)}
              >
                <Text style={[styles.periodChipText, isSelected && styles.periodChipTextActive]}>
                  {months} mois
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Footer — purchase CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.footerSummary}>
          <Text style={styles.footerLabel}>
            {selectedMeta.name} · {periodMonths} mois
          </Text>
          <Text style={styles.footerTotal}>{formatCents(estimatedTotalCents)}</Text>
        </View>
        <Pressable
          style={[styles.payButton, (isPurchasing || showStripePayment) && styles.payButtonDisabled]}
          onPress={handlePurchase}
          disabled={isPurchasing || showStripePayment}
        >
          {isPurchasing ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name="lock-closed-outline" size={16} color={colors.cream} />
              <Text style={styles.payButtonText}>SOUSCRIRE</Text>
            </>
          )}
        </Pressable>
      </View>

      {/* Stripe Payment Sheet */}
      {clientSecret && (
        <StripePayment
          clientSecret={clientSecret}
          visible={showStripePayment}
          onResult={handlePaymentResult}
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  skeletonContent: {
    padding: spacing.lg,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
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
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  activeBannerText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.primary,
  },
  intro: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.foregroundSecondary,
    marginBottom: spacing.lg,
  },
  tierCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tierCardDisabled: {
    opacity: 0.7,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  tierTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tierName: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 18,
    color: colors.charcoal,
  },
  currentBadge: {
    backgroundColor: colors.surfaceWarm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  currentBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.muted,
  },
  tierPrice: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
  },
  tierBenefit: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  tierFeatures: {
    gap: spacing.xs + 2,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.foregroundSecondary,
  },
  radio: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    marginTop: spacing.sm,
    marginBottom: spacing.sm + 4,
    textTransform: 'uppercase',
  },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  periodChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceWarm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  periodChipActive: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  periodChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.muted,
  },
  periodChipTextActive: {
    color: colors.cream,
  },
  footer: {
    backgroundColor: colors.cream,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  footerLabel: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
  },
  footerTotal: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 20,
    color: colors.rust,
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
});
