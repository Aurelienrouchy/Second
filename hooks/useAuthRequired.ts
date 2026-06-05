import { useUser, useIsGuest } from '@/hooks/useAuth';
import { useAuthSheetStore } from '@/store/authSheetStore';

/**
 * Show the auth sheet. Stable wrapper around the sheet store's `show` action,
 * which is read via `getState()` (stable ref, no subscription / re-render).
 */
function showAuthSheet(message?: string, onSuccess?: () => void): void {
  useAuthSheetStore.getState().show(message, onSuccess);
}

/**
 * Auth-gating for screens/components that only need to gate an ACTION behind a
 * login (no need to read the `user` object itself).
 *
 * Subscribes to a single boolean (`isGuest`) instead of the full `user`
 * object, so hot consumers (ProductCard, SaveSearchButton, favorites,
 * swap-zone, home rails…) no longer re-render every time `user`'s identity
 * changes (e.g. on `refreshUser()`). `isLoading` is intentionally NOT read
 * here — no action-only consumer uses it (AUTH-RR-02).
 */
export const useRequireAuth = () => {
  const isGuest = useIsGuest();
  const isLoggedIn = !isGuest;

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
    isLoggedIn,
    requireAuth,
    showAuthSheet,
  };
};

/**
 * Combine auth state + auth-sheet control for screens that also need the
 * `user` object (not just the gating). Subscribes to `user` (one selector).
 *
 * For action-only gating prefer `useRequireAuth()` above, which subscribes to
 * a single boolean rather than the full `user` object.
 *
 * `isLoading` is no longer exposed here (no consumer read it — AUTH-RR-02).
 * Read it explicitly via `useIsLoading()` where genuinely needed.
 */
export const useAuthRequired = () => {
  const user = useUser();
  const isLoggedIn = user !== null;

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
    isLoggedIn,
    requireAuth,
    showAuthSheet,
  };
};
