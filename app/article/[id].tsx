/**
 * Article Detail Screen
 * Design System: Luxe Français + Street
 *
 * Features:
 * - Elegant image gallery with blur floating header
 * - Bleu Klein price accent
 * - Smooth animations with reanimated
 * - Haptic feedback on interactions
 * - Clean details grid with design tokens
 */

import { getCategoryLabelFromIds } from '@/data/categories-v2';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Design System
import { colors, spacing, typography, radius, shadows, animations } from '@/constants/theme';
import { Avatar, Button, H1, H2, Body, BodySmall, Caption, Price } from '@/components/ui';

// Components
import ImageGallery from '@/components/ImageGallery';
import MakeOfferModal, { MakeOfferModalRef } from '@/components/MakeOfferModal';
import ProductLocationMap from '@/components/ProductLocationMap';
import ReportBottomSheet, { ReportBottomSheetRef } from '@/components/ReportBottomSheet';
import SimilarProducts from '@/components/SimilarProducts';

// Hooks & Contexts
import { useAuth } from '@/contexts/AuthContext';
import { useFavorites } from '@/contexts/FavoritesContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';

// Services
import { ArticlesService } from '@/services/articlesService';
import { ChatService } from '@/services/chatService';

// Constants
import { AUTH_MESSAGES } from '@/constants/authMessages';

// Types
import { Article, MeetupSpot } from '@/types';

// =============================================================================
// CONSTANTS
// =============================================================================

const { width } = Dimensions.get('window');
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// =============================================================================
// FLOATING BUTTON COMPONENT
// =============================================================================

interface FloatingButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  isActive?: boolean;
  activeColor?: string;
}

const FloatingButton: React.FC<FloatingButtonProps> = ({
  icon,
  onPress,
  isActive = false,
  activeColor = colors.danger,
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.9, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={animatedStyle}
    >
      <BlurView intensity={80} tint="light" style={styles.floatingButton}>
        <Ionicons
          name={icon}
          size={24}
          color={isActive ? activeColor : colors.foreground}
        />
      </BlurView>
    </AnimatedPressable>
  );
};

// =============================================================================
// DETAIL ROW COMPONENT
// =============================================================================

interface DetailRowProps {
  label: string;
  value: string;
  delay?: number;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value, delay = 0 }) => (
  <Animated.View
    entering={FadeInDown.duration(300).delay(delay)}
    style={styles.detailRow}
  >
    <Caption style={styles.detailLabel}>{label}</Caption>
    <Body style={styles.detailValue}>{value}</Body>
  </Animated.View>
);

// =============================================================================
// LOADING STATE COMPONENT
// =============================================================================

const LoadingState: React.FC = () => (
  <SafeAreaView style={styles.container}>
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Caption style={styles.loadingText}>Chargement...</Caption>
    </View>
  </SafeAreaView>
);

// =============================================================================
// ERROR STATE COMPONENT
// =============================================================================

const ErrorState: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <SafeAreaView style={styles.container}>
    <Animated.View
      entering={FadeIn.duration(300)}
      style={styles.errorContainer}
    >
      <View style={styles.errorIconContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.muted} />
      </View>
      <H2 style={styles.errorTitle}>Article introuvable</H2>
      <Body color="muted" center style={styles.errorText}>
        Cet article n'existe plus ou a été supprimé
      </Body>
      <Button variant="primary" onPress={onBack} style={styles.errorButton}>
        Retour
      </Button>
    </Animated.View>
  </SafeAreaView>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ArticleDetailScreen() {
  const [article, setArticle] = useState<Article | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { toggleFavorite, isFavorite } = useFavorites();
  const { requireAuth } = useAuthRequired();
  const makeOfferModalRef = useRef<MakeOfferModalRef>(null);
  const reportBottomSheetRef = useRef<ReportBottomSheetRef>(null);
  const insets = useSafeAreaInsets();

  // ==========================================================================
  // EFFECTS
  // ==========================================================================

  useEffect(() => {
    if (id) {
      loadArticle(id);
    }
  }, [id]);

  // ==========================================================================
  // DATA LOADING
  // ==========================================================================

  const loadArticle = async (articleId: string) => {
    setIsLoading(true);
    try {
      const articleData = await ArticlesService.getArticleById(articleId);
      setArticle(articleData);
    } catch (error) {
      console.error('Error loading article:', error);
      Alert.alert('Erreur', 'Impossible de charger l\'article');
      router.back();
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================================================
  // HANDLERS
  // ==========================================================================

  const handleToggleFavorite = useCallback(() => {
    if (article) {
      Haptics.notificationAsync(
        isFavorite(article.id)
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success
      );
      requireAuth(
        () => toggleFavorite(article.id),
        AUTH_MESSAGES.like
      );
    }
  }, [article, isFavorite, requireAuth, toggleFavorite]);

  const handleContact = useCallback(async () => {
    if (!article || !user) {
      requireAuth(() => {}, AUTH_MESSAGES.message);
      return;
    }

    if (user.id === article.sellerId) {
      Alert.alert('Erreur', 'Vous ne pouvez pas vous contacter vous-même.');
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const chat = await ChatService.createOrGetChat(user.id, article.sellerId, article.id);
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      console.error('Error creating chat:', error);
      Alert.alert('Erreur', 'Impossible de créer la conversation');
    }
  }, [article, user, requireAuth, router]);

  const handleMakeOffer = useCallback(() => {
    if (!article) return;

    if (user && user.id === article.sellerId) {
      Alert.alert('Erreur', 'Vous ne pouvez pas faire une offre sur votre propre article.');
      return;
    }

    requireAuth(
      () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        makeOfferModalRef.current?.present();
      },
      AUTH_MESSAGES.buy
    );
  }, [article, user, requireAuth]);

  const handleMeetupOfferSubmit = useCallback(async (
    amount: number,
    message: string,
    meetupSpot: MeetupSpot
  ) => {
    if (!article || !user) return;

    if (user.id === article.sellerId) {
      throw new Error('Vous ne pouvez pas faire une offre sur votre propre article.');
    }

    try {
      const chat = await ChatService.createOrGetChat(user.id, article.sellerId, article.id);
      await ChatService.sendMeetupOffer(
        chat.id,
        user.id,
        article.sellerId,
        amount,
        meetupSpot,
        message
      );
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      console.error('Error submitting meetup offer:', error);
      throw error;
    }
  }, [article, user, router]);

  const handleViewProfile = useCallback(() => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Profil', 'Navigation vers le profil du vendeur à venir');
  }, [article]);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }, [router]);

  const handleDeleteArticle = useCallback(() => {
    if (!article) return;

    Alert.alert(
      'Supprimer l\'article',
      `Êtes-vous sûr de vouloir supprimer "${article.title}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await ArticlesService.deleteArticle(article.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.back();
            } catch (error) {
              console.error('Erreur suppression:', error);
              Alert.alert('Erreur', 'Impossible de supprimer l\'article');
            }
          },
        },
      ]
    );
  }, [article, router]);

  const handleEditArticle = useCallback(() => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/article/edit/${article.id}`);
  }, [article, router]);

  const handleMarkAsSold = useCallback(async () => {
    if (!article) return;

    try {
      await ArticlesService.updateArticle(article.id, { isSold: !article.isSold });
      setArticle((prev) => prev ? { ...prev, isSold: !prev.isSold } : null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Erreur mise à jour:', error);
      Alert.alert('Erreur', 'Impossible de mettre à jour l\'article');
    }
  }, [article]);

  const handleMoreOptions = useCallback(() => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const isOwner = user && user.id === article.sellerId;

    if (isOwner) {
      // Owner options: Modifier, Marquer vendu/En vente, Supprimer
      const soldOption = article.isSold ? 'Remettre en vente' : 'Marquer comme vendu';
      const options = ['Modifier', soldOption, 'Supprimer', 'Annuler'];
      const destructiveButtonIndex = 2;
      const cancelButtonIndex = 3;

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options,
            destructiveButtonIndex,
            cancelButtonIndex,
            title: article.title,
          },
          (buttonIndex) => {
            if (buttonIndex === 0) {
              handleEditArticle();
            } else if (buttonIndex === 1) {
              handleMarkAsSold();
            } else if (buttonIndex === 2) {
              handleDeleteArticle();
            }
          }
        );
      } else {
        Alert.alert(
          article.title,
          'Que souhaitez-vous faire ?',
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Modifier', onPress: handleEditArticle },
            { text: soldOption, onPress: handleMarkAsSold },
            { text: 'Supprimer', style: 'destructive', onPress: handleDeleteArticle },
          ]
        );
      }
    } else {
      // Non-owner options: Signaler
      const options = ['Signaler cet article', 'Annuler'];
      const destructiveButtonIndex = 0;
      const cancelButtonIndex = 1;

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options,
            destructiveButtonIndex,
            cancelButtonIndex,
          },
          (buttonIndex) => {
            if (buttonIndex === 0) {
              requireAuth(
                () => reportBottomSheetRef.current?.open('article', article.id, article.sellerId),
                'Connectez-vous pour signaler cet article'
              );
            }
          }
        );
      } else {
        Alert.alert(
          'Options',
          undefined,
          [
            {
              text: 'Signaler cet article',
              style: 'destructive',
              onPress: () => {
                requireAuth(
                  () => reportBottomSheetRef.current?.open('article', article.id, article.sellerId),
                  'Connectez-vous pour signaler cet article'
                );
              },
            },
            { text: 'Annuler', style: 'cancel' },
          ]
        );
      }
    }
  }, [article, user, requireAuth, handleEditArticle, handleMarkAsSold, handleDeleteArticle]);

  // ==========================================================================
  // FORMATTERS
  // ==========================================================================

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) return 'Aujourd\'hui';
    if (diffInDays === 1) return 'Hier';
    if (diffInDays < 7) return `Il y a ${diffInDays} jours`;
    if (diffInDays < 30) return `Il y a ${Math.floor(diffInDays / 7)} semaines`;
    return date.toLocaleDateString('fr-FR');
  };

  // ==========================================================================
  // RENDER STATES
  // ==========================================================================

  if (isLoading) {
    return <LoadingState />;
  }

  if (!article) {
    return <ErrorState onBack={handleBack} />;
  }

  const isOwnArticle = user && user.id === article.sellerId;

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <View style={styles.container}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Image Gallery */}
        <ImageGallery
          images={article.images}
          onImageIndexChange={setCurrentImageIndex}
        />

        {/* Price & Likes Section */}
        <Animated.View
          entering={FadeInDown.duration(300).delay(100)}
          style={styles.priceSection}
        >
          <Price style={styles.price}>{article.price} €</Price>
          <View style={styles.likesContainer}>
            <Ionicons name="heart" size={16} color={colors.danger} />
            <BodySmall style={styles.likesText}>{article.likes}</BodySmall>
          </View>
        </Animated.View>

        {/* Info Section */}
        <View style={styles.infoSection}>
          <Animated.View entering={FadeInDown.duration(300).delay(150)}>
            <H1 style={styles.title}>{article.title}</H1>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.duration(300).delay(200)}
            style={styles.metaInfo}
          >
            <Caption>
              {article.categoryIds && article.categoryIds.length > 0
                ? getCategoryLabelFromIds(article.categoryIds)
                : article.category}
            </Caption>
            <Caption style={styles.metaDivider}>•</Caption>
            <Caption>{formatDate(article.createdAt)}</Caption>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(300).delay(250)}>
            <Body style={styles.description}>{article.description}</Body>
          </Animated.View>

          {/* Meetup Badge */}
          {article.isHandDelivery && article.neighborhood && (
            <Animated.View
              entering={FadeInDown.duration(300).delay(300)}
              style={styles.meetupBadge}
            >
              <View style={styles.meetupIconContainer}>
                <Ionicons name="location" size={20} color={colors.success} />
              </View>
              <View style={styles.meetupBadgeContent}>
                <Body style={styles.meetupBadgeTitle}>Meetup disponible</Body>
                <Caption>
                  {article.neighborhood.name}, {article.neighborhood.borough}
                </Caption>
              </View>
            </Animated.View>
          )}

          {/* Details Grid */}
          <View style={styles.detailsGrid}>
            <DetailRow label="État" value={article.condition} delay={350} />
            {article.brand && (
              <DetailRow label="Marque" value={article.brand} delay={400} />
            )}
            {article.size && (
              <DetailRow label="Taille" value={article.size} delay={450} />
            )}
            {article.color && (
              <DetailRow label="Couleur" value={article.color} delay={500} />
            )}
            {article.material && (
              <DetailRow label="Matière" value={article.material} delay={550} />
            )}
          </View>
        </View>

        {/* Seller Section */}
        <View style={styles.sellerSection}>
          <Animated.View
            entering={FadeInDown.duration(300).delay(400)}
            style={styles.sellerHeader}
          >
            <Ionicons name="person-outline" size={20} color={colors.primary} />
            <H2 style={styles.sectionTitle}>Vendeur</H2>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.duration(300).delay(450)}
          >
            <Pressable style={styles.sellerCard} onPress={handleViewProfile}>
              <Avatar
                source={article.sellerImage}
                name={article.sellerName}
                size="lg"
              />
              <View style={styles.sellerDetails}>
                <Body style={styles.sellerName}>{article.sellerName}</Body>
                <View style={styles.sellerRating}>
                  <Ionicons name="star" size={14} color={colors.warning} />
                  <Caption style={styles.sellerRatingText}>4.8 (124 avis)</Caption>
                </View>
                {article.location && (
                  <View style={styles.sellerLocation}>
                    <Ionicons name="location-outline" size={14} color={colors.muted} />
                    <Caption>à 3,2 km</Caption>
                  </View>
                )}
              </View>
              <View style={styles.viewProfileButton}>
                <Ionicons name="chevron-forward" size={20} color={colors.primary} />
              </View>
            </Pressable>
          </Animated.View>
        </View>

        {/* Location Map */}
        <ProductLocationMap
          sellerLocation={
            article.location
              ? {
                  latitude: 48.8566,
                  longitude: 2.3522,
                  city: article.location,
                }
              : undefined
          }
          distance={3.2}
          showMap={true}
        />

        {/* Similar Products */}
        <SimilarProducts
          currentArticleId={article.id}
          category={article.category}
          maxResults={10}
        />

        {/* Security Footer */}
        <Animated.View
          entering={FadeInDown.duration(300).delay(500)}
          style={styles.securityFooter}
        >
          <Ionicons name="shield-checkmark" size={24} color={colors.success} />
          <Body style={styles.securityText}>
            Ne payez jamais en dehors de la plateforme
          </Body>
        </Animated.View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Floating Header */}
      <View style={[styles.floatingHeader, { top: insets.top }]}>
        <FloatingButton icon="chevron-back" onPress={handleBack} />
        <View style={styles.headerRight}>
          {article.location && (
            <BlurView intensity={80} tint="light" style={styles.distanceChip}>
              <Ionicons name="location" size={14} color={colors.primary} />
              <Caption style={styles.distanceText}>à 3,2 km</Caption>
            </BlurView>
          )}
          <FloatingButton
            icon={isFavorite(article.id) ? 'heart' : 'heart-outline'}
            onPress={handleToggleFavorite}
            isActive={isFavorite(article.id)}
            activeColor={colors.danger}
          />
          <FloatingButton
            icon="ellipsis-vertical"
            onPress={handleMoreOptions}
          />
        </View>
      </View>

      {/* Bottom Actions */}
      <SafeAreaView edges={['bottom']} style={styles.bottomSafeArea}>
        {isOwnArticle ? (
          <Animated.View
            entering={FadeIn.duration(300)}
            style={styles.ownArticleNotice}
          >
            <Ionicons name="information-circle-outline" size={20} color={colors.muted} />
            <Body color="muted">C'est votre article</Body>
          </Animated.View>
        ) : (
          <Animated.View
            entering={FadeInDown.duration(300).delay(200)}
            style={styles.actionButtons}
          >
            <Button
              variant="secondary"
              onPress={handleContact}
              style={styles.contactButton}
            >
              <View style={styles.buttonContent}>
                <Ionicons name="chatbubble-outline" size={18} color={colors.foreground} />
                <Body style={styles.contactButtonText}>Contacter</Body>
              </View>
            </Button>
            <Button
              variant="primary"
              onPress={handleMakeOffer}
              style={styles.offerButton}
            >
              <View style={styles.buttonContent}>
                <Ionicons name="cash-outline" size={18} color={colors.white} />
                <Body style={styles.offerButtonText}>Faire une offre</Body>
              </View>
            </Button>
          </Animated.View>
        )}
      </SafeAreaView>

      {/* Make Offer Modal */}
      <MakeOfferModal
        ref={makeOfferModalRef}
        articleId={article.id}
        articleTitle={article.title}
        currentPrice={article.price}
        sellerNeighborhood={article.neighborhood}
        sellerPreferredSpots={article.preferredMeetupSpots}
        onMeetupOfferSubmit={handleMeetupOfferSubmit}
      />

      {/* Report Bottom Sheet */}
      <ReportBottomSheet ref={reportBottomSheetRef} />
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
  content: {
    flex: 1,
  },

  // Floating Header
  floatingHeader: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    zIndex: 10,
  },
  floatingButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  distanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  distanceText: {
    color: colors.primary,
    fontWeight: '600',
  },

  // Price Section
  priceSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  price: {
    fontSize: 32,
    color: colors.primary, // Bleu Klein!
  },
  likesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: spacing.xs,
  },
  likesText: {
    color: colors.danger,
    fontWeight: '600',
  },

  // Info Section
  infoSection: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: spacing.sm,
    borderTopColor: colors.background,
  },
  title: {
    marginBottom: spacing.sm,
  },
  metaInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  metaDivider: {
    marginHorizontal: spacing.sm,
  },
  description: {
    lineHeight: 24,
    marginBottom: spacing.lg,
  },

  // Meetup Badge
  meetupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.success,
  },
  meetupIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  meetupBadgeContent: {
    flex: 1,
  },
  meetupBadgeTitle: {
    color: colors.success,
    fontWeight: '600',
  },

  // Details Grid
  detailsGrid: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: colors.muted,
  },
  detailValue: {
    fontWeight: '600',
  },

  // Seller Section
  sellerSection: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: spacing.sm,
    borderTopColor: colors.background,
  },
  sellerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
  },
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  sellerDetails: {
    flex: 1,
    marginLeft: spacing.md,
  },
  sellerName: {
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  sellerRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  sellerRatingText: {
    color: colors.foreground,
  },
  sellerLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  viewProfileButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.card,
  },

  // Security Footer
  securityFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.successLight,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    gap: spacing.md,
  },
  securityText: {
    color: colors.success,
    fontWeight: '600',
  },

  // Bottom Actions
  bottomSafeArea: {
    backgroundColor: colors.surface,
  },
  actionButtons: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  contactButton: {
    flex: 1,
  },
  contactButtonText: {
    fontWeight: '600',
  },
  offerButton: {
    flex: 1,
  },
  offerButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  ownArticleNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },

  // Loading State
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: colors.muted,
  },

  // Error State
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  errorTitle: {
    marginBottom: spacing.sm,
  },
  errorText: {
    marginBottom: spacing.lg,
  },
  errorButton: {
    minWidth: 150,
  },

  // Bottom Padding
  bottomPadding: {
    height: 100,
  },
});
