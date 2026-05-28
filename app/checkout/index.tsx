/**
 * Checkout — Delivery Type Selection
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Shows article summary + delivery options:
 * - Meetup (free, in-person)
 * - Shipping (paid, ShipEngine)
 * Navigates to /checkout/meetup or /checkout/shipping
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';

import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Button, ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { ArticlesService } from '@/services/articlesService';
import { queryKeys } from '@/lib/queryKeys';
import { formatPrice } from '@/utils/formatPrice';
import { TransactionDeliveryType } from '@/types';
import { useAuthStore, selectUser } from '@/store/authStore';
import { SHIPPING_ENABLED } from '@/config/featureFlags';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function CheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const articleId = params.articleId as string;

  const user = useAuthStore(selectUser);

  const { data: article = null, isLoading: loading } = useQuery({
    queryKey: queryKeys.articles.detail(articleId),
    queryFn: () => ArticlesService.getArticleById(articleId),
    enabled: !!articleId,
    staleTime: 10 * 60 * 1000, // 10 min
  });

  // Auto-select delivery when only one option exists
  const autoDelivery: TransactionDeliveryType | null = (() => {
    // Shipping désactivé : tout passe par le main-à-main (articles legacy inclus).
    if (!SHIPPING_ENABLED) return 'meetup';
    if (!article) return null;
    const meetup = article.isHandDelivery !== false;
    const shipping = article.isShipping === true;
    if (meetup && !shipping) return 'meetup';
    if (!meetup && shipping) return 'shipping';
    return null;
  })();

  const [selectedDelivery, setSelectedDelivery] = useState<TransactionDeliveryType | null>(null);
  const effectiveDelivery = selectedDelivery ?? autoDelivery;

  // =============================================================================
  // HANDLERS
  // =============================================================================

  const handleBack = () => router.back();

  const handleContinue = () => {
    if (!effectiveDelivery || !article) return;

    if (effectiveDelivery === 'meetup') {
      router.push({
        pathname: '/checkout/meetup' as any,
        params: { articleId: article.id },
      });
    } else {
      router.push({
        pathname: '/checkout/shipping' as any,
        params: { articleId: article.id },
      });
    }
  };

  // =============================================================================
  // DERIVED
  // =============================================================================

  const hasMeetup = article?.isHandDelivery !== false;
  const hasShipping = article?.isShipping === true;

  // =============================================================================
  // RENDER
  // =============================================================================

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Commander" onBack={handleBack} />
        <View style={styles.skeletonContent}>
          {/* Article summary skeleton */}
          <Skeleton width="30%" height={10} style={{ marginBottom: spacing.sm }} />
          <View style={styles.skeletonArticle}>
            <Skeleton width={64} height={80} borderRadius={0} />
            <View style={styles.skeletonArticleInfo}>
              <Skeleton width="40%" height={10} />
              <Skeleton width="70%" height={16} style={{ marginTop: spacing.sm }} />
              <Skeleton width="30%" height={20} style={{ marginTop: spacing.sm }} />
              <Skeleton width="50%" height={10} style={{ marginTop: spacing.sm }} />
            </View>
          </View>
          {/* Delivery options skeleton */}
          <Skeleton width="40%" height={10} style={{ marginBottom: spacing.sm }} />
          <Skeleton width="100%" height={90} borderRadius={radius.sm} style={{ marginBottom: spacing.sm }} />
          <Skeleton width="100%" height={90} borderRadius={radius.sm} />
        </View>
      </View>
    );
  }

  if (!article) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ScreenHeader title="Commander" onBack={handleBack} />
        <View style={styles.guardContainer}>
          <Text style={styles.errorText}>Article introuvable</Text>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backButtonText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (article.isSold) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Commander" onBack={handleBack} />
        <View style={styles.guardContainer}>
          <Ionicons name="bag-check-outline" size={40} color={colors.muted} />
          <Text style={styles.guardTitle}>Cet article n'est plus disponible</Text>
          <Text style={styles.guardSubtitle}>Il a déjà été vendu.</Text>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backButtonText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (user?.id === article.sellerId) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Commander" onBack={handleBack} />
        <View style={styles.guardContainer}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.muted} />
          <Text style={styles.guardTitle}>Vous ne pouvez pas acheter votre propre article</Text>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backButtonText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Commander" onBack={handleBack} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Article summary */}
        <Text style={styles.sectionTitle}>ARTICLE</Text>
        <View style={styles.articleSummary}>
          {article.images?.[0]?.url && (
            <Image
              source={{ uri: article.images[0].url }}
              style={styles.articleImage}
              contentFit="cover"
            />
          )}
          <View style={styles.articleInfo}>
            {article.brand && (
              <Text style={styles.articleBrand}>{article.brand.toUpperCase()}</Text>
            )}
            <Text style={styles.articleName}>{article.title}</Text>
            <Text style={styles.articlePrice}>{formatPrice(article.price)}</Text>
            {article.condition && (
              <Text style={styles.articleCondition}>{article.condition}</Text>
            )}
          </View>
        </View>

        {/* Delivery options */}
        <Text style={styles.sectionTitle}>MODE DE LIVRAISON</Text>

        {hasMeetup && (
          <Pressable
            style={[
              styles.deliveryOption,
              effectiveDelivery === 'meetup' && styles.deliveryOptionSelected,
            ]}
            onPress={() => setSelectedDelivery('meetup')}
          >
            <View
              style={[
                styles.radio,
                effectiveDelivery === 'meetup' && styles.radioSelected,
              ]}
            >
              {effectiveDelivery === 'meetup' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>Remise en main propre</Text>
              <Text style={styles.optionDesc}>
                Rencontrez le vendeur dans un lieu public à Montréal
              </Text>
              <Text style={styles.optionPriceFree}>Gratuit</Text>
            </View>
            <View style={[styles.optionIcon, styles.optionIconMeetup]}>
              <Ionicons name="location-outline" size={20} color={colors.sage} />
            </View>
          </Pressable>
        )}

        {hasShipping && (
          <Pressable
            style={[
              styles.deliveryOption,
              effectiveDelivery === 'shipping' && styles.deliveryOptionSelected,
            ]}
            onPress={() => setSelectedDelivery('shipping')}
          >
            <View
              style={[
                styles.radio,
                effectiveDelivery === 'shipping' && styles.radioSelected,
              ]}
            >
              {effectiveDelivery === 'shipping' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>Expédition postale</Text>
              <Text style={styles.optionDesc}>
                Livraison à votre adresse en 3-5 jours ouvrables
              </Text>
              <Text style={styles.optionPrice}>À partir de {formatPrice(8.50)}</Text>
            </View>
            <View style={[styles.optionIcon, styles.optionIconShipping]}>
              <Ionicons name="cube-outline" size={20} color={colors.rust} />
            </View>
          </Pressable>
        )}

        {/* Info box */}
        {effectiveDelivery === 'meetup' && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.sage} />
            <Text style={styles.infoText}>
              <Text style={styles.infoTextBold}>Paiement en main propre</Text>
              {'\n'}Le paiement se fait directement lors du meetup. Aucun frais de plateforme.
            </Text>
          </View>
        )}

        {effectiveDelivery === 'shipping' && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.sage} />
            <Text style={styles.infoText}>
              <Text style={styles.infoTextBold}>Paiement sécurisé</Text>
              {'\n'}Votre paiement est protégé. Le vendeur est payé après la livraison confirmée.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          variant="primary"
          fullWidth
          disabled={!effectiveDelivery}
          onPress={handleContinue}
          rightIcon={
            <Ionicons
              name="arrow-forward"
              size={16}
              color={effectiveDelivery ? colors.cream : colors.muted}
            />
          }
        >
          CONTINUER
        </Button>
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
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
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
  backButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.charcoal,
    borderRadius: radius.md,
  },
  backButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.cream,
    textTransform: 'uppercase',
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

  // Article summary
  articleSummary: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 14,
    marginBottom: 24,
  },
  articleImage: {
    width: 64,
    height: 80,
    backgroundColor: colors.border,
  },
  articleInfo: {
    flex: 1,
    gap: 4,
  },
  articleBrand: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: colors.muted,
  },
  articleName: {
    fontFamily: fonts.displayMedium,
    fontSize: 16,
    color: colors.charcoal,
  },
  articlePrice: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 20,
    color: colors.rust,
  },
  articleCondition: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
  },

  // Delivery options
  deliveryOption: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 18,
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  deliveryOptionSelected: {
    borderColor: colors.charcoal,
    borderWidth: 2,
    padding: 17,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
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
  optionContent: { flex: 1 },
  optionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
    marginBottom: 4,
  },
  optionDesc: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 16,
  },
  optionPriceFree: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 15,
    color: colors.sage,
    marginTop: 8,
  },
  optionPrice: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 15,
    color: colors.charcoal,
    marginTop: 8,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionIconMeetup: {
    backgroundColor: colors.sageLight,
  },
  optionIconShipping: {
    backgroundColor: colors.primaryLight,
  },

  // Info box
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 14,
    marginTop: 12,
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
  },
  infoTextBold: {
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
  },

  // Footer
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Skeleton
  skeletonContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  skeletonArticle: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 14,
    marginBottom: spacing.lg,
  },
  skeletonArticleInfo: {
    flex: 1,
  },
});
