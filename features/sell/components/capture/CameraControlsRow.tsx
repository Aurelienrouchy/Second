import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '@/constants/theme';

interface CameraControlsRowProps {
  canTakeMore: boolean;
  isCapturing: boolean;
  hasPhotos: boolean;
  onGalleryPress: () => void;
  onCapture: () => void;
  onContinue: () => void;
}

export const CameraControlsRow = React.memo(function CameraControlsRow({
  canTakeMore,
  isCapturing,
  hasPhotos,
  onGalleryPress,
  onCapture,
  onContinue,
}: CameraControlsRowProps) {
  return (
    <View style={styles.controlsRow}>
      {/* Gallery button */}
      <Pressable
        style={[
          styles.galleryButton,
          !canTakeMore && styles.galleryButtonDisabled,
        ]}
        onPress={onGalleryPress}
        disabled={!canTakeMore}
      >
        <Ionicons
          name="images-outline"
          size={22}
          color={canTakeMore ? colors.cream : colors.muted}
        />
      </Pressable>

      {/* Capture button */}
      <Pressable
        style={styles.captureButton}
        onPress={onCapture}
        disabled={!canTakeMore || isCapturing}
      >
        <View
          style={[
            styles.captureButtonOuter,
            !canTakeMore && styles.captureButtonOuterDisabled,
          ]}
        />
        {isCapturing ? (
          <ActivityIndicator size="small" color={colors.charcoal} />
        ) : (
          <View
            style={[
              styles.captureButtonInner,
              !canTakeMore && styles.captureButtonInnerDisabled,
            ]}
          />
        )}
      </Pressable>

      {/* Continue button or placeholder */}
      {hasPhotos ? (
        <Pressable style={styles.continueButton} onPress={onContinue}>
          <Text style={styles.continueText}>Continuer</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.cream} />
        </Pressable>
      ) : (
        <View style={styles.placeholderButton} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 24,
  },
  galleryButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryButtonDisabled: {
    borderColor: 'rgba(140, 136, 128, 0.15)',
  },
  captureButton: {
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonOuter: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: 'rgba(245, 240, 232, 0.4)',
  },
  captureButtonOuterDisabled: {
    borderColor: 'rgba(140, 136, 128, 0.3)',
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cream,
  },
  captureButtonInnerDisabled: {
    backgroundColor: colors.muted,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.rust,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
  },
  continueText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.cream,
    letterSpacing: 0.3,
  },
  placeholderButton: {
    width: 48,
    height: 48,
  },
});
