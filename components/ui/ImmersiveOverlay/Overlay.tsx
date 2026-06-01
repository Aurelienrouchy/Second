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
  progress: SharedValue<number>;
  contentComponent: React.ReactNode;
}> = React.memo(function Content({ progress, contentComponent }) {
  const animatedStyles = useAnimatedStyle(() => ({
    flex: 1,
    opacity: interpolate(progress.value, [0, 0.3, 1], [0, 0, 1]),
    transform: [
      { perspective: 1000 },
      { rotateX: `${interpolate(progress.value, [0, 1], [-5, 0])}deg` },
      { skewY: `${interpolate(progress.value, [0, 1], [-1.5, 0])}deg` },
      { scaleY: interpolate(progress.value, [0, 1], [2, 1]) },
      { scaleX: interpolate(progress.value, [0, 1], [0.4, 1]) },
      { translateY: interpolate(progress.value, [0, 1], [100, 0]) },
    ],
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
