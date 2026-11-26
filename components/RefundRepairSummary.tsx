import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { formatCents } from '@/utils/formatPrice';
import { APP_LOCALE } from '@/constants/locale';
import { PURCHASE_REFUND_COMPONENTS } from '@/types/purchaseRefund';
import { PURCHASE_REFUND_COMPONENT_LABELS } from '@/components/PurchaseRefundTermsSummary';
import type { RefundRepairSource, RefundRepairFinancial, RefundRepairManualSource } from '@/types/refundRepair';
const money = (v: number | null | undefined) => v === null || v === undefined ? 'inconnu' : formatCents(v);
export function RefundRepairSummary({source = null, financial = null, manual = null}: {source?: RefundRepairSource | null; financial?: RefundRepairFinancial | null; manual?: RefundRepairManualSource | null}) {
  return <View style={styles.section}>
    {manual ? <><Text accessibilityRole="header" style={styles.title}>Instruction bancaire manuelle</Text>
      <Text selectable style={styles.caption}>Commande {manual.transactionId} · allocation {manual.refundIntentId} · bénéficiaire natif {manual.beneficiaryId}.</Text>
      <Text style={styles.body}>Montant natif : {money(manual.amountCents)} CAD · restant qualifié : {money(manual.remainingCents)}.</Text>
      <Text style={styles.body}>{manual.state === 'manual_operator_attested' ? 'Un opérateur Seconde a attesté le virement manuel après examen des justificatifs privés.' : manual.state === 'prepared' ? 'Instruction préparée. Aucun virement effectué n’est déduit de cette préparation.' : manual.state === 'voided' ? 'Instruction déclarée jamais exécutée et clôturée.' : manual.state === 'reconciliation_required' ? 'Un rapprochement reste nécessaire ; aucun nouveau versement n’est déduit.' : 'Aucune exécution manuelle qualifiée dans cette lecture.'}</Text>
      <Text style={styles.caption}>Moyen initial définitivement examiné : {manual.originalRailTerminalVerified ? 'oui' : 'non qualifié'} · mouvements locaux : {manual.localMovementsVerified ? 'qualifiés' : 'à rapprocher'}. {manual.bankReviewRequired || manual.riskReviewRequired ? 'Une revue bancaire ou de risque reste ouverte.' : ''}</Text>
      <Text style={styles.caption}>Cette attestation humaine est distincte d’un remboursement sur le moyen de paiement initial et d’une confirmation automatique de l’arrivée bancaire. Aucun crédit de portefeuille, débit vendeur, stock ou envoi n’est autorisé par cette lecture.</Text>
    </> : null}
    {source ? <><Text accessibilityRole="header" style={styles.title}>Obligation de restitution restante</Text>
      <Text selectable style={styles.caption}>Commande {source.transactionId} · intention {source.refundIntentId} · tentative d’origine {source.refundAttemptId}.</Text>
      <Text selectable style={styles.caption}>Remboursement d’origine {source.originalRefundId} · paiement d’origine {source.paymentIntentId}.</Text>
      <Text selectable style={styles.caption}>Allocation {source.historical ? 'historique' : 'courante'} {source.allocation.refundIntentId} · réserve {source.allocation.reservationHash} · termes {source.allocation.termsHash} · base {source.allocation.basisHash}.</Text>
      <Text accessibilityRole="header" style={styles.title}>Termes figés de cette allocation (CAD)</Text>
      {PURCHASE_REFUND_COMPONENTS.map(k => <View key={k} style={styles.row}>
        <Text style={styles.body}>{PURCHASE_REFUND_COMPONENT_LABELS[k]}</Text>
        <Text style={styles.body}>{k === 'articleCents' && source.allocation.terms.protocol === 'purchase_refund_terms_v2' ? 'Prix article affecté avant déduction' : 'Prévu à rembourser'} : {money(source.allocation.terms.refund[k])} · conservé selon ces termes : {money(source.allocation.terms.retained[k])}.</Text>
      </View>)}
      <Text style={styles.body}>Carte d’origine prévue : {money(source.allocation.terms.cardCents)} · solde acheteur prévu : {money(source.allocation.terms.walletCents)}.</Text>
      {source.allocation.terms.protocol === 'purchase_refund_terms_v2' ? <Text style={styles.body}>Frais de retour déduits : {money(source.allocation.terms.returnLabelDeduction.amountCents)} · net prévu pour l’acheteur : {money(source.allocation.terms.cardCents + source.allocation.terms.walletCents)}. Le prix article brut ne représente pas la somme versée à l’acheteur.</Text> : null}
      <Text style={styles.body}>Débit vendeur prévu : {money(source.allocation.terms.sellerDebitCents)} · coût article prévu pour la plateforme : {money(source.allocation.terms.platformArticleCostCents)}.</Text>
      <Text style={styles.caption}>Ces montants sont les termes natifs de cette allocation réservée. Ils ne prouvent aucun règlement et ne constituent pas une nouvelle instruction de remboursement.</Text>
      <Text style={styles.body}>Portion carte initiale de cette allocation : {money(source.obligationCardCents)} · carte réellement restante dans cette lecture : {money(source.remainingCardCents)}.</Text>
      <Text style={styles.caption}>Montants locaux vérifiés : {source.localMovementsVerified ? 'oui' : 'non, à rapprocher'}.</Text>
      <Text style={styles.body}>Crédit acheteur déjà appliqué : {money(source.localWalletCreditCents)} · débit vendeur déjà appliqué : {money(source.localSellerDebitCents)} · dette vendeur déjà enregistrée : {money(source.localSellerDebtCents)}.</Text>
      <Text style={styles.caption}>La réparation concerne uniquement cette obligation carte. Elle ne répète aucun crédit de solde, débit ou dette vendeur, ni réservation de l’allocation.</Text>
      <Text style={styles.caption}>Historique : {source.historyComplete ? 'ensemble natif qualifié dans la limite de lecture' : 'incomplet ou inconnu'}. Banque : {source.bankReviewRequired ? 'examen distinct requis' : 'aucun blocage natif constaté dans cette lecture'} · risque : {source.riskReviewRequired ? 'examen distinct requis' : 'garde native qualifiée dans cette lecture'}.</Text>
      <Text selectable style={styles.caption}>Dernier remboursement de cette obligation : {source.terminalRefundId ?? 'inconnu'} · tentative {source.terminalAttemptId}.</Text>
      {source.provider ? <Text style={styles.caption}>Moyen initial : {source.provider.qualification === 'current_original_method_capacity' ? 'capacité actuellement qualifiée par le serveur' : 'faisabilité inconnue'} · capacité {money(source.provider.capacityCents)} · observation {new Date(source.provider.observedAt).toLocaleString(APP_LOCALE)}.</Text> : <Text style={styles.caption}>Aucune observation prestataire actuelle dans cette lecture ; aucune faisabilité n’est déduite.</Text>}
      {source.repairHistory.map(r => <View key={r.repairId} style={styles.section}><Text selectable style={styles.caption}>Réparation {r.repairId} · tentative n° {r.ordinal} · montant {money(r.amountCents)}.</Text><Text style={styles.caption}>Résultat {r.state} · observation prestataire {r.providerStatus ?? 'inconnue'} · remboursement {r.providerRefundId ?? 'inconnu'}. Une réservation ne prouve aucun règlement.</Text></View>)}
    </> : null}
    {financial ? <><Text selectable style={styles.caption}>Réparation {financial.repairId} · tentative {financial.attemptId} · remboursement {financial.refundId ?? 'inconnu'}.</Text>
      <Text style={styles.body}>{financial.state === 'card_repaired' && financial.providerStatus === 'succeeded' && financial.cardRepairedCents === financial.amountCents ? `La preuve native confirme cette portion carte : ${money(financial.cardRepairedCents)}.` : 'La portion carte reste à suivre ou à rapprocher ; aucun succès n’est déduit de la seule réservation.'}</Text>
      <Text style={styles.caption}>Dernière observation : {financial.observedAt ? new Date(financial.observedAt).toLocaleString(APP_LOCALE) : 'inconnue'}. Aucun mouvement local n’est répété.</Text></> : null}
    <Text style={styles.caption}>L’arrivée bancaire reste non vérifiée. Frais, autres obligations, clôture des dossiers, retour, stock et permission d’expédier restent distincts.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, row: {gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
