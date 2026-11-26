import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Checkbox} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
import {ordinaryAddressKindLabel} from '@/utils/ordinaryShippingAddress';
import type {OrdinaryShippingAddressKind} from '@/types/shippingPurchase';
export function OrdinaryShippingAddressChoice({kind, accepted, disabled = false, onKind, onAccepted}: {
  kind: OrdinaryShippingAddressKind | null; accepted: boolean; disabled?: boolean;
  onKind: (kind: OrdinaryShippingAddressKind) => void; onAccepted: () => void;
}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>Type d’adresse</Text>
    {(['ordinary_residential', 'ordinary_business'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: kind === value, disabled}}
      disabled={disabled} onPress={() => onKind(value)} style={[styles.option, kind === value && styles.selected]}><Text style={styles.body}>{ordinaryAddressKindLabel(value)}{kind === value ? ' · sélectionnée' : ''}</Text></Pressable>)}
    <Text style={styles.caption}>Livraison au Québec, à domicile ou en entreprise. Les cases postales et points de collecte ne sont pas disponibles.</Text>
    <Checkbox checked={accepted} disabled={disabled || kind === null} onToggle={onAccepted} accessibilityLabel="Je confirme le type de cette adresse">
      <Text style={styles.caption}>Je confirme le type de cette adresse.</Text>
    </Checkbox>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, option: {padding: spacing.md, borderWidth: 1, borderColor: colors.border}, selected: {borderColor: colors.primary, backgroundColor: colors.surfaceWarm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
