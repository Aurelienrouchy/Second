import { StyleSheet, Text, View } from 'react-native';
import { WithdrawalTimingSummary } from '@/components/WithdrawalTimingSummary';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import type { SupportWithdrawalTimingContext } from '@/types/supportRequest';
import type { WithdrawalTimingSource } from '@/types/withdrawalTiming';

export function SupportWithdrawalTimingNotice({context, source}: {context: SupportWithdrawalTimingContext; source?: WithdrawalTimingSource | null}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Enquête sur le délai du retrait</Text>
    <Text selectable style={styles.body}>Retrait lié : {context.withdrawalRequestId}.</Text>
    <Text style={styles.caption}>Référence propriétaire capturée au dépôt le {new Date(context.recordedAt).toLocaleString(APP_LOCALE)}. Sa qualification financière à cette date était {context.sourceQualification === 'qualified' ? 'qualifiée' : 'inconnue et à rapprocher'} ; elle ne certifie pas l’état financier actuel.</Text>
    <Text style={styles.caption}>Votre récit reste une déclaration séparée de cette source native. Le dépôt ne certifie ni réception bancaire, examen humain complet ou arrivée à une date donnée.</Text>
    {source !== undefined ? source ? <>
      <Text style={styles.title}>Observation relue pour l’enquête</Text>
      <WithdrawalTimingSummary source={source} />
    </> : <Text style={styles.body}>La source actuelle du retrait ne peut pas être qualifiée. Aucun ancien statut ne remplace cette lecture.</Text> : null}
    <Text style={styles.caption}>Les réponses de l’équipe restent documentaires. Ce ticket ne déclenche ni nouveau retrait, compensation, annulation ni autre mouvement de fonds.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
