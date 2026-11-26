import {Alert, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/ui';
import {SellerTaxPrivateCopy} from '@/components/SellerTaxPrivateCopy';
import {colors, radius, spacing, typography} from '@/constants/theme';
import {formatCents} from '@/utils/formatPrice';
import type {SellerTaxCommand, SellerTaxDocument, SellerTaxDocumentReference, SellerTaxCaptureReference, SellerTaxScope} from '@/types/sellerTax';

const labels: Record<SellerTaxCommand['action'], string> = {operator_record: 'Évaluation documentaire de l’exploitant', identity_record: 'Statut d’identité documenté',
  ingest: 'Événement issu d’une source', evidence_event: 'Événement documenté par une pièce externe', scan: 'Page de sources examinée', snapshot: 'Résumé annuel enregistré',
  assistance: 'Demande d’aide fiscale', declaration_prepare: 'Préparation documentaire de déclaration', filing_record: 'Reçu de dépôt externe',
  copy_record: 'Preuve déclarée de remise d’une copie', copy_ack: 'Déclaration personnelle d’accès à une copie', credit_note_record: 'Note de crédit externe enregistrée',
  annual_capture_prepare: 'Point de capture annuel créé', annual_capture_advance: 'Page de capture annuelle examinée'};
export const SELLER_TAX_ACTION_LABELS = labels;
export const SELLER_TAX_ASSISTANCE_LABELS = {missing_identity: 'Identité à documenter', missing_tax_identifier: 'Identifiant fiscal manquant',
  identifier_exception: 'Exception d’identifiant à examiner', missing_copy: 'Copie manquante ou inaccessible', disputed_period: 'Période contestée', incorrect_information: 'Renseignement incorrect'};
const issues: Record<string, string> = {period_policy_unknown: 'La règle de période de l’exploitant n’est pas qualifiée.', event_coverage_saturated: 'La limite de capture annuelle a été atteinte ; le résumé est incomplet.',
  event_period_unknown: 'La période d’un événement est inconnue.', current_source_unavailable: 'Une source actuelle est indisponible.', event_source_unqualified: 'Une source enregistrée ne peut pas être qualifiée.',
  operator_assessment_unknown: 'L’évaluation annuelle de l’exploitant reste inconnue.', seller_identity_incomplete: 'Le dossier d’identité reste incomplet.', annual_amounts_or_period_unknown: 'Des montants ou des périodes restent inconnus.',
  native_source_scan_incomplete: 'Le parcours des sources n’est pas terminé.', refund_history_coverage_requires_reconciliation: 'La couverture des remboursements doit être rapprochée.',
  external_schema_validation_and_filing_required: 'La validation du format officiel et le dépôt externe restent nécessaires.', legacy_refund_identity_unknown: 'L’identité d’un ancien remboursement reste inconnue.'};
const date = (v: string | null) => v === null ? 'Date inconnue' : `${new Date(v).toLocaleString('fr-CA', {timeZone: 'UTC'})} UTC`;
const money = (v: number | null) => v === null ? 'Montant inconnu' : `${formatCents(v)} CA`;

export function SellerTaxDocumentCard({document: d, reference, access, version, disabled, onCommand, onSelectDeclaration, onSelectCapture, uid, scope, qualifySource}: {
  document: SellerTaxDocument; reference: SellerTaxDocumentReference; access: 'owner' | 'admin'; version: number;
  disabled: boolean; onCommand: (command: SellerTaxCommand) => void; onSelectDeclaration?: (reference: SellerTaxDocumentReference) => void;
  onSelectCapture?: (reference: SellerTaxCaptureReference) => void; uid: string; scope: SellerTaxScope; qualifySource: () => void;
}) {
  const summary = d.kind === 'snapshot' || d.kind === 'declaration_prepare' ? d.summary : null;
  const known = summary?.qualification === 'recorded_events_only' || summary?.qualification === 'fixed_native_sources';
  return <View style={styles.card}>
    <Text style={styles.title}>{labels[d.kind]}</Text>
    <Text style={styles.caption}>Enregistré : {date(d.recordedAt)}</Text>
    {access === 'admin' ? <Text selectable style={styles.caption}>Référence native : {reference.id}</Text> : null}
    {summary ? <>
      <Text style={styles.body}>Année {summary.year} · Calendrier : {summary.timeZone === 'unqualified' ? 'non qualifié' : summary.timeZone}.</Text>
      <Text style={styles.body}>Contrepartie annuelle capturée : {known ? money(summary.annualConsiderationCents) : 'inconnue ou incomplète'}.</Text>
      <Text style={styles.body}>Accords capturés : {known && summary.annualActivityCount !== null ? summary.annualActivityCount : 'nombre inconnu'}.</Text>
      {summary.quarters.map(q => <View key={q.quarter} style={styles.section}>
        <Text style={styles.body}>Trimestre {q.quarter} · Contrepartie : {known ? money(q.considerationCents) : 'non qualifiée'}.</Text>
        <Text style={styles.caption}>{known ? `Brut : ${money(q.grossConsiderationCents)} · Ajustements : ${money(q.adjustmentsCents)} · Frais de plateforme : ${money(q.platformFeesCents)} · Taxes de plateforme : ${money(q.platformTaxesCents)} · Accords : ${q.activityCount}.` : 'Les composantes de ce résumé ne permettent pas un total fiscal qualifié.'}</Text>
      </View>)}
      <Text style={styles.caption}>{summary.nativeEventSnapshotVerified ? 'Ce résumé reprend les sources natives connues au point de capture enregistré. L’univers légal des opérations reste non certifié.' : 'Ce résumé porte sur les événements enregistrés, avec une limite de 500 lignes. Il ne prouve ni l’exhaustivité des sources, ni un instantané comptable.'} Il ne constitue pas un revenu imposable. Les retraits et libérations de solde ne sont pas ajoutés à la contrepartie.</Text>
      <Text style={styles.caption}>Indication liée au seuil sur ces événements : {summary.smallGoodsExclusionCandidate === null ? 'inconnue' : summary.smallGoodsExclusionCandidate ? 'candidat à examiner' : 'critère non satisfait sur les données capturées'}. Elle ne détermine pas un statut professionnel ni une exclusion légale.</Text>
      {summary.issues.map(issue => <Text key={issue} style={styles.caption}>{issues[issue] ?? 'Une autre source de l’année doit être vérifiée.'}{access === 'admin' ? ` (${issue})` : ''}</Text>)}
      <Text style={styles.caption}>Sources inspectées : {summary.eventsInspected}. {summary.hasMore ? 'Une suite annuelle reste à traiter ; ce résumé ne couvre pas toute la capture.' : 'Cette lecture ne démontre pas une couverture globale.'}</Text>
      {(d.kind === 'snapshot' || d.kind === 'declaration_prepare') ? <Text style={styles.caption}>Exploitant : {d.operatorQualification === 'unknown' ? 'évaluation inconnue' : 'évaluation documentaire enregistrée, sans certification externe'}. Identité : {d.identityReady ? 'éléments de préparation présents' : 'éléments de préparation incomplets'}. Parcours des sources : {d.sourceScan.closed ? 'terminé lors de la lecture, sans instantané garanti' : 'incomplet'}.</Text> : null}
    </> : null}
    {d.kind === 'annual_capture_prepare' || d.kind === 'annual_capture_advance' ? <>
      <Text style={styles.body}>État enregistré : {d.capture.status === 'complete' ? 'ensemble natif parcouru' : d.capture.status === 'unavailable' ? 'point indisponible' : 'capture en cours'} · Pages : {d.capture.pages} · Sources : {d.capture.sourcesInspected} · Inconnues : {d.capture.unknownSources}.</Text>
      <Text style={styles.caption}>Ce document historique ne remplace pas une lecture actuelle du point. L’univers légal et les faits externes ne sont pas certifiés.</Text>
      {onSelectCapture ? <Button variant="secondary" disabled={disabled} onPress={() => {try {qualifySource(); onSelectCapture(d.capture.reference);} catch {/* Current native page only. */}}}>Sélectionner et relire cette capture native</Button> : null}
    </> : null}
    {d.kind === 'operator_record' ? <>
      <Text style={styles.body}>{d.operator.legalName} · {d.operator.status === 'unknown' ? 'Évaluation inconnue' : d.operator.status === 'documented_reporting_operator' ? 'Obligation de déclaration documentée' : 'Exclusion documentée'}.</Text>
      <Text style={styles.caption}>Éléments d’identité de l’exploitant : {d.operator.identityAvailable ? 'documentés' : 'incomplets'}. TPS/TVQ : {d.operator.gstRegistrationDocumented ? 'TPS documentée' : 'TPS non documentée'} ; {d.operator.qstRegistrationDocumented ? 'TVQ documentée' : 'TVQ non documentée'}. Aucune inscription ni évaluation légale n’est certifiée par cette importation.</Text>
    </> : null}
    {d.kind === 'identity_record' ? <Text style={styles.body}>Identité : {d.identity.identityDocumented ? 'documentée, sans vérification externe certifiée' : 'incomplète'}. Identifiant : {d.identity.identifierStatus === 'missing' ? 'manquant' : d.identity.identifierStatus === 'exception_documented' ? 'exception documentée à examiner' : 'documentation externe présente'}. Aucune valeur d’identifiant fiscal n’est affichée ni demandée dans cette application.</Text> : null}
    {d.kind === 'ingest' || d.kind === 'evidence_event' ? <>
      <Text style={styles.body}>{d.event.eventKind === 'original_period_adjustment' ? 'Ajustement de la période d’origine' : 'Contrepartie payée ou créditée'} · {d.qualification === 'unknown' ? 'source ou montant inconnu' : 'faits enregistrés, sans certification fiscale'}.</Text>
      <Text style={styles.body}>Date de rattachement : {date(d.event.effectiveAt)}. Date d’ajustement : {date(d.event.adjustmentRecordedAt)}.</Text>
      <Text style={styles.body}>Contrepartie : {d.qualification === 'unknown' ? 'inconnue' : money(d.event.considerationDeltaCents)} · Brut : {d.qualification === 'unknown' ? 'inconnu' : money(d.event.grossConsiderationCents)}.</Text>
      <Text style={styles.caption}>Source : {d.source.kind === 'swap' ? 'troc' : d.source.kind === 'purchase_refund' ? 'remboursement' : 'commande'} · {d.source.id}. Un crédit au solde, une compensation de dette et une réception bancaire restent des faits distincts.</Text>
      {access === 'admin' ? <Text style={styles.caption}>Qualification : {d.qualification} · Motif : {d.reason}.</Text> : null}
    </> : null}
    {d.kind === 'scan' ? <Text style={styles.body}>Pages examinées : {d.scan.pages}. {d.scan.closed ? 'Parcours terminé lors de cette lecture.' : 'D’autres pages de sources restent à examiner.'} Les sources vivantes ne constituent pas un instantané global. {d.scan.issues.length ? 'Des sources doivent être rapprochées.' : ''}</Text> : null}
    {d.kind === 'assistance' ? <Text style={styles.body}>{SELLER_TAX_ASSISTANCE_LABELS[d.reasonCode]}. Demande enregistrée ; elle ne fournit aucun identifiant et ne restreint pas le compte.</Text> : null}
    {d.kind === 'declaration_prepare' ? <>
      <Text style={styles.body}>Nature : {d.declarationKind === 'original' ? 'originale' : d.declarationKind === 'corrective' ? 'corrective' : 'annulation'}. Préparation destinée à une validation externe. Aucune déclaration officielle n’a été produite ou déposée par cette action.</Text>
      {d.requirementsUnknown.map(issue => <Text key={issue} style={styles.caption}>{issues[issue] ?? 'Une condition de préparation reste à vérifier.'}</Text>)}
      {access === 'admin' && onSelectDeclaration ? <Button variant="secondary" disabled={disabled} onPress={() => onSelectDeclaration(reference)}>Utiliser cette déclaration native</Button> : null}
    </> : null}
    {d.kind === 'filing_record' ? <>
      <Text style={styles.body}>Reçu externe déclaré : {d.reportedExternalStatus === 'accepted' ? 'accepté' : d.reportedExternalStatus === 'rejected' ? 'rejeté' : 'reçu'} par l’ARC · Date déclarée : {date(d.reportedReceivedAt)}.</Text>
      <Text style={styles.caption}>Ce statut provient d’un reçu importé. L’acceptation par l’autorité, le contenu soumis et sa conformité au format officiel ne sont pas certifiés par l’application.</Text>
    </> : null}
    {d.kind === 'copy_record' ? <>
      <Text style={styles.body}>Remise externe déclarée le {date(d.reportedDeliveredAt)} · {d.channel === 'postal_receipt' ? 'preuve postale' : d.channel === 'in_person_receipt' ? 'remise en personne' : 'coffre externe'}.</Text>
      <Text style={styles.caption}>Cette preuve de remise ne confirme pas le contenu de la copie ni votre accès effectif. Une copie individuelle reste distincte du fichier de déclaration de la plateforme. Aucun document à télécharger n’est disponible par cette seule preuve.</Text>
      {d.copyAccess ? <Text style={styles.caption}>Une pièce individuelle a été enregistrée sur la base d’une attestation indépendante. Sa disponibilité courante doit être relue ; son authenticité légale n’est pas certifiée ici.</Text> : null}
      {access === 'owner' ? <SellerTaxPrivateCopy uid={uid} scope={scope} delivery={reference} qualifySource={qualifySource}/> : null}
      {access === 'owner' ? <Button variant="secondary" disabled={disabled} onPress={() => Alert.alert('Déclarer un accès externe à cette copie ?', 'Confirmez seulement si vous avez personnellement eu accès à la copie par le canal externe. Cette déclaration ne télécharge aucun fichier et ne certifie pas son contenu.', [
        {text: 'Annuler', style: 'cancel'}, {text: 'J’ai eu accès à cette copie', onPress: () => onCommand({action: 'copy_ack', expectedVersion: version, declaration: d.declaration, delivery: reference})},
      ])}>Déclarer que j’ai eu accès à cette copie à l’extérieur de l’application</Button> : null}
    </> : null}
    {d.kind === 'copy_ack' ? <Text style={styles.body}>Accès externe déclaré personnellement le {date(d.acknowledgedAt)}. Cet enregistrement ne prouve ni un téléchargement depuis l’application ni la conformité de la copie.</Text> : null}
    {d.kind === 'credit_note_record' ? <>
      <Text style={styles.body}>Note de crédit externe du {date(d.issuedAt)}. Frais acheteur : {money(d.buyerFeeCents)} ; TPS : {money(d.gstCents)} ; TVQ : {money(d.qstCents)}. L’authenticité de la facture d’origine et l’inscription fiscale restent non certifiées.</Text>
      {access === 'owner' ? <SellerTaxPrivateCopy uid={uid} scope={scope} delivery={reference} qualifySource={qualifySource} kind="credit_note"/> : null}
    </> : null}
    {d.evidence ? <Text style={styles.caption}>Une référence de pièce externe est enregistrée ; son importation ne certifie pas l’authenticité des faits.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({card: {gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  section: {gap: spacing.xs}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
