import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';
import { NotificationService } from '@/services/notificationService';
import { Notification, NotificationType } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Swipeable from 'react-native-gesture-handler/Swipeable';

// Notification type to icon mapping
const notificationIcons: Record<NotificationType, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  article_favorited: { name: 'heart', color: colors.danger },
  price_drop: { name: 'pricetag', color: colors.success },
  swap_zone_reminder: { name: 'cube', color: colors.primary },
  offer_received: { name: 'cash', color: colors.success },
  offer_accepted: { name: 'checkmark-circle', color: colors.success },
  offer_rejected: { name: 'close-circle', color: colors.danger },
  offer_counter: { name: 'swap-horizontal', color: colors.warning },
  offer_expired: { name: 'time', color: colors.muted },
  new_message: { name: 'chatbubble', color: colors.primary },
  article_liked: { name: 'heart', color: colors.danger },
  article_sold: { name: 'bag-check', color: colors.success },
  shop_created: { name: 'storefront', color: colors.primary },
  shop_approved: { name: 'checkmark-circle', color: colors.success },
  shop_rejected: { name: 'close-circle', color: colors.danger },
  meetup_reminder: { name: 'location', color: colors.warning },
  meetup_confirmed: { name: 'checkmark-circle', color: colors.success },
  meetup_cancelled: { name: 'close-circle', color: colors.danger },
  no_show_reported: { name: 'warning', color: colors.danger },
};

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "À l'instant";
  if (diffMins < 60) return `Il y a ${diffMins} min`;
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  if (diffDays < 7) return `Il y a ${diffDays}j`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

interface NotificationItemProps {
  notification: Notification;
  onPress: (notification: Notification) => void;
  onDelete: (notificationId: string) => void;
}

function NotificationItem({ notification, onPress, onDelete }: NotificationItemProps) {
  const iconConfig = notificationIcons[notification.type] || { name: 'notifications', color: colors.primary };

  const renderRightActions = () => (
    <Pressable
      style={styles.deleteAction}
      onPress={() => onDelete(notification.id)}
    >
      <Ionicons name="trash" size={24} color={colors.white} />
    </Pressable>
  );

  return (
    <Swipeable renderRightActions={renderRightActions}>
      <Pressable
        style={[
          styles.notificationItem,
          !notification.isRead && styles.notificationItemUnread,
        ]}
        onPress={() => onPress(notification)}
      >
        <View style={[styles.iconContainer, { backgroundColor: `${iconConfig.color}15` }]}>
          <Ionicons name={iconConfig.name} size={24} color={iconConfig.color} />
        </View>

        <View style={styles.notificationContent}>
          <Text style={styles.notificationTitle} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.notificationMessage} numberOfLines={2}>
            {notification.message}
          </Text>
          <Text style={styles.notificationTime}>
            {formatTimeAgo(notification.createdAt)}
          </Text>
        </View>

        {!notification.isRead && <View style={styles.unreadDot} />}
      </Pressable>
    </Swipeable>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { refreshBadgeCount } = useNotifications();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!user?.id) return;

    try {
      const data = await NotificationService.getUserNotifications(user.id);
      setNotifications(data);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadNotifications();
  };

  const handleNotificationPress = async (notification: Notification) => {
    // Mark as read
    if (!notification.isRead) {
      await NotificationService.markAsRead(notification.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
      );
      refreshBadgeCount();
    }

    // Navigate based on notification data
    const data = notification.data;
    if (data?.chatId) {
      router.push(`/chat/${data.chatId}`);
    } else if (data?.articleId) {
      router.push(`/article/${data.articleId}`);
    } else if (data?.partyId) {
      router.push(`/swap-party/${data.partyId}`);
    }
  };

  const handleDeleteNotification = async (notificationId: string) => {
    try {
      await NotificationService.deleteNotification(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      refreshBadgeCount();
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user?.id) return;

    try {
      await NotificationService.markAllAsRead(user.id);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      refreshBadgeCount();
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Notifications',
          headerTitleStyle: typography.h3,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={styles.headerButton}>
              <Ionicons name="arrow-back" size={24} color={colors.foreground} />
            </Pressable>
          ),
          headerRight: () =>
            unreadCount > 0 ? (
              <Pressable onPress={handleMarkAllAsRead} style={styles.headerButton}>
                <Text style={styles.markAllText}>Tout lire</Text>
              </Pressable>
            ) : null,
        }}
      />

      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        {notifications.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="notifications-off-outline" size={64} color={colors.muted} />
            <Text style={styles.emptyTitle}>Aucune notification</Text>
            <Text style={styles.emptySubtitle}>
              Vous recevrez des notifications pour les favoris, baisses de prix, et propositions d'achat.
            </Text>
          </View>
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <NotificationItem
                notification={item}
                onPress={handleNotificationPress}
                onDelete={handleDeleteNotification}
              />
            )}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
              />
            }
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButton: {
    padding: spacing.sm,
  },
  markAllText: {
    ...typography.label,
    color: colors.primary,
  },
  listContent: {
    paddingVertical: spacing.sm,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  notificationItemUnread: {
    backgroundColor: colors.primaryLight,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: 2,
  },
  notificationMessage: {
    ...typography.bodySmall,
    color: colors.foregroundSecondary,
    marginBottom: 4,
  },
  notificationTime: {
    ...typography.caption,
    color: colors.muted,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    marginLeft: spacing.sm,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 76, // iconContainer width + marginRight
  },
  deleteAction: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.foregroundSecondary,
    textAlign: 'center',
  },
});
