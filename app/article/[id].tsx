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
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import MakeOfferModal, { MakeOfferModalRef } from '@/components/MakeOfferModal';
import ReportBottomSheet, { ReportBottomSheetRef } from '@/components/ReportBottomSheet';

import { getCategoryLabelFromIds } from '@/data/categories-v2';
import { queryKeys } from '@/lib/queryKeys';
import { ArticlesService } from '@/services/articlesService';
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
  const [, setCurrentImageIndex] = useState(0);

  const { id, partyId, swapItemId } = useLocalSearchParams<{ id: string; partyId?: string; swapItemId?: string }>();
  const isSwapContext = !!partyId;
  const makeOfferModalRef = useRef<MakeOfferModalRef>(null);
  const reportBottomSheetRef = useRef<ReportBottomSheetRef>(null);
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const queryClient = useQueryClient();

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // ─── Data loading ───
  const {
    data: article = null,
    isLoading,
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

  // ─── Render states ───
  if (isLoading) return <LoadingState />;
  if (!article) return <ErrorState onBack={handleBack} />;

  const isOwnArticle = !!(user && user.id === article.sellerId);
  const categoryLabel = article.categoryIds?.length
    ? getCategoryLabelFromIds(article.categoryIds)
    : article.category;

  const tags = buildTags(article);
  const discount = getDiscountPercent(article.price, (article as any).originalPrice);
  const sellerRating = (article as any).sellerRating;
  const deliveryOptions = (article as any).deliveryOptions;
  const shippingCost = deliveryOptions?.shippingCost;

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
          onImageIndexChange={setCurrentImageIndex}
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
        <View style={{ height: 110 }} />
      </AnimatedScrollView>

      <ArticleFloatingHeader
        isFavorite={isFavorite(article.id)}
        scrollY={scrollY}
        insetsTop={insets.top}
        onBack={handleBack}
        onToggleFavorite={handleToggleFavorite}
        onShare={handleShare}
        onMoreOptions={handleMoreOptions}
      />

      <ArticleCTABar
        isOwnArticle={isOwnArticle}
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
        sellerNeighborhood={article.neighborhood}
        sellerPreferredSpots={article.preferredMeetupSpots}
        onMeetupOfferSubmit={handleMeetupOfferSubmit}
      />

      <ReportBottomSheet ref={reportBottomSheetRef} />
    </View>
  );
}
