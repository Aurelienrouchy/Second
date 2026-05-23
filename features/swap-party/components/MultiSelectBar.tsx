/**
 * MultiSelectBar Component
 * Bottom action bar when items are selected for swap proposal
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';

import { Text } from '@/components/ui';
import { colors, fonts, spacing } from '@/constants/theme';
import type { MultiSelectBarProps } from '../types';

export const MultiSelectBar = React.memo(function MultiSelectBar({
  selectedCount,
  canPropose,
  onCancel,
  onPropose,
}: MultiSelectBarProps) {
  if (selectedCount === 0) return null;

  return (
    <View style={styles.multiSelectBar}>
      <Pressable
        style={({ pressed }) => [styles.cancelSelectButton, pressed && { opacity: 0.7 }]}
        onPress={onCancel}
      >
        <Text style={styles.cancelButtonText}>Annuler</Text>
      </Pressable>

      <Text style={styles.selectedCountText}>
        {selectedCount} sélectionné{selectedCount > 1 ? 's' : ''}
      </Text>

      {canPropose && (
        <Pressable
          style={({ pressed }) => [styles.proposeButton, pressed && { opacity: 0.7 }]}
          onPress={onPropose}
        >
          <Text style={styles.proposeButtonText}>Proposer</Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  multiSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  cancelSelectButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  cancelButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  selectedCountText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  proposeButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.sage,
    borderRadius: 0,
  },
  proposeButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.white,
  },
});
