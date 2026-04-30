import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, spacing } from '@/constants/theme';

interface FormSectionTitleProps {
  title: string;
}

/**
 * Section separator for sell flow forms.
 * Uppercase label + horizontal line (flex fill).
 */
export default function FormSectionTitle({ title }: FormSectionTitleProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title.toUpperCase()}</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  title: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
});
