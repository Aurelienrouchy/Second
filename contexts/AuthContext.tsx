import { AuthService } from '@/services/authService';
import { guestPreferencesService, GuestSession } from '@/services/guestPreferencesService';
import { generateStyleProfile } from '@/services/styleProfileService';
import { UserService } from '@/services/userService';
import { User } from '@/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import React, { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isFirstLaunch: boolean;
  isGuest: boolean;
  guestSession: GuestSession | null;
  signIn: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
  skipAuth: () => Promise<void>;
  checkAuthRequired: () => boolean;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  signUpWithEmail: (email: string, password: string, username: string) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  signInWithApple: () => Promise<User>;
  initGuestSession: () => Promise<void>;
  mergeGuestToUser: (userId: string) => Promise<void>;
  registerForPushNotifications: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFirstLaunch, setIsFirstLaunch] = useState(true);
  const [guestSession, setGuestSession] = useState<GuestSession | null>(null);
  const fcmTokenRef = useRef<string | null>(null);

  // Computed: user is a guest if no user is logged in
  const isGuest = user === null;

  useEffect(() => {
    // Initialiser les services d'authentification
    AuthService.initialize().catch(console.error);

    checkAuthState();

    // Écouter les changements d'état d'authentification Firebase
    const unsubscribe = AuthService.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userData = await AuthService.getCurrentUser();
          if (userData) {
            setUser(userData);
            await AsyncStorage.setItem('user_data', JSON.stringify(userData));
          }
        } catch (error) {
          console.error('Error getting current user:', error);
        }
      } else {
        setUser(null);
        await AsyncStorage.removeItem('user_data');
      }
    });

    // Listen for FCM token refresh
    const unsubscribeTokenRefresh = messaging().onTokenRefresh(async (newToken) => {
      if (user?.id) {
        // Remove old token if exists
        if (fcmTokenRef.current && fcmTokenRef.current !== newToken) {
          await UserService.removeFcmToken(user.id, fcmTokenRef.current);
        }
        // Save new token
        await UserService.saveFcmToken(user.id, newToken);
        fcmTokenRef.current = newToken;
        console.log('FCM token refreshed and saved');
      }
    });

    return () => {
      unsubscribe();
      unsubscribeTokenRefresh();
    };
  }, [user?.id]);

  const checkAuthState = async () => {
    try {
      // Vérifier si c'est le premier lancement
      const hasLaunchedBefore = await AsyncStorage.getItem('has_launched_before');
      const savedUser = await AsyncStorage.getItem('user_data');

      if (!hasLaunchedBefore) {
        // Premier lancement
        setIsFirstLaunch(true);
        setUser(null);
        // Initialize guest session for new users
        await initGuestSessionInternal();
      } else {
        // Pas le premier lancement
        setIsFirstLaunch(false);

        if (savedUser) {
          // Utilisateur connecté - aller direct à l'accueil
          setUser(JSON.parse(savedUser));
          // Clear guest session when user is logged in
          setGuestSession(null);
        } else {
          // Utilisateur pas connecté - mode guest
          setUser(null);
          // Load or create guest session
          await initGuestSessionInternal();
        }
      }
    } catch (error) {
      console.log('Error checking auth state:', error);
      setIsFirstLaunch(true);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const initGuestSessionInternal = async () => {
    try {
      let session = await guestPreferencesService.getGuestSession();
      if (!session) {
        session = await guestPreferencesService.createGuestSession();
      }
      setGuestSession(session);
    } catch (error) {
      console.log('Error initializing guest session:', error);
    }
  };

  const signIn = async (userData: User) => {
    try {
      await AsyncStorage.setItem('user_data', JSON.stringify(userData));
      await AsyncStorage.setItem('has_launched_before', 'true');
      setUser(userData);
      setIsFirstLaunch(false);

      // Register for push notifications (non-blocking)
      // We need to do this in a setTimeout to ensure user state is set
      setTimeout(async () => {
        try {
          await registerForPushNotificationsInternal(userData.id);
        } catch (e) {
          console.log('FCM registration failed (silent):', e);
        }
      }, 1000);
    } catch (error) {
      console.log('Error signing in:', error);
    }
  };

  /**
   * Internal helper for push notification registration
   * Takes userId directly since user state might not be set yet
   */
  const registerForPushNotificationsInternal = async (userId: string): Promise<void> => {
    try {
      let hasPermission = false;

      if (Platform.OS === 'ios') {
        const authStatus = await messaging().requestPermission();
        hasPermission =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      } else {
        const { status } = await Notifications.requestPermissionsAsync();
        hasPermission = status === 'granted';
      }

      if (!hasPermission) {
        console.log('Push notification permission denied');
        return;
      }

      const fcmToken = await messaging().getToken();

      if (fcmToken) {
        await UserService.saveFcmToken(userId, fcmToken);
        fcmTokenRef.current = fcmToken;
        console.log('FCM token registered after login');
      }
    } catch (error) {
      console.log('Error in push notification registration:', error);
    }
  };

  const signInWithEmail = async (email: string, password: string): Promise<User> => {
    try {
      const userData = await AuthService.signInWithEmail(email, password);
      await signIn(userData);
      return userData;
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  const signUpWithEmail = async (email: string, password: string, username: string): Promise<User> => {
    try {
      const userData = await AuthService.signUpWithEmail(email, password, username);
      await signIn(userData);
      return userData;
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  const signInWithGoogle = async (): Promise<User> => {
    try {
      const userData = await AuthService.signInWithGoogle();
      await signIn(userData);
      return userData;
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  const signInWithApple = async (): Promise<User> => {
    try {
      const userData = await AuthService.signInWithApple();
      await signIn(userData);
      return userData;
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  const signOut = async () => {
    try {
      // Remove FCM token before signing out
      if (user?.id && fcmTokenRef.current) {
        await UserService.removeFcmToken(user.id, fcmTokenRef.current);
        fcmTokenRef.current = null;
      }

      await AuthService.signOut();
      await AsyncStorage.removeItem('user_data');
      setUser(null);
    } catch (error) {
      console.log('Error signing out:', error);
    }
  };

  /**
   * Register for push notifications and save FCM token
   * Called after successful login
   */
  const registerForPushNotifications = async (): Promise<void> => {
    if (!user?.id) {
      console.log('Cannot register FCM: no user logged in');
      return;
    }

    try {
      // Request permission
      let hasPermission = false;

      if (Platform.OS === 'ios') {
        const authStatus = await messaging().requestPermission();
        hasPermission =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      } else {
        // Android
        const { status } = await Notifications.requestPermissionsAsync();
        hasPermission = status === 'granted';
      }

      if (!hasPermission) {
        console.log('Push notification permission denied');
        return;
      }

      // Get FCM token
      const fcmToken = await messaging().getToken();

      if (fcmToken) {
        // Save to Firestore
        await UserService.saveFcmToken(user.id, fcmToken);
        fcmTokenRef.current = fcmToken;
        console.log('FCM token registered successfully');
      }
    } catch (error) {
      // Non-blocking - don't throw
      console.log('Error registering for push notifications:', error);
    }
  };

  const skipAuth = async () => {
    try {
      await AsyncStorage.setItem('has_launched_before', 'true');
      setIsFirstLaunch(false);
      setUser(null);
    } catch (error) {
      console.log('Error skipping auth:', error);
    }
  };

  const checkAuthRequired = (): boolean => {
    // Retourne true si l'authentification est requise
    return user === null;
  };

  const initGuestSession = async (): Promise<void> => {
    await initGuestSessionInternal();
  };

  const mergeGuestToUser = async (userId: string): Promise<void> => {
    try {
      const guestData = await guestPreferencesService.exportGuestData();
      if (guestData) {
        const totalInteractions = guestData.likedArticles.length +
          guestData.viewedArticles.length +
          guestData.searches.length;

        console.log('Guest data to merge:', {
          likedCount: guestData.likedArticles.length,
          viewedCount: guestData.viewedArticles.length,
          searchCount: guestData.searches.length,
          totalInteractions,
        });

        // Generate style profile from guest behavior using Gemini AI
        // This is a non-blocking call - errors are handled silently (AC3)
        if (totalInteractions >= 5) {
          generateStyleProfile(guestData).then(profile => {
            console.log('Style profile generated:', profile.styleTags);
          }).catch(error => {
            console.log('Style profile generation failed (silent):', error);
          });
        }
      }
      // Clear guest session after merge
      await guestPreferencesService.clearGuestSession();
      setGuestSession(null);
    } catch (error) {
      console.log('Error merging guest data:', error);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isFirstLaunch,
      isGuest,
      guestSession,
      signIn,
      signOut,
      skipAuth,
      checkAuthRequired,
      signInWithEmail,
      signUpWithEmail,
      signInWithGoogle,
      signInWithApple,
      initGuestSession,
      mergeGuestToUser,
      registerForPushNotifications,
    }}>
      {children}
    </AuthContext.Provider>
  );
};