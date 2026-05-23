/**
 * Public User Profile Screen
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Accessible from:
 * - Conversation list (tap on user avatar/name)
 * - Product detail (tap on seller info)
 * - Search results, liked sellers list, etc.
 *
 * Features:
 * - Avatar, name, handle, member since, location
 * - Bio + style tags
 * - Stats row (Articles, Ventes, Note, Abonnés)
 * - Action CTAs (Contacter, S'abonner)
 * - Tabs: Articles grid + Avis (reviews)
 * - More menu: Share profile, Report, Block
 */

import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
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
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, ScreenHeader } from '@/components/ui';
import { colors, fonts, radius, spacing, animations } from '@/constants/theme';
import { useUser } from '@/contexts/AuthContext';
import { useSellerLikes } from '@/hooks/useSellerLikes';
import { queryKeys } from '@/lib/queryKeys';
import { ChatService } from '@/services/chatService';
import { UserService } from '@/services/userService';
import { UserStatsService, UserStats } from '@/services/userStatsService';
import { Article, User } from '@/types';
import { formatDisplayName } from '@/utils/formatName';

// =============================================================================
// TYPES
// =============================================================================

type ProfileTab = 'articles' | 'avis';

interface Review {
  id: string;
  reviewerName: string;
  reviewerImage?: string;
  reviewerId?: string;
  date: string;
  text: string;
  note: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 2;
const NUM_COLUMNS = 3;
const ITEM_SIZE = (SCREEN_WIDTH - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// --- Stat Item ---

interface StatItemProps {
  value: string | number;
  label: string;
  delay?: number;
}

const StatItem = React.memo(function StatItem({ value, label, delay = 0 }: StatItemProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(delay)}
      style={styles.statItem}
    >
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Animated.View>
  );
});

// --- Style Tag ---

interface StyleTagProps {
  tag: string;
}

const StyleTag = React.memo(function StyleTag({ tag }: StyleTagProps) {
  return (
    <View style={styles.styleTag}>
      <Text style={styles.styleTagText}>{tag}</Text>
    </View>
  );
});

// --- Article Grid Item ---

interface ArticleGridItemProps {
  article: Article;
  onPress: () => void;
  index: number;
}

const ArticleGridItem = React.memo(function ArticleGridItem({
  article,
  onPress,
  index,
}: ArticleGridItemProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.97, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  return (
    <AnimatedPressable
      style={[styles.gridItem, animatedStyle]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Image
        source={{ uri: article.images?.[0]?.url }}
        style={styles.gridImage}
        contentFit="cover"
        transition={200}
        cachePolicy="memory-disk"
      />
      {article.isSold ? (
        <View style={styles.gridSoldBadge}>
          <Text style={styles.gridSoldText}>VENDU</Text>
        </View>
      ) : (
        <View style={styles.gridPriceBadge}>
          <Text style={styles.gridPriceText}>{article.price} $</Text>
        </View>
      )}
    </AnimatedPressable>
  );
});

// --- Review Item ---

interface ReviewItemProps {
  review: Review;
  index: number;
  onReviewerPress?: (reviewerId: string) => void;
}

const ReviewItem = React.memo(function ReviewItem({
  review,
  index,
  onReviewerPress,
}: ReviewItemProps) {
  const renderStars = useCallback((note: number) => {
    return [1, 2, 3, 4, 5].map((star) => (
      <Ionicons
        key={star}
        name={star <= Math.round(note) ? 'star' : 'star-outline'}
        size={12}
        color={colors.rust}
      />
    ));
  }, []);

  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(100 + index * 60)}
      style={styles.reviewItem}
    >
      <View style={styles.reviewHeader}>
        <Pressable
          style={styles.reviewAvatarContainer}
          onPress={() => review.reviewerId && onReviewerPress?.(review.reviewerId)}
          disabled={!review.reviewerId}
        >
          {review.reviewerImage ? (
            <Image
              source={{ uri: review.reviewerImage }}
              style={styles.reviewAvatar}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.reviewAvatar, styles.reviewAvatarPlaceholder]}>
              <Text style={styles.reviewAvatarInitial}>
                {review.reviewerName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </Pressable>
        <View style={styles.reviewMeta}>
          <Text style={styles.reviewName}>{review.reviewerName}</Text>
          <View style={styles.reviewStarsRow}>{renderStars(review.note)}</View>
        </View>
        <Text style={styles.reviewDate}>{review.date}</Text>
      </View>
      <Text style={styles.reviewText}>{review.text}</Text>
    </Animated.View>
  );
});

// --- Empty State ---

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  message: string;
}

const EmptyState = React.memo(function EmptyState({ icon, message }: EmptyStateProps) {
  return (
    <View style={styles.emptyTab}>
      <Ionicons name={icon} size={40} color={colors.muted} />
      <Text style={styles.emptyTabText}>{message}</Text>
    </View>
  );
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentUser = useUser();

  // State
  const [reviews] = useState<Review[]>([]);
  const [activeTab, setActiveTab] = useState<ProfileTab>('articles');
  const [isContactLoading, setIsContactLoading] = useState(false);

  // Follow hook
  const { likedSellerIds, toggleLike } = useSellerLikes();
  const isFollowing = id ? likedSellerIds.includes(id) : false;

  // Check if viewing own profile
  const isOwnProfile = currentUser?.id === id;

  // ─── Data loading via React Query ───
  const {
    data: profileUser = null,
    isLoading: isProfileLoading,
  } = useQuery<User | null>({
    queryKey: queryKeys.users.profile(id ?? ''),
    queryFn: () => UserService.getUserById(id!),
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  });

  const { data: stats = null } = useQuery<UserStats | null>({
    queryKey: ['users', 'stats', id] as const,
    queryFn: () => UserStatsService.getUserStats(id!).catch(() => null),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: queryKeys.users.articles(id ?? ''),
    queryFn: () => UserStatsService.getArticlesEnVente(id!).catch(() => [] as Article[]),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = isProfileLoading;

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleContact = useCallback(async () => {
    if (!currentUser?.id || !id || !profileUser) return;

    setIsContactLoading(true);
    try {
      const chat = await ChatService.createOrGetChat(currentUser.id, id);
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      if (__DEV__) console.error('Error creating chat:', error);
      Alert.alert('Erreur', 'Impossible de demarrer la conversation.');
    } finally {
      setIsContactLoading(false);
    }
  }, [currentUser?.id, id, profileUser, router]);

  const handleFollow = useCallback(async () => {
    if (!currentUser || !id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await toggleLike(id);
  }, [currentUser, id, toggleLike]);

  const handleArticlePress = useCallback(
    (articleId: string) => {
      router.push(`/article/${articleId}`);
    },
    [router],
  );

  const handleReviewerPress = useCallback(
    (reviewerId: string) => {
      if (reviewerId !== id) {
        router.push(`/user/${reviewerId}`);
      }
    },
    [id, router],
  );

  const handleShare = useCallback(async () => {
    if (!profileUser) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const name = formatDisplayName(profileUser.displayName);
      await Share.share({
        message: `Decouvre le profil de ${name} sur Seconde !`,
        url: `https://seconde.app/user/${id}`,
      });
    } catch (error) {
      // User cancelled share
    }
  }, [profileUser, id]);

  const handleReport = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Signaler cet utilisateur',
      'Pour quelle raison souhaitez-vous signaler ce profil ?',
      [
        { text: 'Contenu inapproprie', onPress: () => { if (__DEV__) console.log('Report: inappropriate'); } },
        { text: 'Comportement suspect', onPress: () => { if (__DEV__) console.log('Report: suspicious'); } },
        { text: 'Spam', onPress: () => { if (__DEV__) console.log('Report: spam'); } },
        { text: 'Annuler', style: 'cancel' },
      ],
    );
  }, []);

  const handleMore = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      undefined as unknown as string,
      undefined as unknown as string,
      [
        { text: 'Partager le profil', onPress: handleShare },
        {
          text: 'Signaler',
          onPress: handleReport,
          style: 'destructive',
        },
        { text: 'Annuler', style: 'cancel' },
      ],
    );
  }, [handleShare, handleReport]);

  const handleEditProfile = useCallback(() => {
    router.push('/settings/profile-details');
  }, [router]);

  // ─── Computed ──────────────────────────────────────────────────────────────

  const memberSince = useMemo(() => {
    if (!profileUser?.createdAt) return '';
    const date =
      profileUser.createdAt instanceof Date
        ? profileUser.createdAt
        : new Date(profileUser.createdAt);
    return `Membre depuis ${date.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    })}`;
  }, [profileUser?.createdAt]);

  const userHandle = useMemo(() => {
    if (!profileUser?.displayName) return '';
    return `@${profileUser.displayName.toLowerCase().replace(/\s+/g, '.')}`;
  }, [profileUser?.displayName]);

  const locationLabel = useMemo(() => {
    if (!profileUser?.address?.city) return null;
    return profileUser.address.city;
  }, [profileUser?.address?.city]);

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="" onBack={handleBack} showBorder={false} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={colors.charcoal} />
        </View>
      </View>
    );
  }

  // ─── Not Found ─────────────────────────────────────────────────────────────

  if (!profileUser) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="" onBack={handleBack} showBorder={false} />
        <View style={styles.loadingState}>
          <Ionicons name="person-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyTitle}>Utilisateur introuvable</Text>
          <Text style={styles.emptySubtitle}>
            Ce profil n'existe pas ou a ete supprime
          </Text>
        </View>
      </View>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScreenHeader
        title=""
        onBack={handleBack}
        showBorder={false}
        rightContent={
          <View style={styles.headerActions}>
            {isOwnProfile ? (
              <Pressable style={styles.headerActionButton} onPress={handleEditProfile}>
                <Text style={styles.headerActionButtonText}>MODIFIER</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={styles.iconButton} onPress={handleShare}>
                  <Ionicons name="share-outline" size={18} color={colors.charcoal} />
                </Pressable>
                <Pressable style={styles.iconButton} onPress={handleMore}>
                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.charcoal} />
                </Pressable>
              </>
            )}
          </View>
        }
      />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        {/* ─── Profile Header ─────────────────────────────────────── */}
        <View style={styles.profileHeaderZone}>
          {/* Avatar + Info */}
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={styles.avatarSection}
          >
            <Avatar
              source={profileUser.profileImage}
              name={profileUser.displayName || 'U'}
              size="xxl"
            />
            <View style={styles.nameSection}>
              <Text style={styles.userName}>
                {formatDisplayName(profileUser.displayName)}
              </Text>
              {userHandle ? (
                <Text style={styles.userHandle}>{userHandle}</Text>
              ) : null}
              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={12} color={colors.muted} />
                <Text style={styles.metaText}>{memberSince}</Text>
              </View>
              {locationLabel && (
                <View style={styles.metaRow}>
                  <Ionicons name="location-outline" size={12} color={colors.muted} />
                  <Text style={styles.metaText}>{locationLabel}</Text>
                </View>
              )}
            </View>
          </Animated.View>

          {/* Bio */}
          {profileUser.bio ? (
            <Animated.View entering={FadeInDown.duration(400).delay(50)}>
              <Text style={styles.bio}>{profileUser.bio}</Text>
            </Animated.View>
          ) : null}

          {/* Style Tags */}
          {profileUser.styleProfile?.styleTags && profileUser.styleProfile.styleTags.length > 0 && (
            <Animated.View
              entering={FadeInDown.duration(400).delay(80)}
              style={styles.styleTagsRow}
            >
              {profileUser.styleProfile.styleTags.slice(0, 5).map((tag) => (
                <StyleTag key={tag} tag={tag} />
              ))}
            </Animated.View>
          )}

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <StatItem
              value={stats?.articlesEnVente ?? 0}
              label="Articles"
              delay={100}
            />
            <View style={styles.statDivider} />
            <StatItem
              value={stats?.articlesVendus ?? 0}
              label="Ventes"
              delay={150}
            />
            <View style={styles.statDivider} />
            <StatItem
              value={stats?.moyenneNote ? stats.moyenneNote.toFixed(1) : '—'}
              label="Note"
              delay={200}
            />
            <View style={styles.statDivider} />
            <StatItem
              value={profileUser.sellerLikesCount ?? 0}
              label="Abonnes"
              delay={250}
            />
          </View>

          {/* Action Buttons */}
          {!isOwnProfile && (
            <Animated.View
              entering={FadeInDown.duration(400).delay(300)}
              style={styles.actionsRow}
            >
              <Pressable
                style={styles.contactButton}
                onPress={handleContact}
                disabled={isContactLoading}
              >
                {isContactLoading ? (
                  <ActivityIndicator size="small" color={colors.cream} />
                ) : (
                  <>
                    <Ionicons name="chatbubble-outline" size={14} color={colors.cream} />
                    <Text style={styles.contactButtonText}>CONTACTER</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                style={[
                  styles.followButton,
                  isFollowing && styles.followButtonActive,
                ]}
                onPress={handleFollow}
              >
                <Ionicons
                  name={isFollowing ? 'checkmark' : 'add'}
                  size={14}
                  color={isFollowing ? colors.sage : colors.charcoal}
                />
                <Text
                  style={[
                    styles.followButtonText,
                    isFollowing && styles.followButtonTextActive,
                  ]}
                >
                  {isFollowing ? 'ABONNE' : "S'ABONNER"}
                </Text>
              </Pressable>
            </Animated.View>
          )}
        </View>

        {/* ─── Tabs (sticky) ──────────────────────────────────────── */}
        <View style={styles.tabsContainer}>
          <Pressable
            style={[styles.tab, activeTab === 'articles' && styles.tabActive]}
            onPress={() => setActiveTab('articles')}
          >
            <Ionicons
              name="grid-outline"
              size={16}
              color={activeTab === 'articles' ? colors.charcoal : colors.muted}
              style={styles.tabIcon}
            />
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'articles' && styles.tabLabelActive,
              ]}
            >
              Articles
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, activeTab === 'avis' && styles.tabActive]}
            onPress={() => setActiveTab('avis')}
          >
            <Ionicons
              name="star-outline"
              size={16}
              color={activeTab === 'avis' ? colors.charcoal : colors.muted}
              style={styles.tabIcon}
            />
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'avis' && styles.tabLabelActive,
              ]}
            >
              Avis{stats && stats.nombreAvis > 0 ? ` (${stats.nombreAvis})` : ''}
            </Text>
          </Pressable>
        </View>

        {/* ─── Tab Content ────────────────────────────────────────── */}
        {activeTab === 'articles' ? (
          <View style={styles.articlesGrid}>
            {articles.length === 0 ? (
              <EmptyState
                icon="shirt-outline"
                message="Aucun article en vente"
              />
            ) : (
              <View style={styles.gridContainer}>
                {articles.map((article, index) => (
                  <ArticleGridItem
                    key={article.id}
                    article={article}
                    index={index}
                    onPress={() => handleArticlePress(article.id)}
                  />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.reviewsContainer}>
            {/* Rating Summary */}
            {stats && stats.nombreAvis > 0 && (
              <Animated.View
                entering={FadeInDown.duration(400)}
                style={styles.ratingHeader}
              >
                <Text style={styles.ratingScore}>
                  {stats.moyenneNote.toFixed(1)}
                </Text>
                <View style={styles.ratingDetails}>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Ionicons
                        key={star}
                        name={
                          star <= Math.round(stats.moyenneNote)
                            ? 'star'
                            : 'star-outline'
                        }
                        size={16}
                        color={colors.rust}
                      />
                    ))}
                  </View>
                  <Text style={styles.ratingCount}>
                    {stats.nombreAvis} {stats.nombreAvis > 1 ? 'evaluations' : 'evaluation'}
                  </Text>
                </View>
              </Animated.View>
            )}

            {/* Reviews List */}
            {reviews.length === 0 ? (
              <EmptyState
                icon="chatbubble-outline"
                message="Aucun avis pour le moment"
              />
            ) : (
              reviews.map((review, index) => (
                <ReviewItem
                  key={review.id}
                  review={review}
                  index={index}
                  onReviewerPress={handleReviewerPress}
                />
              ))
            )}
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollView: {
    flex: 1,
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },

  // Header Actions
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  headerActionButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
  },
  headerActionButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.8,
    color: colors.charcoal,
    textTransform: 'uppercase',
  },

  // Profile Header Zone
  profileHeaderZone: {
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  nameSection: {
    flex: 1,
  },
  userName: {
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    lineHeight: 28,
    color: colors.charcoal,
  },
  userHandle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
  metaText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
  },

  // Bio
  bio: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.charcoal,
    marginBottom: spacing.md,
  },

  // Style Tags
  styleTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  styleTag: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  styleTagText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    color: colors.charcoal,
    letterSpacing: 0.3,
  },

  // Stats Row
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.charcoal,
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.charcoal,
    paddingVertical: 14,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  contactButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  followButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingVertical: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  followButtonActive: {
    backgroundColor: colors.sageLight,
    borderColor: colors.sage,
  },
  followButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.16,
    color: colors.charcoal,
    textTransform: 'uppercase',
  },
  followButtonTextActive: {
    color: colors.sage,
  },

  // Tabs
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    gap: 6,
  },
  tabActive: {
    borderBottomColor: colors.charcoal,
  },
  tabIcon: {
    // icon spacing handled by gap
  },
  tabLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.charcoal,
  },

  // Articles Grid
  articlesGrid: {
    minHeight: 300,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  gridItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.3,
    position: 'relative',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.borderLight,
  },
  gridPriceBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
  },
  gridPriceText: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.charcoal,
  },
  gridSoldBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(26, 24, 20, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridSoldText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.8,
    color: colors.white,
    textTransform: 'uppercase',
  },

  // Reviews
  reviewsContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    minHeight: 300,
  },
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  ratingScore: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 42,
    lineHeight: 48,
    color: colors.charcoal,
  },
  ratingDetails: {
    gap: spacing.xs,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  ratingCount: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
  },
  reviewItem: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  reviewAvatarContainer: {},
  reviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  reviewAvatarPlaceholder: {
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewAvatarInitial: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },
  reviewMeta: {
    flex: 1,
    gap: 2,
  },
  reviewName: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.charcoal,
  },
  reviewStarsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewDate: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
  },
  reviewText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.charcoal,
  },

  // Empty states
  emptyTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    lineHeight: 24,
    color: colors.charcoal,
  },
  emptySubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTab: {
    paddingVertical: spacing['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  emptyTabText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },

  // Bottom
  bottomPadding: {
    height: 100,
  },
});
