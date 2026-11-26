import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import { formatCents } from '@/utils/formatPrice';
import type { FraudReviewClock, FraudReviewDetail, FraudReviewObservation } from '@/types/fraudReview';

const date = (value: FraudReviewClock) => value.at ? new Date(value.at).toLocaleString(APP_LOCALE) : 'inconnue';
const statusLabels: Record<string, string> = {IT: 'en transit', DE: 'livraison signalée', AT: 'tentative de livraison signalée', SP: 'mise à disposition signalée'};
const keyExtractor = (item: FraudReviewObservation) => item.observationId;
const renderItem = ({item}: ListRenderItemInfo<FraudReviewObservation>) => <View style={styles.observation}>
  <Text style={styles.body}>{item.qualification === 'native_observation' ? 'Observation enregistrée dans l’app' : 'Observation dont la qualification reste inconnue'}.</Text>
  <Text style={styles.caption}>Enregistrement : {date(item.recordedAt)}. Création de l’objet du prestataire : {date(item.signalCreatedAt)}.</Text>
  <Text style={styles.caption}>La date d’occurrence d’une fraude et celle d’un paiement effectif restent inconnues. La création d’un objet de contrôle ne prouve pas ces occurrences.</Text>
  {item.attribution === 'native_order_qualified_at_observation' ? <>
    <Text style={styles.body}>{item.payment.captureState === 'authorized' ? 'Autorisation du paiement observée' : 'Capture du paiement observée'} : {formatCents(item.payment.amountCents!)} CAD.</Text>
    <Text style={styles.caption}>Cette attribution concernait la commande au moment de l’observation. Elle ne prouve ni culpabilité, réception de l’article ni crédit bancaire reçu.</Text>
  </> : <Text style={styles.caption}>L’attribution et le paiement restent à rapprocher ; aucun montant qualifié n’est présenté depuis cette observation.</Text>}
</View>;

/** Presentation only: no session lookup, mutation, permission or inferred timeline. */
export function FraudReviewEvidence({detail, observations, showSource = false}: {detail: FraudReviewDetail; observations: FraudReviewObservation[]; showSource?: boolean}) {
  const transport = detail.currentTransport;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Signal de contrôle sur le paiement à examiner</Text>
    <Text style={styles.caption}>Un soupçon ou une revue du prestataire ne constitue pas une fraude prouvée ni une décision sur une personne.</Text>
    {detail.humanReview.qualification === 'native_human_receipt' ? <>
      <Text style={styles.body}>{detail.humanReview.action === 'close_review_for_sources' ? 'Une fermeture de revue est enregistrée pour les sources examinées' : 'Un maintien de revue est enregistré'} le {date(detail.humanReview.decidedAt)}.</Text>
      <Text style={styles.caption}>{detail.humanReview.appliesToLatestObservation ? 'Ce reçu concerne la dernière observation qualifiée du dossier.' : 'Ce reçu est historique et ne s’applique pas à la dernière observation qualifiée.'} Il ne confirme aucune autorisation actuelle d’expédier, aucun remboursement, crédit bancaire ou libération d’un autre dossier.</Text>
    </> : <Text style={styles.caption}>{detail.humanReview.qualification === 'unknown' ? 'La décision humaine ne peut pas être qualifiée dans cette lecture.' : 'Aucun reçu humain qualifié n’est fourni dans cette lecture.'}</Text>}
    <Text style={styles.caption}>Première lecture de ces sources : {new Date(detail.readAt).toLocaleString(APP_LOCALE)}. Les observations sont conservées dans l’ordre de lecture ; leur chronologie et la couverture exhaustive des risques ne sont pas certifiées.</Text>
    <Text style={styles.caption}>{detail.guard.reviewMarkerPresent ? 'Une demande d’examen est enregistrée pour cette commande.' : 'Aucun marqueur de restriction qualifié n’est attesté par cette lecture.'} Cette lecture ne vérifie pas l’application effective de toutes les restrictions.</Text>
    {transport?.qualification === 'native_capture' ? <>
      <Text style={styles.body}>{transport.currentSource ? 'Capture de suivi liée à la source actuelle' : 'Capture de suivi conservée dans l’historique'}.</Text>
      <Text style={styles.caption}>Lecture du transporteur : {date(transport.providerReadAt)}. Événement fourni : {date(transport.providerEventAt)}. Enregistrement : {date(transport.recordedAt)}.</Text>
      <Text style={styles.caption}>État fourni par le transporteur : {transport.providerStatusCode ? statusLabels[transport.providerStatusCode] ?? 'à examiner' : 'inconnu'}. Ce suivi ne prouve ni une heure de dépôt physique, une absence de dépôt, ni une réception effective par le destinataire.</Text>
      {showSource ? <Text selectable style={styles.caption}>Capture : {transport.capture!.captureId} · lecture : {transport.capture!.readVersion} · {transport.capture!.displayHash}</Text> : null}
    </> : <Text style={styles.caption}>La capture de transport, le dépôt physique et l’absence de dépôt restent inconnus dans cette lecture.</Text>}
    {showSource ? <>
      <Text selectable style={styles.caption}>Cas : {detail.caseId} · révision : {detail.source.caseRevision ?? 'inconnue'} · {detail.source.caseSourceHash}</Text>
      <Text selectable style={styles.caption}>Source commande : {detail.source.orderRevision ?? 'absente'} · {detail.source.orderSourceHash ?? 'inconnue'}</Text>
    </> : null}
    {observations.length ? <View style={styles.list}><FlashList data={observations} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled /></View> :
      <Text style={styles.caption}>Aucune observation autorisée sur les pages parcourues. Cela ne certifie pas l’absence de risque ; poursuivez la lecture si des pages restent disponibles.</Text>}
    <Text style={styles.caption}>L’examen humain, les fonds déjà traités, la possession de l’article et les autres recours restent distincts. Cette lecture n’autorise ni remboursement, interception, sanction, libération de fonds ou remise en vente.</Text>
    <Text style={styles.caption}>Fermeture applicable aux sources du dossier : {date(detail.resolution.resolvedAt)}. Échéance juridique qualifiée : {date(detail.resolution.legalDeadline)}.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, observation: {gap: spacing.sm, paddingVertical: spacing.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 9}});
