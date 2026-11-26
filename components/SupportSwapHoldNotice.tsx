import { StyleSheet, Text, View } from 'react-native';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import type { SupportSwapHoldContext, SupportSwapHoldSource } from '@/types/supportRequest';

export function SupportSwapHoldNotice({context, source}: {context: SupportSwapHoldContext; source?: SupportSwapHoldSource | null}) {
  const value = source?.source;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Assistance pour le complément du troc</Text>
    <Text selectable style={styles.body}>Échange lié : {context.swapId}.</Text>
    <Text style={styles.caption}>Votre participation à cet échange a été qualifiée au dépôt, le {new Date(context.recordedAt).toLocaleString(APP_LOCALE)}. Votre récit est une déclaration séparée de cette référence native.</Text>
    {source && value ? <>
      <Text style={styles.title}>Observation actuelle du complément</Text>
      <Text style={styles.caption}>Lecture du {new Date(source.observedAt).toLocaleString(APP_LOCALE)}.</Text>
      <Text style={styles.body}>{value.state === 'held' ? 'Retenue attribuée qualifiée.' : value.state === 'release_recorded' ? 'Libération enregistrée dans les écritures.' : value.state === 'no_topup' ? 'Aucun complément identifié.' : 'Rapprochement humain nécessaire.'}</Text>
      <Text style={styles.body}>Montant attribué : {value.amountCents === null ? 'non qualifié' : formatPriceWithCurrency(value.amountCents / 100)}.</Text>
      {value.reason ? <Text style={styles.body}>Cause du rapprochement : {value.reason === 'commercial_dispute' ? 'litige enregistré' : value.reason === 'financial_source_reconciliation' ? 'écritures financières à rapprocher' : value.reason === 'reception_source_reconciliation' ? 'confirmations à rapprocher' : 'échéance de retenue non qualifiée'}.</Text> : null}
      <Text style={styles.caption}>Début de retenue : {value.startedAt ? new Date(value.startedAt).toLocaleString(APP_LOCALE) : 'date qualifiée inconnue'}. Échéance initiale : {value.initialDeadlineAt ? new Date(value.initialDeadlineAt).toLocaleString(APP_LOCALE) : 'date qualifiée inconnue'}.</Text>
      <Text style={styles.caption}>La date initiale ne garantit pas une résolution. Les confirmations des participants restent distinctes d’une réception physique effective.</Text>
    </> : null}
    <Text style={styles.caption}>Ce dossier d’assistance ne libère aucun complément, ne certifie aucun paiement ou réception physique, et n’autorise aucun mouvement de fonds. Une réponse de l’équipe reste distincte des opérations financières.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
