/**
 * ArticleSelectionSection — Displays a labeled list of swap items with add/remove controls.
 * Reused for both sides of the proposal.
 */

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { SwapItemCard } from '@/components/swap';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import type { SwapItemInfo } from '@/types';

type ArticleSelectionSectionProps = {
  label: string;
  items: SwapItemInfo[];
  variant: 'mine' | 'their';
  addButtonLabel: string;
  onRemoveItem: (articleId: string) => void;
  onAdd: () => void;
  disabled?: boolean;
};

export const ArticleSelectionSection = React.memo(function ArticleSelectionSection({
  label,
  items,
  variant,
  addButtonLabel,
  onRemoveItem,
  onAdd,
  disabled = false,
}: ArticleSelectionSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel} accessibilityRole="header">{label}</Text>

      {items.length === 0 && (
        <View style={styles.emptyCard}>
          <Ionicons name="shirt-outline" size={24} color={colors.primary} />
          <Text style={styles.emptyText}>
            {variant === 'mine'
              ? 'Choisissez les articles que vous proposez en échange.'
              : 'Choisissez les articles que vous souhaitez recevoir.'}
          </Text>
        </View>
      )}

      {items.map((item) => (
        <SwapItemCard
          key={item.articleId}
          item={item}
          variant={variant}
          onRemove={disabled ? undefined : () => onRemoveItem(item.articleId)}
        />
      ))}

      <Pressable
        testID={variant === 'mine' ? 'propose-swap-add-mine' : 'propose-swap-add-their'}
        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        onPress={onAdd}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${addButtonLabel} — ${label}`}
        accessibilityState={{ disabled }}
      >
        <Ionicons name="add" size={18} color={colors.primary} />
        <Text style={styles.addButtonText}>{addButtonLabel}</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontFamily: fonts.displayMedium,
    fontSize: 23,
    lineHeight: 28,
    color: colors.charcoal,
    marginBottom: spacing.md,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
  },
  emptyText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: colors.foregroundSecondary,
  },
  addButton: {
    minHeight: sizing.minTouchTarget,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    backgroundColor: colors.transparent,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  addButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.primary,
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
