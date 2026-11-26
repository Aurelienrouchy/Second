import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { formatPrice } from '@/utils/formatPrice';
import type { LateCommercialFinancialSituation } from '@/types/lateCommercialRecourse';

export function LateCommercialFinancialSummary({situation}: {situation: LateCommercialFinancialSituation}) {
  return <View style={styles.section}>
    <Text style={styles.body}>{situation.releaseQualification === 'native_release_movement' && situation.releasedAmountCents !== null
      ? `Mouvement historique de libération attribué à cette vente : ${formatPrice(situation.releasedAmountCents / 100)}.`
      : 'Le montant historique libéré pour cette vente ne peut pas être qualifié. Il reste inconnu.'}</Text>
    {situation.releasedAt ? <Text style={styles.caption}>Date de libération consignée : {new Date(situation.releasedAt).toLocaleString(APP_LOCALE)}.</Text> : null}
    <Text style={styles.caption}>Cette observation ne donne ni le solde actuel de la vente, ni le solde global du vendeur. L’attribution à un retrait et l’arrivée bancaire restent inconnues. L’admission ne reprend pas les fonds déjà libérés ; une décision financière séparée doit examiner les écritures et obligations restantes.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
