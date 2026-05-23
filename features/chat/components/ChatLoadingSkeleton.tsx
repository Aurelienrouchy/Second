import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@/components/ui/Skeleton';
import { colors, radius, spacing } from '@/constants/theme';

export const ChatLoadingSkeleton = React.memo(function ChatLoadingSkeleton() {
  return (
    <>
      {/* Header skeleton */}
      <View style={styles.header}>
        <Skeleton width={36} height={36} borderRadius={radius.full} />
        <View style={styles.headerCenter}>
          <Skeleton width={36} height={36} borderRadius={radius.full} />
          <View style={styles.headerInfo}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="30%" height={11} style={styles.headerSubSkeleton} />
          </View>
        </View>
        <Skeleton width={36} height={36} borderRadius={radius.full} />
      </View>

      {/* Article bar skeleton */}
      <View style={styles.articleBar}>
        <Skeleton width={48} height={60} borderRadius={radius.xs} />
        <View style={styles.articleInfo}>
          <Skeleton width="55%" height={14} />
          <Skeleton width="25%" height={18} />
        </View>
      </View>

      {/* Message bubbles skeleton */}
      <View style={styles.messages}>
        <View style={styles.incomingRow}>
          <Skeleton width={28} height={28} borderRadius={radius.full} />
          <Skeleton width="55%" height={48} borderRadius={radius.md} />
        </View>
        <View style={styles.outgoingRow}>
          <Skeleton width="45%" height={36} borderRadius={radius.md} />
        </View>
        <View style={styles.incomingRow}>
          <Skeleton width={28} height={28} borderRadius={radius.full} />
          <Skeleton width="65%" height={60} borderRadius={radius.md} />
        </View>
        <View style={styles.outgoingRow}>
          <Skeleton width="40%" height={36} borderRadius={radius.md} />
        </View>
      </View>

      {/* Input bar skeleton */}
      <View style={styles.inputBar}>
        <Skeleton width={36} height={36} borderRadius={radius.full} />
        <Skeleton width="100%" height={40} borderRadius={radius.md} style={styles.inputSkeleton} />
        <Skeleton width={36} height={36} borderRadius={radius.full} />
      </View>
    </>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.md,
  },
  headerInfo: {
    flex: 1,
    marginLeft: spacing.md,
    gap: 0,
  },
  headerSubSkeleton: {
    marginTop: 4,
  },
  articleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  articleInfo: {
    flex: 1,
    marginLeft: spacing.md,
    gap: 4,
  },
  messages: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.md,
  },
  incomingRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  outgoingRow: {
    alignItems: 'flex-end',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  inputSkeleton: {
    flex: 1,
  },
});
