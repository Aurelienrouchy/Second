import {StyleSheet, Text, View} from 'react-native';
import type {AuthorityPackageSnapshot} from '@/types/authorityRequest';
import {colors, spacing, typography} from '@/constants/theme';
import {AUTHORITY_FIELD_LABELS} from './AdminAuthorityScopeForm';

export function AdminAuthorityPackageView({snapshot}: {snapshot: AuthorityPackageSnapshot}) {
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Contenu documentaire sélectionné</Text>
    <Text style={styles.caption}>Préparation privée uniquement. Ce contenu ne constitue ni une autorisation juridique, ni un envoi, ni une confirmation de réception ou de préservation des sources.</Text>
    {snapshot.items.map(item => <View key={item.transactionId} style={styles.section}><Text selectable style={styles.title}>Commande {item.transactionId}</Text>
      <Text style={styles.caption}>{item.periodState === 'missing_source' ? 'Source absente.' : item.periodState === 'unknown_date' ? 'Date inconnue : contenu écarté de la période.' : item.periodState === 'outside_period' ? 'Hors de la période retenue.' : item.periodState === 'within_period' ? 'Dans la période retenue.' : 'Aucune période retenue.'}</Text>
      {snapshot.selection.fields.map(field => {const entry = item.fields[field]; return entry ? <Text selectable key={field} style={styles.body}>{AUTHORITY_FIELD_LABELS[field]} · {entry.qualification === 'unknown' ? 'qualification inconnue' : 'valeur native enregistrée'} : {entry.value === null ? 'inconnu' : typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value)}</Text> : null;})}
    </View>)}
    <Text style={styles.caption}>Les montants internes ne prouvent pas un règlement prestataire. Aucun original confidentiel n’est inclus.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
