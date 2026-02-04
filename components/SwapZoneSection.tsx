/**
 * SwapZoneSection Component
 * Design System: Luxe Français + Street
 *
 * Editorial-style swap party promotion
 * Inspired by Vestiaire Collective's clean banners
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, spacing, typography, radius, shadows, animations } from '@/constants/theme';
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
    <Animated.View
      style={styles.liveDot}
    />
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
          <Text style={styles.seeAll}>Voir tout</Text>
        </Pressable>
      </View>

      {/* Card */}
      <AnimatedPressable
        style={[styles.card, animatedStyle]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        {/* Background Image or Gradient */}
        <View style={styles.cardBackground}>
          <View style={styles.cardBackgroundOverlay} />
        </View>

        {/* Content */}
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Text style={styles.partyLabel}>SWAP PARTY EN COURS</Text>
          </View>

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
            <Ionicons name="arrow-forward" size={16} color={colors.white} />
          </View>
        </View>
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
          <Text style={styles.seeAll}>Calendrier</Text>
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
            <Text style={styles.upcomingLabel}>Prochaine</Text>
            <Text style={styles.upcomingTitle}>{party.name}</Text>
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.muted} />
              <Text style={styles.dateText}>{formatDate(party.startDate)}</Text>
            </View>
          </View>

          <View style={styles.upcomingRight}>
            <View style={styles.notifyButton}>
              <Ionicons name="notifications-outline" size={18} color={colors.primary} />
            </View>
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
    paddingBottom: spacing.md,
  },
  loadingContainer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: typography.h2.fontFamily, // Cormorant Garamond SemiBold
    fontSize: typography.h2.fontSize,     // 22px
    lineHeight: typography.h2.lineHeight,
    letterSpacing: typography.h2.letterSpacing,
    color: colors.foreground,
  },
  seeAll: {
    fontFamily: typography.label.fontFamily,
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
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
    fontFamily: typography.caption.fontFamily,
    fontSize: 10,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 0.5,
  },

  // Active Card
  card: {
    backgroundColor: colors.foreground,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.medium,
  },
  cardBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.foreground,
  },
  cardBackgroundOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 47, 167, 0.1)', // Subtle Bleu Klein tint
  },
  cardContent: {
    padding: spacing.lg,
  },
  cardHeader: {
    marginBottom: spacing.sm,
  },
  partyLabel: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  partyName: {
    fontFamily: typography.h1.fontFamily,
    fontSize: 26,
    fontWeight: '600',
    color: colors.white,
    marginBottom: spacing.xs,
  },
  partyDescription: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: spacing.md,
    lineHeight: 22,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.lg,
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    fontFamily: typography.h2.fontFamily,
    fontSize: 24,
    fontWeight: '700',
    color: colors.white,
  },
  statLabel: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },

  // CTA Button
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  ctaText: {
    fontFamily: typography.label.fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
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
    padding: spacing.lg,
  },
  upcomingLeft: {
    flex: 1,
  },
  upcomingLabel: {
    fontFamily: typography.caption.fontFamily,
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  upcomingTitle: {
    fontFamily: typography.h3.fontFamily,
    fontSize: typography.h3.fontSize,
    fontWeight: '600',
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dateText: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.bodySmall.fontSize,
    color: colors.muted,
  },
  upcomingRight: {
    marginLeft: spacing.md,
  },
  notifyButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
