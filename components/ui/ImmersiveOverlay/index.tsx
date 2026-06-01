/**
 * ImmersiveOverlay — Wrapper that adds a full-screen immersive transition
 *
 * Wraps children (typically <Tabs>) and overlays an animated Skia gradient
 * when the sell flow is triggered. The children receive a "warp" transform
 * (perspective fold) during the animation for an immersive feel.
 *
 * Usage:
 *   <ImmersiveOverlay>
 *     <Tabs ... />
 *   </ImmersiveOverlay>
 *
 * Trigger:
 *   useImmersiveOverlay().immerse()   — starts the overlay animation
 *   useImmersiveOverlay().dismiss()   — reverses + hides the overlay
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withRepeat,
  withDelay,
  Easing,
  cancelAnimation,
  runOnJS,
  interpolate,
} from 'react-native-reanimated';

import { useImmersiveOverlayStore } from '@/store/immersiveOverlayStore';

import { Overlay } from './Overlay';
import {
  ENTERING_TIME,
  EXITING_TIME,
  CONTENT_REVEAL_DELAY,
  CONTENT_REVEAL_TIME,
} from './constants';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ImmersiveOverlayProps {
  children: React.ReactNode;
}

interface ImmerseOptions {
  /** Optional content to render inside the overlay (above the gradient). */
  component?: React.ReactNode;
}

// ─── Custom easing curves ───────────────────────────────────────────────────

const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
const EASE_OUT_EXPO = Easing.bezier(0.22, 1, 0.36, 1);

// ─── Hook: useImmersiveOverlay ──────────────────────────────────────────────

/**
 * Returns `immerse()` and `dismiss()` to control the overlay.
 *
 * `immerse(opts?)` triggers the entrance animation. Pass
 * `{ component: <MyContent /> }` to render content inside the overlay.
 *
 * `dismiss()` reverses the animation and clears the content.
 */
let _immerse: ((opts?: ImmerseOptions) => void) | null = null;
let _dismiss: (() => void) | null = null;

export function useImmersiveOverlay() {
  return {
    immerse: useCallback((opts?: ImmerseOptions) => {
      _immerse?.(opts);
    }, []),
    dismiss: useCallback(() => {
      _dismiss?.();
    }, []),
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

const ImmersiveOverlay: React.FC<ImmersiveOverlayProps> = React.memo(
  function ImmersiveOverlay({ children }) {
    const { activate, deactivate } = useImmersiveOverlayStore.getState();

    // ── SharedValues ──
    /** Overlay visibility: 0 = hidden, 1 = fully shown */
    const overlayProgress = useSharedValue(0);

    /** Warp effect on children: 0 = normal, 1 = fully warped */
    const warpProgress = useSharedValue(0);

    /** Breathing loop for background circles */
    const breathe = useSharedValue(0);

    const isMounted = useRef(true);

    useEffect(() => {
      isMounted.current = true;
      return () => {
        isMounted.current = false;
        cancelAnimation(overlayProgress);
        cancelAnimation(warpProgress);
        cancelAnimation(breathe);
      };
    }, [overlayProgress, warpProgress, breathe]);

    // ── Breathing animation — runs while overlay is visible ──
    const startBreathing = useCallback(() => {
      breathe.value = 0;
      breathe.value = withRepeat(
        withTiming(1, { duration: 7500, easing: Easing.inOut(Easing.ease) }),
        -1, // infinite
        true // reverse
      );
    }, [breathe]);

    const stopBreathing = useCallback(() => {
      cancelAnimation(breathe);
    }, [breathe]);

    // ── Deactivate on JS thread ──
    const deactivateOnJS = useCallback(() => {
      if (isMounted.current) {
        deactivate();
      }
    }, [deactivate]);

    // ── Immerse (entrance) ──
    const immerse = useCallback(
      (opts?: ImmerseOptions) => {
        activate(opts?.component);
        startBreathing();

        // Overlay fades in
        overlayProgress.value = withTiming(1, {
          duration: ENTERING_TIME,
          easing: EASE_IN_OUT,
        });

        // Children warp: quick fold then slow recovery
        warpProgress.value = withSequence(
          withTiming(1, { duration: 300, easing: EASE_IN_OUT }),
          withTiming(0, { duration: 1500, easing: EASE_OUT_EXPO })
        );
      },
      [overlayProgress, warpProgress, activate, startBreathing]
    );

    // ── Dismiss (exit) ──
    const dismiss = useCallback(() => {
      overlayProgress.value = withTiming(
        0,
        { duration: EXITING_TIME, easing: EASE_OUT_EXPO },
        (finished) => {
          if (finished) {
            runOnJS(deactivateOnJS)();
            runOnJS(stopBreathing)();
          }
        }
      );

      warpProgress.value = withTiming(0, {
        duration: EXITING_TIME,
        easing: EASE_OUT_EXPO,
      });
    }, [overlayProgress, warpProgress, deactivateOnJS, stopBreathing]);

    // ── Register immerse/dismiss for the hook ──
    useEffect(() => {
      _immerse = immerse;
      _dismiss = dismiss;
      return () => {
        _immerse = null;
        _dismiss = null;
      };
    }, [immerse, dismiss]);

    // ── Warp animated style on children ──
    const warpStyle = useAnimatedStyle(() => {
      const rotateX = interpolate(warpProgress.value, [0, 1], [0, -5]);
      const skewY = interpolate(warpProgress.value, [0, 1], [0, -1.5]);
      const scaleY = interpolate(warpProgress.value, [0, 1], [1, 1.1]);
      const scaleX = interpolate(warpProgress.value, [0, 1], [1, 0.94]);

      return {
        transform: [
          { perspective: 1200 },
          { rotateX: `${rotateX}deg` },
          { skewY: `${skewY}deg` },
          { scaleY },
          { scaleX },
        ],
      };
    });

    return (
      <Animated.View style={styles.root}>
        {/* Children (Tabs) with warp effect */}
        <Animated.View style={[styles.children, warpStyle]}>
          {children}
        </Animated.View>

        {/* Overlay layer (iOS only — Android uses standard navigation) */}
        <Overlay progress={overlayProgress} breathe={breathe} />
      </Animated.View>
    );
  }
);

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  children: {
    flex: 1,
    transformOrigin: 'top center',
  },
});

export { ImmersiveOverlay };
