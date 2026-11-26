import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { LabelRouteAmendmentCommandPanel } from '@/components/LabelRouteAmendmentCommandPanel';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { LabelRouteAmendmentJournal } from '@/services/labelRouteAmendmentJournal';
import type { LabelRouteAttempt } from '@/types/labelRouteAmendment';
import type { LabelLifecycleContext } from '@/types/labelLifecycle';
import { colors, spacing, typography } from '@/constants/theme';
const rowKey = (r: LabelRouteAttempt) => r.requestId;
export function LabelRouteAmendmentOwnHistory({uid}: {uid: string}) {
  const frame = useLabelLifecycleContext('label-route-amendment-own-history', uid), key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision]);
  const [selection, setSelection] = useState<{key: string; context: LabelLifecycleContext} | null>(null);
  const read = useQuery({queryKey: ['label-route-amendment-own-history', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return LabelRouteAmendmentJournal.list(uid, () => frame.assertCurrent(op));}});
  const ready = frame.focused && read.isSuccess && !read.isFetching && !read.error, rows = ready ? read.data : [], selected = selection?.key === key ? selection.context : null;
  const renderRow = useCallback(({item}: ListRenderItemInfo<LabelRouteAttempt>) => <View style={styles.section}><Text selectable style={styles.body}>Commande {item.context.transactionId} · {item.context.leg === 'forward' ? 'aller' : 'retour'}.</Text><Text style={styles.caption}>Cette intention locale ne prouve pas son enregistrement.</Text><Button variant="secondary" onPress={() => {try {frame.capture(); setSelection({key, context: item.context});} catch { /* Own SDK context only. */ }}}>Relire mon échange de trajet exact</Button></View>, [frame, key]);
  return <View style={styles.section}><Text style={styles.title}>Mes changements de trajet conservés</Text><Text style={styles.caption}>Le suivi personnel reste accessible avec votre identité de connexion, même sans rôle, profil ou admission nouvelle. Aucune adresse d’une autre commande n’est ouverte par ce lecteur.</Text>
    <Button variant="secondary" disabled={!frame.focused || read.isFetching} onPress={() => {void read.refetch();}}>Relire mon journal de trajet</Button>
    {read.error ? <Text accessibilityRole="alert" style={styles.body}>Le journal exact doit être qualifié ; vos intentions restent conservées.</Text> : null}
    {ready && !rows.length ? <Text style={styles.caption}>Aucun changement de trajet conservé pour cette identité.</Text> : null}
    {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={rowKey} renderItem={renderRow} nestedScrollEnabled /></View> : null}
    {selected && frame.focused ? <LabelRouteAmendmentCommandPanel uid={uid} context={selected} onJournalChanged={() => {void read.refetch();}} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, padding: spacing.md}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 8}});
