import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { SwapComparisonLayout } from '../shared/SwapComparisonLayout';
import { spacing, components, sizing, typography } from '@/constants/theme';

export const ProposeSwapSkeleton = React.memo(function ProposeSwapSkeleton() {
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
      accessibilityLabel="Chargement de la proposition"
      accessibilityState={{ busy: true }}
    >
      <SwapComparisonLayout received={side} proposed={side} />
      <Skeleton
        width="100%"
        height={sizing.buttonHeight}
        borderRadius={components.troc.cardRadius}
      />
      <Skeleton
        width="100%"
        height={components.troc.messageMinHeight}
        borderRadius={components.troc.fieldRadius}
      />
    </View>
  );
});
const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg },
  side: { gap: spacing.sm },
});
