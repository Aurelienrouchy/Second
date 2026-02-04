import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useChats } from '@/hooks/useChat';
import { Chat } from '@/types';
import { AUTH_MESSAGES } from '@/constants/authMessages';

export default function MessagesScreen() {
  const { user } = useAuth();
  const { showAuthSheet } = useAuthRequired();
  const router = useRouter();
  const { chats, isLoading, error } = useChats(user?.id || null);

  const handleChatPress = (chatId: string) => {
    router.push(`/chat/${chatId}`);
  };

  const formatTimestamp = (timestamp?: Date) => {
    if (!timestamp) return '';
    
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Hier';
    } else if (days < 7) {
      return timestamp.toLocaleDateString('fr-FR', { weekday: 'short' });
    } else {
      return timestamp.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    }
  };

  const getOtherParticipant = (chat: Chat) => {
    if (!user) return null;
    return chat.participantsInfo.find(p => p.userId !== user.id);
  };

  const getLastMessagePreview = (chat: Chat) => {
    if (!chat.lastMessage) return 'Aucun message';
    
    switch (chat.lastMessageType) {
      case 'image':
        return '📷 Photo';
      case 'offer':
        return '💸 Offre envoyée';
      case 'system':
        return chat.lastMessage;
      default:
        return chat.lastMessage;
    }
  };

  const renderChatItem = ({ item: chat }: { item: Chat }) => {
    const otherParticipant = getOtherParticipant(chat);
    const unreadCount = user ? (chat.unreadCount[user.id] || 0) : 0;
    
    return (
      <Pressable 
        style={styles.conversationItem}
        onPress={() => handleChatPress(chat.id)}
      >
        {/* Article Image (if available) */}
        {chat.articleImage && (
          <Image 
            source={{ uri: chat.articleImage }} 
            style={styles.articleImage}
            contentFit="cover"
          />
        )}
        
        {/* User Avatar */}
        <View style={styles.conversationLeft}>
          <Image 
            source={{ uri: otherParticipant?.userImage || 'https://via.placeholder.com/50' }} 
            style={styles.userAvatar}
            contentFit="cover"
          />
          {unreadCount > 0 && <View style={styles.unreadDot} />}
        </View>
        
        {/* Message Content */}
        <View style={styles.conversationMiddle}>
          <View style={styles.topRow}>
            <Text style={styles.userName} numberOfLines={1}>
              {otherParticipant?.userName || 'Utilisateur'}
            </Text>
            {chat.articleTitle && (
              <Text style={styles.articleTag} numberOfLines={1}>
                • {chat.articleTitle}
              </Text>
            )}
          </View>
          <Text style={[
            styles.lastMessage,
            unreadCount > 0 && styles.unreadMessage
          ]} numberOfLines={2}>
            {getLastMessagePreview(chat)}
          </Text>
        </View>
        
        {/* Right side (time + unread badge) */}
        <View style={styles.conversationRight}>
          <Text style={styles.timestamp}>
            {formatTimestamp(chat.lastMessageTimestamp)}
          </Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadCount}>{unreadCount}</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Ionicons name="lock-closed-outline" size={64} color="#8E8E93" />
          <Text style={styles.emptyStateTitle}>Connexion requise</Text>
          <Text style={styles.emptyStateText}>
            Connectez-vous pour accéder à vos messages
          </Text>
          <Pressable
            style={styles.loginButton}
            onPress={() => showAuthSheet(AUTH_MESSAGES.message)}
          >
            <Text style={styles.loginButtonText}>Se connecter</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#F79F24" />
          <Text style={styles.loadingText}>Chargement des conversations...</Text>
        </View>
      ) : error ? (
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
          <Text style={styles.emptyStateTitle}>Erreur</Text>
          <Text style={styles.emptyStateText}>{error}</Text>
        </View>
      ) : chats.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="chatbubbles-outline" size={64} color="#8E8E93" />
          <Text style={styles.emptyStateTitle}>Aucune conversation</Text>
          <Text style={styles.emptyStateText}>
            Vos conversations avec les acheteurs et vendeurs apparaîtront ici
          </Text>
        </View>
      ) : (
        <FlatList
          data={chats}
          renderItem={renderChatItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.conversationsList}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1C1C1E',
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
    lineHeight: 22,
  },
  loginButton: {
    backgroundColor: '#F79F24',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 24,
    marginTop: 24,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  conversationsList: {
    paddingVertical: 8,
  },
  conversationItem: {
    flexDirection: 'row',
    padding: 12,
    marginHorizontal: 16,
    marginVertical: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F2F2F7',
    alignItems: 'center',
  },
  articleImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
    marginRight: 12,
  },
  conversationLeft: {
    position: 'relative',
    marginRight: 12,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F2F2F7',
  },
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FF3B30',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  conversationMiddle: {
    flex: 1,
    justifyContent: 'center',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  userName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
    flexShrink: 1,
  },
  articleTag: {
    fontSize: 13,
    color: '#8E8E93',
    marginLeft: 4,
    flexShrink: 1,
  },
  lastMessage: {
    fontSize: 14,
    color: '#8E8E93',
    lineHeight: 18,
  },
  unreadMessage: {
    fontWeight: '600',
    color: '#1C1C1E',
  },
  conversationRight: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginLeft: 8,
  },
  timestamp: {
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 4,
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 50,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#8E8E93',
  },
  unreadBadge: {
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadCount: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
});