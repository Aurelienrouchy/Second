import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import { PURCHASE_REFUND_COMPONENTS, type PurchaseRefundSource, type PurchaseRefundTerms } from '@/types/purchaseRefund';
export const PURCHASE_REFUND_COMPONENT_LABELS = {articleCents: 'Article', buyerFeeCents: 'Frais acheteur', shippingCents: 'Livraison initiale', gstCents: 'TPS', qstCents: 'TVQ'};
const money = (v: number | null | undefined) => v === null || v === undefined ? 'Inconnu' : formatPrice(v / 100);
export function PurchaseRefundTermsSummary({source = null, terms = null}: {source?: PurchaseRefundSource | null; terms?: PurchaseRefundTerms | null}) {
  const history = source?.allocationHistory, verified = history?.qualification === 'native_bounded_set' && history.completeSet;
  return <View style={styles.section}>
    <Text style={styles.title}>Montants CAD de cette seule commande</Text>
    <Text style={styles.caption}>Le restant tient compte des réservations, même si leur résultat reste inconnu. Zéro connu et montant inconnu sont distincts.</Text>
    {PURCHASE_REFUND_COMPONENTS.map(k => {const applicable = history?.entries.filter(e => e.terms.refund[k] > 0) ?? [], settled = applicable.filter(e => e.localMovementsVerified && e.settlementState === 'succeeded' && (e.terms.cardCents === 0 || e.providerObservationState === 'succeeded'));
      const known = verified && applicable.length === settled.length, total = settled.reduce((sum, e) => sum + (k === 'articleCents' && e.terms.protocol === 'purchase_refund_terms_v2' ? e.terms.cardCents + e.terms.walletCents : e.terms.refund[k]), 0);
      return <View key={k} style={styles.row}><Text style={styles.body}>{PURCHASE_REFUND_COMPONENT_LABELS[k]}</Text>
      <Text style={styles.caption}>Initial : {money(source?.initial?.[k])} · restant disponible : {money(source?.remaining?.[k])}</Text>
      <Text style={styles.caption}>{k === 'articleCents' ? 'Remboursement net vérifié' : 'Déjà remboursé'} : {known ? money(total) : 'inconnu'}.{!known && verified ? ` Part vérifiée : ${money(total)} ; les autres allocations restent à rapprocher.` : ''}</Text>
      <Text style={styles.body}>{k === 'articleCents' && terms?.protocol === 'purchase_refund_terms_v2' ? 'Prix article affecté avant déduction' : 'Ce choix : rembourser'} {money(terms?.refund[k])} · conserver {money(terms?.retained[k])}.</Text>
    </View>;})}
    {source ? <Text style={styles.caption}>Plafonds restants : carte {money(source.remainingCardCents)} · solde {money(source.remainingWalletCents)} · débit vendeur de cette vente {money(source.remainingSellerCents)}.</Text> : null}
    {source?.convenienceReturnSource?.costResolution ? <Text style={styles.caption}>Frais de retour : plafond accepté {money(source.convenienceReturnSource.costResolution.acceptedCostCents)} · coût réel qualifié {money(source.convenienceReturnSource.costResolution.actualCostCents)} · déduction effective {money(source.convenienceReturnSource.costResolution.deductionCents)} · écart Seconde {money(source.convenienceReturnSource.costResolution.platformVarianceCents)}. Les termes d’origine sont conservés.</Text> : null}
    {terms ? <><Text style={styles.body}>Carte d’origine : {money(terms.cardCents)} · solde acheteur : {money(terms.walletCents)}.</Text>
      {terms.protocol === 'purchase_refund_terms_v2' ? <><Text style={styles.body}>Frais de retour déduits : {money(terms.returnLabelDeduction.amountCents)} · net prévu pour l’acheteur : {money(terms.cardCents + terms.walletCents)}.</Text><Text style={styles.caption}>Le prix article brut est consommé dans l’allocation. La somme destinée à l’acheteur est le net après frais de retour ; aucune arrivée bancaire n’est attestée.</Text></> : null}
      <Text style={styles.body}>Débit vendeur : {money(terms.sellerDebitCents)} · coût article pris en charge par la plateforme : {money(terms.platformArticleCostCents)}.</Text>
      <Text style={styles.caption}>Article : {terms.articleHandling === 'keep_article' ? 'conservé selon ces termes' : 'retour examiné séparément'}. Dossier : {terms.caseHandling === 'settle_selected_case' ? 'régler le seul dossier sélectionné' : 'conserver l’examen ouvert'}.</Text>
      <Text style={styles.caption}>Date de paiement déclarée : {terms.paymentDeadline.qualification === 'unknown' ? 'inconnue' : terms.paymentDeadline.date}. Cette date ne prouve ni un versement ni son arrivée bancaire.</Text>
      <Text style={styles.caption}>Provenance : {terms.provenance.kind === 'external_declared' ? 'accord externe déclaré, authenticité non vérifiée' : 'proposition préparée dans l’application'}. {terms.provenance.evidenceReferences.length} pièce(s) native(s) liée(s) ; une preuve ne vaut pas acceptation.</Text>
      {terms.provenance.statement ? <Text selectable style={styles.body}>{terms.provenance.statement}</Text> : null}</> : null}
    <Text style={styles.caption}>Ces termes ne donnent aucune permission physique, de remise en vente ou d’expédition. Une proposition et ses acceptations ne déclenchent aucun mouvement d’argent.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, row: {gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
