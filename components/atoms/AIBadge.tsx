import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

export interface AIBadgeProps {
  style?: ViewStyle;
}

export const AIBadge: React.FC<AIBadgeProps> = ({ style }) => {
  const styles = StyleSheet.create({
    container: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.full,
      backgroundColor: colors.sageLight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
    },
    dot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.sage,
    },
    label: {
      fontSize: 9,
      letterSpacing: 0.08,
      fontFamily: fonts.sansMedium,
      color: colors.sage,
      textTransform: 'uppercase' as const,
    },
  });

  return (
    <View style={[styles.container, style]}>
      <View style={styles.dot} />
      <Text style={styles.label}>IA</Text>
    </View>
  );
};
