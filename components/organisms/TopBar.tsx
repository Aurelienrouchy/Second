import React from 'react';
import {
  StyleSheet,
  View,
  Pressable,
  Text,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import {
  colors,
  spacing,
  radius,
  fonts,
} from '@/constants/theme';

export interface TopBarProps {
  title: string;
  onBack: (event: GestureResponderEvent) => void;
  variant: 'light' | 'dark';
  rightActions?: React.ReactNode;
  style?: ViewStyle;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  onBack,
  variant,
  rightActions,
  style,
}) => {
  const isDark = variant === 'dark';
  const styles = getStyles(isDark);

  return (
    <View style={[styles.container, style]}>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          {
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text style={styles.backIcon}>←</Text>
      </Pressable>

      <Text style={styles.title}>{title}</Text>

      <View style={styles.rightActionsContainer}>
        {rightActions || <View style={{ width: 36 }} />}
      </View>
    </View>
  );
};

function getStyles(isDark: boolean) {
  const bgColor = isDark ? 'rgba(26, 24, 20, 0.95)' : 'rgba(245, 240, 232, 0.95)';
  const borderColor = isDark
    ? 'rgba(255,255,255,0.08)'
    : colors.border;
  const textColor = isDark ? colors.cream : colors.charcoal;

  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing['2xl'],
      paddingTop: spacing['2xl'],
      backgroundColor: bgColor,
      borderBottomWidth: 1,
      borderBottomColor: borderColor,
      height: 68,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: isDark
        ? 'rgba(245,240,232,0.12)'
        : colors.borderStrong,
      justifyContent: 'center',
      alignItems: 'center',
    },
    backIcon: {
      fontSize: 18,
      color: textColor,
      fontWeight: '400',
    },
    title: {
      flex: 1,
      textAlign: 'center',
      fontSize: 20,
      fontFamily: fonts.serif,
      fontWeight: '400',
      color: textColor,
    },
    rightActionsContainer: {
      width: 36,
      alignItems: 'flex-end',
    },
  });
}
