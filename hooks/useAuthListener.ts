import { useEffect } from 'react';

import { AuthService } from '@/services/authService';
import { useAuthStore } from '@/store/authStore';

/**
 * Mount the Firebase Auth listener exactly once.
 *
 * Call from the root layout. The listener is the single source of truth
 * for `authStore.user` and is the only writer that flips
 * `authStore.isLoading` to `false`. AsyncStorage is read in
 * `bootstrap()` solely for first-launch detection / guest session — it
 * never decides whether the user is authenticated, fixing the original
 * AuthContext race condition where AsyncStorage hydration could ship a
 * stale (potentially revoked) user before Firebase confirmed.
 */
export function useAuthListener(): void {
  useEffect(() => {
    const store = useAuthStore.getState();

    AuthService.initialize().catch((error) => {
      if (__DEV__) console.error('[useAuthListener] AuthService.initialize failed:', error);
    });

    void store.bootstrap();

    const unsubscribe = AuthService.onAuthStateChanged(async (firebaseUser) => {
      await useAuthStore.getState().hydrateFromFirebase(firebaseUser);
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
