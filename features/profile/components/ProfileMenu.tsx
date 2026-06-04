/**
 * ProfileMenu — menu section with colored icon circles.
 * Extracted from profile screen.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, sizing, spacing, typography, animations } from '@/constants/theme';
import type { MenuItem } from '../types';

// =============================================================================
// ANIMATED PRESSABLE
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// =============================================================================
// MENU ITEM COMPONENT
// =============================================================================

interface MenuItemComponentProps {
  item: MenuItem;
  onPress: (item: MenuItem) => void;
  index: number;
}

const MenuItemComponent = React.memo(function MenuItemComponent({
  item,
  onPress,
  index,
}: MenuItemComponentProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(0.98, {
      duration: animations.duration.fast,
      easing: Easing.out(Easing.ease),
    });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withTiming(1, {
      duration: animations.duration.normal,
      easing: Easing.out(Easing.ease),
    });
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(item);
  }, [onPress, item]);

  return (
    <AnimatedPressable
      entering={FadeInDown.duration(300).delay(100 + index * 50)}
      style={[styles.menuItem, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      testID={`menu-item-${item.id}`}
    >
      <View style={styles.menuItemLeft}>
        <View
          style={[styles.menuIconContainer, { backgroundColor: item.iconBg }]}
        >
          <Ionicons name={item.icon} size={16} color={item.iconColor} />
        </View>
        <Text style={styles.menuTitle}>{item.title}</Text>
      </View>
      <View style={styles.menuItemRight}>
        {item.subtitle ? (
          <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
        ) : null}
        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
      </View>
    </AnimatedPressable>
  );
});

// =============================================================================
// PROFILE MENU
// =============================================================================

interface ProfileMenuProps {
  items: MenuItem[];
  onItemPress: (item: MenuItem) => void;
}

const ProfileMenu = React.memo(function ProfileMenu({
  items,
  onItemPress,
}: ProfileMenuProps) {
  return (
    <View style={styles.menuSection}>
      <Animated.View
        entering={FadeIn.duration(300).delay(200)}
        style={styles.sectionTitleContainer}
      >
        <Text style={styles.sectionTitle}>MON COMPTE</Text>
      </Animated.View>
      {items.map((item, index) => (
        <MenuItemComponent
          key={item.id}
          item={item}
          index={index}
          onPress={onItemPress}
        />
      ))}
    </View>
  );
});

export { ProfileMenu };

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  menuSection: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitleContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sectionTitle: {
    ...typography.labelUppercase,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuTitle: {
    ...typography.body,
    color: colors.charcoal,
  },
  menuItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  menuSubtitle: {
    ...typography.caption,
    color: colors.muted,
  },
});
