/**
 * Backwards-compatibility shim for the legacy `useAuth()` API.
 *
 * The auth state lives in `store/authStore.ts` (Zustand). This module
 * exposes:
 *  - Focused hooks (preferred): `useUser`, `useIsLoading`, `useIsGuest`,
 *    `useGuestSession`, `useIsFirstLaunch`, `useAuthActions`.
 *  - The legacy `useAuth()` aggregating everything — kept for the ~14
 *    existing consumers but DO NOT use in new code.
 *
 * Why focused hooks: the previous `useAuth()` ran 10 separate selectors
 * and rebuilt a fresh object on every render. Every consumer re-rendered
 * on any auth state change even if they only read `user`. Focused hooks
 * scope the subscription to exactly what each component reads.
 *
 * Multi-field reads use `useShallow` so the returned object identity is
 * stable when the underlying values are the same — required by the
 * project's golden rule (2+ fields from the same store ⇒ useShallow).
 */
import React, { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useAuthStore } from '@/store/authStore';
import { GuestSession } from '@/services/guestPreferencesService';
import { SignupConsent, SocialAuthResult } from '@/services/authService';
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

// ─── Legacy aggregating hook ────────────────────────────────────────────────

export interface AuthContextType {
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
  signUpWithEmail: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<User>;
  signInWithGoogle: () => Promise<SocialAuthResult>;
  signInWithApple: () => Promise<SocialAuthResult>;
  beginPendingConsent: (user: User, onSuccess: (() => void) | null) => void;
  completeConsent: (consent: SignupConsent) => Promise<User>;
  recordSocialConsent: (user: User, consent: SignupConsent) => Promise<User>;
  rollbackSocialSignIn: (isNewUser: boolean) => Promise<void>;
  initGuestSession: () => Promise<void>;
  mergeGuestToUser: (userId: string) => Promise<void>;
}

/**
 * Module-level singleton for `checkAuthRequired` so the function
 * reference is stable across renders. The closure reads from the store
 * via `getState()` — no subscription, no re-render trigger.
 */
const checkAuthRequired = (): boolean =>
  useAuthStore.getState().user === null;

/**
 * @deprecated Prefer `useUser()`, `useIsLoading()`, `useAuthActions()`.
 * Kept for the ~14 existing consumer files; reads only the state with
 * `useShallow` so the returned object reference is stable when nothing
 * relevant changes.
 */
export function useAuth(): AuthContextType {
  const state = useAuthStore(
    useShallow((s) => ({
      user: s.user,
      isLoading: s.isLoading,
      isFirstLaunch: s.isFirstLaunch,
      guestSession: s.guestSession,
    }))
  );
  const actions = useAuthActions();

  return {
    user: state.user,
    isLoading: state.isLoading,
    isFirstLaunch: state.isFirstLaunch,
    isGuest: state.user === null,
    guestSession: state.guestSession,
    checkAuthRequired,
    ...actions,
  };
}

/**
 * No-op for backwards compatibility. The auth listener is mounted via
 * `useAuthListener()` in the root layout; the previous Provider's only
 * job was that listener.
 */
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return <>{children}</>;
};
