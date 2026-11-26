/**
 * Button Component — Seconde UI Kit
 * Framed editorial actions with restrained color and clear touch surfaces
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
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { components, animations } from '@/constants/theme';

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
    container: components.button.primary,
    text: components.button.primaryLabel,
  },
  secondary: {
    container: components.button.secondary,
    text: components.button.secondaryLabel,
  },
  ghost: {
    container: components.button.ghost,
    text: components.button.ghostLabel,
  },
  danger: {
    container: components.button.danger,
    text: components.button.dangerLabel,
  },
  muted: {
    container: components.button.muted,
    text: components.button.mutedLabel,
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
    scale.set(withTiming(animations.scale.pressed, {
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
    if (haptic) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.();
  }, [haptic, onPress]);

  // Determine if button is interactive
  const isDisabled = disabled || loading;

  return (
    <AnimatedPressable
      style={[
        styles.container,
        size === 'small' && styles.small,
        variantStyle.container,
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
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      <View
        style={[styles.content, loading && styles.contentLoading]}
        pointerEvents="none"
        accessibilityElementsHidden={loading}
        importantForAccessibility={loading ? 'no-hide-descendants' : 'auto'}
      >
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
      </View>
      {loading && <View style={styles.loadingOverlay} pointerEvents="none"
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ActivityIndicator size="small" color={variantStyle.text.color} />
      </View>}
    </AnimatedPressable>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    ...components.button.container,
    overflow: 'hidden',
  },
  small: components.button.small,
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: components.button.disabledOpacity,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: components.button.container.gap,
    flexShrink: 1,
  },
  contentLoading: { opacity: 0 },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    ...components.button.label,
  },
  textSmall: {
    ...components.button.smallLabel,
  },
  iconLeft: {
    flexShrink: 0,
  },
  iconRight: {
    flexShrink: 0,
  },
});

export default Button;
