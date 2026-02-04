import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import messaging from '@react-native-firebase/messaging';
import { UserService } from '@/services/userService';

interface UseFcmTokenResult {
  token: string | null;
  isLoading: boolean;
  error: string | null;
  requestPermission: () => Promise<boolean>;
  registerToken: () => Promise<string | null>;
  unregisterToken: () => Promise<void>;
}

/**
 * Hook pour gérer l'enregistrement et le rafraîchissement des tokens FCM
 * Gère les permissions iOS/Android et la persistance dans Firestore
 */
export function useFcmToken(userId: string | null): UseFcmTokenResult {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  /**
   * Demander les permissions de notification
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      if (Platform.OS === 'ios') {
        // iOS: Utiliser Firebase Messaging pour les permissions
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (!enabled) {
          console.log('iOS notification permission denied');
          return false;
        }
      } else {
        // Android 13+: Demander la permission POST_NOTIFICATIONS
        const { status: existingStatus } = await Notifications.getPermissionsAsync();

        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          if (status !== 'granted') {
            console.log('Android notification permission denied');
            return false;
          }
        }
      }

      return true;
    } catch (err) {
      console.error('Error requesting notification permission:', err);
      return false;
    }
  }, []);

  /**
   * Enregistrer le token FCM dans Firestore
   */
  const registerToken = useCallback(async (): Promise<string | null> => {
    if (!userId) {
      console.log('Cannot register FCM token: no userId');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // D'abord, demander les permissions
      const hasPermission = await requestPermission();
      if (!hasPermission) {
        setError('Notification permission denied');
        setIsLoading(false);
        return null;
      }

      // Obtenir le token FCM
      const fcmToken = await messaging().getToken();

      if (!fcmToken) {
        setError('Failed to get FCM token');
        setIsLoading(false);
        return null;
      }

      // Sauvegarder le token dans Firestore
      await UserService.saveFcmToken(userId, fcmToken);

      setToken(fcmToken);
      tokenRef.current = fcmToken;
      console.log('FCM token registered successfully');

      return fcmToken;
    } catch (err: any) {
      console.error('Error registering FCM token:', err);
      setError(err.message || 'Failed to register for push notifications');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, requestPermission]);

  /**
   * Supprimer le token FCM de Firestore (déconnexion)
   */
  const unregisterToken = useCallback(async (): Promise<void> => {
    if (!userId || !tokenRef.current) {
      return;
    }

    try {
      await UserService.removeFcmToken(userId, tokenRef.current);
      setToken(null);
      tokenRef.current = null;
      console.log('FCM token unregistered successfully');
    } catch (err) {
      console.error('Error unregistering FCM token:', err);
    }
  }, [userId]);

  /**
   * Écouter le rafraîchissement du token
   */
  useEffect(() => {
    if (!userId) return;

    const unsubscribe = messaging().onTokenRefresh(async (newToken) => {
      console.log('FCM token refreshed');

      // Supprimer l'ancien token si on en avait un
      if (tokenRef.current && tokenRef.current !== newToken) {
        await UserService.removeFcmToken(userId, tokenRef.current);
      }

      // Sauvegarder le nouveau token
      await UserService.saveFcmToken(userId, newToken);
      setToken(newToken);
      tokenRef.current = newToken;
    });

    return () => unsubscribe();
  }, [userId]);

  return {
    token,
    isLoading,
    error,
    requestPermission,
    registerToken,
    unregisterToken,
  };
}

/**
 * Vérifier si les notifications sont activées
 */
export async function areNotificationsEnabled(): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') {
      const authStatus = await messaging().hasPermission();
      return (
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL
      );
    } else {
      const { status } = await Notifications.getPermissionsAsync();
      return status === 'granted';
    }
  } catch {
    return false;
  }
}
