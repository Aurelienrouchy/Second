import React from 'react';
import {View, StyleSheet} from 'react-native';
import {Text, Button} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
import type {MultiSelectBarProps} from '../../types';
export const MultiSelectBar = React.memo(function MultiSelectBar({selectedCount, canPropose, onCancel, onPropose}: MultiSelectBarProps) {
 return <View style={styles.bar}><View style={styles.heading}><Text style={styles.title}>Votre sélection</Text><Text style={styles.count}>{selectedCount} / 20</Text></View>
  <Text style={styles.count}>Choisissez les pièces d’un même membre.</Text><View style={styles.actions}>
  <Button variant="secondary" style={styles.button} onPress={onCancel}>Annuler</Button>
  <Button style={styles.button} disabled={!canPropose} onPress={onPropose}>Continuer</Button></View></View>;
});
const styles = StyleSheet.create({bar: {padding: spacing.md, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm}, heading: {flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm}, title: {...typography.label, color: colors.foreground}, count: {...typography.caption, color: colors.foregroundSecondary}, actions: {flexDirection: 'row', gap: spacing.sm}, button: {flex: 1}});
