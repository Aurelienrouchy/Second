import { useCallback, useEffect, useRef } from 'react';
import { InteractionManager, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { NotificationService } from '@/services/notificationService';
import { SavedSearchService } from '@/services/savedSearchService';
import { UserService } from '@/services/userService';
import { useNotificationStore, PushNotificationData } from '@/store/notificationStore';

// ─── Notification handler (configuré au niveau module, une seule fois) ──────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Android notification channels ─────────────────────────────────────────
async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Promise.all([
    Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      description: 'Notifications de nouveaux messages',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      vibrationPattern: [0, 250, 250, 250],
      enableLights: true,
      enableVibrate: true,
    }),
    Notifications.setNotificationChannelAsync('offers', {
      name: 'Offres',
      description: 'Notifications d\'offres et propositions',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      enableVibrate: true,
    }),
    Notifications.setNotificationChannelAsync('notifications', {
      name: 'Notifications',
      description: 'Notifications générales (favoris, baisses de prix, etc.)',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    }),
    Notifications.setNotificationChannelAsync('swaps', {
      name: 'Swap Zones',
      description: 'Rappels et mises à jour Swap Zone',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    }),
    // Le backend (functions/src/scheduled/savedSearches.ts) envoie sur le
    // channel 'saved_searches'. Sans channel correspondant, Android 8+ jette
    // silencieusement la notif → le tap (et le reset du compteur) ne se produit
    // jamais. Channel obligatoire pour que R1/M3 fonctionne.
    Notifications.setNotificationChannelAsync('saved_searches', {
      name: 'Recherches sauvegardées',
      description: 'Nouveaux articles correspondant à vos recherches',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    }),
    // Le backend (getAndroidChannel) route les notifs de commande sur 'orders'.
    Notifications.setNotificationChannelAsync('orders', {
      name: 'Commandes',
      description: 'Ventes, expéditions, livraisons et remboursements',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      enableVibrate: true,
    }),
  ]);
}

// ─── Token classification ──────────────────────────────────────────────────

/**
 * Détecte un FCM registration token (envoyable via `admin.messaging()`).
 *
 * `Notifications.getDevicePushTokenAsync()` renvoie le token NATIF :
 *  - Android → FCM registration token (contient un ':' — ex "xxxx:APA91b…").
 *  - iOS     → token APNs BRUT (64+ caractères hex, sans ':').
 *
 * Le backend envoie via `admin.messaging().sendEach()`, qui n'accepte QUE des
 * FCM registration tokens. Un token APNs brut n'est PAS envoyable tel quel et
 * est ignoré côté serveur (cf. functions/src/utils/notifications.ts
 * `partitionTokens`). Ce miroir client évite d'enregistrer un token APNs comme
 * s'il était un token FCM exploitable.
 *
 * Obtenir un VRAI FCM registration token sur iOS nécessite le module natif
 * `@react-native-firebase/messaging` (banni par les règles projet) ou une
 * étape native non configurable dans ce hook. Voir le TODO dans
 * `registerPushToken`.
 */
function isFcmRegistrationToken(token: string): boolean {
  // Les FCM registration tokens contiennent toujours ':'.
  // Les tokens APNs bruts sont du hex pur (>= 64 chars).
  if (token.includes(':')) return true;
  return !/^[0-9a-fA-F]{64,}$/.test(token);
}

// ─── Routing logic ─────────────────────────────────────────────────────────

async function routeFromNotificationData(
  data: PushNotificationData,
  userId: string | null
): Promise<void> {
  const type = data.type;

  switch (type) {
    case 'article_favorited':
    case 'price_drop':
      if (data.articleId) {
        router.push(`/article/${data.articleId}`);
      }
      return;

    case 'swap_zone_reminder':
      if (data.partyId) {
        router.push(`/swap-party/${data.partyId}`);
      }
      return;

    case 'swap_update':
      if (data.swapId) {
        router.push(`/swap/${data.swapId}`);
      }
      return;

    case 'offer_received':
    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_counter':
    case 'offer':
    case 'chat':
    case 'message':
      if (data.chatId) {
        router.push(`/chat/${data.chatId}`);
      }
      return;

    case 'saved_search':
      if (data.savedSearchId && userId) {
        try {
          const savedSearch = await SavedSearchService.getSavedSearchById(
            userId,
            data.savedSearchId
          );
          if (savedSearch) {
            await SavedSearchService.resetNewItemsCount(userId, data.savedSearchId);
            router.push({
              pathname: '/search',
              params: {
                query: savedSearch.query || '',
                filters: JSON.stringify(savedSearch.filters || {}),
              },
            });
          }
        } catch (error) {
          console.error('Error handling saved search notification:', error);
          router.push('/search');
        }
      }
      return;

    case 'shop_approved':
    case 'shop_rejected':
    case 'shop_created':
      // In-app only, route to notifications center
      router.push('/notifications');
      return;

    default:
      // Fallback: try to route based on available data
      if (data.chatId) {
        router.push(`/chat/${data.chatId}`);
      } else if (data.articleId) {
        router.push(`/article/${data.articleId}`);
      } else if (data.partyId) {
        router.push(`/swap-party/${data.partyId}`);
      } else if (data.swapId) {
        router.push(`/swap/${data.swapId}`);
      }
  }
}

// ─── Handle initial notification (app killed → tap notification) ────────────

async function handleInitialNotification(userId: string | null): Promise<void> {
  const lastResponse = await Notifications.getLastNotificationResponseAsync();
  if (!lastResponse) return;

  const data = lastResponse.notification.request.content.data as PushNotificationData;
  if (data) {
    InteractionManager.runAfterInteractions(() => {
      routeFromNotificationData(data, userId);
    });
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Hook principal pour le setup complet des notifications push.
 * Gère : channels Android, listeners, notification initiale (app killed),
 * enregistrement du token FCM, badge count.
 *
 * Doit être appelé UNE SEULE FOIS dans le root layout.
 */
export function useNotificationSetup(userId: string | null): void {
  const {
    setUnreadCount,
    incrementUnreadCount,
    setSetupComplete,
    setPushToken,
  } = useNotificationStore();

  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const fcmTokenRef = useRef<string | null>(null);

  // ── Refresh badge count ──
  const refreshBadgeCount = useCallback(async () => {
    if (!userIdRef.current) return;
    try {
      const count = await NotificationService.countUnreadNotifications(userIdRef.current);
      setUnreadCount(count);
    } catch (error) {
      console.error('Error refreshing badge count:', error);
    }
  }, [setUnreadCount]);

  // ── Register FCM token ──
  const registerPushToken = useCallback(async () => {
    if (!userIdRef.current) return;

    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        if (__DEV__) console.log('Push notification permission denied');
        return;
      }

      const pushToken = await Notifications.getDevicePushTokenAsync();
      const deviceToken = pushToken.data as string;
      if (!deviceToken) return;

      // iOS renvoie un token APNs brut, non envoyable via FCM tel quel. Le
      // backend l'ignore (partitionTokens) → l'enregistrer ne produit aucune
      // notif. On évite de polluer la liste fcmTokens avec un token mort.
      // TODO(push-ios): pour activer le push iOS, enregistrer un vrai FCM
      // registration token. Nécessite une étape native (module messaging FCM)
      // hors périmètre de ce hook — à traiter via app.config.js + prebuild.
      if (!isFcmRegistrationToken(deviceToken)) {
        if (__DEV__) {
          console.log(
            `[push] Token natif non-FCM (${pushToken.type}) ignoré — ` +
              'le push iOS requiert un FCM registration token (étape native).'
          );
        }
        return;
      }

      await UserService.saveFcmToken(userIdRef.current, deviceToken);
      fcmTokenRef.current = deviceToken;
      setPushToken(deviceToken);
      if (__DEV__) console.log('FCM token registered');
    } catch (error) {
      if (__DEV__) console.log('Error registering push token:', error);
    }
  }, [setPushToken]);

  // ── Unregister FCM token (cleanup) ──
  const unregisterPushToken = useCallback(async () => {
    if (!userIdRef.current || !fcmTokenRef.current) return;
    try {
      await UserService.removeFcmToken(userIdRef.current, fcmTokenRef.current);
      fcmTokenRef.current = null;
      setPushToken(null);
    } catch (error) {
      console.error('Error unregistering push token:', error);
    }
  }, [setPushToken]);

  // ── Main setup effect ──
  useEffect(() => {
    if (!userId) {
      // User logged out → cleanup
      useNotificationStore.getState().reset();
      return;
    }

    let isActive = true;

    const setup = async () => {
      // 1. Setup Android channels
      await setupAndroidChannels();

      if (!isActive) return;

      // 2. Register push token
      await registerPushToken();

      if (!isActive) return;

      // 3. Get initial badge count
      await refreshBadgeCount();

      if (!isActive) return;

      // 4. Handle notification that opened the app (killed state)
      await handleInitialNotification(userId);

      if (!isActive) return;

      setSetupComplete(true);
    };

    setup();

    // 5. Listener: notification received (foreground)
    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      refreshBadgeCount();
    });

    // 6. Listener: notification tapped
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as PushNotificationData;
      if (data) {
        routeFromNotificationData(data, userIdRef.current);
      }
    });

    // 7. Listener: token refresh
    const tokenSub = Notifications.addPushTokenListener(async (newPushToken) => {
      const newToken = newPushToken.data as string;
      const currentUserId = userIdRef.current;
      if (!currentUserId) return;

      // Remove old token
      if (fcmTokenRef.current && fcmTokenRef.current !== newToken) {
        await UserService.removeFcmToken(currentUserId, fcmTokenRef.current);
      }

      // Save new token
      await UserService.saveFcmToken(currentUserId, newToken);
      fcmTokenRef.current = newToken;
      setPushToken(newToken);
      console.log('Push token refreshed');
    });

    return () => {
      isActive = false;
      receivedSub.remove();
      responseSub.remove();
      tokenSub.remove();
    };
  }, [userId, refreshBadgeCount, registerPushToken, setSetupComplete, setPushToken]);

  // ── Expose unregister for logout (via store or callback) ──
  // The AuthContext can call useNotificationStore.getState().reset()
  // and UserService.removeFcmToken() directly on logout.
}

// ─── Exported helpers ───────────────────────────────────────────────────────

/** Clear all notifications and reset badge */
export async function clearAllNotifications(userId: string): Promise<void> {
  await NotificationService.markAllAsRead(userId);
  useNotificationStore.getState().clearUnreadCount();
  await Notifications.setBadgeCountAsync(0);
}

/** Refresh badge count from Firestore */
export async function refreshNotificationBadge(userId: string): Promise<void> {
  const count = await NotificationService.countUnreadNotifications(userId);
  useNotificationStore.getState().setUnreadCount(count);
}
