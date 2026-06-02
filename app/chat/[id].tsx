import { type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Import components
import ChatBubble from '@/components/ChatBubble';
import MakeOfferModal, { type MakeOfferModalRef } from '@/components/MakeOfferModal';
import OfferBubble from '@/components/OfferBubble';
import ReportBottomSheet, { type ReportBottomSheetRef } from '@/components/ReportBottomSheet';
import ShipmentTracking from '@/components/ShipmentTracking';

// Feature components & hooks
import {
  ChatArticleBar,
  ChatEmptyState,
  ChatErrorState,
  ChatHeader,
  ChatInputBar,
  ChatLoadingSkeleton,
  useChatModeration,
} from '@/features/chat';

// Import hooks and contexts
import { useUser } from '@/contexts/AuthContext';
import { useChat } from '@/hooks/useChat';
import { useUserProfile } from '@/hooks/useUserProfile';

// Import services
import { ArticlesService } from '@/services/articlesService';
import { ChatService } from '@/services/chatService';
import { ModerationService } from '@/services/moderationService';
import { TransactionService } from '@/services/transactionService';

// Import query keys
import { queryKeys } from '@/lib/queryKeys';

// Import types
import { Message, MeetupSpot } from '@/types';
import { colors, spacing } from '@/constants/theme';
import { SHIPPING_ENABLED } from '@/config/featureFlags';

// Module-level so the FlashList prop identity stays stable across renders.
const messageKeyExtractor = (item: Message): string => item.id;

export default function ChatScreen() {
  const [messageText, setMessageText] = useState('');
  const [isSendingImage, setIsSendingImage] = useState(false);

  const flatListRef = useRef<FlashListRef<Message>>(null);
  const makeOfferModalRef = useRef<MakeOfferModalRef>(null);
  const reportBottomSheetRef = useRef<ReportBottomSheetRef>(null);

  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const user = useUser();

  // ─── ALL hooks MUST be called before any conditional return ───

  const {
    messages,
    chat,
    isLoading,
    error,
    sendMessage,
    sendImage,
    acceptOffer,
    rejectOffer,
  } = useChat(chatId || null, user?.id ?? null);

  // ─── Article linked to this chat ───
  const { data: article = null } = useQuery({
    queryKey: queryKeys.chat.article(chat?.articleId ?? ''),
    queryFn: () => ArticlesService.getArticleById(chat!.articleId!),
    enabled: !!chat?.articleId,
    staleTime: 2 * 60 * 1000,
  });

  // ─── Transaction linked to this chat ───
  const { data: transaction = null, refetch: refetchTransaction } = useQuery({
    queryKey: queryKeys.chat.transaction(chatId ?? ''),
    queryFn: () => TransactionService.getTransactionByChat(chatId!, user!.id),
    enabled: !!chatId && !!user,
    staleTime: 2 * 60 * 1000,
  });

  // ─── Blocked users (same key as messages.tsx so the cache is shared) ───
  const { data: blockedUsers = [] } = useQuery({
    queryKey: ['blockedUsers', user?.id],
    queryFn: () => ModerationService.getBlockedUsers(user!.id),
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
  });

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0 && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  // ─── Other participant info ───
  const otherParticipant = chat && user
    ? chat.participantsInfo.find(p => p.userId !== user.id) ?? null
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

  const handleSendMessage = useCallback(async () => {
    if (!messageText.trim() || !user) return;
    if (isOtherBlocked) {
      Alert.alert('Utilisateur bloqué', 'Débloquez cet utilisateur pour lui envoyer un message.');
      return;
    }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await sendMessage(messageText.trim());
      setMessageText('');
    } catch (err: unknown) {
      if (__DEV__) console.error('Error sending message:', err);
      const msg = err instanceof Error ? err.message : '';
      Alert.alert('Erreur', msg.includes('Impossible') ? msg : "Impossible d'envoyer le message");
    }
  }, [messageText, user, sendMessage, isOtherBlocked]);

  const handlePickImage = useCallback(async () => {
    if (isOtherBlocked) {
      Alert.alert('Utilisateur bloqué', 'Débloquez cet utilisateur pour lui envoyer une image.');
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
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
      if (!result.canceled && result.assets[0]) {
        setIsSendingImage(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await sendImage(result.assets[0].uri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err: unknown) {
      if (__DEV__) console.error('Error picking image:', err);
      const msg = err instanceof Error ? err.message : '';
      Alert.alert('Erreur', msg.includes('Impossible') ? msg : "Impossible d'envoyer l'image");
    } finally {
      setIsSendingImage(false);
    }
  }, [sendImage, isOtherBlocked]);

  const handleMakeOffer = useCallback(() => {
    if (isOtherBlocked) {
      Alert.alert('Utilisateur bloqué', 'Débloquez cet utilisateur pour faire une offre.');
      return;
    }
    const currentPrice = article?.price ?? chat?.articlePrice;
    if (!currentPrice) {
      Alert.alert('Erreur', 'Aucun article associe a cette conversation');
      return;
    }

    // H1: Block offers on sold or inactive articles
    if (article?.isSold) {
      Alert.alert('Article vendu', 'Cet article n\'est plus disponible.');
      return;
    }
    if (article?.isActive === false) {
      Alert.alert('Article indisponible', 'Cet article n\'est plus disponible.');
      return;
    }

    // H4: Prevent multiple simultaneous offers
    const hasPendingOffer = messages.some(
      (msg) => msg.type === 'offer' && msg.offer?.status === 'pending' && msg.senderId === user?.id
    );
    if (hasPendingOffer) {
      Alert.alert('Offre en cours', 'Vous avez déjà une offre en attente pour cet article.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    makeOfferModalRef.current?.present();
  }, [article?.price, article?.isSold, article?.isActive, chat?.articlePrice, messages, user?.id, isOtherBlocked]);

  const handleMeetupOfferSubmit = useCallback(async (
    amount: number,
    message: string,
    meetupSpot: MeetupSpot,
  ) => {
    if (!chatId || !user || !chat) return;
    try {
      await ChatService.sendMeetupOffer(
        chatId,
        user.id,
        chat.participantsInfo.find(p => p.userId !== user.id)?.userId || '',
        amount,
        meetupSpot,
        message,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      if (__DEV__) console.error('Error sending meetup offer:', err);
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Impossible')) {
        Alert.alert('Erreur', msg);
      }
      throw err;
    }
  }, [chatId, user, chat]);

  const handleShippingOfferSubmit = useCallback(async (
    amount: number,
    message: string,
  ) => {
    if (!chatId || !user || !chat) return;
    try {
      await ChatService.sendOffer(
        chatId,
        user.id,
        chat.participantsInfo.find(p => p.userId !== user.id)?.userId || '',
        amount,
        message,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      if (__DEV__) console.error('Error sending shipping offer:', err);
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Impossible')) {
        Alert.alert('Erreur', msg);
      }
      throw err;
    }
  }, [chatId, user, chat]);

  const handleAcceptOffer = useCallback(async (messageId: string, offerId: string) => {
    try {
      await acceptOffer(messageId, offerId);
    } catch (err) {
      if (__DEV__) console.error('Error accepting offer:', err);
      throw err;
    }
  }, [acceptOffer]);

  const handleRejectOffer = useCallback(async (messageId: string, offerId: string) => {
    try {
      await rejectOffer(messageId, offerId);
    } catch (err) {
      if (__DEV__) console.error('Error rejecting offer:', err);
      throw err;
    }
  }, [rejectOffer]);

  // H3: Counter-offer, meetup confirmation, no-show, and complete meetup handlers
  const handleCounterPrice = useCallback(async (messageId: string, newAmount: number, message?: string) => {
    if (!user || !chatId || !otherParticipant) return;
    try {
      await ChatService.counterOfferPrice(chatId, messageId, user.id, otherParticipant.userId, newAmount, message);
    } catch (error) {
      if (__DEV__) console.error('[Chat] Counter offer error:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la contre-offre");
    }
  }, [chatId, user, otherParticipant]);

  const handleCounterLocation = useCallback(async (messageId: string, newLocation: MeetupSpot, message?: string) => {
    if (!user || !chatId || !otherParticipant) return;
    try {
      await ChatService.counterOfferLocation(chatId, messageId, user.id, otherParticipant.userId, newLocation, message);
    } catch (error) {
      if (__DEV__) console.error('[Chat] Counter location error:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la contre-offre de lieu");
    }
  }, [chatId, user, otherParticipant]);

  const handleCounterTime = useCallback(async (messageId: string, newDateTime: Date, message?: string) => {
    if (!user || !chatId || !otherParticipant) return;
    try {
      await ChatService.counterOfferTime(chatId, messageId, user.id, otherParticipant.userId, newDateTime, message);
    } catch (error) {
      if (__DEV__) console.error('[Chat] Counter time error:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la contre-offre d'horaire");
    }
  }, [chatId, user, otherParticipant]);

  const handleConfirmMeetup = useCallback(async (messageId: string) => {
    if (!user || !chatId) return;
    try {
      await ChatService.confirmMeetup(chatId, messageId, user.id);
    } catch (error) {
      if (__DEV__) console.error('[Chat] Confirm meetup error:', error);
      Alert.alert('Erreur', 'Impossible de confirmer le meetup');
    }
  }, [chatId, user]);

  const handleReportNoShow = useCallback(async (messageId: string, reason?: string, details?: string) => {
    if (!user || !chatId) return;
    try {
      await ChatService.reportNoShow(chatId, messageId, user.id, reason, details);
    } catch (error) {
      if (__DEV__) console.error('[Chat] Report no-show error:', error);
      Alert.alert('Erreur', "Impossible de signaler l'absence");
    }
  }, [chatId, user]);

  const handleCompleteMeetup = useCallback(async (messageId: string) => {
    if (!user || !chatId) return;
    try {
      await ChatService.completeMeetup(chatId, messageId, user.id);
    } catch (error) {
      if (__DEV__) console.error('[Chat] Complete meetup error:', error);
      Alert.alert('Erreur', 'Impossible de compléter le meetup');
    }
  }, [chatId, user]);

  const { handleMoreOptions } = useChatModeration({
    otherParticipant,
    currentUserId: user?.id,
    reportSheetRef: reportBottomSheetRef,
  });

  // ─── Render message item ───
  const renderMessage = useCallback(
    ({ item: message }: ListRenderItemInfo<Message>) => {
      const isOwnMessage = message.senderId === user?.id;

      if (message.type === 'offer' && message.offer) {
        return (
          <OfferBubble
            message={message}
            isOwnMessage={isOwnMessage}
            chatId={chatId || ''}
            currentUserId={user?.id || ''}
            sellerId={chat?.sellerId}
            articleId={chat?.articleId}
            articlePrice={article?.price ?? chat?.articlePrice}
            onAcceptOffer={handleAcceptOffer}
            onRejectOffer={handleRejectOffer}
            onCounterPrice={handleCounterPrice}
            onCounterLocation={handleCounterLocation}
            onCounterTime={handleCounterTime}
            onConfirmMeetup={handleConfirmMeetup}
            onReportNoShow={handleReportNoShow}
            onCompleteMeetup={handleCompleteMeetup}
          />
        );
      }

      return (
        <ChatBubble
          message={message}
          isOwnMessage={isOwnMessage}
          senderImage={!isOwnMessage ? otherAvatar : undefined}
        />
      );
    },
    [user?.id, chatId, handleAcceptOffer, handleRejectOffer, handleCounterPrice, handleCounterLocation, handleCounterTime, handleConfirmMeetup, handleReportNoShow, handleCompleteMeetup, otherAvatar, article?.price, chat?.articlePrice, chat?.sellerId, chat?.articleId],
  );

  // ─── Auth gate: redirect guests AFTER all hooks have been called ───
  if (!user) {
    return <Redirect href="/(tabs)/profile" />;
  }

  // ─── Loading state ───
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ChatLoadingSkeleton />
      </SafeAreaView>
    );
  }

  // ─── Error state ───
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <ChatErrorState errorMessage={error} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ChatHeader
        otherParticipant={otherParticipant}
        otherAvatar={otherAvatar}
        articlePrice={article?.price ?? chat?.articlePrice}
        onMoreOptions={handleMoreOptions}
      />

      {(article || chat?.articleId) && (
        <ChatArticleBar
          article={article}
          articleTitle={article?.title ?? chat?.articleTitle}
          articlePrice={article?.price}
          snapshotPrice={chat?.articlePrice}
          snapshotImage={chat?.articleImage}
        />
      )}

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {messages.length === 0 ? (
          <ChatEmptyState otherParticipantName={otherParticipant?.userName} />
        ) : (
          <FlashList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={messageKeyExtractor}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
            ListHeaderComponent={
              // Shipping → full tracker. Meetup → ShipmentTracking self-limits to
              // the Loi 25 automated-decision transparency + contestation block
              // (e.g. annulation automatique du meetup), or renders nothing.
              transaction && transaction.status !== 'pending_payment' ? (
                <ShipmentTracking
                  transaction={transaction}
                  onStatusUpdate={() => { refetchTransaction(); }}
                />
              ) : null
            }
          />
        )}

        {isOtherBlocked ? (
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
            isSendingImage={isSendingImage}
            hasArticle={!!chat?.articleId && article !== null}
          />
        )}
      </KeyboardAvoidingView>

      {(article?.price ?? chat?.articlePrice) && (
        <MakeOfferModal
          ref={makeOfferModalRef}
          articleId={chat?.articleId || ''}
          articleTitle={chat?.articleTitle || ''}
          currentPrice={article?.price ?? chat?.articlePrice ?? 0}
          defaultMode={SHIPPING_ENABLED && article?.isShipping && !article?.isHandDelivery ? 'shipping' : 'meetup'}
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
