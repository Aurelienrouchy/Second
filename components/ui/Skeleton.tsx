/**
 * Skeleton Component
 * Design System: Luxe Français + Street
 *
 * Animated skeleton loader with shimmer effect
 */

import React, { useEffect } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, radius } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 16,
  borderRadius = radius.sm,
  style,
}) => {
  const shimmerProgress = useSharedValue(0);

  useEffect(() => {
    shimmerProgress.value = withRepeat(
      withTiming(1, { duration: 1200 }),
      -1,
      false
    );
  }, [shimmerProgress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          shimmerProgress.value,
          [0, 1],
          [-200, 200]
        ),
      },
    ],
  }));

  return (
    <View
      style={[
        styles.container,
        {
          width,
          height,
          borderRadius,
        },
        style,
      ]}
    >
      <Animated.View style={[styles.shimmer, animatedStyle]}>
        <LinearGradient
          colors={[
            'transparent',
            'rgba(255, 255, 255, 0.4)',
            'transparent',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradient}
        />
      </Animated.View>
    </View>
  );
};

// =============================================================================
// PRESET SKELETONS
// =============================================================================

export const SkeletonText: React.FC<{ lines?: number; style?: ViewStyle }> = ({
  lines = 1,
  style,
}) => (
  <View style={style}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        width={i === lines - 1 ? '70%' : '100%'}
        height={14}
        style={i > 0 ? { marginTop: 8 } : undefined}
      />
    ))}
  </View>
);

export const SkeletonAvatar: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <Skeleton width={size} height={size} borderRadius={size / 2} />
);

export const SkeletonImage: React.FC<{
  width?: number | `${number}%`;
  height?: number;
  aspectRatio?: number;
}> = ({ width = '100%', height, aspectRatio }) => (
  <View style={aspectRatio ? { aspectRatio } : undefined}>
    <Skeleton
      width={width}
      height={height || (aspectRatio ? undefined : 200)}
      borderRadius={radius.md}
      style={aspectRatio ? { flex: 1 } : undefined}
    />
  </View>
);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.borderLight,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gradient: {
    flex: 1,
    width: 200,
  },
});

export default Skeleton;
