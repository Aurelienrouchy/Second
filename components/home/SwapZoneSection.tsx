/**
 * SwapZoneSection Component
 * Single, always-active "Swap Zone" card.
 *
 * The Swap Zone is a permanent generalist zone (no time window, no theme,
 * no countdown). This card surfaces liquidity stats (members / available
 * articles) instead of a temporal badge/countdown, and routes to the zone.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, spacing, typography, radius, sizing, fonts } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface SwapZoneInfo {
  id: string;
  name: string;
  participantsCount?: number;
  itemsCount?: number;
}

interface SwapZoneSectionProps {
  zone?: SwapZoneInfo;
  isLoading?: boolean;
  onPress?: () => void;
  testID?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Gradient for the Swap Zone card (sage green)
const ZONE_GRADIENT = ['#1E2A18', '#2A3820'] as const;

// =============================================================================
// ZONE CARD COMPONENT
// =============================================================================

interface ZoneCardProps {
  zone: SwapZoneInfo;
  onPress: () => void;
}

const ZoneCard: React.FC<ZoneCardProps> = ({ zone, onPress }) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withTiming(0.97, { duration: 150, easing: Easing.out(Easing.ease) });
  };

  const handlePressOut = () => {
    scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    // Outer wrapper owns the layout animation (FadeInDown).
    // Inner Animated.View owns the press-scale transform — splitting
    // them avoids 'transform may be overwritten by a layout animation'.
    <Animated.View entering={FadeInDown.duration(400).delay(100)}>
    <Animated.View style={[styles.cardWrapper, animatedStyle]}>
      <Pressable
        style={styles.card}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        <LinearGradient
          colors={ZONE_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardGradient}
        >
          {/* Decorative circles */}
          <View style={[styles.decorativeCircle, styles.decorativeCircle1]} />
          <View style={[styles.decorativeCircle, styles.decorativeCircle2]} />

          <View style={styles.cardContent}>
            {/* Badge */}
            <View style={styles.badgeRow}>
              <View style={styles.zoneBadge}>
                <Text style={styles.zoneBadgeText}>Échange ouvert</Text>
              </View>
            </View>

            {/* Title */}
            <Text style={styles.cardTitle}>{zone.name}</Text>

            {/* Liquidity stats */}
            <Text style={styles.cardStats}>
              {zone.participantsCount || 0} membres · {zone.itemsCount || 0} articles dispo
            </Text>

            {/* Right chevron */}
            <View style={styles.chevronContainer}>
              <View style={styles.chevronCircle}>
                <Ionicons
                  name="chevron-forward"
                  size={sizing.iconMD}
                  color={colors.white}
                />
              </View>
            </View>
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
    </Animated.View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SwapZoneSection: React.FC<SwapZoneSectionProps> = ({
  zone,
  isLoading = false,
  onPress = () => {},
  testID,
}) => {
  return (
    <View style={styles.container} testID={testID}>
      {isLoading || !zone ? (
        <View style={[styles.card, styles.skeletonCard]} />
      ) : (
        <ZoneCard zone={zone} onPress={onPress} />
      )}
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardWrapper: {
    overflow: 'hidden',
  },
  card: {
    borderRadius: radius.none, // Flat design
    overflow: 'hidden',
    minHeight: 180,
  },
  cardGradient: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'space-between',
  },
  decorativeCircle: {
    position: 'absolute',
    borderRadius: radius.full,
    opacity: 0.12,
  },
  decorativeCircle1: {
    width: 120,
    height: 120,
    backgroundColor: colors.secondary,
    top: -40,
    right: -40,
  },
  decorativeCircle2: {
    width: 80,
    height: 80,
    backgroundColor: colors.secondary,
    bottom: -20,
    left: -20,
    opacity: 0.08,
  },
  cardContent: {
    zIndex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  zoneBadge: {
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  zoneBadgeText: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    color: colors.white,
    fontWeight: '600',
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '300',
    color: colors.cream,
    marginBottom: spacing.sm,
  },
  cardStats: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: 'rgba(245, 240, 232, 0.7)',
  },
  chevronContainer: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
  },
  chevronCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Skeleton styles
  skeletonCard: {
    backgroundColor: colors.borderLight,
  },
});

export default SwapZoneSection;
