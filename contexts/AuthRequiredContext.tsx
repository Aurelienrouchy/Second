/**
 * Backwards-compatibility shim.
 *
 * The old AuthRequiredContext held an imperative ref to <AuthBottomSheet>.
 * That pattern violated the CLAUDE.md "shared modal" rule (one render +
 * store-driven). The bottom sheet is now rendered once in the root
 * layout and driven by `authSheetStore`. This file is kept only so
 * existing imports keep compiling.
 */
import React, { ReactNode } from 'react';

import { useAuthSheetStore } from '@/store/authSheetStore';

export interface AuthRequiredContextType {
  showAuthSheet: (message?: string, onSuccess?: () => void) => void;
  hideAuthSheet: () => void;
}

/** No-op for backwards compatibility — sheet now lives in root layout. */
export const AuthRequiredProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return <>{children}</>;
};

export function useAuthRequired() {
  const show = useAuthSheetStore((s) => s.show);
  return {
    requireAuth: (action: () => void, message?: string) => {
      show(message, action);
    },
  };
}
