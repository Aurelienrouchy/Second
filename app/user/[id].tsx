/**
 * Public User Profile Screen
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Accessible from:
 * - Conversation list (tap on user avatar/name)
 * - Product detail (tap on seller info)
 * - Search results, liked sellers list, etc.
 */

import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import ReportBottomSheet, {
  ReportBottomSheetRef,
} from '@/components/ReportBottomSheet';
import { ScreenHeader } from '@/components/ui';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { useUser } from '@/hooks/useAuth';
import {
  ArticleGrid,
  ProfileHeader,
  ProfileSkeleton,
  ProfileTabs,
  ReviewList,
  UserActions,
} from '@/features/user-profile';
import type { ProfileTab, ProfileReview } from '@/features/user-profile';
import { useSellerLikes } from '@/hooks/useSellerLikes';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { ChatService } from '@/services/chatService';
import { ModerationService } from '@/services/moderationService';
import {
  getUserPublicProfile,
  getUserReviews,
  type UserPublicProfile,
} from '@/services/reviewService';
import { UserService } from '@/services/userService';
import { UserStatsService, type UserStats } from '@/services/userStatsService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { Article, User } from '@/types';
import { formatDisplayName } from '@/utils/formatName';
import { normalizeArticleImages } from '@/utils/articleImages';

export default function UserProfileScreen() {
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const router = useRouter();
  const currentUser = useUser();
  const queryClient = useQueryClient();
  const showAuthSheet = useAuthSheetStore((state) => state.show);
  const reportSheetRef = useRef<ReportBottomSheetRef>(null);

  // State
  const [activeTab, setActiveTab] = useState<ProfileTab>('articles');
  const [isContactLoading, setIsContactLoading] = useState(false);
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  // Follow hook.
  // `isFollowing` is derived client-side from useSellerLikes (the optimistic
  // source of truth that stays in sync with toggleLike). The `isFollowing`
  // field also returned by getUserPublicProfile is intentionally ignored here
  // to avoid a stale value diverging from the optimistic toggle state.
  const { likedSellerIds, toggleLike } = useSellerLikes();
  const isFollowing = id ? likedSellerIds.includes(id) : false;

  // Check if viewing own profile
  const isOwnProfile = currentUser?.id === id;

  // ─── Data loading via React Query ───
  //
  // Non-own profiles use getUserPublicProfile (callable, guest-safe, single
  // round-trip) to avoid direct Firestore reads on `avis/` which fail for
  // unauthenticated users.
  // Own profiles still use direct Firestore reads (authenticated).

  // Public profile (single callable for non-own profiles)
  const {
    data: publicProfile = null,
    isLoading: publicProfileLoading,
    error: publicProfileError,
    refetch: refetchPublicProfile,
  } = useQuery<UserPublicProfile | null>({
    queryKey: ['users', 'publicProfile', id] as const,
    queryFn: () => getUserPublicProfile(id!),
    enabled: !!id && !isOwnProfile,
    staleTime: 10 * 60 * 1000,
  });

  // Own profile: fetch user data directly
  const {
    data: ownProfileUser = null,
    isLoading: ownProfileLoading,
    error: ownProfileError,
    refetch: refetchOwnProfile,
  } = useQuery<User | null>({
    queryKey: queryKeys.users.profile(id ?? ''),
    queryFn: () => UserService.getUserById(id!),
    enabled: !!id && isOwnProfile,
    staleTime: 10 * 60 * 1000,
  });

  // Own profile stats (authenticated — direct Firestore read)
  const { data: ownStats = null } = useQuery<UserStats | null>({
    queryKey: ['users', 'stats', id] as const,
    queryFn: () => UserStatsService.getUserStats(id!).catch(() => null),
    enabled: !!id && isOwnProfile,
    staleTime: 5 * 60 * 1000,
  });

  // Own profile articles (authenticated — direct Firestore read)
  const { data: ownArticles = [], isLoading: ownArticlesLoading, error: ownArticlesError, refetch: refetchOwnArticles } = useQuery<Article[]>({
    queryKey: queryKeys.users.articles(id ?? ''),
    queryFn: () => UserStatsService.getArticlesEnVente(id!),
    enabled: !!id && isOwnProfile,
    staleTime: 5 * 60 * 1000,
  });

  // Own profile reviews (authenticated — callable)
  const {
    data: ownReviews = [],
    isLoading: ownReviewsLoading,
    error: ownReviewsError,
    refetch: refetchOwnReviews,
  } = useQuery<ProfileReview[]>({
    queryKey: ['reviews', 'user', id] as const,
    queryFn: async () => {
      const result = await getUserReviews({ userId: id!, limit: 20 });
      return result.reviews.map((r) => ({
        id: r.id,
        reviewerName: r.reviewerName,
        reviewerImage: r.reviewerImage,
        reviewerId: r.reviewerId,
        date: r.createdAt,
        text: r.text,
        note: r.note,
      }));
    },
    enabled: !!id && isOwnProfile,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Derive unified data from the two paths ───

  const isLoading = isOwnProfile ? ownProfileLoading : publicProfileLoading;
  const profileError = isOwnProfile ? ownProfileError : publicProfileError;

  const profileUser = useMemo<User | null>(() => isOwnProfile
    ? ownProfileUser
    : publicProfile
      ? ({
          id: publicProfile.profile.id,
          displayName: publicProfile.profile.displayName,
          username: publicProfile.profile.username ?? undefined,
          profileImage: publicProfile.profile.profileImage ?? undefined,
          bio: publicProfile.profile.bio ?? undefined,
          createdAt: publicProfile.profile.createdAt
            ? new Date(publicProfile.profile.createdAt)
            : new Date(),
          rating: publicProfile.profile.rating ?? undefined,
          accountType: publicProfile.profile.accountType,
          sellerLikesCount: publicProfile.profile.sellerLikesCount,
        } as unknown as User)
      : null, [isOwnProfile, ownProfileUser, publicProfile]);

  const stats = useMemo<UserStats | null>(() => isOwnProfile
    ? ownStats
    : publicProfile
      ? {
          articlesEnVente: publicProfile.stats.articlesEnVente,
          articlesVendus: publicProfile.stats.articlesVendus,
          gainsTotal: 0,
          totalVues: 0,
          totalLikes: 0,
          moyenneNote: publicProfile.stats.averageRating,
          nombreAvis: publicProfile.stats.totalReviews,
        }
      : null, [isOwnProfile, ownStats, publicProfile]);

  const articles = useMemo<Article[]>(() => isOwnProfile
    ? ownArticles
    : (publicProfile?.articles ?? []).map((a) => ({
        id: a.id,
        title: a.title,
        price: a.price,
        images: normalizeArticleImages(a.images),
        isSold: a.isSold,
        condition: a.condition,
        brand: a.brand,
      } as unknown as Article)), [isOwnProfile, ownArticles, publicProfile]);

  const reviews = useMemo<ProfileReview[]>(() => isOwnProfile
    ? ownReviews
    : (publicProfile?.reviews ?? []).map((r) => ({
        id: r.id,
        reviewerName: r.reviewerName,
        reviewerImage: r.reviewerImage ?? undefined,
        reviewerId: r.reviewerId,
        date: r.createdAt,
        text: r.text,
        note: r.note,
      })), [isOwnProfile, ownReviews, publicProfile]);

  const reviewsLoading = isOwnProfile ? ownReviewsLoading : publicProfileLoading;

  const handleTabChange = useCallback(
    (tab: ProfileTab) => {
      setActiveTab(tab);
      track('list_filtered', {
        screen: 'public_profile',
        filter: tab,
        filtered_count: tab === 'articles' ? articles.length : reviews.length,
      });
    },
    [articles.length, reviews.length],
  );

  // ─── Analytics: profile_viewed (once per profile, after load resolves) ───────
  const profileViewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading || !id || profileViewedRef.current === id) return;
    profileViewedRef.current = id;
    const loaded = !!profileUser;
    const allowedSources = ['home_featured', 'article', 'chat', 'review', 'liked_sellers', 'search'] as const;
    const resolvedSource = allowedSources.includes(source as (typeof allowedSources)[number])
      ? (source as (typeof allowedSources)[number])
      : 'other';
    track('profile_viewed', {
      profile_user_id: id,
      outcome: loaded ? 'loaded' : 'not_found',
      is_own_profile: isOwnProfile,
      articles_count: loaded ? stats?.articlesEnVente : undefined,
      reviews_count: loaded ? stats?.nombreAvis : undefined,
      followers_count: loaded ? profileUser?.sellerLikesCount : undefined,
      rating: loaded ? profileUser?.rating : undefined,
      source: resolvedSource,
    });
  }, [isLoading, id, profileUser, isOwnProfile, stats, source]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const currentUserId = currentUser?.id;

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleContact = useCallback(async () => {
    if (!currentUserId) {
      showAuthSheet('Connectez-vous pour contacter ce vendeur');
      return;
    }
    if (!id || !profileUser) return;

    setIsContactLoading(true);
    try {
      const chat = await ChatService.createOrGetChat(currentUserId, id);
      track('chat_started', {
        chat_id: chat.id,
        source: 'profile',
        other_user_id: id,
        is_new_chat: !chat.lastMessage,
        outcome: 'success',
      });
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      if (__DEV__) console.error('Error creating chat:', error);
      track('chat_started', {
        chat_id: '',
        source: 'profile',
        other_user_id: id,
        is_new_chat: false,
        outcome: 'error',
      });
      Alert.alert('Erreur', 'Impossible de démarrer la conversation.');
    } finally {
      setIsContactLoading(false);
    }
  }, [currentUserId, id, profileUser, router, showAuthSheet]);

  const handleFollow = useCallback(async () => {
    if (!currentUser) {
      showAuthSheet('Connectez-vous pour suivre ce vendeur');
      return;
    }
    if (!id) return;
    setIsFollowLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await toggleLike(id, 'public_profile');
    } finally {
      setIsFollowLoading(false);
    }
  }, [currentUser, id, toggleLike, showAuthSheet]);

  const handleArticlePress = useCallback(
    (articleId: string) => {
      const article = articles.find((a) => a.id === articleId);
      if (article) {
        track('article_card_tapped', {
          article_id: articleId,
          source: 'public_profile',
          price_cents: Math.round(article.price * 100),
          brand: article.brand,
          condition: article.condition,
          is_sold: !!article.isSold,
        });
      }
      router.push(`/article/${articleId}`);
    },
    [router, articles],
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
        message: `Découvre le profil de ${name} sur Seconde !`,
        url: `https://seconde.ca/user/${id}`,
      });
      if (id) {
        track('content_shared', { content_type: 'profile', content_id: id });
      }
    } catch {
      // User cancelled share
    }
  }, [profileUser, id]);

  const handleReport = useCallback(() => {
    if (!id) return;
    if (!currentUser) {
      showAuthSheet('Connectez-vous pour signaler cet utilisateur');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    reportSheetRef.current?.open('user', id, 'public_profile');
  }, [id, currentUser, showAuthSheet]);

  const handleBlock = useCallback(() => {
    if (!id || !profileUser) return;
    if (!currentUserId) {
      showAuthSheet('Connectez-vous pour bloquer cet utilisateur');
      return;
    }
    const name = formatDisplayName(profileUser.displayName);
    Alert.alert(
      'Bloquer cet utilisateur',
      `Voulez-vous bloquer ${name} ? Cette personne ne pourra plus vous contacter ni voir vos articles.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Bloquer',
          style: 'destructive',
          onPress: async () => {
            try {
              await ModerationService.blockUser(
                currentUserId,
                id,
                profileUser.displayName ?? '',
              );
              track('user_blocked', {
                blocked_user_id: id,
                source: 'profile',
                success: true,
              });
              queryClient.invalidateQueries({
                queryKey: ['blockedUsers', currentUserId],
              });
              Alert.alert('Utilisateur bloqué', `${name} a été bloqué.`, [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (error) {
              track('user_blocked', {
                blocked_user_id: id,
                source: 'profile',
                success: false,
              });
              const message =
                error instanceof Error ? error.message : 'Une erreur est survenue';
              Alert.alert('Erreur', message);
            }
          },
        },
      ],
    );
  }, [id, profileUser, currentUserId, showAuthSheet, queryClient, router]);

  const handleMore = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('', '', [
      { text: 'Partager le profil', onPress: handleShare },
      {
        text: 'Signaler',
        onPress: handleReport,
        style: 'destructive',
      },
      {
        text: 'Bloquer',
        onPress: handleBlock,
        style: 'destructive',
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }, [handleShare, handleReport, handleBlock]);

  const handleEditProfile = useCallback(() => {
    router.push('/settings/profile-details');
  }, [router]);

  // ─── Shared header (profile + actions + tabs) ────────────────────────────────
  // The same FlashList/header remains mounted for both tabs. Data is cached
  // independently of the selected tab; each tab retains its scroll position.
  const profileHeaderElement = profileUser ? (
    <View>
      <View>
        <ProfileHeader user={profileUser} stats={stats} />
        {!isOwnProfile && (
          <UserActions
            isFollowing={isFollowing}
            isContactLoading={isContactLoading}
            isFollowLoading={isFollowLoading}
            onContact={handleContact}
            onFollow={handleFollow}
          />
        )}
      </View>
      <ProfileTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        reviewCount={stats?.nombreAvis ?? 0}
      />
    </View>
  ) : undefined;

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="" onBack={handleBack} showBorder={false} />
        <ProfileSkeleton />
      </View>
    );
  }

  // ─── Not Found ─────────────────────────────────────────────────────────────

  if (!profileUser) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="" onBack={handleBack} showBorder={false} />
        <View style={styles.notFoundState}>
          <Ionicons name="person-outline" size={48} color={colors.muted} />
          <Text style={styles.emptyTitle}>{profileError ? 'Impossible de charger le profil' : 'Utilisateur introuvable'}</Text>
          <Text style={styles.emptySubtitle}>
            {profileError ? 'Vérifiez votre connexion et réessayez.' : 'Ce profil n’existe pas ou a été supprimé'}
          </Text>
          {profileError && <Pressable onPress={() => { if (isOwnProfile) void refetchOwnProfile(); else void refetchPublicProfile(); }} style={styles.headerActionButton} accessibilityRole="button"><Text style={styles.headerActionButtonText}>Réessayer</Text></Pressable>}
        </View>
      </View>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container} testID="user-profile-screen">
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

      <ArticleGrid
        articles={activeTab === 'articles' ? articles : []}
        onArticlePress={handleArticlePress}
        ListHeaderComponent={profileHeaderElement}
        contentKey={`${id}:${activeTab}`}
        showEmptyState={activeTab === 'articles' && !(isOwnProfile && (ownArticlesLoading || ownArticlesError))}
        ListFooterComponent={activeTab === 'avis' ? (
          ownReviewsError && isOwnProfile ? (
            <View style={styles.contentState}>
              <Text style={styles.emptySubtitle}>Impossible de charger les avis.</Text>
              <Pressable onPress={() => void refetchOwnReviews()} accessibilityRole="button"><Text style={styles.headerActionButtonText}>Réessayer</Text></Pressable>
            </View>
          ) : (
            <ReviewList stats={stats} reviews={reviews} isLoading={reviewsLoading}
              isOwnProfile={isOwnProfile} onReviewerPress={handleReviewerPress} />
          )
        ) : isOwnProfile && ownArticlesError ? (
          <View style={styles.contentState}>
            <Text style={styles.emptySubtitle}>Impossible de charger les articles.</Text>
            <Pressable onPress={() => void refetchOwnArticles()} accessibilityRole="button"><Text style={styles.headerActionButtonText}>Réessayer</Text></Pressable>
          </View>
        ) : isOwnProfile && ownArticlesLoading ? (
          <View style={styles.contentState}><ActivityIndicator color={colors.muted} /></View>
        ) : undefined}
        bottomInset={100}
      />

      <ReportBottomSheet ref={reportSheetRef} />
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
  contentState: { paddingVertical: spacing['2xl'], alignItems: 'center', gap: spacing.md },
  notFoundState: {
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

  // Empty / Not found
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

});
