/**
 * Tag & Badge Components — Seconde UI Kit
 * Design: Editorial Luxe — Sharp corners, border-only tags,
 * refined uppercase badges.
 */

import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  Pressable,
  View,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, radius, spacing, typography, animations, fonts } from '@/constants/theme';

// =============================================================================
// TAG COMPONENT (Selectable) — Editorial sharp border style
// =============================================================================

interface TagProps {
  children: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
  /** Visual variant: 'default' = charcoal border, 'sage' = sage tint */
  variant?: 'default' | 'sage';
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const Tag: React.FC<TagProps> = ({
  children,
  selected = false,
  onPress,
  disabled = false,
  style,
  testID,
  variant = 'default',
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.95, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  }, [onPress]);

  const isSage = variant === 'sage';

  return (
    <AnimatedPressable
      style={[
        styles.tag,
        isSage && styles.tagSage,
        selected && styles.tagSelected,
        disabled && styles.tagDisabled,
        style,
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
    >
      <Text style={[
        styles.tagText,
        isSage && styles.tagTextSage,
        selected && styles.tagTextSelected,
      ]}>
        {children}
      </Text>
    </AnimatedPressable>
  );
};

// =============================================================================
// BADGE COMPONENT (Informative)
// =============================================================================

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'outline';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  style?: ViewStyle;
  testID?: string;
}

const badgeVariantStyles: Record<BadgeVariant, { container: ViewStyle; text: { color: string } }> = {
  default: {
    container: { backgroundColor: colors.borderLight },
    text: { color: colors.foreground },
  },
  primary: {
    container: { backgroundColor: colors.primary },
    text: { color: colors.white },
  },
  success: {
    container: { backgroundColor: colors.successLight },
    text: { color: colors.success },
  },
  warning: {
    container: { backgroundColor: colors.warningLight },
    text: { color: colors.warning },
  },
  danger: {
    container: { backgroundColor: colors.dangerLight },
    text: { color: colors.danger },
  },
  outline: {
    container: { backgroundColor: colors.transparent, borderWidth: 1, borderColor: colors.borderStrong },
    text: { color: colors.foreground },
  },
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  style,
  testID,
}) => {
  const variantStyle = badgeVariantStyles[variant];

  return (
    <View style={[styles.badge, variantStyle.container, style]} testID={testID}>
      <Text style={[styles.badgeText, variantStyle.text]}>
        {children}
      </Text>
    </View>
  );
};

// =============================================================================
// NOTIFICATION BADGE (Counter)
// =============================================================================

interface NotificationBadgeProps {
  count: number;
  maxCount?: number;
  style?: ViewStyle;
  testID?: string;
}

export const NotificationBadge: React.FC<NotificationBadgeProps> = ({
  count,
  maxCount = 99,
  style,
  testID,
}) => {
  if (count <= 0) return null;

  const displayCount = count > maxCount ? `${maxCount}+` : `${count}`;

  return (
    <View style={[styles.notificationBadge, style]} testID={testID}>
      <Text style={styles.notificationBadgeText}>
        {displayCount}
      </Text>
    </View>
  );
};

// =============================================================================
// STATUS INDICATOR
// =============================================================================

export type StatusType = 'available' | 'reserved' | 'sold';

interface StatusIndicatorProps {
  status: StatusType;
  showLabel?: boolean;
  style?: ViewStyle;
  testID?: string;
}

const statusConfig: Record<StatusType, { color: string; label: string }> = {
  available: { color: colors.success, label: 'Disponible' },
  reserved: { color: colors.warning, label: 'Réservé' },
  sold: { color: colors.muted, label: 'Vendu' },
};

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  showLabel = false,
  style,
  testID,
}) => {
  const config = statusConfig[status];

  return (
    <View style={[styles.statusContainer, style]} testID={testID}>
      <View style={[styles.statusDot, { backgroundColor: config.color }]} />
      {showLabel && (
        <Text style={[styles.statusLabel, { color: config.color }]}>
          {config.label}
        </Text>
      )}
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  // Tag — Editorial: sharp corners, border-only, no fill
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.transparent,
  },
  tagSage: {
    borderColor: 'rgba(122, 140, 110, 0.25)',
    backgroundColor: colors.sageLight,
  },
  tagSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  tagDisabled: {
    opacity: 0.5,
  },
  tagText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.3,
    color: colors.charcoal,
    textAlign: 'center',
  },
  tagTextSage: {
    color: colors.sage,
  },
  tagTextSelected: {
    color: colors.white,
  },

  // Badge — Sharp, minimal
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.caption.fontSize,
    letterSpacing: 0.3,
  },

  // Notification Badge
  notificationBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  notificationBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '700',
    color: colors.white,
  },

  // Status
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontFamily: fonts.sans,
    fontSize: typography.caption.fontSize,
    marginLeft: spacing.xs,
  },
});

export default Tag;
