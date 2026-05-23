import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '@/constants/theme';

interface SellFooterProps {
  label: string;
  onPress: () => void;
  isValid: boolean;
  bottomInset: number;
}

export const SellFooter = React.memo(function SellFooter({
  label,
  onPress,
  isValid,
  bottomInset,
}: SellFooterProps) {
  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + 16 }]}>
      <Pressable
        style={({ pressed }) => [
          styles.continueButton,
          !isValid && styles.continueButtonDisabled,
          pressed && { opacity: 0.7 },
        ]}
        onPress={onPress}
        disabled={!isValid}
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
          color={isValid ? colors.cream : colors.muted}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    paddingVertical: 16,
    borderRadius: radius.md,
    gap: 10,
  },
  continueButtonDisabled: {
    backgroundColor: colors.border,
  },
  continueButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 2.16,
    color: colors.cream,
  },
  continueButtonTextDisabled: {
    color: colors.muted,
  },
});
