/**
 * SwapPartyDetailSkeleton Component
 * Composed skeleton loader for the swap party detail screen
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

import { Skeleton, SkeletonText } from '@/components/ui';
import { colors } from '@/constants/theme';

export const SwapPartyDetailSkeleton = React.memo(function SwapPartyDetailSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header skeleton */}
      <View style={styles.header}>
        <Skeleton width={32} height={32} borderRadius={16} />
        <View style={styles.headerTitle}>
          <Skeleton width={100} height={9} borderRadius={2} />
          <Skeleton width={180} height={18} borderRadius={2} style={styles.titleSpacing} />
        </View>
        <Skeleton width={40} height={24} borderRadius={4} />
      </View>

      {/* My articles section skeleton */}
      <View style={styles.myArticlesSection}>
        <View style={styles.myArticlesHeader}>
          <Skeleton width={180} height={10} borderRadius={2} />
          <Skeleton width={70} height={24} borderRadius={2} />
        </View>
        <View style={styles.articleRow}>
          <Skeleton width={48} height={60} borderRadius={0} />
          <View style={styles.articleRowContent}>
            <Skeleton width={60} height={10} borderRadius={2} />
            <Skeleton width={120} height={15} borderRadius={2} style={styles.smallSpacing} />
          </View>
          <View style={styles.articleRowValue}>
            <Skeleton width={40} height={11} borderRadius={2} />
            <Skeleton width={30} height={18} borderRadius={2} style={styles.smallSpacing} />
          </View>
        </View>
      </View>

      {/* Grid label skeleton */}
      <View style={styles.gridLabel}>
        <Skeleton width={160} height={10} borderRadius={2} />
      </View>

      {/* Product grid skeleton - 2 columns */}
      <View style={styles.gridContainer}>
        <View style={styles.gridRow}>
          <View style={styles.gridCard}>
            <Skeleton width="100%" height={0} borderRadius={0} style={styles.cardImage} />
            <View style={styles.cardInfo}>
              <Skeleton width={60} height={9} borderRadius={2} />
              <SkeletonText lines={1} style={styles.smallSpacing} />
              <View style={styles.cardFooter}>
                <Skeleton width={40} height={14} borderRadius={2} />
                <Skeleton width={20} height={10} borderRadius={2} />
              </View>
            </View>
          </View>
          <View style={styles.gridCard}>
            <Skeleton width="100%" height={0} borderRadius={0} style={styles.cardImage} />
            <View style={styles.cardInfo}>
              <Skeleton width={50} height={9} borderRadius={2} />
              <SkeletonText lines={1} style={styles.smallSpacing} />
              <View style={styles.cardFooter}>
                <Skeleton width={35} height={14} borderRadius={2} />
                <Skeleton width={20} height={10} borderRadius={2} />
              </View>
            </View>
          </View>
        </View>
        <View style={styles.gridRow}>
          <View style={styles.gridCard}>
            <Skeleton width="100%" height={0} borderRadius={0} style={styles.cardImage} />
            <View style={styles.cardInfo}>
              <Skeleton width={70} height={9} borderRadius={2} />
              <SkeletonText lines={1} style={styles.smallSpacing} />
              <View style={styles.cardFooter}>
                <Skeleton width={45} height={14} borderRadius={2} />
                <Skeleton width={20} height={10} borderRadius={2} />
              </View>
            </View>
          </View>
          <View style={styles.gridCard}>
            <Skeleton width="100%" height={0} borderRadius={0} style={styles.cardImage} />
            <View style={styles.cardInfo}>
              <Skeleton width={55} height={9} borderRadius={2} />
              <SkeletonText lines={1} style={styles.smallSpacing} />
              <View style={styles.cardFooter}>
                <Skeleton width={38} height={14} borderRadius={2} />
                <Skeleton width={20} height={10} borderRadius={2} />
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  headerTitle: {
    flex: 1,
  },
  titleSpacing: {
    marginTop: 6,
  },
  myArticlesSection: {
    backgroundColor: 'rgba(122, 140, 110, 0.06)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(122, 140, 110, 0.12)',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  myArticlesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  articleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  articleRowContent: {
    flex: 1,
  },
  articleRowValue: {
    alignItems: 'flex-end',
  },
  smallSpacing: {
    marginTop: 4,
  },
  gridLabel: {
    paddingHorizontal: 16,
    paddingTop: 14,
    marginBottom: 12,
  },
  gridContainer: {
    gap: 0,
  },
  gridRow: {
    flexDirection: 'row',
  },
  gridCard: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  cardImage: {
    aspectRatio: 3 / 4,
  },
  cardInfo: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
});
