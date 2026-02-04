/**
 * SearchBar Component
 * Design inspired by Fitmuse - Premium fashion app aesthetic
 *
 * Features:
 * - Rounded pill style
 * - Optional filter icon
 * - Animated focus state
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
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, radius, spacing, typography, animations } from '@/constants/theme';

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
    scale.value = withSpring(0.98, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.snappy);
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
    filterScale.value = withSpring(0.9, animations.spring.snappy);
  }, [filterScale]);

  const handleFilterPressOut = useCallback(() => {
    filterScale.value = withSpring(1, animations.spring.bouncy);
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
          <Ionicons name="search" size={20} color={colors.muted} />
        </View>
        <Text style={styles.placeholder}>{placeholder}</Text>
      </AnimatedPressable>

      {onCameraPress && (
        <Pressable
          style={styles.cameraButton}
          onPress={handleCameraPress}
          accessibilityLabel="Recherche visuelle"
        >
          <Ionicons name="camera-outline" size={20} color={colors.primary} />
        </Pressable>
      )}

      {showFilter && (
        <AnimatedPressable
          style={[
            styles.filterButton,
            hasActiveFilters && styles.filterButtonActive,
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
            size={20}
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
    backgroundColor: colors.borderLight,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  iconContainer: {
    marginRight: spacing.sm,
  },
  placeholder: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    color: colors.muted,
    flex: 1,
  },
  cameraButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: colors.foreground,
  },
  filterDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.foreground,
  },
});

export default SearchBar;
