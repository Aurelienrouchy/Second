import { useCallback, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
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
 * Hook pour gérer l'enregistrement et le rafraîchissement des tokens push
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
      const { status: existingStatus } = await Notifications.getPermissionsAsync();

      if (existingStatus === 'granted') {
        return true;
      }

      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        console.log('Notification permission denied');
        return false;
      }

      return true;
    } catch (err) {
      console.error('Error requesting notification permission:', err);
      return false;
    }
  }, []);

  /**
   * Enregistrer le token push dans Firestore
   */
  const registerToken = useCallback(async (): Promise<string | null> => {
    if (!userId) {
      console.log('Cannot register push token: no userId');
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

      // Obtenir le token push natif (FCM token on Android, APNs token on iOS)
      const pushToken = await Notifications.getDevicePushTokenAsync();
      const deviceToken = pushToken.data as string;

      if (!deviceToken) {
        setError('Failed to get push token');
        setIsLoading(false);
        return null;
      }

      // Sauvegarder le token dans Firestore
      await UserService.saveFcmToken(userId, deviceToken);

      setToken(deviceToken);
      tokenRef.current = deviceToken;
      console.log('Push token registered successfully');

      return deviceToken;
    } catch (err: any) {
      console.error('Error registering push token:', err);
      setError(err.message || 'Failed to register for push notifications');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, requestPermission]);

  /**
   * Supprimer le token push de Firestore (déconnexion)
   */
  const unregisterToken = useCallback(async (): Promise<void> => {
    if (!userId || !tokenRef.current) {
      return;
    }

    try {
      await UserService.removeFcmToken(userId, tokenRef.current);
      setToken(null);
      tokenRef.current = null;
      console.log('Push token unregistered successfully');
    } catch (err) {
      console.error('Error unregistering push token:', err);
    }
  }, [userId]);

  /**
   * Écouter le rafraîchissement du token
   */
  useEffect(() => {
    if (!userId) return;

    const subscription = Notifications.addPushTokenListener(async (newPushToken) => {
      const newToken = newPushToken.data as string;
      console.log('Push token refreshed');

      // Supprimer l'ancien token si on en avait un
      if (tokenRef.current && tokenRef.current !== newToken) {
        await UserService.removeFcmToken(userId, tokenRef.current);
      }

      // Sauvegarder le nouveau token
      await UserService.saveFcmToken(userId, newToken);
      setToken(newToken);
      tokenRef.current = newToken;
    });

    return () => subscription.remove();
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
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}
