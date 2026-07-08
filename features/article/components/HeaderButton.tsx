/**
 * HeaderButton — Frosted glass circle used in the floating header.
 */

import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/theme';

import { articleStyles } from '../styles';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface HeaderButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  isActive?: boolean;
  activeColor?: string;
  size?: number;
  disabled?: boolean;
}

function HeaderButtonComponent({
  icon,
  onPress,
  isActive = false,
  activeColor = colors.primary,
  size = 20,
  disabled = false,
}: HeaderButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.set(withTiming(0.9, { duration: 120, easing: Easing.out(Easing.ease) }));
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.set(withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) }));
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      disabled={disabled}
      style={[animatedStyle, disabled && { opacity: 0.4 }]}
    >
      <BlurView intensity={60} tint="dark" style={articleStyles.headerButton}>
        <Ionicons
          name={icon}
          size={size}
          color={isActive ? activeColor : colors.white}
        />
      </BlurView>
    </AnimatedPressable>
  );
}

export const HeaderButton = React.memo(HeaderButtonComponent);
