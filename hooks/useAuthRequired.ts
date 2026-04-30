import { useAuth } from '@/contexts/AuthContext';
import { useAuthSheetStore } from '@/store/authSheetStore';

/**
 * Combine auth state + auth-sheet control for screens that need to
 * gate actions behind a login.
 */
export const useAuthRequired = () => {
  const { user, checkAuthRequired, isLoading } = useAuth();
  const showSheet = useAuthSheetStore((s) => s.show);

  /** Force-show the sheet (e.g. tapping a "Sign in" button). */
  const showAuthSheet = (message?: string, onSuccess?: () => void) => {
    showSheet(message, onSuccess);
  };

  /**
   * Run `action` immediately if the user is signed in; otherwise show
   * the auth sheet and run it on success.
   */
  const requireAuth = (action: () => void, message?: string): boolean => {
    if (checkAuthRequired()) {
      showSheet(message, action);
      return false;
    }
    action();
    return true;
  };

  return {
    user,
    isLoading,
    isLoggedIn: !checkAuthRequired(),
    requireAuth,
    showAuthSheet,
  };
};
