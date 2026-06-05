/**
 * Canonical source for the focused auth hooks, backed by
 * `store/authStore.ts` (Zustand).
 *
 * Exposes scoped hooks — `useUser`, `useIsLoading`, `useIsFirstLaunch`,
 * `useIsGuest`, `useGuestSession`, `useAuthActions` — each subscribing to
 * exactly what the consumer reads. This avoids the old `useAuth()`
 * aggregator that rebuilt a fresh object on every render and forced every
 * consumer to re-render on any auth state change.
 *
 * Multi-field reads use `useShallow` so the returned object identity is
 * stable when the underlying values are the same — required by the
 * project's golden rule (2+ fields from the same store ⇒ useShallow).
 *
 * The auth-gating hook `useAuthRequired` lives in `@/hooks/useAuthRequired`.
 */
import { useShallow } from 'zustand/react/shallow';

import { useAuthStore } from '@/store/authStore';
import { GuestSession } from '@/services/guestPreferencesService';
import { User } from '@/types';

// ─── Focused hooks ──────────────────────────────────────────────────────────

export const useUser = (): User | null => useAuthStore((s) => s.user);
export const useIsLoading = (): boolean => useAuthStore((s) => s.isLoading);
export const useIsFirstLaunch = (): boolean => useAuthStore((s) => s.isFirstLaunch);
export const useIsGuest = (): boolean => useAuthStore((s) => s.user === null);
export const useGuestSession = (): GuestSession | null =>
  useAuthStore((s) => s.guestSession);

/**
 * Returns ALL auth actions in one shallow-equal object so the reference
 * is stable across renders. Actions in Zustand are themselves stable,
 * but the wrapper object would otherwise be new on every render.
 */
export const useAuthActions = () =>
  useAuthStore(
    useShallow((s) => ({
      signIn: s.signIn,
      signOut: s.signOut,
      skipAuth: s.skipAuth,
      refreshUser: s.refreshUser,
      signInWithEmail: s.signInWithEmail,
      signUpWithEmail: s.signUpWithEmail,
      signInWithGoogle: s.signInWithGoogle,
      signInWithApple: s.signInWithApple,
      beginPendingConsent: s.beginPendingConsent,
      completeConsent: s.completeConsent,
      recordSocialConsent: s.recordSocialConsent,
      rollbackSocialSignIn: s.rollbackSocialSignIn,
      initGuestSession: s.initGuestSession,
      mergeGuestToUser: s.mergeGuestToUser,
    }))
  );
