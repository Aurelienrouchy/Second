/**
 * Overlay — Full-screen animated layer containing the Skia gradient
 * and an optional content component rendered on top with 3D transforms.
 *
 * Perf notes:
 * - Skia Canvas lazily mounted (only when isActive — saves GPU surfaces)
 * - Content rendered only when contentComponent is non-null
 * - pointerEvents toggled via JS state (not animated — only changes 2× per cycle)
 */

import React, { useCallback, useLayoutEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import Animated, {
  useAnimatedStyle,
  interpolate,
  SharedValue,
} from 'react-native-reanimated';

import { useImmersiveOverlayStore } from '@/store/immersiveOverlayStore';
import { spacing } from '@/constants/theme';
import { Button } from '@/components/ui/Button';

import { Gradient } from './Gradient';

// ─── Types ──────────────────────────────────────────────────────────────────

interface OverlayProps {
  progress: SharedValue<number>;
  breathe: SharedValue<number>;
  /** Prepared content overlaps the entrance tail; generic content reveals afterward. */
  contentReveal: SharedValue<number>;
  cycleId: number | null;
  mountContent: boolean;
  prepareContent: boolean;
  entranceFinished: boolean;
  contentVisible: boolean;
  contentActive: boolean;
  onLayerLayout: (cycleId: number) => void;
  onSceneReady: (cycleId: number) => void;
  onContentMounted: (cycleId: number) => void;
  onContentLayout: (cycleId: number) => void;
  onPreparedReady: (cycleId: number, ready: boolean) => void;
  onPendingCancel: (cycleId: number) => void;
}

// ─── Content sub-component ─────────────────────────────────────────────────

const Content: React.FC<{
  reveal: SharedValue<number>;
  contentComponent: React.ReactNode;
  prepared: boolean;
  onMounted: () => void;
}> = React.memo(function Content({ reveal, contentComponent, prepared, onMounted }) {
  useLayoutEffect(onMounted, [onMounted]);
  // The prepared camera uses opacity alone while the gradient finishes.
  const animatedStyles = useAnimatedStyle(() => prepared ? {opacity: reveal.value} : ({
    opacity: reveal.value,
    transform: [{ scale: interpolate(reveal.value, [0, 1], [1.03, 1]) }],
  }));

  return (
    <Animated.View style={[styles.content, animatedStyles]}>{contentComponent}</Animated.View>
  );
});

// ─── Component ──────────────────────────────────────────────────────────────

const Overlay: React.FC<OverlayProps> = React.memo(function Overlay({
  progress,
  breathe,
  contentReveal,
  cycleId,
  mountContent,
  prepareContent,
  entranceFinished,
  contentVisible,
  contentActive,
  onLayerLayout,
  onSceneReady,
  onContentMounted,
  onContentLayout,
  onPreparedReady,
  onPendingCancel,
}) {
  const { contentComponent, preparedContent, isActive } = useImmersiveOverlayStore(useShallow(
    (state) => ({ contentComponent: state.contentComponent, preparedContent: state.preparedContent, isActive: state.isActive })
  ));
  const handleSceneReady = useCallback(() => {
    if (cycleId !== null) onSceneReady(cycleId);
  }, [cycleId, onSceneReady]);
  const handleContentMounted = useCallback(() => {
    if (cycleId !== null) onContentMounted(cycleId);
  }, [cycleId, onContentMounted]);
  const handlePreparedReady = useCallback((ready: boolean) => {
    if (cycleId !== null) onPreparedReady(cycleId, ready);
  }, [cycleId, onPreparedReady]);

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
      {isActive && cycleId !== null && (
        <Animated.View
          key={cycleId}
          testID="immersive-overlay-layer"
          collapsable={false}
          style={StyleSheet.absoluteFill}
          onLayout={() => onLayerLayout(cycleId)}
        >
          <Gradient progress={progress} breathe={breathe} onSceneReady={handleSceneReady} />

          {(mountContent && contentComponent != null || prepareContent && preparedContent != null) && (
            <Animated.View
              testID="immersive-overlay-content"
              style={[StyleSheet.absoluteFill, styles.contentLayer]}
              onLayout={() => onContentLayout(cycleId)}
              pointerEvents={preparedContent && !contentVisible ? 'none' : 'auto'}
              accessibilityElementsHidden={!!preparedContent && !contentVisible}
              importantForAccessibility={preparedContent && !contentVisible ? 'no-hide-descendants' : 'auto'}
            >
              <Content
                reveal={contentReveal}
                prepared={preparedContent != null}
                contentComponent={preparedContent ? preparedContent({
                  entranceFinished,
                  visible: contentVisible,
                  active: contentActive,
                  onReady: handlePreparedReady,
                }) : contentComponent}
                onMounted={handleContentMounted}
              />
            </Animated.View>
          )}

          {(contentComponent == null && preparedContent == null || preparedContent != null && !contentVisible) && (
            <SafeAreaView edges={['top']} style={styles.pendingLayer} pointerEvents="box-none">
              <View style={styles.pendingControls}>
                <Button
                  variant="ghost"
                  size="small"
                  testID="immersive-overlay-cancel"
                  onPress={() => onPendingCancel(cycleId)}
                >
                  Annuler
                </Button>
              </View>
            </SafeAreaView>
          )}
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
  content: {
    flex: 1,
  },
  pendingLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 1001,
  },
  pendingControls: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    marginRight: spacing.md,
  },
});

export { Overlay };
