/**
 * ShippingCheckoutSkeleton
 * Skeleton loading state for the shipping checkout screen.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';

// =============================================================================
// COMPONENT
// =============================================================================

export const ShippingCheckoutSkeleton = React.memo(
  function ShippingCheckoutSkeleton() {
    return (
      <View style={styles.container}>
        {/* Section title skeleton */}
        <Skeleton width={160} height={10} />

        {/* Address form skeleton */}
        <View style={styles.formGroup}>
          {/* Full name */}
          <View style={styles.formField}>
            <Skeleton width={90} height={8} />
            <Skeleton width="70%" height={14} style={styles.inputSkeleton} />
          </View>
          {/* Address */}
          <View style={styles.formField}>
            <Skeleton width={60} height={8} />
            <Skeleton width="85%" height={14} style={styles.inputSkeleton} />
          </View>
          {/* Apartment */}
          <View style={styles.formField}>
            <Skeleton width={150} height={8} />
            <Skeleton width="40%" height={14} style={styles.inputSkeleton} />
          </View>
          {/* City + Postal code row */}
          <View style={styles.formFieldRow}>
            <View style={[styles.formFieldHalf, styles.formFieldHalfLeft]}>
              <Skeleton width={40} height={8} />
              <Skeleton width="60%" height={14} style={styles.inputSkeleton} />
            </View>
            <View style={styles.formFieldHalf}>
              <Skeleton width={80} height={8} />
              <Skeleton width="70%" height={14} style={styles.inputSkeleton} />
            </View>
          </View>
        </View>

        {/* Shipping section title */}
        <Skeleton width={80} height={10} />

        {/* Shipping estimate cards */}
        <View style={styles.estimateCard}>
          <Skeleton width={20} height={20} borderRadius={10} />
          <View style={styles.estimateInfo}>
            <Skeleton width={140} height={13} />
            <Skeleton
              width={100}
              height={11}
              style={styles.estimateDelaySkeleton}
            />
          </View>
          <Skeleton width={50} height={16} />
        </View>
        <View style={styles.estimateCard}>
          <Skeleton width={20} height={20} borderRadius={10} />
          <View style={styles.estimateInfo}>
            <Skeleton width={120} height={13} />
            <Skeleton
              width={90}
              height={11}
              style={styles.estimateDelaySkeleton}
            />
          </View>
          <Skeleton width={50} height={16} />
        </View>

        {/* Price breakdown section title */}
        <Skeleton width={120} height={10} style={styles.priceTitleSkeleton} />

        {/* Price breakdown box */}
        <View style={styles.priceBreakdown}>
          <View style={styles.priceRow}>
            <Skeleton width={50} height={13} />
            <Skeleton width={60} height={13} />
          </View>
          <View style={styles.priceRow}>
            <Skeleton width={140} height={13} />
            <Skeleton width={50} height={13} />
          </View>
          <View style={styles.priceRow}>
            <Skeleton width={170} height={13} />
            <Skeleton width={45} height={13} />
          </View>
          <View style={styles.divider} />
          <View style={styles.priceRow}>
            <Skeleton width={40} height={14} />
            <Skeleton width={80} height={22} />
          </View>
        </View>
      </View>
    );
  },
);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
  },
  formGroup: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    overflow: 'hidden',
    marginBottom: 20,
    marginTop: 12,
  },
  formField: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  formFieldRow: {
    flexDirection: 'row',
  },
  formFieldHalf: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  formFieldHalfLeft: {
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  inputSkeleton: {
    marginTop: spacing.xs,
  },
  estimateCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 14,
    marginBottom: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  estimateInfo: {
    flex: 1,
  },
  estimateDelaySkeleton: {
    marginTop: 4,
  },
  priceTitleSkeleton: {
    marginTop: 20,
  },
  priceBreakdown: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 16,
    marginTop: 16,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
});
