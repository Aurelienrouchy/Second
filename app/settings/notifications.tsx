/**
 * Notifications Settings
 * Design System: Luxe Français + Street Energy
 */

import { useAuth } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
    iconColor: '#5856D6',
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
    description: 'Quand quelqu\'un ajoute ton article en favori',
    icon: 'heart-outline',
    iconColor: colors.danger,
  },
  {
    id: 'swapZoneReminder',
    title: 'Rappels Swap Zone',
    description: 'Rappel 3 jours avant l\'événement',
    icon: 'calendar-outline',
    iconColor: '#FF9500',
  },
  {
    id: 'offerReceived',
    title: 'Propositions d\'achat',
    description: 'Quand tu reçois une offre',
    icon: 'cash-outline',
    iconColor: '#FF9500',
  },
  {
    id: 'offerResponse',
    title: 'Réponses aux offres',
    description: 'Quand le vendeur répond à ton offre',
    icon: 'checkmark-circle-outline',
    iconColor: colors.primary,
  },
];

export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [settings, setSettings] = useState<Record<NotificationType, boolean>>({
    email: true,
    push: true,
    newMessages: true,
    newOrders: true,
    priceDrops: true,
    articleFavorited: true,
    swapZoneReminder: true,
    offerReceived: true,
    offerResponse: true,
  });

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadPreferences();
    }
  }, [user]);

  const loadPreferences = async () => {
    try {
      setIsLoading(true);
      if (!user) return;

      const preferences = await UserService.getUserPreferences(user.id);
      if (preferences?.notifications) {
        setSettings(preferences.notifications);
      }
    } catch (error) {
      console.error('Error loading notification preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSetting = async (key: NotificationType) => {
    const newSettings = { ...settings, [key]: !settings[key] };
    setSettings(newSettings);

    if (user) {
      try {
        await UserService.updateNotificationPreferences(user.id, newSettings);
      } catch (error) {
        console.error('Error saving notification preferences:', error);
        setSettings(settings); // Revert on error
        Alert.alert('Erreur', 'Impossible d\'enregistrer la modification');
      }
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
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
