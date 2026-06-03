/**
 * PartyEmptyGrid Component — Swap Zone (DARK identity)
 * Empty state when no items match the active filters, or when the zone has no
 * items yet. Textes cream/sand/whiteTranslucent sur fond deep.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, spacing, radius, sizing, typography } from '@/constants/theme';
import type { PartyEmptyGridProps } from '../types';

export const PartyEmptyGrid = React.memo(function PartyEmptyGrid({
  hasActiveFilters,
  onClearFilters,
}: PartyEmptyGridProps) {
  return (
    <View style={styles.emptyGrid}>
      <Ionicons
        name={hasActiveFilters ? 'funnel-outline' : 'shirt-outline'}
        size={sizing.iconLG + sizing.iconMD}
        color={colors.sand}
      />
      <Text style={styles.emptyGridTitle}>
        {hasActiveFilters
          ? 'Aucun article ne correspond aux filtres'
          : 'Aucun article disponible pour l’instant.'}
      </Text>
      <Text style={styles.emptyGridText}>
        {hasActiveFilters
          ? 'Essayez de modifier vos critères de recherche'
          : 'Reviens bientôt, de nouvelles pièces vont arriver.'}
      </Text>
      {hasActiveFilters && (
        <Pressable
          onPress={onClearFilters}
          style={({ pressed }) => [styles.clearFiltersButton, pressed && styles.pressed]}
        >
          <Text style={styles.clearFiltersText}>Réinitialiser</Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  emptyGrid: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing['2xl'],
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  emptyGridTitle: {
    marginTop: spacing.lg,
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    letterSpacing: typography.body.letterSpacing,
    color: colors.cream,
    textAlign: 'center',
  },
  emptyGridText: {
    marginTop: spacing.sm,
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: typography.bodySmall.fontSize,
    lineHeight: typography.bodySmall.lineHeight,
    letterSpacing: typography.bodySmall.letterSpacing,
    color: colors.whiteTranslucent,
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
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
