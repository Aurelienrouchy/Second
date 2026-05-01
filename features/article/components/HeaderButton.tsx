/**
 * HeaderButton — Frosted glass circle used in the floating header.
 */

import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { animations, colors } from '@/constants/theme';

import { articleStyles } from '../styles';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface HeaderButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  isActive?: boolean;
  activeColor?: string;
  size?: number;
}

function HeaderButtonComponent({
  icon,
  onPress,
  isActive = false,
  activeColor = colors.primary,
  size = 20,
}: HeaderButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.9, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
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
      style={animatedStyle}
    >
      <BlurView intensity={60} tint="dark" style={articleStyles.headerButton}>
        <Ionicons
          name={icon}
          size={size}
          color={isActive ? activeColor : '#FFFFFF'}
        />
      </BlurView>
    </AnimatedPressable>
  );
}

export const HeaderButton = React.memo(HeaderButtonComponent);
