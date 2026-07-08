/**
 * SexOption — animated pressable button for "JE CHERCHE POUR".
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

import { animations, colors, fonts } from '@/constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface SexOptionProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function SexOptionComponent({ label, selected, onPress }: SexOptionProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.set(withTiming(0.95, {
      duration: animations.duration.fast,
      easing: Easing.out(Easing.ease),
    }));
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.set(withTiming(1, {
      duration: animations.duration.normal,
      easing: Easing.out(Easing.ease),
    }));
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      style={[
        styles.sexOption,
        selected && styles.sexOptionSelected,
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
    >
      <Text style={[
        styles.sexOptionText,
        selected && styles.sexOptionTextSelected,
      ]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

export const SexOption = React.memo(SexOptionComponent);

const styles = StyleSheet.create({
  sexOption: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    borderRadius: 0, // Sharp corners per Tag.tsx
  },
  sexOptionSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  sexOptionText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.charcoal,
  },
  sexOptionTextSelected: {
    color: colors.white,
  },
});
