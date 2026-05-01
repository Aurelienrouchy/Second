/**
 * SwapZoneSection Component
 * Displays active and upcoming swap parties with countdown
 * Features: gradient backgrounds, badges, countdown timers
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, spacing, typography, radius, animations, sizing, fonts } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface SwapPartyInfo {
  id: string;
  name: string;
  participantsCount?: number;
  itemsCount?: number;
  endDate?: Date | string;
  status?: string;
}

interface UpcomingPartyInfo {
  id: string;
  name: string;
  startDate?: Date | string;
  description?: string;
}

interface SwapZoneSectionProps {
  hasActiveParty: boolean;
  activeParty?: SwapPartyInfo;
  nextParty?: UpcomingPartyInfo;
  isLoading?: boolean;
  onActivePress?: () => void;
  onUpcomingPress?: () => void;
  onNotifyPress?: () => void;
  testID?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Gradient for active party (sage green)
const ACTIVE_GRADIENT = ['#1E2A18', '#2A3820'];

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Calculate countdown from date string or Date
 */
function calculateCountdown(targetDate: Date | string | undefined): {
  days: number;
  hours: number;
  minutes: number;
  isExpired: boolean;
} {
  if (!targetDate) {
    return { days: 0, hours: 0, minutes: 0, isExpired: true };
  }

  const target = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
  const now = new Date();
  const diff = target.getTime() - now.getTime();

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, isExpired: true };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return { days, hours, minutes, isExpired: false };
}

/**
 * Format countdown text
 */
function formatCountdownDisplay(days: number): string {
  if (days > 0) {
    return `J-${days}`;
  }
  return 'Fin bientôt';
}

// =============================================================================
// ACTIVE PARTY CARD COMPONENT
// =============================================================================

interface ActivePartyCardProps {
  party: SwapPartyInfo;
  onPress: () => void;
}

const ActivePartyCard: React.FC<ActivePartyCardProps> = ({ party, onPress }) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, animations.spring.snappy);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, animations.spring.bouncy);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const countdown = calculateCountdown(party.endDate);
  const countdownDisplay = formatCountdownDisplay(countdown.days);

  return (
    // Outer wrapper owns the layout animation (FadeInDown).
    // Inner Animated.View owns the press-scale transform — splitting
    // them avoids 'transform may be overwritten by a layout animation'.
    <Animated.View entering={FadeInDown.duration(400).delay(100)}>
    <Animated.View style={[styles.activeCardWrapper, animatedStyle]}>
      <Pressable
        style={styles.activeCard}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        <LinearGradient
          colors={ACTIVE_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          angle={135}
          style={styles.activeCardGradient}
        >
          {/* Decorative circles */}
          <View style={[styles.decorativeCircle, styles.decorativeCircle1]} />
          <View style={[styles.decorativeCircle, styles.decorativeCircle2]} />

          <View style={styles.activeCardContent}>
            {/* Header with badge and countdown */}
            <View style={styles.activeCardHeader}>
              <View style={styles.badgeRow}>
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>En cours</Text>
                </View>
                <Text style={styles.countdownText}>{countdownDisplay}</Text>
              </View>
            </View>

            {/* Title */}
            <Text style={styles.activeCardTitle}>{party.name}</Text>

            {/* Stats */}
            <Text style={styles.activeCardStats}>
              {party.participantsCount || 0} membres · {party.itemsCount || 0} articles
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
// UPCOMING PARTY CARD COMPONENT
// =============================================================================

interface UpcomingPartyCardProps {
  party: UpcomingPartyInfo;
  onPress: () => void;
  onNotifyPress: () => void;
}

const UpcomingPartyCard: React.FC<UpcomingPartyCardProps> = ({
  party,
  onPress,
  onNotifyPress,
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.97, animations.spring.snappy);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, animations.spring.bouncy);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const handleNotifyPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onNotifyPress();
  };

  const countdown = calculateCountdown(party.startDate);
  let countdownText = '';

  if (countdown.isExpired) {
    countdownText = 'Bientôt';
  } else if (countdown.days > 0) {
    countdownText = `Démarre dans ${countdown.days}j`;
  } else if (countdown.hours > 0) {
    countdownText = `Démarre dans ${countdown.hours}h`;
  } else {
    countdownText = `Démarre dans ${countdown.minutes}m`;
  }

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(200)}>
    <Animated.View style={[styles.upcomingCardWrapper, animatedStyle]}>
      <Pressable
        style={styles.upcomingCard}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        <View style={styles.upcomingCardContent}>
          {/* Top row: Badge and Notify button */}
          <View style={styles.upcomingCardHeader}>
            <View style={styles.upcomingBadge}>
              <Text style={styles.upcomingBadgeText}>Bientôt</Text>
            </View>
            <Pressable
              style={styles.notifyButton}
              onPress={handleNotifyPress}
              hitSlop={spacing.sm}
            >
              <Ionicons
                name="notifications-outline"
                size={sizing.iconMD}
                color={colors.muted}
              />
            </Pressable>
          </View>

          {/* Countdown */}
          <Text style={styles.upcomingCountdown}>{countdownText}</Text>

          {/* Party name */}
          <Text
            style={styles.upcomingCardTitle}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {party.name}
          </Text>

          {/* Description */}
          {party.description && (
            <Text
              style={styles.upcomingCardDescription}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {party.description}
            </Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
    </Animated.View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SwapZoneSection: React.FC<SwapZoneSectionProps> = ({
  hasActiveParty,
  activeParty,
  nextParty,
  isLoading = false,
  onActivePress = () => {},
  onUpcomingPress = () => {},
  onNotifyPress = () => {},
  testID,
}) => {
  return (
    <View style={styles.container} testID={testID}>
      {isLoading ? (
        <View style={[styles.activeCard, styles.skeletonCard]} />
      ) : hasActiveParty && activeParty ? (
        <ActivePartyCard party={activeParty} onPress={onActivePress} />
      ) : nextParty ? (
        <UpcomingPartyCard
          party={nextParty}
          onPress={onUpcomingPress}
          onNotifyPress={onNotifyPress}
        />
      ) : null}
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
  // Active Card Styles
  activeCardWrapper: {
    overflow: 'hidden',
  },
  activeCard: {
    borderRadius: radius.none, // Flat design
    overflow: 'hidden',
    minHeight: 180,
  },
  activeCardGradient: {
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
  activeCardContent: {
    zIndex: 1,
  },
  activeCardHeader: {
    marginBottom: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  activeBadge: {
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  activeBadgeText: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    color: colors.white,
    fontWeight: '600',
  },
  countdownText: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    lineHeight: typography.label.lineHeight,
    color: 'rgba(245, 240, 232, 0.8)',
    fontWeight: '600',
  },
  activeCardTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '300',
    color: colors.cream,
    marginBottom: spacing.sm,
  },
  activeCardStats: {
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
  // Upcoming Card Styles
  upcomingCardWrapper: {
    overflow: 'hidden',
  },
  upcomingCard: {
    borderRadius: radius.none, // Flat design
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 140,
  },
  upcomingCardContent: {
    padding: spacing.lg,
  },
  upcomingCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  upcomingBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  upcomingBadgeText: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    color: colors.primary,
    fontWeight: '600',
  },
  notifyButton: {
    padding: spacing.sm,
  },
  upcomingCountdown: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    lineHeight: typography.label.lineHeight,
    color: colors.muted,
    marginBottom: spacing.sm,
    fontWeight: '500',
  },
  upcomingCardTitle: {
    fontFamily: typography.h2.fontFamily,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '400',
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  upcomingCardDescription: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.muted,
  },
  // Skeleton styles
  skeletonCard: {
    backgroundColor: colors.borderLight,
  },
});

export default SwapZoneSection;
