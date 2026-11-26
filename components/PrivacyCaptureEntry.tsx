import {StyleSheet, Text, View} from 'react-native';
import {Checkbox} from '@/components/ui';
import {PrivacyDataValues} from '@/components/PrivacyDataValues';
import type {PrivacyEntry} from '@/types/privacyOperations';
import {colors, spacing, typography} from '@/constants/theme';
export function PrivacyCaptureEntry({entry, selected, disabled, onToggle}: {entry: PrivacyEntry; selected: string[]; disabled: boolean; onToggle: (entry: PrivacyEntry, field: string) => void}) {
  return <View style={styles.section}><Text style={styles.caption}>{entry.phase} · {entry.sourcePath} · {entry.qualification}</Text>{entry.values ? <PrivacyDataValues values={entry.values}/> : <Text style={styles.caption}>Projection indisponible : examen manuel nécessaire.</Text>}
    {entry.qualification === 'native_selected_fields' && entry.values ? Object.keys(entry.values).map(field => <Checkbox key={field} checked={selected.includes(field)} disabled={disabled} onToggle={() => onToggle(entry, field)}><Text style={styles.caption}>Communiquer uniquement le champ {field} de cette source</Text></Checkbox>) : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, caption: {...typography.caption, color: colors.muted}});
