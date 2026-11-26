import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui';
import type { SwapItemInfo } from '@/types';
import {
  colors,
  components,
  spacing,
  typography,
  sizing,
} from '@/constants/theme';
export function SwapItemPreview({
  items,
  label,
}: {
  items: SwapItemInfo[];
  label: string;
}) {
  const first = items[0];
  return (
    <View style={styles.preview}>
      <Text style={styles.previewLabel}>{label}</Text>
      <View style={styles.imageFrame}>
        {first?.imageUrl ? (
          <Image
            source={{ uri: first.imageUrl }}
            style={styles.itemImage}
            contentFit="cover"
            accessibilityLabel={first.title}
          />
        ) : (
          <Ionicons
            name="image-outline"
            size={sizing.iconMD}
            color={colors.muted}
          />
        )}
      </View>
      <Text style={styles.itemTitle} numberOfLines={2}>
        {first?.title || 'Article indisponible'}
      </Text>
      {items.length > 1 && (
        <Text style={styles.caption}>
          + {items.length - 1} autre{items.length > 2 ? 's' : ''} article
          {items.length > 2 ? 's' : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { flex: 1, minWidth: 0, gap: spacing.xs },
  previewLabel: { ...typography.labelUppercase, color: colors.foreground },
  imageFrame: {
    width: '100%',
    height: components.troc.previewHeight,
    overflow: 'hidden',
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemImage: { width: '100%', height: '100%' },
  itemTitle: { ...typography.label, color: colors.foreground },
  caption: { ...typography.caption, color: colors.foregroundSecondary },
});
