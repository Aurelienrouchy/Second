import {StyleSheet, Text, View} from 'react-native';
import {APP_LOCALE} from '@/constants/locale';
import {colors, spacing, typography} from '@/constants/theme';
import type {LabelDepositDeadlineSource} from '@/types/transportReview';
const when = (v: string | null) => v ? new Date(v).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'}) : 'inconnue';
export function LabelDepositDeadlineEvidence({source, historical = false, showReferences = false}: {source: LabelDepositDeadlineSource; historical?: boolean; showReferences?: boolean}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>{historical ? 'Source initiale conservée de la revue système' : 'Échéance après création d’étiquette : source actuelle'}</Text>
    <Text style={styles.body}>{source.deadlineQualification === 'native_accepted_window' ? 'Fenêtre de la politique acceptée qualifiée par le dossier natif.' : 'La fenêtre acceptée ne peut pas être qualifiée. Aucune date n’est reconstruite depuis la création de la commande.'}</Text>
    <Text style={styles.body}>Début qualifié : {when(source.startsAt)}. Échéance acceptée : {when(source.expiresAt)} (heure du Québec).</Text>
    <Text style={styles.body}>{source.deadlineQualification !== 'native_accepted_window' ? 'Le dépassement du délai reste inconnu.' : source.deadlineReached ? 'L’échéance était atteinte dans cette lecture serveur.' : 'L’échéance n’était pas atteinte dans cette lecture serveur.'} Le délai seul ne prouve ni non-dépôt, ni perte ou faute et n’autorise aucun remboursement.</Text>
    <Text style={styles.body}>Étiquette {historical ? 'de cette source initiale' : 'actuellement qualifiée'} : {source.labelQualification === 'native_current_label' ? source.labelId : 'inconnue'}.</Text>
    <Text style={styles.body}>{source.carrierScanQualification === 'carrier_scan_recorded' ? 'Un scan transporteur est enregistré pour cette source.' : source.carrierScanQualification === 'no_acceptance_scan_recorded' ? 'La source enregistrée ne comporte pas de scan d’acceptation. Cela ne prouve pas que le colis n’a pas été déposé.' : 'La situation des scans ne peut pas être qualifiée.'}</Text>
    <Text style={styles.caption}>Statut observé : {source.observedStatusCode ?? 'inconnu'} · lecture fournisseur : {when(source.providerObservedAt)} · occurrence fournie : {when(source.providerEventAt)}.</Text>
    <Text style={styles.body}>{source.depositDeclaration === 'sender_handover_declared' ? 'Le vendeur a déclaré une remise initiale au transporteur dans une contribution native. Cette déclaration ne certifie pas le dépôt physique.' : source.depositDeclaration === 'not_recorded' ? 'Aucune déclaration de remise initiale du vendeur n’est enregistrée dans le manifeste qualifié. Cela ne certifie pas une absence de dépôt.' : 'Les déclarations de remise initiale ne peuvent pas être qualifiées.'}</Text>
    <Text style={styles.caption}>{source.declarationManifestComplete ? 'Le manifeste borné des contributions examinées est complet pour cette lecture.' : 'Le manifeste des contributions est incomplet ou non qualifié. Une clôture documentaire ne peut pas être déduite de cette lecture.'} État de commande observé : {source.currentOrderStatus ?? 'inconnu'}.</Text>
    {historical ? <Text style={styles.caption}>Cette capture reste historique. Un changement d’étiquette ou de source impose un nouvel examen ; l’ancien délai ne donne aucune permission actuelle.</Text> : null}
    {showReferences ? <Text selectable style={styles.caption}>Politique : {source.policyVersion ?? 'inconnue'} · empreinte : {source.policyHash ?? 'inconnue'}{'\n'}Source du délai : {source.deadlineSourceHash ?? 'inconnue'}{'\n'}Source d’étiquette : {source.labelSourceHash ?? 'inconnue'}{'\n'}Manifeste : {source.declarationManifestHash}{'\n'}Source : {source.sourceHash}</Text> : null}
    <Text style={styles.caption}>Ce dossier ne certifie ni dépôt, ni absence de dépôt, ni perte définitive. Il n’autorise aucun mouvement d’argent, remise en vente ou annulation d’étiquette.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
