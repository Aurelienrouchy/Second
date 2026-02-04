/**
 * CategoryChip Component
 * Design inspired by Fitmuse - Minimal pill style
 *
 * Features:
 * - Clean minimal design
 * - Black fill when selected
 * - No icons (optional)
 * - Animated press state
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

import { colors, radius, spacing, typography, animations } from '@/constants/theme';

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

  return (
    <AnimatedPressable
      style={[
        styles.container,
        selected && styles.containerSelected,
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
            size={16}
            color={selected ? colors.white : colors.foreground}
          />
        </View>
      )}
      <Text style={[styles.label, selected && styles.labelSelected]}>
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
    backgroundColor: colors.borderLight,
    borderRadius: radius.full,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md + 4,
    borderWidth: 1,
    borderColor: colors.transparent,
  },
  containerSelected: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  iconContainer: {
    marginRight: spacing.xs,
  },
  label: {
    fontFamily: typography.label.fontFamily,
    fontSize: 14,
    color: colors.foreground,
  },
  labelSelected: {
    color: colors.white,
    fontWeight: '500',
  },
});

export default CategoryChip;
