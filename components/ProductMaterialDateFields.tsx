import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import type { ProductMaterialDateDraft } from '@/types/productMaterialReview';
const choices = [{value: 'unknown', label: 'Je ne connais pas cette date'}, {value: 'civil_day', label: 'Je connais le jour, sans l’heure'},
  {value: 'instant', label: 'Je dispose de la date et de l’heure exactes'}] as const;
export function ProductMaterialDateFields({label, value, onChange, disabled = false}: {label: string; value: ProductMaterialDateDraft;
  onChange: (next: ProductMaterialDateDraft) => void; disabled?: boolean}) {
  return <View style={styles.section}>
    <Text style={styles.label}>{label}</Text>
    {choices.map(choice => <Button key={choice.value} variant={value.precision === choice.value ? 'primary' : 'secondary'} disabled={disabled}
      onPress={() => {if (!disabled) onChange({precision: choice.value, value: value.precision === choice.value ? value.value : ''});}}>{choice.label}</Button>)}
    {value.precision === 'civil_day' || value.precision === 'instant' ? <TextInput value={value.value} editable={!disabled} maxLength={value.precision === 'civil_day' ? 10 : 24}
      accessibilityLabel={`${label} : date déclarée`} style={styles.input} autoCapitalize="none" autoCorrect={false}
      placeholder={value.precision === 'civil_day' ? 'AAAA-MM-JJ' : 'AAAA-MM-JJTHH:mm:ss.SSSZ'} placeholderTextColor={colors.muted}
      onChangeText={text => {if (!disabled) onChange({...value, value: text});}} /> : null}
    <Text style={styles.caption}>{value.precision === 'instant' ? 'Recopiez uniquement un horodatage UTC exact dont vous disposez. Si l’heure ou le fuseau est inconnu, choisissez seulement le jour.' :
      'Un jour sans heure reste une précision de votre récit. Aucune heure à minuit, aucun fuseau ou heure de réception ne sera inventé.'}</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, label: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
