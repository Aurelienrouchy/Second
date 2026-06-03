/**
 * ProfileStats — stats row (Articles, Ventes, Note, Abonnes).
 * Extracted from profile screen.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, spacing, typography } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface StatItemProps {
  value: string | number;
  label: string;
  delay?: number;
}

interface ProfileStatsProps {
  articlesCount: number;
  salesCount: number;
  rating: number | null | undefined;
  followersCount: number;
}

// =============================================================================
// STAT ITEM
// =============================================================================

const StatItem = React.memo(function StatItem({
  value,
  label,
  delay = 0,
}: StatItemProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(delay)}
      style={styles.statItem}
    >
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Animated.View>
  );
});

// =============================================================================
// PROFILE STATS
// =============================================================================

const ProfileStats = React.memo(function ProfileStats({
  articlesCount,
  salesCount,
  rating,
  followersCount,
}: ProfileStatsProps) {
  return (
    <View style={styles.statsRow}>
      <StatItem value={articlesCount} label="Articles" delay={150} />
      <View style={styles.statDivider} />
      <StatItem value={salesCount} label="Ventes" delay={200} />
      <View style={styles.statDivider} />
      <StatItem
        value={rating ? rating.toFixed(1) : '—'}
        label="Note"
        delay={250}
      />
      <View style={styles.statDivider} />
      <StatItem value={followersCount} label="Abonnés" delay={300} />
    </View>
  );
});

export { ProfileStats };

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...typography.h2,
    fontFamily: typography.priceLarge.fontFamily,
    color: colors.charcoal,
  },
  statLabel: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },
});
