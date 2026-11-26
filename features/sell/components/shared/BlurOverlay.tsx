import React from 'react';
import { View, StyleSheet } from 'react-native';

interface BlurOverlayProps {
  position: 'top' | 'bottom';
  height: number;
  intensity?: number;
}

/**
 * Voile sombre semi-transparent pour les bords caméra, identique iOS et Android.
 *
 * Décision design assumée : on n'utilise pas BlurView ici (coût GPU notable
 * au-dessus du flux caméra). Un simple voile RGBA semi-transparent sur les deux
 * plateformes est suffisant et plus performant ; `intensity` pilote l'opacité.
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
