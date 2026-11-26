import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { components, spacing } from '@/constants/theme';
import type { SwapPartyItem } from '@/types';
import { TrocMosaicRow } from './TrocMosaicRow';

interface TrocImageMosaicProps {
  items: SwapPartyItem[];
  motionEnabled: boolean;
}

export function TrocImageMosaic({ items, motionEnabled }: TrocImageMosaicProps) {
  const [touching, setTouching] = useState(false);
  const photos = Array.from(new Set(
    items.filter((item) => !item.isSwapped).map((item) => item.imageUrl?.trim()).filter((uri): uri is string => !!uri),
  )).slice(0, 12);
  if (photos.length === 0) return null;

  // Repetition is decorative only: the CTA announces the real inventory count.
  const rowCount = components.troc.mosaicRows;
  const rows = Array.from({ length: rowCount }, (_, row) => {
    if (photos.length >= rowCount * 2) {
      return photos.filter((_, index) => index % rowCount === row);
    }
    const offset = row % photos.length;
    return [...photos.slice(offset), ...photos.slice(0, offset)];
  });

  return (
    <View
      testID="home-troc-mosaic"
      style={styles.mosaic}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onTouchStart={() => setTouching(true)}
      onTouchEnd={() => setTouching(false)}
      onTouchCancel={() => setTouching(false)}
    >
      {rows.map((rowPhotos, index) => (
        <TrocMosaicRow
          key={index}
          photos={rowPhotos}
          moving={motionEnabled && !touching}
          reverse={index % 2 === 1}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mosaic: { gap: spacing.sm, overflow: 'hidden' },
});
