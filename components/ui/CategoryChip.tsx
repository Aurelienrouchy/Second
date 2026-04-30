/**
 * CategoryChip Component
 * Design: Curated Editorial — Bulletin-Inspired
 *
 * Features:
 * - Refined pill shape with subtle border
 * - Terracotta fill when selected
 * - Smooth spring animations
 * - Haptic feedback
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, radius, spacing, animations, fonts } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface CategoryChipProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  showIcon?: boolean;
  onPress?: () => void;
  selected?: boolean;
  style?: ViewStyle;
  testID?: string;
  size?: 'default' | 'small';
}

// =============================================================================
// COMPONENT
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const CategoryChip: React.FC<CategoryChipProps> = ({
  label,
  icon,
  showIcon = false,
  onPress,
  selected = false,
  style,
  testID,
  size = 'default',
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.95, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  }, [onPress]);

  const isSmall = size === 'small';

  return (
    <AnimatedPressable
      style={[
        styles.container,
        selected && styles.containerSelected,
        isSmall && styles.containerSmall,
        style,
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {showIcon && icon && (
        <View style={styles.iconContainer}>
          <Ionicons
            name={icon}
            size={isSmall ? 14 : 16}
            color={selected ? colors.white : colors.foreground}
          />
        </View>
      )}
      <Text style={[
        styles.label,
        selected && styles.labelSelected,
        isSmall && styles.labelSmall,
      ]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  containerSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  containerSmall: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
  },
  iconContainer: {
    marginRight: spacing.xs + 2,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.foreground,
    letterSpacing: 0.1,
  },
  labelSelected: {
    color: colors.white,
  },
  labelSmall: {
    fontSize: 12,
  },
});

export default CategoryChip;
