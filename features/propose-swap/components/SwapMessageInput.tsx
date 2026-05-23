/**
 * SwapMessageInput — Optional message field for the swap proposal.
 */

import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';

import { Text } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';

type SwapMessageInputProps = {
  value: string;
  onChangeText: (text: string) => void;
};

export const SwapMessageInput = React.memo(function SwapMessageInput({
  value,
  onChangeText,
}: SwapMessageInputProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Message (optionnel)</Text>
      <TextInput
        style={styles.messageInput}
        placeholder="Salut ! Je pense que nos pièces s'échangeraient bien…"
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        multiline
        maxLength={500}
        textAlignVertical="top"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 10,
  },
  messageInput: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
    color: colors.charcoal,
    minHeight: 100,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
});
