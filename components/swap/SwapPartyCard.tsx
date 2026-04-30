import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { colors, fonts, spacing, radius } from '@/constants/theme';

export interface SwapPartyCardProps {
  party: {
    id: string;
    name: string;
    emoji: string;
    status: 'active' | 'upcoming' | 'future';
    isEnrolled?: boolean;
    daysRemaining?: number;
    startDate?: string;
    participantsCount?: number;
    itemsCount?: number;
    description?: string;
  };
  onPress: () => void;
  onEnroll?: () => void;
  onPreview?: () => void;
}

const SwapPartyCard: React.FC<SwapPartyCardProps> = ({
  party,
  onPress,
  onEnroll,
  onPreview,
}) => {
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (party.status === 'active') {
      pulseOpacity.value = withRepeat(
        withTiming(0.5, { duration: 2000 }),
        -1,
        true
      );
    }
  }, [party.status]);

  const pulseAnimatedStyle = useAnimatedStyle(() => {
    if (party.status !== 'active') return {};
    return {
      opacity: pulseOpacity.value,
    };
  });

  // Active variant
  if (party.status === 'active') {
    return (
      <Animated.View
        entering={FadeInDown.springify()}
        style={styles.container}
      >
        <LinearGradient
          colors={['#1A2415', '#222E1A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.activeCard}
        >
          {/* Pulsing dot */}
          <Animated.View style={[styles.pulsingDot, pulseAnimatedStyle]} />

          {/* Status label */}
          <Text style={styles.activeStatusLabel}>
            En cours · J-{party.daysRemaining || 0}
          </Text>

          {/* Party title */}
          <Text style={styles.activeTitle}>
            {party.emoji} {party.name}
          </Text>

          {/* Enrolled badge */}
          {party.isEnrolled && (
            <View style={styles.enrolledBadge}>
              <Text style={styles.enrolledBadgeText}>Inscrit ✓</Text>
            </View>
          )}

          {/* Stats row */}
          <View style={styles.activeStatsRow}>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>membres</Text>
              <Text style={styles.statValue}>{party.participantsCount || 0}</Text>
            </View>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>articles</Text>
              <Text style={styles.statValue}>{party.itemsCount || 0}</Text>
            </View>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>restants</Text>
              <Text style={styles.statValue}>{(party.itemsCount || 0) - 5}</Text>
            </View>
          </View>

          {/* CTA Button */}
          <Pressable style={styles.activeCtaButton} onPress={onPress}>
            <Text style={styles.activeCtaButtonText}>
              Entrer dans la zone →
            </Text>
          </Pressable>
        </LinearGradient>
      </Animated.View>
    );
  }

  // Upcoming variant
  if (party.status === 'upcoming') {
    return (
      <Animated.View
        entering={FadeInDown.springify()}
        style={styles.container}
      >
        <View style={styles.upcomingCard}>
          {/* Rust pulsing dot */}
          <View style={styles.upcomingDot} />

          {/* Start date */}
          <Text style={styles.upcomingStartDate}>
            Démarre {party.startDate || '15 juin'}
          </Text>

          {/* Party title */}
          <Text style={styles.upcomingTitle}>
            {party.emoji} {party.name}
          </Text>

          {/* Description */}
          {party.description && (
            <Text style={styles.upcomingDescription} numberOfLines={2}>
              {party.description}
            </Text>
          )}

          {/* Buttons */}
          <View style={styles.upcomingButtonsRow}>
            <Pressable style={styles.upcomingEnrollButton} onPress={onEnroll}>
              <Text style={styles.upcomingEnrollButtonText}>S'inscrire</Text>
            </Pressable>
            <Pressable style={styles.upcomingPreviewButton} onPress={onPreview}>
              <Text style={styles.upcomingPreviewButtonText}>Aperçu</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    );
  }

  // Future variant (disabled, very faded)
  return (
    <Animated.View
      entering={FadeInDown.springify()}
      style={[styles.container, { opacity: 0.65 }]}
    >
      <View style={styles.futureCard}>
        {/* Faded dot */}
        <View style={styles.futureDot} />

        {/* Date */}
        <Text style={styles.futureDate}>Début {party.startDate || 'TBD'}</Text>

        {/* Title */}
        <Text style={styles.futureTitle}>
          {party.emoji} {party.name}
        </Text>

        {/* Description */}
        {party.description && (
          <Text style={styles.futureDescription} numberOfLines={2}>
            {party.description}
          </Text>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },

  // ===== ACTIVE CARD =====
  activeCard: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.2)',
    padding: 18,
    position: 'relative',
    overflow: 'hidden',
  },
  pulsingDot: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.sage,
  },
  activeStatusLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.sage,
    marginBottom: 8,
  },
  activeTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.cream,
    marginBottom: 12,
  },
  enrolledBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(122, 140, 110, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.3)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginBottom: spacing.md,
  },
  enrolledBadgeText: {
    fontFamily: fonts.sans,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.sage,
  },
  activeStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 240, 232, 0.1)',
  },
  statColumn: {
    alignItems: 'center',
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.88,
    textTransform: 'lowercase',
    color: 'rgba(245, 240, 232, 0.5)',
    marginBottom: 4,
  },
  statValue: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '400',
    lineHeight: 26,
    color: colors.cream,
  },
  activeCtaButton: {
    backgroundColor: colors.sage,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeCtaButtonText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.charcoal,
    fontWeight: '500',
  },

  // ===== UPCOMING CARD =====
  upcomingCard: {
    backgroundColor: 'rgba(245, 240, 232, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.07)',
    borderRadius: 0,
    padding: 18,
  },
  upcomingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.rust,
    marginBottom: spacing.sm,
  },
  upcomingStartDate: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.cream,
    marginBottom: 8,
  },
  upcomingTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '400',
    lineHeight: 22,
    color: colors.cream,
    marginBottom: 8,
  },
  upcomingDescription: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(245, 240, 232, 0.35)',
    marginBottom: spacing.md,
  },
  upcomingButtonsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  upcomingEnrollButton: {
    flex: 1,
    backgroundColor: colors.rust,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  upcomingEnrollButtonText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.surface,
    fontWeight: '500',
  },
  upcomingPreviewButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.15)',
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  upcomingPreviewButtonText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: 'rgba(245, 240, 232, 0.5)',
    fontWeight: '400',
  },

  // ===== FUTURE CARD =====
  futureCard: {
    backgroundColor: 'rgba(245, 240, 232, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.05)',
    borderRadius: 0,
    padding: 18,
    opacity: 0.75,
  },
  futureDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(245, 240, 232, 0.2)',
    marginBottom: spacing.sm,
  },
  futureDate: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '400',
    lineHeight: 22,
    color: 'rgba(245, 240, 232, 0.3)',
    marginBottom: 8,
  },
  futureTitle: {
    fontFamily: fonts.display,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 20,
    color: 'rgba(245, 240, 232, 0.25)',
    marginBottom: 8,
  },
  futureDescription: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(245, 240, 232, 0.15)',
  },
});

export default SwapPartyCard;
