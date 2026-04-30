import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';

interface BlurOverlayProps {
  position: 'top' | 'bottom';
  height: number;
  intensity?: number;
}

/**
 * Overlay for camera edges.
 * iOS: semi-transparent dark overlay (BlurView has perf issues in camera context)
 * Android: same semi-transparent fallback
 */
export default function BlurOverlay({
  position,
  height,
  intensity = 0.7,
}: BlurOverlayProps) {
  return (
    <View
      style={[
        styles.base,
        position === 'top' ? styles.top : styles.bottom,
        {
          height,
          backgroundColor: `rgba(15, 14, 12, ${intensity})`,
        },
      ]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
  },
  top: {
    top: 0,
  },
  bottom: {
    bottom: 0,
  },
});
