/**
 * PartyEmptyGrid Component
 * Empty state when no items match in the swap party grid
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text, Caption } from '@/components/ui';
import { colors, fonts, spacing } from '@/constants/theme';
import type { PartyEmptyGridProps } from '../types';

export const PartyEmptyGrid = React.memo(function PartyEmptyGrid({
  hasActiveFilters,
  onClearFilters,
}: PartyEmptyGridProps) {
  return (
    <View style={styles.emptyGrid}>
      <Ionicons
        name={hasActiveFilters ? 'funnel-outline' : 'swap-horizontal'}
        size={48}
        color={colors.sage}
      />
      <Text style={styles.emptyGridTitle}>
        {hasActiveFilters
          ? 'Aucun article ne correspond aux filtres'
          : 'Aucun article disponible'}
      </Text>
      <Caption style={styles.emptyGridText}>
        {hasActiveFilters
          ? 'Essayez de modifier vos critères de recherche'
          : 'Revenez plus tard'}
      </Caption>
      {hasActiveFilters && (
        <Pressable
          onPress={onClearFilters}
          style={({ pressed }) => [styles.clearFiltersButton, pressed && { opacity: 0.7 }]}
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
  emptyGridTitle: {
    marginTop: spacing.lg,
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.charcoal,
    textAlign: 'center',
  },
  emptyGridText: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.sage,
  },
  clearFiltersText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.sage,
  },
});
