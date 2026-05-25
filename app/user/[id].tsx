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
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
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
import { useUser } from '@/contexts/AuthContext';
import {
  ArticleGrid,
  ProfileHeader,
  ProfileSkeleton,
  ProfileTabs,
  ReviewList,
  UserActions,
} from '@/features/user-profile';
import type { ProfileTab, Review } from '@/features/user-profile';
import { useSellerLikes } from '@/hooks/useSellerLikes';
import { queryKeys } from '@/lib/queryKeys';
import { ChatService } from '@/services/chatService';
import { getUserReviews } from '@/services/reviewService';
import { UserService } from '@/services/userService';
import { UserStatsService, UserStats } from '@/services/userStatsService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { Article, User } from '@/types';
import { formatDisplayName } from '@/utils/formatName';

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const currentUser = useUser();
  const showAuthSheet = useAuthSheetStore((state) => state.show);
  const reportSheetRef = useRef<ReportBottomSheetRef>(null);

  // State
  const [activeTab, setActiveTab] = useState<ProfileTab>('articles');
  const [isContactLoading, setIsContactLoading] = useState(false);
  const [isFollowLoading, setIsFollowLoading] = useState(false);

  // Follow hook
  const { likedSellerIds, toggleLike } = useSellerLikes();
  const isFollowing = id ? likedSellerIds.includes(id) : false;

  // Check if viewing own profile
  const isOwnProfile = currentUser?.id === id;

  // ─── Data loading via React Query ───

  const {
    data: profileUser = null,
    isLoading,
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

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery<Review[]>({
    queryKey: ['reviews', 'user', id] as const,
    queryFn: async () => {
      const result = await getUserReviews({ userId: id!, limit: 20 });
      return result.reviews.map((r) => ({
        id: r.id,
        reviewerName: r.reviewerName,
        reviewerImage: r.reviewerImage,
        reviewerId: undefined,
        date: r.createdAt,
        text: r.text,
        note: r.note,
      }));
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleContact = useCallback(async () => {
    if (!currentUser?.id) {
      showAuthSheet('Connectez-vous pour contacter ce vendeur');
      return;
    }
    if (!id || !profileUser) return;

    setIsContactLoading(true);
    try {
      const chat = await ChatService.createOrGetChat(currentUser.id, id);
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      if (__DEV__) console.error('Error creating chat:', error);
      Alert.alert('Erreur', 'Impossible de démarrer la conversation.');
    } finally {
      setIsContactLoading(false);
    }
  }, [currentUser?.id, id, profileUser, router, showAuthSheet]);

  const handleFollow = useCallback(async () => {
    if (!currentUser) {
      showAuthSheet('Connectez-vous pour suivre ce vendeur');
      return;
    }
    if (!id) return;
    setIsFollowLoading(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await toggleLike(id);
    } finally {
      setIsFollowLoading(false);
    }
  }, [currentUser, id, toggleLike, showAuthSheet]);

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
        message: `Découvre le profil de ${name} sur Seconde !`,
        url: `https://seconde.app/user/${id}`,
      });
    } catch {
      // User cancelled share
    }
  }, [profileUser, id]);

  const handleReport = useCallback(() => {
    if (!id) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    reportSheetRef.current?.open('user', id);
  }, [id]);

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
          <Text style={styles.emptyTitle}>Utilisateur introuvable</Text>
          <Text style={styles.emptySubtitle}>
            Ce profil n&apos;existe pas ou a été supprimé
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
        {/* Profile Header + Actions (single child for correct sticky index) */}
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

        {/* Sticky Tabs (index 1) */}
        <ProfileTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          reviewCount={stats?.nombreAvis ?? 0}
        />

        {/* Tab Content */}
        {activeTab === 'articles' ? (
          <ArticleGrid
            articles={articles}
            onArticlePress={handleArticlePress}
          />
        ) : (
          <ReviewList
            stats={stats}
            reviews={reviews}
            isLoading={reviewsLoading}
            onReviewerPress={handleReviewerPress}
          />
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

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
  scrollView: {
    flex: 1,
  },
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

  // Bottom
  bottomPadding: {
    height: 100,
  },
});
