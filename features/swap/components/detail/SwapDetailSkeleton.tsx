import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { SwapComparisonLayout } from '../shared/SwapComparisonLayout';
import {
  colors,
  spacing,
  sizing,
  components,
  typography,
} from '@/constants/theme';

export const SwapDetailSkeleton = React.memo(function SwapDetailSkeleton() {
  const side = (
    <View style={styles.side}>
      <Skeleton width="80%" height={typography.labelUppercase.lineHeight} />
      <Skeleton
        width="100%"
        height={components.troc.skeletonPhotoHeight}
        borderRadius={components.troc.cardRadius}
      />
      <Skeleton width="85%" height={typography.trocItemTitle.lineHeight} />
      <Skeleton width="60%" height={typography.caption.lineHeight} />
    </View>
  );
  return (
    <View
      style={styles.content}
      accessibilityLabel="Chargement de l’échange"
      accessibilityState={{ busy: true }}
    >
      <Skeleton width="65%" height={sizing.buttonHeight} />
      <SwapComparisonLayout received={side} proposed={side} />
      <Skeleton
        width="100%"
        height={components.troc.messageMinHeight}
        borderRadius={components.troc.fieldRadius}
      />
      <Skeleton
        width="100%"
        height={sizing.buttonHeight}
        borderRadius={components.troc.cardRadius}
      />
    </View>
  );
});
const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    gap: spacing.lg,
    backgroundColor: colors.background,
  },
  side: { gap: spacing.sm },
});
