import { AuthService } from '@/services/authService';
import { guestPreferencesService, GuestSession } from '@/services/guestPreferencesService';
import { generateStyleProfile } from '@/services/styleProfileService';
import { UserService } from '@/services/userService';
import { User } from '@/types';
import { ONBOARDING_COMPLETED_KEY, ONBOARDING_PREFERENCES_KEY } from '@/constants/storageKeys';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNotificationStore } from '@/store/notificationStore';
import { functions } from '@/config/firebaseConfig';

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
  refreshUser: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  signUpWithEmail: (email: string, password: string, username: string) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  signInWithApple: () => Promise<User>;
  initGuestSession: () => Promise<void>;
  mergeGuestToUser: (userId: string) => Promise<void>;
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

  // Computed: user is a guest if no user is logged in
  const isGuest = user === null;

  // One-time initialization: auth service + auth state listener
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

    return () => {
      unsubscribe();
    };
  }, []);

  const checkAuthState = async () => {
    try {
      // Vérifier si c'est le premier lancement
      const hasLaunchedBefore = await AsyncStorage.getItem('has_launched_before');
      const savedUser = await AsyncStorage.getItem('user_data');

      if (!hasLaunchedBefore) {
        // Premier lancement — user is already null and isFirstLaunch already true from initial state
        // Initialize guest session for new users
        await initGuestSessionInternal();
      } else {
        // Pas le premier lancement
        setIsFirstLaunch(false);

        if (savedUser) {
          // Utilisateur connecté - aller direct à l'accueil
          setUser(JSON.parse(savedUser));
          // guestSession is already null from initial state
        } else {
          // Utilisateur pas connecté - mode guest (user already null from initial state)
          // Load or create guest session
          await initGuestSessionInternal();
        }
      }
    } catch (error) {
      console.log('Error checking auth state:', error);
      // user is already null and isFirstLaunch already true from initial state
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
      // Push token registration is handled by useNotificationSetup
      // which reacts to user.id changes
    } catch (error) {
      console.log('Error signing in:', error);
    }
  };

  const signInWithEmail = async (email: string, password: string): Promise<User> => {
    try {
      const userData = await AuthService.signInWithEmail(email, password);
      await signIn(userData);
      // Merge guest data (onboarding prefs + behavioral) into the user account
      await mergeGuestToUser(userData.id);
      return userData;
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  const signUpWithEmail = async (email: string, password: string, username: string): Promise<User> => {
    try {
      const userData = await AuthService.signUpWithEmail(email, password, username);
      await signIn(userData);
      // Merge guest data (onboarding prefs + behavioral) into the new user account
      await mergeGuestToUser(userData.id);
      return userData;
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  const signInWithGoogle = async (): Promise<User> => {
    try {
      const userData = await AuthService.signInWithGoogle();
      await signIn(userData);
      // Merge guest data (onboarding prefs + behavioral) into the user account
      await mergeGuestToUser(userData.id);
      return userData;
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  const signInWithApple = async (): Promise<User> => {
    try {
      const userData = await AuthService.signInWithApple();
      await signIn(userData);
      // Merge guest data (onboarding prefs + behavioral) into the user account
      await mergeGuestToUser(userData.id);
      return userData;
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  const signOut = async () => {
    try {
      // Remove FCM token before signing out
      const pushToken = useNotificationStore.getState().pushToken;
      if (user?.id && pushToken) {
        await UserService.removeFcmToken(user.id, pushToken);
      }

      // Reset notification store
      useNotificationStore.getState().reset();

      await AuthService.signOut();
      await AsyncStorage.removeItem('user_data');
      setUser(null);
    } catch (error) {
      console.log('Error signing out:', error);
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

  const refreshUser = async (): Promise<void> => {
    if (!user?.id) return;
    try {
      const freshUser = await UserService.getUserById(user.id);
      if (freshUser) {
        setUser(freshUser);
        await AsyncStorage.setItem('user_data', JSON.stringify(freshUser));
      }
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  };

  const initGuestSession = async (): Promise<void> => {
    await initGuestSessionInternal();
  };

  const mergeGuestToUser = async (userId: string): Promise<void> => {
    try {
      // ── 1. Merge onboarding preferences ──
      // Read preferences saved during onboarding (before account creation)
      const onboardingPrefsRaw = await AsyncStorage.getItem(ONBOARDING_PREFERENCES_KEY);
      if (onboardingPrefsRaw) {
        try {
          const prefs = JSON.parse(onboardingPrefsRaw);
          // Call Cloud Function to save onboarding data to the user's Firestore doc
          const savePrefs = httpsCallable(functions, 'saveOnboardingPreferences');
          await savePrefs({
            sex: prefs.sex,
            sizesTop: prefs.sizesTop || [],
            sizesBottom: prefs.sizesBottom || [],
            sizesShoes: prefs.sizesShoes || [],
            userId,
          });
          console.log('Onboarding preferences merged to user:', userId);
        } catch (prefError) {
          console.log('Error merging onboarding preferences (silent):', prefError);
        }
      }

      // ── 2. Merge guest behavioral data ──
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

  const contextValue = useMemo<AuthContextType>(() => ({
    user,
    isLoading,
    isFirstLaunch,
    isGuest,
    guestSession,
    signIn,
    signOut,
    skipAuth,
    checkAuthRequired,
    refreshUser,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithApple,
    initGuestSession,
    mergeGuestToUser,
  }), [user, isLoading, isFirstLaunch, isGuest, guestSession]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};