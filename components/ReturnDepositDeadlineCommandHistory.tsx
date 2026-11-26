import {useCallback, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {ReturnDepositDeadlinePanel} from '@/components/ReturnDepositDeadlinePanel';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {ReturnDepositDeadlineJournal} from '@/services/returnDepositDeadlineJournal';
import {createReturnDepositInteraction} from '@/utils/returnDepositDeadlineContract';
import type {ReturnDepositDeadlineAttempt} from '@/types/returnDepositDeadline';
import {colors, spacing, typography} from '@/constants/theme';

const EMPTY: ReturnDepositDeadlineAttempt[] = [];
const keyExtractor = (a: ReturnDepositDeadlineAttempt) => JSON.stringify([a.transactionId, a.requestId]);
export function ReturnDepositDeadlineCommandHistory({uid}: {uid: string}) {
  const base = useLabelLifecycleContext('return-deposit-deadline-own-history', uid), client = useQueryClient();
  const [revision, setRevision] = useState(0), key = JSON.stringify([uid, getAuthSessionGeneration(), base.focusRevision, revision]);
  const [frame, setFrame] = useState(() => ({key, interaction: createReturnDepositInteraction()})); let liveFrame = frame;
  if (frame.key !== key) {frame.interaction.invalidate(); liveFrame = {key, interaction: createReturnDepositInteraction()}; setFrame(liveFrame);}
  const choice = liveFrame.interaction.capture(), queryKey = ['return-deposit-deadline-sdk-history', key];
  const q = useQuery({queryKey, enabled: base.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = base.capture(); return ReturnDepositDeadlineJournal.list(uid, () => {base.assertCurrent(op); choice();});}});
  const ready = base.focused && q.isSuccess && q.fetchStatus === 'idle' && !q.isError && client.getQueryState(queryKey)?.isInvalidated === false;
  const attempts = ready ? q.data : EMPTY;
  const [selection, setSelection] = useState<{key: string; transactionId: string} | null>(null);
  const assertRead = () => {
    base.capture(); choice(); const state = client.getQueryState(queryKey);
    if (!ready || !state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.error !== null || state.isInvalidated || state.data !== q.data || state.dataUpdatedAt !== q.dataUpdatedAt) throw new Error('Relisez votre journal local avant de choisir cette référence.');
  };
  const refresh = () => {try {base.capture(); choice(); liveFrame.interaction.invalidate(); setSelection(null); setRevision(v => v + 1);} catch { /* A stale identity cannot refresh a replacement journal. */ }};
  const renderItem = useCallback(({item}: {item: ReturnDepositDeadlineAttempt}) => <View style={styles.row}>
    <Text selectable style={styles.caption}>Commande {item.transactionId} · intention {item.requestId} · {item.command.action === 'extend' ? 'prolongation motivée' : 'ancienne intention de mise à disposition'}.</Text>
    <Button variant="secondary" disabled={!ready} onPress={() => {try {assertRead(); if (!attempts.some(a => keyExtractor(a) === keyExtractor(item))) return; setSelection({key, transactionId: item.transactionId});} catch { /* Local discovery grants no native admission. */ }}}>Observer le propre reçu de cette référence</Button>
  </View>, [ready, assertRead, attempts, key]);
  const selected = ready && selection?.key === key && attempts.some(a => a.transactionId === selection.transactionId) ? selection.transactionId : null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Mes instructions de délai conservées</Text>
    <Text style={styles.caption}>Références locales de ce compte sur cet appareil. Leur résultat natif est relu après sélection, même si le profil, la commande ou le rôle opérateur n’est plus accessible. Ce journal n’est pas un historique serveur exhaustif.</Text>
    {attempts.length ? <View style={styles.viewport}><FlashList data={attempts} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled/></View> : <Text style={styles.caption}>{q.isFetching ? 'Lecture de mon journal…' : q.isError ? 'Mon journal ne peut pas être qualifié. Aucune absence d’intention n’est déduite.' : 'Aucune intention locale qualifiée dans cette lecture.'}</Text>}
    <Button variant="secondary" disabled={!base.focused || q.isFetching} onPress={refresh}>Relire mon journal de délais</Button>
    {selected ? <ReturnDepositDeadlinePanel uid={uid} transactionId={selected} scope="owner" sourceKey={JSON.stringify([key, selected, 'own-receipt-only'])} onRecorded={refresh}/> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.md, paddingVertical: spacing.sm}, row: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.h3, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, viewport: {height: spacing['4xl'] * 4}});
