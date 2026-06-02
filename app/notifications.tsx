import { useUser } from '@/contexts/AuthContext';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { refreshNotificationBadge } from '@/hooks/useNotificationSetup';
import { NotificationService } from '@/services/notificationService';
import { queryKeys } from '@/lib/queryKeys';
import { Notification, NotificationType } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router, Stack } from 'expo-router';
import React, { useCallback } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { FlashList } from '@shopify/flash-list';
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
  swap_proposed: { name: 'swap-horizontal', color: colors.primary },
  swap_accepted: { name: 'checkmark-circle', color: colors.success },
  swap_declined: { name: 'close-circle', color: colors.danger },
  swap_photos_uploaded: { name: 'camera', color: colors.primary },
  swap_shipped: { name: 'send', color: colors.primary },
  swap_received: { name: 'cube', color: colors.success },
  swap_completed: { name: 'ribbon', color: colors.success },
  swap_party_starting: { name: 'people', color: colors.warning },
  swap_party_ending: { name: 'time', color: colors.warning },
  swap_match_found: { name: 'flash', color: colors.success },
  swap_update: { name: 'sync', color: colors.primary },
  new_sale: { name: 'bag-check', color: colors.success },
  order_shipped: { name: 'send', color: colors.primary },
  order_delivered: { name: 'cube', color: colors.success },
  order_cancelled: { name: 'close-circle', color: colors.danger },
  order_refunded: { name: 'card', color: colors.warning },
  funds_released: { name: 'cash', color: colors.success },
  review_received: { name: 'star', color: colors.warning },
  privacy_incident: { name: 'shield-checkmark', color: colors.danger },
};

// Strip leading emoji from notification titles/messages.
// Handles legacy data stored in Firestore that may still contain emoji prefixes.
const EMOJI_RE = /^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u;
function stripLeadingEmoji(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(EMOJI_RE, '').trim();
}

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
  return date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' });
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
            {stripLeadingEmoji(notification.title)}
          </Text>
          <Text style={styles.notificationMessage} numberOfLines={2}>
            {stripLeadingEmoji(notification.message)}
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
  const user = useUser();
  const queryClient = useQueryClient();

  const refreshBadgeCount = useCallback(() => {
    if (user?.id) refreshNotificationBadge(user.id);
  }, [user?.id]);

  const {
    data: notifications = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<Notification[]>({
    queryKey: queryKeys.notifications.list(user?.id ?? ''),
    queryFn: () => NotificationService.getUserNotifications(user!.id),
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });

  const handleNotificationPress = async (notification: Notification) => {
    // Mark as read
    if (!notification.isRead) {
      await NotificationService.markAsRead(notification.id);
      queryClient.setQueryData<Notification[]>(
        queryKeys.notifications.list(user!.id),
        (old) => old?.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)) ?? [],
      );
      refreshBadgeCount();
    }

    // Navigate using the server-built deepLink (buildDeepLink in
    // functions/src/utils/notifications.ts stores a full universal URL on
    // notification.data.deepLink). `deepLink` is not part of NotificationData
    // yet, so read it via a narrow cast (no `any`).
    const data = notification.data;
    const deepLink = (data as { deepLink?: string } | undefined)?.deepLink;
    if (deepLink) {
      const path = Linking.parse(deepLink).path;
      if (path) {
        router.push(`/${path}`);
        return;
      }
    }

    // Legacy fallback for notifications stored before deepLink was emitted.
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
      queryClient.setQueryData<Notification[]>(
        queryKeys.notifications.list(user!.id),
        (old) => old?.filter((n) => n.id !== notificationId) ?? [],
      );
      refreshBadgeCount();
    } catch (error) {
      if (__DEV__) console.error('Error deleting notification:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user?.id) return;

    try {
      await NotificationService.markAllAsRead(user.id);
      queryClient.setQueryData<Notification[]>(
        queryKeys.notifications.list(user.id),
        (old) => old?.map((n) => ({ ...n, isRead: true })) ?? [],
      );
      refreshBadgeCount();
    } catch (error) {
      if (__DEV__) console.error('Error marking all as read:', error);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.container}>
          <ScreenHeader title="Notifications" onBack={() => router.back()} />
          <View style={{ paddingVertical: spacing.sm }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={styles.notificationItem}>
                <Skeleton
                  width={48}
                  height={48}
                  borderRadius={radius.full}
                  style={{ marginRight: spacing.md }}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Skeleton width="60%" height={14} />
                  <Skeleton width="85%" height={13} />
                  <Skeleton width="25%" height={12} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.container}>
        <ScreenHeader
          title="Notifications"
          onBack={() => router.back()}
          rightContent={
            unreadCount > 0 ? (
              <Pressable onPress={handleMarkAllAsRead} style={styles.headerButton}>
                <Text style={styles.markAllText}>Tout lire</Text>
              </Pressable>
            ) : undefined
          }
        />

        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        {notifications.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="notifications-off-outline" size={64} color={colors.muted} />
            <Text style={styles.emptyTitle}>Aucune notification</Text>
            <Text style={styles.emptySubtitle}>
              Vous recevrez des notifications pour les favoris, baisses de prix, et propositions d'achat.
            </Text>
          </View>
        ) : (
          <FlashList
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
                refreshing={isRefetching}
                onRefresh={() => refetch()}
                tintColor={colors.primary}
              />
            }
          />
        )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
