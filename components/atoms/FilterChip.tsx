import React from 'react';
import { StyleSheet, Text, Pressable, View, ViewStyle, GestureResponderEvent } from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

export interface FilterChipProps {
  label: string;
  active: boolean;
  onPress: (event: GestureResponderEvent) => void;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export const FilterChip: React.FC<FilterChipProps> = ({
  label,
  active,
  onPress,
  icon,
  style,
}) => {
  const styles = StyleSheet.create({
    activeContainer: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.sm,
      backgroundColor: colors.charcoal,
      borderWidth: 1,
      borderColor: colors.charcoal,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    inactiveContainer: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.sm,
      backgroundColor: colors.white,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    activeLabel: {
      fontSize: 11,
      letterSpacing: 0.08,
      fontFamily: fonts.sansMedium,
      color: colors.cream,
    },
    inactiveLabel: {
      fontSize: 11,
      letterSpacing: 0.08,
      fontFamily: fonts.sansMedium,
      color: colors.charcoal,
    },
  });

  const containerStyle = active ? styles.activeContainer : styles.inactiveContainer;
  const labelStyle = active ? styles.activeLabel : styles.inactiveLabel;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        containerStyle,
        style,
        {
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon && <View>{icon}</View>}
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
};
