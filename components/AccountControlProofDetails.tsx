import {Share, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
import type {AccountControlProof} from '@/types/accountControlProof';
const labels = {awaiting_second_consent: 'Consentement du second compte attendu', both_consented: 'Deux consentements enregistrés', paused: 'Pause du second compte observée', finalized: 'Rapprochement documentaire finalisé', source_changed: 'Le dossier source a changé', historical_unknown: 'La pause historique reste inconnue'};
export function AccountControlProofDetails({proof, uid, disabled, guard}: {proof: AccountControlProof; uid: string; disabled: boolean; guard: () => void}) {
  const invitation = uid === proof.keepUid && proof.invitationCode ? {supportRequestId: proof.supportRequestId, proofId: proof.proofId, invitationCode: proof.invitationCode} : null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>{labels[proof.stage]}</Text>
    <Text selectable style={styles.caption}>Compte à conserver A : {proof.keepUid}{'\n'}Compte à mettre en pause B : {proof.pauseUid}{'\n'}Dossier : {proof.supportRequestId}{'\n'}Preuve : {proof.proofId}</Text>
    <Text style={styles.body}>{proof.statement}</Text>
    <Text style={styles.caption}>Contrôle des connexions aux deux comptes Seconde : {proof.controlOfBothFirebaseSessionsObserved ? 'observé' : 'non observé'}. Pause : {proof.pauseObserved ? 'observée' : 'non confirmée'} · {proof.pauseSourceQualification === 'created_pause' ? 'créée par la commande liée' : proof.pauseSourceQualification === 'observed_existing_pause' ? 'pause existante relue, sans attribution de sa création' : proof.pauseSourceQualification === 'unknown' ? 'source inconnue' : 'aucun reçu de pause lié'}.</Text>
    {proof.pauseRequestId ? <Text selectable style={styles.caption}>Commande de pause : {proof.pauseRequestId}</Text> : null}
    <Text style={styles.caption}>Avis interne : {proof.inAppNoticeRecorded ? 'enregistrement natif observé' : 'non confirmé'}. La réception sur un appareil ou la lecture humaine ne sont pas prouvées.</Text>
    {invitation ? <>
      <Text style={styles.body}>Invitation à utiliser uniquement après connexion primaire au compte B.</Text>
      <Text selectable style={styles.caption}>{JSON.stringify(invitation)}</Text>
      <Text style={styles.caption}>Valable avant le second consentement jusqu’au {proof.expiresAt}. Transmettez-la par le moyen de votre choix, sans mot de passe ni code de connexion. Après consentement, cette échéance ne clôt aucune obligation.</Text>
      <Button variant="secondary" disabled={disabled} onPress={() => {try {guard(); void Share.share({message: JSON.stringify(invitation)}).catch(() => {});} catch {/* A stale source cannot open sharing. */}}}>Partager explicitement cette invitation</Button>
    </> : null}
    <Text style={styles.caption}>Aucune identité physique, fraude, fusion, circulation de fonds, accès à l’autre compte ou levée de restriction n’est certifié. Chaque compte conserve ses contrats, ses fonds et ses recours avec sa propre connexion.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
