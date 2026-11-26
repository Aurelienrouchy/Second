import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  colors,
  spacing,
  components,
  typography,
  sizing,
} from '@/constants/theme';

export const SwapPartyDetailSkeleton = React.memo(
  function SwapPartyDetailSkeleton() {
    return (
      <View
        style={styles.container}
        accessibilityLabel="Chargement des pièces à échanger"
        accessibilityState={{ busy: true }}
      >
        <View style={styles.title} />
        <View style={styles.chips}>
          <View style={styles.chip} />
          <View style={styles.chip} />
          <View style={styles.chip} />
        </View>
        <View style={styles.featured} />
        <View style={styles.line} />
        <View style={styles.chips}>
          <View style={styles.tile} />
          <View style={styles.tile} />
        </View>
      </View>
    );
  },
);
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.md,
  },
  title: {
    width: '70%',
    height: typography.trocTitle.lineHeight,
    backgroundColor: colors.surfaceWarm,
  },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1,
    height: sizing.minTouchTarget,
    backgroundColor: colors.surfaceWarm,
  },
  featured: {
    width: '100%',
    aspectRatio: components.troc.featuredPhotoRatio,
    backgroundColor: colors.surfaceWarm,
  },
  line: {
    width: '60%',
    height: typography.trocItemTitle.lineHeight,
    backgroundColor: colors.surfaceWarm,
  },
  tile: {
    flex: 1,
    aspectRatio: components.troc.photoRatio,
    backgroundColor: colors.surfaceWarm,
  },
});
