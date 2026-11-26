import AsyncStorage from '@/utils/environmentStorage';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import { doc, updateDoc } from 'firebase/firestore';

import { auth, firestore } from '@/config/firebaseConfig';
import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import { identifyUser, resetAnalytics, setAnalyticsUserConsent, suspendAnalytics, track } from '@/lib/analytics';
import { queryClient } from '@/lib/queryClient';
import { AuthService } from '@/services/authService';
import type { SignupConsent, SocialAuthResult } from '@/services/authService';
import { guestPreferencesService } from '@/services/guestPreferencesService';
import type { GuestSession } from '@/services/guestPreferencesService';
import { mergeGuestDataIntoUser } from '@/services/authMergeService';
import { getUserById, removeExpoPushToken, removeFcmToken } from '@/services/userAuthData';
import { useChatStore } from '@/store/chatStore';
import { useImmersiveOverlayStore } from '@/store/immersiveOverlayStore';
import { useNotificationStore } from '@/store/notificationStore';
import type { User } from '@/types';
import { computeAgeFromIso } from '@/utils/age';

const USER_DATA_KEY = 'user_data';
const HAS_LAUNCHED_KEY = 'has_launched_before';
let sessionGeneration = 0;
interface LogoutOperation { generation: number; providerPending: boolean; nullObserved: boolean }
let pendingLogout: LogoutOperation | null = null;
export const getAuthSessionGeneration = () => sessionGeneration;
let cacheWrites: Promise<void> = Promise.resolve();
function writeSessionCache(user: User | null, generation = sessionGeneration): Promise<void> {
  const next = cacheWrites.catch(() => {}).then(async () => {
    if (generation !== sessionGeneration) return;
    if (user) await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
    else await AsyncStorage.removeItem(USER_DATA_KEY);
  });
  cacheWrites = next;
  return next;
}
const hasInitialDate = (user: User) => user.dateOfBirth != null && user.dateOfBirth !== '';
const hasNormalProfile = (user: User) => typeof user.dateOfBirth === 'string' && (computeAgeFromIso(user.dateOfBirth) ?? -1) >= 0;


// PostHog identify — hydration point (catalogue §2). Pseudonymous product
// traits: username is a public @pseudo (allowed as a user property), never the
// email/displayName. distinct_id = Firebase uid.
async function analyticsIdentify(user: User, fromCache = false): Promise<void> {
  suspendAnalytics();
  // Keep the new identity pending while consent is unknown, so an account
  // switch can never capture against the previous person's identity.
  identifyUser(user.id, {
    username: user.username,
    signup_method: user.authProvider,
    created_at: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
    province: user.address?.province,
    has_shop: user.accountType === 'shop',
    seller_onboarded: !!(user.stripeChargesEnabled && user.stripePayoutsEnabled),
    articles_count: user.articlesCount,
    marketing_consent: user.preferences?.marketingConsent,
    onboarding_completed: user.onboardingCompleted,
  });
  // Offline account cache can predate a refusal saved on this device.
  await setAnalyticsUserConsent(fromCache
    ? (user.preferences?.analyticsConsent === false ? false : undefined)
    : (user.preferences?.analyticsConsent ?? true));
}

// ─── State shape ────────────────────────────────────────────────────────────

interface AuthState {
  /** Firebase identity for explicit owner reads only; never grants normal capabilities. */
  authenticatedUid: string | null;
  identityUser: User | null;
  identityError: boolean;
  user: User | null;
  isLoading: boolean;
  isFirstLaunch: boolean;
  guestSession: GuestSession | null;
  /** Initial date missing: normal account capabilities remain closed. This is
   * neither proof of missing historical consent nor a block on explicit owner
   * reads. Consent collection is still required for the first declaration. */
  pendingConsent: boolean;
  /** Owner profile for the signup context; missing-DOB data is never persisted
   * to the normal account cache or treated as accepted legal/marketing consent. */
  pendingConsentUser: User | null;
  /**
   * Success callback to fire AFTER the consent route completes — threaded from
   * the auth sheet (e.g. resume a protected action). Fired once on completion,
   * then cleared. Null when no protected action was pending.
   */
  pendingConsentOnSuccess: (() => void) | null;
}

interface AuthActions {
  /** Called by useAuthListener after onAuthStateChanged resolves. */
  hydrateFromFirebase: (firebaseUser: unknown) => Promise<void>;
  /** Called once at startup to read AsyncStorage flags. */
  bootstrap: () => Promise<void>;

  signIn: (user: User) => Promise<void>;
  /** `skipRemoteFcmCleanup` skips the Firestore FCM write when the auth token is already invalid (account deleted / revoked). */
  signOut: (opts?: { skipRemoteFcmCleanup?: boolean; expectedUid?: string; expectedGeneration?: number }) => Promise<void>;
  skipAuth: () => Promise<void>;
  refreshUser: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<User>;
  /**
   * Creates a BARE Firebase account (no DOB/consent/username). Does NOT sign the
   * user into the app: the mandatory consent route (app/complete-profile.tsx)
   * runs next and calls `completeConsent`. After creation the Firebase listener
   * will hydrate the user as `pendingConsent` (no dateOfBirth yet).
   */
  signUpWithEmail: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<User>;
  /**
   * Marks a freshly authenticated (email or social) account as `pendingConsent`
   * so the startup guard routes to app/complete-profile.tsx. Called by the auth
   * sheet right after a bare email signup OR a social sign-in that `needsConsent`.
   * `onSuccess` is threaded from the sheet and fired once consent completes.
   */
  beginPendingConsent: (user: User, onSuccess: (() => void) | null) => void;
  /**
   * Completes the mandatory consent step for the current pendingConsent user
   * (email AND social). STRICT ORDER (audit A6): recordSignupConsent (reserves
   * @pseudo + writes DOB atomically) → signIn (flip authenticated) →
   * mergeGuestToUser. Then clears pendingConsent and fires pendingConsentOnSuccess.
   * Throws the raw callable error (FirebaseError) so the route can map error.code
   * / error.details to inline messages; on failure the user does NOT enter the app.
   */
  completeConsent: (consent: SignupConsent, context?: { assertCurrent: () => void }) => Promise<User>;
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
  authenticatedUid: null,
  identityUser: null,
  identityError: false,
  user: null,
  isLoading: true,
  isFirstLaunch: true,
  guestSession: null,
  pendingConsent: false,
  pendingConsentUser: null,
  pendingConsentOnSuccess: null,
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
    // A queued null payload is obsolete when Firebase already has a new owner.
    // Never let that old observer payload invalidate the current session.
    if (!firebaseUser && auth.currentUser) return;
    const generation = ++sessionGeneration;
    const fb = firebaseUser as { uid?: string; email?: string | null } | null;
    const uid = fb?.uid ?? null;
    const logout = pendingLogout;
    if (!uid && logout?.providerPending && !logout.nullObserved &&
        get().authenticatedUid === null && generation === logout.generation + 1) {
      // Adopt only the immediate coherent null callback of this provider call.
      logout.generation = generation; logout.nullObserved = true;
    } else {
      pendingLogout = null;
    }
    const isCurrent = () => generation === sessionGeneration && get().authenticatedUid === uid;
    suspendAnalytics();
    // Clear all private account data before awaiting a different identity.
    if (uid !== get().authenticatedUid) {
      queryClient.clear();
      set({ user: null, identityUser: null, pendingConsent: false,
        pendingConsentUser: null, pendingConsentOnSuccess: null });
    }
    set({ authenticatedUid: uid, identityError: false, isLoading: true });
    if (!uid) {
      set({ user: null, identityUser: null, isLoading: false, pendingConsent: false,
        pendingConsentUser: null, pendingConsentOnSuccess: null });
      await writeSessionCache(null);
      if (!isCurrent()) return;
      await setAnalyticsUserConsent();
      if (isCurrent() && !get().guestSession) await get().initGuestSession();
      return;
    }
    try {
      const fresh = await AuthService.getCurrentUser(uid);
      if (!isCurrent()) return;
      if (fresh && fresh.id !== uid) throw new Error('Profile identity mismatch');
      if (!fresh) {
        // A real missing profile is an incomplete signup, not an offline success.
        set({ user: null, identityUser: null, isLoading: false, pendingConsent: true, pendingConsentUser: null });
        await writeSessionCache(null);
        return;
      }
      if (!hasInitialDate(fresh)) {
        set({ user: null, identityUser: fresh, isLoading: false, pendingConsent: true, pendingConsentUser: fresh });
        await writeSessionCache(null);
        return;
      }
      if (!hasNormalProfile(fresh)) {
        set({ user: null, identityUser: fresh, isLoading: false, pendingConsent: false, pendingConsentUser: null });
        await writeSessionCache(null);
        return;
      }
      if (fb?.email && fresh.email !== fb.email) {
        await updateDoc(doc(firestore, 'users', uid), { email: fb.email });
        if (!isCurrent()) return;
        fresh.email = fb.email;
      }
      set({ user: fresh, identityUser: fresh, isLoading: false, pendingConsent: false, pendingConsentUser: null });
      await writeSessionCache(fresh, generation);
      if (!isCurrent()) return;
      await analyticsIdentify(fresh);
      if (!fresh.username) {
        void AuthService.ensureUsernameAssigned().then(() => {
          if (isCurrent()) void get().refreshUser();
        }).catch(() => { /* Optional username recovery never changes admission. */ });
      }
    } catch (error) {
      if (!isCurrent()) return;
      // Only the same confirmed Firebase UID may reuse its read cache. No cache
      // is a normal admission result; errors remain visible to owner screens.
      let cachedUser: User | null = null;
      try {
        const cached = await AsyncStorage.getItem(USER_DATA_KEY);
        const parsed = cached ? JSON.parse(cached) as User : null;
        if (parsed?.id === uid && hasInitialDate(parsed)) {
          cachedUser = { ...parsed, createdAt: new Date(parsed.createdAt) };
        }
      } catch { /* Corrupt cache is ignored. */ }
      if (!isCurrent()) return;
      set({ user: null, identityUser: cachedUser, isLoading: false, identityError: true,
        pendingConsent: false, pendingConsentUser: null });
      if (__DEV__) console.error('[authStore] identity read failed:', error);
    }
  },

  signIn: async (userData) => {
    pendingLogout = null;
    const generation = ++sessionGeneration;
    const normal = get().user;
    const sameOwner = get().authenticatedUid === userData.id && normal?.id === userData.id;
    suspendAnalytics();
    if (get().authenticatedUid !== userData.id) { queryClient.clear(); set({ pendingConsentOnSuccess: null }); }
    if (!hasNormalProfile(userData)) {
      set({ user: null, authenticatedUid: userData.id, identityUser: userData,
        identityError: false, pendingConsent: !hasInitialDate(userData), pendingConsentUser: hasInitialDate(userData) ? null : userData, isLoading: false });
      await writeSessionCache(null);
      return;
    }
    set({ user: sameOwner ? normal : null, authenticatedUid: userData.id,
      identityUser: userData, identityError: false, pendingConsent: false, pendingConsentUser: null });
    try {
      await writeSessionCache(userData, generation);
      if (generation !== sessionGeneration) return;
      await AsyncStorage.setItem(HAS_LAUNCHED_KEY, 'true');
      if (generation !== sessionGeneration) return;
      await analyticsIdentify(userData);
      if (generation !== sessionGeneration) return;
      // Flip authenticated + clear any pendingConsent residue (the consent
      // completion path calls signIn once dateOfBirth is written).
      set({
        user: userData,
        isFirstLaunch: false,
        pendingConsent: false,
        pendingConsentUser: null,
      });
    } catch (error) {
      if (__DEV__) console.log('[authStore] signIn error:', error);
    }
  },

  signOut: async (opts) => {
    if ((opts?.expectedGeneration !== undefined && opts.expectedGeneration !== sessionGeneration) ||
        (opts?.expectedUid && (get().authenticatedUid !== opts.expectedUid || auth.currentUser?.uid !== opts.expectedUid))) return;
    const closingFirebaseUser = auth.currentUser;
    const logout: LogoutOperation = { generation: ++sessionGeneration, providerPending: false, nullObserved: false };
    pendingLogout = logout;
    const isCurrentLogout = () => pendingLogout === logout && sessionGeneration === logout.generation && get().authenticatedUid === null &&
      (auth.currentUser === null || auth.currentUser === closingFirebaseUser);
    const { user } = get();
    set({ user: null, identityUser: null, authenticatedUid: null, pendingConsent: false,
      pendingConsentUser: null, pendingConsentOnSuccess: null });
    try {
      const pushToken = useNotificationStore.getState().pushToken;
      // Skip the remote FCM write when the token is already revoked (delete/disable) — it can only permission-deny.
      if (!opts?.skipRemoteFcmCleanup && user?.id && (pushToken || runtimeEnvironment.name === 'development')) {
        try {
          if (runtimeEnvironment.name === 'development' || /^(Exponent|Expo)PushToken\[/.test(pushToken!)) {
            await removeExpoPushToken(user.id, pushToken ?? '');
          } else {
            await removeFcmToken(user.id, pushToken!);
          }
        } catch (fcmError) {
          if (__DEV__) console.log('[authStore] removeFcmToken non-critical error:', fcmError);
        }
      }
      if (!isCurrentLogout()) return;
      // Reset siblings inline — calling store/resetAllStores would
      // create a circular module graph (authStore → resetAllStores →
      // authStore). Self-reset uses local `set` so we don't loop.
      useNotificationStore.getState().reset();
      useChatStore.getState().reset();
      useImmersiveOverlayStore.getState().reset();
      queryClient.clear();
      logout.providerPending = true;
      await AuthService.signOut({ expectedUid: opts?.expectedUid, isCurrent: isCurrentLogout });
      logout.providerPending = false;
      if (!isCurrentLogout()) return;
      await writeSessionCache(null, logout.generation);
      if (!isCurrentLogout()) return;
      // Fire BEFORE reset so the event stays attributed to the signed-out user.
      track('user_signed_out', {
        source: opts?.skipRemoteFcmCleanup ? 'account_deletion' : 'user_action',
      });
      resetAnalytics();
      set({ ...initialState, isLoading: false });
    } catch (error) {
      if (__DEV__) console.log('[authStore] signOut error:', error);
    } finally {
      if (pendingLogout === logout) pendingLogout = null;
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
    const uid = get().authenticatedUid ?? get().user?.id;
    const generation = sessionGeneration;
    if (!uid) return;
    try {
      const fresh = await getUserById(uid);
      if (generation !== sessionGeneration || get().authenticatedUid !== uid || !fresh || fresh.id !== uid) return;
      set({ identityUser: fresh, user: hasNormalProfile(fresh) ? fresh : null,
        pendingConsent: !hasInitialDate(fresh), pendingConsentUser: hasInitialDate(fresh) ? null : fresh, identityError: false });
      if (hasInitialDate(fresh)) await writeSessionCache(fresh, generation);
      else await writeSessionCache(null);
    } catch (error) {
      if (generation === sessionGeneration) set({ identityError: true });
      if (__DEV__) console.error('[authStore] refreshUser error:', error);
    }
  },

  signInWithEmail: async (email, password) => {
    const userData = await AuthService.signInWithEmail(email, password);
    await get().signIn(userData);
    if (get().user?.id === userData.id) await get().mergeGuestToUser(userData.id);
    return userData;
  },

  signUpWithEmail: async (email, password, displayName) => {
    // Crée le compte NU. NE PAS signIn ni merge ici : la route de consentement
    // obligatoire (app/complete-profile.tsx) collecte DOB + consents + @pseudo
    // puis appelle completeConsent qui orchestre l'entrée dans l'app. Le caller
    // (auth sheet) appelle beginPendingConsent + navigue vers la route.
    const userData = await AuthService.signUpWithEmail(email, password, displayName);
    return userData;
  },

  beginPendingConsent: (user, onSuccess) => {
    // Marque le compte fraîchement créé/authentifié comme en attente de
    // consentement → le guard de démarrage route vers app/complete-profile.tsx.
    // `user` reste null (pas pleinement connecté) tant que completeConsent n'a
    // pas écrit dateOfBirth. onSuccess sera rejoué à la complétion.
    pendingLogout = null;
    ++sessionGeneration;
    set({
      user: null, authenticatedUid: user.id, identityUser: user, identityError: false,
      pendingConsent: true,
      pendingConsentUser: user,
      pendingConsentOnSuccess: onSuccess,
    });
  },

  completeConsent: async (consent, context) => {
    // ── Ordre strict (audit A6) ──
    // 1) recordSignupConsent : réserve @pseudo + écrit DOB atomiquement. Si le
    //    pseudo est pris (already-exists) ou le format/âge KO, l'erreur remonte
    //    telle quelle (FirebaseError) ; on NE fait PAS entrer l'user dans l'app
    //    et on NE touche PAS pendingConsent (il re-soumet avec un autre pseudo).
    // Captured before mergeGuestToUser clears the guest session.
    const hadGuestSession = get().guestSession !== null;
    const uid = get().authenticatedUid;
    const generation = sessionGeneration;
    const fresh = await AuthService.recordConsentForCurrentUser(consent, context);
    if (generation !== sessionGeneration || (uid && fresh.id !== uid)) throw new Error('La session a changé.');
    context?.assertCurrent();
    // 2) signIn : flip authentifié (efface pendingConsent + persiste le cache).
    await get().signIn(fresh);
    const assertAdopted = () => {
      if (sessionGeneration !== generation + 1 || auth.currentUser?.uid !== fresh.id ||
          get().authenticatedUid !== fresh.id || get().user?.id !== fresh.id) throw new Error('La session a changé.');
    };
    assertAdopted();
    await AuthService.acknowledgeSignupConsent(consent, {assertCurrent: assertAdopted});
    assertAdopted();
    // 3) mergeGuestToUser : rattache la session invité au compte.
    const completedGeneration = sessionGeneration;
    await get().mergeGuestToUser(fresh.id);
    if (completedGeneration !== sessionGeneration || get().user?.id !== fresh.id) throw new Error('La session a changé.');

    // Rejoue le callback de reprise (action protégée) puis le nettoie.
    const onSuccess = get().pendingConsentOnSuccess;
    // POINT DE CONVERSION — capte email + social + reprise à froid (catalogue §5).
    track('signup_completed', {
      signup_method: fresh.authProvider ?? 'email',
      marketing_opt_in: consent.marketingOptIn,
      had_guest_session: hadGuestSession,
      had_pending_action: onSuccess != null,
    });
    set({ pendingConsentOnSuccess: null });
    if (onSuccess) {
      try {
        onSuccess();
      } catch (error) {
        if (__DEV__) console.log('[authStore] pendingConsentOnSuccess error:', error);
      }
    }
    return fresh;
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

  // @deprecated Remplacé par `completeConsent` (route plein écran). Conservé
  // pour le shim AuthContext + les tests historiques. N'orchestre PAS le pseudo
  // ni le pendingConsentOnSuccess — ne pas utiliser en code neuf.
  recordSocialConsent: async (user, consent) => {
    const fresh = await AuthService.recordConsentForCurrentUser(consent);
    await get().signIn(fresh);
    await get().mergeGuestToUser(user.id);
    return fresh;
  },

  // @deprecated Le nouveau flux ne rollback plus à la fermeture : un compte
  // non-consenti reste `pendingConsent` et le guard de démarrage le ramène à la
  // route. Conservé pour le shim + tests (filet de sécurité signOut/suppression).
  rollbackSocialSignIn: async (isNewUser) => {
    await AuthService.rollbackUnconsentedAccount(isNewUser);
    set({ ...initialState, isLoading: false });
  },

  initGuestSession: async () => {
    try {
      let session = await guestPreferencesService.getGuestSession();
      if (!session) {
        session = await guestPreferencesService.createGuestSession();
        track('guest_session_started', { is_first_launch: get().isFirstLaunch });
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

  reset: () => { pendingLogout = null; ++sessionGeneration; set(initialState); },
  }))
);

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectUser = (s: AuthStore) => s.user;
export const selectIsAuthenticated = (s: AuthStore) => s.user !== null;
export const selectIsGuest = (s: AuthStore) => s.user === null;
export const selectIsLoading = (s: AuthStore) => s.isLoading;
export const selectPendingConsent = (s: AuthStore) => s.pendingConsent;
export const selectPendingConsentUser = (s: AuthStore) => s.pendingConsentUser;
