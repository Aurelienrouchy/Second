/**
 * ProposeSwapSkeleton — Loading placeholder for the propose-swap screen.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

import { Skeleton } from '@/components/ui/Skeleton';
import { colors, spacing, radius } from '@/constants/theme';

export const ProposeSwapSkeleton = React.memo(function ProposeSwapSkeleton() {
  return (
    <>
      <View style={styles.content} accessibilityLabel="Chargement de la proposition" accessibilityState={{ busy: true }}>
        {/* Target article section skeleton */}
        <Skeleton width={180} height={24} style={styles.heading} />
        <View style={styles.itemCard}>
          <Skeleton width={56} height={56} borderRadius={radius.sm} />
          <View style={styles.itemCardTextArea}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="30%" height={16} style={styles.price} />
          </View>
        </View>
        {/* Separator skeleton */}
        <View style={styles.separator}>
          <Skeleton width="40%" height={1} />
          <Skeleton width={32} height={32} borderRadius={radius.xl} />
          <Skeleton width="40%" height={1} />
        </View>
        {/* My articles grid skeleton */}
        <Skeleton width={140} height={24} style={styles.heading} />
        <View style={styles.grid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.itemCard}>
              <Skeleton width={56} height={56} borderRadius={radius.sm} />
              <View style={styles.itemCardTextArea}>
                <Skeleton width="50%" height={14} />
                <Skeleton width="25%" height={16} style={styles.price} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </>
  );
});

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.md },
  price: { marginTop: spacing.sm },
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceWarm,
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
