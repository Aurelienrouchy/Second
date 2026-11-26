import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import type { TransportRecordedEntry, TransportReview, TransportReviewSourceView } from '@/types/transportReview';
import {LabelDepositDeadlineEvidence} from '@/components/LabelDepositDeadlineEvidence';
const labels = {participant_transit: 'Colis signalé en transit', carrier_exception: 'Exception du transporteur à examiner', delivery_correction: 'Correction de livraison', label_deposit_deadline: 'Échéance après étiquette : enquête documentaire'};
const states = {open: 'Enquête ouverte', closed: 'Enquête documentaire close', resolved: 'Décision enregistrée pour les sources examinées', financial_review_required: 'Examen financier distinct nécessaire'};
const entryLabels = {evidence: 'Élément déclaré', carrier_contact: 'Contact transporteur', participant_contact: 'Contact participant', follow_up: 'Suivi de l’enquête', assessment: 'Évaluation humaine'};
const sourceLabels = {operator_observation: 'observation opérateur', participant_statement: 'déclaration participante', carrier_statement: 'déclaration du transporteur', document_reference: 'référence documentaire'};
const when = (v: string | null) => v ? new Date(v).toLocaleString(APP_LOCALE) : 'inconnue';
const entryKey = (_item: TransportRecordedEntry, index: number) => String(index);
const renderEntry = ({item}: ListRenderItemInfo<TransportRecordedEntry>) => <View style={styles.block}>
  <Text style={styles.body}>{entryLabels[item.kind]} · {sourceLabels[item.source]}</Text>
  <Text selectable style={styles.body}>{item.summary}</Text>
  {item.reference ? <Text selectable style={styles.caption}>Référence déclarée : {item.reference}</Text> : null}
  <Text style={styles.caption}>Date déclarée de la démarche : {when(item.occurredAt)}. Enregistrement dans l’app : {when(item.recordedAt)}.</Text>
  <Text style={styles.caption}>Prochain suivi déclaré : {when(item.nextFollowUpAt)}. Ces éléments ne sont pas certifiés de manière indépendante.</Text>
</View>;
export function TransportReviewEvidence({source, review, showReferences = false}: {source: TransportReviewSourceView; review?: TransportReview | null; showReferences?: boolean}) {
  return <View style={styles.section}>
    {source.labelDepositDeadline ? <><LabelDepositDeadlineEvidence source={source.labelDepositDeadline} showReferences={showReferences} />
      <Text style={styles.caption}>{source.deadlineContextQualification === 'same_deadline_and_label' ? 'Le dossier sélectionné concerne le même délai et la même étiquette. Les autres sources et gardes doivent encore être qualifiées pour toute instruction.' : source.deadlineContextQualification === 'changed_or_unknown' ? 'Le délai ou l’étiquette a changé, ou leur concordance reste inconnue. L’origine historique ne donne aucune permission actuelle.' : 'Aucune revue de délai n’est sélectionnée dans cette lecture.'}</Text></> : null}
    <Text style={styles.body}>Statut transporteur observé : {source.observedStatusCode ?? 'inconnu'}. Lecture : {when(source.observedAt)}. Occurrence fournie : {when(source.occurredAt)}.</Text>
    <Text style={styles.caption}>Expédition enregistrée dans l’app : {when(source.shippedAt)}. Cette date d’enregistrement ne prouve pas une remise physique au transporteur.</Text>
    <Text style={styles.caption}>Estimation fournie : {source.estimatedDelivery ?? 'inconnue'}. Une estimation ou le temps écoulé ne prouve ni perte, ni faute, ni réception.</Text>
    <Text style={styles.caption}>{source.captureQualification === 'native_capture' ? source.currentCapture ? 'Capture native concordante avec la source lue.' : 'Capture native historique ; son actualité n’est pas établie.' : 'Capture de suivi absente ou non qualifiée.'}</Text>
    {source.correction ? <View style={styles.block}>
      <Text style={styles.body}>{source.correctionResolution.state === 'resolved_current' ? 'Résolution de cette correction qualifiée dans la lecture actuelle.' : 'La correction reste à examiner.'}</Text>
      <Text style={styles.caption}>Livraison précédemment enregistrée : {when(source.correction.originalDeliveryAt)}. Correction enregistrée : {when(source.correction.detectedAt)}.</Text>
      <Text style={styles.caption}>Échéance des fonds enregistrée auparavant : {when(source.correction.originalFundsReleaseAt)}. Échéance actuellement enregistrée : {when(source.correction.currentFundsReleaseAt)}.</Text>
      {source.correctionResolution.state === 'resolved_current' ? <Text style={styles.caption}>Échéance effective native des fonds : {when(source.correctionResolution.effectiveFundsReleaseAt)}. Fin de protection effective native : {when(source.correctionResolution.effectiveProtectionEndsAt)}. {source.correctionResolution.protectionQualification === 'native_policy_window' ? 'Fenêtre native qualifiée de la politique acceptée.' : source.correctionResolution.protectionQualification === 'historical_deadline' ? 'Échéance historique conservée ; acceptation de politique non certifiée.' : 'Fonds historiquement enregistrés comme libérés ; aucune nouvelle retenue déduite.'}</Text> : null}
      <Text style={styles.caption}>La résolution propre à cette correction conserve les autres dossiers et obligations. Aucun argent disponible, reçu bancaire ou droit de remise en vente n’est attesté ici.</Text>
    </View> : null}
    {showReferences ? <View style={styles.block}>
      <Text selectable style={styles.caption}>Révision commande : {source.reference.orderRevision} · empreinte : {source.reference.sourceHash}</Text>
      <Text selectable style={styles.caption}>Source financière : {source.reference.financialSourceHash} · dossier : {source.reference.reviewId ?? 'aucun'} · révision : {source.reference.reviewRevision ?? 'inconnue'} · empreinte : {source.reference.reviewHash ?? 'inconnue'}</Text>
      <Text selectable style={styles.caption}>Capture : {source.capture?.captureId ?? 'inconnue'} · version : {source.capture?.readVersion ?? 'inconnue'} · empreinte : {source.capture?.displayHash ?? 'inconnue'} · source : {source.capture?.sourceHash ?? 'inconnue'}</Text>
      <Text style={styles.caption}>Qualification financière de lecture : {source.releaseQualification === 'historical_unknown' ? 'inconnue' : 'enregistrement natif qualifié'}. Autres obligations enregistrées : {source.otherGuards.length ? source.otherGuards.join(', ') : 'aucune dans cette projection limitée'}.</Text>
    </View> : null}
    {review ? <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>{labels[review.kind]}</Text>
      <Text style={styles.body}>{states[review.state]} · enquête {review.inquiryState === 'open' ? 'ouverte' : 'close'}.</Text>
      <Text style={styles.caption}>Création enregistrée : {when(review.createdAt)}. Dernier enregistrement : {when(review.updatedAt)}.</Text>
      {showReferences ? <Text selectable style={styles.caption}>Dossier : {review.reviewId} · version : {review.version}</Text> : null}
      {review.origin.kind === 'participant' ? <><Text selectable style={styles.body}>{review.origin.narrative}</Text><Text style={styles.caption}>Récit déclaré par un participant, non vérifié. Ce dépôt n’établit pas une perte.</Text></> :
        'source' in review.origin ? <><Text style={styles.body}>Cette revue a été ouverte par le système depuis l’échéance acceptée. Aucun acheteur n’est présenté comme auteur d’une plainte.</Text><LabelDepositDeadlineEvidence source={review.origin.deadline} historical showReferences={showReferences} /></> :
        <Text style={styles.caption}>Signal système : {review.origin.statusCode} · occurrence fournie {when(review.origin.occurredAt)}. Ce signal ne certifie ni perte définitive, ni possession du colis.</Text>}
      {review.entries.length ? <View style={styles.list}><FlashList data={review.entries} keyExtractor={entryKey} renderItem={renderEntry} nestedScrollEnabled /></View> : <Text style={styles.caption}>Aucune démarche enregistrée dans ce dossier.</Text>}
      {review.closure ? <View style={styles.block}><Text style={styles.body}>Fin documentaire de l’enquête</Text><Text selectable style={styles.body}>{review.closure.ownerMessage}</Text><Text style={styles.caption}>Enregistrée : {when(review.closure.recordedAt)}. Les recours et dossiers indépendants restent distincts.</Text></View> : null}
      {review.resolution ? <View style={styles.block}><Text style={styles.body}>{review.resolution.finding === 'financial_review_required' ? 'Un examen financier distinct est demandé' : 'Décision sur ce dossier'}</Text>
        <Text selectable style={styles.body}>{review.resolution.ownerMessage}</Text><Text style={styles.caption}>Enregistrée : {when(review.resolution.recordedAt)}. Cette décision historique n’atteste pas la permission actuelle, une réception physique ou un mouvement d’argent.</Text></View> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, block: {gap: spacing.xs, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 9}});
