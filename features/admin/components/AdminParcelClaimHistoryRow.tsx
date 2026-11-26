import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { formatPrice } from '@/utils/formatPrice';
import type { ParcelClaimHistoryEntry } from '@/types/parcelClaimHistory';
const date = (v: string | null) => v ? new Date(v).toLocaleString(APP_LOCALE, { timeZone: 'America/Toronto' }) : 'date inconnue';
const receiptLabels = { received: 'réception déclarée', not_received: 'non-réception déclarée', unknown: 'réception inconnue' };
const reasonLabels = { loss_document: 'document de perte déclaré', parcel_damage: 'colis endommagé déclaré', return_parcel_integrity: 'intégrité du retour contestée', delivery_not_received: 'livraison annoncée mais non reçue déclarée', delivery_location: 'lieu de livraison contesté', third_party_delivery: 'remise à un tiers déclarée', deposit_disappearance: 'disparition après dépôt déclarée',mixed_order_observation:'mélange observé ou inconnu déclaré, sans perte ni dommage déduit' };
export function AdminParcelClaimHistoryRow({ entry }: {
    entry: ParcelClaimHistoryEntry;
}) {
    return <View style={styles.row}>
    <Text selectable style={styles.title}>Dossier {entry.disputeId}</Text>
    <Text style={styles.caption}>{entry.reason === 'not_received_despite_delivered' ? 'Non-réception malgré livraison déclarée.' : 'Motif non qualifié ; cette ligne n’est pas établie comme une plainte de non-réception.'}</Text>
    <Text selectable style={styles.caption}>Commande associée : {entry.transactionId ?? 'association inconnue'} · {date(entry.recordedAt)}. {entry.recordedAtQualification === 'native_timestamp' ? 'Date native enregistrée.' : 'Date historique non qualifiée.'}</Text>
    <Text style={styles.body}>{entry.claimOwnershipQualification === 'native_buyer_report' ? 'Le dépôt acheteur possède une origine native qualifiée.' : 'L’origine et l’auteur du dépôt ne sont pas qualifiés ; le champ acheteur ne prouve pas qui l’a déposé.'}</Text>
    {entry.origin ? <>
      <Text style={styles.caption}>Origine : {entry.origin.kind === 'product_contribution' ? 'constat produit rattaché à son reçu de dépôt' : 'intention de signalement rattachée à son reçu'} · dépôt {date(entry.origin.reportedAt)}.</Text>
      <Text selectable style={styles.caption}>Intention {entry.origin.requestId}{entry.origin.contributionId ? ` · constat ${entry.origin.contributionId}` : ''}.</Text>
      <Text style={styles.body}>{entry.origin.sameOriginAsSelected === true ? 'Même origine native que le dossier sélectionné. Les reprises de cette origine ne constituent pas des plaintes distinctes.' : entry.origin.sameOriginAsSelected === false ? 'Origine native différente de celle du dossier sélectionné. Cette différence ne prouve aucune fraude.' : 'La comparaison avec l’origine sélectionnée est inconnue.'}</Text>
    </> : <Text style={styles.caption}>Origine et éventuelles reprises inconnues. Aucun nombre de plaintes distinctes ne peut être déduit de cette ligne.</Text>}
    {entry.declaration ? <><Text style={styles.body}>Déclaration de l’acheteur : {receiptLabels[entry.declaration.receiptDeclared]} · {reasonLabels[entry.declaration.reasonDeclared]}.</Text>
      <Text style={styles.caption}>Observation déclarée : {date(entry.declaration.observedAtDeclared)} · enregistrement : {date(entry.declaration.recordedAt)}. Ce constat ne prouve pas la réception physique.</Text></> : <Text style={styles.caption}>Déclaration colis native non qualifiée ou non disponible.</Text>}
    <Text style={styles.body}>{entry.carrierObservation.qualification === 'native_current_observation' ? `Observation native courante du transporteur : ${entry.carrierObservation.statusCode}, étiquette ${entry.carrierObservation.labelId}. ${entry.carrierObservation.providerEventAtMs === null ? 'Date d’occurrence inconnue.' : `Occurrence fournie : ${date(new Date(entry.carrierObservation.providerEventAtMs).toISOString())}.`}` : 'Observation du transporteur inconnue ou non qualifiée.'}</Text>
    <Text style={styles.caption}>Le constat transporteur ne certifie pas la réception par le destinataire.</Text>
    {entry.productReview?.qualification === 'native_historical_issue' && entry.productReview.issue ? <>
      <Text style={styles.body}>Issue documentaire historique du dossier produit : {entry.productReview.issue.result === 'review_documented' ? 'examen documenté' : entry.productReview.issue.result === 'information_incomplete' ? 'informations incomplètes' : 'autre intervention nécessaire'} · {date(entry.productReview.issue.recordedAt)}.</Text>
      {entry.productReview.issue.motivation ? <Text selectable style={styles.body}>{entry.productReview.issue.motivation}</Text> : null}
      <Text style={styles.caption}>{entry.productReview.issue.claimOriginIncluded === true ? 'Le constat à l’origine de cette ligne faisait partie des références examinées.' : entry.productReview.issue.claimOriginIncluded === false ? 'Le constat à l’origine de cette ligne ne figurait pas dans ces références.' : 'Lien entre cette origine et les références examinées inconnu.'} Cette issue porte sur le dossier produit de la commande ; elle ne qualifie pas le corpus actuel ni un droit financier.</Text>
      {entry.productReview.issue.parcelAssessment ? <Text style={styles.body}>Appréciation colis historique : {entry.productReview.issue.parcelAssessment.motivation} Limites : {entry.productReview.issue.parcelAssessment.evidenceLimitations}</Text> : null}
    </> : <Text style={styles.caption}>Issue documentaire historique inconnue ou non qualifiée.</Text>}
    <Text style={styles.title}>Décisions et effets enregistrés pour ce dossier</Text>
    {entry.decisions.entries.map(decision => <View key={decision.decisionId} style={styles.section}><Text selectable style={styles.caption}>Décision {decision.decisionId}</Text>
      {decision.qualification === 'unknown' ? <Text style={styles.caption}>Décision historique non qualifiée. Aucun effet n’en est déduit.</Text> : <>
        <Text style={styles.body}>{decision.kind === 'refund' ? 'Instruction financière' : 'Classement commercial'} · état natif conservé : {decision.outcome} · {date(decision.recordedAt)}.</Text>
        {decision.motivation ? <Text selectable style={styles.body}>{decision.motivation}</Text> : null}
        {decision.productReference ? <Text selectable style={styles.caption}>Référence documentaire historique : {decision.productReference.issueId}. Elle ne fournit aucune autorisation actuelle.</Text> : null}
        {decision.financialEffect?.qualification === 'native_refund_effect' ? <Text style={styles.body}>Effet natif de remboursement qualifié : total {formatPrice(decision.financialEffect.totalCents! / 100)}, carte {formatPrice(decision.financialEffect.cardCents! / 100)}, portefeuille {formatPrice(decision.financialEffect.walletCents! / 100)}, débit vendeur {formatPrice(decision.financialEffect.sellerDebitCents! / 100)}. Aucune arrivée bancaire vérifiée.</Text> : <Text style={styles.caption}>{decision.kind === 'refund' ? 'L’effet financier reste inconnu ; la décision seule ne prouve pas le règlement.' : 'Ce classement commercial ne démontre aucun mouvement financier.'}</Text>}
      </>}
    </View>)}
    {!entry.decisions.entries.length ? <Text style={styles.caption}>Aucune décision qualifiée visible dans cet échantillon. Cela ne prouve pas l’absence d’anciennes décisions.</Text> : null}
    <Text style={styles.caption}>Décisions inspectées dans cette lecture : {entry.decisions.coverage.inspected}, limite {entry.decisions.coverage.limit}. {entry.decisions.coverage.hasMore ? 'D’autres décisions restent hors de cette projection.' : ''} Les anciens documents sans référence cible restent inconnus ; l’historique des décisions n’est pas exhaustif.</Text>
    <Text style={styles.caption}>{entry.bank.nativeMarkerPresent ? 'Un marqueur bancaire ou de litige est présent ; son issue et son règlement restent inconnus.' : 'Aucun marqueur bancaire qualifiant une issue n’est fourni ici.'} Une décision commerciale ne vaut pas issue bancaire.</Text>
  </View>;
}
const styles = StyleSheet.create({ row: { gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, section: { gap: spacing.sm }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted } });
