import {useCallback, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {BankRefundReconciliationReceiptSummary} from '@/components/BankRefundReconciliationReceiptSummary';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {BankRefundReconciliationJournal} from '@/services/bankRefundReconciliationJournal';
import {createBankRefundReconciliationInteraction} from '@/utils/bankRefundReconciliationContract';
import type {BankRefundReconciliationAttempt, BankRefundReconciliationReceipt} from '@/types/bankRefundReconciliation';
import {colors, spacing, typography} from '@/constants/theme';

const EMPTY: BankRefundReconciliationAttempt[] = [];
const keyExtractor = (a: BankRefundReconciliationAttempt) => JSON.stringify([a.transactionId, a.disputeId, a.requestId]);
export function BankRefundReconciliationCommandHistory({uid}: {uid: string}) {
  const base = useLabelLifecycleContext('bank-financial-own-journal', uid), key = JSON.stringify([uid, base.focusRevision]);
  const [interaction] = useState(createBankRefundReconciliationInteraction), lock = useRef(false), [busy, setBusy] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{key: string; value: BankRefundReconciliationReceipt} | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const q = useQuery({queryKey: ['bank-financial-sdk-journal', uid, key], enabled: base.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = base.capture(); return BankRefundReconciliationJournal.list(uid, () => base.assertCurrent(op));}});
  const attempts = base.focused && q.isSuccess && !q.isFetching && !q.isError ? q.data : EMPTY;
  const run = useCallback(async (a: BankRefundReconciliationAttempt, mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (lock.current || a.uid !== uid || !attempts.some(x => keyExtractor(x) === keyExtractor(a))) return;
    interaction.invalidate(); const choice = interaction.capture(); let op; try {op = base.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(key); setNotice(null); const current = () => {base.assertCurrent(op); choice();};
    try {const r = await BankRefundReconciliationJournal[mode](a, current); current(); setReceipt({key, value: r}); await q.refetch(); current();}
    catch (error) {try {current(); setNotice({key, text: error instanceof Error ? error.message : 'Le propre reçu doit être observé à nouveau.'}); await q.refetch();} catch {/* A superseded journal choice has no callback authority. */}}
    finally {base.finish(op); lock.current = false; if (base.isCurrent(op)) setBusy(null);}
  }, [uid, attempts, interaction, base, key, q]);
  const renderItem = useCallback(({item}: {item: BankRefundReconciliationAttempt}) => {
    const r = receipt?.key === key && receipt.value.requestId === item.requestId && receipt.value.disputeId === item.disputeId ? receipt.value : null;
    return <View style={styles.section}><Text selectable style={styles.caption}>Intention {item.requestId} · commande {item.transactionId} · dossier {item.disputeId} · {item.command.action}.</Text>
      <Text selectable style={styles.body}>Motivation privée conservée : {item.command.note}</Text>
      <Text style={styles.caption}>Le propre journal conserve uniquement le tuple documentaire et ses références. Aucun secret, résultat prestataire ou rapport privé n’y est stocké. Une observation ne réexécute pas une instruction ni ne change le formulaire courant.</Text>
      <Button variant="secondary" disabled={busy === key} onPress={() => void run(item, 'observe')}>Observer mon propre reçu</Button>
      <Button variant="secondary" disabled={busy === key} onPress={() => void run(item, 'neutralize')}>Neutraliser cette intention encore non enregistrée</Button>
      {r ? <BankRefundReconciliationReceiptSummary value={r}/> : null}
      {r && ['received', 'not_executed'].includes(r.state) ? <Button variant="secondary" disabled={busy === key} onPress={() => void run(item, 'acknowledge')}>Relire un reçu terminal frais et terminer ce suivi local</Button> : null}
    </View>;
  }, [receipt, key, busy, run]);
  return <View style={styles.section}><Text style={styles.title}>Mes intentions de rapprochement documentaire</Text>
    {attempts.length ? <View style={styles.viewport}><FlashList data={attempts} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled/></View> : <Text style={styles.caption}>{q.isFetching ? 'Lecture de mon journal…' : q.isError ? 'Mon journal doit être relu.' : 'Aucune intention locale qualifiée visible.'}</Text>}
    <Button variant="secondary" disabled={!base.focused || busy === key || q.isFetching} onPress={() => {try {base.capture(); interaction.invalidate(); setReceipt(null); void q.refetch();} catch {/* Inactive SDK frame. */}}}>Relire mon journal documentaire</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, viewport: {height: spacing['4xl'] * 5}});
