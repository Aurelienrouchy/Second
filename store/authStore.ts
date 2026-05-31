import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import { doc, updateDoc } from 'firebase/firestore';

import { firestore } from '@/config/firebaseConfig';
import { queryClient } from '@/lib/queryClient';
import { AuthService, SignupConsent, SocialAuthResult } from '@/services/authService';
import {
  guestPreferencesService,
  GuestSession,
} from '@/services/guestPreferencesService';
import { mergeGuestDataIntoUser } from '@/services/authMergeService';
import { UserService } from '@/services/userService';
import { useChatStore } from '@/store/chatStore';
import { useNotificationStore } from '@/store/notificationStore';
import { User } from '@/types';

const USER_DATA_KEY = 'user_data';
const HAS_LAUNCHED_KEY = 'has_launched_before';

// ─── State shape ────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isFirstLaunch: boolean;
  guestSession: GuestSession | null;
}

interface AuthActions {
  /** Called by useAuthListener after onAuthStateChanged resolves. */
  hydrateFromFirebase: (firebaseUser: unknown) => Promise<void>;
  /** Called once at startup to read AsyncStorage flags. */
  bootstrap: () => Promise<void>;

  signIn: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
  skipAuth: () => Promise<void>;
  refreshUser: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  signUpWithEmail: (
    email: string,
    password: string,
    username: string,
    consent: SignupConsent,
  ) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  signInWithApple: () => Promise<User>;
  initGuestSession: () => Promise<void>;
  mergeGuestToUser: (userId: string) => Promise<void>;

  reset: () => void;
}

type AuthStore = AuthState & AuthActions;

// ─── Initial state (extracted for reset) ────────────────────────────────────

const initialState: AuthState = {
  user: null,
  isLoading: true,
  isFirstLaunch: true,
  guestSession: null,
};

// ─── Store ──────────────────────────────────────────────────────────────────

/**
 * Auth store — replaces the previous AuthContext. Why a Zustand store:
 *
 * - Only components that subscribe re-render (Context broadcast caused
 *   the entire tree under <AuthProvider> to re-render on every change).
 * - Non-React code (services, utils) can read auth state directly.
 * - resetAllStores() can include it for clean logout.
 *
 * The race condition between AsyncStorage hydrate and onAuthStateChanged
 * is gone: the Firebase listener is the only writer that flips
 * `isLoading: false`. AsyncStorage is read in `bootstrap` solely to
 * decide isFirstLaunch and guest session.
 */
export const useAuthStore = create<AuthStore>()(
  subscribeWithSelector((set, get) => ({
  ...initialState,

  bootstrap: async () => {
    try {
      const hasLaunchedBefore = await AsyncStorage.getItem(HAS_LAUNCHED_KEY);
      if (hasLaunchedBefore) {
        set({ isFirstLaunch: false });
      } else {
        // Initialize a guest session for first-time users so their
        // pre-account behaviour can be merged once they sign up.
        await get().initGuestSession();
      }
    } catch (error) {
      if (__DEV__) console.log('[authStore] bootstrap error:', error);
    }
  },

  hydrateFromFirebase: async (firebaseUser) => {
    try {
      if (firebaseUser) {
        const fresh = await AuthService.getCurrentUser();
        if (fresh) {
          // Sync email if Firebase Auth has a different (verified) email than Firestore
          const fbUser = firebaseUser as { email?: string | null; uid?: string };
          if (fbUser.email && fresh.email !== fbUser.email) {
            await updateDoc(doc(firestore, 'users', fresh.id), {
              email: fbUser.email,
            });
            fresh.email = fbUser.email;
          }
          set({ user: fresh, isLoading: false });
          await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(fresh));
          return;
        }
      }
      set({ user: null, isLoading: false });
      await AsyncStorage.removeItem(USER_DATA_KEY);
      // No user yet → make sure a guest session exists for tracking.
      if (!get().guestSession) {
        await get().initGuestSession();
      }
    } catch (error) {
      if (__DEV__) console.error('[authStore] hydrateFromFirebase error:', error);
      set({ isLoading: false });
    }
  },

  signIn: async (userData) => {
    try {
      await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(userData));
      await AsyncStorage.setItem(HAS_LAUNCHED_KEY, 'true');
      set({ user: userData, isFirstLaunch: false });
    } catch (error) {
      if (__DEV__) console.log('[authStore] signIn error:', error);
    }
  },

  signOut: async () => {
    const { user } = get();
    try {
      const pushToken = useNotificationStore.getState().pushToken;
      if (user?.id && pushToken) {
        await UserService.removeFcmToken(user.id, pushToken);
      }
      // Reset siblings inline — calling store/resetAllStores would
      // create a circular module graph (authStore → resetAllStores →
      // authStore). Self-reset uses local `set` so we don't loop.
      useNotificationStore.getState().reset();
      useChatStore.getState().reset();
      queryClient.clear();
      await AuthService.signOut();
      await AsyncStorage.removeItem(USER_DATA_KEY);
      set({ ...initialState, isLoading: false });
    } catch (error) {
      if (__DEV__) console.log('[authStore] signOut error:', error);
    }
  },

  skipAuth: async () => {
    try {
      await AsyncStorage.setItem(HAS_LAUNCHED_KEY, 'true');
      set({ isFirstLaunch: false, user: null });
    } catch (error) {
      if (__DEV__) console.log('[authStore] skipAuth error:', error);
    }
  },

  refreshUser: async () => {
    const current = get().user;
    if (!current?.id) return;
    try {
      const fresh = await UserService.getUserById(current.id);
      if (fresh) {
        set({ user: fresh });
        await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(fresh));
      }
    } catch (error) {
      if (__DEV__) console.error('[authStore] refreshUser error:', error);
    }
  },

  signInWithEmail: async (email, password) => {
    const userData = await AuthService.signInWithEmail(email, password);
    await get().signIn(userData);
    await get().mergeGuestToUser(userData.id);
    return userData;
  },

  signUpWithEmail: async (email, password, username, consent) => {
    const userData = await AuthService.signUpWithEmail(email, password, username, consent);
    await get().signIn(userData);
    await get().mergeGuestToUser(userData.id);
    return userData;
  },

  signInWithGoogle: async () => {
    const userData = await AuthService.signInWithGoogle();
    await get().signIn(userData);
    await get().mergeGuestToUser(userData.id);
    return userData;
  },

  signInWithApple: async () => {
    const userData = await AuthService.signInWithApple();
    await get().signIn(userData);
    await get().mergeGuestToUser(userData.id);
    return userData;
  },

  initGuestSession: async () => {
    try {
      let session = await guestPreferencesService.getGuestSession();
      if (!session) {
        session = await guestPreferencesService.createGuestSession();
      }
      set({ guestSession: session });
    } catch (error) {
      if (__DEV__) console.log('[authStore] initGuestSession error:', error);
    }
  },

  mergeGuestToUser: async (userId) => {
    try {
      await mergeGuestDataIntoUser(userId);
    } catch (error) {
      if (__DEV__) console.log('[authStore] mergeGuestToUser error:', error);
    } finally {
      // Even if merge fails, drop the guest session — staying in guest
      // mode after sign-up would re-attribute future events to the wrong
      // entity.
      try {
        await guestPreferencesService.clearGuestSession();
      } catch {}
      set({ guestSession: null });
    }
  },

  reset: () => set(initialState),
  }))
);

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectUser = (s: AuthStore) => s.user;
export const selectIsAuthenticated = (s: AuthStore) => s.user !== null;
export const selectIsGuest = (s: AuthStore) => s.user === null;
export const selectIsLoading = (s: AuthStore) => s.isLoading;
