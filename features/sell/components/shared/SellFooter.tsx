import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, components, spacing } from '@/constants/theme';

interface SellFooterProps {
  label: string;
  onPress: () => void;
  /**
   * Called on a tap while the step is invalid, to say why. Without it the
   * button is simply disabled — and a screen whose messages only appear on a
   * tap never showed them.
   */
  onInvalidPress?: () => void;
  isValid: boolean;
  bottomInset: number;
  testID?: string;
}

export const SellFooter = React.memo(function SellFooter({
  label,
  onPress,
  onInvalidPress,
  isValid,
  bottomInset,
  testID,
}: SellFooterProps) {
  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + 16 }]}>
      <Pressable
        testID={testID ?? 'sell-footer-cta'}
        style={({ pressed }) => [
          styles.continueButton,
          !isValid && styles.continueButtonDisabled,
          pressed && { opacity: 0.7 },
        ]}
        onPress={isValid ? onPress : onInvalidPress}
        disabled={!isValid && !onInvalidPress}
        accessibilityState={{ disabled: !isValid }}
      >
        <Text
          style={[
            styles.continueButtonText,
            !isValid && styles.continueButtonTextDisabled,
          ]}
        >
          {label}
        </Text>
        <Ionicons
          name="arrow-forward"
          size={18}
          color={isValid ? colors.foreground : colors.muted}
        />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  continueButton: {
    ...components.button.container,
    ...components.button.primary,
    paddingVertical: spacing.md,
  },
  continueButtonDisabled: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceWarm,
  },
  continueButtonText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },
  continueButtonTextDisabled: {
    color: colors.muted,
  },
});
