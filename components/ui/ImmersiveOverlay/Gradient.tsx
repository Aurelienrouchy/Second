/**
 * Gradient — Skia Canvas with expanding circle + background circles
 *
 * GPU-accelerated via @shopify/react-native-skia.
 * Driven by Reanimated SharedValues (`progress` and `breathe`).
 *
 * Perf notes:
 * - Canvas is lazily mounted (parent gates on isActive)
 * - Derived values are merged (1 per transform, not scale+transform pairs)
 * - Blur kept ≤100 (GPU cost scales quadratically with radius)
 * - vec() and style objects memoized to avoid per-render allocations
 */

import React, { useMemo } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Canvas,
  Circle,
  Group,
  RadialGradient,
  Blur,
  Fill,
  vec,
} from '@shopify/react-native-skia';
import {
  useDerivedValue,
  interpolate,
  SharedValue,
} from 'react-native-reanimated';

import { OVERLAY_COLORS } from './constants';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GradientProps {
  progress: SharedValue<number>;
  breathe: SharedValue<number>;
}

// ─── ExpandingCircle ────────────────────────────────────────────────────────

const ExpandingCircle = React.memo(function ExpandingCircle({
  progress,
  cx,
  cy,
  r,
}: {
  progress: SharedValue<number>;
  cx: number;
  cy: number;
  r: number;
}) {
  const origin = useMemo(() => vec(cx, cy), [cx, cy]);
  const center = origin;

  const transform = useDerivedValue(() => [
    { scale: interpolate(progress.value, [0, 1], [0, 10]) },
  ]);

  return (
    <Group transform={transform} origin={origin}>
      <Circle cx={cx} cy={cy} r={r}>
        <RadialGradient
          c={center}
          r={r}
          colors={EXPANDING_COLORS}
          positions={EXPANDING_POSITIONS}
        />
        <Blur blur={15} />
      </Circle>
    </Group>
  );
});

// ─── BackgroundCircles ──────────────────────────────────────────────────────

const BackgroundCircles = React.memo(function BackgroundCircles({
  progress,
  breathe,
  cx1,
  cy1,
  r1,
  cx2,
  cy2,
  r2,
}: {
  progress: SharedValue<number>;
  breathe: SharedValue<number>;
  cx1: number;
  cy1: number;
  r1: number;
  cx2: number;
  cy2: number;
  r2: number;
}) {
  const origin1 = useMemo(() => vec(cx1, cy1), [cx1, cy1]);
  const origin2 = useMemo(() => vec(cx2, cy2), [cx2, cy2]);

  const opacity = useDerivedValue(() =>
    interpolate(progress.value, [0, 0.3, 1], [0, 0.6, 0.8])
  );

  const transform1 = useDerivedValue(() => [
    { scale: interpolate(breathe.value, [0, 0.5, 1], [0.7, 1, 0.7]) },
  ]);
  const transform2 = useDerivedValue(() => [
    { scale: interpolate(breathe.value, [0, 0.5, 1], [1, 0.7, 1]) },
  ]);

  return (
    <Group opacity={opacity}>
      <Group transform={transform1} origin={origin1}>
        <Circle cx={cx1} cy={cy1} r={r1}>
          <RadialGradient
            c={origin1}
            r={r1}
            colors={BG_CIRCLE1_COLORS}
            positions={BG_POSITIONS}
          />
          <Blur blur={80} />
        </Circle>
      </Group>

      <Group transform={transform2} origin={origin2}>
        <Circle cx={cx2} cy={cy2} r={r2}>
          <RadialGradient
            c={origin2}
            r={r2}
            colors={BG_CIRCLE2_COLORS}
            positions={BG_POSITIONS}
          />
          <Blur blur={80} />
        </Circle>
      </Group>
    </Group>
  );
});

// ─── Statics (allocated once) ───────────────────────────────────────────────

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 49 : 56;
const BUTTON_RAISE = 14;

const EXPANDING_COLORS = [
  OVERLAY_COLORS.expanding.start,
  OVERLAY_COLORS.expanding.mid,
  OVERLAY_COLORS.expanding.end,
];
const EXPANDING_POSITIONS = [0, 0.5, 1];

const BG_CIRCLE1_COLORS = [OVERLAY_COLORS.primary, 'rgba(212,196,160,0)'];
const BG_CIRCLE2_COLORS = [OVERLAY_COLORS.secondary, 'rgba(245,240,232,0)'];
const BG_POSITIONS = [0, 1];

// ─── Gradient (main) ────────────────────────────────────────────────────────

const Gradient: React.FC<GradientProps> = React.memo(function Gradient({
  progress,
  breathe,
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const buttonCenterY = height - insets.bottom - TAB_BAR_HEIGHT / 2 - BUTTON_RAISE;

  const canvasStyle = useMemo(() => ({ width, height }), [width, height]);

  const expandR = width / 3;
  const expandCx = width / 2;

  const bgR1 = Math.max(width, height) * 0.6;
  const bgR2 = Math.max(width, height) * 0.5;
  const bgCx1 = width * 0.3;
  const bgCy1 = height * 0.35;
  const bgCx2 = width * 0.75;
  const bgCy2 = height * 0.65;

  return (
    <Canvas style={canvasStyle}>
      <Fill color={OVERLAY_COLORS.fill} />

      <BackgroundCircles
        progress={progress}
        breathe={breathe}
        cx1={bgCx1}
        cy1={bgCy1}
        r1={bgR1}
        cx2={bgCx2}
        cy2={bgCy2}
        r2={bgR2}
      />

      <ExpandingCircle
        progress={progress}
        cx={expandCx}
        cy={buttonCenterY}
        r={expandR}
      />
    </Canvas>
  );
});

export { Gradient };
