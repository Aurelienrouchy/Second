import { useAuth } from '@/contexts/AuthContext';
import { useAuthRequired as useAuthRequiredContext } from '@/contexts/AuthRequiredContext';

export const useAuthRequired = () => {
  const { user, checkAuthRequired, isLoading } = useAuth();
  const { requireAuth: showAuthSheetWithAction } = useAuthRequiredContext();

  /**
   * Show auth bottom sheet with optional success callback and message
   * Use this when you want to force show the auth modal
   */
  const showAuthSheet = (message?: string, onSuccess?: () => void) => {
    showAuthSheetWithAction(onSuccess || (() => {}), message);
  };

  /**
   * Conditionally require auth - if user is logged in, execute action
   * Otherwise show auth modal with callback to execute action on success
   */
  const requireAuth = (action: () => void, message?: string) => {
    if (checkAuthRequired()) {
      showAuthSheetWithAction(action, message);
      return false;
    } else {
      action();
      return true;
    }
  };

  return {
    user,
    isLoading,
    isLoggedIn: !checkAuthRequired(),
    requireAuth,
    showAuthSheet,
  };
};