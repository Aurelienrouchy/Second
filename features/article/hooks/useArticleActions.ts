/**
 * useArticleActions — orchestrates all user-triggered actions on the article detail
 * screen (favorite, share, buy, make offer, propose swap, owner actions, more options).
 *
 * Pure orchestration: services + router + haptics + user. Does not own UI state.
 */

import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { ActionSheetIOS, Alert, Platform, Share } from 'react-native';

import type { MakeOfferModalRef } from '@/components/MakeOfferModal';
import type { ReportBottomSheetRef } from '@/components/ReportBottomSheet';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useRequireAuth } from '@/hooks/useAuthRequired';
import { useFavorites, favoritesKeys } from '@/hooks/useFavorites';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';

import { httpsCallable } from 'firebase/functions';
import { ArticlesService } from '@/services/articlesService';
import { ChatService } from '@/services/chatService';
import { GENERALIST_ZONE_ID } from '@/services/swapService';
import { functions } from '@/config/firebaseConfig';
import { useAuthStore } from '@/store/authStore';
import { formatPrice } from '@/utils/formatPrice';

import type { Article, MeetupSpot } from '@/types';

interface UseArticleActionsParams {
  article: Article | null;
  setArticle: React.Dispatch<React.SetStateAction<Article | null>>;
  partyId?: string;
  swapItemId?: string;
  makeOfferModalRef: React.RefObject<MakeOfferModalRef | null>;
  reportBottomSheetRef: React.RefObject<ReportBottomSheetRef | null>;
}

export function useArticleActions({
  article,
  setArticle,
  partyId,
  swapItemId,
  makeOfferModalRef,
  reportBottomSheetRef,
}: UseArticleActionsParams) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { toggleFavorite, isFavorite } = useFavorites();
  const { requireAuth } = useRequireAuth();
  const queryClient = useQueryClient();

  // Navigation guard against double-taps on Buy / Offer / Swap: a synchronous
  // ref flips to true before the first router.push and blocks any further push
  // until the screen regains focus (i.e. the user navigates back).
  const isTransitioning = useRef(false);
  useFocusEffect(
    useCallback(() => {
      isTransitioning.current = false;
    }, [])
  );

  // Per-article lock against double-taps on "Marquer comme vendu" / "Remettre
  // en vente": holds the ids of articles whose toggle request is in-flight.
  const togglingArticles = useRef<Set<string>>(new Set());

  const handleToggleFavorite = useCallback(() => {
    if (!article) return;
    if (article.isSold) return;
    requireAuth(
      () => {
        // Play the favorite haptic only once the user is authenticated, so a
        // guest tapping the heart does not feel a "success" cue before the
        // auth sheet appears.
        Haptics.notificationAsync(
          isFavorite(article.id)
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Success
        );
        toggleFavorite(article.id, { source: 'article_detail', article, via: 'heart' });
      },
      AUTH_MESSAGES.like
    );
  }, [article, isFavorite, requireAuth, toggleFavorite]);

  const handleShare = useCallback(async () => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Universal link — requires Apple AASA / Android assetlinks on seconde.ca
    // Fallback scheme: seconde://article/{id} (configured in app.config.js)
    const webUrl = `https://seconde.ca/article/${article.id}`;
    const shareMessage = `Découvrez cet article sur Seconde : ${article.title} — ${formatPrice(article.price)}\n${webUrl}`;
    try {
      await Share.share({
        title: article.title,
        message: shareMessage,
        url: webUrl,
      });
      track('content_shared', {
        content_type: 'article',
        content_id: article.id,
        price_cents: Math.round(article.price * 100),
        brand: article.brand,
      });
    } catch (error) {
      if (__DEV__) console.log('Error sharing:', error);
    }
  }, [article]);

  const handleBuy = useCallback(() => {
    if (!article) return;

    if (article.isSold) {
      Alert.alert('Article vendu', 'Cet article a déjà été vendu.');
      return;
    }

    if (user && user.id === article.sellerId) {
      Alert.alert('Erreur', 'Vous ne pouvez pas acheter votre propre article.');
      return;
    }

    requireAuth(
      () => {
        if (isTransitioning.current) return;
        isTransitioning.current = true;
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

    if (article.isSold) {
      Alert.alert('Article vendu', 'Cet article a déjà été vendu.');
      return;
    }

    if (user && user.id === article.sellerId) {
      Alert.alert('Erreur', 'Vous ne pouvez pas faire une offre sur votre propre article.');
      return;
    }

    // TODO: check for existing pending offers before opening modal
    // Requires knowing the chatId to query messages — not available here without
    // a Firestore lookup. The chat screen already guards against duplicates.

    requireAuth(
      () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        makeOfferModalRef.current?.present();
      },
      AUTH_MESSAGES.buy
    );
  }, [article, user, requireAuth, makeOfferModalRef]);

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
      if (__DEV__) console.error('Error submitting meetup offer:', error);
      throw error;
    }
  }, [article, user, router]);

  const handleShippingOfferSubmit = useCallback(async (
    amount: number,
    message: string,
  ) => {
    if (!article || !user) return;

    if (user.id === article.sellerId) {
      throw new Error('Vous ne pouvez pas faire une offre sur votre propre article.');
    }

    try {
      const chat = await ChatService.createOrGetChat(user.id, article.sellerId, article.id);
      await ChatService.sendOffer(
        chat.id,
        user.id,
        article.sellerId,
        amount,
        message
      );
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      if (__DEV__) console.error('Error submitting shipping offer:', error);
      throw error;
    }
  }, [article, user, router]);

  const handleProposeSwap = useCallback(() => {
    if (!article) return;

    requireAuth(
      () => {
        if (isTransitioning.current) return;
        isTransitioning.current = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        router.push({
          pathname: '/propose-swap',
          params: {
            // The Swap Zone is the single generalist zone; default to it when no
            // explicit party context is provided so the action is never inert.
            partyId: partyId ?? GENERALIST_ZONE_ID,
            targetArticleId: article.id,
            receiverId: article.sellerId,
            receiverName: article.sellerName || '',
            receiverImage: article.sellerImage || '',
          },
        });
      },
      AUTH_MESSAGES.swapParty
    );
  }, [article, partyId, requireAuth, router]);

  const handleViewProfile = useCallback(() => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/user/${article.sellerId}`);
  }, [article, router]);

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }, [router]);

  const handleDeleteArticle = useCallback(() => {
    if (!article) return;

    Alert.alert(
      'Supprimer l\'article',
      `Êtes-vous sûr de vouloir supprimer "${article.title}" ? Si des offres ou transactions sont en cours, elles seront affectées.`,
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
                source: 'article_detail',
                entry: 'menu',
                price_cents: Math.round(article.price * 100),
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              queryClient.invalidateQueries({ queryKey: queryKeys.articles.all });
              queryClient.invalidateQueries({ queryKey: favoritesKeys.all });
              router.back();
            } catch (error) {
              if (__DEV__) console.error('Erreur suppression:', error);
              track('article_deleted', {
                article_id: article.id,
                is_sold: article.isSold,
                outcome: 'error',
                source: 'article_detail',
                entry: 'menu',
                price_cents: Math.round(article.price * 100),
              });
              Alert.alert('Erreur', 'Impossible de supprimer l\'article');
            }
          },
        },
      ]
    );
  }, [article, router, queryClient]);

  const handleEditArticle = useCallback(() => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/article/edit/[id]',
      params: { id: article.id, source: 'article_detail' },
    });
  }, [article, router]);

  const handleMarkAsSold = useCallback(async () => {
    if (!article) return;
    // Ignore taps while a toggle for this article is already in-flight.
    if (togglingArticles.current.has(article.id)) return;
    togglingArticles.current.add(article.id);

    const nextState: 'sold' | 'relisted' = article.isSold ? 'relisted' : 'sold';
    try {
      const toggleSold = httpsCallable(functions, 'toggleArticleSold');
      await toggleSold({ articleId: article.id });
      // Optimistic update
      setArticle((prev) => prev ? { ...prev, isSold: !prev.isSold } : null);
      track('article_sold_toggled', {
        article_id: article.id,
        new_state: nextState,
        success: true,
        source: 'article_detail',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: queryKeys.articles.all });
      queryClient.invalidateQueries({ queryKey: favoritesKeys.all });
    } catch (error: unknown) {
      if (__DEV__) console.error('Erreur mise à jour:', error);
      track('article_sold_toggled', {
        article_id: article.id,
        new_state: nextState,
        success: false,
        source: 'article_detail',
      });
      const message = error instanceof Error ? error.message : 'Impossible de mettre à jour l\'article';
      Alert.alert('Erreur', message);
    } finally {
      togglingArticles.current.delete(article.id);
    }
  }, [article, setArticle, queryClient]);

  const handleMoreOptions = useCallback(() => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const isOwner = user && user.id === article.sellerId;

    if (isOwner) {
      const soldOption = article.isSold ? 'Remettre en vente' : 'Marquer comme vendu';

      if (article.isSold) {
        // Sold articles: no "Modifier" option
        const options = [soldOption, 'Supprimer', 'Annuler'];
        if (Platform.OS === 'ios') {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              options,
              destructiveButtonIndex: 1,
              cancelButtonIndex: 2,
              title: article.title,
            },
            (buttonIndex) => {
              if (buttonIndex === 0) handleMarkAsSold();
              else if (buttonIndex === 1) handleDeleteArticle();
            }
          );
        } else {
          Alert.alert(article.title, 'Que souhaitez-vous faire ?', [
            { text: 'Annuler', style: 'cancel' },
            { text: soldOption, onPress: handleMarkAsSold },
            { text: 'Supprimer', style: 'destructive', onPress: handleDeleteArticle },
          ]);
        }
      } else {
        const options = ['Modifier', soldOption, 'Supprimer', 'Annuler'];
        if (Platform.OS === 'ios') {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              options,
              destructiveButtonIndex: 2,
              cancelButtonIndex: 3,
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
  }, [article, user, requireAuth, handleEditArticle, handleMarkAsSold, handleDeleteArticle, reportBottomSheetRef]);

  return {
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
  };
}
