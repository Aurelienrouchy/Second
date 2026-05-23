import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { AiBadge } from '@/features/sell/components/shared/AiBadge';
import { colors, fonts } from '@/constants/theme';

interface TextareaFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  maxLength: number;
  hasAiConfidence?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
}

export const TextareaField = React.memo(function TextareaField({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  hasAiConfidence,
  multiline,
  numberOfLines,
}: TextareaFieldProps) {
  return (
    <View style={styles.textareaField}>
      <View style={styles.textareaLabel}>
        <Text style={styles.textFieldLabel}>{label}</Text>
        <View style={styles.textareaLabelRight}>
          {hasAiConfidence ? <AiBadge /> : null}
          <Text style={styles.charCount}>
            {value.length} / {maxLength}
          </Text>
        </View>
      </View>
      <TextInput
        style={[
          styles.textareaContent,
          multiline && styles.textareaMultiline,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        maxLength={maxLength}
        multiline={multiline}
        numberOfLines={numberOfLines}
        textAlignVertical={multiline ? 'top' : undefined}
        cursorColor={colors.rust}
        selectionColor={colors.rust}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  textareaField: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    backgroundColor: colors.white,
    marginBottom: 14,
    overflow: 'hidden',
  },
  textareaLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  textareaLabelRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  textFieldLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  charCount: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
  },
  textareaContent: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 14,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.charcoal,
    lineHeight: 22,
  },
  textareaMultiline: {
    minHeight: 80,
    fontSize: 13,
    lineHeight: 21,
  },
});
