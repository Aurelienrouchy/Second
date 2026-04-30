/**
 * Article Detail Screen — Proposal A: "Editorial Scroll"
 *
 * Layout: Hero image → Brand+Cat → Title → Price → Engagement → Tags →
 *         Description → Delivery → Meetup Spots → Seller → CTA
 *
 * Features:
 * - Full-bleed hero image 460px with animated dots
 * - Sticky header (back, like, share) with blur + scroll-based transitions
 * - FadeInDown entry animations for the entire info block
 * - Fullscreen image viewer via ImageGallery
 * - Share functionality via React Native Share API
 * - Discount badge computed from price + originalPrice
 */

import { getCategoryLabelFromIds } from '@/data/categories-v2';
import { formatDisplayName } from '@/utils/formatName';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
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
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Design System
import { Avatar } from '@/components/ui';
import { animations, colors, fonts, radius, spacing } from '@/constants/theme';

// Components
import ImageGallery from '@/components/ImageGallery';
import MakeOfferModal, { MakeOfferModalRef } from '@/components/MakeOfferModal';
import ReportBottomSheet, { ReportBottomSheetRef } from '@/components/ReportBottomSheet';
import SimilarProducts from '@/components/SimilarProducts';

// Hooks & Contexts
import { useAuth } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useFavorites } from '@/hooks/useFavorites';

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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_WIDTH * 1.2; // Match ImageGallery aspect ratio
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

// =============================================================================
// HEADER BUTTON COMPONENT — Frosted glass circle
// =============================================================================

interface HeaderButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  isActive?: boolean;
  activeColor?: string;
  size?: number;
}

const HeaderButton: React.FC<HeaderButtonProps> = ({
  icon,
  onPress,
  isActive = false,
  activeColor = colors.primary,
  size = 20,
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
      <BlurView intensity={60} tint="dark" style={styles.headerButton}>
        <Ionicons
          name={icon}
          size={size}
          color={isActive ? activeColor : '#FFFFFF'}
        />
      </BlurView>
    </AnimatedPressable>
  );
};

// =============================================================================
// LOADING STATE
// =============================================================================

const LoadingState: React.FC = () => (
  <SafeAreaView style={styles.container}>
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>Chargement...</Text>
    </View>
  </SafeAreaView>
);

// =============================================================================
// ERROR STATE
// =============================================================================

const ErrorState: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <SafeAreaView style={styles.container}>
    <Animated.View entering={FadeIn.duration(300)} style={styles.errorContainer}>
      <View style={styles.errorIconCircle}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.muted} />
      </View>
      <Text style={styles.errorTitle}>Article introuvable</Text>
      <Text style={styles.errorText}>
        Cet article n'existe plus ou a été supprimé
      </Text>
      <Pressable style={styles.errorButton} onPress={onBack}>
        <Text style={styles.errorButtonText}>Retour</Text>
      </Pressable>
    </Animated.View>
  </SafeAreaView>
);

// =============================================================================
// HELPERS
// =============================================================================

/** Build tags from real Article fields: size, condition, color, material, pattern */
const buildTags = (article: Article) => {
  const tags: string[] = [];
  if (article.size) tags.push(`Taille ${article.size}`);
  if (article.condition) tags.push(article.condition);
  if (article.color) tags.push(article.color);
  if (article.material) tags.push(article.material);
  if (article.pattern) tags.push(article.pattern);
  return tags;
};

/** Compute discount percentage from price + originalPrice */
const getDiscountPercent = (price: number, originalPrice?: number) => {
  if (!originalPrice || originalPrice <= price) return null;
  return Math.round((1 - price / originalPrice) * 100);
};

/** Emoji for meetup spot category */
const spotEmoji = (category: string) => {
  switch (category) {
    case 'cafe': return '☕';
    case 'metro': return '🚇';
    case 'park': return '🌳';
    case 'library': return '📚';
    default: return '📍';
  }
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ArticleDetailScreen() {
  const [article, setArticle] = useState<Article | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const { id, partyId, swapItemId } = useLocalSearchParams<{ id: string; partyId?: string; swapItemId?: string }>();
  const isSwapContext = !!partyId;
  const router = useRouter();
  const { user } = useAuth();
  const { toggleFavorite, isFavorite } = useFavorites();
  const { requireAuth } = useAuthRequired();
  const makeOfferModalRef = useRef<MakeOfferModalRef>(null);
  const reportBottomSheetRef = useRef<ReportBottomSheetRef>(null);
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);

  // Scroll handler for sticky header background transition
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // Header background: transparent over hero, cream when scrolled past
  const headerAnimatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, HERO_HEIGHT - 100], [0, 1], 'clamp');
    return { backgroundColor: `rgba(245, 240, 232, ${opacity})` };
  });

  // Header icon color transition: white over hero → charcoal when scrolled
  const headerIconOpacity = useAnimatedStyle(() => {
    const scrolledPast = interpolate(scrollY.value, [0, HERO_HEIGHT - 100], [0, 1], 'clamp');
    return { opacity: scrolledPast };
  });

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

  const handleShare = useCallback(async () => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        title: article.title,
        message: `Regarde cet article sur Seconde : ${article.title} — ${article.price} $\nhttps://seconde.app/article/${article.id}`,
        url: `https://seconde.app/article/${article.id}`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  }, [article]);

  const handleBuy = useCallback(() => {
    if (!article) return;

    if (user && user.id === article.sellerId) {
      Alert.alert('Erreur', 'Vous ne pouvez pas acheter votre propre article.');
      return;
    }

    requireAuth(
      () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        router.push({
          pathname: '/checkout' as any,
          params: { articleId: article.id },
        });
      },
      AUTH_MESSAGES.buy
    );
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

  const handleProposeSwap = useCallback(() => {
    if (!article || !user || !partyId) return;

    requireAuth(
      () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        router.push({
          pathname: '/propose-swap',
          params: {
            partyId,
            targetItemId: swapItemId || '',
            targetArticleId: article.id,
            receiverId: article.sellerId,
            receiverName: article.sellerName || '',
            receiverImage: article.sellerImage || '',
          },
        });
      },
      AUTH_MESSAGES.swapParty
    );
  }, [article, user, partyId, swapItemId, requireAuth, router]);

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
            if (buttonIndex === 0) handleEditArticle();
            else if (buttonIndex === 1) handleMarkAsSold();
            else if (buttonIndex === 2) handleDeleteArticle();
          }
        );
      } else {
        Alert.alert(article.title, 'Que souhaitez-vous faire ?', [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Modifier', onPress: handleEditArticle },
          { text: soldOption, onPress: handleMarkAsSold },
          { text: 'Supprimer', style: 'destructive', onPress: handleDeleteArticle },
        ]);
      }
    } else {
      const options = ['Signaler cet article', 'Annuler'];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, destructiveButtonIndex: 0, cancelButtonIndex: 1 },
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
        Alert.alert('Options', undefined, [
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
        ]);
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
    if (diffInDays < 7) return `Il y a ${diffInDays}j`;
    if (diffInDays < 30) return `Il y a ${Math.floor(diffInDays / 7)} sem.`;
    return date.toLocaleDateString('fr-FR');
  };

  // ==========================================================================
  // RENDER STATES
  // ==========================================================================

  if (isLoading) return <LoadingState />;
  if (!article) return <ErrorState onBack={handleBack} />;

  const isOwnArticle = user && user.id === article.sellerId;
  const categoryLabel = article.categoryIds?.length
    ? getCategoryLabelFromIds(article.categoryIds)
    : article.category;

  const tags = buildTags(article);
  const discount = getDiscountPercent(article.price, (article as any).originalPrice);
  const sellerRating = (article as any).sellerRating;
  const deliveryOptions = (article as any).deliveryOptions;
  const shippingCost = deliveryOptions?.shippingCost;

  // ==========================================================================
  // RENDER — Proposal A: Editorial Scroll
  // ==========================================================================

  return (
    <View style={styles.container}>
      <AnimatedScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* ── Hero Image Gallery ── */}
        <ImageGallery
          images={article.images}
          onImageIndexChange={setCurrentImageIndex}
        />

        {/* Discount badge — overlaid on bottom-right of hero */}
        {discount && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>–{discount}%</Text>
          </View>
        )}

        {/* ══════════════════════════════════════════════════
            INFO BLOCK — all animated with FadeInDown stagger
            ══════════════════════════════════════════════════ */}

        <View style={styles.infoBlock}>
          {/* Brand + Category */}
          <Animated.View entering={FadeInDown.duration(350).delay(80)}>
            <Text style={styles.brandCategory}>
              {article.brand ? `${article.brand} · ` : ''}{categoryLabel}
            </Text>
          </Animated.View>

          {/* Title — Cormorant Garamond */}
          <Animated.View entering={FadeInDown.duration(350).delay(120)}>
            <Text style={styles.title}>{article.title}</Text>
          </Animated.View>

          {/* Price row: current + original strikethrough */}
          <Animated.View entering={FadeInDown.duration(350).delay(160)} style={styles.priceRow}>
            <Text style={styles.price}>${article.price}</Text>
            {(article as any).originalPrice && (
              <Text style={styles.originalPrice}>${(article as any).originalPrice}</Text>
            )}
          </Animated.View>

          {/* Engagement: likes · views · date */}
          <Animated.View entering={FadeInDown.duration(350).delay(200)} style={styles.engagementRow}>
            <View style={styles.engagementItem}>
              <Ionicons name="heart-outline" size={13} color={colors.muted} />
              <Text style={styles.engagementText}>{article.likes}</Text>
            </View>
            <View style={styles.engagementItem}>
              <Ionicons name="eye-outline" size={13} color={colors.muted} />
              <Text style={styles.engagementText}>{article.views} vues</Text>
            </View>
            <Text style={styles.engagementDate}>
              Publié {formatDate(article.createdAt)}
            </Text>
          </Animated.View>

          {/* Tags — from size, condition, color, material, pattern */}
          <Animated.View entering={FadeInDown.duration(350).delay(240)} style={styles.tagsRow}>
            {tags.map((tag, i) => (
              <View key={i} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
            {/* packageSize badge (sage) */}
            {article.packageSize && (
              <View style={styles.packageTag}>
                <Text style={styles.packageTagText}>Colis {article.packageSize}</Text>
              </View>
            )}
          </Animated.View>

          {/* Description */}
          {article.description ? (
            <Animated.View entering={FadeInDown.duration(350).delay(280)}>
              <Text style={styles.description}>{article.description}</Text>
            </Animated.View>
          ) : null}

          {/* Delivery options cards */}
          {(article.isShipping || article.isHandDelivery) && (
            <Animated.View entering={FadeInDown.duration(350).delay(320)} style={styles.deliveryRow}>
              {article.isShipping && (
                <View style={styles.deliveryCardShipping}>
                  <Ionicons name="cube-outline" size={16} color={colors.sage} />
                  <View style={styles.deliveryCardContent}>
                    <Text style={styles.deliveryCardTitle}>Livraison</Text>
                    <Text style={styles.deliveryCardSub}>
                      {shippingCost ? `$${shippingCost.toFixed(2)}` : 'Gratuit'}
                    </Text>
                  </View>
                </View>
              )}
              {article.isHandDelivery && (
                <View style={styles.deliveryCardPickup}>
                  <Ionicons name="location-outline" size={16} color={colors.primary} />
                  <View style={styles.deliveryCardContent}>
                    <Text style={styles.deliveryCardTitle}>En personne</Text>
                    <Text style={styles.deliveryCardSub}>
                      {article.neighborhood?.name || 'À convenir'}
                    </Text>
                  </View>
                </View>
              )}
            </Animated.View>
          )}

          {/* Preferred meetup spots */}
          {article.preferredMeetupSpots && article.preferredMeetupSpots.length > 0 && (
            <Animated.View entering={FadeInDown.duration(350).delay(360)}>
              <Text style={styles.sectionLabel}>Lieux de rencontre suggérés</Text>
              <View style={styles.spotsRow}>
                {article.preferredMeetupSpots.map((spot, i) => (
                  <View key={i} style={styles.spotChip}>
                    <Text style={styles.spotEmoji}>{spotEmoji(spot.category)}</Text>
                    <Text style={styles.spotName}>{spot.name}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Seller card */}
          <Animated.View entering={FadeInDown.duration(350).delay(400)}>
            <Pressable style={styles.sellerCard} onPress={handleViewProfile}>
              <Avatar
                source={article.sellerImage}
                name={article.sellerName}
                size="md"
              />
              <View style={styles.sellerInfo}>
                <Text style={styles.sellerName}>{formatDisplayName(article.sellerName)}</Text>
                <Text style={styles.sellerMeta}>
                  {article.neighborhood?.name}
                  {article.neighborhood?.borough ? ` · ${article.neighborhood.borough}` : ''}
                </Text>
              </View>
              {sellerRating && (
                <View style={styles.sellerRatingContainer}>
                  <Ionicons name="star" size={13} color={colors.primary} />
                  <Text style={styles.sellerRatingText}>{sellerRating}</Text>
                </View>
              )}
            </Pressable>
          </Animated.View>

          {/* Similar Products */}
          <SimilarProducts
            currentArticleId={article.id}
            category={article.category}
            maxResults={10}
          />
        </View>

        {/* Bottom spacer for CTA bar */}
        <View style={{ height: 110 }} />
      </AnimatedScrollView>

      {/* ── Sticky Floating Header ── */}
      <Animated.View style={[styles.floatingHeader, headerAnimatedStyle, { paddingTop: insets.top }]}>
        <HeaderButton icon="chevron-back" onPress={handleBack} />
        <View style={styles.headerActions}>
          <HeaderButton
            icon={isFavorite(article.id) ? 'heart' : 'heart-outline'}
            onPress={handleToggleFavorite}
            isActive={isFavorite(article.id)}
            activeColor="#FFFFFF"
          />
          <HeaderButton icon="share-outline" onPress={handleShare} />
          <HeaderButton icon="ellipsis-horizontal" onPress={handleMoreOptions} size={18} />
        </View>
      </Animated.View>

      {/* ── Bottom CTA Bar ── */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {isOwnArticle ? (
          <View style={styles.ownArticleBar}>
            <Ionicons name="checkmark-circle" size={18} color={colors.muted} />
            <Text style={styles.ownArticleText}>C'est votre article</Text>
          </View>
        ) : isSwapContext ? (
          <Pressable style={styles.swapButton} onPress={handleProposeSwap}>
            <Ionicons name="swap-horizontal" size={18} color={colors.white} />
            <Text style={styles.swapButtonText}>PROPOSER UN SWAP</Text>
          </Pressable>
        ) : (
          <View style={styles.ctaRow}>
            <Pressable style={styles.offerOutlineButton} onPress={handleMakeOffer}>
              <Text style={styles.offerOutlineText}>OFFRE</Text>
            </Pressable>
            <Pressable style={styles.buyButton} onPress={handleBuy}>
              <Ionicons name="bag-handle-outline" size={16} color={colors.cream} />
              <Text style={styles.buyButtonText}>ACHETER · ${article.price}</Text>
            </Pressable>
          </View>
        )}
      </View>

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
// STYLES — Proposal A "Editorial Scroll"
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  scrollView: {
    flex: 1,
  },

  // ── Floating Header ──
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    zIndex: 100,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(26, 24, 20, 0.4)',
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  // ── Discount Badge ──
  discountBadge: {
    position: 'absolute',
    top: HERO_HEIGHT - 32,
    right: 20,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    zIndex: 10,
  },
  discountText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  // ── Info Block (below images) ──
  infoBlock: {
    paddingHorizontal: 24,
    paddingTop: 28,
  },

  // Brand + Category
  brandCategory: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 6,
  },

  // Title
  title: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: colors.charcoal,
    marginBottom: 16,
  },

  // Price
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 6,
  },
  price: {
    fontFamily: fonts.sansMedium,
    fontSize: 34,
    color: colors.primary,
    letterSpacing: -0.5,
  },
  originalPrice: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },

  // Engagement
  engagementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  engagementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  engagementText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  engagementDate: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },

  // Tags
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 24,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  tagText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.charcoal,
  },
  packageTag: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.25)',
    backgroundColor: colors.sageLight,
  },
  packageTagText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.sage,
  },

  // Description
  description: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 25,
    color: colors.foregroundSecondary,
    marginBottom: 24,
  },

  // Delivery
  deliveryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  deliveryCardShipping: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: colors.sageLight,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.2)',
    borderRadius: radius.sm,
  },
  deliveryCardPickup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: 'rgba(196, 96, 58, 0.15)',
    borderRadius: radius.sm,
  },
  deliveryCardContent: {
    flex: 1,
  },
  deliveryCardTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
  },
  deliveryCardSub: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },

  // Section label
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },

  // Meetup spots
  spotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 24,
  },
  spotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  spotEmoji: {
    fontSize: 10,
  },
  spotName: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.charcoal,
  },

  // Seller card
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginBottom: 24,
  },
  sellerInfo: {
    flex: 1,
  },
  sellerName: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
    marginBottom: 2,
  },
  sellerMeta: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
  },
  sellerRatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  sellerRatingText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },

  // Security notice
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  securityText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.success,
  },

  // ── Bottom CTA Bar ──
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  offerOutlineButton: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.charcoal,
    borderRadius: radius.none,
  },
  offerOutlineText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.charcoal,
  },
  buyButton: {
    flex: 2,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.charcoal,
    borderRadius: radius.none,
  },
  buyButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.cream,
  },
  swapButton: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.sage,
    borderRadius: radius.none,
  },
  swapButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.white,
  },
  ownArticleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    gap: spacing.xs,
  },
  ownArticleText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },

  // ── Loading State ──
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },

  // ── Error State ──
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  errorTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 18,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  errorButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
  },
  errorButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.white,
  },
});
