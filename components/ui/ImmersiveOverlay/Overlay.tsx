/**
 * Overlay — Full-screen animated layer containing the Skia gradient
 * and an optional content component rendered on top with 3D transforms.
 *
 * Perf notes:
 * - Skia Canvas lazily mounted (only when isActive — saves GPU surfaces)
 * - Content rendered only when contentComponent is non-null
 * - pointerEvents toggled via JS state (not animated — only changes 2× per cycle)
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  interpolate,
  SharedValue,
} from 'react-native-reanimated';

import { useImmersiveOverlayStore } from '@/store/immersiveOverlayStore';

import { Gradient } from './Gradient';

// ─── Types ──────────────────────────────────────────────────────────────────

interface OverlayProps {
  progress: SharedValue<number>;
  breathe: SharedValue<number>;
  /** Drives the content (camera) fade-in AFTER the entrance animation. */
  contentReveal: SharedValue<number>;
}

// ─── Content sub-component ─────────────────────────────────────────────────

const Content: React.FC<{
  reveal: SharedValue<number>;
  contentComponent: React.ReactNode;
}> = React.memo(function Content({ reveal, contentComponent }) {
  // Clean fade-in (with a subtle settle) driven by `reveal`, which only starts
  // once the entrance gradient + blurred circles have finished. No entrance
  // warp here — the content simply fades in over the settled backdrop.
  const animatedStyles = useAnimatedStyle(() => ({
    flex: 1,
    opacity: reveal.value,
    transform: [{ scale: interpolate(reveal.value, [0, 1], [1.03, 1]) }],
  }));

  return (
    <Animated.View style={animatedStyles}>{contentComponent}</Animated.View>
  );
});

// ─── Component ──────────────────────────────────────────────────────────────

const Overlay: React.FC<OverlayProps> = React.memo(function Overlay({
  progress,
  breathe,
}) {
  const contentComponent = useImmersiveOverlayStore(
    (s) => s.contentComponent
  );
  const isActive = useImmersiveOverlayStore((s) => s.isActive);

  const containerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.15, 1], [0, 1, 1]);
    return {
      opacity,
      zIndex: progress.value > 0.01 ? 1000 : -1,
    };
  });

  return (
    <Animated.View
      style={[styles.container, containerStyle]}
      pointerEvents={isActive ? 'auto' : 'none'}
    >
      {isActive && <Gradient progress={progress} breathe={breathe} />}

      {isActive && contentComponent != null && (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.contentLayer]}
        >
          <Content progress={progress} contentComponent={contentComponent} />
        </Animated.View>
      )}
    </Animated.View>
  );
});

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
  },
  contentLayer: {
    zIndex: 1001,
  },
});

export { Overlay };
