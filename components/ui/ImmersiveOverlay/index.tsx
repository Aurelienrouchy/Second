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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withTiming,
  withSequence,
  withRepeat,
  Easing,
  cancelAnimation,
  interpolate,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { animations } from '@/constants/theme';

import {
  useImmersiveOverlayStore,
  type ImmerseOptions,
  type DismissOptions,
  type ImmersivePreparedContent,
} from '@/store/immersiveOverlayStore';

import { Overlay } from './Overlay';
import {
  ENTERING_TIME,
  EXITING_TIME,
  CONTENT_REVEAL_TIME,
} from './constants';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ImmersiveOverlayProps {
  children: React.ReactNode;
}

interface OverlayCycle {
  id: number;
  generation: number;
  uid: string | null;
  phase: 'layout' | 'entering' | 'content-layout' | 'revealing' | 'ready' | 'closing';
  layerReady: boolean;
  sceneReady: boolean;
  contentMounted: boolean;
  contentLaidOut: boolean;
  contentReady: boolean;
  prepared: boolean;
  entranceFinished: boolean;
  preparedRevealFinished: boolean;
  closingGeneration?: number;
  isCurrent?: () => boolean;
  onDismiss?: () => void;
  onDismissed?: () => void;
}

// ─── Custom easing curves ───────────────────────────────────────────────────

const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
const EASE_OUT_EXPO = Easing.bezier(0.22, 1, 0.36, 1);
const PREPARED_REVEAL_TIME = animations.duration.normal;
// Match the existing, eased gradient timeline at the start of its last 250ms.
const PREPARED_REVEAL_START = EASE_IN_OUT.factory()(1 - PREPARED_REVEAL_TIME / ENTERING_TIME);
const PREPARED_REVEAL_EASING = EASE_OUT_EXPO.factory();

// ─── Hook: useImmersiveOverlay ──────────────────────────────────────────────

/**
 * Returns `immerse()` and `dismiss()` to control the overlay.
 *
 * `immerse(opts?)` triggers the entrance animation. Pass
 * `{ component: <MyContent /> }` to render content inside the overlay.
 *
 * `dismiss(opts?)` reverses the animation and clears the content. Pass
 * `{ onDismissed }` to run code once the collapse animation has fully
 * finished (e.g. trigger navigation precisely at the end of the exit).
 *
 * The triggers live in `immersiveOverlayStore` (registered by the mounted
 * overlay) — reading them via `getState()` keeps a single source of truth
 * and avoids the optional-chaining race of module-level globals.
 */
export function useImmersiveOverlay() {
  return {
    immerse: useCallback((opts?: ImmerseOptions) => {
      return useImmersiveOverlayStore.getState().immerse?.(opts) ?? null;
    }, []),
    dismiss: useCallback((opts?: DismissOptions) => {
      useImmersiveOverlayStore.getState().dismiss?.(opts);
    }, []),
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

const ImmersiveOverlay: React.FC<ImmersiveOverlayProps> = React.memo(
  function ImmersiveOverlay({ children }) {
    const { activate, deactivate, setCallbacks, clearCallbacks } =
      useImmersiveOverlayStore.getState();

    // ── SharedValues ──
    /** Overlay visibility: 0 = hidden, 1 = fully shown */
    const overlayProgress = useSharedValue(0);

    /** Warp effect on children: 0 = normal, 1 = fully warped */
    const warpProgress = useSharedValue(0);

    /** Breathing loop for background circles */
    const breathe = useSharedValue(0);

    /**
     * Content reveal: prepared camera content follows the entrance's tail;
     * generic content retains its separate post-entrance reveal.
     */
    const contentReveal = useSharedValue(0);
    const preparedRevealCycle = useSharedValue(0);
    const preparedRevealEligible = useSharedValue(false);
    const preparedRevealOrigin = useSharedValue(-1);
    const preparedRevealComplete = useSharedValue(false);

    const isMounted = useRef(true);
    const nextCycleId = useRef(0);
    const activeCycle = useRef<OverlayCycle | null>(null);
    const [renderCycle, setRenderCycle] = useState<{
      id: number;
      mountContent: boolean;
      prepareContent: boolean;
      entranceFinished: boolean;
      visible: boolean;
      active: boolean;
    } | null>(null);

    const resetAnimations = useCallback(() => {
      cancelAnimation(overlayProgress);
      cancelAnimation(warpProgress);
      cancelAnimation(breathe);
      cancelAnimation(contentReveal);
      overlayProgress.set(0);
      warpProgress.set(0);
      breathe.set(0);
      contentReveal.set(0);
      preparedRevealCycle.set(0);
      preparedRevealEligible.set(false);
      preparedRevealOrigin.set(-1);
      preparedRevealComplete.set(false);
    }, [overlayProgress, warpProgress, breathe, contentReveal, preparedRevealCycle,
      preparedRevealEligible, preparedRevealOrigin, preparedRevealComplete]);

    const invalidateCycle = useCallback(() => {
      const cycle = activeCycle.current;
      activeCycle.current = null;
      resetAnimations();
      if (isMounted.current) setRenderCycle(null);
      cycle?.onDismiss?.();
    }, [resetAnimations]);

    const getCurrentCycle = useCallback((id: number) => {
      const cycle = activeCycle.current;
      if (!isMounted.current || !cycle || cycle.id !== id) return null;
      const generation = getAuthSessionGeneration();
      const opening = (!cycle.contentMounted || !cycle.entranceFinished) && cycle.phase !== 'closing';
      if (!useImmersiveOverlayStore.getState().isActive ||
          cycle.uid !== useAuthStore.getState().authenticatedUid ||
          (opening && (cycle.generation !== generation || (cycle.isCurrent && !cycle.isCurrent()))) ||
          (cycle.phase === 'closing' && cycle.closingGeneration !== generation)) {
        invalidateCycle();
        deactivate();
        return null;
      }
      return cycle;
    }, [deactivate, invalidateCycle]);

    // ── Breathing animation — runs while overlay is visible ──
    const startBreathing = useCallback(() => {
      breathe.set(0);
      breathe.set(withRepeat(
        withTiming(1, { duration: 7500, easing: Easing.inOut(Easing.ease) }),
        -1, // infinite
        true // reverse
      ));
    }, [breathe]);

    // ── Immerse (entrance) ──
    const immerse = useCallback(
      (opts?: ImmerseOptions) => {
        if (!isMounted.current || (opts?.isCurrent && !opts.isCurrent())) return null;
        // Reset before mounting a new surface, including a rapid reopen during
        // exit. The previous surface's callbacks can never advance this cycle.
        invalidateCycle();
        const id = ++nextCycleId.current;
        activeCycle.current = {
          id,
          generation: getAuthSessionGeneration(),
          uid: useAuthStore.getState().authenticatedUid,
          phase: 'layout',
          layerReady: false,
          sceneReady: false,
          contentMounted: false,
          contentLaidOut: false,
          contentReady: false,
          prepared: false,
          entranceFinished: false,
          preparedRevealFinished: false,
          isCurrent: opts?.isCurrent,
          onDismiss: opts?.onDismiss,
        };
        setRenderCycle({ id, mountContent: false, prepareContent: false, entranceFinished: false, visible: false, active: true });
        activate(opts?.component);
        return {
          isCurrent: () => {
            const cycle = getCurrentCycle(id);
            return !!cycle && cycle.phase !== 'closing';
          },
          setContent: (component: React.ReactNode) => {
            const cycle = getCurrentCycle(id);
            if (!cycle || cycle.phase === 'closing' || cycle.contentMounted) return false;
            cycle.prepared = false;
            preparedRevealCycle.set(0);
            useImmersiveOverlayStore.getState().setContent(component);
            return true;
          },
          prepareContent: (render: ImmersivePreparedContent) => {
            const cycle = getCurrentCycle(id);
            if (!cycle || cycle.phase === 'closing' || cycle.contentMounted) return false;
            cycle.prepared = true;
            preparedRevealCycle.set(id);
            useImmersiveOverlayStore.getState().setPreparedContent(render);
            return true;
          },
          dismiss: (options?: DismissOptions) => {
            const cycle = getCurrentCycle(id);
            if (cycle && cycle.phase !== 'closing') useImmersiveOverlayStore.getState().dismiss?.(options);
          },
        };
      },
      [activate, invalidateCycle, getCurrentCycle, preparedRevealCycle]
    );

    const revealPreparedContent = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (!cycle?.prepared || (cycle.phase !== 'entering' && cycle.phase !== 'content-layout')) return;
      const eligible = cycle.contentMounted && cycle.contentLaidOut && cycle.contentReady;
      preparedRevealEligible.set(eligible);
      if (!eligible || !cycle.entranceFinished || !cycle.preparedRevealFinished) return;
      cycle.phase = 'ready';
      setRenderCycle(previous => previous?.id === id ? {...previous, visible: true} : previous);
    }, [getCurrentCycle, preparedRevealEligible]);

    const finishPreparedReveal = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (!cycle?.prepared || cycle.phase === 'closing') return;
      cycle.preparedRevealFinished = true;
      revealPreparedContent(id);
    }, [getCurrentCycle, revealPreparedContent]);

    useAnimatedReaction(
      () => ({id: preparedRevealCycle.get(), eligible: preparedRevealEligible.get(), progress: overlayProgress.get()}),
      (current, previous) => {
        if (!current.id || preparedRevealComplete.get()) return;
        if (preparedRevealOrigin.get() < 0) {
          if (!current.eligible || current.progress < PREPARED_REVEAL_START) return;
          // Ready before the window follows its full tail; ready during it
          // uses only the remaining gradient progression, ending at the same frame.
          preparedRevealOrigin.set(previous?.eligible && previous.progress < PREPARED_REVEAL_START
            ? PREPARED_REVEAL_START : current.progress);
          if (current.progress >= 1) {
            const id = current.id;
            contentReveal.set(withTiming(1, {duration: PREPARED_REVEAL_TIME, easing: EASE_OUT_EXPO}, finished => {
              if (finished && preparedRevealCycle.get() === id) {
                preparedRevealComplete.set(true);
                scheduleOnRN(finishPreparedReveal, id);
              }
            }));
            return;
          }
        }
        if (preparedRevealOrigin.get() < 1) {
          const progress = Math.max(0, Math.min(1,
            (current.progress - preparedRevealOrigin.get()) / (1 - preparedRevealOrigin.get())));
          contentReveal.set(PREPARED_REVEAL_EASING(progress));
          if (progress >= 1) {
            preparedRevealComplete.set(true);
            scheduleOnRN(finishPreparedReveal, current.id);
          }
        }
      }
    );

    const finishEntrance = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (cycle?.phase !== 'entering') return;
      cycle.phase = 'content-layout';
      cycle.entranceFinished = true;
      setRenderCycle(previous => previous?.id === id ? {...previous, mountContent: true, entranceFinished: true} : previous);
      revealPreparedContent(id);
    }, [getCurrentCycle, revealPreparedContent]);

    const startEntrance = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (cycle?.phase !== 'layout' || !cycle.layerReady || !cycle.sceneReady) return;
      cycle.phase = 'entering';
      startBreathing();
      overlayProgress.set(withTiming(1, {
        duration: ENTERING_TIME,
        easing: EASE_IN_OUT,
      }, (finished) => {
        if (finished) scheduleOnRN(finishEntrance, id);
      }));
      warpProgress.set(withSequence(
        withTiming(1, { duration: 300, easing: EASE_IN_OUT }),
        withTiming(0, { duration: 1500, easing: EASE_OUT_EXPO })
      ));
      // The qualified native scene and timeline start before opt-in content
      // begins camera/draft work behind the entrance animation.
      setRenderCycle(previous => previous?.id === id ? {...previous, prepareContent: true} : previous);
    }, [getCurrentCycle, startBreathing, overlayProgress, warpProgress, finishEntrance]);

    const handleLayerLayout = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (cycle?.phase !== 'layout') return;
      cycle.layerReady = true;
      startEntrance(id);
    }, [getCurrentCycle, startEntrance]);

    const handleSceneReady = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (cycle?.phase !== 'layout') return;
      cycle.sceneReady = true;
      startEntrance(id);
    }, [getCurrentCycle, startEntrance]);

    const handleContentMounted = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (cycle && (cycle.phase === 'content-layout' || cycle.prepared && cycle.phase === 'entering')) {
        cycle.contentMounted = true;
        revealPreparedContent(id);
      }
    }, [getCurrentCycle, revealPreparedContent]);

    const handlePreparedReady = useCallback((id: number, ready: boolean) => {
      const cycle = getCurrentCycle(id);
      if (!cycle?.prepared || cycle.phase === 'closing') return;
      cycle.contentReady = ready;
      revealPreparedContent(id);
    }, [getCurrentCycle, revealPreparedContent]);

    const finishReveal = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (cycle?.phase === 'revealing') cycle.phase = 'ready';
    }, [getCurrentCycle]);

    const handleContentLayout = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (cycle?.prepared && cycle.phase !== 'closing') {
        cycle.contentLaidOut = true;
        revealPreparedContent(id);
        return;
      }
      if (cycle?.phase !== 'content-layout') return;
      cycle.phase = 'revealing';
      contentReveal.set(withTiming(1, {
        duration: CONTENT_REVEAL_TIME,
        easing: EASE_OUT_EXPO,
      }, (finished) => {
        if (finished) scheduleOnRN(finishReveal, id);
      }));
    }, [getCurrentCycle, contentReveal, finishReveal, revealPreparedContent]);

    const finishDismiss = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (cycle?.phase !== 'closing') return;
      const onDismissed = cycle.onDismissed;
      invalidateCycle();
      deactivate();
      onDismissed?.();
    }, [getCurrentCycle, invalidateCycle, deactivate]);

    // ── Dismiss (exit) ──
    const dismiss = useCallback(
      (opts?: DismissOptions) => {
        const current = activeCycle.current;
        if (!current) return;
        const cycle = getCurrentCycle(current.id);
        if (!cycle || cycle.phase === 'closing') return;
        cycle.phase = 'closing';
        preparedRevealCycle.set(0);
        setRenderCycle(previous => previous?.id === cycle.id ? {...previous, active: false} : previous);
        // Foreground revalidation can legitimately renew the same owner's
        // generation while using the camera/picker. Navigation belongs to the
        // current close, rather than to the original opening's generation.
        cycle.closingGeneration = getAuthSessionGeneration();
        cycle.onDismissed = opts?.onDismissed;
        const onDismiss = cycle.onDismiss;
        cycle.onDismiss = undefined;
        onDismiss?.();
        const id = cycle.id;
        cancelAnimation(overlayProgress);
        cancelAnimation(warpProgress);
        cancelAnimation(contentReveal);
        cancelAnimation(breathe);
        overlayProgress.set(withTiming(
          0,
          { duration: EXITING_TIME, easing: EASE_OUT_EXPO },
          (finished) => {
            if (finished) {
              scheduleOnRN(finishDismiss, id);
            }
          }
        ));

        warpProgress.set(withTiming(0, {
          duration: EXITING_TIME,
          easing: EASE_OUT_EXPO,
        }));

        // Fade the content out with the exit so it never lingers behind the
        // collapsing overlay (and is reset to 0 for the next immerse).
        contentReveal.set(withTiming(0, {
          duration: EXITING_TIME,
          easing: EASE_OUT_EXPO,
        }));
      },
      [
        overlayProgress,
        warpProgress,
        contentReveal,
        breathe,
        getCurrentCycle,
        finishDismiss,
        preparedRevealCycle,
      ]
    );

    const handlePendingCancel = useCallback((id: number) => {
      const cycle = getCurrentCycle(id);
      if (cycle && cycle.phase !== 'closing') dismiss();
    }, [getCurrentCycle, dismiss]);

    // ── Register immerse/dismiss in the store for the hook ──
    useEffect(() => {
      isMounted.current = true;
      setCallbacks({ immerse, dismiss });
      const unsubscribeOverlay = useImmersiveOverlayStore.subscribe((state) => {
        if (!state.isActive && activeCycle.current) invalidateCycle();
        // A session reset clears transient state. Keep this mounted owner's
        // triggers available for a later, newly qualified opening.
        if (!state.immerse && !state.dismiss) setCallbacks({ immerse, dismiss });
      });
      const unsubscribeAuth = useAuthStore.subscribe(() => {
        const cycle = activeCycle.current;
        if (cycle) getCurrentCycle(cycle.id);
      });
      const activity = AppState.addEventListener('change', state => {
        const cycle = activeCycle.current;
        if (cycle && !cycle.entranceFinished && state !== 'active') {
          invalidateCycle();
          deactivate();
        }
      });
      return () => {
        isMounted.current = false;
        unsubscribeOverlay();
        unsubscribeAuth();
        activity.remove();
        invalidateCycle();
        deactivate();
        clearCallbacks();
      };
    }, [immerse, dismiss, setCallbacks, clearCallbacks, invalidateCycle, deactivate, getCurrentCycle]);

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
        <Overlay
          progress={overlayProgress}
          breathe={breathe}
          contentReveal={contentReveal}
          cycleId={renderCycle?.id ?? null}
          mountContent={renderCycle?.mountContent ?? false}
          prepareContent={renderCycle?.prepareContent ?? false}
          entranceFinished={renderCycle?.entranceFinished ?? false}
          contentVisible={renderCycle?.visible ?? false}
          contentActive={renderCycle?.active ?? false}
          onLayerLayout={handleLayerLayout}
          onSceneReady={handleSceneReady}
          onContentMounted={handleContentMounted}
          onContentLayout={handleContentLayout}
          onPreparedReady={handlePreparedReady}
          onPendingCancel={handlePendingCancel}
        />
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
