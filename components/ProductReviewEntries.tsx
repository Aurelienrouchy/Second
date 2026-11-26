import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button } from '@/components/ui';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import type { ProductReviewCommunicationView, ProductReviewCommunicationEntry, ProductReviewCommunicationEntryV2, ProductReviewContributionEntry } from '@/types/productReview';
import { ProductMaterialComparison } from './ProductMaterialComparison';
import type { ProductMaterialSources } from '@/types/productMaterialReview';
import { ProductRoutingStatementSummary } from '@/components/ProductRoutingStatementSummary';
import {ProductMixedOrderStatementSummary} from '@/components/ProductMixedOrderStatementSummary';
import { ProductParcelComparison } from './ProductParcelComparison';
import type { ProductParcelSources } from '@/types/productParcelReview';
import { ProductParcelAssessmentSummary } from './ProductParcelAssessmentSummary';
export const PRODUCT_REVIEW_TOPIC_LABELS = {authenticity: 'Authenticité à examiner', recall: 'Rappel déclaré', child_safety: 'Sécurité des enfants', hygiene: 'Hygiène', animal_material: 'Matière animale et provenance', nonconformity: 'Différences matérielles à examiner', parcel_delivery: 'Constat colis et remise à examiner'};
export const PRODUCT_REVIEW_ROLE_LABELS = {buyer: 'Acheteur', seller: 'Vendeur', reporter: 'Auteur du signalement', operator: 'Équipe'};
export const PRODUCT_REVIEW_KIND_LABELS = {ask_details: 'Demande de précisions', communicate_summary: 'Synthèse explicitement communiquée', issue_outcome: 'Issue documentaire motivée', respond: 'Réponse déclarée', contest: 'Nouvel examen demandé'};
export const PRODUCT_REVIEW_OUTCOME_LABELS = {information_incomplete: 'Informations incomplètes', review_documented: 'Examen documentaire enregistré', additional_action_required: 'Démarche supplémentaire nécessaire'};
export const PRODUCT_REVIEW_FACT_LABELS = {brand: 'Marque', model: 'Modèle', productReference: 'Référence du produit', lot: 'Numéro de lot', category: 'Catégorie', intendedUse: 'Usage prévu', recallReference: 'Référence du rappel', officialSourceDeclared: 'Source officielle déclarée',
  childSafetyObservation: 'Observation concernant les enfants', hygieneObservation: 'Observation d’hygiène', conditionObserved: 'État observé', sealOrUseObservation: 'Scellé ou usage observé', species: 'Espèce déclarée', provenance: 'Provenance déclarée', expertiseSummary: 'Expertise déclarée'};
const date = (v: string) => new Date(v).toLocaleString(APP_LOCALE);
type Row = {id: string; type: 'contribution'; entry: ProductReviewContributionEntry} | {id: string; type: 'communication'; entry: ProductReviewCommunicationEntry | ProductReviewCommunicationEntryV2};
const key = (row: Row) => `${row.type}:${row.id}`;
export function ProductReviewEntries({contributions, communications, admin, onChoose, onAttach, materialSources = null, parcelSources = null}: {contributions: ProductReviewContributionEntry[];
  communications: (ProductReviewCommunicationEntry | ProductReviewCommunicationEntryV2)[]; admin: boolean; onChoose: (item: ProductReviewCommunicationView) => void;
  onAttach: (contributionId: string) => void; materialSources?: ProductMaterialSources | null; parcelSources?: ProductParcelSources | null}) {
  const rows: Row[] = [...contributions.map(entry => ({id: entry.qualification === 'unknown' ? entry.contributionId : entry.contribution.contributionId, type: 'contribution' as const, entry})),
    ...communications.map(entry => ({id: entry.qualification === 'unknown' ? entry.eventId : entry.communication.eventId, type: 'communication' as const, entry}))];
  const render = useCallback(({item}: ListRenderItemInfo<Row>) => {
    if (item.entry.qualification === 'unknown') return <Text accessibilityRole="alert" style={styles.caption}>Une entrée native de cette page ne peut pas être qualifiée. Elle reste signalée dans l’historique parcouru.</Text>;
    if (item.type === 'contribution') {
      const c = item.entry.contribution;
      return <View style={styles.section}><Text style={styles.body}>{PRODUCT_REVIEW_TOPIC_LABELS[c.topic]} — déclaration {PRODUCT_REVIEW_ROLE_LABELS[c.actorRole].toLowerCase()}.</Text>
        <Text selectable style={styles.body}>{c.statement}</Text>
        {c.protocol === 'product_review_material_contribution_v1' && c.materialStatement ? <ProductMaterialComparison sources={materialSources} statement={c.materialStatement} statementState="recorded" recordedAt={c.recordedAt} /> : null}
        {c.protocol === 'product_review_parcel_contribution_v1' && c.parcelStatement ? <ProductParcelComparison sources={parcelSources} statement={c.parcelStatement} recordedAt={c.recordedAt} /> : null}
        {c.routingStatement ? <ProductRoutingStatementSummary statement={c.routingStatement} /> : null}
        {c.mixedOrderStatement?<ProductMixedOrderStatementSummary statement={c.mixedOrderStatement}/>:null}
        <Text style={styles.caption}>Déclaration enregistrée le {date(c.recordedAt)}. Observation selon son auteur : {c.observedAt ? date(c.observedAt) : 'date inconnue'}.</Text>
        {Object.entries(c.facts).map(([field, value]) => <Text key={field} selectable style={styles.caption}>{PRODUCT_REVIEW_FACT_LABELS[field as keyof typeof PRODUCT_REVIEW_FACT_LABELS]} : {value ?? 'inconnu, aucune information déclarée'}.</Text>)}
        <Text style={styles.caption}>La source officielle indiquée n’a pas été consultée par ce dépôt ; l’expertise n’a pas été vérifiée. Les photos et documents joints sont conservés séparément du dépôt textuel initial.</Text>
        {!admin ? <Button variant="secondary" onPress={() => onAttach(c.contributionId)}>Joindre une image privée à cette contribution exacte</Button> : null}
      </View>;
    }
    const c = item.entry.communication;
    return <View style={styles.section}><Text style={styles.body}>{PRODUCT_REVIEW_KIND_LABELS[c.kind]} — {PRODUCT_REVIEW_ROLE_LABELS[c.actorRole]}.</Text>
      <Text selectable style={styles.body}>{c.text}</Text>
      {c.result ? <Text style={styles.body}>{PRODUCT_REVIEW_OUTCOME_LABELS[c.result]}. Cette issue est documentaire.</Text> : null}
      <Text style={styles.caption}>Enregistré le {date(c.recordedAt)}, version du dossier à l’enregistrement : {c.caseVersion}. Son application au dossier actuel n’est pas certifiée par cette lecture historique.</Text>
      {admin && c.privateNote ? <><Text style={styles.body}>Motivation privée de l’équipe</Text><Text selectable style={styles.body}>{c.privateNote}</Text></> : null}
      {admin && c.protocol === 'product_review_parcel_communication_v1' && c.parcelAssessment ? <ProductParcelAssessmentSummary assessment={c.parcelAssessment} /> : null}
      {c.protocol === 'product_review_parcel_communication_v1' && c.commercialReturnInstruction ? <Text selectable style={styles.caption}>Instruction commerciale contestée : {c.commercialReturnInstruction.instructionId} · version {c.commercialReturnInstruction.caseVersion}{admin ? ` · empreinte ${c.commercialReturnInstruction.contentHash}` : ''}. Le motif ci-dessus demande un nouvel examen ; l’instruction d’origine reste conservée.</Text> : null}
      {c.protocol !== 'product_review_communication_v1' ? <Text style={styles.caption}>{c.documentaryEvidenceBoundAtCommit ?
        `L’échange est lié à un corpus documentaire natif ; ${c.evidenceReferences.length} référence(s) de pièce accessible(s) dans votre portée.` :
        'Ce dialogue historique ne lie pas un corpus de pièces. Son absence de références ne certifie pas une absence de document.'}</Text> : null}
      {!admin && ['ask_details', 'issue_outcome'].includes(c.kind) ? <Button variant="secondary" onPress={() => onChoose(c)}>
        {c.kind === 'ask_details' ? 'Répondre à cette demande exacte' : 'Demander un nouvel examen de cette issue exacte'}</Button> : null}
      <Text style={styles.caption}>Cet échange ne certifie pas l’authenticité, la sécurité ou la licéité du produit et n’autorise pas de remboursement ou d’expédition.</Text>
    </View>;
  }, [admin, onChoose, onAttach, materialSources, parcelSources]);
  return rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={key} renderItem={render} nestedScrollEnabled /></View> :
    <Text style={styles.caption}>Aucune contribution ou communication sur les pages actuellement parcourues.</Text>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 12}});
