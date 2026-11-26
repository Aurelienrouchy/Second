import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { LabelLifecycleCommandPanel } from '@/components/LabelLifecycleCommandPanel';
import { LabelRouteAmendmentOwnHistory } from '@/components/LabelRouteAmendmentOwnHistory';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { LabelLifecycleJournal } from '@/services/labelLifecycleJournal';
import type { LabelLifecycleAttempt, LabelLifecycleContext } from '@/types/labelLifecycle';
import { colors, spacing, typography } from '@/constants/theme';
const rowKey = (r: LabelLifecycleAttempt) => r.requestId;
export function LabelLifecycleOwnHistory({uid}: {uid: string}) {
  const frame = useLabelLifecycleContext('label-lifecycle-own-history', uid), key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision]);
  const [selection, setSelection] = useState<{key: string; context: LabelLifecycleContext} | null>(null);
  const read = useQuery({queryKey: ['label-lifecycle-own-history', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = frame.capture(); return LabelLifecycleJournal.list(uid, () => frame.assertCurrent(op));}});
  const ready = frame.focused && read.isSuccess && !read.isFetching && !read.error, rows = ready ? read.data : [];
  const selected = selection?.key === key ? selection.context : null;
  const renderRow = useCallback(({item}: ListRenderItemInfo<LabelLifecycleAttempt>) => <View style={styles.section}><Text selectable style={styles.body}>Commande {item.context.transactionId} · {item.context.leg === 'forward' ? 'aller' : 'retour'}.</Text><Text style={styles.caption}>Cette intention locale ne prouve pas son résultat.</Text><Button variant="secondary" onPress={() => {try {frame.capture(); setSelection({key, context: item.context});} catch { /* Own SDK context only. */ }}}>Relire mon suivi exact</Button></View>, [frame, key]);
  return <View style={styles.section}><Text style={styles.title}>Mes intentions conservées</Text><Text style={styles.caption}>Votre journal reste accessible avec votre identité de connexion, même sans admission opérateur actuelle. Ce lecteur n’ouvre aucune nouvelle source privée d’une autre partie.</Text>
    <Button variant="secondary" disabled={!frame.focused || read.isFetching} onPress={() => {void read.refetch();}}>Relire mes intentions</Button>
    {read.error ? <Text accessibilityRole="alert" style={styles.body}>Le journal exact ne peut pas être qualifié ; les intentions sont conservées.</Text> : null}
    {ready && !rows.length ? <Text style={styles.caption}>Aucune intention conservée pour cette identité.</Text> : null}
    {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={rowKey} renderItem={renderRow} nestedScrollEnabled /></View> : null}
    {selected && frame.focused ? <LabelLifecycleCommandPanel uid={uid} context={selected} onRecorded={() => {void read.refetch();}} /> : null}
    <LabelRouteAmendmentOwnHistory uid={uid} />
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, padding: spacing.md}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 8}});
