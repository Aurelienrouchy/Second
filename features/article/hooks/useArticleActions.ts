/**
 * useArticleActions — orchestrates all user-triggered actions on the article detail
 * screen (favorite, share, buy, make offer, propose swap, owner actions, more options).
 *
 * Pure orchestration: services + router + haptics + user. Does not own UI state.
 */

import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { ActionSheetIOS, Alert, Platform, Share } from 'react-native';

import MakeOfferModal, { MakeOfferModalRef } from '@/components/MakeOfferModal';
import ReportBottomSheet, { ReportBottomSheetRef } from '@/components/ReportBottomSheet';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useFavorites } from '@/hooks/useFavorites';

import { ArticlesService } from '@/services/articlesService';
import { ChatService } from '@/services/chatService';

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
  const { user } = useAuth();
  const { toggleFavorite, isFavorite } = useFavorites();
  const { requireAuth } = useAuthRequired();

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
  }, [article, setArticle]);

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
    handleProposeSwap,
    handleViewProfile,
    handleBack,
    handleMoreOptions,
  };
}
