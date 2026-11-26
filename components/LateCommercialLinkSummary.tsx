import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import type { LateCommercialLink } from '@/types/lateCommercialRecourse';

export function LateCommercialLinkSummary({link}: {link: LateCommercialLink}) {
  return <View style={styles.section}>
    <Text style={styles.body}>Constat acheteur sélectionné : {link.topic === 'authenticity' ? 'contestation d’authenticité' : 'différence matérielle déclarée'}.</Text>
    <Text selectable style={styles.caption}>Commande : {link.transactionId}{'\n'}Contribution : {link.contributionId}{'\n'}Empreinte : {link.contributionHash}</Text>
    <Text style={styles.caption}>Cette liaison conserve le constat d’origine. Le dépôt et la date de découverte déclarée ne prouvent ni défaut, admission à l’examen ou droit à un remboursement. Aucun délai de recours n’est prolongé.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
