import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { LabelLifecycleService } from '@/services/labelLifecycleService';
import type { LabelLifecycleLeg } from '@/types/labelLifecycle';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
export function LabelLifecycleOrderEntry({transactionId, leg, sourceKey}: {transactionId: string; leg: LabelLifecycleLeg; sourceKey: string}) {
  const uid = useAuthenticatedUid(), router = useRouter(), frame = useLabelLifecycleContext(JSON.stringify(['label-lifecycle-order-entry', transactionId, leg, sourceKey]), uid);
  const key = JSON.stringify([uid, transactionId, leg, sourceKey, getAuthSessionGeneration(), frame.focusRevision]);
  const read = useQuery({queryKey: ['label-lifecycle-own-order-source', key], enabled: !!uid && frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {if (!uid) throw new Error('Relisez votre session.'); const op = frame.capture(); return LabelLifecycleService.observe(uid, {transactionId, leg}, 'own', () => frame.assertCurrent(op));}});
  const source = frame.focused && read.isSuccess && !read.isFetching && !read.error ? read.data : null;
  return <View style={styles.section}><Text style={styles.title}>Étiquette {leg === 'forward' ? 'aller' : 'retour'} : dossier et observations</Text>
    {source ? <><Text style={styles.body}>{source.source.stopUse ? 'Arrêt d’utilisation enregistré : ne déposez pas le colis avec cette étiquette.' : source.currentLabelUse.nativeGuardsAllowUse ? 'Les gardes internes examinées ne retiennent pas de blocage dans cette lecture. Cela ne confirme pas la disponibilité ou la validité actuelle de l’étiquette chez le transporteur.' : 'Les gardes internes restent bloquantes ou non qualifiées. Demandez un examen avant tout nouveau dépôt.'}</Text>
      {source.currentLabelUse.lastRecordedDocumentObservation ? <Text style={styles.caption}>Dernière observation enregistrée pour {source.currentLabelUse.lastRecordedDocumentObservation.labelId} : document annoncé disponible et non annulé le {new Date(source.currentLabelUse.lastRecordedDocumentObservation.observedAt).toLocaleString(APP_LOCALE)}. Son état actuel reste inconnu.</Text> : <Text style={styles.caption}>Aucune observation enregistrée de disponibilité n’est qualifiée dans ce dossier.</Text>}
      <Text style={styles.caption}>Dossier relu le {new Date(source.readAt).toLocaleString(APP_LOCALE)} ; cette lecture ne fait pas de nouvelle vérification chez le transporteur et n’autorise pas un dépôt.</Text></> : <Text style={styles.body}>Le dossier est masqué pendant sa lecture ou s’il ne peut pas être qualifié. La disponibilité actuelle chez le transporteur reste inconnue ; un ancien PDF n’autorise pas un nouveau dépôt.</Text>}
    <Button variant="secondary" disabled={!uid || !frame.focused || read.isFetching} onPress={() => {void read.refetch();}}>Relire le dossier enregistré et ses gardes</Button>
    <Button variant="secondary" disabled={!uid || !frame.focused} onPress={() => {try {frame.capture(); router.push({pathname: '/label-lifecycle', params: {transactionId, leg}} as never);} catch { /* Own sources and receipts are requalified at the destination. */ }}}>Suivre cette étiquette et mes intentions</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
