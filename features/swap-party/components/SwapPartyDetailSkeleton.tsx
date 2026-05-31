/**
 * SwapPartyDetailSkeleton Component — Swap Zone (DARK identity)
 * Lightweight dark skeleton: lines on colors.dark over a colors.deep canvas.
 * No full-page spinner — just the layout silhouette.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

import { colors, spacing, radius } from '@/constants/theme';

const TILE_ROWS = [0, 1, 2, 3];

export const SwapPartyDetailSkeleton = React.memo(function SwapPartyDetailSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header silhouette */}
      <View style={styles.header}>
        <View style={styles.backDot} />
        <View style={styles.headerTitle}>
          <View style={[styles.line, styles.lineLabel]} />
          <View style={[styles.line, styles.lineTitle]} />
        </View>
      </View>

      {/* Deposit section silhouette */}
      <View style={styles.depositSection}>
        <View style={[styles.line, styles.lineDeposit]} />
        <View style={styles.depositButton} />
      </View>

      {/* Filter chips silhouette */}
      <View style={styles.chipsRow}>
        <View style={styles.chip} />
        <View style={styles.chip} />
        <View style={styles.chip} />
      </View>

      {/* Grid silhouette — 2 columns */}
      <View style={styles.grid}>
        {TILE_ROWS.map((row) => (
          <View key={`row-${row}`} style={styles.gridRow}>
            <View style={styles.gridTile} />
            <View style={styles.gridTile} />
          </View>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  line: {
    backgroundColor: colors.darkSurface2,
    borderRadius: radius.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    gap: spacing.md - 4,
  },
  backDot: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.darkSurface2,
  },
  headerTitle: {
    flex: 1,
    gap: spacing.xs,
  },
  lineLabel: {
    width: '30%',
    height: 9,
  },
  lineTitle: {
    width: '55%',
    height: 18,
  },
  depositSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  lineDeposit: {
    width: '45%',
    height: 10,
  },
  depositButton: {
    height: 44,
    borderRadius: radius.none,
    backgroundColor: colors.darkSurface2,
  },
  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    width: 72,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.darkSurface2,
  },
  grid: {
    marginTop: spacing.sm,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 1,
    marginBottom: 1,
  },
  gridTile: {
    flex: 1,
    aspectRatio: 3 / 4,
    backgroundColor: colors.darkSurface2,
  },
});
