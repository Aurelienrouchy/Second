/**
 * Article Detail Screen — Proposal A: "Editorial Scroll"
 *
 * Layout: Hero image → Brand+Cat → Title → Price → Engagement → Tags →
 *         Description → Delivery → Meetup Spots → Seller → CTA
 *
 * The route file is the orchestrator: data loading + scroll-state + composition.
 * Subcomponents live in features/article/.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import MakeOfferModal from '@/components/MakeOfferModal';
import type { MakeOfferModalRef } from '@/components/MakeOfferModal';
import ReportBottomSheet from '@/components/ReportBottomSheet';
import type { ReportBottomSheetRef } from '@/components/ReportBottomSheet';

import { SHIPPING_ENABLED } from '@/config/featureFlags';
import { getCategoryLabelFromIds } from '@/data/categories-v2';
import { queryKeys } from '@/lib/queryKeys';
import { ArticlesService } from '@/services/articlesService';
import {
  guestPreferencesService,
  toArticleMeta,
} from '@/services/guestPreferencesService';
import type { Article } from '@/types';

import {
  ArticleCTABar,
  ArticleDetails,
  ArticleFloatingHeader,
  ArticleHero,
  ErrorState,
  LoadingState,
  articleStyles as styles,
  buildTags,
  getDiscountPercent,
  useArticleActions,
} from '@/features/article';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

export default function ArticleDetailScreen() {
  const { id, partyId, swapItemId } = useLocalSearchParams<{ id: string; partyId?: string; swapItemId?: string }>();
  const isSwapContext = !!partyId;
  const makeOfferModalRef = useRef<MakeOfferModalRef>(null);
  const reportBottomSheetRef = useRef<ReportBottomSheetRef>(null);
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const queryClient = useQueryClient();

  const router = useRouter();

  const handleGoHome = useCallback(() => {
    router.replace('/(tabs)');
  }, [router]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // ─── Data loading ───
  const {
    data: article = null,
    isLoading,
    isError,
  } = useQuery<Article | null>({
    queryKey: queryKeys.articles.detail(id ?? ''),
    queryFn: () => ArticlesService.getArticleById(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  // Optimistic setter for useArticleActions (handleMarkAsSold).
  // Updates the query cache in-place instead of calling a React setState.
  const setArticle = useCallback(
    (updater: React.SetStateAction<Article | null>) => {
      if (!id) return;
      queryClient.setQueryData<Article | null>(
        queryKeys.articles.detail(id),
        (prev) => {
          if (typeof updater === 'function') return updater(prev ?? null);
          return updater;
        },
      );
    },
    [id, queryClient],
  );

  const {
    user,
    isFavorite,
    handleToggleFavorite,
    handleShare,
    handleBuy,
    handleMakeOffer,
    handleMeetupOfferSubmit,
    handleShippingOfferSubmit,
    handleProposeSwap,
    handleViewProfile,
    handleBack,
    handleMoreOptions,
  } = useArticleActions({
    article,
    setArticle,
    partyId,
    swapItemId,
    makeOfferModalRef,
    reportBottomSheetRef,
  });

  // ─── Track article view (fire-and-forget, once per mount) ───
  const viewTracked = useRef(false);
  useEffect(() => {
    if (!article || viewTracked.current) return;
    if (user?.id === article.sellerId) return;
    viewTracked.current = true;

    const trackView = async () => {
      try {
        const { httpsCallable } = await import('firebase/functions');
        const { functions } = await import('@/config/firebaseConfig');
        const fn = httpsCallable(functions, 'incrementProductView');
        await fn({ productId: article.id });
      } catch (e) {
        if (__DEV__) console.error('View tracking failed:', e);
      }
    };
    trackView();

    // Guests: also record the view locally to feed on-device recommendations.
    if (!user?.id) {
      guestPreferencesService.trackView(toArticleMeta(article));
    }
  }, [article, user]);

  // ─── Render states ───
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onBack={handleBack} isNetworkError />;
  if (!article) return <ErrorState onBack={handleGoHome} />;

  const isOwnArticle = !!(user && user.id === article.sellerId);
  const categoryLabel = article.categoryIds?.length
    ? getCategoryLabelFromIds(article.categoryIds)
    : article.category;

  const tags = buildTags(article);
  const discount = getDiscountPercent(article.price, article.originalPrice);
  const sellerRating = undefined; // TODO: fetch from seller profile when available
  const shippingCost = undefined; // TODO: compute from ShipEngine or article.packageSize

  return (
    <View style={styles.container}>
      <AnimatedScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <ArticleHero
          images={article.images}
          discount={discount}
        />

        <ArticleDetails
          article={article}
          categoryLabel={categoryLabel}
          tags={tags}
          shippingCost={shippingCost}
          sellerRating={sellerRating}
          onViewProfile={handleViewProfile}
        />

        {/* Bottom spacer for CTA bar */}
        <View style={styles.bottomSpacer} />
      </AnimatedScrollView>

      <ArticleFloatingHeader
        isFavorite={isFavorite(article.id)}
        isSold={article.isSold}
        scrollY={scrollY}
        insetsTop={insets.top}
        onBack={handleBack}
        onToggleFavorite={handleToggleFavorite}
        onShare={handleShare}
        onMoreOptions={handleMoreOptions}
      />

      <ArticleCTABar
        isOwnArticle={isOwnArticle}
        isSold={article.isSold}
        isSwapContext={isSwapContext}
        price={article.price}
        bottomInset={insets.bottom}
        onBuy={handleBuy}
        onMakeOffer={handleMakeOffer}
        onProposeSwap={handleProposeSwap}
      />

      <MakeOfferModal
        ref={makeOfferModalRef}
        articleId={article.id}
        articleTitle={article.title}
        currentPrice={article.price}
        defaultMode={SHIPPING_ENABLED && article.isShipping && !article.isHandDelivery ? 'shipping' : 'meetup'}
        sellerNeighborhood={article.neighborhood}
        sellerPreferredSpots={article.preferredMeetupSpots}
        onMeetupOfferSubmit={handleMeetupOfferSubmit}
        onShippingOfferSubmit={handleShippingOfferSubmit}
      />

      <ReportBottomSheet ref={reportBottomSheetRef} />
    </View>
  );
}
