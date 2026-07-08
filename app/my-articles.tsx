import { useAuthStore } from '@/store/authStore';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { ArticlesService } from '@/services/articlesService';
import { Article } from '@/types';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { draftService } from '@/services/draftService';
import { formatPrice } from '@/utils/formatPrice';
import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import {
  ActionSheetIOS,
  Alert,
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { ScreenHeader, Skeleton, Text } from '@/components/ui';

export default function MyArticlesScreen() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const queryClient = useQueryClient();
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const {
    data: articles = [],
    isLoading,
    isRefetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.articles.userList(user?.id ?? ''),
    queryFn: () => ArticlesService.getUserArticles(user!.id),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const [filter, setFilter] = useState<'all' | 'active' | 'sold'>('all');

  const filteredArticles = useMemo(() => {
    if (filter === 'all') return articles;
    if (filter === 'active') return articles.filter((a) => !a.isSold);
    return articles.filter((a) => a.isSold);
  }, [articles, filter]);

  const closeAllSwipeables = () => {
    swipeableRefs.current.forEach((ref) => ref?.close());
  };

  const handleDeleteArticle = (article: Article, entry: 'menu' | 'swipe' = 'menu') => {
    Alert.alert(
      'Supprimer définitivement',
      `"${article.title}" sera supprimé définitivement. Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await ArticlesService.deleteArticle(article.id);
              track('article_deleted', {
                article_id: article.id,
                is_sold: article.isSold,
                outcome: 'success',
                source: 'my_articles',
                entry,
                price_cents: Math.round(article.price * 100),
              });
              queryClient.setQueryData<Article[]>(
                queryKeys.articles.userList(user!.id),
                (old) => old?.filter((a) => a.id !== article.id) ?? []
              );
              closeAllSwipeables();
            } catch (error) {
              if (__DEV__) console.error('Erreur suppression:', error);
              track('article_deleted', {
                article_id: article.id,
                is_sold: article.isSold,
                outcome: 'error',
                source: 'my_articles',
                entry,
                price_cents: Math.round(article.price * 100),
              });
              Alert.alert('Erreur', 'Impossible de supprimer l\'article');
            }
          },
        },
      ]
    );
  };

  const handleMarkAsSold = async (article: Article) => {
    const nextState: 'sold' | 'relisted' = article.isSold ? 'relisted' : 'sold';
    try {
      await httpsCallable(functions, 'toggleArticleSold')({ articleId: article.id });
      track('article_sold_toggled', {
        article_id: article.id,
        new_state: nextState,
        success: true,
        source: 'my_articles',
      });
      queryClient.setQueryData<Article[]>(
        queryKeys.articles.userList(user!.id),
        (old) =>
          old?.map((a) => (a.id === article.id ? { ...a, isSold: !a.isSold } : a)) ?? []
      );
    } catch (error) {
      if (__DEV__) console.error('Erreur mise a jour:', error);
      track('article_sold_toggled', {
        article_id: article.id,
        new_state: nextState,
        success: false,
        source: 'my_articles',
      });
      Alert.alert('Erreur', 'Impossible de mettre a jour l\'article');
    }
  };

  const handleEditArticle = (article: Article) => {
    router.push({
      pathname: '/article/edit/[id]',
      params: { id: article.id, source: 'my_articles' },
    });
  };

  const showActionSheet = (article: Article) => {
    const soldOption = article.isSold ? 'Remettre en vente' : 'Marquer comme vendu';

    if (Platform.OS === 'ios') {
      if (article.isSold) {
        // Sold articles: no "Modifier" option
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Annuler', soldOption, 'Supprimer'],
            destructiveButtonIndex: 2,
            cancelButtonIndex: 0,
            title: article.title,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              handleMarkAsSold(article);
            } else if (buttonIndex === 2) {
              handleDeleteArticle(article);
            }
          }
        );
      } else {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Annuler', 'Modifier', soldOption, 'Supprimer'],
            destructiveButtonIndex: 3,
            cancelButtonIndex: 0,
            title: article.title,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              handleEditArticle(article);
            } else if (buttonIndex === 2) {
              handleMarkAsSold(article);
            } else if (buttonIndex === 3) {
              handleDeleteArticle(article);
            }
          }
        );
      }
    } else {
      const alertOptions: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
        { text: 'Annuler', style: 'cancel' },
      ];
      if (!article.isSold) {
        alertOptions.push({ text: 'Modifier', onPress: () => handleEditArticle(article) });
      }
      alertOptions.push({ text: soldOption, onPress: () => handleMarkAsSold(article) });
      alertOptions.push({ text: 'Supprimer', style: 'destructive', onPress: () => handleDeleteArticle(article) });

      Alert.alert(article.title, 'Que souhaitez-vous faire ?', alertOptions);
    }
  };

  const renderRightActions = useCallback(
    (
      progress: Animated.AnimatedInterpolation<number>,
      _dragX: Animated.AnimatedInterpolation<number>,
      article: Article
    ) => {
      const translateX = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [80, 0],
      });

      return (
        <Animated.View style={[styles.deleteAction, { transform: [{ translateX }] }]}>
          <Pressable
            style={styles.deleteButton}
            onPress={() => handleDeleteArticle(article, 'swipe')}
          >
            <Ionicons name="trash-outline" size={24} color={colors.white} />
            <Text style={styles.deleteText}>Supprimer</Text>
          </Pressable>
        </Animated.View>
      );
    },
    []
  );

  const renderArticleItem = useCallback(
    ({ item }: { item: Article }) => {
      const firstImage = item.images[0];

      return (
        <Swipeable
          ref={(ref) => {
            if (ref) swipeableRefs.current.set(item.id, ref);
          }}
          renderRightActions={(progress, dragX) =>
            renderRightActions(progress, dragX, item)
          }
          rightThreshold={40}
        >
          <View style={styles.articleItemContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.articleItem,
                pressed && styles.pressed,
              ]}
              onPress={() => {
                track('article_card_tapped', {
                  article_id: item.id,
                  source: 'my_articles',
                  price_cents: Math.round(item.price * 100),
                  brand: item.brand,
                  condition: item.condition,
                  is_sold: !!item.isSold,
                });
                router.push(`/article/${item.id}`);
              }}
            >
              <Image
                source={firstImage?.url ? { uri: firstImage.url } : undefined}
                style={styles.articleImage}
                contentFit="cover"
                transition={500}
                placeholder={firstImage?.blurhash ? { blurhash: firstImage.blurhash } : undefined}
              />
              <View style={styles.articleInfo}>
                <Text style={styles.articleTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.articlePrice}>{formatPrice(item.price)}</Text>
                <Text style={styles.articleSize}>{item.size?.value || 'Taille non spécifiée'}</Text>
                <View style={styles.articleStats}>
                  <View style={styles.articleStatRow}>
                    <Ionicons name="eye-outline" size={14} color={colors.muted} />
                    <Text style={styles.articleStat}> {item.views}</Text>
                  </View>
                  <View style={styles.articleStatRow}>
                    <Ionicons name="heart-outline" size={14} color={colors.muted} />
                    <Text style={styles.articleStat}> {item.likes}</Text>
                  </View>
                  <Text
                    style={[
                      styles.articleStatus,
                      item.isSold ? styles.soldStatus : styles.activeStatus,
                    ]}
                  >
                    {item.isSold ? 'Vendu' : 'En vente'}
                  </Text>
                </View>
              </View>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.menuButton,
                pressed && styles.pressed,
              ]}
              onPress={() => showActionSheet(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="ellipsis-vertical" size={20} color={colors.muted} />
            </Pressable>
          </View>
        </Swipeable>
      );
    },
    [renderRightActions]
  );

  const keyExtractor = useCallback((item: Article) => item.id, []);

  const listEmptyComponent = useMemo(() => {
    const message =
      filter === 'sold'
        ? 'Aucun article vendu pour le moment.'
        : filter === 'active'
          ? 'Aucun article en vente pour le moment.'
          : 'Aucun article à afficher.';
    return (
      <View style={styles.listEmptyContainer}>
        <Ionicons name="cube-outline" size={40} color={colors.muted} style={styles.emptyIcon} />
        <Text style={styles.emptyText}>{message}</Text>
      </View>
    );
  }, [filter]);

  if (!user) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mes articles" onBack={() => router.back()} />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Connexion requise</Text>
          <Text style={styles.emptyText}>
            Connectez-vous pour voir vos articles
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              pressed && styles.pressed,
            ]}
            onPress={() => useAuthSheetStore.getState().show(AUTH_MESSAGES.sell)}
          >
            <Text style={styles.ctaButtonText}>Se connecter</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mes articles" onBack={() => router.back()} />
        <View style={styles.skeletonList}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={styles.skeletonArticleItem}>
              <Skeleton width={80} height={80} borderRadius={radius.md} />
              <View style={styles.skeletonArticleInfo}>
                <Skeleton width="70%" height={14} />
                <Skeleton width="30%" height={18} style={{ marginTop: spacing.xs }} />
                <Skeleton width="40%" height={13} style={{ marginTop: spacing.xs }} />
                <View style={styles.skeletonArticleStats}>
                  <Skeleton width={40} height={14} />
                  <Skeleton width={40} height={14} />
                  <Skeleton width={52} height={22} borderRadius={radius.full} />
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (isError) {
    if (__DEV__) console.error('[MyArticles] Query error:', error);
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mes articles" onBack={() => router.back()} />
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.danger} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>Erreur de chargement</Text>
          <Text style={styles.emptyText}>
            {'Impossible de charger vos articles.\nVeuillez réessayer.'}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              pressed && styles.pressed,
            ]}
            onPress={() => refetch()}
          >
            <Text style={styles.ctaButtonText}>Réessayer</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={`Mes articles (${articles.length})`}
        onBack={() => router.back()}
      />

      {articles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cube-outline" size={48} color={colors.muted} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>Aucun article</Text>
          <Text style={styles.emptyText}>
            {'Vous n\'avez pas encore publié d\'articles.\nCommencez à vendre maintenant !'}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              pressed && styles.pressed,
            ]}
            onPress={() => {
              void draftService.hasDraft().then((hasExistingDraft) => {
                track('sell_entry_tapped', {
                  outcome: 'opened',
                  platform: Platform.OS === 'ios' ? 'ios' : 'android',
                  has_existing_draft: hasExistingDraft,
                  source: 'my_articles_empty',
                });
              });
              router.push('/sell');
            }}
          >
            <Text style={styles.ctaButtonText}>Vendre un article</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.filterTabs}>
            {([
              { key: 'all' as const, label: 'Tous' },
              { key: 'active' as const, label: 'En vente' },
              { key: 'sold' as const, label: 'Vendus' },
            ]).map((tab) => (
              <Pressable
                key={tab.key}
                style={[
                  styles.filterTab,
                  filter === tab.key && styles.filterTabActive,
                ]}
                onPress={() => setFilter(tab.key)}
              >
                <Text
                  style={[
                    styles.filterTabText,
                    filter === tab.key && styles.filterTabTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <FlashList
            data={filteredArticles}
            renderItem={renderArticleItem}
            keyExtractor={keyExtractor}
            ListEmptyComponent={listEmptyComponent}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
            }
            showsVerticalScrollIndicator={false}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.7,
  },
  skeletonList: {
    flex: 1,
  },
  skeletonArticleItem: {
    flexDirection: 'row',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.sm,
  },
  skeletonArticleInfo: {
    flex: 1,
  },
  skeletonArticleStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  articleItemContainer: {
    position: 'relative',
    backgroundColor: colors.surface,
  },
  articleItem: {
    flexDirection: 'row',
    padding: spacing.md,
    paddingRight: spacing['2xl'],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  articleImage: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceWarm,
    marginRight: spacing.sm,
  },
  articleInfo: {
    flex: 1,
    justifyContent: 'space-between',
  },
  articleTitle: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  articlePrice: {
    ...typography.price,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  articleSize: {
    ...typography.bodySmall,
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
  },
  articleStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  articleStat: {
    ...typography.caption,
    color: colors.muted,
  },
  articleStatus: {
    ...typography.caption,
    fontFamily: fonts.sansMedium,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  activeStatus: {
    backgroundColor: colors.successLight,
    color: colors.success,
  },
  soldStatus: {
    backgroundColor: colors.primaryLight,
    color: colors.primary,
  },
  menuButton: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.sm,
    padding: spacing.sm,
    zIndex: 1,
  },
  deleteAction: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  deleteButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  deleteText: {
    ...typography.caption,
    color: colors.white,
    marginTop: spacing.xs,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  listEmptyContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['2xl'],
  },
  emptyIcon: {
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.h1,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.foregroundSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  ctaButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  ctaButtonText: {
    ...typography.button,
    color: colors.white,
    textTransform: 'uppercase',
  },
  articleStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterTabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  filterTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceWarm,
  },
  filterTabActive: {
    backgroundColor: colors.primary,
  },
  filterTabText: {
    ...typography.caption,
    fontFamily: fonts.sansMedium,
    color: colors.foregroundSecondary,
  },
  filterTabTextActive: {
    color: colors.white,
  },
});
