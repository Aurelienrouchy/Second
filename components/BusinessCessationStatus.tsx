import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import type { BusinessCessationStatus as Status } from '@/types/businessCessation';
export function BusinessCessationStatus({status}: {status: Status}) {
  return <View style={styles.section}>
    <Text style={styles.body}>{status.newCommerce === 'stop_new' ? 'Le contrôle indépendant bloque les nouvelles opérations commerciales. Les recours et engagements existants suivent leurs propres vérifications.' : status.newCommerce === 'open' ? 'Le contrôle indépendant n’indique pas d’arrêt des nouvelles opérations commerciales.' : 'Le contrôle des nouvelles opérations n’est pas qualifié. Aucun arrêt activé n’est déduit de cette lecture.'}</Text>
    <Text style={styles.caption}>La préparation de ce dossier ne change pas ce contrôle. L’inventaire et les archives ne prouvent ni règlement des obligations, trésorerie disponible ou continuité future du service.</Text>
    <Text style={styles.caption}>Contact déclaré : Direction Seconde — privacy@seconde.app. Sa disponibilité effective n’est pas vérifiée.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
