import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import type { AdminTransportCaseReference, AdminTransportFinancialSource } from '@/types/adminTransportFinancial';
import type { TransportRecordedEntry } from '@/types/transportReview';
import type { PurchaseRefundAllocation } from '@/types/purchaseRefund';
import { PurchaseRefundTermsSummary } from '@/components/PurchaseRefundTermsSummary';
const keyExtractor = (ref: AdminTransportCaseReference) => ref.reviewId;
const renderRef = ({item}: ListRenderItemInfo<AdminTransportCaseReference>) => <View style={styles.block}>
  <Text selectable style={styles.caption}>Dossier : {item.reviewId} · révision : {item.reviewRevision} · empreinte : {item.reviewHash}</Text>
</View>;
const entryKey = (_entry: TransportRecordedEntry, index: number) => String(index);
const renderEntry = ({item}: ListRenderItemInfo<TransportRecordedEntry>) => <View style={styles.block}>
  <Text selectable style={styles.body}>{item.summary}</Text><Text selectable style={styles.caption}>Nature/source déclarées : {item.kind} · {item.source}. Référence : {item.reference ?? 'inconnue'}.</Text>
  <Text style={styles.caption}>Date déclarée : {item.occurredAt ? new Date(item.occurredAt).toLocaleString(APP_LOCALE) : 'inconnue'}. Enregistrée : {item.recordedAt ? new Date(item.recordedAt).toLocaleString(APP_LOCALE) : 'inconnue'}. Vérification indépendante non certifiée.</Text>
</View>;
export function AdminTransportFinancialReview({source, allocation}: {source: AdminTransportFinancialSource; allocation?: PurchaseRefundAllocation}) {
  const review = source.review;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Enquête incluse dans cet aperçu financier</Text>
    <Text style={styles.body}>{source.kind === 'delivery_correction' ? 'Correction de livraison' : 'Exception du transporteur'} · dossier {review.reviewId} · version {review.version}.</Text>
    {review.origin.kind === 'system' && 'provider' in review.origin && review.origin.provider === 'shipengine' ? <Text style={styles.caption}>Signal observé : {review.origin.statusCode} · occurrence fournie : {review.origin.occurredAt ?? 'inconnue'}. Il n’établit ni perte, faute ou réception physique.</Text> : null}
    <Text style={styles.caption}>Capture du dossier : {review.initialSource.captureQualification === 'native_capture' ? 'native historique' : 'absente ou inconnue'}. Cette capture est distincte du bien reçu et ne certifie pas son contenu.</Text>
    {review.initialSource.capture ? <Text selectable style={styles.caption}>Capture : {review.initialSource.capture.captureId} · lecture : {review.initialSource.capture.readVersion} · empreinte : {review.initialSource.capture.displayHash} · source : {review.initialSource.capture.sourceHash}</Text> : null}
    <View style={styles.entries}><FlashList data={review.entries} keyExtractor={entryKey} renderItem={renderEntry} nestedScrollEnabled /></View>
    {review.resolution ? <Text selectable style={styles.body}>Décision documentaire du dossier : {review.resolution.ownerMessage}. Elle ne constitue pas cette autorisation financière.</Text> : null}
    <Text style={styles.caption}>Références de tous les dossiers examinés : {source.caseReferences.length}. Une nouvelle référence ou révision impose un nouvel aperçu explicite.</Text>
    <View style={styles.list}><FlashList data={source.caseReferences} keyExtractor={keyExtractor} renderItem={renderRef} nestedScrollEnabled /></View>
    <Text selectable style={styles.caption}>Ensemble : {source.caseSetHash} · source financière : {source.financialSourceHash} · autorisation : {source.authorizationSourceHash}</Text>
    {allocation ? <PurchaseRefundTermsSummary terms={allocation.terms} /> : <Text style={styles.caption}>Option fixe : remboursement intégral du paiement d’origine, aucun coût de retour déduit ni débit vendeur supplémentaire. Aucun constat de possession, faute ou coût n’est déduit ; les dossiers et gardes d’inventaire restent distincts et aucune remise en vente n’est autorisée.</Text>}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, block: {gap: spacing.xs, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 6}, entries: {height: spacing.xl * 9}});
