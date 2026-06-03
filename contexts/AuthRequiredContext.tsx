/**
 * Backwards-compatibility shim.
 *
 * The old AuthRequiredContext held an imperative ref to <AuthBottomSheet>.
 * That pattern violated the CLAUDE.md "shared modal" rule (one render +
 * store-driven). The bottom sheet is now rendered once in the root
 * layout and driven by `authSheetStore`.
 *
 * `useAuthRequired` is now a re-export of the canonical hook
 * (`@/hooks/useAuthRequired`) so the two never diverge — there is a single
 * source of truth. This file is kept only so existing imports keep compiling;
 * prefer importing from `@/hooks/useAuthRequired` directly in new code.
 */
import React, { ReactNode } from 'react';

export { useAuthRequired } from '@/hooks/useAuthRequired';

export interface AuthRequiredContextType {
  showAuthSheet: (message?: string, onSuccess?: () => void) => void;
  hideAuthSheet: () => void;
}

/** No-op for backwards compatibility — sheet now lives in root layout. */
export const AuthRequiredProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return <>{children}</>;
};
