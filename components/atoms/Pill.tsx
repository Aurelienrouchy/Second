import React from 'react';
import { StyleSheet, Text, Pressable, ViewStyle, GestureResponderEvent } from 'react-native';
import { colors, fonts, radius } from '@/constants/theme';

export interface PillProps {
  label: string;
  active: boolean;
  onPress: (event: GestureResponderEvent) => void;
  style?: ViewStyle;
}

export const Pill: React.FC<PillProps> = ({ label, active, onPress, style }) => {
  const styles = StyleSheet.create({
    activeContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: radius.full,
      backgroundColor: colors.rust,
      borderWidth: 1,
      borderColor: colors.rust,
    },
    inactiveContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: radius.full,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: 'rgba(245, 240, 232, 0.15)',
    },
    activeLabel: {
      fontSize: 12,
      letterSpacing: 0.06,
      fontFamily: fonts.sansMedium,
      color: colors.white,
    },
    inactiveLabel: {
      fontSize: 12,
      letterSpacing: 0.06,
      fontFamily: fonts.sansMedium,
      color: 'rgba(245, 240, 232, 0.5)',
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
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
};
