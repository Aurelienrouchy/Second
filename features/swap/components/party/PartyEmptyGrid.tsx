/**
 * PartyEmptyGrid Component — Le Troc (DARK identity)
 * Empty state when no items match the active filters, or when the zone has no
 * items yet. Textes cream/sand/whiteTranslucent sur fond deep.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';

import { Text } from '@/components/ui';
import { colors, spacing, radius, sizing, typography } from '@/constants/theme';
import type { PartyEmptyGridProps } from '@/features/swap/types';

export const PartyEmptyGrid = React.memo(function PartyEmptyGrid({
  hasActiveFilters,
  onClearFilters,
}: PartyEmptyGridProps) {
  return (
    <View style={styles.emptyGrid}>
      <Text style={styles.emptyGridTitle}>
        {hasActiveFilters
          ? 'Aucun article ne correspond aux filtres'
          : 'Aucun article à échanger pour le moment.'}
      </Text>
      <Text style={styles.emptyGridText}>
        {hasActiveFilters
          ? 'Essayez de modifier vos critères de recherche'
          : 'Vous pouvez déjà ajouter les vôtres.'}
      </Text>
      {hasActiveFilters && (
        <Pressable
          accessibilityRole="button"
          onPress={onClearFilters}
          style={({ pressed }) => [
            styles.clearFiltersButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.clearFiltersText}>Effacer les filtres</Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  emptyGrid: {
    marginHorizontal: spacing.xs,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.none,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  emptyGridTitle: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    letterSpacing: typography.body.letterSpacing,
    color: colors.foreground,
    textAlign: 'center',
  },
  emptyGridText: {
    marginTop: spacing.sm,
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: typography.bodySmall.fontSize,
    lineHeight: typography.bodySmall.lineHeight,
    letterSpacing: typography.bodySmall.letterSpacing,
    color: colors.foregroundSecondary,
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: sizing.minTouchTarget,
    borderRadius: radius.none,
    borderWidth: 1,
    borderColor: colors.rust,
  },
  clearFiltersText: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    letterSpacing: typography.button.letterSpacing,
    textTransform: 'uppercase',
    color: colors.rust,
  },
});
