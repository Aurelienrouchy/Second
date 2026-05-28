import React from 'react';
import { create } from 'zustand';

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
}

interface ImmersiveOverlayActions {
  activate: (component?: React.ReactNode) => void;
  deactivate: () => void;
  reset: () => void;
}

const initialState: ImmersiveOverlayState = {
  isActive: false,
  contentComponent: null,
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
  reset: () => set(initialState),
}));
