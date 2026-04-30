import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, fonts, radius } from '@/constants/theme';

type BadgeVariant = 'new' | 'sale' | 'eco' | 'match';

export interface BadgeProps {
  variant: BadgeVariant;
  label?: string;
  percentage?: number;
  style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({
  variant,
  label,
  percentage,
  style,
}) => {
  const styles = getStyles(variant);

  let displayText = label;
  if (variant === 'match' && percentage !== undefined) {
    displayText = `${percentage}%`;
  }

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{displayText}</Text>
    </View>
  );
};

function getStyles(variant: BadgeVariant) {
  const baseStyles = {
    container: {
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: radius.xs,
      alignSelf: 'flex-start',
    },
    label: {
      fontSize: 9,
      letterSpacing: 0.1,
      textTransform: 'uppercase' as const,
      fontFamily: fonts.sansMedium,
    },
  };

  const variantStyles = {
    new: StyleSheet.create({
      container: {
        ...baseStyles.container,
        backgroundColor: colors.charcoal,
      },
      label: {
        ...baseStyles.label,
        color: colors.cream,
      },
    }),
    sale: StyleSheet.create({
      container: {
        ...baseStyles.container,
        backgroundColor: colors.rust,
      },
      label: {
        ...baseStyles.label,
        color: colors.white,
      },
    }),
    eco: StyleSheet.create({
      container: {
        ...baseStyles.container,
        backgroundColor: colors.sage,
      },
      label: {
        ...baseStyles.label,
        color: colors.white,
      },
    }),
    match: StyleSheet.create({
      container: {
        ...baseStyles.container,
        backgroundColor: 'rgba(122, 140, 110, 0.9)',
      },
      label: {
        ...baseStyles.label,
        color: colors.white,
      },
    }),
  };

  return variantStyles[variant];
}
