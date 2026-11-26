import { StyleSheet, Text, View } from 'react-native';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import type { WithdrawalTimingSource } from '@/types/withdrawalTiming';

const statuses = {pending: 'en attente', in_transit: 'en transit', paid: 'payé selon le prestataire', failed: 'échec signalé', canceled: 'annulation signalée'};
export function WithdrawalTimingSummary({source}: {source: WithdrawalTimingSource}) {
  const observation = source.observation;
  return <View style={styles.section}>
    <Text style={styles.body}>État enregistré dans l’application : {source.requestState === 'processing' ? 'traitement en cours' : source.requestState === 'completed' ? 'traitement déclaré terminé' : source.requestState === 'failed' ? 'échec déclaré' : 'inconnu'}. Cet état ne certifie pas un crédit bancaire.</Text>
    <Text style={styles.body}>{source.sourceQualification === 'qualified' ? 'La référence financière de ce retrait est qualifiée dans cette lecture.' : 'La source financière de ce retrait reste à rapprocher.'}</Text>
    {observation ? <>
      <Text style={styles.body}>Statut observé chez le prestataire : {statuses[observation.providerStatus]}.</Text>
      <Text style={styles.caption}>Observation enregistrée le {new Date(observation.observedAt).toLocaleString(APP_LOCALE)}. Cette date est distincte de l’arrivée des fonds.</Text>
      <Text style={styles.caption}>{observation.sourceCurrent ? 'Cette observation correspond à l’identité financière du retrait lors de cette lecture. Elle ne constitue pas une mise à jour en temps réel.' : 'Cette observation est historique ; sa source ne concorde plus avec l’identité financière actuelle du retrait.'}</Text>
      <Text style={styles.body}>{observation.arrivalCalendarDate ? `${observation.sourceCurrent ? 'Estimation' : 'Ancienne estimation'} calendaire fournie par le prestataire : ${observation.arrivalCalendarDate}.` : 'Estimation calendaire qualifiée non fournie.'}</Text>
      <Text style={styles.caption}>La date calendaire fournie est reproduite telle quelle, sans conversion de fuseau horaire. Elle n’est pas une date d’arrivée garantie.</Text>
    </> : <Text style={styles.body}>Aucune observation de délai qualifiée n’est disponible. Un ancien statut de retrait ne remplace pas cette observation.</Text>}
    <Text style={styles.caption}>Un statut payé ne prouve pas un crédit reçu sur votre compte bancaire. Si les fonds sont absents ou si l’estimation vous semble dépassée, vous pouvez demander une enquête même pendant un traitement ordinaire. Le délai seul ne déclenche ni second retrait, compensation ou annulation.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
