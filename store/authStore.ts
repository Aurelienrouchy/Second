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
  /**
   * Social sign-in. Returns `needsConsent: true` for a brand-new or
   * not-yet-consented account — in that case the user is NOT signed into
   * the app yet; the caller must run the mandatory consent step
   * (`recordSocialConsent`) or roll back (`rollbackSocialSignIn`).
   */
  signInWithGoogle: () => Promise<SocialAuthResult>;
  signInWithApple: () => Promise<SocialAuthResult>;
  /** Records consent for the just-authenticated social user, then signs them in. */
  recordSocialConsent: (user: User, consent: SignupConsent) => Promise<User>;
  /**
   * Rolls back a social account that never completed the consent step.
   * `isNewUser` MUST be the value from the originating SocialAuthResult:
   * a brand-new account is deleted, an existing account is only signed out
   * (never destroyed — it may carry a seller balance / orders).
   */
  rollbackSocialSignIn: (isNewUser: boolean) => Promise<void>;
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
          // ── Consent gate (Loi 25 art. 12, 14) ──
          // signInWithCredential crée le compte Auth + le doc users/{uid}
          // (sans dateOfBirth) AVANT que l'écran de consentement obligatoire
          // ne tourne. Le listener global (useAuthListener → ici) ne doit
          // JAMAIS débloquer les capacités tant que le consentement n'est pas
          // enregistré. `dateOfBirth` n'est écrit QUE par le callable serveur
          // recordSignupConsent : son absence prouve le « pas encore consenti ».
          // → on traite ce cas comme non-onboardé : pas d'authentification,
          // session invité conservée, USER_DATA_KEY non persisté. Le flux
          // post-consentement (recordSocialConsent → signIn) ré-authentifie
          // une fois dateOfBirth écrit. Les inscriptions email écrivent
          // dateOfBirth dès le setDoc, donc elles ne sont pas affectées.
          if (!fresh.dateOfBirth) {
            set({ user: null, isLoading: false });
            await AsyncStorage.removeItem(USER_DATA_KEY);
            if (!get().guestSession) {
              await get().initGuestSession();
            }
            return;
          }
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

          // ── Filet de sécurité username ──
          // Le username persistant/immuable est assigné serveur à la création
          // du compte. Pour rattraper les comptes créés avant ce câblage, on
          // (re)déclenche l'assignation si absente. La callable est idempotente
          // (no-op si déjà assigné), donc rappelable sans danger. Fire-and-forget :
          // ne bloque pas le rendu. On rafraîchit le user local au succès pour
          // que le @pseudo apparaisse sans redémarrage.
          if (!fresh.username) {
            void AuthService.ensureUsernameAssigned().then(() => {
              void get().refreshUser();
            });
          }
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
    const result = await AuthService.signInWithGoogle();
    // Nouveau / non-consenti : NE PAS faire entrer dans l'app. Le caller
    // déclenche l'écran de consentement obligatoire (Loi 25).
    if (!result.needsConsent) {
      await get().signIn(result.user);
      await get().mergeGuestToUser(result.user.id);
    }
    return result;
  },

  signInWithApple: async () => {
    const result = await AuthService.signInWithApple();
    if (!result.needsConsent) {
      await get().signIn(result.user);
      await get().mergeGuestToUser(result.user.id);
    }
    return result;
  },

  recordSocialConsent: async (user, consent) => {
    // Persiste dateOfBirth + consents côté serveur (recordSignupConsent),
    // puis fait entrer l'utilisateur dans l'app et merge la session invité.
    const fresh = await AuthService.recordConsentForCurrentUser(consent);
    await get().signIn(fresh);
    await get().mergeGuestToUser(user.id);
    return fresh;
  },

  rollbackSocialSignIn: async (isNewUser) => {
    // Compte BRAND-NEW : supprime le compte Auth + doc user (best-effort).
    // Compte EXISTANT (isNewUser=false) : simple signOut, jamais de
    // suppression destructive (préserve solde/commandes). Dans les deux cas
    // on nettoie l'état local → non-authentifié.
    await AuthService.rollbackUnconsentedAccount(isNewUser);
    set({ ...initialState, isLoading: false });
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
