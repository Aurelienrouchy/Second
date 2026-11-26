import { StyleSheet, Text, View } from 'react-native';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { SWAP_TOPUP_STATUS_LABELS } from '@/utils/swapTopUpCheckoutPresentation';
import type { SwapTopUpPreview } from '@/types/swapTopUpCheckout';
import { colors, spacing, typography } from '@/constants/theme';

export function SwapTopUpCheckoutResult({preview}: {preview: SwapTopUpPreview}) {
  const payment = preview.payment;
  return <View style={styles.section}>
    <Text style={styles.body}>Complément : {formatPriceWithCurrency(preview.amounts.baseCents / 100)} · frais : {formatPriceWithCurrency(preview.amounts.serviceFeeCents / 100)} · taxes enregistrées : {formatPriceWithCurrency(preview.amounts.taxCents / 100)}.</Text>
    <Text accessibilityRole="header" style={styles.body}>Total carte : {formatPriceWithCurrency(preview.amounts.totalCents / 100)} CAD</Text>
    <Text style={styles.caption}>Source préparatoire : {preview.preparation.qualification === 'native_unstarted' ? 'absence native d’intention engagée' : preview.preparation.qualification === 'native_manual_intention' ? 'intention manuelle native existante' : preview.preparation.qualification === 'native_legacy_exposure' ? 'ancienne capacité de confirmation à examiner' : preview.preparation.qualification === 'native_legacy_neutralized' ? 'ancienne capacité neutralisée nativement' : 'inconnue'}.</Text>
    {payment ? <>
      <Text selectable style={styles.caption}>Paiement exact {payment.paymentIntentId} · version {payment.intentVersion ?? 'ancienne intention'}.</Text>
      <Text style={styles.body}>{SWAP_TOPUP_STATUS_LABELS[payment.providerStatus]} · {payment.confirmationMethod === 'manual' ? 'confirmation manuelle serveur' : payment.confirmationMethod === 'automatic' ? 'ancien protocole automatique' : 'mode de confirmation inconnu'}.</Text>
      <Text style={styles.body}>{payment.settlementReceiptVerified ? 'Le règlement de ce complément est vérifié dans son reçu natif et les écritures attribuées à ce Troc.' : 'Le règlement local de ce complément n’est pas vérifié. Ni le retour de l’authentification ni un encaissement prestataire seul ne suffisent.'}</Text>
      {(payment.action === 'awaitSettlement' || ['processing', 'requires_capture', 'succeeded', 'unknown'].includes(payment.providerStatus)) && !payment.settlementReceiptVerified ? <Text style={styles.caption}>Le résultat de la tentative précédente reste à rapprocher, même si ce statut demande un moyen de paiement ou une confirmation. Aucune nouvelle tentative, carte, confirmation ou authentification de paiement n’est proposée pendant ce rapprochement.</Text> : null}
      <Text style={styles.caption}>{payment.legacyExternalConfirmationPrevented ? 'Une prévention de confirmation externe est qualifiée pour ce paiement précis. Les autres droits et opérations restent distincts.' : 'Aucune prévention de l’ancienne confirmation externe n’est qualifiée par cette observation.'}</Text>
    </> : <Text style={styles.caption}>Aucune observation de paiement qualifiée n’est disponible. Cette absence ne prouve pas qu’un ancien paiement n’existe pas et n’autorise aucune alternative.</Text>}
    <Text style={styles.caption}>Cette lecture couvre uniquement ce Troc. Elle ne vérifie pas tous les anciens paiements d’une paire, ne libère aucun fonds et ne modifie ni livraison ni litige.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
