/**
 * SwapDetailSkeleton
 * Loading placeholder for the swap detail screen.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Skeleton, SkeletonAvatar, SkeletonText } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';

export const SwapDetailSkeleton = React.memo(function SwapDetailSkeleton() {
  return (
    <View style={styles.container}>
      {/* Sender profile skeleton */}
      <View style={styles.senderRow}>
        <SkeletonAvatar size={44} />
        <View style={styles.senderInfo}>
          <Skeleton width={100} height={14} />
          <Skeleton width={160} height={12} />
        </View>
        <Skeleton width={50} height={12} />
      </View>

      {/* Message bubble skeleton */}
      <View style={styles.messageSkeleton}>
        <SkeletonText lines={2} />
      </View>

      {/* Items section skeleton */}
      <View style={styles.itemsSection}>
        <Skeleton width={90} height={10} />
        <View style={styles.itemCard}>
          <Skeleton width={72} height={72} borderRadius={8} />
          <View style={styles.itemInfo}>
            <Skeleton width={140} height={14} />
            <Skeleton width={80} height={12} />
            <Skeleton width={60} height={14} />
          </View>
        </View>
      </View>

      {/* Second items section skeleton */}
      <View style={styles.itemsSection}>
        <Skeleton width={110} height={10} />
        <View style={styles.itemCard}>
          <Skeleton width={72} height={72} borderRadius={8} />
          <View style={styles.itemInfo}>
            <Skeleton width={120} height={14} />
            <Skeleton width={90} height={12} />
            <Skeleton width={60} height={14} />
          </View>
        </View>
      </View>

      {/* Summary skeleton */}
      <View style={styles.summarySkeleton}>
        <Skeleton width="100%" height={80} borderRadius={8} />
      </View>

      {/* Action buttons skeleton */}
      <View style={styles.actionsSkeleton}>
        <Skeleton width="100%" height={48} borderRadius={8} />
        <Skeleton width="100%" height={48} borderRadius={8} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 16,
    gap: 12,
  },
  spacer: {
    width: 36,
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 20,
    gap: 12,
    backgroundColor: colors.surfaceWarm,
  },
  senderInfo: {
    flex: 1,
    gap: 6,
  },
  messageSkeleton: {
    marginHorizontal: spacing.md,
    marginVertical: 20,
    padding: 14,
    backgroundColor: colors.cream,
    borderRadius: 12,
  },
  itemsSection: {
    paddingHorizontal: spacing.md,
    marginBottom: 20,
    gap: 8,
  },
  itemCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    backgroundColor: colors.surfaceWarm,
    borderRadius: 16,
  },
  itemInfo: {
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  summarySkeleton: {
    marginHorizontal: spacing.md,
    marginVertical: 20,
  },
  actionsSkeleton: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
});
