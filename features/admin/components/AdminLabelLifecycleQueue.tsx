import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { LabelLifecycleService, isLabelLifecycleContext } from '@/services/labelLifecycleService';
import type { LabelLifecycleContext, LabelLifecycleCursor, LabelLifecycleQueue } from '@/types/labelLifecycle';
import { colors, spacing, typography } from '@/constants/theme';
type Row = LabelLifecycleQueue['entries'][number];
const rowKey = (r: Row) => r.orphanAlert?.id ?? JSON.stringify([r.transactionId, r.leg]);
export function AdminLabelLifecycleQueue({uid, onSelect, stream = 'orders'}: {uid: string; onSelect: (context: LabelLifecycleContext) => void; stream?: LabelLifecycleQueue['stream']}) {
  const frame = useLabelLifecycleContext(`label-lifecycle-admin-queue:${stream}`, uid), key = JSON.stringify([uid, stream, getAuthSessionGeneration(), frame.focusRevision]);
  const read = useInfiniteQuery({queryKey: ['label-lifecycle-admin-queue', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as LabelLifecycleCursor | null,
    queryFn: ({pageParam}) => {const op = frame.capture(); return LabelLifecycleService.queue(uid, pageParam, () => frame.assertCurrent(op), stream);}, getNextPageParam: p => p.coverage.hasMore ? p.nextCursor : undefined});
  const entries = read.data?.pages.flatMap(p => p.entries) ?? [], ids = entries.map(rowKey);
  const ready = frame.focused && read.isSuccess && !read.isFetching && !read.error && new Set(ids).size === ids.length, rows = ready ? entries : [];
  const renderRow = useCallback(({item}: ListRenderItemInfo<Row>) => <View style={styles.section}><Text selectable style={styles.body}>Commande {item.transactionId ?? 'inconnue'} · {item.leg === 'forward' ? 'aller' : 'retour'}.</Text><Text style={styles.caption}>{item.qualification === 'unknown' ? 'Source à rapprocher ; identité ou historique non qualifiés.' : item.qualification === 'native_purchase_reconciliation' ? 'Achat d’origine à rapprocher.' : 'Identité enregistrée ; arrêt ou remplacement à examiner.'}</Text>
    {item.orphanAlert ? <><Text selectable style={styles.caption}>Alerte privée partielle {item.orphanAlert.id} ; étiquette {item.orphanAlert.labelId ?? 'inconnue'}.</Text>{item.orphanAlert.reason ? <Text selectable style={styles.body}>{item.orphanAlert.reason}</Text> : null}<Text style={styles.caption}>Cette alerte ne prouve pas son rattachement à la commande, son achat, son coût ou une permission d’annuler ou de remplacer.</Text></> : null}
    <Button variant="secondary" disabled={!isLabelLifecycleContext({transactionId: item.transactionId, leg: item.leg})} onPress={() => {const c = {transactionId: item.transactionId, leg: item.leg}; if (!isLabelLifecycleContext(c)) return; try {frame.capture(); onSelect(c);} catch { /* The destination requalifies operator, order and label independently of the partial alert. */ }}}>Lire cette référence de commande</Button></View>, [frame, onSelect]);
  return <View style={styles.section}><Text style={styles.title}>{stream === 'orders' ? 'Commandes avec étiquette à examiner' : 'Alertes privées d’étiquette orpheline'}</Text><Text style={styles.caption}>Les lignes inconnues restent visibles. Chaque page inspecte au plus 20 {stream === 'orders' ? 'commandes' : 'alertes'}, avec un regard sur la suivante ; chaque flux conserve son propre curseur.</Text>
    <Button variant="secondary" disabled={!frame.focused || read.isFetching} onPress={() => {void read.refetch();}}>Relire la file opérateur</Button>
    {read.isFetching ? <Text style={styles.caption}>Lecture opérateur actuelle…</Text> : !ready ? <Text accessibilityRole="alert" style={styles.body}>La file privée est masquée. Relisez l’accès opérateur ; vos propres intentions restent consultables séparément.</Text> : null}
    {ready && !rows.length ? <Text style={styles.caption}>Aucun dossier pertinent dans les lignes inspectées de ce flux. Cette page ne certifie pas l’absence d’autres dossiers.</Text> : null}
    {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={rowKey} renderItem={renderRow} nestedScrollEnabled /></View> : null}
    {ready ? <><Text style={styles.caption}>{read.data.pages.reduce((sum, p) => sum + p.coverage.inspected, 0)} ligne(s) inspectée(s). File accessible non certifiée exhaustive.</Text>{read.hasNextPage ? <Button variant="secondary" disabled={read.isFetching} onPress={() => {void read.fetchNextPage();}}>Inspecter les lignes suivantes</Button> : null}</> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 9}});
