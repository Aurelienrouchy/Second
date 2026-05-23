/**
 * ProposeSwapSkeleton — Loading placeholder for the propose-swap screen.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Skeleton } from '@/components/ui/Skeleton';
import { colors, spacing, radius } from '@/constants/theme';

export const ProposeSwapSkeleton = React.memo(function ProposeSwapSkeleton() {
  return (
    <>
      {/* Top bar skeleton */}
      <View style={styles.topBar}>
        <View style={styles.backButton}>
          <Ionicons name="chevron-back" size={20} color={colors.charcoal} />
        </View>
        <Skeleton width={160} height={20} />
      </View>
      <View style={styles.content}>
        {/* Target article section skeleton */}
        <Skeleton width={80} height={10} style={{ marginBottom: spacing.sm }} />
        <View style={styles.itemCard}>
          <Skeleton width={56} height={56} borderRadius={radius.sm} />
          <View style={styles.itemCardTextArea}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="30%" height={16} style={{ marginTop: spacing.sm }} />
          </View>
        </View>
        {/* Separator skeleton */}
        <View style={styles.separator}>
          <Skeleton width="40%" height={1} />
          <Skeleton width={32} height={32} borderRadius={16} />
          <Skeleton width="40%" height={1} />
        </View>
        {/* My articles grid skeleton */}
        <Skeleton width={120} height={10} style={{ marginBottom: spacing.sm }} />
        <View style={styles.grid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.itemCard}>
              <Skeleton width={56} height={56} borderRadius={radius.sm} />
              <View style={styles.itemCardTextArea}>
                <Skeleton width="50%" height={14} />
                <Skeleton width="25%" height={16} style={{ marginTop: spacing.sm }} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </>
  );
});

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: 'rgba(245, 240, 232, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    marginBottom: spacing.sm,
  },
  itemCardTextArea: {
    flex: 1,
  },
  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  grid: {
    gap: spacing.sm,
  },
});
