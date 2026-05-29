/**
 * PartyEmptyGrid Component — Swap Zone (DARK identity)
 * Empty state when no items match the active filters, or when the zone has no
 * items yet. Textes cream/sand/whiteTranslucent sur fond deep.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import type { PartyEmptyGridProps } from '../types';

export const PartyEmptyGrid = React.memo(function PartyEmptyGrid({
  hasActiveFilters,
  onClearFilters,
}: PartyEmptyGridProps) {
  return (
    <View style={styles.emptyGrid}>
      <Ionicons
        name={hasActiveFilters ? 'funnel-outline' : 'swap-horizontal'}
        size={sizing.iconLG + sizing.iconMD}
        color={colors.sand}
      />
      <Text style={styles.emptyGridTitle}>
        {hasActiveFilters
          ? 'Aucun article ne correspond aux filtres'
          : 'Aucun article dans la Swap Zone pour l’instant.'}
      </Text>
      <Text style={styles.emptyGridText}>
        {hasActiveFilters
          ? 'Essayez de modifier vos critères de recherche'
          : 'Soyez la première personne à en déposer un.'}
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing['2xl'],
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  emptyGridTitle: {
    marginTop: spacing.lg,
    fontSize: 15,
    fontFamily: fonts.sans,
    color: colors.cream,
    textAlign: 'center',
  },
  emptyGridText: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontFamily: fonts.sans,
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
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.rust,
  },
});
