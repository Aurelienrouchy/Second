import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, spacing, radius } from '@/constants/theme';

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
      {/* Corner brackets */}
      <View style={styles.cornersContainer}>
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>

      {/* Center text */}
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

const CORNER_SIZE = 28;
const CORNER_THICKNESS = 2;
const CORNER_COLOR = 'rgba(245, 240, 232, 0.5)';
const CORNER_INSET = 32; // matches design: left: 32px, right: 32px

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  cornersContainer: {
    ...StyleSheet.absoluteFillObject,
    marginHorizontal: CORNER_INSET,
    // No vertical margin — the container (guidesArea) already
    // starts at the top blur edge and ends at the bottom blur edge
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderColor: CORNER_COLOR,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderColor: CORNER_COLOR,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderColor: CORNER_COLOR,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderColor: CORNER_COLOR,
  },
  centerTextContainer: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  guideText: {
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    color: 'rgba(245, 240, 232, 0.8)',
    letterSpacing: 0.4,
  },
  subGuideText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: 'rgba(245, 240, 232, 0.35)',
    marginTop: 4,
    letterSpacing: 0.8,
  },
});
