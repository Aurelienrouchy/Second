import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { auth } from '@/config/firebaseConfig';
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
 *
 * Also listens for AppState changes: when the app returns from background,
 * it reloads the Firebase Auth user so that external changes (e.g. email
 * verification completed in browser) are picked up immediately.
 */
export function useAuthListener(): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const store = useAuthStore.getState();

    AuthService.initialize().catch((error) => {
      if (__DEV__) console.error('[useAuthListener] AuthService.initialize failed:', error);
    });

    void store.bootstrap();

    const unsubscribe = AuthService.onAuthStateChanged(async (firebaseUser) => {
      await useAuthStore.getState().hydrateFromFirebase(firebaseUser);
    });

    // When the app returns from background, reload the Firebase Auth user
    // to capture external changes (e.g. email changed via verification link
    // opened in the browser).
    const appStateSub = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        const currentUser = auth.currentUser;
        if (currentUser) {
          try {
            await currentUser.reload();
            await useAuthStore.getState().hydrateFromFirebase(currentUser);
          } catch (error) {
            if (__DEV__) console.error('[useAuthListener] foreground reload error:', error);
          }
        }
      }
      appStateRef.current = nextState;
    });

    return () => {
      unsubscribe();
      appStateSub.remove();
    };
  }, []);
}
