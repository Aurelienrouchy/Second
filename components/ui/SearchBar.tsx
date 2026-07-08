/**
 * SearchBar Component
 * Design: Curated Editorial — Bulletin-Inspired
 *
 * Features:
 * - Refined minimal style with subtle border
 * - Warm ivory background
 * - Smooth scale animation
 * - Haptic feedback
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, spacing, fonts } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface SearchBarProps {
  placeholder?: string;
  onPress?: () => void;
  onFilterPress?: () => void;
  onCameraPress?: () => void;
  showFilter?: boolean;
  hasActiveFilters?: boolean;
  style?: ViewStyle;
  testID?: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = 'Rechercher...',
  onPress,
  onFilterPress,
  onCameraPress,
  showFilter = false,
  hasActiveFilters = false,
  style,
  testID,
}) => {
  const scale = useSharedValue(1);
  const filterScale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const filterAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: filterScale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.set(withTiming(0.98, { duration: 150, easing: Easing.out(Easing.ease) }));
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.set(withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) }));
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  }, [onPress]);

  const handleCameraPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCameraPress?.();
  }, [onCameraPress]);

  const handleFilterPressIn = useCallback(() => {
    filterScale.set(withTiming(0.9, { duration: 150, easing: Easing.out(Easing.ease) }));
  }, [filterScale]);

  const handleFilterPressOut = useCallback(() => {
    filterScale.set(withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) }));
  }, [filterScale]);

  const handleFilterPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onFilterPress?.();
  }, [onFilterPress]);

  return (
    <View style={[styles.wrapper, style]}>
      <AnimatedPressable
        style={[styles.container, animatedStyle]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        testID={testID}
        accessibilityRole="search"
        accessibilityLabel={placeholder}
      >
        <View style={styles.iconContainer}>
          <Ionicons name="search" size={16} color={colors.muted} />
        </View>
        <Text style={styles.placeholder}>{placeholder}</Text>
      </AnimatedPressable>

      {onCameraPress && (
        <Pressable
          style={styles.actionButton}
          onPress={handleCameraPress}
          accessibilityLabel="Recherche visuelle"
        >
          <Ionicons name="camera-outline" size={22} color={colors.foreground} />
        </Pressable>
      )}

      {showFilter && (
        <AnimatedPressable
          style={[
            styles.actionButton,
            hasActiveFilters && styles.actionButtonActive,
            filterAnimatedStyle,
          ]}
          onPressIn={handleFilterPressIn}
          onPressOut={handleFilterPressOut}
          onPress={handleFilterPress}
          accessibilityLabel="Filtres"
          accessibilityState={{ selected: hasActiveFilters }}
        >
          <Ionicons
            name="options-outline"
            size={16}
            color={hasActiveFilters ? colors.white : colors.foreground}
          />
          {hasActiveFilters && <View style={styles.filterDot} />}
        </AnimatedPressable>
      )}
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconContainer: {
    marginRight: spacing.xs + 2,
  },
  placeholder: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    flex: 1,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonActive: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  filterDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.foreground,
  },
});

export default SearchBar;
