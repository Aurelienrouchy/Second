import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '@/components/ui';
import { colors, spacing, radius, sizing, typography } from '@/constants/theme';
import type { MultiSelectBarProps } from '../types';

export const MultiSelectBar = React.memo(function MultiSelectBar({ selectedCount, canPropose, onCancel, onPropose }: MultiSelectBarProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.heading}>
        <Text style={styles.title}>Votre sélection</Text>
        <Text style={styles.count}>{selectedCount} article{selectedCount > 1 ? 's' : ''}</Text>
      </View>
      <Text style={styles.hint}>{selectedCount > 0 ? 'Vous proposerez vos articles à cette personne.' : 'Aucun article sélectionné ne correspond aux filtres.'}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={onCancel}>
          <Text style={styles.cancelText}>Annuler</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canPropose }} style={({ pressed }) => [styles.proposeButton, !canPropose && styles.disabled, pressed && styles.pressed]} onPress={onPropose} disabled={!canPropose}>
          <Text style={styles.proposeText}>Continuer</Text>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { padding: spacing.md, backgroundColor: colors.darkSurface2, borderTopWidth: 1, borderTopColor: colors.sand, gap: spacing.sm },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.label, color: colors.cream },
  count: { ...typography.caption, color: colors.sand },
  hint: { ...typography.caption, color: colors.creamTranslucent60 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  cancelButton: { flex: 1, minHeight: sizing.minTouchTarget, padding: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.darkBorderStrong },
  cancelText: { ...typography.label, color: colors.cream, textAlign: 'center' },
  proposeButton: { flex: 1, minHeight: sizing.minTouchTarget, padding: spacing.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDark, borderRadius: radius.md },
  proposeText: { ...typography.label, color: colors.cream, textAlign: 'center' },
});
