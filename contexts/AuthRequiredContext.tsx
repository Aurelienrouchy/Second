import React, { createContext, useContext, useRef, ReactNode } from 'react';
import AuthBottomSheet, { AuthBottomSheetRef } from '@/components/AuthBottomSheet';

interface AuthRequiredContextType {
  showAuthSheet: (message?: string, onSuccess?: () => void) => void;
  hideAuthSheet: () => void;
}

const AuthRequiredContext = createContext<AuthRequiredContextType | undefined>(undefined);

interface AuthRequiredProviderProps {
  children: ReactNode;
}

export function AuthRequiredProvider({ children }: AuthRequiredProviderProps) {
  const authBottomSheetRef = useRef<AuthBottomSheetRef>(null);

  const showAuthSheet = (msg?: string, onSuccess?: () => void) => {
    authBottomSheetRef.current?.show(onSuccess, msg);
  };

  const hideAuthSheet = () => {
    authBottomSheetRef.current?.hide();
  };

  return (
    <AuthRequiredContext.Provider value={{ showAuthSheet, hideAuthSheet }}>
      {children}
      <AuthBottomSheet ref={authBottomSheetRef} />
    </AuthRequiredContext.Provider>
  );
}

export function useAuthRequired() {
  const context = useContext(AuthRequiredContext);
  if (context === undefined) {
    throw new Error('useAuthRequired must be used within an AuthRequiredProvider');
  }

  return {
    requireAuth: (action: () => void, message?: string) => {
      context.showAuthSheet(message, action);
    }
  };
}