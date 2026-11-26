/**
 * ArticleSelectionSection — Displays a labeled list of swap items with add/remove controls.
 * Reused for both sides of the proposal.
 */

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import SwapItemCard from '../shared/SwapItemCard';
import {
  colors,
  fonts,
  spacing,
  radius,
  sizing,
  typography,
  components,
} from '@/constants/theme';
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

export const ArticleSelectionSection = React.memo(
  function ArticleSelectionSection({
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
        <Text style={styles.sectionLabel} accessibilityRole="header">
          {label}
        </Text>

        {items.length === 0 && (
          <View style={styles.emptyCard}>
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
            showValue={false}
            compact={items.length > 1}
            onRemove={disabled ? undefined : () => onRemoveItem(item.articleId)}
          />
        ))}

        <Pressable
          testID={
            variant === 'mine'
              ? 'propose-swap-add-mine'
              : 'propose-swap-add-their'
          }
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
  },
);

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    ...typography.labelUppercase,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    aspectRatio: components.troc.photoRatio,
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.none,
  },
  emptyText: {
    textAlign: 'center',
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
    borderRadius: radius.none,
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
