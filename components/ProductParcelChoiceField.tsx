import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { PARCEL_CHOICE_LABELS } from '@/utils/productParcelStatement';
export function ProductParcelChoiceField<T extends string>({label, value, options, disabled, onChange}: {label: string; value: T | null; options: readonly T[]; disabled: boolean; onChange: (value: T) => void}) {
  return <View style={styles.section}><Text style={styles.label}>{label}</Text>{options.map(option => <Button key={option} variant={value === option ? 'primary' : 'secondary'} disabled={disabled} onPress={() => {if (!disabled) onChange(option);}}>{PARCEL_CHOICE_LABELS[option] ?? option}</Button>)}</View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, label: {...typography.bodySmall, color: colors.foreground}});
