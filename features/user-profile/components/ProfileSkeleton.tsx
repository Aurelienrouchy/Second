/**
 * ProfileSkeleton — Shimmer loading state for the user profile screen.
 * Replaces the generic ActivityIndicator with a content-shaped skeleton.
 */

import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';

import { Skeleton, SkeletonAvatar, SkeletonText } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 2;
const NUM_COLUMNS = 3;
const ITEM_SIZE = (SCREEN_WIDTH - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

export const ProfileSkeleton = React.memo(function ProfileSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header skeleton */}
      <View style={styles.headerZone}>
        <View style={styles.avatarRow}>
          <SkeletonAvatar size={80} />
          <View style={styles.nameCol}>
            <Skeleton width="70%" height={22} />
            <Skeleton width="40%" height={14} style={styles.gap} />
            <Skeleton width="55%" height={12} style={styles.gap} />
          </View>
        </View>

        {/* Bio skeleton */}
        <SkeletonText lines={2} style={styles.bioSkeleton} />

        {/* Style tags skeleton */}
        <View style={styles.tagsRow}>
          <Skeleton width={72} height={26} borderRadius={radius.xs} />
          <Skeleton width={60} height={26} borderRadius={radius.xs} />
          <Skeleton width={84} height={26} borderRadius={radius.xs} />
        </View>

        {/* Stats skeleton */}
        <View style={styles.statsRow}>
          {[0, 1, 2, 3].map((i) => (
            <React.Fragment key={i}>
              {i > 0 && <View style={styles.statDivider} />}
              <View style={styles.statItem}>
                <Skeleton width={36} height={22} />
                <Skeleton width={48} height={12} style={styles.statGap} />
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      {/* Tabs skeleton */}
      <View style={styles.tabsSkeleton}>
        <Skeleton width={80} height={16} />
        <Skeleton width={80} height={16} />
      </View>

      {/* Grid skeleton */}
      <View style={styles.gridSkeleton}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            width={ITEM_SIZE}
            height={ITEM_SIZE * 1.3}
            borderRadius={0}
          />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerZone: {
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  nameCol: {
    flex: 1,
  },
  gap: {
    marginTop: 6,
  },
  bioSkeleton: {
    marginBottom: spacing.md,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },
  statGap: {
    marginTop: 2,
  },
  tabsSkeleton: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  gridSkeleton: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
});
