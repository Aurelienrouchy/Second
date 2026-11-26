import { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransactionService } from '@/services/transactionService';
import { readAdminFinancialAttempts, acknowledgeAdminFinancialAttempt, type AdminFinancialAttempt, type AdminFinancialDecision } from '@/services/adminFinancialDecisionJournal';
import { readDisputeResolutionAttempts, acknowledgeDisputeResolution, type DisputeResolutionAttempt, type DisputeResolutionOutcome } from '@/services/disputeResolutionJournal';
import { PurchaseRefundTermsSummary } from '@/components/PurchaseRefundTermsSummary';
type Row = {kind: 'refund'; attempt: AdminFinancialAttempt} | {kind: 'dismissed'; attempt: DisputeResolutionAttempt};
type Result = {key: string; kind: 'refund'; attempt: AdminFinancialAttempt; receipt: AdminFinancialDecision} |
  {key: string; kind: 'dismissed'; attempt: DisputeResolutionAttempt; receipt: DisputeResolutionOutcome};
const rowKey = (r: Row) => `${r.kind}:${r.attempt.requestId}`;
/** SDK identity only. No current business source, proof image or NEW action exists in this panel. */
export function AdminProductFinancialHistory({uid, refreshKey = 0, allocationOnly = false}: {uid: string; refreshKey?: number; allocationOnly?: boolean}) {
  const context = useLabelLifecycleContext(allocationOnly ? 'own-purchase-refund-financial-history' : 'own-product-financial-history', uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision]);
  const lock = useRef<symbol | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const journal = useQuery({queryKey: [allocationOnly ? 'own-purchase-refund-financial-history' : 'own-product-financial-history', key, refreshKey], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {const op = context.capture(); const [refunds, dismissals] = await Promise.all([readAdminFinancialAttempts(uid, () => context.assertCurrent(op)), readDisputeResolutionAttempts(uid, () => context.assertCurrent(op))]);
      context.assertCurrent(op); const rows: Row[] = [...refunds.filter(a => allocationOnly ? !!a.allocation : !!a.productReview).map(attempt => ({kind: 'refund' as const, attempt})),
        ...dismissals.filter(a => allocationOnly ? !!a.allocation : !!a.productReview).map(attempt => ({kind: 'dismissed' as const, attempt}))]; return rows;}});
  const ready = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const rows = ready ? journal.data : [], current = ready && result?.key === key ? result : null;
  const run = useCallback(async (row: Row, action: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!ready || lock.current || row.attempt.adminUid !== uid || !(allocationOnly ? row.attempt.allocation : row.attempt.productReview)) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(key); setNotice(null);
    try {
      const assertCurrent = () => context.assertCurrent(op), mode = action === 'acknowledge' ? 'observe' : action;
      if (row.kind === 'refund') {
        const receipt = await TransactionService.adminRefundTransaction(row.attempt, assertCurrent, mode); assertCurrent();
        if (action === 'acknowledge') {await acknowledgeAdminFinancialAttempt(row.attempt, receipt, assertCurrent); assertCurrent(); setResult(null);}
        else setResult({key, kind: row.kind, attempt: row.attempt, receipt});
      } else {
        const receipt = await TransactionService.resolveDispute(row.attempt, assertCurrent, mode); assertCurrent();
        if (action === 'acknowledge') {await acknowledgeDisputeResolution(row.attempt, receipt, assertCurrent); assertCurrent(); setResult(null);}
        else setResult({key, kind: row.kind, attempt: row.attempt, receipt});
      }
      await journal.refetch(); assertCurrent();
      if (action === 'acknowledge') setNotice({key, text: 'Le même reçu natif a été relu avant de terminer ce suivi local.'});
    } catch {if (context.isCurrent(op)) setNotice({key, text: 'Le résultat doit être retrouvé avec les mêmes références. Aucune nouvelle instruction financière ou source métier n’est ouverte ici.'});}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  }, [ready, uid, context, key, journal, allocationOnly]);
  const render = useCallback(({item}: ListRenderItemInfo<Row>) => <View style={styles.section}>
    <Text style={styles.body}>{item.kind === 'refund' ? item.attempt.resume ? 'Autorisation de reprise conservée' : 'Instruction financière conservée' : 'Intention de classement conservée'}.</Text>
    <Text selectable style={styles.caption}>Commande {item.attempt.transactionId} · référence {item.attempt.requestId}.</Text>
    <Text selectable style={styles.body}>Note d’origine : {item.attempt.note}</Text>
    {item.attempt.allocation ? <PurchaseRefundTermsSummary terms={item.attempt.allocation.terms} /> : null}
    <Text style={styles.caption}>Ces informations locales ne prouvent pas un résultat ou une permission actuelle.</Text>
    <Button variant="secondary" disabled={busy === key} onPress={() => {void run(item, 'observe');}}>Relire le reçu de cette intention exacte</Button>
  </View>, [busy, key, run]);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>{allocationOnly ? 'Suivi de mes décisions sur le remboursement restant' : 'Suivi de vos intentions financières sur les produits'}</Text>
    <Text style={styles.caption}>Seuls vos journaux SDK propres et leurs reçus sont consultés ici. Leur suivi reste accessible sans admission opérateur actuelle ; aucun nouveau classement, dossier, aperçu ou fichier privé d’une autre partie n’est ouvert.</Text>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal SDK propre ne peut pas être relu.</Text> : null}
    <Button variant="secondary" disabled={!context.focused || journal.isFetching || busy === key} onPress={() => {void journal.refetch();}}>Relire mes intentions conservées</Button>
    {ready && !rows.length ? <Text style={styles.caption}>Aucune intention financière sur un produit conservée pour cette identité.</Text> : null}
    {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={rowKey} renderItem={render} nestedScrollEnabled /></View> : null}
    {current ? <View style={styles.section}>
      <Text style={styles.body}>{current.receipt.outcome === 'unrecorded' ? 'Aucun reçu natif enregistré. Cette absence ne prouve pas une non-exécution.' : current.receipt.outcome === 'not_executed' ?
        'La non-exécution native est enregistrée pour cette intention.' : current.kind === 'refund' && current.receipt.outcome === 'reserved' ?
          current.receipt.financial.success ? 'L’instruction et son règlement d’origine sont enregistrés ; le crédit bancaire reste non certifié.' : 'L’instruction est engagée ; son règlement d’origine reste à suivre.' : 'Le classement du dossier exact est enregistré.'}</Text>
      <Text style={styles.caption}>Ce reçu propre reste historique. Il ne certifie pas l’authenticité et n’autorise aucun nouveau mouvement ou remise en vente.</Text>
      {current.receipt.outcome === 'unrecorded' ? <Button variant="secondary" disabled={busy === key} onPress={() => Alert.alert('Neutraliser cette intention exacte',
        'La référence d’origine bloque les effets non engagés d’une requête tardive. Une décision déjà engagée reste conservée avec son reçu.', [{text: 'Retour', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void run(current, 'neutralize');}}])}>Neutraliser cette intention non engagée</Button> :
        <Button variant="secondary" disabled={busy === key} onPress={() => {void run(current, 'acknowledge');}}>Relire le reçu puis terminer ce suivi local</Button>}
    </View> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, padding: spacing.md}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 9}});
