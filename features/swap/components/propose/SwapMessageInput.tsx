/**
 * SwapMessageInput — Optional message field for the swap proposal.
 */

import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';

import { Text } from '@/components/ui';
import {
  colors,
  fonts,
  spacing,
  typography,
  components,
} from '@/constants/theme';

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
      <Text style={styles.sectionLabel} accessibilityRole="header">
        Un mot ? · facultatif
      </Text>
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
      <Text style={styles.counter}>{value.length}/500</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    ...typography.labelUppercase,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  counter: {
    ...typography.caption,
    color: colors.foregroundSecondary,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  messageInput: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: components.troc.fieldRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.charcoal,
    minHeight: components.troc.messageMinHeight,
    backgroundColor: colors.surfaceWarm,
    textAlignVertical: 'top',
  },
});
