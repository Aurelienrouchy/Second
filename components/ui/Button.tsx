/**
 * Button Component
 * Design System: Luxe Français + Street
 *
 * Variants: primary, secondary, ghost, danger, muted
 */

import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
  TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, radius, spacing, sizing, animations, typography } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'muted';
export type ButtonSize = 'default' | 'small';

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  textStyle?: TextStyle;
  haptic?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

// =============================================================================
// STYLES CONFIG
// =============================================================================

const variantStyles = {
  primary: {
    container: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    text: {
      color: colors.white,
    },
    pressed: {
      backgroundColor: colors.primaryDark,
    },
  },
  secondary: {
    container: {
      backgroundColor: colors.transparent,
      borderColor: colors.primary,
    },
    text: {
      color: colors.primary,
    },
    pressed: {
      backgroundColor: colors.primaryLight,
    },
  },
  ghost: {
    container: {
      backgroundColor: colors.transparent,
      borderColor: colors.transparent,
    },
    text: {
      color: colors.primary,
    },
    pressed: {
      backgroundColor: colors.primaryLight,
    },
  },
  danger: {
    container: {
      backgroundColor: colors.transparent,
      borderColor: colors.danger,
    },
    text: {
      color: colors.danger,
    },
    pressed: {
      backgroundColor: colors.dangerLight,
    },
  },
  muted: {
    container: {
      backgroundColor: colors.borderLight,
      borderColor: colors.borderLight,
    },
    text: {
      color: colors.foreground,
    },
    pressed: {
      backgroundColor: colors.border,
    },
  },
};

// =============================================================================
// COMPONENT
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'default',
  disabled = false,
  loading = false,
  fullWidth = false,
  onPress,
  style,
  textStyle,
  haptic = true,
  testID,
  accessibilityLabel,
  leftIcon,
  rightIcon,
}) => {
  const scale = useSharedValue(1);
  const variantStyle = variantStyles[variant];

  // Animated scale style
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Press handlers
  const handlePressIn = useCallback(() => {
    scale.value = withSpring(animations.scale.pressed, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.snappy);
  }, [scale]);

  const handlePress = useCallback(() => {
    if (haptic) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.();
  }, [haptic, onPress]);

  // Determine if button is interactive
  const isDisabled = disabled || loading;

  // Size-specific styles
  const sizeStyles = {
    default: {
      height: sizing.buttonHeight,
      paddingHorizontal: spacing.lg,
    },
    small: {
      height: sizing.buttonHeightSmall,
      paddingHorizontal: spacing.md,
    },
  };

  return (
    <AnimatedPressable
      style={[
        styles.container,
        sizeStyles[size],
        variantStyle.container,
        { borderWidth: 1.5 },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      disabled={isDisabled}
      testID={testID}
      accessibilityLabel={accessibilityLabel || (typeof children === 'string' ? children : undefined)}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.white : colors.primary}
        />
      ) : (
        <>
          {leftIcon && <Animated.View style={styles.iconLeft}>{leftIcon}</Animated.View>}
          <Text
            style={[
              styles.text,
              size === 'small' && styles.textSmall,
              variantStyle.text,
              textStyle,
            ]}
          >
            {children}
          </Text>
          {rightIcon && <Animated.View style={styles.iconRight}>{rightIcon}</Animated.View>}
        </>
      )}
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
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    letterSpacing: typography.button.letterSpacing,
    textAlign: 'center',
  },
  textSmall: {
    fontSize: 14,
    lineHeight: 20,
  },
  iconLeft: {
    marginRight: spacing.sm,
  },
  iconRight: {
    marginLeft: spacing.sm,
  },
});

export default Button;
