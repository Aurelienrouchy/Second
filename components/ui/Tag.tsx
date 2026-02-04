/**
 * Tag & Badge Components
 * Design System: Luxe Français + Street
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

import { colors, radius, spacing, typography, animations } from '@/constants/theme';

// =============================================================================
// TAG COMPONENT (Selectable)
// =============================================================================

interface TagProps {
  children: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const Tag: React.FC<TagProps> = ({
  children,
  selected = false,
  onPress,
  disabled = false,
  style,
  testID,
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

  return (
    <AnimatedPressable
      style={[
        styles.tag,
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
      <Text style={[styles.tagText, selected && styles.tagTextSelected]}>
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
    container: { backgroundColor: colors.transparent, borderWidth: 1, borderColor: colors.border },
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
  // Tag
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.borderLight,
  },
  tagSelected: {
    backgroundColor: colors.primary,
  },
  tagDisabled: {
    opacity: 0.5,
  },
  tagText: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    color: colors.foreground,
    textAlign: 'center',
  },
  tagTextSelected: {
    color: colors.white,
  },

  // Badge
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
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
    fontFamily: typography.caption.fontFamily,
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
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    marginLeft: spacing.xs,
  },
});

export default Tag;
