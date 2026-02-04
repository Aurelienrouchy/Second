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
    if (!chatId) return;
    
    try {
      setIsLoadingTransaction(true);
      const trans = await TransactionService.getTransactionByChat(chatId);
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
    meetupDateTime: Date
  ) => {
    if (!chatId || !user || !chat) return;

    try {
      await ChatService.sendMeetupOffer(
        chatId,
        user.id,
        chat.participantsInfo.find(p => p.userId !== user.id)?.userId || '',
        amount,
        meetupSpot,
        meetupDateTime,
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
              `Voulez-vous bloquer ${otherParticipant.userName} ? Cette personne ne pourra plus vous contacter.`,
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
                      Alert.alert('Utilisateur bloqué', `${otherParticipant.userName} a été bloqué.`);
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
                `Voulez-vous bloquer ${otherParticipant.userName} ?`,
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
                        Alert.alert('Utilisateur bloqué', `${otherParticipant.userName} a été bloqué.`);
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
      />
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F79F24" />
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
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={24} color="#1C1C1E" />
        </Pressable>

        <View style={styles.headerCenter}>
          {otherParticipant && (
            <>
              <Image
                source={{ uri: otherParticipant.userImage || 'https://via.placeholder.com/40' }}
                style={styles.headerAvatar}
                contentFit="cover"
              />
              <View style={styles.headerInfo}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {otherParticipant.userName}
                </Text>
                {chat?.articleTitle && (
                  <Text style={styles.headerSubtitle} numberOfLines={1}>
                    • {chat.articleTitle}
                  </Text>
                )}
              </View>
            </>
          )}
        </View>

        <Pressable style={styles.headerButton} onPress={handleMoreOptions}>
          <Ionicons name="ellipsis-vertical" size={24} color="#1C1C1E" />
        </Pressable>
      </View>

      <KeyboardAvoidingView 
        style={styles.content} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Messages List */}
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={64} color="#8E8E93" />
            <Text style={styles.emptyStateTitle}>Aucun message</Text>
            <Text style={styles.emptyStateText}>
              Commencez la conversation avec {otherParticipant?.userName || 'ce vendeur'}
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
          {/* Attachment button */}
          <Pressable 
            style={styles.attachButton}
            onPress={handlePickImage}
            disabled={isSendingImage}
          >
            {isSendingImage ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Ionicons name="image-outline" size={24} color="#007AFF" />
            )}
          </Pressable>

          {/* Message Input */}
          <TextInput
            style={styles.messageInput}
            placeholder="Message..."
            value={messageText}
            onChangeText={setMessageText}
            multiline
            maxLength={1000}
            placeholderTextColor="#8E8E93"
          />

          {/* Offer button (only if article exists) */}
          {chat?.articleId && (
            <Pressable 
              style={styles.offerButton}
              onPress={handleMakeOffer}
            >
              <Ionicons name="cash-outline" size={24} color="#F79F24" />
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
              name="send" 
              size={20} 
              color={messageText.trim() ? "#FFFFFF" : "#8E8E93"} 
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
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  errorText: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: '#F79F24',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 16,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F2F2F7',
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
    color: '#1C1C1E',
  },
  emptyStateText: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
  },
  messagesList: {
    paddingVertical: 16,
    paddingHorizontal: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
    gap: 8,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
  messageInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#F2F2F7',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1C1C1E',
  },
  offerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF9F0',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#007AFF',
  },
  sendButtonDisabled: {
    backgroundColor: '#F2F2F7',
  },
});
