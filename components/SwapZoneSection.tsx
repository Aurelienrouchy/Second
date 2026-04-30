/**
 * SwapZoneSection Component
 * Design: Curated Editorial — Bulletin-Inspired
 *
 * Features:
 * - Warm terracotta gradient background
 * - Editorial typography
 * - Refined card with subtle shadow
 * - Smooth animations
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, spacing, fonts, radius, shadows, animations } from '@/constants/theme';
import { useSwapZone, SwapPartyInfo } from '@/hooks/useSwapZone';

// =============================================================================
// TYPES
// =============================================================================

interface SwapZoneSectionProps {
  testID?: string;
}

// =============================================================================
// ANIMATED PRESSABLE
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// =============================================================================
// LIVE BADGE
// =============================================================================

const LiveBadge: React.FC = () => (
  <View style={styles.liveBadge}>
    <View style={styles.liveDot} />
    <Text style={styles.liveText}>LIVE</Text>
  </View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function SwapZoneSection({ testID }: SwapZoneSectionProps) {
  const { hasActiveParty, activeParty, nextParty, isLoading } = useSwapZone();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer} testID={testID}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (!activeParty && !nextParty) {
    return null;
  }

  if (hasActiveParty && activeParty) {
    return <ActivePartyCard party={activeParty} testID={testID} />;
  }

  if (nextParty) {
    return <UpcomingPartyCard party={nextParty} testID={testID} />;
  }

  return null;
}

// =============================================================================
// ACTIVE PARTY CARD
// =============================================================================

function ActivePartyCard({
  party,
  testID,
}: {
  party: SwapPartyInfo;
  testID?: string;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, animations.spring.snappy);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, animations.spring.bouncy);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/swap-party/${party.id}`);
  };

  const handleViewAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/swap-parties');
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(400)}
      style={styles.container}
      testID={testID}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.sectionTitle}>Swap Zone</Text>
          <LiveBadge />
        </View>
        <Pressable
          onPress={handleViewAll}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={styles.seeAllButton}>
            <Text style={styles.seeAll}>Tout voir</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primary} />
          </View>
        </Pressable>
      </View>

      {/* Card */}
      <AnimatedPressable
        style={[styles.card, animatedStyle]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        <LinearGradient
          colors={['#C45C3E', '#A34830']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardGradient}
        >
          {/* Content */}
          <View style={styles.cardContent}>
            <Text style={styles.partyLabel}>EN COURS</Text>
            <Text style={styles.partyName}>{party.name}</Text>

            {party.description && (
              <Text style={styles.partyDescription} numberOfLines={2}>
                {party.description}
              </Text>
            )}

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{party.participantsCount || 0}</Text>
                <Text style={styles.statLabel}>participants</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{party.itemsCount || 0}</Text>
                <Text style={styles.statLabel}>articles</Text>
              </View>
            </View>

            {/* CTA */}
            <View style={styles.ctaButton}>
              <Text style={styles.ctaText}>Participer</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.primary} />
            </View>
          </View>
        </LinearGradient>
      </AnimatedPressable>
    </Animated.View>
  );
}

// =============================================================================
// UPCOMING PARTY CARD
// =============================================================================

function UpcomingPartyCard({
  party,
  testID,
}: {
  party: SwapPartyInfo;
  testID?: string;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, animations.spring.snappy);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, animations.spring.bouncy);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/swap-parties');
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(400)}
      style={styles.container}
      testID={testID}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Swap Zone</Text>
        <Pressable
          onPress={handlePress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={styles.seeAllButton}>
            <Text style={styles.seeAll}>Calendrier</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primary} />
          </View>
        </Pressable>
      </View>

      {/* Card */}
      <AnimatedPressable
        style={[styles.cardUpcoming, animatedStyle]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        <View style={styles.upcomingContent}>
          <View style={styles.upcomingLeft}>
            <Text style={styles.upcomingLabel}>PROCHAINE</Text>
            <Text style={styles.upcomingTitle}>{party.name}</Text>
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={12} color={colors.muted} />
              <Text style={styles.dateText}>{formatDate(party.startDate)}</Text>
            </View>
          </View>

          <View style={styles.notifyButton}>
            <Ionicons name="notifications-outline" size={18} color={colors.primary} />
          </View>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  loadingContainer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: colors.foreground,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seeAll: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.primary,
    letterSpacing: 0.2,
  },

  // Live Badge
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.white,
  },
  liveText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.white,
    letterSpacing: 0.5,
  },

  // Active Card
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.medium,
  },
  cardGradient: {
    flex: 1,
  },
  cardContent: {
    padding: spacing.lg,
  },
  partyLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  partyName: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 26,
    lineHeight: 32,
    color: colors.white,
    letterSpacing: -0.5,
    marginBottom: spacing.xs,
  },
  partyDescription: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.85)',
    marginBottom: spacing.lg,
    lineHeight: 20,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.xl,
  },
  stat: {
    alignItems: 'flex-start',
  },
  statNumber: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.white,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: -2,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },

  // CTA Button
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  ctaText: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.primary,
    letterSpacing: 0.2,
  },

  // Upcoming Card
  cardUpcoming: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  upcomingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  upcomingLeft: {
    flex: 1,
  },
  upcomingLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.muted,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  upcomingTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 15,
    lineHeight: 20,
    color: colors.foreground,
    letterSpacing: -0.2,
    marginBottom: spacing.xs,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  notifyButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
});
