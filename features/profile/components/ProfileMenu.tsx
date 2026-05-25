/**
 * ProfileMenu — menu section with colored icon circles.
 * Extracted from profile screen.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, fonts, radius, spacing, animations } from '@/constants/theme';
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
    scale.value = withSpring(0.98, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
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
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
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
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.8,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuTitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.charcoal,
  },
});
