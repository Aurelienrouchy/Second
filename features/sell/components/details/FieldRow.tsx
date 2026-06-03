import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AiBadge } from '../shared/AiBadge';
import { colors, fonts } from '@/constants/theme';

interface FieldRowProps {
  label: string;
  value: string | null;
  placeholder?: string;
  hasAiConfidence?: boolean;
  onPress: () => void;
  testID?: string;
}

export const FieldRow = React.memo(function FieldRow({
  label,
  value,
  placeholder = 'Sélectionner',
  hasAiConfidence,
  onPress,
  testID,
}: FieldRowProps) {
  return (
    <Pressable
      testID={testID}
      style={({ pressed }) => [styles.fieldRow, pressed && { opacity: 0.7 }]}
      onPress={onPress}
    >
      <Text style={styles.fieldRowLabel}>{label}</Text>
      <View style={styles.fieldRowValueContainer}>
        <Text
          style={[
            styles.fieldRowValue,
            !value && styles.fieldRowPlaceholder,
          ]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        {hasAiConfidence ? <AiBadge /> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  fieldRowLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    width: 80,
    textTransform: 'uppercase',
  },
  fieldRowValueContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldRowValue: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
  },
  fieldRowPlaceholder: {
    color: colors.muted,
  },
});
