import { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransactionService } from '@/services/transactionService';
import { readAdminFinancialAttempts, acknowledgeAdminFinancialAttempt, type AdminFinancialAttempt, type AdminFinancialDecision } from '@/services/adminFinancialDecisionJournal';
const attemptKey = (a: AdminFinancialAttempt) => a.requestId;
export function AdminTransportFinancialHistory({uid}: {uid: string}) {
  const context = useShippingPurchaseContext('own-transport-financial-history', uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision]);
  const lock = useRef<symbol | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{key: string; attempt: AdminFinancialAttempt; receipt: AdminFinancialDecision} | null>(null);
  const [message, setMessage] = useState<{key: string; text: string} | null>(null);
  const journal = useQuery({queryKey: ['own-transport-financial-history', key], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = context.capture(); return readAdminFinancialAttempts(uid, () => context.assertCurrent(op));}});
  const ready = context.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const attempts = ready ? journal.data.filter(a => !!a.transportReview) : [];
  const current = ready && result?.key === key ? result : null;
  const run = async (attempt: AdminFinancialAttempt, mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!ready || lock.current || attempt.adminUid !== uid || !attempt.transportReview) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(key); setMessage(null);
    try {const receipt = await TransactionService.adminRefundTransaction(attempt, () => context.assertCurrent(op), mode === 'acknowledge' ? 'observe' : mode); context.assertCurrent(op);
      if (mode === 'acknowledge') {if (receipt.outcome === 'unrecorded') throw new Error('Reçu requis.'); await acknowledgeAdminFinancialAttempt(attempt, receipt, () => context.assertCurrent(op)); context.assertCurrent(op);}
      await journal.refetch(); context.assertCurrent(op); setResult(mode === 'acknowledge' ? null : {key, attempt, receipt});
      if (mode === 'acknowledge') setMessage({key, text: 'Le reçu natif exact a été relu avant de terminer ce suivi local.'});
    } catch {if (context.isCurrent(op)) setMessage({key, text: 'Le résultat reste à vérifier. La même intention et ses sources sont conservées ; aucune nouvelle instruction financière n’est disponible ici.'});}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  const renderAttempt = ({item: a}: ListRenderItemInfo<AdminFinancialAttempt>) => <View style={styles.section}>
    <Text selectable style={styles.caption}>Référence propre : {a.requestId} · commande : {a.transactionId}</Text><Text selectable style={styles.body}>Note d’origine conservée : {a.note}</Text>
    <Text style={styles.caption}>Ces informations locales ne certifient pas un résultat natif ou une permission actuelle.</Text>
    <Button variant="secondary" disabled={busy === key} onPress={() => {void run(a, 'observe');}}>Relire le reçu de cette intention exacte</Button>
  </View>;
  return <ScrollView contentContainerStyle={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Suivi de vos intentions de transport conservées</Text>
    <Text style={styles.caption}>L’admission opérateur actuelle n’est pas qualifiée. Ce panneau permet uniquement de suivre votre propre intention et son reçu. Aucun dossier, aperçu actuel ou nouvelle instruction financière n’est ouvert.</Text>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal SDK propre ne peut pas être relu.</Text> : null}
    <Button variant="secondary" disabled={!context.focused || journal.isFetching} onPress={() => {void journal.refetch();}}>Relire votre journal</Button>
    {ready && !attempts.length ? <Text style={styles.caption}>Aucune intention de transport conservée pour cette session.</Text> : null}
    {attempts.length ? <View style={styles.list}><FlashList data={attempts} keyExtractor={attemptKey} renderItem={renderAttempt} nestedScrollEnabled /></View> : null}
    {current ? <View style={styles.section}>
      <Text style={styles.body}>{current.receipt.outcome === 'unrecorded' ? 'Aucun reçu natif enregistré ; l’intention reste conservée.' : current.receipt.outcome === 'not_executed' ? 'La non-exécution native est enregistrée. Elle ne crée aucun remboursement.' :
        current.receipt.financial.success ? 'La décision et son règlement d’origine sont enregistrés. Un crédit bancaire n’est pas certifié.' : 'La décision est engagée ; son règlement d’origine reste à vérifier.'}</Text>
      <Text style={styles.caption}>Ce résultat propre reste historique. Il n’autorise ni nouvelle tentative, nouvelle réservation, sortie de fonds ou remise en vente.</Text>
      {current.receipt.outcome === 'unrecorded' ? <Button variant="secondary" disabled={busy === key} onPress={() => Alert.alert('Neutraliser cette intention',
        'La même référence bloque une exécution tardive non engagée. Une décision déjà engagée reste conservée avec son reçu.', [{text: 'Retour', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void run(current.attempt, 'neutralize');}}])}>Neutraliser cette intention non engagée</Button> :
        <Button variant="secondary" disabled={busy === key} onPress={() => {void run(current.attempt, 'acknowledge');}}>Terminer ce suivi après nouvelle lecture native</Button>}
    </View> : null}
    {message?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{message.text}</Text> : null}
  </ScrollView>;
}
const styles = StyleSheet.create({section: {padding: spacing.md, gap: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 9}});
