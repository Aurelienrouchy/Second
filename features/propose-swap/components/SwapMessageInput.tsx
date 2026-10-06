/**
 * SwapMessageInput — Optional message field for the swap proposal.
 */

import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius } from '@/constants/theme';

type SwapMessageInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  disabled?: boolean;
};

export const SwapMessageInput = React.memo(function SwapMessageInput({
  value,
  onChangeText,
  disabled = false,
}: SwapMessageInputProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel} accessibilityRole="header">Message facultatif</Text>
      <Text style={styles.helpText}>Présentez votre proposition en quelques mots.</Text>
      <TextInput
        style={styles.messageInput}
        placeholder="Bonjour, je vous propose cet échange…"
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        multiline
        maxLength={500}
        textAlignVertical="top"
        accessibilityLabel="Message facultatif pour votre proposition"
        editable={!disabled}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontFamily: fonts.displayMedium,
    fontSize: 23,
    lineHeight: 28,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  helpText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.foregroundSecondary,
    marginBottom: spacing.md,
  },
  messageInput: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.charcoal,
    minHeight: 120,
    backgroundColor: colors.surfaceWarm,
    textAlignVertical: 'top',
  },
});
