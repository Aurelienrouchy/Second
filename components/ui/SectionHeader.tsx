/**
 * SectionHeader Component
 * Design System: Luxe Français + Street
 *
 * Clean section headers with Cormorant Garamond serif typography
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

import { colors, spacing, typography, animations } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  style?: ViewStyle;
  testID?: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  onSeeAll,
  seeAllLabel = 'Voir tout',
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

  const handleSeeAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSeeAll?.();
  }, [onSeeAll]);

  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.textContainer}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>

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
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontFamily: typography.h2.fontFamily, // Cormorant Garamond SemiBold
    fontSize: typography.h2.fontSize,     // 22px
    lineHeight: typography.h2.lineHeight, // 28px
    letterSpacing: typography.h2.letterSpacing,
    color: colors.foreground,
  },
  subtitle: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    color: colors.muted,
    marginTop: 2,
  },
  seeAllButton: {
    paddingVertical: spacing.xs,
    paddingLeft: spacing.sm,
  },
  seeAllText: {
    fontFamily: typography.label.fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary, // Bleu Klein
  },
});

export default SectionHeader;
