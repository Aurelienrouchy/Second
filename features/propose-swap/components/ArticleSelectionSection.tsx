/**
 * ArticleSelectionSection — Displays a labeled list of swap items with add/remove controls.
 * Reused for both initiator ("Mon article") and receiver ("Leur article") sides.
 */

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/ui';
import { SwapItemCard } from '@/components/swap';
import { colors, fonts } from '@/constants/theme';
import type { SwapItemInfo } from '@/types';

type ArticleSelectionSectionProps = {
  label: string;
  items: SwapItemInfo[];
  variant: 'mine' | 'their';
  addButtonLabel: string;
  onRemoveItem: (articleId: string) => void;
  onAdd: () => void;
};

export const ArticleSelectionSection = React.memo(function ArticleSelectionSection({
  label,
  items,
  variant,
  addButtonLabel,
  onRemoveItem,
  onAdd,
}: ArticleSelectionSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>

      {items.map((item) => (
        <SwapItemCard
          key={item.articleId}
          item={item}
          variant={variant}
          onRemove={() => onRemoveItem(item.articleId)}
        />
      ))}

      <Pressable
        testID={variant === 'mine' ? 'propose-swap-add-mine' : 'propose-swap-add-their'}
        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        onPress={onAdd}
      >
        <Text style={styles.addButtonText}>{addButtonLabel}</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 10,
  },
  addButton: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  addButtonText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    fontWeight: '400',
    color: colors.charcoal,
  },
  pressed: {
    opacity: 0.7,
  },
});
