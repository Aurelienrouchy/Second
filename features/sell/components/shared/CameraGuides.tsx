import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts } from '@/constants/theme';

interface CameraGuidesProps {
  message?: string;
  subMessage?: string;
}

/**
 * Visual guides overlaid on the camera viewfinder:
 * - Corner brackets (4 corners, L-shaped borders)
 * - Center text with contextual guidance
 *
 * Note: Photo counter is rendered separately in capture.tsx
 * to position it in the blur zone above the corners (matching design).
 */
export default function CameraGuides({
  message = 'Cadre ton article',
  subMessage,
}: CameraGuidesProps) {
  return (
    <View style={styles.container} pointerEvents="none">
      {message ? (
        <View style={styles.centerTextContainer}>
          <Text style={styles.guideText}>{message}</Text>
          {subMessage ? (
            <Text style={styles.subGuideText}>{subMessage}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 3,
  },
  centerTextContainer: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // Le fond est le flux caméra en direct : sans ombre portée, le guidage
  // disparaît dès que l'utilisateur cadre un vêtement clair.
  guideText: {
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    color: 'rgba(245, 240, 232, 0.8)',
    letterSpacing: 0.4,
    textShadowColor: colors.overlay,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subGuideText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.creamTranslucent60,
    marginTop: 4,
    letterSpacing: 0.8,
    textShadowColor: colors.overlay,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
