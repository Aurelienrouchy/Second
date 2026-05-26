/**
 * useArticleActions — orchestrates all user-triggered actions on the article detail
 * screen (favorite, share, buy, make offer, propose swap, owner actions, more options).
 *
 * Pure orchestration: services + router + haptics + user. Does not own UI state.
 */

import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { ActionSheetIOS, Alert, Platform, Share } from 'react-native';

import type { MakeOfferModalRef } from '@/components/MakeOfferModal';
import type { ReportBottomSheetRef } from '@/components/ReportBottomSheet';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useFavorites, favoritesKeys } from '@/hooks/useFavorites';
import { queryKeys } from '@/lib/queryKeys';

import { httpsCallable } from 'firebase/functions';
import { ArticlesService } from '@/services/articlesService';
import { ChatService } from '@/services/chatService';
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
  const { requireAuth } = useAuthRequired();
  const queryClient = useQueryClient();

  const handleToggleFavorite = useCallback(() => {
    if (!article) return;
    if (article.isSold) return;
    Haptics.notificationAsync(
      isFavorite(article.id)
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success
    );
    requireAuth(
      () => toggleFavorite(article.id),
      AUTH_MESSAGES.like
    );
  }, [article, isFavorite, requireAuth, toggleFavorite]);

  const handleShare = useCallback(async () => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Universal link — requires Apple AASA / Android assetlinks on seconde.app
    // Fallback scheme: seconde://article/{id} (configured in app.config.js)
    const webUrl = `https://seconde.app/article/${article.id}`;
    const shareMessage = `Découvrez cet article sur Seconde : ${article.title} — ${formatPrice(article.price)}\n${webUrl}`;
    try {
      await Share.share({
        title: article.title,
        message: shareMessage,
        url: webUrl,
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
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              queryClient.invalidateQueries({ queryKey: queryKeys.articles.all });
              queryClient.invalidateQueries({ queryKey: favoritesKeys.all });
              router.back();
            } catch (error) {
              if (__DEV__) console.error('Erreur suppression:', error);
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
    router.push(`/article/edit/${article.id}`);
  }, [article, router]);

  const handleMarkAsSold = useCallback(async () => {
    if (!article) return;

    try {
      const toggleSold = httpsCallable(functions, 'toggleArticleSold');
      await toggleSold({ articleId: article.id });
      // Optimistic update
      setArticle((prev) => prev ? { ...prev, isSold: !prev.isSold } : null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: queryKeys.articles.all });
      queryClient.invalidateQueries({ queryKey: favoritesKeys.all });
    } catch (error: unknown) {
      if (__DEV__) console.error('Erreur mise à jour:', error);
      const message = error instanceof Error ? error.message : 'Impossible de mettre à jour l\'article';
      Alert.alert('Erreur', message);
    }
  }, [article, setArticle, queryClient]);

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
