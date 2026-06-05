import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, InteractionManager, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { router, type Href } from 'expo-router';

import { NotificationService } from '@/services/notificationService';
import { SavedSearchService } from '@/services/savedSearchService';
import { UserService } from '@/services/userService';
import { useNotificationStore, PushNotificationData } from '@/store/notificationStore';

// ─── Active chat tracking ───────────────────────────────────────────────────
// The chat screen sets this on focus/blur so the foreground notification
// handler can suppress the banner for the conversation the user is already
// looking at (a banner over the open thread is pure noise). Module-level ref
// because `setNotificationHandler` runs outside React.
let activeChatId: string | null = null;

/** Called by the chat screen on focus (uid) / blur (null). */
export function setActiveChatId(chatId: string | null): void {
  activeChatId = chatId;
}

// ─── Notification handler (configuré au niveau module, une seule fois) ──────
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as PushNotificationData | undefined;
    // Already in the matching chat → no banner/sound, just keep the list/badge
    // in sync (the chat listener already shows the message in-thread).
    const inActiveChat =
      data?.chatId != null && data.chatId === activeChatId;

    return {
      shouldPlaySound: !inActiveChat,
      shouldSetBadge: true,
      shouldShowBanner: !inActiveChat,
      shouldShowList: true,
    };
  },
});

// ─── Android notification channels ─────────────────────────────────────────
async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Promise.all([
    // Canaux critiques (HIGH) : son par défaut pour que la notif soit
    // perçue (messages, offres, commandes). Les canaux DEFAULT restent muets.
    Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      description: 'Notifications de nouveaux messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      enableLights: true,
      enableVibrate: true,
    }),
    Notifications.setNotificationChannelAsync('offers', {
      name: 'Offres',
      description: 'Notifications d\'offres et propositions',
      importance: Notifications.AndroidImportance.HIGH,
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

/**
 * Convertit le `deepLink` produit par le backend
 * (functions/src/utils/notifications.ts `buildDeepLink`, ex.
 * `https://seconde.app/my-orders?transactionId=…`) en href interne consommable
 * par Expo Router. Renvoie `null` si l'URL ne contient pas de path exploitable.
 */
function deepLinkToHref(deepLink: string | undefined): Href | null {
  if (!deepLink) return null;
  try {
    const parsed = Linking.parse(deepLink);
    if (!parsed.path) return null;
    const query = parsed.queryParams
      ? Object.entries(parsed.queryParams)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    return (`/${parsed.path}${query ? `?${query}` : ''}` as Href);
  } catch {
    return null;
  }
}

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
    case 'new_message':
      if (data.chatId) {
        router.push(`/chat/${data.chatId}`);
      }
      return;

    case 'new_sale':
    case 'order_shipped':
    case 'order_delivered':
    case 'order_cancelled':
    case 'order_refunded':
    case 'funds_released':
      // Backend route les ventes/commandes vers /my-orders?transactionId=…
      // (app/my-orders.tsx consomme `transactionId` via useLocalSearchParams).
      router.push(
        data.transactionId
          ? { pathname: '/my-orders', params: { transactionId: data.transactionId } }
          : '/my-orders'
      );
      return;

    case 'review_received':
    case 'privacy_incident':
      // In-app only, route to notifications center (cf. buildDeepLink).
      router.push('/notifications');
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
          if (__DEV__) console.error('Error handling saved search notification:', error);
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

    case undefined:
      break;

    default: {
      // Type connu côté serveur mais non géré ici → erreur de compilation si la
      // chaîne diverge du producteur. Le runtime retombe sur le deepLink/data.
      const _exhaustive: never = type;
      void _exhaustive;
      break;
    }
  }

  // Fallback : consomme le deepLink construit par le backend (source unique),
  // puis les ids bruts si aucun deepLink exploitable n'est présent.
  const href = deepLinkToHref(data.deepLink);
  if (href) {
    router.push(href);
    return;
  }
  if (data.chatId) {
    router.push(`/chat/${data.chatId}`);
  } else if (data.articleId) {
    router.push(`/article/${data.articleId}`);
  } else if (data.transactionId) {
    router.push({ pathname: '/my-orders', params: { transactionId: data.transactionId } });
  } else if (data.partyId) {
    router.push(`/swap-party/${data.partyId}`);
  } else if (data.swapId) {
    router.push(`/swap/${data.swapId}`);
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
  // This hook is mounted at the root of the nav tree (RootLayoutNav). Reading
  // the whole store via `useNotificationStore()` would subscribe the root to
  // every snapshot change — each `incrementUnreadCount()` on an incoming push
  // (flat `set({...})`) re-renders the whole tree. Actions are stable refs in
  // Zustand 5, so we call them through `getState()` instead of subscribing.
  // This also keeps them out of the setup effect deps below, so the 4 OS
  // listeners are no longer torn down + recreated on every notification.
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const fcmTokenRef = useRef<string | null>(null);

  // ── Refresh badge count ──
  const refreshBadgeCount = useCallback(async () => {
    if (!userIdRef.current) return;
    try {
      const count = await NotificationService.countUnreadNotifications(userIdRef.current);
      setUnreadCount(count);
      // Aligne le badge OS sur le compteur serveur (source de vérité) plutôt
      // que sur l'incrément optimiste fait à l'arrivée de la notif.
      await Notifications.setBadgeCountAsync(count);
    } catch (error) {
      if (__DEV__) console.error('Error refreshing badge count:', error);
    }
  }, [setUnreadCount]);

  // ── Register FCM token ──
  const registerPushToken = useCallback(async () => {
    if (!userIdRef.current) return;

    try {
      // Don't re-prompt if the OS won't show the dialog again (canAskAgain
      // false). Re-enabling then requires the system settings — surfaced by
      // the notification settings UI (C14), not an auto re-prompt here.
      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== 'granted' && existing.canAskAgain) {
        const requested = await Notifications.requestPermissionsAsync();
        status = requested.status;
      }
      if (status !== 'granted') {
        if (__DEV__) {
          console.log(
            `[push] permission non accordée (status=${status}, ` +
              `canAskAgain=${existing.canAskAgain})`
          );
        }
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
      // Feedback immédiat : incrémente le compteur in-app, puis réconcilie avec
      // le compteur serveur (qui réaligne aussi le badge OS).
      incrementUnreadCount();
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
      if (!currentUserId || !newToken) return;

      // Même garde qu'à l'enregistrement : ne pas persister un token natif
      // non-FCM (APNs brut iOS) que le backend ne peut pas envoyer.
      if (!isFcmRegistrationToken(newToken)) {
        if (__DEV__) {
          console.log(
            `[push] Token rafraîchi non-FCM (${newPushToken.type}) ignoré.`
          );
        }
        return;
      }

      // Remove old token
      if (fcmTokenRef.current && fcmTokenRef.current !== newToken) {
        await UserService.removeFcmToken(currentUserId, fcmTokenRef.current);
      }

      // Save new token
      await UserService.saveFcmToken(currentUserId, newToken);
      fcmTokenRef.current = newToken;
      setPushToken(newToken);
      if (__DEV__) console.log('FCM token refreshed');
    });

    // 8. Listener: app foregrounded → re-sync badge (notifications may have
    // arrived while backgrounded, or been read on another device).
    const appStateRef = { current: AppState.currentState as AppStateStatus };
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        refreshBadgeCount();
      }
      appStateRef.current = nextState;
    });

    return () => {
      isActive = false;
      receivedSub.remove();
      responseSub.remove();
      tokenSub.remove();
      appStateSub.remove();
    };
  }, [userId, refreshBadgeCount, registerPushToken, setSetupComplete, setPushToken, incrementUnreadCount]);

  // ── Expose unregister for logout (via store or callback) ──
  // The AuthContext can call useNotificationStore.getState().reset()
  // and UserService.removeFcmToken() directly on logout.
}

// ─── Exported helpers ───────────────────────────────────────────────────────

/**
 * Refresh the unread count from Firestore and align the OS badge on it.
 * Used by the notifications screen after read/delete/mark-all so the in-app
 * count AND the home-screen badge stay in sync with the server.
 */
export async function refreshNotificationBadge(userId: string): Promise<void> {
  try {
    const count = await NotificationService.countUnreadNotifications(userId);
    useNotificationStore.getState().setUnreadCount(count);
    await Notifications.setBadgeCountAsync(count);
  } catch (error) {
    if (__DEV__) console.error('Error refreshing notification badge:', error);
  }
}
