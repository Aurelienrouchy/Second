/**
 * ZoneCard — Swap zone card with active/upcoming/ended variants
 * Active: gradient background with pulsing dot, stats, CTA
 * Upcoming: rust-themed with signup/preview buttons
 * Ended/Future: muted card with description
 */

import React, { useEffect } from 'react';
import { View, StyleSheet, Pressable, Text as RNText } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { SwapParty } from '@/types';
import { colors, fonts, spacing } from '@/constants/theme';

export interface ZoneCardProps {
  zone: SwapParty;
  isEnrolled: boolean;
  onPress: () => void;
  opacity?: number;
}

export const ZoneCard = React.memo(function ZoneCard({
  zone,
  isEnrolled,
  onPress,
  opacity = 1,
}: ZoneCardProps) {
  const isActive = zone.status === 'active';
  const isUpcoming = zone.status === 'upcoming';

  // Pulse animation for active zone dot
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (isActive) {
      pulseOpacity.value = withRepeat(
        withTiming(0.5, {
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    }
  }, [isActive, pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const now = new Date();
  const daysRemaining = zone.endDate
    ? Math.max(
        0,
        Math.ceil(
          (new Date(zone.endDate).getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 0;
  const startDate = zone.startDate
    ? new Date(zone.startDate).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
      })
    : '';

  return (
    <Animated.View style={{ opacity }}>
      {isActive ? (
        <LinearGradient
          colors={['#1A2415', '#222E1A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.activeCard}
        >
          {/* Top Row: Status Badge + Enrolled Badge */}
          <View style={styles.cardTopRow}>
            <View style={styles.statusBadge}>
              <Animated.View style={[styles.pulseDot, pulseStyle]} />
              <RNText style={styles.statusText}>
                En cours · J-{daysRemaining}
              </RNText>
            </View>
            {isEnrolled && (
              <View style={styles.enrolledBadge}>
                <RNText style={styles.enrolledText}>Inscrit</RNText>
              </View>
            )}
          </View>

          {/* Title */}
          <RNText style={styles.cardTitle}>{zone.name}</RNText>

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statColumn}>
              <RNText style={styles.statNumber}>
                {zone.participantsCount}
              </RNText>
              <RNText style={styles.statLabel}>Membres</RNText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statColumn}>
              <RNText style={styles.statNumber}>{zone.itemsCount}</RNText>
              <RNText style={styles.statLabel}>Articles</RNText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statColumn}>
              <RNText style={styles.statNumber}>{daysRemaining}j</RNText>
              <RNText style={styles.statLabel}>Restants</RNText>
            </View>
          </View>

          {/* CTA Button */}
          <Pressable style={styles.activeCardButton} onPress={onPress}>
            <RNText style={styles.activeCardButtonText}>
              Entrer dans la zone
            </RNText>
          </Pressable>
        </LinearGradient>
      ) : isUpcoming ? (
        <View style={styles.upcomingCard}>
          <View style={styles.upcomingStatusBadge}>
            <View style={styles.rustDot} />
            <RNText style={styles.upcomingStatusText}>
              Démarre {startDate}
            </RNText>
          </View>

          <RNText style={styles.cardTitle}>{zone.name}</RNText>

          <RNText style={styles.upcomingDescription}>
            {zone.description}
          </RNText>

          <View style={styles.upcomingButtonsRow}>
            <Pressable style={styles.upcomingSignupButton} onPress={onPress}>
              <RNText style={styles.upcomingSignupText}>S'inscrire</RNText>
            </Pressable>
            <Pressable style={styles.upcomingPreviewButton} onPress={onPress}>
              <RNText style={styles.upcomingPreviewText}>Aperçu</RNText>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.futureCard}>
          <View style={styles.futureStatusBadge}>
            <View style={styles.futureDot} />
            <RNText style={styles.futureStatusText}>
              Démarre {startDate}
            </RNText>
          </View>

          <RNText style={styles.futureCardTitle}>{zone.name}</RNText>

          <RNText style={styles.futureDescription}>
            {zone.description}
          </RNText>
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  // Active card
  activeCard: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.2)',
    padding: 18,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.sage,
  },
  statusText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: colors.sage,
    textTransform: 'uppercase',
  },
  enrolledBadge: {
    backgroundColor: 'rgba(122, 140, 110, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.3)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  enrolledText: {
    fontFamily: fonts.sans,
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: colors.sage,
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '300',
    color: colors.cream,
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  statColumn: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '400',
    color: colors.cream,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: 'rgba(245, 240, 232, 0.35)',
    textTransform: 'uppercase',
  },
  statDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  activeCardButton: {
    backgroundColor: colors.sage,
    borderRadius: 9,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeCardButtonText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },

  // Upcoming card
  upcomingCard: {
    backgroundColor: 'rgba(245, 240, 232, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.07)',
    borderRadius: 0,
    padding: 18,
  },
  upcomingStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  rustDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.rust,
  },
  upcomingStatusText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: colors.rust,
    textTransform: 'uppercase',
  },
  upcomingDescription: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: 'rgba(245, 240, 232, 0.35)',
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  upcomingButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  upcomingSignupButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(196, 96, 58, 0.35)',
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingSignupText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    color: colors.rust,
    textTransform: 'uppercase',
  },
  upcomingPreviewButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingPreviewText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    color: 'rgba(255, 255, 255, 0.4)',
    textTransform: 'uppercase',
  },

  // Future card
  futureCard: {
    backgroundColor: 'rgba(245, 240, 232, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.05)',
    borderRadius: 0,
    padding: 18,
  },
  futureStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  futureDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  futureStatusText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: 'rgba(255, 255, 255, 0.25)',
    textTransform: 'uppercase',
  },
  futureCardTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '300',
    color: 'rgba(245, 240, 232, 0.55)',
    marginBottom: spacing.md,
  },
  futureDescription: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: 'rgba(245, 240, 232, 0.25)',
    lineHeight: 18,
  },
});
