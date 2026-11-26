import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { LabelRouteAddress } from '@/types/labelRouteAmendment';
import { colors, spacing, typography } from '@/constants/theme';
const FIELDS = [{key: 'name', label: 'Nom du destinataire', max: 100}, {key: 'street', label: 'Rue et numéro', max: 200}, {key: 'line2', label: 'Appartement ou complément (facultatif)', max: 200}, {key: 'city', label: 'Ville', max: 100}, {key: 'postalCode', label: 'Code postal', max: 7}] as const;
export function LabelRouteAddressFields({title, value, onChange}: {title: string; value: LabelRouteAddress; onChange: (value: LabelRouteAddress) => void}) {
  return <View style={styles.section}><Text style={styles.body}>{title} — Québec, Canada</Text>{FIELDS.map(field => <TextInput key={field.key} accessibilityLabel={`${title} : ${field.label}`} placeholder={field.label} value={value[field.key] ?? ''} maxLength={field.max} autoCapitalize={field.key === 'postalCode' ? 'characters' : 'words'} style={styles.input} onChangeText={text => onChange({...value, [field.key]: text})} />)}
    <Text style={styles.caption}>Adresse déclarée pour cet échange privé. Elle ne prouve ni résidence, ni délivrabilité ; aucun profil ne la complète.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
