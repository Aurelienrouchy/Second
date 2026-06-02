/**
 * Notifications Settings
 */

import { useUser } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, ScreenHeader } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

type NotificationType =
  | 'email'
  | 'push'
  | 'newMessages'
  | 'newOrders'
  | 'priceDrops'
  | 'articleFavorited'
  | 'swapZoneReminder'
  | 'offerReceived'
  | 'offerResponse';

interface NotificationSetting {
  id: NotificationType;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
}

const NOTIFICATION_SETTINGS: NotificationSetting[] = [
  {
    id: 'push',
    title: 'Notifications push',
    description: 'Recevoir les notifications sur votre téléphone',
    icon: 'phone-portrait-outline',
    iconColor: colors.primary,
  },
  {
    id: 'email',
    title: 'Notifications par email',
    description: 'Recevoir les actualités importantes par email',
    icon: 'mail-outline',
    iconColor: colors.primary,
  },
  {
    id: 'newMessages',
    title: 'Nouveaux messages',
    description: 'Quand quelqu\'un vous envoie un message',
    icon: 'chatbubble-outline',
    iconColor: colors.secondary,
  },
  {
    id: 'newOrders',
    title: 'Nouvelles ventes',
    description: 'Quand vous vendez un article',
    icon: 'bag-check-outline',
    iconColor: colors.success,
  },
  {
    id: 'priceDrops',
    title: 'Baisses de prix',
    description: 'Quand un article favori baisse de prix',
    icon: 'pricetag-outline',
    iconColor: colors.success,
  },
  {
    id: 'articleFavorited',
    title: 'Articles favoris',
    description: 'Quand quelqu\'un ajoute votre article en favori',
    icon: 'heart-outline',
    iconColor: colors.danger,
  },
  // 'swapZoneReminder' toggle intentionally hidden: the Swap Zone is now a
  // permanent zone (no time window), so the 3-day reminder cron is disabled
  // backend-side. The preference key is kept in NotificationType/DEFAULT_SETTINGS
  // for data-shape stability and reversibility.
  {
    id: 'offerReceived',
    title: 'Propositions d\'achat',
    description: 'Quand vous recevez une offre',
    icon: 'cash-outline',
    iconColor: colors.warning,
  },
  {
    id: 'offerResponse',
    title: 'Réponses aux offres',
    description: 'Quand le vendeur répond à votre offre',
    icon: 'checkmark-circle-outline',
    iconColor: colors.primary,
  },
];

// Privacy by default (opt-in marketing) : les notifications de nature
// marketing/secondaire sont OFF par défaut. L'utilisateur doit les activer
// explicitement. Les notifications transactionnelles essentielles restent ON.
const DEFAULT_SETTINGS: Record<NotificationType, boolean> = {
  email: true,
  push: true,
  newMessages: true,
  newOrders: true,
  priceDrops: false,
  articleFavorited: false,
  swapZoneReminder: false,
  offerReceived: true,
  offerResponse: true,
};

export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const user = useUser();
  const queryClient = useQueryClient();

  const { data: settings = DEFAULT_SETTINGS, isLoading } = useQuery({
    queryKey: ['userNotificationPreferences', user?.id],
    queryFn: () => UserService.getNotificationPreferences(user!.id),
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
  });

  const { mutate: toggleSetting } = useMutation({
    mutationFn: (key: NotificationType) => {
      const newSettings = { ...settings, [key]: !settings[key] };
      return UserService.updateNotificationPreferences(user!.id, newSettings);
    },
    onMutate: async (key: NotificationType) => {
      await queryClient.cancelQueries({ queryKey: ['userNotificationPreferences', user?.id] });
      const previousSettings = queryClient.getQueryData<Record<NotificationType, boolean>>(
        ['userNotificationPreferences', user?.id]
      );
      queryClient.setQueryData(
        ['userNotificationPreferences', user?.id],
        (old: Record<NotificationType, boolean> | undefined) => {
          const current = old ?? DEFAULT_SETTINGS;
          return { ...current, [key]: !current[key] };
        }
      );
      return { previousSettings };
    },
    onError: (_error, _key, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(
          ['userNotificationPreferences', user?.id],
          context.previousSettings
        );
      }
      Alert.alert('Erreur', 'Impossible d\'enregistrer la modification');
    },
  });

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Notifications" onBack={() => router.back()} />
        <View style={styles.skeletonContent}>
          <View style={styles.settingsList}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={[
                  styles.settingItem,
                  i === 4 && styles.settingItemLast,
                ]}
              >
                <View style={styles.settingLeft}>
                  <Skeleton width={36} height={36} borderRadius={radius.sm} />
                  <View style={styles.settingInfo}>
                    <Skeleton width="60%" height={14} />
                    <Skeleton width="40%" height={12} style={{ marginTop: spacing.xs }} />
                  </View>
                </View>
                <Skeleton width={51} height={31} borderRadius={16} />
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Notifications" onBack={() => router.back()} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Info Box */}
        <View style={styles.infoBox}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary} />
          <Text variant="bodySmall" style={styles.infoText}>
            Gérez vos préférences de notifications pour ne recevoir que ce qui vous intéresse.
          </Text>
        </View>

        {/* Settings List */}
        <View style={styles.settingsList}>
          {NOTIFICATION_SETTINGS.map((item, index) => (
            <View
              key={item.id}
              style={[
                styles.settingItem,
                index === NOTIFICATION_SETTINGS.length - 1 && styles.settingItemLast,
              ]}
            >
              <View style={styles.settingLeft}>
                <View style={[styles.iconContainer, { backgroundColor: `${item.iconColor}15` }]}>
                  <Ionicons name={item.icon} size={20} color={item.iconColor} />
                </View>
                <View style={styles.settingInfo}>
                  <Text variant="body" style={styles.settingTitle}>{item.title}</Text>
                  <Caption>{item.description}</Caption>
                </View>
              </View>
              <Switch
                value={settings[item.id]}
                onValueChange={() => toggleSetting(item.id)}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.border}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skeletonContent: {
    padding: spacing.md,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.lg,
  },
  infoText: {
    flex: 1,
    color: colors.foreground,
  },
  settingsList: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  settingItemLast: {
    borderBottomWidth: 0,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.md,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontFamily: fonts.sansMedium,
    marginBottom: 2,
  },
});
