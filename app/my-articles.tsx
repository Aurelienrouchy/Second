import { ChildSafetyPreparations } from '@/components/ChildSafetyPreparations';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { useTradeOperation, type TradeOperation } from '@/hooks/useTradeOperation';
import { prepareArticleSoldChange, toggleArticleSoldSafely, type ArticleSoldIntent, type ArticleSoldResult } from '@/services/articleSoldService';
import { isDefinitiveTradeRefusal, staleTradeOperation } from '@/services/tradeOperation';
import { useAuthStore } from '@/store/authStore';
import { useShallow } from 'zustand/react/shallow';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { ArticlesService } from '@/services/articlesService';
import { Article } from '@/types';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { favoritesKeys } from '@/hooks/useFavorites';
import {
  CANCEL_LABEL,
  MARK_AS_SOLD_ALERT,
  OWNER_ACTION_SHEET_MESSAGE,
  buildOwnerActionSheetIOS,
  ownerArticleActions,
  removeArticleAlert,
  type OwnerArticleAction,
} from '@/features/article/services/ownerArticleActions';
import { SHIPPING_LISTINGS_ENABLED } from '@/config/featureFlags';
import { draftService } from '@/features/sell/services/draftService';
import { formatPrice } from '@/utils/formatPrice';
import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { Button, ScreenHeader, Skeleton, Text } from '@/components/ui';

const EMPTY_ARTICLES: Article[] = [];

export default function MyArticlesScreen() {
  const { user, ownerUid } = useAuthStore(useShallow(s => ({ user: s.user, ownerUid: s.authenticatedUid })));
  const operationContext = useTradeOperation('my-articles', user?.id ?? null);
  const router = useRouter();
  const showAdmissionError = useTradeAdmissionError();
  const sdkUid = useAuthenticatedUid();
  const preparations = sdkUid ? <ChildSafetyPreparations uid={sdkUid} /> : null;
  const decisionLink = ownerUid ? <Button variant="ghost" onPress={() => router.push('/article/moderation')}>Décisions privées</Button> : undefined;
  const queryClient = useQueryClient();
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const {
    data: articles = EMPTY_ARTICLES,
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

  const [listFrame, setListFrame] = useState(() => ({ articles, epoch: 0 }));
  if (listFrame.articles !== articles) setListFrame({ articles, epoch: listFrame.epoch + 1 });
  const listEpoch = listFrame.epoch;
  const listSource = useRef(listFrame);
  useLayoutEffect(() => { listSource.current = { articles, epoch: listEpoch }; }, [articles, listEpoch]);
  const pendingConfirmations = useRef(new Map<string, { articles: Article[]; cancel: () => void }>());
  useLayoutEffect(() => { pendingConfirmations.current.forEach((pending, id) => { if (pending.articles !== articles) { pending.cancel(); pendingConfirmations.current.delete(id); } }); }, [articles]);
  const displayed = useRef<{ result: ArticleSoldResult; operation: TradeOperation; applied: Article[]; assertCurrent: () => void } | null>(null);
  const [applicationRevision, setApplicationRevision] = useState(0);
  useLayoutEffect(() => {
    const receipt = displayed.current;
    if (!receipt) return;
    displayed.current = null;
    if (articles !== receipt.applied) return;
    try { receipt.assertCurrent(); receipt.result.acknowledge(); } catch { return; }
    queryClient.invalidateQueries({ queryKey: queryKeys.articles.all });
    queryClient.invalidateQueries({ queryKey: favoritesKeys.all });
    if (receipt.result.reconciled) Alert.alert('État actualisé', 'Vérifiez le statut affiché avant de choisir une nouvelle modification.');
    else track('article_sold_toggled', { article_id: receipt.result.article.id, new_state: receipt.result.article.isSold ? 'sold' : 'relisted', success: true, source: 'my_articles' });
  }, [articles, applicationRevision, queryClient]);
  const assertArticleCurrent = (article: Article) => {
    const cached = queryClient.getQueryData<Article[]>(queryKeys.articles.userList(user?.id ?? ''));
    if (listSource.current.epoch !== listEpoch || listSource.current.articles !== articles || !articles.includes(article) || cached !== articles) throw staleTradeOperation();
  };

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
    // « Supprimer » désactive l'article : il n'est pas effacé. L'alerte
    // promettait une suppression « définitive » et « irréversible ».
    let operation;
    try { operation = operationContext.capture(); } catch { return; }
    const confirm = removeArticleAlert(article.title);
    Alert.alert(
      confirm.title,
      confirm.message,
      [
        { text: CANCEL_LABEL, style: 'cancel', onPress: closeAllSwipeables },
        {
          text: confirm.confirmLabel,
          style: 'destructive',
          onPress: async () => {
            if (!operationContext.isCurrent(operation)) return;
            const deletion = operationContext.start(article.id);
            if (!deletion) return;
            try {
              operationContext.assertCurrent(operation);
              await ArticlesService.deleteArticle(article.id);
              operationContext.assertCurrent(operation);
              track('article_deleted', {
                article_id: article.id,
                is_sold: article.isSold,
                outcome: 'success',
                source: 'my_articles',
                entry,
                price_cents: Math.round(article.price * 100),
              });
              queryClient.setQueryData<Article[]>(
                queryKeys.articles.userList(operation.session.uid),
                (old) => old?.filter((a) => a.id !== article.id) ?? []
              );
              // The article page and the other lists kept showing it.
              queryClient.invalidateQueries({ queryKey: queryKeys.articles.all });
              // La fiche article purgeait déjà les favoris, pas « Mes articles ».
              queryClient.invalidateQueries({ queryKey: favoritesKeys.all });
              closeAllSwipeables();
            } catch (error) {
              if (!operationContext.isCurrent(operation)) return;
              if (__DEV__) console.error('Erreur suppression:', error);
              track('article_deleted', {
                article_id: article.id,
                is_sold: article.isSold,
                outcome: 'error',
                source: 'my_articles',
                entry,
                price_cents: Math.round(article.price * 100),
              });
              closeAllSwipeables();
              Alert.alert(
                'Erreur',
                error instanceof Error ? error.message : 'Impossible de retirer l\'article'
              );
            } finally { operationContext.finish(deletion); }
          },
        },
      ]
    );
  };

  const handleMarkAsSold = async (article: Article) => {
    let operation: TradeOperation | null;
    try { assertArticleCurrent(article); operation = operationContext.start(article.id); } catch { return; }
    if (!operation) return;
    let application: Article[] | null = null;
    let cancelled = false; let used = false;
    const cancel = () => { if (!used) { cancelled = true; operationContext.finish(operation!); } };
    pendingConfirmations.current.set(article.id, { articles, cancel });
    const key = queryKeys.articles.userList(operation.session.uid);
    const assertCurrent = () => {
      if (cancelled) throw staleTradeOperation();
      operationContext.assertCurrent(operation!);
      if (application) {
        if (listSource.current.articles !== application || queryClient.getQueryData(key) !== application) throw staleTradeOperation();
      } else assertArticleCurrent(article);
    };
    const apply = (result: ArticleSoldResult) => {
      assertCurrent();
      let didApply = false;
      const stored = queryClient.setQueryData<Article[]>(key, previous => {
        assertCurrent();
        if (previous !== articles || !previous.includes(article)) return previous;
        didApply = true;
        return previous.map(item => item === article ? result.article : item);
      });
      if (!didApply || !stored) return;
      application = stored;
      displayed.current = { result, operation: operation!, applied: stored, assertCurrent };
      setApplicationRevision(value => value + 1);
    };
    const fail = (error: unknown) => {
      try { assertCurrent(); } catch { return; }
      if (showAdmissionError(error, {isCurrent: () => {try {assertCurrent(); return true;} catch {return false;}}, publication: {uid: operation!.session.uid}})) return;
      const detail = error instanceof Error ? error.message : 'Impossible de mettre à jour l’article';
      Alert.alert('Erreur', isDefinitiveTradeRefusal(error) ? detail : `${detail} L’état doit être vérifié avant une nouvelle modification.`);
    };
    const execute = async (intent: ArticleSoldIntent) => {
      if (used || cancelled) return;
      used = true; pendingConfirmations.current.delete(article.id);
      try { assertCurrent(); apply(await toggleArticleSoldSafely(article.id, operation!.session.uid, assertCurrent, intent)); }
      catch (error) { fail(error); }
      finally { operationContext.finish(operation!); }
    };
    try {
      const prepared = await prepareArticleSoldChange(article.id, operation.session.uid, !!article.isSold, assertCurrent);
      assertCurrent();
      if (prepared.result) { pendingConfirmations.current.delete(article.id); apply(prepared.result); operationContext.finish(operation); return; }
      if (!prepared.intent.payload.desiredIsSold) { await execute(prepared.intent); return; }
      Alert.alert(MARK_AS_SOLD_ALERT.title, MARK_AS_SOLD_ALERT.message, [
        { text: CANCEL_LABEL, style: 'cancel', onPress: cancel },
        { text: MARK_AS_SOLD_ALERT.confirmLabel, onPress: () => { void execute(prepared.intent); } },
      ], { onDismiss: cancel });
    } catch (error) { pendingConfirmations.current.delete(article.id); fail(error); operationContext.finish(operation); }
  };

  const handleEditArticle = (article: Article) => {
    router.push({
      pathname: '/article/edit/[id]',
      params: { id: article.id, source: 'my_articles' },
    });
  };

  const showActionSheet = (article: Article) => {
    let operation;
    try { assertArticleCurrent(article); operation = operationContext.capture(); } catch { return; }
    const run = (action: OwnerArticleAction | null) => {
      try { operationContext.assertCurrent(operation); assertArticleCurrent(article); } catch { return; }
      if (action === 'edit') handleEditArticle(article);
      else if (action === 'shipping') router.push({ pathname: '/article/shipping/[id]', params: { id: article.id } });
      else if (action === 'toggle_sold') handleMarkAsSold(article);
      else if (action === 'delete') handleDeleteArticle(article);
    };

    if (Platform.OS === 'ios') {
      const sheet = buildOwnerActionSheetIOS(article.title, !!article.isSold, SHIPPING_LISTINGS_ENABLED && article.isShipping === true);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: sheet.options,
          destructiveButtonIndex: sheet.destructiveButtonIndex,
          cancelButtonIndex: sheet.cancelButtonIndex,
          title: sheet.title,
        },
        (buttonIndex) => run(sheet.actions[buttonIndex] ?? null)
      );
    } else {
      Alert.alert(article.title, OWNER_ACTION_SHEET_MESSAGE, [
        { text: CANCEL_LABEL, style: 'cancel' },
        ...ownerArticleActions(!!article.isSold, SHIPPING_LISTINGS_ENABLED && article.isShipping === true).map((entry) => ({
          text: entry.label,
          style: entry.action === 'delete' ? ('destructive' as const) : undefined,
          onPress: () => run(entry.action),
        })),
      ]);
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
    [handleDeleteArticle]
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
    [renderRightActions, showActionSheet]
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

  if (sdkUid && (!user || user.id !== sdkUid)) return <View style={styles.container}><ScreenHeader title="Mes articles" onBack={() => router.back()} />{preparations}<Text style={styles.emptyText}>Complétez votre profil pour publier une annonce.</Text></View>;

  if (!user) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mes articles" onBack={() => router.back()} rightContent={decisionLink} />
        {preparations}
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
        <ScreenHeader title="Mes articles" onBack={() => router.back()} rightContent={decisionLink} />
        {preparations}
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
        <ScreenHeader title="Mes articles" onBack={() => router.back()} rightContent={decisionLink} />
        {preparations}
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
            onPress={() => {
              track('error_retry_tapped', {
                screen: 'my_articles',
                error_context: 'articles_load',
              });
              refetch();
            }}
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
        rightContent={decisionLink}
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
                hitSlop={{ top: spacing.sm, bottom: spacing.sm }}
                onPress={() => {
                  setFilter(tab.key);
                  const count =
                    tab.key === 'all'
                      ? articles.length
                      : tab.key === 'active'
                        ? articles.filter((a) => !a.isSold).length
                        : articles.filter((a) => a.isSold).length;
                  track('list_filtered', {
                    screen: 'my_articles',
                    filter: tab.key,
                    filtered_count: count,
                  });
                }}
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
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => {
                  track('list_refreshed', {
                    screen: 'my_articles',
                    items_count: filteredArticles.length,
                  });
                  refetch();
                }}
              />
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
    // 25 pt de haut : sous le minimum tactile, avec la fiche article juste
    // dessous comme cible de repli.
    paddingVertical: spacing.sm,
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
