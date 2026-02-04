/**
 * Input Component
 * Design System: Luxe Français + Street
 *
 * Variants: default, search, price
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useState, useCallback, forwardRef } from 'react';
import {
  TextInput,
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';

import { colors, radius, spacing, sizing, typography, animations } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

export type InputVariant = 'default' | 'search' | 'price';

interface InputProps extends Omit<TextInputProps, 'style'> {
  variant?: InputVariant;
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClear?: () => void;
  showClearButton?: boolean;
  containerStyle?: ViewStyle;
  inputStyle?: ViewStyle;
  disabled?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

const AnimatedView = Animated.createAnimatedComponent(View);

export const Input = forwardRef<TextInput, InputProps>(({
  variant = 'default',
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  onClear,
  showClearButton = true,
  containerStyle,
  inputStyle,
  disabled = false,
  value,
  onFocus,
  onBlur,
  ...textInputProps
}, ref) => {
  const [isFocused, setIsFocused] = useState(false);
  const focusAnim = useSharedValue(0);

  // Handle focus
  const handleFocus = useCallback((e: any) => {
    setIsFocused(true);
    focusAnim.value = withTiming(1, { duration: animations.duration.fast });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onFocus?.(e);
  }, [focusAnim, onFocus]);

  // Handle blur
  const handleBlur = useCallback((e: any) => {
    setIsFocused(false);
    focusAnim.value = withTiming(0, { duration: animations.duration.fast });
    onBlur?.(e);
  }, [focusAnim, onBlur]);

  // Handle clear
  const handleClear = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClear?.();
  }, [onClear]);

  // Animated border style
  const animatedContainerStyle = useAnimatedStyle(() => {
    const borderColor = error
      ? colors.danger
      : interpolateColor(
          focusAnim.value,
          [0, 1],
          [colors.border, colors.primary]
        );

    return {
      borderColor,
    };
  });

  // Determine left icon based on variant
  const getLeftIcon = () => {
    if (leftIcon) return leftIcon;
    if (variant === 'search') {
      return <Ionicons name="search" size={20} color={colors.muted} />;
    }
    return null;
  };

  // Determine right icon/element
  const getRightElement = () => {
    if (rightIcon) return rightIcon;
    if (variant === 'price') {
      return <Text style={styles.priceSymbol}>€</Text>;
    }
    if (showClearButton && value && value.length > 0) {
      return (
        <Pressable onPress={handleClear} hitSlop={8} style={styles.clearButton}>
          <Ionicons name="close-circle" size={20} color={colors.muted} />
        </Pressable>
      );
    }
    return null;
  };

  const leftElement = getLeftIcon();
  const rightElement = getRightElement();

  return (
    <View style={[styles.wrapper, containerStyle]}>
      {/* Label */}
      {label && (
        <Text style={[styles.label, error && styles.labelError]}>
          {label}
        </Text>
      )}

      {/* Input Container */}
      <AnimatedView
        style={[
          styles.container,
          animatedContainerStyle,
          disabled && styles.containerDisabled,
          error && styles.containerError,
        ]}
      >
        {/* Left Icon */}
        {leftElement && (
          <View style={styles.leftIcon}>
            {leftElement}
          </View>
        )}

        {/* Text Input */}
        <TextInput
          ref={ref}
          style={[
            styles.input,
            leftElement && styles.inputWithLeftIcon,
            rightElement && styles.inputWithRightIcon,
            disabled && styles.inputDisabled,
            inputStyle,
          ]}
          value={value}
          onFocus={handleFocus}
          onBlur={handleBlur}
          editable={!disabled}
          placeholderTextColor={colors.muted}
          selectionColor={colors.primary}
          keyboardType={variant === 'price' ? 'decimal-pad' : textInputProps.keyboardType}
          {...textInputProps}
        />

        {/* Right Element */}
        {rightElement && (
          <View style={styles.rightIcon}>
            {rightElement}
          </View>
        )}
      </AnimatedView>

      {/* Error or Hint */}
      {(error || hint) && (
        <Text style={[styles.hint, error && styles.hintError]}>
          {error || hint}
        </Text>
      )}
    </View>
  );
});

Input.displayName = 'Input';

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    lineHeight: typography.label.lineHeight,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  labelError: {
    color: colors.danger,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: sizing.inputHeight,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  containerDisabled: {
    backgroundColor: colors.borderLight,
    opacity: 0.5,
  },
  containerError: {
    borderColor: colors.danger,
  },
  input: {
    flex: 1,
    height: '100%',
    paddingHorizontal: spacing.md,
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    color: colors.foreground,
  },
  inputWithLeftIcon: {
    paddingLeft: spacing.sm,
  },
  inputWithRightIcon: {
    paddingRight: spacing.sm,
  },
  inputDisabled: {
    color: colors.muted,
  },
  leftIcon: {
    paddingLeft: spacing.md,
  },
  rightIcon: {
    paddingRight: spacing.md,
  },
  clearButton: {
    padding: spacing.xs,
  },
  priceSymbol: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    color: colors.muted,
  },
  hint: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  hintError: {
    color: colors.danger,
  },
});

export default Input;
