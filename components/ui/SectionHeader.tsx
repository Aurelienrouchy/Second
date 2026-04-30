/**
 * SectionHeader Component — Seconde UI Kit
 * Design: Tendances MTL maquette
 *
 * Layout:
 *   Title (Cormorant Garamond, 22px, weight 300)  ···  "Voir tout →" (rust, uppercase)
 *   Both items sit on the same text baseline.
 *   No subtitle.
 */

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

import { colors, spacing, animations, fonts } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface SectionHeaderProps {
  title: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  style?: ViewStyle;
  testID?: string;
  variant?: 'default' | 'large' | 'compact';
}

// =============================================================================
// COMPONENT
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  onSeeAll,
  seeAllLabel = 'Voir tout →',
  style,
  testID,
  variant = 'default',
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.96, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handleSeeAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSeeAll?.();
  }, [onSeeAll]);

  const isLarge = variant === 'large';
  const isCompact = variant === 'compact';

  return (
    <View
      style={[
        styles.container,
        isCompact && styles.containerCompact,
        style,
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.title,
          isLarge && styles.titleLarge,
          isCompact && styles.titleCompact,
        ]}
      >
        {title}
      </Text>

      {onSeeAll && (
        <AnimatedPressable
          style={[styles.seeAllButton, animatedStyle]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handleSeeAll}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.seeAllText}>{seeAllLabel}</Text>
        </AnimatedPressable>
      )}
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end', // baseline alignment
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, // 24px — matches maquette
    paddingTop: 28,
    paddingBottom: spacing.md,
  },
  containerCompact: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },

  // Title — Cormorant Garamond, light weight, editorial
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '300',
    lineHeight: 26,
    letterSpacing: -0.3,
    color: colors.foreground,
  },
  titleLarge: {
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  titleCompact: {
    fontSize: 18,
    lineHeight: 22,
  },

  // "Voir tout →" — rust/orange, uppercase, on the baseline (matches maquette)
  seeAllButton: {
    paddingVertical: 0,
    paddingLeft: spacing.sm,
    marginBottom: 2,
  },
  seeAllText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.primary, // rust — #C4603A (orange)
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

export default SectionHeader;
