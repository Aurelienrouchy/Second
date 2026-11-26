import { chatIdForPair } from '@/services/chat/primitives';
import { useMeetupProposalRecovery } from '@/hooks/useMeetupProposalRecovery';
import { assertNewSaleAdmission, assertNewProposalAdmission } from '@/services/newSaleAdmission';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { acknowledgeMeetupProposal } from '@/services/chat/offers';
/**
 * useArticleActions — orchestrates all user-triggered actions on the article detail
 * screen (favorite, share, buy, make offer, propose swap, owner actions, more options).
 *
 * Pure orchestration: services + router + haptics + user. Does not own UI state.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Share } from 'react-native';

/**
 * Ref structurelle minimale pour ouvrir la proposition. On évite un
 * import vers features/offers (interdit entre features) en décrivant le seul
 * contrat dont on a besoin.
 */
type PresentableRef = { present: () => void };
import type { ReportBottomSheetRef } from '@/components/ReportBottomSheet';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import {
  CANCEL_LABEL,
  MARK_AS_SOLD_ALERT,
  OWNER_ACTION_SHEET_MESSAGE,
  buildOwnerActionSheetIOS,
  ownerArticleActions,
  removeArticleAlert,
  type OwnerArticleAction,
} from '@/features/article/services/ownerArticleActions';
import { useRequireAuth } from '@/hooks/useAuthRequired';
import { useFavorites } from '@/hooks/useFavorites';
import { track } from '@/lib/analytics';
import { reconcileOwnerArticleAvailability, removeWithdrawnArticleFromCache } from '@/lib/withdrawnArticleCache';

import { ArticlesService } from '@/services/articlesService';
import { ChatService } from '@/services/chatService';
import { GENERALIST_ZONE_ID } from '@/services/swapService';
import { SHIPPING_ENABLED, SHIPPING_LISTINGS_ENABLED } from '@/config/featureFlags';
import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { useTradeOperation, type TradeOperation } from '@/hooks/useTradeOperation';
import { staleTradeOperation, isDefinitiveTradeRefusal } from '@/services/tradeOperation';
import { prepareArticleSoldChange, toggleArticleSoldSafely, type ArticleSoldIntent } from '@/services/articleSoldService';
import { formatPrice } from '@/utils/formatPrice';
import { articleAvailability } from '@/utils/articleAvailability';

import type { Article, MeetupSpot } from '@/types';

interface UseArticleActionsParams {
  article: Article | null;
  setArticle: React.Dispatch<React.SetStateAction<Article | null>>;
  /** Returns the actual stored cache value, or null when the captured cache was replaced. */
  isArticleCurrent?: (expected: Article) => boolean;
  applyArticleReceipt?: (received: Article, expected: Article, assertCurrent: () => void) => Article | null;
  partyId?: string;
  swapItemId?: string;
  makeOfferModalRef: React.RefObject<PresentableRef | null>;
  reportBottomSheetRef: React.RefObject<ReportBottomSheetRef | null>;
}

export function useArticleActions({
  article,
  setArticle,
  applyArticleReceipt,
  isArticleCurrent,
  partyId,
  swapItemId,
  makeOfferModalRef,
  reportBottomSheetRef,
}: UseArticleActionsParams) {
  const operationContext = useTradeOperation(JSON.stringify([article?.id, article?.sellerId]), useAuthStore.getState().user?.id ?? null);
  const [sourceFrame, setSourceFrame] = useState(() => ({ article, epoch: 0 }));
  if (sourceFrame.article !== article) setSourceFrame({ article, epoch: sourceFrame.epoch + 1 });
  const articleEpoch = sourceFrame.epoch;
  const source = useRef(sourceFrame);
  useLayoutEffect(() => { source.current = { article, epoch: articleEpoch }; }, [article, articleEpoch]);
  const assertArticleCurrent = useCallback(() => {
    if (!article || source.current.article !== article || source.current.epoch !== articleEpoch || (isArticleCurrent && !isArticleCurrent(article))) throw staleTradeOperation();
  }, [article, articleEpoch, isArticleCurrent]);
  const router = useRouter();
  const showAdmissionError = useTradeAdmissionError();
  const offerPreviousAttempt = useMeetupProposalRecovery();
  const {user, entryGeneration} = useAuthStore(useShallow(state => ({user: state.user, entryGeneration: getAuthSessionGeneration()})));
  const { toggleFavorite, isFavorite } = useFavorites();
  const { requireAuth } = useRequireAuth();
  const queryClient = useQueryClient();
  const displayedToggle = useRef<{ result: Awaited<ReturnType<typeof toggleArticleSoldSafely>>; operation: TradeOperation; applied: Article | null } | null>(null);
  const pendingConfirmation = useRef<{ article: Article; cancel: () => void } | null>(null);
  useLayoutEffect(() => { if (pendingConfirmation.current && pendingConfirmation.current.article !== article) { pendingConfirmation.current.cancel(); pendingConfirmation.current = null; } }, [article]);
  const [applicationRevision, setApplicationRevision] = useState(0);
  useLayoutEffect(() => {
    const displayed = displayedToggle.current;
    if (!displayed) return;
    if (!operationContext.isCurrent(displayed.operation)) { displayedToggle.current = null; return; }
    if (!article || article !== displayed.applied) { displayedToggle.current = null; return; }
    displayedToggle.current = null;
    try { displayed.result.acknowledge(); }
    catch (error) {
      if (operationContext.isCurrent(displayed.operation)) Alert.alert('État à vérifier', error instanceof Error ? error.message : 'Actualisez cet article avant une nouvelle modification.');
      return;
    }
    void reconcileOwnerArticleAvailability(queryClient, article.id, displayed.operation.session.uid,
      article.isSold, () => operationContext.assertCurrent(displayed.operation)).catch(() => undefined);
    if (displayed.result.reconciled) Alert.alert('État actualisé', 'Vérifiez le statut affiché avant de choisir une nouvelle modification.');
    else {
      track('article_sold_toggled', { article_id: article.id, new_state: article.isSold ? 'sold' : 'relisted', success: true, source: 'article_detail' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [article, applicationRevision, operationContext, queryClient]);

  // Navigation guard against double-taps on Buy / Offer / Swap: a synchronous
  // ref flips to true before the first router.push and blocks any further push
  // until the screen regains focus (i.e. the user navigates back).
  const isTransitioning = useRef(false);
  const entryFocus = useRef({ active: false, epoch: 0 });
  useFocusEffect(
    useCallback(() => {
      isTransitioning.current = false;
      entryFocus.current.active = true; entryFocus.current.epoch++;
      return () => { entryFocus.current.active = false; entryFocus.current.epoch++; };
    }, [])
  );

  // Per-article lock against double-taps on "Marquer comme vendu" / "Remettre
  // en vente": holds the ids of articles whose toggle request is in-flight.

  const handleToggleFavorite = useCallback(() => {
    if (!article) return;
    if (['sold', 'unavailable'].includes(articleAvailability(article))) return;
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
        toggleFavorite(article.id, {
          source: 'article_detail',
          sellerId: article.sellerId,
          priceCents: Math.round(article.price * 100),
          brand: article.brand,
          via: 'heart',
        });
      },
      AUTH_MESSAGES.like
    );
  }, [article, isFavorite, requireAuth, toggleFavorite]);

  const handleShare = useCallback(async () => {
    if (!article) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Dev IDs stay in Seconde Dev. Triple slash preserves the complete route
    // path when Expo Linking parses a custom scheme without a hostname.
    const shareUrl = runtimeEnvironment.name === 'production'
      ? `https://seconde.ca/article/${encodeURIComponent(article.id)}`
      : `${runtimeEnvironment.appScheme}:///article/${encodeURIComponent(article.id)}`;
    const shareMessage = `Découvrez cet article sur Seconde : ${article.title} — ${formatPrice(article.price)}\n${shareUrl}`;
    try {
      await Share.share({
        title: article.title,
        message: shareMessage,
        url: shareUrl,
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
    if (!article || !entryFocus.current.active) return;
    if (!SHIPPING_ENABLED && article.isHandDelivery === false) {
      Alert.alert('Achat indisponible', 'La remise en main propre n’est pas proposée pour cet article.');
      return;
    }
    const focusEpoch = entryFocus.current.epoch;

    const buyEventBase = {
      article_id: article.id,
      seller_id: article.sellerId,
      price_cents: Math.round(article.price * 100),
    };

    if (article.isSold) {
      track('buy_button_tapped', { ...buyEventBase, outcome: 'blocked_sold' });
      Alert.alert('Article vendu', 'Cet article a déjà été vendu.');
      return;
    }

    if (user && user.id === article.sellerId) {
      track('buy_button_tapped', { ...buyEventBase, outcome: 'blocked_own' });
      Alert.alert('Erreur', 'Vous ne pouvez pas acheter votre propre article.');
      return;
    }

    if (!user) {
      track('buy_button_tapped', { ...buyEventBase, outcome: 'auth_gated' });
    }

    requireAuth(
      () => {
        if (isTransitioning.current) return;
        try {
          const session = captureTradeSession();
          assertTradeSessionCurrent(session); assertArticleCurrent();
          if (!entryFocus.current.active || entryFocus.current.epoch !== focusEpoch ||
              (user && (session.uid !== user.id || entryGeneration !== getAuthSessionGeneration()))) return;
          isTransitioning.current = true;
          track('buy_button_tapped', { ...buyEventBase, outcome: 'navigated' });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          // Admission and exact-attempt recovery are checked in checkout before
          // any new engagement. Opening its interface needs no network roundtrip.
          router.push({ pathname: '/checkout', params: { articleId: article.id } });
        } catch (error) {
          isTransitioning.current = false;
          Alert.alert('Action indisponible', error instanceof Error ? error.message : 'Impossible de poursuivre.');
        }
      },
      AUTH_MESSAGES.buy
    );
  }, [article, user, requireAuth, router, assertArticleCurrent, entryGeneration]);

  const handleMakeOffer = useCallback(() => {
    if (!article || !entryFocus.current.active) return;
    if (!SHIPPING_ENABLED && article.isHandDelivery === false) {
      Alert.alert('Offre indisponible', 'La remise en main propre n’est pas proposée pour cet article.');
      return;
    }
    const focusEpoch = entryFocus.current.epoch;

    const priceCents = Math.round(article.price * 100);
    const defaultMode =
      SHIPPING_ENABLED && article.isShipping && !article.isHandDelivery ? 'shipping' : 'meetup';

    if (article.isSold) {
      track('offer_modal_opened', {
        source: 'article',
        article_id: article.id,
        price_cents: priceCents,
        default_mode: defaultMode,
        blocked_reason: 'sold',
      });
      Alert.alert('Article vendu', 'Cet article a déjà été vendu.');
      return;
    }

    if (user && user.id === article.sellerId) {
      track('offer_modal_opened', {
        source: 'article',
        article_id: article.id,
        price_cents: priceCents,
        default_mode: defaultMode,
        blocked_reason: 'own_article',
      });
      Alert.alert('Erreur', 'Vous ne pouvez pas faire une offre sur votre propre article.');
      return;
    }

    // The server atomically replaces the pending buyer/article proposal.
    // The recap explains this policy before sending from every entry point.

    requireAuth(
      () => {
        if (isTransitioning.current) return;
        try {
          const session = captureTradeSession();
          assertTradeSessionCurrent(session); assertArticleCurrent();
          if (!entryFocus.current.active || entryFocus.current.epoch !== focusEpoch ||
              (user && (session.uid !== user.id || entryGeneration !== getAuthSessionGeneration()))) return;
          isTransitioning.current = true;
          track('offer_modal_opened', { source: 'article', article_id: article.id, price_cents: priceCents, default_mode: defaultMode, blocked_reason: 'none' });
          // The form opens immediately. New-sale admission and exact stored
          // proposal recovery still precede the submit RPC below.
          makeOfferModalRef.current?.present();
        } catch (error) {
          Alert.alert('Action indisponible', error instanceof Error ? error.message : 'Impossible de poursuivre.');
        } finally { isTransitioning.current = false; }
      },
      AUTH_MESSAGES.buy
    );
  }, [article, user, requireAuth, makeOfferModalRef, assertArticleCurrent, entryGeneration]);

  const handleMeetupOfferSubmit = useCallback(async (
    amount: number,
    message: string,
    meetupSpot: MeetupSpot,
    assertIntention?: () => void,
  ) => {
    if (!article || !user) throw staleTradeOperation();
    const operation = operationContext.start('offer');
    if (!operation) throw Object.assign(new Error('Une proposition est déjà en cours.'), { code: 'client/operation-pending' });



    const assertCurrent = () => { operationContext.assertCurrent(operation); assertIntention?.(); };
    const listPrice = article.price;
    try {
      assertCurrent();
      const intendedSpot = JSON.parse(JSON.stringify(meetupSpot)) as MeetupSpot;
      if (await offerPreviousAttempt(user.id, chatIdForPair(user.id, article.sellerId, article.id), assertCurrent)) {
        throw Object.assign(new Error('La proposition précédente doit être vérifiée.'), { code: 'client/proposal-recovery-presented' });
      }
      assertCurrent();
      await assertNewProposalAdmission(user.id, 'buy', { chatId: chatIdForPair(user.id, article.sellerId, article.id), amount, location: intendedSpot, ...(message ? { message } : {}) }, assertCurrent);
      assertCurrent();
      if (user.id === article.sellerId) throw new Error('Vous ne pouvez pas faire une offre sur votre propre article.');
      const chat = await ChatService.createOrGetChat(user.id, article.sellerId, article.id);
      assertCurrent();
      track('chat_started', {
        chat_id: chat.id,
        source: 'article',
        article_id: article.id,
        other_user_id: article.sellerId,
        is_new_chat: !chat.lastMessage,
        outcome: 'success',
      });
      const messageId = await ChatService.sendMeetupOffer(
        chat.id,
        user.id,
        article.sellerId,
        amount,
        intendedSpot,
        message,
        assertCurrent,
        { deferAdoption: true, beforeNewDispatch: () => assertNewSaleAdmission(user.id, 'buy', assertCurrent) },
      );
      assertCurrent();
      if (!messageId) throw new Error('La réception de cette proposition doit être vérifiée.');
      acknowledgeMeetupProposal(messageId, assertCurrent);
      track('offer_sent', {
        article_id: article.id,
        seller_id: article.sellerId,
        chat_id: chat.id,
        message_id: messageId,
        source: 'article',
        mode: 'meetup',
        offer_amount_cents: Math.round(amount * 100),
        list_price_cents: Math.round(listPrice * 100),
        discount_pct: listPrice ? Math.round(((listPrice - amount) / listPrice) * 100) : 0,
        has_message: message.trim().length > 0,
        spot_category: meetupSpot.category,
        neighborhood_id: meetupSpot.neighborhood?.id,
      });
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      if (__DEV__) console.error('Error submitting meetup offer:', error);
      try { assertCurrent(); } catch { throw staleTradeOperation(); }
      track('offer_send_failed', {
        article_id: article.id,
        source: 'article',
        mode: 'meetup',
        offer_amount_cents: Math.round(amount * 100),
        failure_type: 'server_error',
      });
      throw error;
    } finally { operationContext.finish(operation); }
  }, [article, user, router, operationContext, offerPreviousAttempt]);

  const handleShippingOfferSubmit = useCallback(async (
    amount: number,
    message: string,
    assertIntention?: () => void,
  ) => {
    if (!article || !user) throw staleTradeOperation();
    const operation = operationContext.start('offer');
    if (!operation) throw Object.assign(new Error('Une proposition est déjà en cours.'), { code: 'client/operation-pending' });



    const listPrice = article.price;
    const assertCurrent = () => { operationContext.assertCurrent(operation); assertIntention?.(); };
    try {
      assertCurrent();
      if (await offerPreviousAttempt(user.id, chatIdForPair(user.id, article.sellerId, article.id), assertCurrent)) {
        throw Object.assign(new Error('La proposition précédente doit être vérifiée.'), { code: 'client/proposal-recovery-presented' });
      }
      assertCurrent();
      if (user.id === article.sellerId) throw new Error('Vous ne pouvez pas faire une offre sur votre propre article.');
      const chat = await ChatService.createOrGetChat(user.id, article.sellerId, article.id);
      assertCurrent();
      track('chat_started', {
        chat_id: chat.id,
        source: 'article',
        article_id: article.id,
        other_user_id: article.sellerId,
        is_new_chat: !chat.lastMessage,
        outcome: 'success',
      });
      const messageId = await ChatService.sendOffer(
        chat.id,
        user.id,
        article.sellerId,
        amount,
        message,
        undefined,
        undefined,
        assertCurrent,
        { deferAdoption: true, beforeNewDispatch: () => assertNewSaleAdmission(user.id, 'buy', assertCurrent) },
      );
      assertCurrent();
      if (!messageId) throw new Error('La réception de cette proposition doit être vérifiée.');
      acknowledgeMeetupProposal(messageId, assertCurrent);
      track('offer_sent', {
        article_id: article.id,
        seller_id: article.sellerId,
        chat_id: chat.id,
        message_id: messageId,
        source: 'article',
        mode: 'shipping',
        offer_amount_cents: Math.round(amount * 100),
        list_price_cents: Math.round(listPrice * 100),
        discount_pct: listPrice ? Math.round(((listPrice - amount) / listPrice) * 100) : 0,
        has_message: message.trim().length > 0,
      });
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      if (__DEV__) console.error('Error submitting shipping offer:', error);
      if (!operationContext.isCurrent(operation)) throw staleTradeOperation();
      track('offer_send_failed', {
        article_id: article.id,
        source: 'article',
        mode: 'shipping',
        offer_amount_cents: Math.round(amount * 100),
        failure_type: 'server_error',
      });
      throw error;
    } finally { operationContext.finish(operation); }
  }, [article, user, router, operationContext, offerPreviousAttempt]);

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
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  const handleDeleteArticle = useCallback(() => {
    if (!article) return;

    // Same copy as « Mes articles ». The former text claimed transactions in
    // progress would be « affected » — the server refuses to touch them.
    let operation;
    try { operation = operationContext.capture(); } catch { return; }
    const confirm = removeArticleAlert(article.title);
    Alert.alert(
      confirm.title,
      confirm.message,
      [
        { text: CANCEL_LABEL, style: 'cancel' },
        {
          text: confirm.confirmLabel,
          style: 'destructive',
          onPress: async () => {
            if (!operationContext.isCurrent(operation)) return;
            const deletion = operationContext.start('toggle');
            if (!deletion) return;
            try {
              operationContext.assertCurrent(operation);
              await ArticlesService.deleteArticle(article.id);
              operationContext.assertCurrent(operation);
              await removeWithdrawnArticleFromCache(queryClient, article.id, operation.session.uid,
                () => operationContext.assertCurrent(operation));
              operationContext.assertCurrent(operation);
              track('article_deleted', {
                article_id: article.id,
                is_sold: article.isSold,
                outcome: 'success',
                source: 'article_detail',
                entry: 'menu',
                price_cents: Math.round(article.price * 100),
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.back();
            } catch (error) {
              if (!operationContext.isCurrent(operation)) return;
              if (__DEV__) console.error('Erreur suppression:', error);
              track('article_deleted', {
                article_id: article.id,
                is_sold: article.isSold,
                outcome: 'error',
                source: 'article_detail',
                entry: 'menu',
                price_cents: Math.round(article.price * 100),
              });
              Alert.alert(
                'Erreur',
                error instanceof Error ? error.message : 'Impossible de retirer l\'article'
              );
            } finally { operationContext.finish(deletion); }
          },
        },
      ]
    );
  }, [article, router, queryClient, operationContext]);

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
    let operation: TradeOperation | null;
    try { assertArticleCurrent(); operation = operationContext.start('toggle'); } catch { return; }
    if (!operation) return;
    let application: Article | null = null;
    let cancelled = false; let used = false;
    const cancel = () => { if (!used) { cancelled = true; operationContext.finish(operation!); } };
    pendingConfirmation.current = { article, cancel };
    const assertCurrent = () => {
      if (cancelled) throw staleTradeOperation();
      operationContext.assertCurrent(operation!);
      if (application) {
        if (source.current.article !== application || (isArticleCurrent && !isArticleCurrent(application))) throw staleTradeOperation();
      } else assertArticleCurrent();
    };
    const apply = (result: Awaited<ReturnType<typeof toggleArticleSoldSafely>>) => {
      assertCurrent();
      const displayed = { result, operation: operation!, applied: result.article as Article | null };
      displayedToggle.current = displayed;
      if (applyArticleReceipt) {
        displayed.applied = applyArticleReceipt(result.article, article, () => operationContext.assertCurrent(operation!));
        if (!displayed.applied) { if (displayedToggle.current === displayed) displayedToggle.current = null; return; }
      } else {
        setArticle(prev => prev === article && operationContext.isCurrent(operation!) ? result.article : prev);
      }
      application = displayed.applied;
      setApplicationRevision(value => value + 1);
    };
    const fail = (error: unknown) => {
      try { assertCurrent(); } catch { return; }
      if (showAdmissionError(error, {isCurrent: () => {try {assertCurrent(); return true;} catch {return false;}}, publication: {uid: operation!.session.uid}})) return;
      const message = error instanceof Error ? error.message : 'Impossible de mettre à jour l’article';
      Alert.alert('Erreur', isDefinitiveTradeRefusal(error) ? message : `${message} L’état doit être vérifié avant une nouvelle modification.`);
    };
    const execute = async (intent: ArticleSoldIntent) => {
      if (used || cancelled) return;
      used = true; pendingConfirmation.current = null;
      try { assertCurrent(); apply(await toggleArticleSoldSafely(article.id, operation!.session.uid, assertCurrent, intent)); }
      catch (error) { fail(error); }
      finally { operationContext.finish(operation!); }
    };
    try {
      const prepared = await prepareArticleSoldChange(article.id, operation.session.uid, !!article.isSold, assertCurrent);
      assertCurrent();
      if (prepared.result) { pendingConfirmation.current = null; apply(prepared.result); operationContext.finish(operation); return; }
      if (prepared.intent.payload.desiredIsSold === false) { await execute(prepared.intent); return; }
      Alert.alert(MARK_AS_SOLD_ALERT.title, MARK_AS_SOLD_ALERT.message, [
        { text: CANCEL_LABEL, style: 'cancel', onPress: cancel },
        { text: MARK_AS_SOLD_ALERT.confirmLabel, onPress: () => { void execute(prepared.intent); } },
      ], { onDismiss: cancel });
    } catch (error) { pendingConfirmation.current = null; fail(error); operationContext.finish(operation); }
  }, [article, articleEpoch, setArticle, applyArticleReceipt, isArticleCurrent, operationContext, showAdmissionError, assertArticleCurrent]);

  const handleMoreOptions = useCallback(() => {
    if (!article) return;
    try { assertArticleCurrent(); } catch { return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const isOwner = user && user.id === article.sellerId;

    if (isOwner) {
      let operation;
      try { operation = operationContext.capture(); } catch { return; }
      const run = (action: OwnerArticleAction | null) => {
        try { operationContext.assertCurrent(operation); assertArticleCurrent(); } catch { return; }
        if (action === 'edit') handleEditArticle();
        else if (action === 'shipping') router.push({ pathname: '/article/shipping/[id]', params: { id: article.id } });
        else if (action === 'toggle_sold') handleMarkAsSold();
        else if (action === 'delete') handleDeleteArticle();
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
    } else {
      const options = ['Signaler cet article', 'Annuler'];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, destructiveButtonIndex: 0, cancelButtonIndex: 1 },
          (buttonIndex) => {
            if (buttonIndex === 0) {
              requireAuth(
                () => reportBottomSheetRef.current?.open('article', article.id, 'article_detail', article.sellerId, article),
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
                () => reportBottomSheetRef.current?.open('article', article.id, 'article_detail', article.sellerId, article),
                'Connectez-vous pour signaler cet article'
              );
            },
          },
          { text: 'Annuler', style: 'cancel' },
        ]);
      }
    }
  }, [article, user, requireAuth, handleEditArticle, handleMarkAsSold, handleDeleteArticle, reportBottomSheetRef, articleEpoch, isArticleCurrent, operationContext, assertArticleCurrent, router]);

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
