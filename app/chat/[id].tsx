import { useMeetupProposalRecovery } from '@/hooks/useMeetupProposalRecovery';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import { assertNewSaleAdmission, assertNewProposalAdmission } from '@/services/newSaleAdmission';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { acknowledgeMeetupProposal } from '@/services/chat/offers';
import { useTradeOperation } from '@/hooks/useTradeOperation';
import { staleTradeOperation, captureTradeSession } from '@/services/tradeOperation';
import { type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
    Alert,
    StyleSheet,
    Text,
    Pressable,
    View,
} from 'react-native';
import Animated, {
    useAnimatedKeyboard,
    useAnimatedStyle,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Import components
import MakeOfferModal, { type MakeOfferModalRef } from '@/features/offers/components/MakeOfferModal';
import OfferBubble from '@/features/offers/components/OfferBubble';
import { OfferProgressMessage } from '@/features/offers';
import { ConversationProgressNotice } from '@/components/ConversationProgressNotice';
import ReportBottomSheet, { type ReportBottomSheetRef } from '@/components/ReportBottomSheet';
import { ChatTransactionHistory, OrderArticleSummary } from '@/features/orders';
import { useChatTransactions } from '@/hooks/useChatTransactions';
import { SkeletonText } from '@/components/ui/Skeleton';

// Feature components & hooks
import {
  ChatArticleBar,
  ChatBubble,
  ChatEmptyState,
  ChatErrorState,
  ChatHeader,
  ChatInputBar,
  ChatLoadingSkeleton,
  ConversationOrderProgress,
  useChatModeration,
} from '@/features/chat';

// Import hooks and contexts
import { useShallow } from 'zustand/react/shallow';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useChat } from '@/features/chat/hooks/useChat';
import { useChatOfferActions } from '@/features/chat/hooks/useChatOfferActions';
import { withOfferBlockGuard } from '@/features/offers/utils/blockGuard';
import { setActiveChatId } from '@/features/notifications/hooks/useNotificationSetup';
import { useUserProfile } from '@/hooks/useUserProfile';

// Import services
import { ArticlesService } from '@/services/articlesService';
import { ChatService } from '@/services/chatService';
import { getTransactionArticlePresentation } from '@/utils/transactionArticlePresentation';
import { conversationTimeline, type ConversationTimelineEntry } from '@/utils/conversationTimeline';
import { ShippingParcelService } from '@/services/shippingParcelService';
import { SellerShippingAddressService } from '@/services/sellerShippingAddressService';
import { StripeAccountService } from '@/features/wallet/services/stripeAccountService';
import { hasCurrentOrdinaryShippingDeclaration, ordinaryPhysicalAddress } from '@/utils/ordinaryShippingAddress';
import { ModerationService } from '@/services/moderationService';

// Import query keys
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';

// Import types
import { MeetupSpot } from '@/types';
import { colors, fonts, spacing } from '@/constants/theme';
import { SHIPPING_ENABLED } from '@/config/featureFlags';

// Module-level so the FlashList prop identity stays stable across renders.
const messageKeyExtractor = (item: ConversationTimelineEntry): string => item.key;
const messageItemType = (item: ConversationTimelineEntry): string => item.kind;

export default function ChatScreen() {
  const router = useRouter();
  const [messageText, setMessageText] = useState('');

  const flatListRef = useRef<FlashListRef<ConversationTimelineEntry>>(null);
  const makeOfferModalRef = useRef<MakeOfferModalRef>(null);
  const reportBottomSheetRef = useRef<ReportBottomSheetRef>(null);

  const { id: chatId, transactionId: requestedTransactionId } = useLocalSearchParams<{ id: string; transactionId?: string }>();
  const {uid, normalUser, isAuthLoading} = useAuthStore(useShallow(state => ({uid: state.authenticatedUid, normalUser: state.user,
    isAuthLoading: state.isLoading})));
  const generation = getAuthSessionGeneration();
  const servicing = useShippingPurchaseContext(JSON.stringify(['chat-screen', chatId]), uid);
  const messageReportContext = useLabelLifecycleContext(JSON.stringify(['chat-message-report', chatId]), uid);
  const canStartAgreement = !!normalUser && normalUser.id === uid;
  const scope = JSON.stringify([uid, generation, chatId]);
  const [renderScope, setRenderScope] = useState(scope);
  if (renderScope !== scope) {setRenderScope(scope); setMessageText('');}
  const [imageState, setImageState] = useState({frame: servicing.frame, focusRevision: servicing.focusRevision, value: false});
  const sendingImage = imageState.frame === servicing.frame && imageState.focusRevision === servicing.focusRevision && imageState.value;
  const setSendingImage = (value: boolean) => setImageState({frame: servicing.frame, focusRevision: servicing.focusRevision, value});
  const showAdmissionError = useTradeAdmissionError();
  const offerPreviousAttempt = useMeetupProposalRecovery();
  const insets = useSafeAreaInsets();

  // Keyboard open → lift the list + input zone to sit spacing.sm (8) above the
  // keyboard; closed → fall back to the bottom safe-area inset. keyboard.height
  // is bottom-anchored and follows the native curve, so the input tracks the
  // keyboard without a jump. The SafeAreaView drops its 'bottom' edge below so
  // this padding owns the bottom spacing (no double inset).
  const keyboard = useAnimatedKeyboard();
  const contentAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboard.height.value > 0 ? keyboard.height.value + spacing.sm : insets.bottom,
  }));

  // ─── ALL hooks MUST be called before any conditional return ───

  const {
    messages,
    chat,
    isLoading,
    error,
    isSending,
    sendMessage,
    sendImage,
    acceptOffer,
    rejectOffer,
    retry,
  } = useChat(chatId || null, uid);

  // ─── Article linked to this chat ───
  const { data: article = null } = useQuery({
    queryKey: queryKeys.chat.article(chat?.articleId ?? ''),
    queryFn: () => ArticlesService.getArticleById(chat!.articleId!),
    enabled: !!chat?.articleId,
    staleTime: 2 * 60 * 1000,
  });

  const proposalContext = useTradeOperation(JSON.stringify([chatId, chat?.id, chat?.articleId, article?.id, chat?.sellerId]), uid);

  // ─── Transaction linked to this chat ───
  const transactionState = useChatTransactions(chatId ?? '', uid ?? '', requestedTransactionId);
  const {transaction, refresh: refetchTransaction} = transactionState;
  const canCommunicate = !!uid && !!chat && chat.id === chatId && chat.participants.includes(uid) && !error;
  const timeline = conversationTimeline(messages, transactionState.transactions, chatId ?? '', uid ?? '');
  const handleShippingOfferAccepted = useCallback(async (messageId: string) => {
    if (!uid || !chatId || !chat?.articleId || !chat.sellerId) return;
    let operation: ReturnType<typeof servicing.capture>;
    try {operation = servicing.capture();} catch {return;}
    const current = () => servicing.assertCurrent(operation);
    if (uid !== chat.sellerId) {
      current();
      router.push({pathname: '/checkout/shipping', params: {articleId: chat.articleId, chatId, offerMessageId: messageId}});
      return;
    }
    // This is orientation, not a payment permission. An already missing
    // prerequisite should open its screen immediately; that screen owns the
    // fresh private qualification instead of hiding navigation behind RPCs.
    if (normalUser?.id === uid && !normalUser.stripeAccountId) {
      current();
      router.push({pathname: '/article/shipping/[id]', params: {id: chat.articleId, returnChatId: chatId}});
      return;
    }
    let ready = false;
    try {
      const [parcel, address, account] = await Promise.all([
        ShippingParcelService.read(uid, chat.articleId, current), SellerShippingAddressService.read(uid, current),
        StripeAccountService.getAccountStatus(uid, current),
      ]); current();
      const physical = ordinaryPhysicalAddress(address.selected);
      const originReady = !!physical && physical.province === 'QC' && typeof address.selected?.name === 'string' &&
        !!address.selected.name.trim() && await hasCurrentOrdinaryShippingDeclaration(address.selected);
      current(); ready = parcel.status === 'declared' && !!parcel.parcel && originReady && account.hasAccount === true && account.chargesEnabled === true;
    } catch {try {current();} catch {return;} /* Preparation exposes its actual missing fields or read error. */}
    current();
    if (!ready) router.push({pathname: '/article/shipping/[id]', params: {id: chat.articleId, returnChatId: chatId}});
  }, [uid, chatId, chat?.articleId, chat?.sellerId, normalUser?.id, normalUser?.stripeAccountId, servicing, router]);

  // Signale au rail de notification quelle conversation est à l'écran.
  // `setActiveChatId` était exporté mais n'était appelé par AUCUN écran : la
  // suppression de bannière prévue pour la conversation ouverte ne s'appliquait
  // donc jamais. Chaque message reçu pendant qu'on lit ce fil déclenchait une
  // bannière et un son par-dessus la conversation où il vient d'apparaître.
  // `useFocusEffect` et non `useEffect` : l'écran reste monté sous une pile de
  // navigation, il ne doit être « actif » que tant qu'il est au premier plan.
  useFocusEffect(
    useCallback(() => {
      if (!chatId) return;
      setActiveChatId(chatId);
      return () => setActiveChatId(null);
    }, [chatId]),
  );

  // ─── Blocked users (same key as messages.tsx so the cache is shared) ───
  const { data: blockedUsers = [] } = useQuery({
    queryKey: ['blockedUsers', uid],
    queryFn: () => ModerationService.getBlockedUsers(uid!),
    enabled: !!uid,
    staleTime: 10 * 60 * 1000,
  });

  // Scroll-to-end is driven solely by the FlashList's onContentSizeChange
  // (fires on initial layout + whenever a new message grows the content),
  // avoiding the double-scroll race with a separate length-watching effect.

  // ─── Other participant info ───
  const otherParticipant = chat && uid
    ? chat.participantsInfo?.find(p => p.userId !== uid) ?? null
    : null;

  const { data: otherProfile } = useUserProfile(otherParticipant?.userId);
  const otherAvatar = otherProfile?.profileImage || otherParticipant?.profileImage || otherParticipant?.userImage;

  // ─── Block guard: refuse sending when the counterpart is blocked ───
  // Consistent with messages.tsx (flags blocked conversations) and the
  // server-side rules. The thread stays readable; only sending is disabled.
  const isOtherBlocked = otherParticipant
    ? blockedUsers.some((b) => b.blockedUserId === otherParticipant.userId)
    : false;

  // ─── Handlers ───

  const userId = uid ?? undefined;
  const chatArticleId = chat?.articleId;
  const chatSellerId = chat?.sellerId;

  const handleSendMessage = useCallback(async () => {
    if (!messageText.trim() || !uid || !canCommunicate) return;
    let operation: ReturnType<typeof servicing.capture>;
    try {operation = servicing.capture();} catch {return;}
    if (isOtherBlocked) {
      track('blocked_action_attempted', { chat_id: chatId ?? '', attempted_action: 'message' });
      Alert.alert('Utilisateur bloqué', 'Débloquez cet utilisateur pour lui envoyer un message.');
      return;
    }
    const trimmed = messageText.trim();
    // Clear the input immediately: the optimistic bubble already echoes the
    // text, so the field should feel instantly responsive.
    setMessageText('');
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await sendMessage(trimmed, () => servicing.assertCurrent(operation));
      servicing.assertCurrent(operation);
      track('message_sent', {
        chat_id: chatId ?? '',
        message_type: 'text',
        message_length: trimmed.length,
        has_article: !!chatArticleId,
        is_seller: uid === chatSellerId,
        outcome: 'success',
      });
    } catch (err: unknown) {
      if (!servicing.isCurrent(operation)) return;
      if (__DEV__) console.error('Error sending message:', err);
      track('message_sent', {
        chat_id: chatId ?? '',
        message_type: 'text',
        message_length: trimmed.length,
        has_article: !!chatArticleId,
        is_seller: uid === chatSellerId,
        outcome: 'error',
      });
      const msg = err instanceof Error ? err.message : '';
      Alert.alert('Erreur', msg.includes('Impossible') ? msg : "Impossible d'envoyer le message");
    }
  }, [messageText, uid, canCommunicate, sendMessage, isOtherBlocked, chatId, chatArticleId, chatSellerId, servicing.frame, servicing.focusRevision]);

  const handlePickImage = useCallback(async () => {
    if (!canCommunicate || !uid) return;
    let operation: ReturnType<typeof servicing.capture>;
    try {operation = servicing.capture();} catch {return;}
    if (isOtherBlocked) {
      track('blocked_action_attempted', { chat_id: chatId ?? '', attempted_action: 'image' });
      Alert.alert('Utilisateur bloqué', 'Débloquez cet utilisateur pour lui envoyer une image.');
      return;
    }
    try {
      const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      servicing.assertCurrent(operation);
      if (status !== 'granted') {
        track('permission_denied', {
          permission: 'photos',
          context: 'chat_image',
          can_ask_again: canAskAgain,
          action_taken: 'cancel',
        });
        Alert.alert('Permission requise', 'Nous avons besoin de votre permission pour accéder à la galerie');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        exif: false,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      servicing.assertCurrent(operation);
      if (!result.canceled && result.assets[0]) {
        setSendingImage(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await sendImage(result.assets[0].uri, () => servicing.assertCurrent(operation));
        servicing.assertCurrent(operation);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        track('message_sent', {
          chat_id: chatId ?? '',
          message_type: 'image',
          has_article: !!chatArticleId,
          is_seller: userId === chatSellerId,
          outcome: 'success',
        });
      }
    } catch (err: unknown) {
      if (!servicing.isCurrent(operation)) return;
      if (__DEV__) console.error('Error picking image:', err);
      track('message_sent', {
        chat_id: chatId ?? '',
        message_type: 'image',
        has_article: !!chatArticleId,
        is_seller: userId === chatSellerId,
        outcome: 'error',
      });
      const msg = err instanceof Error ? err.message : '';
      Alert.alert('Erreur', msg.includes('Impossible') ? msg : "Impossible d'envoyer l'image");
    } finally {
      if (servicing.isCurrent(operation)) setSendingImage(false);
    }
  }, [sendImage, isOtherBlocked, chatId, chatArticleId, chatSellerId, userId, uid, canCommunicate, servicing.frame, servicing.focusRevision]);

  const handleMakeOffer = useCallback(async function openOffer() {
    if (!canStartAgreement) { router.push('/complete-profile'); return; }
    const currentPrice = article?.price ?? chat?.articlePrice;
    const defaultMode =
      SHIPPING_ENABLED && article?.isShipping && !article?.isHandDelivery ? 'shipping' : 'meetup';
    const emitOfferModal = (
      blocked_reason:
        | 'none'
        | 'user_blocked'
        | 'no_price'
        | 'sold'
        | 'inactive'
        | 'pending_offer_exists',
    ) => {
      track('offer_modal_opened', {
        source: 'chat',
        article_id: chat?.articleId ?? '',
        price_cents: currentPrice ? Math.round(currentPrice * 100) : 0,
        default_mode: defaultMode,
        blocked_reason,
      });
    };

    if (isOtherBlocked) {
      track('blocked_action_attempted', { chat_id: chatId ?? '', attempted_action: 'offer' });
      emitOfferModal('user_blocked');
      Alert.alert('Utilisateur bloqué', 'Débloquez cet utilisateur pour faire une offre.');
      return;
    }
    if (!currentPrice) {
      emitOfferModal('no_price');
      Alert.alert('Erreur', 'Aucun article associe a cette conversation');
      return;
    }

    // H1: Block offers on sold or inactive articles
    if (article?.isSold) {
      emitOfferModal('sold');
      Alert.alert('Article vendu', 'Cet article n\'est plus disponible.');
      return;
    }
    if (article?.isActive === false) {
      emitOfferModal('inactive');
      Alert.alert('Article indisponible', 'Cet article n\'est plus disponible.');
      return;
    }

    let operation;
    try {
      operation = proposalContext.start('open-offer');
      if (!operation) return;
      if (chatId && await offerPreviousAttempt(operation.session.uid, chatId, () => proposalContext.assertCurrent(operation!))) return;
      await assertNewSaleAdmission(operation.session.uid, operation.session.uid === chat?.sellerId ? 'sell' : 'buy', () => proposalContext.assertCurrent(operation!));
      proposalContext.assertCurrent(operation);
      emitOfferModal('none');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      makeOfferModalRef.current?.present();
    } catch (error) {
      if (operation && proposalContext.isCurrent(operation)) showAdmissionError(error, { isCurrent: () => proposalContext.isCurrent(operation!), retry: () => { void openOffer(); } });
    } finally { if (operation) proposalContext.finish(operation); }
  }, [article?.price, article?.isSold, article?.isActive, article?.isShipping, article?.isHandDelivery, chat?.articlePrice, chat?.articleId, chatId, messages, uid, isOtherBlocked, canStartAgreement, router]);

  const handleMeetupOfferSubmit = useCallback(async (
    amount: number,
    message: string,
    meetupSpot: MeetupSpot,
    assertIntention?: () => void,
  ) => {
    if (!chatId || !uid || !chat || !canStartAgreement) throw staleTradeOperation();
    const operation = proposalContext.start('meetup-offer');
    if (!operation) throw Object.assign(new Error('Une proposition est déjà en cours.'), { code: 'client/operation-pending' });
    const assertCurrent = () => { proposalContext.assertCurrent(operation); assertIntention?.(); };
    const sellerId = chat.participantsInfo.find(p => p.userId !== uid)?.userId || '';
    const listPrice = article?.price ?? chat.articlePrice ?? 0;
    try {
      assertCurrent();
      await assertNewProposalAdmission(uid, uid === chat.sellerId ? 'sell' : 'buy', { chatId, amount, location: meetupSpot, ...(message ? { message } : {}) }, assertCurrent);
      assertCurrent();
      const intendedSpot = JSON.parse(JSON.stringify(meetupSpot)) as MeetupSpot;
      const messageId = await ChatService.sendMeetupOffer(
        chatId,
        uid,
        sellerId,
        amount,
        intendedSpot,
        message,
        assertCurrent,
        { deferAdoption: true, beforeNewDispatch: () => assertNewSaleAdmission(uid, uid === chat.sellerId ? 'sell' : 'buy', assertCurrent) },
      );
      assertCurrent();
      if (!messageId) throw new Error('La réception de la proposition doit être vérifiée.');
      acknowledgeMeetupProposal(messageId, assertCurrent);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      track('offer_sent', {
        article_id: chat.articleId ?? '',
        seller_id: sellerId,
        chat_id: chatId,
        message_id: messageId,
        source: 'chat',
        mode: 'meetup',
        offer_amount_cents: Math.round(amount * 100),
        list_price_cents: Math.round(listPrice * 100),
        discount_pct: listPrice ? Math.round(((listPrice - amount) / listPrice) * 100) : 0,
        has_message: message.trim().length > 0,
        spot_category: meetupSpot.category,
        neighborhood_id: meetupSpot.neighborhood?.id,
      });
    } catch (err: unknown) {
      try { assertCurrent(); } catch { throw staleTradeOperation(); }
      if (__DEV__) console.error('Error sending meetup offer:', err);
      track('offer_send_failed', {
        article_id: chat.articleId ?? '',
        source: 'chat',
        mode: 'meetup',
        offer_amount_cents: Math.round(amount * 100),
        failure_type: 'server_error',
      });
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Impossible')) {
        Alert.alert('Erreur', msg);
      }
      throw err;
    } finally { proposalContext.finish(operation); }
  }, [chatId, uid, chat, article?.price, proposalContext, canStartAgreement]);

  const handleShippingOfferSubmit = useCallback(async (
    amount: number,
    message: string,
    assertIntention?: () => void,
  ) => {
    if (!chatId || !uid || !chat || !canStartAgreement) throw staleTradeOperation();
    const operation = proposalContext.capture();
    const assertCurrent = () => {proposalContext.assertCurrent(operation); assertIntention?.();};
    const sellerId = chat.participantsInfo.find(p => p.userId !== uid)?.userId || '';
    const listPrice = article?.price ?? chat.articlePrice ?? 0;
    try {
      const messageId = await ChatService.sendOffer(
        chatId,
        uid,
        sellerId,
        amount,
        message,
        undefined,
        undefined,
        assertCurrent,
        {deferAdoption: true, beforeNewDispatch: () => assertNewSaleAdmission(uid, uid === chat.sellerId ? 'sell' : 'buy', assertCurrent)},
      );
      assertCurrent();
      if (!messageId) throw new Error('La réception de cette proposition doit être vérifiée.');
      acknowledgeMeetupProposal(messageId, assertCurrent);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      track('offer_sent', {
        article_id: chat.articleId ?? '',
        seller_id: sellerId,
        chat_id: chatId,
        message_id: messageId,
        source: 'chat',
        mode: 'shipping',
        offer_amount_cents: Math.round(amount * 100),
        list_price_cents: Math.round(listPrice * 100),
        discount_pct: listPrice ? Math.round(((listPrice - amount) / listPrice) * 100) : 0,
        has_message: message.trim().length > 0,
      });
    } catch (err: unknown) {
      if (__DEV__) console.error('Error sending shipping offer:', err);
      track('offer_send_failed', {
        article_id: chat.articleId ?? '',
        source: 'chat',
        mode: 'shipping',
        offer_amount_cents: Math.round(amount * 100),
        failure_type: 'server_error',
      });
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Impossible')) {
        Alert.alert('Erreur', msg);
      }
      throw err;
    }
  }, [chatId, uid, chat, article?.price, canStartAgreement]);

  // Les neuf actions d'offre et de rencontre vivent dans leur propre hook. Elles
  // ont toutes la même forme — déléguer à `ChatService` et PROPAGER l'erreur,
  // sans quoi le `catch` soigné de la bulle est neutralisé.
  const {
    handleAcceptOffer,
    handleRejectOffer,
    handleCounterPrice,
    handleCounterLocation,
    handleCounterTime,
    handleConfirmMeetup,
    handleReportNoShow,
    handleCancelMeetup,
    handleCompleteMeetup,
  } = useChatOfferActions({
    chatId,
    userId: uid ?? undefined,
    otherParticipantId: otherParticipant?.userId,
    sellerId: chat?.sellerId,
    acceptOffer,
    rejectOffer,
  });


  const openMessageReport = useCallback((messageId: string | null) => {
    try {messageReportContext.capture();} catch {return;}
    if (!uid || !chatId) return;
    // Own durable receipts remain serviceable when the conversation source or
    // ordinary profile is unavailable. A NEW message still needs its source.
    if (messageId === null) {reportBottomSheetRef.current?.openMessage({chatId, messageId: null, transactionId: null}); return;}
    if (!chat || chat.id !== chatId || !chat.participants.includes(uid)) return;
    const linkedOrder = !transactionState.isFetching && !transactionState.error && transaction?.chatId === chatId &&
      [transaction.buyerId, transaction.sellerId].includes(uid) ? transaction.id : null;
    reportBottomSheetRef.current?.openMessage({chatId, messageId, transactionId: linkedOrder});
  }, [uid, chatId, chat, transaction, transactionState.isFetching, transactionState.error, messageReportContext]);
  const { handleMoreOptions } = useChatModeration({
    otherParticipant,
    currentUserId: uid ?? undefined,
    reportSheetRef: reportBottomSheetRef,
    onResumeMessageReport: () => openMessageReport(null),
  });

  // ─── Render message item ───
  const refuseNewAgreement = useCallback(async () => {
    if (uid) captureTradeSession(uid);
    throw new Error('Complétez votre profil pour faire ou accepter une offre.');
  }, [uid]);
  const renderMessage = useCallback(
    ({ item }: ListRenderItemInfo<ConversationTimelineEntry>) => {
      if (item.kind === 'notice') return <ConversationProgressNotice title={item.title} at={item.at}/>;
      if (item.kind === 'order-current') return item.order.id === transaction?.id
        ? <ConversationOrderProgress order={item.order} uid={uid ?? ''} chatId={chatId ?? ''}/> : null;
      const message = item.message;
      const isOwnMessage = message.senderId === uid;

      if (item.kind === 'offer-actions') return <OfferProgressMessage message={message} isOwnMessage={isOwnMessage}
        chatId={chatId ?? ''} currentUserId={uid ?? ''} sellerId={chat?.sellerId} articleId={chat?.articleId}
        {...withOfferBlockGuard({onRejectOffer: handleRejectOffer, onConfirmMeetup: handleConfirmMeetup,
          onReportNoShow: handleReportNoShow, onCompleteMeetup: handleCompleteMeetup, onCancelMeetup: handleCancelMeetup}, isOtherBlocked)}/>;

      if (message.type === 'offer' && message.offer) {
        return (
          <Pressable
            accessible={false}
            onLongPress={!isOwnMessage && message.status !== 'sending' ? () => openMessageReport(message.id) : undefined}
          ><OfferBubble
            message={message}
            isOwnMessage={isOwnMessage}
            chatId={chatId || ''}
            currentUserId={uid ?? ''}
            sellerId={chat?.sellerId}
            articleId={chat?.articleId}
            articlePrice={article?.price ?? chat?.articlePrice}
            otherAvatar={otherAvatar}
            onShippingOfferAccepted={handleShippingOfferAccepted}
            {...withOfferBlockGuard(
              {
                onAcceptOffer: canStartAgreement ? handleAcceptOffer : refuseNewAgreement,
                onRejectOffer: handleRejectOffer,
                onCounterPrice: canStartAgreement ? handleCounterPrice : refuseNewAgreement,
                onCounterLocation: canStartAgreement ? handleCounterLocation : refuseNewAgreement,
                onCounterTime: canStartAgreement ? handleCounterTime : refuseNewAgreement,
                onConfirmMeetup: handleConfirmMeetup,
                onReportNoShow: handleReportNoShow,
                onCompleteMeetup: handleCompleteMeetup,
                onCancelMeetup: handleCancelMeetup,
              },
              isOtherBlocked,
            )}
          /></Pressable>
        );
      }

      return (
        <ChatBubble
          message={message}
          isOwnMessage={isOwnMessage}
          senderImage={!isOwnMessage ? otherAvatar : undefined}
          onReport={!isOwnMessage && ['text', 'image'].includes(message.type) && message.status !== 'sending' ? () => openMessageReport(message.id) : undefined}
        />
      );
    },
    [uid, chatId, transaction?.id, handleAcceptOffer, handleRejectOffer, handleCounterPrice, handleCounterLocation, handleCounterTime, handleConfirmMeetup, handleReportNoShow, handleCompleteMeetup, handleCancelMeetup, isOtherBlocked, otherAvatar, article?.price, chat?.articlePrice, chat?.sellerId, chat?.articleId, canStartAgreement, refuseNewAgreement, openMessageReport, handleShippingOfferAccepted],
  );

  // ─── Auth gate: redirect guests AFTER all hooks have been called ───
  if (!uid && isAuthLoading) return <SafeAreaView style={styles.container}><ChatLoadingSkeleton /></SafeAreaView>;
  if (!uid) {
    return <Redirect href="/(tabs)/profile" />;
  }

  // ─── Loading state ───
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ChatLoadingSkeleton />
        <ReportBottomSheet ref={reportBottomSheetRef} />
      </SafeAreaView>
    );
  }

  // ─── Error state ───
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <ChatErrorState
          errorMessage={error}
          onRetry={() => {
            track('error_retry_tapped', { screen: 'chat', error_context: 'chat_load' });
            retry();
          }}
        />
        <Pressable accessibilityRole="button" style={styles.transactionRetry} onPress={() => openMessageReport(null)}><Text style={styles.transactionErrorText}>Mes signalements</Text></Pressable>
        <ReportBottomSheet ref={reportBottomSheetRef} />
      </SafeAreaView>
    );
  }

  return (
    // Top edge owned by ChatHeader (surfaceWarm) so the status-bar zone matches
    // the header colour instead of showing the body background. Bottom edge is
    // dropped here — the animated paddingBottom on styles.content owns it so the
    // input tracks the keyboard without a double safe-area inset.
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ChatHeader
        otherParticipant={otherParticipant}
        otherAvatar={otherAvatar}
        onMoreOptions={handleMoreOptions}
      />
      {transaction && uid && (transaction.buyerId === uid || transaction.sellerId === uid) ?
        <Pressable accessibilityRole="button" accessibilityLabel="Voir la commande" onPress={() => {
            try { servicing.capture(); } catch { return; }
            router.push({ pathname: '/orders/[id]', params: { id: transaction.id } });
          }}>
          <OrderArticleSummary terms={getTransactionArticlePresentation(transaction, article)} compact />
        </Pressable> : (article || chat?.articleId) && (
        <ChatArticleBar
          article={article}
          articleTitle={article?.title ?? chat?.articleTitle}
          articlePrice={article?.price}
          snapshotPrice={chat?.articlePrice}
          snapshotImage={chat?.articleImage}
        />
      )}

      <Animated.View style={[styles.content, contentAnimatedStyle]}>
        {/* Native documents are projected into distinct chronological entries.
            Full tracking and recourses stay in the linked order detail. */}
        {transactionState.isLoading && !transaction && <SkeletonText lines={2} />}
        {transactionState.error && <View style={styles.transactionError}>
          <Text style={styles.transactionErrorText}>Impossible de charger le suivi de la commande.</Text>
          <Pressable accessibilityRole="button" onPress={() => {void refetchTransaction();}} style={styles.transactionRetry}>
            <Text style={styles.transactionErrorText}>Réessayer</Text>
          </Pressable>
        </View>}
        {transactionState.transactions.length > 0 && <ChatTransactionHistory
          transactions={transactionState.transactions} selectedId={transaction?.id} userId={uid ?? ''}
          onSelect={transactionState.selectTransaction} hasMore={transactionState.hasMore}
          onLoadMore={() => {void transactionState.loadMore();}} isLoading={transactionState.isFetching}
        />}
        {timeline.length === 0 ? (
          <ChatEmptyState otherParticipantName={otherParticipant?.userName} />
        ) : (
          <FlashList
            ref={flatListRef}
            data={timeline}
            renderItem={renderMessage}
            keyExtractor={messageKeyExtractor}
            getItemType={messageItemType}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
          />
        )}

        {!canCommunicate ? <View style={styles.blockedBanner}>
          <Text style={styles.blockedBannerText}>Complétez votre profil pour envoyer des messages.</Text>
          <Pressable style={styles.transactionRetry} accessibilityRole="button" onPress={() => router.push('/complete-profile')}>
            <Text style={styles.transactionErrorText}>Compléter mon profil</Text>
          </Pressable>
        </View> : isOtherBlocked ? (
          <View style={styles.blockedBanner}>
            <Text style={styles.blockedBannerText}>
              Vous avez bloqué cet utilisateur. Débloquez-le pour reprendre la conversation.
            </Text>
          </View>
        ) : (
          <ChatInputBar
            messageText={messageText}
            onChangeText={setMessageText}
            onSend={handleSendMessage}
            onPickImage={handlePickImage}
            onMakeOffer={handleMakeOffer}
            isSendingImage={sendingImage}
            isSending={isSending}
            hasArticle={canStartAgreement && !!chat?.articleId && !!article && !article.isSold && article.isActive !== false}
          />
        )}
      </Animated.View>

      {canStartAgreement && (article?.price ?? chat?.articlePrice) && (
        <MakeOfferModal
          ref={makeOfferModalRef}
          articleId={chat?.articleId || ''}
          articleTitle={chat?.articleTitle || ''}
          articleImage={article?.images?.[0]?.url ?? chat?.articleImage}
          currentPrice={article?.price ?? chat?.articlePrice ?? 0}
          defaultMode={SHIPPING_ENABLED && article?.isShipping && !article?.isHandDelivery ? 'shipping' : 'meetup'}
          availableModes={article ? [
            ...(article.isHandDelivery !== false ? ['meetup' as const] : []),
            ...(SHIPPING_ENABLED && article.isShipping === true ? ['shipping' as const] : []),
          ] : undefined}
          sellerNeighborhood={article?.neighborhood}
          sellerPreferredSpots={article?.preferredMeetupSpots}
          onMeetupOfferSubmit={handleMeetupOfferSubmit}
          onShippingOfferSubmit={handleShippingOfferSubmit}
        />
      )}

      <ReportBottomSheet ref={reportBottomSheetRef} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  transactionError: {padding: spacing.md, gap: spacing.sm},
  transactionRetry: {paddingVertical: spacing.sm},
  transactionErrorText: {fontFamily: fonts.sans, color: colors.foreground},
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  messagesList: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  blockedBanner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  blockedBannerText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
  },
});
