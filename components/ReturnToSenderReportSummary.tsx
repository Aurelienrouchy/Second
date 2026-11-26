import { StyleSheet, Text, View } from 'react-native';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import type { ReturnToSenderReport } from '@/types/returnToSender';

export function ReturnToSenderReportSummary({report}: {report: ReturnToSenderReport}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Retour à l’expéditeur signalé par un participant</Text>
    <Text selectable style={styles.body}>Récit déclaré : {report.narrative}</Text>
    <Text style={styles.caption}>Déclaration enregistrée le {new Date(report.recordedAt).toLocaleString(APP_LOCALE)}. Cette date ne prouve pas l’occurrence d’un retour ou d’une réception.</Text>
    <Text style={styles.caption}>{report.source.captureQualification === 'native_capture' ? 'Une référence exacte de suivi a été conservée avec ce récit. Elle ne certifie pas un retour à l’expéditeur.' :
      report.source.captureQualification === 'absent' ? 'Aucune référence de capture de suivi n’était présente dans la source lue.' : 'La capture de suivi liée à cette source était historiquement inconnue.'}</Text>
    <Text style={styles.caption}>La source de ce dossier est conservée dans l’historique ; elle ne remplace pas une lecture actuelle de la commande et de ses écritures financières.</Text>
    <Text style={styles.caption}>Ce récit reste non vérifié. Il ne certifie ni possession, réception, contenu, coût, faute ou possibilité d’interception. Il n’autorise aucun remboursement, mouvement de fonds ou remise en vente. L’équipe doit examiner le dossier.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
