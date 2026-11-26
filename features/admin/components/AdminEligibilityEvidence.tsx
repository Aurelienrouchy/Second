import React from 'react';
import { Text,View,StyleSheet } from 'react-native';
import { Checkbox } from '@/components/ui';
import { colors,spacing,typography } from '@/constants/theme';
import type { AdminEligibilityReviewDetail, EligibilityOutcome, EligibilityScope } from '@/types/eligibility';
import { declaredDateLabel,ELIGIBILITY_REVIEW_LABELS,ELIGIBILITY_SCOPE_LABELS } from '@/utils/eligibilityPresentation';
const scopes:EligibilityScope[]=['buy','sell','new_paid_shipping'];
interface Props { detail:AdminEligibilityReviewDetail; open:boolean; busy:boolean; uncertain:boolean; outcome:EligibilityOutcome;clearSignalIds:string[];onToggleSignal:(id:string)=>void }
export function AdminEligibilityEvidence({detail,open,busy,uncertain,outcome,clearSignalIds,onToggleSignal}:Props) {
 const needsAgeReview = detail.request.kind === 'date_of_birth_correction' ||
   detail.eligibility.decisions.sell.reasons.includes('underage') ||
   Object.entries(detail.signals).some(([id, signal]) => signal.active && id.startsWith('signal_connect_dob_'));
 return <>
      <Text selectable style={styles.title}>{detail.request.id}</Text>
      <Text selectable style={styles.body}>Propriétaire : {detail.request.ownerId}</Text>
      <Text style={styles.body}>{ELIGIBILITY_REVIEW_LABELS[detail.request.status]} · {detail.request.kind} · {ELIGIBILITY_SCOPE_LABELS[detail.request.scope]}</Text>
      <Text style={styles.caption}>Dossier version {detail.request.requestVersion} · politique {detail.request.policyVersion} · reçu {detail.request.receivedAt}</Text>
      <Text style={styles.body}>Motif communiqué : {detail.request.reason}</Text>
      <Text style={styles.body}>Date déclarée : {declaredDateLabel(detail.eligibility.dateOfBirth, detail.eligibility.dateOfBirthCopy)}</Text>
      {detail.request.kind === 'date_of_birth_correction' ? <Text style={styles.body}>Source à la demande : {declaredDateLabel(detail.request.originalDateOfBirth, detail.request.originalDateOfBirthCopy)} · nouvelle date demandée : {detail.request.proposedDateOfBirth} · réponse attendue : {detail.request.statutoryDueDate} ({detail.request.deadlineState})</Text> : null}
      <Text style={styles.body}>{detail.eligibility.activityDeclaration?.statement ?? 'Aucune déclaration d’activité'} · version {detail.eligibility.activityDeclaration?.statementVersion}</Text>
      <Text style={styles.body}>Renseignements vendeur : {detail.eligibility.sellerQuebecEvidence?.status ?? 'Absents'} (observation du compte de paiement, résidence non vérifiée).</Text>
      {scopes.map(value => <Text key={value} style={styles.body}>{ELIGIBILITY_SCOPE_LABELS[value]} : {detail.eligibility.decisions[value].status}. {detail.eligibility.decisions[value].messages.join(' ')}</Text>)}
      <Text style={styles.body}>Dernières précisions : {detail.request.latestOwnerDetails ?? 'Aucune'}</Text>
      <Text style={styles.body}>Décision précédente : {detail.request.ownerDecisionReason ?? 'Aucune'}</Text>
      {detail.request.ownerResponse ? <Text style={styles.body}>{detail.request.ownerResponse.text} · {detail.request.ownerResponse.legalBasis} · {detail.request.ownerResponse.recourse}</Text> : null}
      <Text style={styles.body}>Note interne précédente : {detail.request.internalNote ?? 'Aucune'}</Text>
      {needsAgeReview ? <View style={styles.signal}>
        <Text style={styles.title}>Vérifier l’âge et les ventes déjà engagées</Text>
        <Text style={styles.body}>Vérifiez la minorité et les pièces disponibles, puis examinez les dossiers de vente déjà engagés ci-dessous. Contactez les personnes concernées par l’assistance et les recours du dossier, en conservant les preuves.</Text>
        <Text style={styles.body}>Une annulation ou un remboursement nécessite une décision humaine adaptée à l’état de chaque vente et au prestataire concerné. Le signal d’âge ne déclenche aucune annulation, aucun remboursement ni confiscation automatique des fonds.</Text>
      </View> : null}
      <Text style={styles.title}>Ventes liées au propriétaire</Text>
      <Text style={styles.caption}>Références de dossiers à examiner · jusqu’à 20 ventes par page.</Text>
      {!detail.relatedSales ? <Text style={styles.body}>Ventes liées indisponibles. Actualisez le dossier pour les consulter.</Text>
        : detail.relatedSales.items.length === 0 ? <Text style={styles.body}>Aucune vente sur cette page.</Text>
          : detail.relatedSales.items.map(sale => <View key={sale.id} style={styles.signal}>
            <Text selectable style={styles.body}>Référence : {sale.id}</Text>
            <Text style={styles.body}>Statut enregistré : {sale.status ?? 'Inconnu'}</Text>
            <Text style={styles.body}>Parcours : {sale.deliveryType === 'meetup' ? 'Remise en main propre' : sale.deliveryType === 'shipping' ? 'Livraison' : 'Inconnu'}</Text>
            <Text style={styles.caption}>Date de création : {sale.createdAt ?? 'Inconnue'}</Text>
          </View>)}
      {Object.entries(detail.signals).map(([id, signal]) => <View key={id} style={styles.signal}>
        <Text selectable style={styles.body}>{id} · {signal.scope} · {signal.active ? 'Actif' : 'Clos'} · acteur {signal.actorUid} · {signal.internalNote}</Text>
        {open && signal.active && signal.scope === detail.request.scope && ['approve_correction', 'complete_review'].includes(outcome) ? <Checkbox
          checked={clearSignalIds.includes(id)} disabled={busy || uncertain || (!clearSignalIds.includes(id) && clearSignalIds.length >= 20)}
          onToggle={() => onToggleSignal(id)}
          accessibilityLabel={`Clore le signal ${id}`}><Text style={styles.body}>Clore ce signal du même périmètre</Text></Checkbox> : null}
      </View>)}
 </>;
}
const styles=StyleSheet.create({title:{...typography.h3,color:colors.foreground},body:{...typography.body,color:colors.foregroundSecondary},caption:{...typography.caption,color:colors.muted},signal:{padding:spacing.md,backgroundColor:colors.surface,gap:spacing.sm}});
