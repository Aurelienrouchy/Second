/**
 * StyleTag — Vestimentary style tag chip.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';

interface StyleTagProps {
  tag: string;
}

export const StyleTag = React.memo(function StyleTag({ tag }: StyleTagProps) {
  return (
    <View style={styles.styleTag}>
      <Text style={styles.styleTagText}>{tag}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  styleTag: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  styleTagText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    color: colors.charcoal,
    letterSpacing: 0.3,
  },
});
