import React from 'react';
import { StyleSheet, Text, Pressable, View, ViewStyle, GestureResponderEvent, ActivityIndicator } from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

type ButtonVariant = 'primary' | 'secondary' | 'publish';

export interface ButtonProps {
  variant: ButtonVariant;
  label: string;
  onPress: (event: GestureResponderEvent) => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export const Button: React.FC<ButtonProps> = ({
  variant,
  label,
  onPress,
  icon,
  disabled = false,
  loading = false,
  style,
}) => {
  const styles = getStyles(variant);
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.container,
        style,
        {
          opacity: isDisabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.contentContainer}>
        {loading ? (
          <ActivityIndicator color={styles.label.color} />
        ) : (
          <>
            {icon && <View style={{ marginRight: spacing.sm }}>{icon}</View>}
            <Text style={styles.label}>{label}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
};

function getStyles(variant: ButtonVariant) {
  const baseStyles = {
    contentContainer: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
  };

  const variantStyles = {
    primary: StyleSheet.create({
      container: {
        paddingVertical: 15,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: colors.charcoal,
        width: '100%',
      },
      label: {
        fontSize: 14,
        letterSpacing: 0.08,
        textTransform: 'uppercase' as const,
        fontFamily: fonts.sansMedium,
        color: colors.cream,
      },
      contentContainer: baseStyles.contentContainer,
    }),
    secondary: StyleSheet.create({
      container: {
        paddingVertical: 15,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: colors.charcoal,
        width: '100%',
      },
      label: {
        fontSize: 14,
        letterSpacing: 0.08,
        textTransform: 'uppercase' as const,
        fontFamily: fonts.sansMedium,
        color: colors.charcoal,
      },
      contentContainer: baseStyles.contentContainer,
    }),
    publish: StyleSheet.create({
      container: {
        paddingVertical: 16,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
        backgroundColor: colors.charcoal,
        width: '100%',
      },
      label: {
        fontSize: 14,
        letterSpacing: 0.08,
        textTransform: 'uppercase' as const,
        fontFamily: fonts.sansMedium,
        color: colors.cream,
      },
      contentContainer: baseStyles.contentContainer,
    }),
  };

  return variantStyles[variant];
}
