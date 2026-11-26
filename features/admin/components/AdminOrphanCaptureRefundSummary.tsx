import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { formatCents } from '@/utils/formatPrice';
import type { OrphanCaptureRefundSource, OrphanCaptureRefundReceipt } from '@/types/orphanCaptureRefund';

const labels: Record<OrphanCaptureRefundSource['state'] | OrphanCaptureRefundReceipt['state'], string> = {
  available: 'Les sources permettent un examen du remboursement d’origine.', unqualified: 'Les sources ne qualifient pas actuellement une nouvelle demande.',
  unrecorded: 'Aucun reçu de cette intention n’est retrouvé. Cela ne prouve pas une absence d’effet.', not_executed: 'Cette intention a été neutralisée avant toute réservation connue.',
  reserved: 'Une réservation existe. Seul un nouvel aperçu de cette même référence peut qualifier sa reprise avant toute tentative.',
  outcome_unknown: 'L’issue reste inconnue. Relisez le même reçu ; aucun nouvel envoi automatique n’est permis.',
  pending: 'Le remboursement d’origine est en cours chez le prestataire.', requires_action: 'Le prestataire demande une action. Le même remboursement reste à examiner.',
  succeeded: 'Le remboursement d’origine est confirmé par les preuves du prestataire.', failed: 'Le remboursement a échoué. Une nouvelle tentative exige des sources actuelles et les fonds restitués prouvés.',
  canceled: 'Le remboursement a été annulé. Une nouvelle tentative exige un nouvel examen des fonds réellement disponibles.',
};
export function AdminOrphanCaptureRefundSummary({value}: {value: OrphanCaptureRefundSource | OrphanCaptureRefundReceipt}) {
  const amount = 'refundableCents' in value ? value.refundableCents : value.amountCents;
  return <View style={styles.section}>
    <Text style={styles.body}>{labels[value.state]}</Text>
    <Text selectable style={styles.caption}>Capture : {value.operationId}. Paiement : {value.paymentIntentId ?? 'à qualifier'}. Débit carte : {value.chargeId ?? 'à qualifier'}.</Text>
    <Text style={styles.caption}>{'refundableCents' in value ? 'Montant restant qualifié' : 'Montant de cette demande'} : {amount === null ? 'inconnu' : `${formatCents(amount)} CAD`}.</Text>
    {'refundId' in value && value.refundId ? <Text selectable style={styles.caption}>Remboursement : {value.refundId}.</Text> : null}
    {'nativeRecordPresent' in value && !value.nativeRecordPresent ? <Text style={styles.caption}>Le reçu peut provenir du suivi indépendant conservé après restauration ; aucun enregistrement local ou date manquante n’est inventé.</Text> : null}
    {value.reason ? <Text selectable style={styles.caption}>Qualification : {value.reason}.</Text> : null}
    <Text style={styles.caption}>Moyen de paiement d’origine uniquement. Ce suivi ne crée ni commande, mouvement de portefeuille ou engagement de stock et ne vérifie pas l’arrivée bancaire.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
