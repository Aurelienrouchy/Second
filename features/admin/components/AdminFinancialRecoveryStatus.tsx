import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {FinancialRecoveryService} from '@/services/financialRecoveryService';
import {colors, spacing, typography} from '@/constants/theme';

const modes = {normal: 'Contrôle d’admission ouvert', draining: 'Arrêt des nouveaux effets demandé', recovery: 'Reprise après restauration — effets suspendus', unavailable: 'Contrôle indépendant indisponible'};
export function AdminFinancialRecoveryStatus({uid}: {uid: string}) {
  const frame = useLabelLifecycleContext('financial-recovery-status', uid);
  const key = ['financial-recovery-status', uid, getAuthSessionGeneration(), frame.focusRevision] as const;
  const query = useQuery({queryKey: key, enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = frame.capture(); return FinancialRecoveryService.observe(uid, () => frame.assertCurrent(op));}});
  const status = frame.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Reprise financière après restauration</Text>
    <Text style={styles.caption}>Lecture du contrôle administré indépendamment de la base restaurée. Ce panneau ne restaure aucune donnée et ne rouvre aucun paiement.</Text>
    <Button variant="secondary" disabled={!frame.focused || query.isFetching} onPress={() => {try {frame.capture(); void query.refetch();} catch {/* A replaced SDK frame cannot read private control facts. */}}}>Relire le contrôle indépendant</Button>
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>État inconnu : la lecture ou l’habilitation actuelle n’a pas pu être confirmée. Une erreur de lecture ne prouve pas que le contrôle est ouvert.</Text> : null}
    {status ? <>
      <Text style={styles.body}>{modes[status.mode]}</Text>
      <Text selectable style={styles.caption}>Époque : {status.epoch ?? 'inconnue'} · précédente : {status.previousEpoch ?? 'inconnue'} · génération : {status.controlGeneration ?? 'inconnue'}</Text>
      <Text style={styles.caption}>Drainage des effets en vol : non mesuré. Chaque source financière doit encore être qualifiée ; un contrôle ouvert n’autorise pas toutes les sources.</Text>
      {status.reason ? <Text selectable style={styles.caption}>Motif technique : {status.reason}</Text> : null}
      <Text style={styles.caption}>Observation : {status.observedAt}. Réouverture réservée à l’autorité IAM indépendante. Aucun mouvement financier appliqué.</Text>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
