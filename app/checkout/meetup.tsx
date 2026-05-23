/**
 * Checkout — Meetup Spot Selection
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Select a meetup location from seller's preferred spots OR choose
 * "A convenir par messagerie" to skip spot selection.
 * Creates a meetup_pending transaction + chat, then navigates to success.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { doc, getDoc } from 'firebase/firestore';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import { ScreenHeader } from '@/components/ui';
import { firestore, auth } from '@/config/firebaseConfig';
import { Article, MeetupSpot, MeetupSpotCategoryLabels } from '@/types';
import { TransactionService } from '@/services/transactionService';
import { ChatService } from '@/services/chatService';

// Special sentinel for "to be decided via chat"
const VIA_CHAT_OPTION = '__via_chat__';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function MeetupCheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const articleId = params.articleId as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // selectedOption: either a MeetupSpot or VIA_CHAT_OPTION string
  const [selectedOption, setSelectedOption] = useState<MeetupSpot | string | null>(null);

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

  const isSpotSelected = selectedOption !== null && selectedOption !== VIA_CHAT_OPTION;
  const selectedSpot = isSpotSelected ? (selectedOption as MeetupSpot) : null;
  const isViaChatSelected = selectedOption === VIA_CHAT_OPTION;

  const handleConfirm = async () => {
    if (!article || !selectedOption || submitting) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert('Erreur', 'Vous devez etre connecte pour acheter.');
      return;
    }

    try {
      setSubmitting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Create or get chat
      const chat = await ChatService.createOrGetChat(
        currentUser.uid,
        article.sellerId,
        article.id,
      );

      // Create meetup transaction (with or without spot)
      const transactionId = await TransactionService.createMeetupTransaction(
        article.id,
        currentUser.uid,
        article.sellerId,
        article.price,
        selectedSpot, // null if "via chat" option
        chat.id,
      );

      // Send message in chat
      const spotLabel = selectedSpot
        ? `a ${selectedSpot.name}`
        : '(lieu a convenir)';
      await ChatService.sendMessage(
        chat.id,
        currentUser.uid,
        article.sellerId,
        `Demande de meetup pour "${article.title}" ${spotLabel} (${formatPrice(article.price)})`,
      );

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate to success
      router.replace({
        pathname: '/checkout/success' as any,
        params: {
          transactionId,
          deliveryType: 'meetup',
          articleTitle: article.title,
          amount: String(article.price),
          spotName: selectedSpot?.name || 'A convenir',
          chatId: chat.id,
        },
      });
    } catch (error: any) {
      console.error('Error creating meetup transaction:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', error.message || 'Impossible de confirmer le meetup.');
    } finally {
      setSubmitting(false);
    }
  };

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

  const spots = article.preferredMeetupSpots || [];

  return (
    <View style={styles.container}>
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
            <Text style={styles.articlePrice}>{formatPrice(article.price)}</Text>
            <View style={styles.meetupBadge}>
              <Text style={styles.meetupBadgeText}>MEETUP</Text>
            </View>
          </View>
        </View>

        {/* Seller's preferred spots */}
        {spots.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>LIEUX SUGGERES PAR LE VENDEUR</Text>

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
          style={[styles.spotCard, isViaChatSelected && styles.spotCardSelected]}
          onPress={() => setSelectedOption(VIA_CHAT_OPTION)}
        >
          <View style={[styles.spotIcon, styles.spotIconChat]}>
            <Ionicons name="chatbubble-outline" size={16} color={colors.rust} />
          </View>
          <View style={styles.spotInfo}>
            <Text style={styles.spotName}>A convenir par messagerie</Text>
            <Text style={styles.spotDetails}>
              Vous choisirez le lieu avec le vendeur apres confirmation
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
              : 'Vous conviendrez de la date et de l\'heure avec le vendeur par messagerie apres la confirmation.'}
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
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
