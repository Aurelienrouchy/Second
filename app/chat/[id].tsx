import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActionSheetIOS,
    ActivityIndicator,
    Alert,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Import components
import ChatBubble from '@/components/ChatBubble';
import MakeOfferModal, { MakeOfferModalRef } from '@/components/MakeOfferModal';
import OfferBubble from '@/components/OfferBubble';
import ReportBottomSheet, { ReportBottomSheetRef } from '@/components/ReportBottomSheet';
import ShipmentTracking from '@/components/ShipmentTracking';

// Import services for moderation
import { ModerationService } from '@/services/moderationService';

// Import hooks and contexts
import { useAuth } from '@/contexts/AuthContext';
import { useChat } from '@/hooks/useChat';

// Import services
import { ArticlesService } from '@/services/articlesService';
import { ChatService } from '@/services/chatService';
import { TransactionService } from '@/services/transactionService';

// Import types
import { Article, Message, MeetupSpot, Transaction } from '@/types';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';
import { formatDisplayName } from '@/utils/formatName';

export default function ChatScreen() {
  const [messageText, setMessageText] = useState('');
  const [isSendingImage, setIsSendingImage] = useState(false);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [isLoadingTransaction, setIsLoadingTransaction] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const makeOfferModalRef = useRef<MakeOfferModalRef>(null);
  const reportBottomSheetRef = useRef<ReportBottomSheetRef>(null);
  
  const { id: chatId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  
  const {
    messages,
    chat,
    isLoading,
    error,
    sendMessage,
    sendImage,
    sendOffer,
    acceptOffer,
    rejectOffer,
  } = useChat(chatId || null, user?.id || null);

  // Load transaction if exists
  useEffect(() => {
    if (chatId && user) {
      loadTransaction();
    }
  }, [chatId, user]);

  // Load article if chat has articleId
  useEffect(() => {
    if (chat?.articleId) {
      loadArticle();
    }
  }, [chat?.articleId]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0 && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const loadArticle = async () => {
    if (!chat?.articleId) return;

    try {
      const loadedArticle = await ArticlesService.getArticleById(chat.articleId);
      setArticle(loadedArticle);
    } catch (error) {
      console.error('Error loading article:', error);
    }
  };

  const loadTransaction = async () => {
    if (!chatId || !user) return;

    try {
      setIsLoadingTransaction(true);
      const trans = await TransactionService.getTransactionByChat(chatId, user.id);
      setTransaction(trans);
    } catch (error) {
      console.error('Error loading transaction:', error);
    } finally {
      setIsLoadingTransaction(false);
    }
  };

  // Handle send text message
  const handleSendMessage = async () => {
    if (!messageText.trim() || !user) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await sendMessage(messageText.trim());
      setMessageText('');
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Erreur', 'Impossible d\'envoyer le message');
    }
  };

  // Handle pick and send image
  const handlePickImage = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert(
          'Permission requise',
          'Nous avons besoin de votre permission pour accéder à la galerie'
        );
        return;
      }

      // Pick image
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setIsSendingImage(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        
        await sendImage(result.assets[0].uri);
        
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Erreur', 'Impossible d\'envoyer l\'image');
    } finally {
      setIsSendingImage(false);
    }
  };

  // Handle make offer
  const handleMakeOffer = () => {
    if (!chat?.articlePrice) {
      Alert.alert('Erreur', 'Aucun article associé à cette conversation');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    makeOfferModalRef.current?.present();
  };

  // Handle meetup offer submit
  const handleMeetupOfferSubmit = async (
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
        message
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error sending meetup offer:', error);
      throw error;
    }
  };

  // Handle accept offer
  const handleAcceptOffer = async (messageId: string, offerId: string) => {
    try {
      await acceptOffer(messageId, offerId);
    } catch (error) {
      console.error('Error accepting offer:', error);
      throw error;
    }
  };

  // Handle reject offer
  const handleRejectOffer = async (messageId: string, offerId: string) => {
    try {
      await rejectOffer(messageId, offerId);
    } catch (error) {
      console.error('Error rejecting offer:', error);
      throw error;
    }
  };

  // Get other participant info
  const getOtherParticipant = () => {
    if (!chat || !user) return null;
    return chat.participantsInfo.find(p => p.userId !== user.id);
  };

  const otherParticipant = getOtherParticipant();

  // Handle more options (report/block user)
  const handleMoreOptions = useCallback(() => {
    if (!otherParticipant || !user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const options = ['Signaler cet utilisateur', 'Bloquer cet utilisateur', 'Annuler'];
    const destructiveButtonIndex = 1;
    const cancelButtonIndex = 2;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex,
          cancelButtonIndex,
        },
        async (buttonIndex) => {
          if (buttonIndex === 0) {
            reportBottomSheetRef.current?.open('user', otherParticipant.userId);
          } else if (buttonIndex === 1) {
            Alert.alert(
              'Bloquer cet utilisateur',
              `Voulez-vous bloquer ${formatDisplayName(otherParticipant.userName)} ? Cette personne ne pourra plus vous contacter.`,
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Bloquer',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await ModerationService.blockUser(
                        user.id,
                        otherParticipant.userId,
                        otherParticipant.userName
                      );
                      Alert.alert('Utilisateur bloqué', `${formatDisplayName(otherParticipant.userName)} a été bloqué.`);
                      router.back();
                    } catch (error: any) {
                      Alert.alert('Erreur', error.message || 'Une erreur est survenue');
                    }
                  },
                },
              ]
            );
          }
        }
      );
    } else {
      Alert.alert(
        'Options',
        undefined,
        [
          {
            text: 'Signaler cet utilisateur',
            onPress: () => reportBottomSheetRef.current?.open('user', otherParticipant.userId),
          },
          {
            text: 'Bloquer cet utilisateur',
            style: 'destructive',
            onPress: () => {
              Alert.alert(
                'Bloquer cet utilisateur',
                `Voulez-vous bloquer ${formatDisplayName(otherParticipant.userName)} ?`,
                [
                  { text: 'Annuler', style: 'cancel' },
                  {
                    text: 'Bloquer',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await ModerationService.blockUser(
                          user.id,
                          otherParticipant.userId,
                          otherParticipant.userName
                        );
                        Alert.alert('Utilisateur bloqué', `${formatDisplayName(otherParticipant.userName)} a été bloqué.`);
                        router.back();
                      } catch (error: any) {
                        Alert.alert('Erreur', error.message || 'Une erreur est survenue');
                      }
                    },
                  },
                ]
              );
            },
          },
          { text: 'Annuler', style: 'cancel' },
        ]
      );
    }
  }, [otherParticipant, user, router]);

  // Render message item
  const renderMessage = ({ item: message }: { item: Message }) => {
    const isOwnMessage = message.senderId === user?.id;

    // Render offer message
    if (message.type === 'offer' && message.offer) {
      return (
        <OfferBubble
          message={message}
          isOwnMessage={isOwnMessage}
          chatId={chatId || ''}
          currentUserId={user?.id || ''}
          onAcceptOffer={handleAcceptOffer}
          onRejectOffer={handleRejectOffer}
        />
      );
    }

    // Render regular message (text, image, system)
    return (
      <ChatBubble
        message={message}
        isOwnMessage={isOwnMessage}
        senderImage={!isOwnMessage ? otherParticipant?.userImage : undefined}
      />
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
          <Text style={styles.errorTitle}>Erreur</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Retour</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header: User info (cream bg, border-bottom) */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={20} color={colors.charcoal} />
        </Pressable>

        <Pressable
          style={styles.headerCenter}
          onPress={() => {
            if (otherParticipant?.userId) {
              router.push(`/user/${otherParticipant.userId}`);
            }
          }}
        >
          {otherParticipant && (
            <>
              <Image
                source={{ uri: otherParticipant.userImage || 'https://via.placeholder.com/40' }}
                style={styles.headerAvatar}
                contentFit="cover"
              />
              <View style={styles.headerInfo}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {formatDisplayName(otherParticipant.userName)}
                </Text>
                {chat?.articlePrice && (
                  <Text style={styles.headerSubtitle} numberOfLines={1}>
                    ${chat.articlePrice.toFixed(2)}
                  </Text>
                )}
              </View>
            </>
          )}
        </Pressable>

        <Pressable style={styles.headerButton} onPress={handleMoreOptions}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.charcoal} />
        </Pressable>
      </View>

      {/* Article context bar (white bg, border-bottom) */}
      {article && (
        <View style={[styles.header, { backgroundColor: colors.white, paddingVertical: spacing.sm }]}>
          <Image
            source={{ uri: article.images?.[0]?.url || 'https://via.placeholder.com/48x60' }}
            style={{ width: 48, height: 60, borderRadius: radius.xs, marginRight: spacing.md }}
            contentFit="cover"
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { marginBottom: 2 }]} numberOfLines={1}>
              {chat?.articleTitle}
            </Text>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.primary }}>
              ${chat?.articlePrice?.toFixed(2)}
            </Text>
          </View>
          <Pressable
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 4,
              borderWidth: 1,
              borderColor: colors.borderStrong,
              borderRadius: radius.sm
            }}
          >
            <Text style={{ fontFamily: fonts.sansMedium, fontSize: 11, color: colors.charcoal, letterSpacing: 1.2 }}>
              VOIR
            </Text>
          </Pressable>
        </View>
      )}

      <KeyboardAvoidingView 
        style={styles.content} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Messages List */}
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={64} color={colors.muted} />
            <Text style={styles.emptyStateTitle}>Aucun message</Text>
            <Text style={styles.emptyStateText}>
              Commencez la conversation avec {formatDisplayName(otherParticipant?.userName) || 'ce vendeur'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            ListHeaderComponent={
              transaction && transaction.status !== 'pending_payment' ? (
                <ShipmentTracking
                  transaction={transaction}
                  onStatusUpdate={loadTransaction}
                />
              ) : null
            }
          />
        )}

        {/* Input Container */}
        <View style={styles.inputContainer}>
          {/* Attachment button: 36px circle, white bg, 1px borderStrong, muted icon */}
          <Pressable
            style={styles.attachButton}
            onPress={handlePickImage}
            disabled={isSendingImage}
          >
            {isSendingImage ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="attach" size={18} color={colors.muted} />
            )}
          </Pressable>

          {/* Message Input: white bg, 1px borderStrong, radius.md */}
          <TextInput
            style={styles.messageInput}
            placeholder="Message..."
            value={messageText}
            onChangeText={setMessageText}
            multiline
            maxLength={1000}
            placeholderTextColor={colors.muted}
          />

          {/* Offer button (only if article exists) */}
          {chat?.articleId && (
            <Pressable
              style={styles.offerButton}
              onPress={handleMakeOffer}
            >
              <Text style={{ fontSize: 18, color: colors.primary }}>$</Text>
            </Pressable>
          )}

          {/* Send button */}
          <Pressable
            style={[
              styles.sendButton,
              !messageText.trim() && styles.sendButtonDisabled
            ]}
            onPress={handleSendMessage}
            disabled={!messageText.trim()}
          >
            <Ionicons
              name="arrow-forward"
              size={18}
              color={messageText.trim() ? colors.cream : colors.muted}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Make Offer Modal */}
      {chat?.articlePrice && (
        <MakeOfferModal
          ref={makeOfferModalRef}
          articleId={chat.articleId || ''}
          articleTitle={chat.articleTitle || ''}
          currentPrice={chat.articlePrice}
          sellerNeighborhood={article?.neighborhood}
          sellerPreferredSpots={article?.preferredMeetupSpots}
          onMeetupOfferSubmit={handleMeetupOfferSubmit}
        />
      )}

      {/* Report Bottom Sheet */}
      <ReportBottomSheet ref={reportBottomSheetRef} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.muted,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  errorTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    color: colors.foreground,
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  backButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.white,
    fontSize: 16,
  },
  // Header styling (cream bg, border-bottom)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    marginRight: spacing.md,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.foreground,
  },
  headerSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyStateTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    color: colors.foreground,
  },
  emptyStateText: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
  },
  messagesList: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // Input bar styling (cream bg, border-top)
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  // Attach button: 36px circle, white bg, 1px borderStrong, muted icon
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  // Text input: white bg, 1px borderStrong, radius.md
  messageInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.foreground,
  },
  // Offer button: 36px circle, primaryLight bg, $ icon in rust
  offerButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
  },
  // Send button: 36px circle, charcoal bg (disabled=border bg), cream arrow icon
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.charcoal,
  },
  sendButtonDisabled: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
