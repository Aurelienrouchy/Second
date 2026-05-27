/**
 * SizeChip — animated pressable chip for size selection.
 */

import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, fonts } from '@/constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface SizeChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function SizeChipComponent({ label, selected, onPress }: SizeChipProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(0.92, { duration: 150, easing: Easing.out(Easing.ease) });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.ease) });
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      style={[
        styles.sizeChip,
        selected && styles.sizeChipSelected,
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
    >
      <Text style={[
        styles.sizeChipText,
        selected && styles.sizeChipTextSelected,
      ]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

export const SizeChip = React.memo(SizeChipComponent);

const styles = StyleSheet.create({
  sizeChip: {
    minWidth: 48,
    height: 42,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    borderRadius: 0, // Sharp corners per Tag.tsx design system
  },
  sizeChipSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  sizeChipText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.charcoal,
  },
  sizeChipTextSelected: {
    color: colors.white,
  },
});
