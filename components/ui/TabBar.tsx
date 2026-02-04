/**
 * Custom TabBar Component
 * Design System: Luxe Français + Street
 *
 * Features:
 * - Highlighted "Vendre" button (Bleu Klein circle)
 * - Glassmorphism background
 * - Haptic feedback
 */

import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, sizing, spacing, shadows, typography, animations } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface TabItem {
  name: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconFilled: keyof typeof Ionicons.glyphMap;
}

interface TabBarProps {
  state: any;
  descriptors: any;
  navigation: any;
}

// =============================================================================
// TAB CONFIG
// =============================================================================

const tabs: TabItem[] = [
  { name: 'index', label: 'Accueil', icon: 'home-outline', iconFilled: 'home' },
  { name: 'search', label: 'Recherche', icon: 'search-outline', iconFilled: 'search' },
  { name: 'sell', label: 'Vendre', icon: 'add', iconFilled: 'add' },
  { name: 'messages', label: 'Messages', icon: 'chatbubble-outline', iconFilled: 'chatbubble' },
  { name: 'profile', label: 'Profil', icon: 'person-outline', iconFilled: 'person' },
];

// =============================================================================
// TAB ITEM COMPONENT
// =============================================================================

interface TabItemProps {
  tab: TabItem;
  isActive: boolean;
  isSellButton: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const TabItemComponent: React.FC<TabItemProps> = ({
  tab,
  isActive,
  isSellButton,
  onPress,
  onLongPress,
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.9, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  // Sell button (highlighted)
  if (isSellButton) {
    return (
      <AnimatedPressable
        style={[styles.tabItem, animatedStyle]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected: isActive }}
      >
        <View style={styles.sellButton}>
          <Ionicons name={tab.icon} size={28} color={colors.white} />
        </View>
      </AnimatedPressable>
    );
  }

  // Regular tab
  return (
    <AnimatedPressable
      style={[styles.tabItem, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: isActive }}
    >
      <Ionicons
        name={isActive ? tab.iconFilled : tab.icon}
        size={sizing.iconMD}
        color={isActive ? colors.primary : colors.muted}
      />
      <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
        {tab.label}
      </Text>
    </AnimatedPressable>
  );
};

// =============================================================================
// MAIN TAB BAR COMPONENT
// =============================================================================

export const TabBar: React.FC<TabBarProps> = ({
  state,
  descriptors,
  navigation,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Blur Background */}
      {Platform.OS === 'ios' && (
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={80}
          tint="light"
        />
      )}

      {/* Tab Items */}
      <View style={styles.tabsContainer}>
        {state.routes.map((route: any, index: number) => {
          const tab = tabs.find((t) => t.name === route.name);
          if (!tab) return null;

          const { options } = descriptors[route.key];
          const isActive = state.index === index;
          const isSellButton = tab.name === 'sell';

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isActive && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          return (
            <TabItemComponent
              key={route.key}
              tab={tab}
              isActive={isActive}
              isSellButton={isSellButton}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255, 255, 255, 0.9)' : colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadows.top,
  },
  tabsContainer: {
    flexDirection: 'row',
    height: sizing.tabBarHeight,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.sm,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  tabLabel: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 10,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },

  // Sell Button (Highlighted)
  sellButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -16, // Elevated effect
    ...shadows.elevated,
  },
});

export default TabBar;
