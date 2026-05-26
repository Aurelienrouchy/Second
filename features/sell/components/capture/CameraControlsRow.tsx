import React, { useEffect } from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '@/constants/theme';

const TIMING_CONFIG = { duration: 350, easing: Easing.out(Easing.cubic) };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface CameraControlsRowProps {
  canTakeMore: boolean;
  isCapturing: boolean;
  hasPhotos: boolean;
  onCapture: () => void;
  onContinue: () => void;
}

export const CameraControlsRow = React.memo(function CameraControlsRow({
  canTakeMore,
  isCapturing,
  hasPhotos,
  onCapture,
  onContinue,
}: CameraControlsRowProps) {
  const continueProgress = useSharedValue(0);

  useEffect(() => {
    continueProgress.value = withTiming(hasPhotos ? 1 : 0, TIMING_CONFIG);
  }, [hasPhotos, continueProgress]);

  const captureButtonStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(continueProgress.value, [0, 1], [0, -40]) },
    ],
  }));

  const continueContainerStyle = useAnimatedStyle(() => ({
    width: interpolate(continueProgress.value, [0, 0.5, 1], [48, 48, 140]),
    opacity: continueProgress.value,
    transform: [
      { scale: interpolate(continueProgress.value, [0, 1], [0, 1]) },
      { translateX: interpolate(continueProgress.value, [0, 1], [0, -40]) },
    ],
  }));

  const continueTextStyle = useAnimatedStyle(() => ({
    opacity: interpolate(continueProgress.value, [0.6, 1], [0, 1]),
  }));

  return (
    <View style={styles.controlsRow}>
      {/* Capture button — centered when alone, shifts left when Continue appears */}
      <AnimatedPressable
        style={[styles.captureButton, captureButtonStyle]}
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
      </AnimatedPressable>

      {/* Continue button — positioned absolutely, shifts left with capture */}
      <AnimatedPressable
        style={[styles.continueButton, continueContainerStyle]}
        onPress={onContinue}
        disabled={!hasPhotos}
      >
        <Animated.Text style={[styles.continueText, continueTextStyle]}>
          Continuer
        </Animated.Text>
        <Animated.View style={continueTextStyle}>
          <Ionicons name="arrow-forward" size={14} color={colors.cream} />
        </Animated.View>
      </AnimatedPressable>
    </View>
  );
});

const styles = StyleSheet.create({
  controlsRow: {
    position: 'relative',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    height: 72 + 20, // captureButton height + paddingTop
  },
  captureButton: {
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
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
    position: 'absolute',
    right: 24,
    top: 20 + (72 - 48) / 2, // vertically centered with capture button
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.rust,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  continueText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.cream,
    letterSpacing: 0.3,
  },
});
