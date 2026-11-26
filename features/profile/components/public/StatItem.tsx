/**
 * StatItem — Single stat cell (Articles, Ventes, Note, Abonnes).
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, fonts } from '@/constants/theme';

interface StatItemProps {
  value: string | number;
  label: string;
  delay?: number;
}

export const StatItem = React.memo(function StatItem({
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

const styles = StyleSheet.create({
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.charcoal,
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    marginTop: 2,
  },
});
