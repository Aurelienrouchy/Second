/**
 * Checkout — Delivery Type Selection
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Shows article summary + delivery options:
 * - Meetup (free, in-person)
 * - Shipping (paid, Intelcom)
 * Navigates to /checkout/meetup or /checkout/shipping
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { doc, getDoc } from 'firebase/firestore';

import { colors, fonts, spacing, radius } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { firestore } from '@/config/firebaseConfig';
import { Article, TransactionDeliveryType } from '@/types';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function CheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const articleId = params.articleId as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDelivery, setSelectedDelivery] = useState<TransactionDeliveryType | null>(null);

  // =============================================================================
  // LOAD ARTICLE
  // =============================================================================

  useEffect(() => {
    async function loadArticle() {
      try {
        const articleRef = doc(firestore, 'articles', articleId);
        const articleDoc = await getDoc(articleRef);
        if (articleDoc.exists()) {
          const data = articleDoc.data();
          setArticle({ id: articleDoc.id, ...data } as Article);

          // Auto-select if only one delivery option
          const hasMeetup = data.isHandDelivery !== false;
          const hasShipping = data.isShipping === true;

          if (hasMeetup && !hasShipping) {
            setSelectedDelivery('meetup');
          } else if (!hasMeetup && hasShipping) {
            setSelectedDelivery('shipping');
          }
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
  // HANDLERS
  // =============================================================================

  const handleBack = () => router.back();

  const handleContinue = () => {
    if (!selectedDelivery || !article) return;

    if (selectedDelivery === 'meetup') {
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
            <Text style={styles.articlePrice}>{article.price}$</Text>
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
              selectedDelivery === 'meetup' && styles.deliveryOptionSelected,
            ]}
            onPress={() => setSelectedDelivery('meetup')}
          >
            <View
              style={[
                styles.radio,
                selectedDelivery === 'meetup' && styles.radioSelected,
              ]}
            >
              {selectedDelivery === 'meetup' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>Remise en main propre</Text>
              <Text style={styles.optionDesc}>
                Rencontrez le vendeur dans un lieu public a Montreal
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
              selectedDelivery === 'shipping' && styles.deliveryOptionSelected,
            ]}
            onPress={() => setSelectedDelivery('shipping')}
          >
            <View
              style={[
                styles.radio,
                selectedDelivery === 'shipping' && styles.radioSelected,
              ]}
            >
              {selectedDelivery === 'shipping' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>Expedition postale</Text>
              <Text style={styles.optionDesc}>
                Livraison a votre adresse en 3-5 jours ouvrables
              </Text>
              <Text style={styles.optionPrice}>A partir de 8.50$</Text>
            </View>
            <View style={[styles.optionIcon, styles.optionIconShipping]}>
              <Ionicons name="cube-outline" size={20} color={colors.rust} />
            </View>
          </Pressable>
        )}

        {/* Info box */}
        {selectedDelivery === 'meetup' && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.sage} />
            <Text style={styles.infoText}>
              <Text style={styles.infoTextBold}>Paiement en main propre</Text>
              {'\n'}Le paiement se fait directement lors du meetup. Aucun frais de plateforme.
            </Text>
          </View>
        )}

        {selectedDelivery === 'shipping' && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.sage} />
            <Text style={styles.infoText}>
              <Text style={styles.infoTextBold}>Paiement securise</Text>
              {'\n'}Votre paiement est protege. Le vendeur est paye apres la livraison confirmee.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[
            styles.ctaButton,
            !selectedDelivery && styles.ctaButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!selectedDelivery}
        >
          <Ionicons
            name="arrow-forward"
            size={16}
            color={selectedDelivery ? colors.cream : colors.muted}
          />
          <Text
            style={[
              styles.ctaButtonText,
              !selectedDelivery && styles.ctaButtonTextDisabled,
            ]}
          >
            CONTINUER
          </Text>
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
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    paddingVertical: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  ctaButtonDisabled: {
    backgroundColor: colors.border,
  },
  ctaButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  ctaButtonTextDisabled: {
    color: colors.muted,
  },
});
