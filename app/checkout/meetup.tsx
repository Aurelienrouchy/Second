/**
 * Checkout — Meetup Spot Selection
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Select a meetup location from seller's preferred spots OR choose
 * "A convenir par messagerie" to skip spot selection.
 *
 * Sends a structured meetup OFFER in the chat (renders an interactive
 * OfferBubble) and navigates to success. The transaction is NOT created here
 * — it is born server-side when the OTHER party accepts the offer via
 * `acceptMeetupOffer`. Pre-creating it locked the article (isSold) and made
 * the offer un-acceptable ("Cet article a déjà été vendu") — a systematic
 * 48h dead-end (audit F8).
 */

import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { doc, getDoc } from 'firebase/firestore';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import { ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { firestore, auth } from '@/config/firebaseConfig';
import { Article, MeetupSpot, MeetupSpotCategoryLabels } from '@/types';
import { ChatService } from '@/services/chatService';
import { ModerationService } from '@/services/moderationService';
import { homeKeys } from '@/features/home/query-keys';

// Special sentinel for "to be decided via chat"
const VIA_CHAT_OPTION = '__via_chat__';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function MeetupCheckoutScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { articleId, chatId: chatIdParam, negotiatedPrice } = useLocalSearchParams<{
    articleId: string;
    chatId?: string;
    negotiatedPrice?: string;
  }>();

  const currentUser = auth.currentUser;

  // H5 — Auth guard: redirect unauthenticated users
  useEffect(() => {
    if (!currentUser) {
      router.replace('/(tabs)');
    }
  }, [currentUser, router]);

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // selectedOption: either a MeetupSpot or VIA_CHAT_OPTION string
  const [selectedOption, setSelectedOption] = useState<MeetupSpot | string | null>(null);

  // C1 — Use negotiated price from accepted offer if provided
  const finalPrice = negotiatedPrice && !isNaN(parseFloat(negotiatedPrice))
    ? parseFloat(negotiatedPrice)
    : article?.price ?? 0;
  const hasNegotiatedPrice = negotiatedPrice != null
    && !isNaN(parseFloat(negotiatedPrice))
    && article != null
    && parseFloat(negotiatedPrice) !== article.price;

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
          const art = { id: articleDoc.id, ...data } as Article;
          setArticle(art);

          // Auto-select first preferred spot if available, otherwise "via chat"
          if (art.preferredMeetupSpots && art.preferredMeetupSpots.length > 0) {
            setSelectedOption(art.preferredMeetupSpots[0]);
          } else {
            setSelectedOption(VIA_CHAT_OPTION);
          }
        }
      } catch (error) {
        if (__DEV__) console.error('Error loading article:', error);
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

  const isSpotSelected = selectedOption !== null && selectedOption !== VIA_CHAT_OPTION;
  const selectedSpot = isSpotSelected ? (selectedOption as MeetupSpot) : null;
  const isViaChatSelected = selectedOption === VIA_CHAT_OPTION;

  const handleConfirm = async () => {
    if (!article || !selectedOption || submitting || !currentUser) return;

    try {
      setSubmitting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Check if users are blocked before proceeding
      const blocked = await ModerationService.areUsersBlocked(currentUser.uid, article.sellerId);
      if (blocked) {
        Alert.alert('Action impossible', 'Vous ne pouvez pas acheter cet article.');
        return;
      }

      // Create or get chat
      const chat = await ChatService.createOrGetChat(
        currentUser.uid,
        article.sellerId,
        article.id,
      );

      // Send the structured meetup OFFER in the chat only — no transaction is
      // created here (audit F8). It is created server-side by
      // `acceptMeetupOffer` when the seller accepts, which also locks the
      // article atomically. Pre-locking it here made the offer un-acceptable.
      const meetupLocation: MeetupSpot = selectedSpot ?? {
        name: 'A convenir',
        category: 'other_public',
        neighborhood: { id: 'tbd', name: 'A convenir', borough: 'A convenir' },
      };
      await ChatService.sendMeetupOffer(
        chat.id,
        currentUser.uid,
        article.sellerId,
        finalPrice,
        meetupLocation,
        `Demande de meetup pour "${article.title}"`,
      );

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Refresh home so the chat surfaces (the article stays available until
      // the seller accepts the offer — it is only marked sold on acceptance).
      queryClient.invalidateQueries({ queryKey: homeKeys.all });

      // Navigate to success (offer-sent confirmation — no transaction yet).
      router.replace({
        pathname: '/checkout/success' as any,
        params: {
          deliveryType: 'meetup',
          articleTitle: article.title,
          amount: String(finalPrice),
          spotName: selectedSpot?.name || 'A convenir',
          chatId: chat.id,
        },
      });
    } catch (error: any) {
      if (__DEV__) console.error('Error creating meetup transaction:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      // Cloud Function errors arrive as FirebaseError with a readable
      // message (e.g. "Cet article a deja ete vendu"). Surface it
      // directly so the buyer understands why the purchase failed.
      const msg = error?.message || 'Impossible de confirmer le meetup.';
      Alert.alert('Article indisponible', msg, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } finally {
      setSubmitting(false);
    }
  };

  // =============================================================================
  // RENDER
  // =============================================================================

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Lieu de rencontre" onBack={handleBack} />
        <View style={styles.skeletonContent}>
          {/* Article summary skeleton */}
          <View style={styles.articleSummary}>
            <Skeleton width={64} height={80} borderRadius={radius.none} />
            <View style={styles.articleInfo}>
              <Skeleton width={60} height={9} borderRadius={radius.xs} />
              <Skeleton
                width="70%"
                height={16}
                borderRadius={radius.xs}
                style={{ marginTop: spacing.xs }}
              />
              <Skeleton
                width={80}
                height={20}
                borderRadius={radius.xs}
                style={{ marginTop: spacing.xs }}
              />
              <Skeleton
                width={56}
                height={18}
                borderRadius={radius.xs}
                style={{ marginTop: spacing.xs }}
              />
            </View>
          </View>

          {/* Section title skeleton */}
          <Skeleton
            width={200}
            height={9}
            borderRadius={radius.xs}
            style={{ marginBottom: spacing.md }}
          />

          {/* Meetup spot cards skeleton */}
          {Array.from({ length: 2 }).map((_, i) => (
            <View key={`meetup-skeleton-${i}`} style={styles.skeletonSpotCard}>
              <Skeleton width={36} height={36} borderRadius={18} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Skeleton width="60%" height={13} borderRadius={radius.xs} />
                <Skeleton width="80%" height={11} borderRadius={radius.xs} />
              </View>
              <Skeleton width={20} height={20} borderRadius={10} />
            </View>
          ))}

          {/* CTA button skeleton */}
          <Skeleton
            width="100%"
            height={48}
            borderRadius={radius.md}
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </View>
    );
  }

  if (!article) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Lieu de rencontre" onBack={handleBack} />
        <View style={styles.guardContainer}>
          <Text style={styles.errorText}>Article introuvable</Text>
          <Pressable style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backBtnText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (article.isSold) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Lieu de rencontre" onBack={handleBack} />
        <View style={styles.guardContainer}>
          <Ionicons name="bag-check-outline" size={40} color={colors.muted} />
          <Text style={styles.guardTitle}>Cet article n'est plus disponible</Text>
          <Text style={styles.guardSubtitle}>Il a déjà été vendu.</Text>
          <Pressable style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backBtnText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (currentUser && currentUser.uid === article.sellerId) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Lieu de rencontre" onBack={handleBack} />
        <View style={styles.guardContainer}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.muted} />
          <Text style={styles.guardTitle}>Vous ne pouvez pas acheter votre propre article</Text>
          <Pressable style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backBtnText}>Retour</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const spots = article.preferredMeetupSpots || [];

  return (
    <View style={styles.container} testID="checkout-meetup-screen">
      <ScreenHeader title="Lieu de rencontre" onBack={handleBack} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Article summary with badge */}
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
            {hasNegotiatedPrice ? (
              <View style={styles.priceRow}>
                <Text style={styles.articlePrice}>{formatPrice(finalPrice)}</Text>
                <Text style={styles.originalPrice}>{formatPrice(article.price)}</Text>
              </View>
            ) : (
              <Text style={styles.articlePrice}>{formatPrice(finalPrice)}</Text>
            )}
            {hasNegotiatedPrice && (
              <View style={styles.negotiatedBadge}>
                <Text style={styles.negotiatedBadgeText}>PRIX NÉGOCIÉ</Text>
              </View>
            )}
            <View style={styles.meetupBadge}>
              <Text style={styles.meetupBadgeText}>MEETUP</Text>
            </View>
          </View>
        </View>

        {/* Seller's preferred spots */}
        {spots.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>LIEUX SUGGÉRÉS PAR LE VENDEUR</Text>

            {spots.map((spot, index) => {
              const isSelected = selectedSpot?.name === spot.name
                && selectedSpot?.neighborhood?.id === spot.neighborhood?.id;
              return (
                <Pressable
                  key={`spot-${index}`}
                  style={[styles.spotCard, isSelected && styles.spotCardSelected]}
                  onPress={() => setSelectedOption(spot)}
                >
                  <View style={styles.spotIcon}>
                    <Ionicons name="location-outline" size={16} color={colors.sage} />
                  </View>
                  <View style={styles.spotInfo}>
                    <Text style={styles.spotName}>{spot.name}</Text>
                    <Text style={styles.spotDetails}>
                      {spot.category ? MeetupSpotCategoryLabels[spot.category] : ''} · {spot.neighborhood?.name}
                    </Text>
                  </View>
                  <View style={[styles.radio, isSelected && styles.radioSelected]}>
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {/* "Via chat" option — always visible */}
        <Text style={[styles.sectionTitle, spots.length > 0 && { marginTop: 16 }]}>
          {spots.length > 0 ? 'OU BIEN' : 'LIEU DE RENCONTRE'}
        </Text>

        <Pressable
          testID="checkout-meetup-messaging-option"
          style={[styles.spotCard, isViaChatSelected && styles.spotCardSelected]}
          onPress={() => setSelectedOption(VIA_CHAT_OPTION)}
        >
          <View style={[styles.spotIcon, styles.spotIconChat]}>
            <Ionicons name="chatbubble-outline" size={16} color={colors.rust} />
          </View>
          <View style={styles.spotInfo}>
            <Text style={styles.spotName}>À convenir par messagerie</Text>
            <Text style={styles.spotDetails}>
              Vous choisirez le lieu avec le vendeur après confirmation
            </Text>
          </View>
          <View style={[styles.radio, isViaChatSelected && styles.radioSelected]}>
            {isViaChatSelected && <View style={styles.radioInner} />}
          </View>
        </Pressable>

        {/* Info box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.sage} />
          <Text style={styles.infoText}>
            {isViaChatSelected
              ? 'Vous conviendrez du lieu, de la date et de l\'heure avec le vendeur par messagerie.'
              : 'Vous conviendrez de la date et de l\'heure avec le vendeur par messagerie après la confirmation.'}
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          testID="checkout-meetup-confirm"
          style={[
            styles.ctaButton,
            submitting && styles.ctaButtonDisabled,
          ]}
          onPress={handleConfirm}
          disabled={!selectedOption || submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <Text style={styles.ctaButtonText}>CONFIRMER LE MEETUP</Text>
          )}
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
  skeletonContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  skeletonSpotCard: {
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
    marginBottom: 20,
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
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  originalPrice: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  negotiatedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
  },
  negotiatedBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.rust,
    textTransform: 'uppercase',
  },
  meetupBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
    marginTop: 2,
  },
  meetupBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.sage,
    textTransform: 'uppercase',
  },

  // Meetup spots
  spotCard: {
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
  spotCardSelected: {
    borderColor: colors.charcoal,
    borderWidth: 2,
    padding: 13,
  },
  spotIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.sageLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spotIconChat: {
    backgroundColor: colors.primaryLight,
  },
  spotInfo: { flex: 1 },
  spotName: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
    marginBottom: 2,
  },
  spotDetails: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
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

  // Info box
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 14,
    marginTop: 16,
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
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
