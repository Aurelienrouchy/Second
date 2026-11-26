import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';

export function BankRefundReconciliationLimits() {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>Rapport interne de rapprochement documentaire</Text>
    <Text style={styles.caption}>Les objets prestataire, leurs identités et les mouvements observés sont présentés séparément. Les montants bruts, frais et nets restent liés à leur devise, leur solde et leur statut ; la somme d’objets ne constitue pas une écriture financière.</Text>
    <Text style={styles.caption}>Les effets locaux prouvés restent distincts des réservations. Les sources inconnues, associations non qualifiées, pages restantes et dates d’observation limitent la portée de chaque constat.</Text>
    <Text style={styles.caption}>L’instruction et la préparation de ce rapport sont documentaires. Elles ne résolvent aucun dossier, ne lèvent aucune garde, n’exécutent aucun mouvement et ne certifient aucune arrivée bancaire. Toute décision financière reste un acte séparé à définir et à qualifier.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
