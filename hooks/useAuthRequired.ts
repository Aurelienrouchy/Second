import { useUser, useIsLoading } from '@/contexts/AuthContext';
import { useAuthSheetStore } from '@/store/authSheetStore';

/**
 * Combine auth state + auth-sheet control for screens that need to
 * gate actions behind a login.
 *
 * Subscribes only to `user` (one selector) instead of going through the
 * legacy `useAuth()` aggregator. The sheet's `show` action is read via
 * `getState()` since it's a stable reference and we don't need to
 * re-render on its change.
 */
export const useAuthRequired = () => {
  const user = useUser();
  const isLoading = useIsLoading();
  const isLoggedIn = user !== null;

  const showAuthSheet = (message?: string, onSuccess?: () => void) => {
    useAuthSheetStore.getState().show(message, onSuccess);
  };

  /**
   * Run `action` immediately if the user is signed in; otherwise show
   * the auth sheet and run it on success.
   */
  const requireAuth = (action: () => void, message?: string): boolean => {
    if (!isLoggedIn) {
      useAuthSheetStore.getState().show(message, action);
      return false;
    }
    action();
    return true;
  };

  return {
    user,
    isLoading,
    isLoggedIn,
    requireAuth,
    showAuthSheet,
  };
};
