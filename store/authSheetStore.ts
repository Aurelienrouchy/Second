import { create } from 'zustand';

import { track } from '@/lib/analytics';

// ─── State ──────────────────────────────────────────────────────────────────

interface AuthSheetState {
  isVisible: boolean;
  message: string;
  /** Optional success callback. Cleared after fire OR on hide. */
  onSuccess: (() => void) | null;
  /** Bumped on every show() so AuthBottomSheet's effect re-triggers
   *  even if message + onSuccess haven't changed (rare but possible). */
  version: number;
}

/** Analytics attribution threaded by the gate that opened the sheet. */
interface AuthSheetShowOptions {
  source?: string;
  gateKey?: string;
}

interface AuthSheetActions {
  show: (message?: string, onSuccess?: () => void, opts?: AuthSheetShowOptions) => void;
  hide: () => void;
  reset: () => void;
}

const DEFAULT_MESSAGE = 'Connectez-vous pour continuer';

const initialState: AuthSheetState = {
  isVisible: false,
  message: DEFAULT_MESSAGE,
  onSuccess: null,
  version: 0,
};

// ─── Store ──────────────────────────────────────────────────────────────────

/**
 * Drives the global auth bottom sheet. Replaces AuthRequiredContext +
 * the imperative AuthBottomSheetRef ref-forwarding chain.
 *
 * The CLAUDE.md "shared modal" pattern: the modal renders ONCE in the
 * root layout and reads state from this store. Callers from anywhere
 * call `useAuthSheetStore.getState().show(...)` to open it.
 */
export const useAuthSheetStore = create<AuthSheetState & AuthSheetActions>()(
  (set) => ({
    ...initialState,

    show: (message, onSuccess) =>
      set((state) => ({
        isVisible: true,
        message: message ?? DEFAULT_MESSAGE,
        onSuccess: onSuccess ?? null,
        version: state.version + 1,
      })),

    hide: () =>
      set({
        isVisible: false,
        onSuccess: null,
        message: DEFAULT_MESSAGE,
      }),

    reset: () => set(initialState),
  })
);
