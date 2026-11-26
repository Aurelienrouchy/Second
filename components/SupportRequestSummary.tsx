import {useSupportProjectionGeneration} from '@/hooks/useSupportProjectionGeneration';
import {isSupportProjectionCurrent} from '@/services/supportProjectionGuard';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import type { MeetupDeclarationEvidence, SupportRequest } from '@/types/supportRequest';
import { supportRequestLabel, SUPPORT_STATUS_LABELS } from '@/utils/supportPresentation';
import { purchaseAutomaticRefundExplanation } from '@/services/automatedDecisionService';
const meetupPhaseLabels: Record<MeetupDeclarationEvidence['phase'], string> = {
  pending: 'Rendez-vous en attente', confirmed: 'Rendez-vous confirmé', completion_declared: 'Remise déclarée',
  cancelled: 'Rencontre annulée', expired: 'Rencontre expirée', disputed: 'Dossier de rencontre ouvert', historical_unknown: 'Phase historique à vérifier',
};

export function SupportRequestSummary({ request }: { request: SupportRequest }) {
  useSupportProjectionGeneration();if(!isSupportProjectionCurrent(request))return <Text style={styles.caption}>La projection privée doit être relue après sa protection.</Text>;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>{supportRequestLabel(request)}</Text>
    <Text selectable style={styles.body}>Référence : {request.id} · Version {request.version}</Text>
    <Text style={styles.body}>{SUPPORT_STATUS_LABELS[request.status]}</Text>
    <Text style={styles.body}>Réception initiale enregistrée dans l’application : {new Date(request.receivedAt).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'})} (heure du Québec).</Text>
    {request.clockOriginSupportRequestId !== request.id ? <>
      <Text selectable style={styles.caption}>Origine de l’horloge conservée : {request.clockOriginSupportRequestId}.</Text>
      <Text style={styles.caption}>Dépôt de ce dossier lié : {new Date(request.recordedAt).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'})} (heure du Québec). Ce dépôt ne recommence pas l’horloge initiale.</Text>
    </> : null}
    {request.confidentiality?.state==='fields_confined'?<Text style={styles.caption}>Certains champs sont confinés selon la source native actuelle. Les textes affichés sont des projections ; les originaux déjà reçus restent conservés. La lecture originale n’est pas autorisée et les copies externes ne sont pas déclarées effacées.</Text>:request.confidentiality?.state==='unknown'?<Text style={styles.caption}>L’état de confinement reste inconnu. Le contenu ci-dessous est la projection fournie par le serveur ; aucune absence de renseignement sensible n’est certifiée.</Text>:null}<Text selectable style={styles.body}>{request.narrative}</Text>
    {request.relatedAccountIds?.length ? <View style={styles.section}>
      <Text style={styles.body}>Références de comptes déclarées dans cette demande :</Text>
      {request.relatedAccountIds.map(reference => <Text selectable key={reference} style={styles.caption}>{reference}</Text>)}
      <Text style={styles.caption}>Ces références ne confirment ni l’existence des comptes ni un lien entre eux. Ce dossier ne donne accès à aucun autre compte ou paiement.</Text>
      {request.representation ? <>
        <Text style={styles.body}>Motif déclaré : {request.representation.reason === 'death' ? 'décès' : 'incapacité'}.</Text>
        <Text selectable style={styles.body}>Lien déclaré : {request.representation.relationship}</Text>
        <Text selectable style={styles.body}>Qualité ou pouvoir déclaré : {request.representation.authorityStatement}</Text>
        <Text style={styles.caption}>Le décès, l’incapacité et le pouvoir de représentation ne sont pas vérifiés par ce dépôt.</Text>
      </> : null}
    </View> : null}
    {request.transactionId ? <Text selectable style={styles.body}>Commande liée : {request.transactionId}</Text> : null}
    {request.swapId ? <Text selectable style={styles.body}>Troc lié : {request.swapId}. Cette référence désigne un échange entre membres.</Text> : null}
    {request.decision ? <View style={styles.section}>
      <Text style={styles.title}>Décision enregistrée liée à cette demande</Text>
      <Text selectable style={styles.caption}>{request.decision.id} · Révision {request.decision.revision}</Text>
      <Text selectable style={styles.body}>{request.decision.result}</Text>
      {purchaseAutomaticRefundExplanation(request.decision) ? <Text style={styles.body}>{purchaseAutomaticRefundExplanation(request.decision)}</Text> : null}
      {'sourceKind' in request.decision && request.decision.sourceKind === 'swap' ? <>
        <Text style={styles.body}>Examen humain demandé sur la libération interne du complément de ce Troc.</Text>
        <Text selectable style={styles.caption}>Source exacte : {request.decision.sourceHash}.</Text>
        <Text style={styles.caption}>Décision historique enregistrée le {new Date(request.decision.executedAt).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'})} (heure du Québec).</Text>
        <Text selectable style={styles.caption}>Critères historiques : {JSON.stringify(request.decision.criteria)}</Text>
        <Text style={styles.caption}>La source conserve une libération interne enregistrée. Elle ne prouve aucun virement bancaire ; le dépôt et la réponse de l’équipe n’exécutent aucun mouvement de fonds.</Text>
      </> : null}
      {request.decision.decisionType === 'admission_refused' && 'messages' in request.decision && Array.isArray(request.decision.messages) ?
        request.decision.messages.map((message: unknown, index: number) => typeof message === 'string' ? <Text key={index} selectable style={styles.body}>{message}</Text> : null) : null}
      <Text style={styles.caption}>La demande conserve la source de la décision. Un dépôt ou une réponse ne rétablit pas automatiquement l’admissibilité.</Text>
    </View> : null}
    {request.priorSupportRequestId ? <Text selectable style={styles.body}>Dossier antérieur : {request.priorSupportRequestId}. Son horloge initiale est conservée.</Text> : null}
    {request.discoveredAt ? <Text style={styles.body}>Découverte déclarée : {request.discoveredAt.slice(0, 10)}.</Text> : null}
    {request.interruptionAt ? <Text style={styles.body}>Interruption déclarée : {request.interruptionAt.slice(0, 10)}.</Text> : null}
    {request.discoveredAt || request.interruptionAt ? <Text style={styles.caption}>Ces dates sont vos déclarations. Elles ne sont pas certifiées par l’application.</Text> : null}
    {request.statutoryDueDate ? <View style={styles.section}>
      <Text style={styles.body}>Échéance suivie depuis la réception initiale dans l’application : {request.statutoryDueDate}.</Text>
      <Text style={styles.body}>{request.deadlineState === 'overdue' ?
        'L’échéance suivie est dépassée sans réponse enregistrée. Le silence peut constituer un refus ; il ne vaut pas autorisation.' :
        request.deadlineState === 'response_recorded' ? 'Une réponse est enregistrée. Sa présence ne prouve pas qu’elle est complète ou juridiquement suffisante.' :
        'Une réponse reste attendue. Le ticket, les précisions et le retrait de cette demande humaine ne prolongent pas automatiquement les délais applicables.'}</Text>
      <Text style={styles.caption}>Une réception antérieure par un autre canal reste à qualifier. L’application ne certifie pas le point de départ légal ni les délais d’un recours externe.</Text>
    </View> : null}
    {request.latestClarification ? <Text selectable style={styles.body}>Dernières précisions : {request.latestClarification}</Text> : null}
    {request.ownerMessage ? <Text selectable style={styles.body}>Message de l’équipe : {request.ownerMessage}</Text> : null}
    {request.ownerResponse ? <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>Réponse consignée</Text>
      <Text selectable style={styles.body}>{request.ownerResponse.text}</Text>
      {request.ownerResponse.legalBasis ? <Text selectable style={styles.body}>Fondement communiqué : {request.ownerResponse.legalBasis}</Text> : null}
      {request.ownerResponse.recourse ? <Text selectable style={styles.body}>Recours communiqué : {request.ownerResponse.recourse}</Text> : null}
      <Text style={styles.caption}>Consignée le {new Date(request.ownerResponse.recordedAt).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'})} (heure du Québec). Le reçu ne certifie ni la qualification juridique ni une recherche exhaustive de vos données.</Text>
    </View> : null}
    {request.evidence.map((evidence, index) => <Text selectable key={`${evidence.kind}/${evidence.id}/${index}`} style={styles.caption}>Référence privée liée : {evidence.kind === 'meetup_declaration' ? 'Accord et déclaration de rencontre' : evidence.kind} · {evidence.id} · Révision {evidence.revision}</Text>)}
    {request.evidence.filter(evidence => evidence.kind === 'meetup_declaration' && evidence.meetupDeclaration).map((evidence, index) => {
      const declaration = evidence.meetupDeclaration!;
      return <View key={`meetup/${evidence.id}/${index}`} style={styles.section}>
        <Text style={styles.body}>Accord lié : {declaration.agreementQualification === 'native_cash_agreement' ? 'accord natif qualifié' : 'qualification historique inconnue'}.</Text>
        <Text style={styles.body}>Phase consignée : {meetupPhaseLabels[declaration.phase]}. {declaration.completionState === 'recorded'
          ? `Déclaration originale du ${declaration.completionDeclaredAt}, par ${declaration.completionDeclaredBy}.`
          : declaration.completionState === 'absent' ? 'Aucune déclaration originale de remise n’est présente dans cette source.' : 'La présence d’une déclaration originale reste historiquement inconnue.'}</Text>
        <Text style={styles.caption}>Source capturée le {declaration.capturedAt}. {declaration.noticeState === 'native_metadata'
          ? 'Des informations d’avis sont conservées, sans prouver leur enregistrement complet ou leur réception sur appareil.'
          : declaration.noticeState === 'absent' ? 'Cette source ne comporte pas de référence d’avis.' : 'Les avis restent à rapprocher.'}</Text>
        <Text style={styles.caption}>Cette référence ne certifie ni présence physique, remise, paiement hors application, consentement mutuel ou faute. Le nouveau récit conserve l’original.</Text>
      </View>;
    })}
    <Text style={styles.caption}>Ce dossier humain ne déplace aucun fonds, ne ferme pas un litige financier, ne lève pas un gel et ne rétablit pas automatiquement vos accès ou vos droits.</Text>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm }, title: { ...typography.body, color: colors.foreground },
  body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted } });
