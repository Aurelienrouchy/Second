import { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button } from '@/components/ui';
import { RefundRepairSummary } from '@/components/RefundRepairSummary';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { RefundRepairJournal, RefundRepairManualJournal } from '@/services/refundRepairJournal';
import { canAcknowledgeRefundRepair } from '@/services/refundRepairService';
import type { RefundRepairAttempt, RefundRepairReceipt, RefundRepairManualAttempt, RefundRepairManualReceipt, RefundRepairManualEvidenceAttempt, RefundRepairManualEvidenceReceipt } from '@/types/refundRepair';
type Entry = {attempt: RefundRepairAttempt; receipt: RefundRepairReceipt; busy: boolean; run: (a: RefundRepairAttempt, mode: 'observe' | 'recover' | 'neutralize' | 'acknowledge') => void};
const entryKey = (e: Entry) => e.attempt.requestId;
const renderEntry = ({item}: ListRenderItemInfo<Entry>) => <View style={styles.section}>
  <Text selectable style={styles.caption}>Commande {item.attempt.command.transactionId} · obligation {item.attempt.command.refundIntentId} · intention {item.attempt.requestId}.</Text>
  <Text style={styles.caption}>Source et textes d’origine conservés ; ce journal ne donne aucune permission d’une nouvelle réparation.</Text>
  <Text selectable style={styles.body}>Motivation privée d’origine : {item.attempt.command.note}</Text><Text selectable style={styles.body}>Message communicable d’origine : {item.attempt.command.partyMessage}</Text>
  <Text style={styles.body}>{item.receipt.state === 'unrecorded' ? 'Aucun reçu natif enregistré. Cette absence ne prouve pas une non-exécution.' : item.receipt.state === 'not_executed' ? 'La non-exécution de cette intention exacte est enregistrée.' : item.receipt.state === 'committed' ? 'L’instruction documentaire est enregistrée. Aucun paiement externe ni argent reçu n’est attesté.' : 'Cette réparation est réservée ; son résultat financier reste distinct de la réservation.'}</Text>
  <RefundRepairSummary financial={item.receipt.financial} />
  <Button variant="secondary" disabled={item.busy} onPress={() => item.run(item.attempt, 'observe')}>Relire mon reçu exact</Button>
  {item.receipt.state === 'reserved' ? <Button variant="secondary" disabled={item.busy} onPress={() => item.run(item.attempt, 'recover')}>Rechercher le résultat de cette tentative en lecture seule</Button> : null}
  {item.receipt.state === 'unrecorded' ? <Button variant="secondary" disabled={item.busy} onPress={() => Alert.alert('Neutraliser cette intention', 'Seuls les effets non engagés de cette même référence seront bloqués. Une réparation déjà réservée reste conservée ; aucun accord ni paiement enregistré n’est annulé.', [{text: 'Conserver', style: 'cancel'}, {text: 'Neutraliser', onPress: () => item.run(item.attempt, 'neutralize')}])}>Neutraliser mon intention non engagée</Button> : null}
  {canAcknowledgeRefundRepair(item.receipt) ? <Button variant="secondary" disabled={item.busy} onPress={() => item.run(item.attempt, 'acknowledge')}>Relire le reçu terminal puis terminer ce suivi local</Button> : null}
</View>;
type ManualRow = {key: string; busy: boolean; run: (mode: 'observe' | 'recover' | 'neutralize' | 'acknowledge') => void} &
  ({kind: 'command'; attempt: RefundRepairManualAttempt; receipt: RefundRepairManualReceipt} | {kind: 'proof'; attempt: RefundRepairManualEvidenceAttempt; receipt: RefundRepairManualEvidenceReceipt});
const manualEntryKey = (v: ManualRow) => v.key;
const renderManualEntry = ({item}: ListRenderItemInfo<ManualRow>) => <View style={styles.section}>
  <Text selectable style={styles.caption}>Intention manuelle {item.attempt.requestId} · commande {item.kind === 'command' ? item.attempt.command.transactionId : item.attempt.context.transactionId}.</Text>
  <Text style={styles.body}>{item.kind === 'command' ? item.receipt.state === 'committed'
    ? item.receipt.manualState === 'manual_operator_attested' ? 'Attestation humaine du virement manuel enregistrée. Aucune confirmation Stripe ou arrivée bancaire automatique.'
      : item.receipt.manualState === 'prepared' ? 'Instruction manuelle préparée ; aucun virement effectué n’est déduit.' : 'La décision documentaire exacte est enregistrée.'
    : item.receipt.state === 'not_executed' ? 'Non-exécution de cette intention enregistrée.' : 'Issue inconnue ; relisez le même reçu sans créer une nouvelle intention.'
    : item.receipt.state === 'stored' ? 'Pièce privée native conservée ; son contenu n’est pas exposé dans ce journal.' : item.receipt.state === 'stored_requires_review' ? 'Pièce conservée pour rapprochement ; aucune adoption financière déduite.'
      : item.receipt.state === 'not_executed' ? 'Dépôt non engagé neutralisé.' : 'Résultat du même dépôt à relire ; aucun fichier de remplacement n’est envoyé.'}</Text>
  <Button variant="secondary" disabled={item.busy} onPress={() => item.run('observe')}>Relire ce reçu manuel exact</Button>
  {item.kind === 'command' && item.receipt.state === 'unrecorded' ? <Button variant="secondary" disabled={item.busy} onPress={() => item.run('recover')}>Rechercher uniquement le résultat de cette intention</Button> : null}
  {item.receipt.state === 'unrecorded' || item.kind === 'proof' && item.receipt.state === 'upload_unknown' ? <Button variant="secondary" disabled={item.busy} onPress={() => item.run('neutralize')}>Neutraliser uniquement les effets non engagés de cette intention</Button> : null}
  {(item.kind === 'command' ? ['committed', 'not_executed'] : ['stored', 'stored_requires_review', 'not_executed']).includes(item.receipt.state) ?
    <Button variant="secondary" disabled={item.busy} onPress={() => item.run('acknowledge')}>Relire le reçu terminal puis terminer ce seul suivi local</Button> : null}
</View>;
/** SDK-owned tuples only: never reads a current business source or grants NEW. */
export function AdminRefundRepairHistory({uid}: {uid: string}) {
  const context = useLabelLifecycleContext('own-refund-repair-history', uid), client = useQueryClient();
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision]);
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null), lock = useRef<symbol | null>(null);
  const query = useQuery({queryKey: ['refund-repair-own', uid, key], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = context.capture(); return RefundRepairJournal.read(uid, () => context.assertCurrent(op));}});
  const manual = useQuery({queryKey: ['manual-refund-own', uid, key], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {const op = context.capture(), guard = () => context.assertCurrent(op); return {commands: await RefundRepairManualJournal.read(uid, guard), proofs: await RefundRepairManualJournal.readEvidence(uid, guard)};}});
  const manualReady = context.focused && manual.isSuccess && !manual.isFetching && !manual.isError;
  const runManual = async (row: Omit<ManualRow, 'busy' | 'run' | 'key'>, mode: 'observe' | 'recover' | 'neutralize' | 'acknowledge') => {
    if (!manualReady || lock.current) return; let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(key); const guard = () => context.assertCurrent(op);
    try {if (row.kind === 'command') {const a = row.attempt as RefundRepairManualAttempt;
      if (mode === 'acknowledge') await RefundRepairManualJournal.acknowledge(a, guard); else await RefundRepairManualJournal.service(a, mode, guard);
    } else {await RefundRepairManualJournal.evidenceService(row.attempt as RefundRepairManualEvidenceAttempt, mode === 'recover' ? 'observe' : mode, guard);} guard();
      await client.invalidateQueries({queryKey: ['manual-refund-own', uid]}); guard(); await client.invalidateQueries({queryKey: ['manual-refund-pending', uid]}); guard();
    } catch {if (context.isCurrent(op)) setNotice({key, text: 'Le même suivi manuel reste conservé. Aucun autre bénéficiaire, montant ou document n’est substitué.'});}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);} void manual.refetch();}
  };
  const manualRows: ManualRow[] = manualReady ? [
    ...manual.data.commands.map(v => ({kind: 'command' as const, ...v, key: `command:${v.attempt.requestId}`, busy: busy === key, run: (mode: 'observe' | 'recover' | 'neutralize' | 'acknowledge') => {void runManual({kind: 'command', ...v}, mode);}})),
    ...manual.data.proofs.map(v => ({kind: 'proof' as const, ...v, key: `proof:${v.attempt.requestId}`, busy: busy === key, run: (mode: 'observe' | 'recover' | 'neutralize' | 'acknowledge') => {void runManual({kind: 'proof', ...v}, mode);}}))] : [];
  const ready = context.focused && query.isSuccess && !query.isFetching && !query.isError;
  const run = useCallback(async (a: RefundRepairAttempt, mode: 'observe' | 'recover' | 'neutralize' | 'acknowledge') => {
    if (!ready || lock.current) return; let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(key); setNotice(null); const current = () => context.assertCurrent(op);
    try {if (mode === 'acknowledge') await RefundRepairJournal.acknowledge(a, current); else await RefundRepairJournal.service(a, mode, current); current();
      await client.invalidateQueries({queryKey: ['refund-repair-own', uid]}); current();
      if (mode === 'acknowledge') setNotice({key, text: 'Le reçu terminal exact a été relu avant de supprimer ce seul suivi local. Aucune nouvelle permission n’est accordée.'});
    } catch {if (context.isCurrent(op)) {setNotice({key, text: 'Le même tuple reste conservé. Relisez-le ou recherchez son résultat en lecture seule ; aucune nouvelle tentative n’est envoyée.'}); void query.refetch();}}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  }, [ready, context, key, client, uid, query]);
  const rows: Entry[] = ready ? query.data.map(e => ({...e, busy: busy === key, run: (a, mode) => {void run(a, mode);}})) : [];
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Mon suivi des réparations de remboursement</Text><Text style={styles.caption}>Ce suivi personnel reste accessible sans admission opérateur actuelle. La recherche relit uniquement la tentative native déjà réservée ; elle ne crée ni nouvel envoi d’argent, ni crédit de solde ou débit vendeur.</Text>
    <Button variant="secondary" disabled={!context.focused || query.isFetching || busy === key} onPress={() => {try {context.capture(); void query.refetch();} catch { /* Same SDK owner only. */ }}}>Relire mes intentions conservées</Button>
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal propre ne peut pas être qualifié. Son contenu reste conservé ; aucune autre intention n’est ouverte ici.</Text> : null}
    {ready && rows.length === 0 ? <Text style={styles.caption}>Aucune intention de réparation conservée pour ce compte.</Text> : null}
    {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={entryKey} renderItem={renderEntry} nestedScrollEnabled /></View> : null}
    <Text accessibilityRole="header" style={styles.title}>Mon suivi distinct des virements manuels</Text>
    <Text style={styles.caption}>Les références natives restent conservées sans coordonnées bancaires, fichiers ou référence de virement dans le journal local. Une attestation humaine n’est pas une confirmation Stripe.</Text>
    {manual.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le suivi manuel doit être relu ; aucune absence d’effet ne peut en être déduite.</Text> : null}
    {manualRows.length ? <View style={styles.list}><FlashList data={manualRows} keyExtractor={manualEntryKey} renderItem={renderManualEntry} nestedScrollEnabled /></View> : null}
    <Button variant="secondary" disabled={!context.focused || busy === key || manual.isFetching} onPress={() => {try {context.capture(); void manual.refetch();} catch { /* Own receipts only. */ }}}>Relire mes intentions et dépôts manuels</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 12}});
