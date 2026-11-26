/**
 * Notifications Settings
 */

import { useAuthenticatedSession } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { MarketingConsentService, isMarketingPreference } from '@/services/marketingConsentService';
import { track } from '@/lib/analytics';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, ScreenHeader, Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import {
  Alert,
  Linking,
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

// Analytics `pref_key` enum excludes the hidden swapZoneReminder toggle, which
// is never rendered (so never reaches handleToggle).
type NotificationPrefKey = Exclude<NotificationType, 'swapZoneReminder'>;

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
    description: 'Recevoir les alertes sur votre téléphone. Les avis essentiels restent dans l’application.',
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
    description: 'Alertes sur votre téléphone quand vous vendez. L’avis de vente reste dans l’application.',
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
  const { uid } = useAuthenticatedSession();
  const generation = getAuthSessionGeneration();
  const preferenceContext = useShippingPurchaseContext('notification-preferences', uid);
  const queryClient = useQueryClient();
  const preferenceKey = ['userNotificationPreferences', uid, generation, preferenceContext.focusRevision];
  const marketingQuery = useQuery({ queryKey: ['marketingConsent', uid, generation, preferenceContext.focusRevision],
    enabled: !!uid && preferenceContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {
      const operation = preferenceContext.capture();
      return MarketingConsentService.observe(operation.session.uid, () => preferenceContext.assertCurrent(operation));
    },
  });
  const marketingGranted = marketingQuery.isSuccess && !marketingQuery.isFetching && marketingQuery.data?.ownerId === uid &&
    marketingQuery.data.consentRecorded && marketingQuery.data.consentState === 'granted' && marketingQuery.data.enabled === true;

  const { data: settings = DEFAULT_SETTINGS, isLoading } = useQuery({
    queryKey: preferenceKey,
    queryFn: async () => {
      const operation = preferenceContext.capture();
      const result = await UserService.getNotificationPreferences(operation.session.uid);
      preferenceContext.assertCurrent(operation);
      return { ...DEFAULT_SETTINGS, ...result };
    },
    enabled: !!uid && preferenceContext.focused,
    staleTime: 0,
    retry: false,
  });

  const { mutateAsync: toggleSetting, isPending: isSaving } = useMutation({
    retry: false,
    mutationFn: async (input: { key: NotificationType; newValue: boolean; operation: ReturnType<typeof preferenceContext.capture> }) =>
      MarketingConsentService.setNotificationPreference(input.operation.session.uid, input.key, input.newValue,
        () => preferenceContext.assertCurrent(input.operation)),
    onSuccess: (_data, input) => {
      if (!preferenceContext.isCurrent(input.operation)) return;
      track('notification_pref_toggled', { pref_key: input.key as NotificationPrefKey, new_value: input.newValue,
        os_permission_missing: false, success: true });
    },
    onError: (_error, input) => {
      if (!preferenceContext.isCurrent(input.operation)) return;
      track('notification_pref_toggled', { pref_key: input.key as NotificationPrefKey, new_value: input.newValue,
        os_permission_missing: false, success: false });
      Alert.alert('Choix à vérifier', 'La préférence doit être relue. Un réglage de notification ne constitue pas un nouvel accord marketing.');
    },
    onSettled: (_data, _error, input) => {
      if (!preferenceContext.isCurrent(input.operation)) return;
      void queryClient.invalidateQueries({ queryKey: ['userNotificationPreferences', input.operation.session.uid] });
      void queryClient.invalidateQueries({ queryKey: ['userPrivacyPreferences', input.operation.session.uid] });
      void queryClient.invalidateQueries({ queryKey: ['marketingConsent', input.operation.session.uid] });
    },
  });

  const handleToggle = useCallback(async (key: NotificationType) => {
    if (!uid || isSaving || isMarketingPreference(key) && !marketingGranted) return;
    let operation;
    try { operation = preferenceContext.start(); } catch { return; }
    if (!operation) return;
    const assertCurrent = () => preferenceContext.assertCurrent(operation!);
    try {
      assertCurrent();
      const newValue = settings[key] !== true;
      if (key === 'push' && newValue) {
        const current = await Notifications.getPermissionsAsync(); assertCurrent();
        let granted = current.granted;
        let canAskAgain = current.canAskAgain;
        if (!granted && canAskAgain) {
          const requested = await Notifications.requestPermissionsAsync(); assertCurrent();
          granted = requested.granted; canAskAgain = requested.canAskAgain;
        }
        if (!granted) {
          Alert.alert('Notifications désactivées', 'Activez les notifications dans les réglages de votre appareil.', [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Ouvrir les réglages', onPress: () => {
              if (!preferenceContext.isCurrent(operation!)) return;
              track('push_permission_requested', { granted: false, can_ask_again: canAskAgain, chose_open_settings: true });
              void Linking.openSettings();
            } },
          ]);
          return;
        }
        track('push_permission_requested', { granted: true, can_ask_again: canAskAgain, chose_open_settings: false });
      }
      assertCurrent();
      await toggleSetting({ key, newValue, operation });
      assertCurrent();
    } catch { /* The mutation displays only current errors; stale OS results are discarded. */ }
    finally { preferenceContext.finish(operation); }
  }, [uid, isSaving, settings, marketingGranted, preferenceContext, toggleSetting]);

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
            Ces réglages choisissent les alertes facultatives. Les avis de paiement, vente, commande, litige et confidentialité restent disponibles dans l’application, même si les alertes sur votre téléphone sont désactivées. Leur présence ne confirme pas leur lecture.
          </Text>
        </View>

        <View style={styles.infoBox}>
          <View style={styles.settingInfo}>
            <Text variant="body" style={styles.settingTitle}>Communications marketing</Text>
            <Caption>{marketingQuery.isPending || marketingQuery.isFetching ? 'Lecture du consentement enregistré…'
              : marketingQuery.isError ? 'Impossible de confirmer le consentement. Les catégories marketing restent désactivées.'
                : marketingGranted ? 'Accord enregistré. Vous pouvez choisir les catégories ci-dessous.'
                  : 'Aucun accord marketing qualifié. Une préférence seule ne peut pas l’accorder.'}</Caption>
            <Button variant="ghost" onPress={() => router.push('/settings/privacy')}>Consulter ou modifier mon consentement</Button>
            <Button variant="ghost" disabled={!uid || isSaving} onPress={() => { void marketingQuery.refetch(); }}>Relire le consentement</Button>
          </View>
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
                value={isMarketingPreference(item.id) ? marketingGranted && settings[item.id] === true : settings[item.id] === true}
                disabled={!uid || isSaving || isMarketingPreference(item.id) && !marketingGranted}
                onValueChange={() => handleToggle(item.id)}
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
