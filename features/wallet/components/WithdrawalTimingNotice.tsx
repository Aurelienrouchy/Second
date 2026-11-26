import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { WithdrawalTimingSummary } from '@/components/WithdrawalTimingSummary';
import { ExceptionalRestitutionOwnerPanel } from '@/components/ExceptionalRestitutionOwnerPanel';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { WithdrawalTimingService } from '@/services/withdrawalTimingService';
import { colors, radius, spacing, typography } from '@/constants/theme';

export function WithdrawalTimingNotice({withdrawalRequestId, sourceKey}: {withdrawalRequestId: string; sourceKey: string}) {
  const uid = useAuthenticatedUid(), generation = getAuthSessionGeneration(), router = useRouter();
  const [expanded, setExpanded] = useState(false), [instance] = useState(() => randomUUID());
  const [readRevision, setReadRevision] = useState(0);
  const context = useShippingPurchaseContext(JSON.stringify(['withdrawal-timing', withdrawalRequestId, sourceKey]), uid);
  const read = useQuery({queryKey: ['withdrawal-timing', instance, readRevision, uid, generation, withdrawalRequestId, sourceKey, context.focusRevision],
    enabled: !!uid && context.focused && expanded, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return WithdrawalTimingService.read(operation.session.uid, withdrawalRequestId, () => context.assertCurrent(operation));}});
  const source = uid && context.focused && expanded && read.isSuccess && !read.isFetching && !read.isError ? read.data : null;
  return <View style={styles.card}>
    <Button variant="secondary" disabled={!uid || !context.focused} onPress={() => {try {context.capture(); if (!expanded) setReadRevision(value => value + 1); setExpanded(value => !value);} catch { /* Stale owner session. */ }}}>{expanded ? 'Masquer le suivi du délai' : 'Consulter le délai ou demander une enquête'}</Button>
    {expanded ? <>
      <Text accessibilityRole="header" style={styles.title}>Délai du retrait enregistré</Text>
      {source ? <WithdrawalTimingSummary source={source} /> : <Text style={styles.body}>{read.isError ? 'L’observation actuelle ne peut pas être confirmée. Les anciennes informations de délai sont masquées.' : 'Lecture des observations enregistrées…'}</Text>}
      {uid ? <ExceptionalRestitutionOwnerPanel uid={uid} context={{kind: 'withdrawal_misdirection', withdrawalRequestId}} /> : null}
      <Button variant="secondary" disabled={!uid || !context.focused || read.isFetching} onPress={() => {try {context.capture(); void read.refetch();} catch { /* Stale owner session. */ }}}>Relire les observations enregistrées</Button>
      <Button variant="ghost" disabled={!uid || !context.focused} onPress={() => {try {context.capture(); router.push({pathname: '/settings/support', params: {kind: 'withdrawal_timing_assistance', withdrawalRequestId}} as never);} catch { /* Stale owner session. */ }}}>Demander une enquête pour ce retrait</Button>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({card: {gap: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}});
