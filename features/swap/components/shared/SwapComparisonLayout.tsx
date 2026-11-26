import React, { type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { colors, components } from '@/constants/theme';

/** Two readable sides, stacked for small screens or larger accessibility text. */
export function SwapComparisonLayout({
  received,
  proposed,
}: {
  received: ReactNode;
  proposed: ReactNode;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stacked =
    width < components.troc.compactWidth ||
    fontScale > components.troc.largeFontScale;
  return (
    <View style={[styles.comparison, stacked && styles.stacked]}>
      <View style={styles.column}>{received}</View>
      <View style={[styles.divider, stacked && styles.dividerStacked]} />
      <View style={styles.column}>{proposed}</View>
    </View>
  );
}
const styles = StyleSheet.create({
  comparison: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: components.troc.gridGap,
    position: 'relative',
  },
  stacked: { flexDirection: 'column' },
  column: { flex: 1, minWidth: 0 },
  divider: {
    width: components.troc.borderWidth,
    backgroundColor: colors.borderStrong,
  },
  dividerStacked: { width: '100%', height: components.troc.borderWidth },
});
