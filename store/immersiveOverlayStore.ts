import React from 'react';
import { create } from 'zustand';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Options accepted by the imperative `immerse()` trigger. */
export interface ImmerseOptions {
  /** Optional content to render inside the overlay (above the gradient). */
  component?: React.ReactNode;
}

/** Options accepted by the imperative `dismiss()` trigger. */
export interface DismissOptions {
  /**
   * Called on the JS thread once the exit animation has *fully* finished.
   * Lets callers couple navigation to the real end of the collapse animation
   * instead of guessing with a magic `setTimeout` delay.
   */
  onDismissed?: () => void;
}

type ImmerseFn = (opts?: ImmerseOptions) => void;
type DismissFn = (opts?: DismissOptions) => void;

// ─── State ──────────────────────────────────────────────────────────────────

interface ImmersiveOverlayState {
  /**
   * Whether the overlay is logically active (JS-side flag).
   * The actual animation driver is a Reanimated SharedValue created
   * in the component tree — this boolean gates pointer events and
   * lets non-animated code know the overlay is showing.
   */
  isActive: boolean;

  /**
   * Optional content rendered inside the overlay (above the Skia gradient).
   * Transient — never serialized. When non-null the overlay becomes a
   * full-screen container for this component (e.g. the sell flow).
   */
  contentComponent: React.ReactNode | null;

  /**
   * Imperative triggers wired by the mounted `ImmersiveOverlay` component.
   * Transient — never serialized. Stored here (instead of module-level
   * mutable globals) so the hook can read a single source of truth without
   * an optional-chaining race against unmount.
   */
  immerse: ImmerseFn | null;
  dismiss: DismissFn | null;
}

interface ImmersiveOverlayActions {
  activate: (component?: React.ReactNode) => void;
  deactivate: () => void;
  /** Register the animation triggers exposed by the mounted overlay. */
  setCallbacks: (callbacks: { immerse: ImmerseFn; dismiss: DismissFn }) => void;
  /** Clear the triggers (overlay unmounted). */
  clearCallbacks: () => void;
  reset: () => void;
}

const initialState: ImmersiveOverlayState = {
  isActive: false,
  contentComponent: null,
  immerse: null,
  dismiss: null,
};

// ─── Store ──────────────────────────────────────────────────────────────────

/**
 * Lightweight store that tracks the immersive overlay state.
 *
 * The heavy-lifting (SharedValues, Skia Canvas, warp transforms) lives
 * in the ImmersiveOverlay component; this store only provides a JS-side
 * flag so that the tab-press listener can trigger the animation and
 * other parts of the app can query whether the overlay is showing.
 */
export const useImmersiveOverlayStore = create<
  ImmersiveOverlayState & ImmersiveOverlayActions
>()((set) => ({
  ...initialState,

  activate: (component?: React.ReactNode) =>
    set({ isActive: true, contentComponent: component ?? null }),
  deactivate: () => set({ isActive: false, contentComponent: null }),
  setCallbacks: ({ immerse, dismiss }) => set({ immerse, dismiss }),
  clearCallbacks: () => set({ immerse: null, dismiss: null }),
  reset: () => set(initialState),
}));
