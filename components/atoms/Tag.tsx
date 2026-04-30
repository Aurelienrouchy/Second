import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

type TagVariant = 'detail' | 'query' | 'aiDetected';

export interface TagProps {
  variant: TagVariant;
  label: string;
  style?: ViewStyle;
}

export const Tag: React.FC<TagProps> = ({ variant, label, style }) => {
  const styles = getStyles(variant);

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
};

function getStyles(variant: TagVariant) {
  const baseStyles = {
    container: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      alignSelf: 'flex-start',
    },
    label: {
      fontFamily: fonts.sansMedium,
    },
  };

  const variantStyles = {
    detail: StyleSheet.create({
      container: {
        ...baseStyles.container,
        borderRadius: radius.xs,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        backgroundColor: 'transparent',
      },
      label: {
        ...baseStyles.label,
        fontSize: 11,
        color: colors.charcoal,
      },
    }),
    query: StyleSheet.create({
      container: {
        ...baseStyles.container,
        borderRadius: radius.xs,
        borderWidth: 1,
        borderColor: colors.sage,
        backgroundColor: colors.sageLight,
      },
      label: {
        ...baseStyles.label,
        fontSize: 10,
        color: colors.sage,
      },
    }),
    aiDetected: StyleSheet.create({
      container: {
        ...baseStyles.container,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: 'rgba(122, 140, 110, 0.30)',
        backgroundColor: 'rgba(122, 140, 110, 0.15)',
      },
      label: {
        ...baseStyles.label,
        fontSize: 11,
        color: colors.sage,
      },
    }),
  };

  return variantStyles[variant];
}
