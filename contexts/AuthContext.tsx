/**
 * Backwards-compatibility shim.
 *
 * The auth state previously lived in a React Context. It now lives in
 * `store/authStore.ts` (Zustand). To avoid touching the ~14 consumer
 * files at once, this module re-exports a `useAuth()` hook with the same
 * shape as the old `AuthContextType`. Future PRs can migrate consumers
 * to use `useAuthStore` selectors directly for finer-grained subscriptions.
 *
 * `AuthProvider` is preserved as a no-op `<>{children}</>` so existing
 * imports keep compiling; the listener that used to live in the provider
 * now runs in `useAuthListener` mounted from the root layout.
 */
import React, { ReactNode } from 'react';

import { useAuthStore } from '@/store/authStore';
import { GuestSession } from '@/services/guestPreferencesService';
import { User } from '@/types';

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
  signUpWithEmail: (email: string, password: string, username: string) => Promise<User>;
  signInWithGoogle: () => Promise<User>;
  signInWithApple: () => Promise<User>;
  initGuestSession: () => Promise<void>;
  mergeGuestToUser: (userId: string) => Promise<void>;
}

export function useAuth(): AuthContextType {
  // Subscribe to the fields a consumer might read; actions are stable
  // references in Zustand so they don't need to be memoised.
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isFirstLaunch = useAuthStore((s) => s.isFirstLaunch);
  const guestSession = useAuthStore((s) => s.guestSession);

  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);
  const skipAuth = useAuthStore((s) => s.skipAuth);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);
  const initGuestSession = useAuthStore((s) => s.initGuestSession);
  const mergeGuestToUser = useAuthStore((s) => s.mergeGuestToUser);

  return {
    user,
    isLoading,
    isFirstLaunch,
    isGuest: user === null,
    guestSession,
    signIn,
    signOut,
    skipAuth,
    checkAuthRequired: () => user === null,
    refreshUser,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithApple,
    initGuestSession,
    mergeGuestToUser,
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
