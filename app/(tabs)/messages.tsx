import { Ionicons } from '@expo/vector-icons';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useUser } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useChats } from '@/hooks/useChat';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Chat } from '@/types';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDisplayName } from '@/utils/formatName';

type ConversationType = 'achats' | 'ventes' | 'swaps';

// Stable references for FlashList (defined at module scope so the
// FlashList prop identity doesn't change across renders).
const chatKeyExtractor = (item: Chat): string => item.id;

export default function MessagesScreen() {
  const user = useUser();
  const { showAuthSheet } = useAuthRequired();
  const router = useRouter();
  const { chats, isLoading, error } = useChats(user?.id || null);
  const [activeTab, setActiveTab] = useState<ConversationType>('ventes');

  const handleChatPress = useCallback(
    (chatId: string) => {
      router.push(`/chat/${chatId}`);
    },
    [router]
  );

  const renderConversation = useCallback(
    ({ item: chat }: ListRenderItemInfo<Chat>) => {
      const unread = user ? chat.unreadCount?.[user.id] || 0 : 0;
      return (
        <ConversationItem
          chat={chat}
          onPress={() => handleChatPress(chat.id)}
          isUnread={unread > 0}
          unreadCount={unread}
        />
      );
    },
    [handleChatPress, user]
  );

  const formatTimestamp = (timestamp?: Date) => {
    if (!timestamp) return '';

    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return timestamp.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } else if (days === 1) {
      return 'Hier';
    } else if (days < 7) {
      return timestamp.toLocaleDateString('fr-FR', { weekday: 'short' });
    } else {
      return timestamp.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
      });
    }
  };

  const getOtherParticipant = (chat: Chat) => {
    if (!user) return null;
    return chat.participantsInfo.find((p) => p.userId !== user.id);
  };

  const getLastMessagePreview = (chat: Chat): string => {
    if (!chat.lastMessage) return 'Aucun message';

    switch (chat.lastMessageType) {
      case 'image':
        return '[Photo]';
      case 'offer':
        return '[Offre envoyée]';
      case 'system':
        return chat.lastMessage;
      default:
        return chat.lastMessage;
    }
  };

  const getConversationType = (chat: Chat): ConversationType => {
    if (!user) return 'achats';
    // If the current user is the seller of the article, it's a "vente" (sale)
    // If the current user is the buyer, it's an "achat" (purchase)
    if (chat.sellerId === user.id) return 'ventes';
    return 'achats';
  };

  const filteredChats = chats.filter(
    (chat) => getConversationType(chat) === activeTab,
  );

  const unreadByType = {
    achats: chats.filter((c) => getConversationType(c) === 'achats').reduce(
      (sum, c) => sum + (user ? c.unreadCount[user.id] || 0 : 0),
      0,
    ),
    ventes: 0,
    swaps: 0,
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Messages" showBack={false} />
        <View style={styles.emptyState}>
          <Ionicons
            name="lock-closed-outline"
            size={64}
            color={colors.muted}
          />
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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Messages" showBack={false} />

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        {(['ventes', 'achats', 'swaps'] as const).map((tab) => (
          <React.Fragment key={tab}>
            <Pressable
              style={[
                styles.tabButton,
                activeTab === tab && styles.tabButtonActive,
              ]}
              onPress={() => setActiveTab(tab)}
            >
              <View style={styles.tabLabelContainer}>
                <Text
                  style={[
                    styles.tabLabel,
                    activeTab === tab && styles.tabLabelActive,
                  ]}
                >
                  {tab.toUpperCase()}
                </Text>
                {unreadByType[tab] > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {unreadByType[tab]}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          </React.Fragment>
        ))}
      </View>

      {/* Content */}
      {isLoading ? (
        <MessagesLoadingSkeleton />
      ) : error ? (
        <View style={styles.emptyState}>
          <Ionicons
            name="alert-circle-outline"
            size={64}
            color={colors.danger}
          />
          <Text style={styles.emptyStateTitle}>Erreur</Text>
          <Text style={styles.emptyStateText}>{error}</Text>
        </View>
      ) : filteredChats.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons
            name="chatbubbles-outline"
            size={64}
            color={colors.muted}
          />
          <Text style={styles.emptyStateTitle}>Aucune conversation</Text>
          <Text style={styles.emptyStateText}>
            Vos conversations avec les acheteurs et vendeurs apparaîtront ici
          </Text>
        </View>
      ) : (
        <FlashList
          data={filteredChats}
          renderItem={renderConversation}
          keyExtractor={chatKeyExtractor}
          contentContainerStyle={styles.conversationsList}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// =============================================================================
// LOADING SKELETON
// =============================================================================

const SkeletonConversationItem: React.FC = () => (
  <View style={styles.conversationItem}>
    <View style={styles.avatarContainer}>
      <Skeleton width={48} height={48} borderRadius={radius.full} />
    </View>
    <View style={styles.contentContainer}>
      <View style={styles.headerRow}>
        <Skeleton width={100} height={14} borderRadius={radius.xs} />
        <Skeleton width={60} height={11} borderRadius={radius.xs} />
      </View>
      <Skeleton
        width="90%"
        height={13}
        borderRadius={radius.xs}
        style={{ marginTop: spacing.xs }}
      />
    </View>
    <View style={styles.rightSection}>
      <Skeleton width={32} height={11} borderRadius={radius.xs} />
    </View>
  </View>
);

const SkeletonTab: React.FC<{ width: number }> = ({ width }) => (
  <View style={styles.skeletonTab}>
    <Skeleton width={width} height={11} borderRadius={radius.xs} />
  </View>
);

const MessagesLoadingSkeleton: React.FC = () => (
  <View>
    <View style={styles.skeletonTabsRow}>
      <SkeletonTab width={48} />
      <SkeletonTab width={48} />
      <SkeletonTab width={42} />
    </View>
    {Array.from({ length: 5 }).map((_, i) => (
      <SkeletonConversationItem key={`msg-skeleton-${i}`} />
    ))}
  </View>
);

// Extracted sub-component with React.memo
interface ConversationItemProps {
  chat: Chat;
  onPress: () => void;
  isUnread: boolean;
  unreadCount: number;
}

const ConversationItem = React.memo(function ConversationItem({
  chat,
  onPress,
  isUnread,
  unreadCount,
}: ConversationItemProps) {
  const user = useUser();
  const otherParticipant = user
    ? chat.participantsInfo.find((p) => p.userId !== user.id)
    : null;

  // Live profile read — falls back to the snapshot in participantsInfo
  // when the live doc hasn't loaded yet, so we never show a placeholder
  // when an avatar is in fact set.
  const { data: liveProfile } = useUserProfile(otherParticipant?.userId);
  const avatarUri =
    liveProfile?.profileImage ||
    otherParticipant?.userImage ||
    undefined;

  const lastMessagePreview = getLastMessagePreviewStatic(chat);
  const timestamp = formatTimestampStatic(chat.lastMessageTimestamp);

  return (
    <Pressable style={styles.conversationItem} onPress={onPress}>
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        {avatarUri ? (
          <Image
            source={{ uri: avatarUri }}
            style={styles.userAvatar}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.userAvatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={22} color={colors.muted} />
          </View>
        )}
        {isUnread && <View style={styles.unreadDot} />}

        {/* Article Thumbnail Overlay */}
        {chat.articleImage && (
          <Image
            source={{ uri: chat.articleImage }}
            style={styles.articleThumbnail}
            contentFit="cover"
          />
        )}
      </View>

      {/* Content */}
      <View style={styles.contentContainer}>
        {/* Header: Name + Article Tag */}
        <View style={styles.headerRow}>
          <Text style={styles.userName} numberOfLines={1}>
            {formatDisplayName(otherParticipant?.userName)}
          </Text>
          {chat.articleTitle && (
            <Text style={styles.articleTag} numberOfLines={1}>
              {chat.articleTitle}
            </Text>
          )}
        </View>

        {/* Message Preview */}
        <Text
          style={[styles.messagePreview, isUnread && styles.messagePreviewUnread]}
          numberOfLines={2}
        >
          {lastMessagePreview}
        </Text>
      </View>

      {/* Right: Time + Badge */}
      <View style={styles.rightSection}>
        <Text style={styles.timestamp}>{timestamp}</Text>
        {unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
});

// Pure functions extracted for use in memoized component
function getLastMessagePreviewStatic(chat: Chat): string {
  if (!chat.lastMessage) return 'Aucun message';

  switch (chat.lastMessageType) {
    case 'image':
      return '[Photo]';
    case 'offer':
      return '[Offre envoyée]';
    case 'system':
      return chat.lastMessage;
    default:
      return chat.lastMessage;
  }
}

function formatTimestampStatic(timestamp?: Date): string {
  if (!timestamp) return '';

  const now = new Date();
  const diff = now.getTime() - timestamp.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return timestamp.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } else if (days === 1) {
    return 'Hier';
  } else if (days < 7) {
    return timestamp.toLocaleDateString('fr-FR', { weekday: 'short' });
  } else {
    return timestamp.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
    });
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.transparent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    borderBottomColor: colors.charcoal,
  },
  tabLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tabLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.8,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  tabLabelActive: {
    color: colors.charcoal,
  },
  tabBadge: {
    backgroundColor: colors.rust,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    lineHeight: 12,
    color: colors.white,
    fontWeight: '600',
  },
  conversationsList: {
    paddingVertical: spacing.sm,
  },
  conversationItem: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'flex-start',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: spacing.md,
    width: 48,
    height: 48,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceWarm,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.rust,
    borderWidth: 2,
    borderColor: colors.white,
  },
  articleThumbnail: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 36,
    height: 44,
    borderRadius: radius.xs,
    borderWidth: 2,
    borderColor: colors.white,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  userName: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 18,
    color: colors.charcoal,
    fontWeight: '600',
    flexShrink: 1,
  },
  articleTag: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    flexShrink: 1,
  },
  messagePreview: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  messagePreviewUnread: {
    fontWeight: '500',
    color: colors.charcoal,
  },
  rightSection: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    gap: spacing.sm,
  },
  timestamp: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
  },
  unreadBadge: {
    backgroundColor: colors.rust,
    borderRadius: radius.full,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  unreadBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 14,
    color: colors.white,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyStateTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    lineHeight: 24,
    color: colors.charcoal,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptyStateText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: colors.rust,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  loginButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.white,
    fontWeight: '600',
    textAlign: 'center',
  },
  skeletonTabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  skeletonTab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});