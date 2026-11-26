import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import { ReturnToSenderReportSummary } from '@/components/ReturnToSenderReportSummary';
import { colors, spacing, typography } from '@/constants/theme';
import type { AdminReturnToSenderFinancialSource } from '@/types/adminReturnToSenderFinancial';
import type { PurchaseRefundAllocation } from '@/types/purchaseRefund';
import { PurchaseRefundTermsSummary } from '@/components/PurchaseRefundTermsSummary';

type ExaminedReport = AdminReturnToSenderFinancialSource['reports'][number];
const keyExtractor = (report: ExaminedReport) => report.caseId;
const renderReport = ({item}: ListRenderItemInfo<ExaminedReport>) => <View style={styles.report}>
  <ReturnToSenderReportSummary report={item} />
  <Text selectable style={styles.caption}>Cas : {item.caseId} · révision : {item.caseRevision}</Text>
  <Text selectable style={styles.caption}>Empreinte du cas : {item.caseHash}</Text>
  <Text selectable style={styles.caption}>Source d’origine : {item.source.orderRevision} · {item.source.sourceHash}</Text>
  <Text selectable style={styles.caption}>Source financière d’origine : {item.source.financialSourceHash}</Text>
  {item.source.capture ? <>
    <Text selectable style={styles.caption}>Capture conservée : {item.source.capture.captureId} · lecture : {item.source.capture.readVersion}</Text>
    <Text selectable style={styles.caption}>Empreinte affichée : {item.source.capture.displayHash} · source : {item.source.capture.sourceHash}</Text>
  </> : <Text style={styles.caption}>Capture : {item.source.captureQualification === 'absent' ? 'absente dans la source examinée' : 'qualification historique inconnue'}.</Text>}
</View>;

export function AdminReturnToSenderFinancialReview({source, allocation}: {source: AdminReturnToSenderFinancialSource; allocation?: PurchaseRefundAllocation}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Déclarations incluses dans cet examen financier</Text>
    <Text style={styles.caption}>Les {source.reports.length} déclarations ci-dessous font partie de cet aperçu. Examinez toute la liste avant de confirmer. Un nouveau cas ou une source modifiée exige un nouvel aperçu explicite.</Text>
    <Text selectable style={styles.caption}>Ensemble des cas : {source.caseSetHash}</Text>
    <Text selectable style={styles.caption}>Source financière examinée : {source.financialSourceHash}</Text>
    <Text selectable style={styles.caption}>Source de l’autorisation examinée : {source.authorizationSourceHash}</Text>
    <View style={styles.list}><FlashList data={source.reports} keyExtractor={keyExtractor} renderItem={renderReport} nestedScrollEnabled /></View>
    {allocation ? <PurchaseRefundTermsSummary terms={allocation.terms} /> : <Text style={styles.caption}>Option examinée : remboursement intégral du paiement d’origine. Aucun coût de retour déduit et aucun débit vendeur supplémentaire ; aucune remise en vente.</Text>}
    <Text style={styles.caption}>L’examen porte sur l’instruction financière. Les récits restent à vérifier ; il ne certifie ni retour, possession, réception, contenu, coût ou faute. La garde d’inventaire reste conservée.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, report: {gap: spacing.sm, paddingVertical: spacing.md},
  title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 12}});
