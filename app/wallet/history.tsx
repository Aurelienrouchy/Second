import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Button, ScreenHeader, Text } from '@/components/ui';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { useAuthenticatedSession } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { getWalletHistoryPage, exportWalletHistory } from '@/features/wallet/services/walletHistoryService';
import type { WalletHistoryEntry, WalletHistoryPeriod, WalletHistorySource } from '@/types/walletHistory';
import { formatCents } from '@/utils/formatPrice';
import {readScopedQuery} from '@/utils/readScopedQuery';

const TYPE_LABELS: Record<string, string> = {
  sale_credit: 'Crédit de vente', sale_held: 'Fonds conservés', sale_released: 'Fonds libérés', funds_held: 'Fonds conservés', funds_released: 'Fonds libérés', purchase_debit: 'Débit d’achat',
  refund_credit: 'Crédit de remboursement', refund_debit: 'Débit de remboursement', refund_hold: 'Réserve de remboursement',
  withdrawal: 'Débit de retrait', withdrawal_debit: 'Débit de retrait', withdrawal_failed: 'Retour d’un retrait', dispute_hold: 'Gel de fonds',
  dispute_hold_released: 'Fin d’un gel de fonds', debt_repayment: 'Allocation à une dette', swap_top_up_credit: 'Crédit de complément Troc',
};
const keyExtractor = (entry: WalletHistoryEntry) => `${entry.source}:${entry.id}`;
const historyDateFormatter = new Intl.DateTimeFormat('fr-CA', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto',
});
function historyDate(value: string | null): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? historyDateFormatter.format(date) : 'Date indisponible';
}
function utcDay(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isSafeInteger(ms) && ms >= 0 && new Date(ms).toISOString().slice(0, 10) === text ? ms : null;
}
function periodLabel(period: WalletHistoryPeriod) {
  return period.fromMs === null ? 'Tout l’historique'
    : `Du ${new Date(period.fromMs).toISOString().slice(0, 10)} inclus au ${new Date(period.toMs!).toISOString().slice(0, 10)} exclu, UTC`;
}
const INTERNAL_MOVEMENTS = ['sale_held', 'sale_released', 'funds_held', 'funds_released', 'refund_hold', 'dispute_hold', 'dispute_hold_released'];
function refusedBeforeDebit(entry: WalletHistoryEntry): boolean {
  return entry.source === 'withdrawals' && entry.state === 'not_executed' && entry.operationState === 'not_executed' &&
    entry.proofQualification === 'qualified' && entry.bankDestination === null && entry.references.debitLedgerId === null &&
    entry.references.compensationLedgerId === null && entry.completionProof === null && entry.compensationProof === null &&
    entry.currency === 'CAD' && entry.amountCents !== null && Number.isSafeInteger(entry.amountCents) && entry.amountCents > 0;
}
export default function WalletHistoryScreen() {
  const router = useRouter();
  const { uid } = useAuthenticatedSession();
  const [source, setSource] = useState<WalletHistorySource>('ledger');
  const [period, setPeriod] = useState<WalletHistoryPeriod>({ fromMs: null, toMs: null });
  const [fromDraft, setFromDraft] = useState('');
  const [toDraft, setToDraft] = useState('');
  const [toolsVisible, setToolsVisible] = useState(false);
  const context = useShippingPurchaseContext(`wallet-history:${source}:${period.fromMs}:${period.toMs}`, uid);
  const scope = JSON.stringify([uid, getAuthSessionGeneration(), source, period.fromMs, period.toMs, context.focusRevision]);
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  const [progress, setProgress] = useState<{ scope: string; source: WalletHistorySource; pages: number; entries: number } | null>(null);
  const cancellation = useRef<symbol | null>(null);
  const appliedFrom = period.fromMs === null ? '' : new Date(period.fromMs).toISOString().slice(0, 10);
  const appliedTo = period.toMs === null ? '' : new Date(period.toMs).toISOString().slice(0, 10);
  const dirty = appliedFrom !== fromDraft || appliedTo !== toDraft;
  const history = useInfiniteQuery({
    queryKey: ['wallet-history', uid, getAuthSessionGeneration(), source, period.fromMs, period.toMs, context.focusRevision],
    initialPageParam: null as string | null, enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({pageParam, signal}) => readScopedQuery(signal, () => {
      const operation = context.capture();
      return () => context.assertCurrent(operation);
    }, current => getWalletHistoryPage(uid!, {source, period, cursor: pageParam, pageSize: 40}, current)),
    getNextPageParam: page => page.hasMore ? page.cursor : undefined,
  });
  const exportMutation = useMutation({ mutationFn: async () => {
    const operation = context.start(); if (!operation) return;
    const token = Symbol(); cancellation.current = token;
    const assertCurrent = () => {
      context.assertCurrent(operation);
      if (cancellation.current !== token) throw new Error('Export interrompu. Aucun fichier incomplet n’a été partagé.');
    };
    try {
      setNotice(null); setProgress(null);
      await exportWalletHistory(operation.session.uid, period, assertCurrent, (currentSource, pages, entries) => {
        assertCurrent(); setProgress({ scope, source: currentSource, pages, entries });
      });
      assertCurrent(); setNotice({ scope, text: 'Votre historique est prêt à être partagé.' });
    } catch (error) {
      if (context.isCurrent(operation)) setNotice({ scope, text: error instanceof Error ? error.message : 'Export interrompu. Aucun fichier incomplet n’a été partagé.' });
    } finally {
      if (cancellation.current === token) cancellation.current = null;
      context.finish(operation);
      if (context.isCurrent(operation)) setProgress(null);
    }
  } });
  const entries = [...new Map((history.data?.pages.flatMap(page => page.entries) ?? []).map(entry => [entry.id, entry])).values()];
  const renderItem = useCallback(({ item }: { item: WalletHistoryEntry }) => {
    const refused = refusedBeforeDebit(item);
    return (
    <View style={styles.entry}>
      <Text style={styles.entryTitle}>{item.source === 'ledger'
        ? item.type !== null && Object.prototype.hasOwnProperty.call(TYPE_LABELS, item.type) ? TYPE_LABELS[item.type] : 'Mouvement à vérifier'
        : refused ? 'Retrait refusé avant débit' : 'Demande de retrait'}</Text>
      {item.source === 'ledger' && item.type !== null && !Object.prototype.hasOwnProperty.call(TYPE_LABELS, item.type)
        ? <Text style={styles.meta}>Les détails de ce mouvement sont à vérifier.</Text> : null}
      <Text style={styles.meta}>{historyDate(item.createdAt)}</Text>
      <Text style={styles.amount}>{refused ? `Montant demandé : ${formatCents(item.amountCents!)} CAD` : item.amountCents === null ? 'Montant à vérifier'
        : item.currency === 'CAD' ? `${formatCents(item.amountCents)} CAD` : 'Montant à vérifier'}</Text>
      {item.source === 'ledger' ? <>
        {item.type && INTERNAL_MOVEMENTS.includes(item.type) ? <Text style={styles.meta}>Mouvement de vos fonds retenus.</Text> : null}
        {item.amountMeaning === 'debt_allocation' ? <Text style={styles.meta}>Montant affecté au remboursement d’une dette.</Text> : null}
        {item.type === 'refund_debit' && item.debtRecordedCents !== null ? <Text style={styles.meta}>{item.financialQualification === 'qualified' && item.currency === 'CAD'
          ? `Dette enregistrée : ${formatCents(item.debtRecordedCents)} CAD.`
          : 'Dette à vérifier.'}</Text> : null}
        {item.type === 'withdrawal' || item.type === 'withdrawal_debit' ? <Text style={styles.meta}>Le suivi de ce virement est disponible dans l’onglet Retraits.</Text> : null}
      </> : <>
        {refused ? <Text style={styles.meta}>Aucun débit ni virement engagé.</Text> : null}
        <Text style={styles.meta}>{item.state === 'completed' ? 'Virement traité' : item.state === 'failed' ? 'Virement échoué' : item.state === 'not_executed' ? 'Retrait non effectué' : item.state === 'pending' || item.state === 'processing' ? 'Retrait en cours' : 'État du retrait à vérifier'}</Text>
        {item.bankDestination ? <Text style={styles.meta}>Compte bancaire se terminant par {item.bankDestination.last4}.</Text> : null}
        {item.completionProof ? <Text style={styles.meta}>Virement traité le {historyDate(item.completionProof.observedAt)}. Vérifiez sa réception auprès de votre banque.</Text> : null}
        {item.compensationProof ? <Text style={styles.meta}>Montant rétabli dans votre porte-monnaie le {historyDate(item.compensationProof.recordedAt)} : {formatCents(item.compensationProof.amountCents)} CAD.</Text> : null}
      </>}
      {item.anomalies.length > 0 ? <Text style={styles.review}>Ce mouvement nécessite une vérification. Contactez l’assistance pour en savoir plus.</Text> : null}
    </View>
    );
  }, []);
  if (!uid) return <View style={styles.container}><ScreenHeader title="Historique" onBack={() => router.back()} /><Text style={styles.message}>Connectez-vous pour consulter votre historique.</Text></View>;
  return <View style={styles.container}>
    <ScreenHeader title="Historique" onBack={() => router.back()} />
    <FlashList data={entries} keyExtractor={keyExtractor} renderItem={renderItem} contentContainerStyle={styles.list}
      ListHeaderComponent={<View style={styles.header}>
        <View style={styles.sources}>
          {(['ledger', 'withdrawals'] as const).map(tab => <Pressable key={tab} accessibilityRole="tab"
            accessibilityState={{selected: source === tab, disabled: exportMutation.isPending}}
            style={[styles.sourceTab, source === tab && styles.sourceTabSelected]} disabled={exportMutation.isPending}
            onPress={() => {try {context.capture(); setSource(tab);} catch { /* An old screen cannot select private data. */ }}}>
            <Text style={[styles.sourceLabel, source === tab && styles.sourceLabelSelected]}>{tab === 'ledger' ? 'Mouvements' : 'Retraits'}</Text>
          </Pressable>)}
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{expanded: toolsVisible}}
          style={styles.toolsToggle} onPress={() => setToolsVisible(!toolsVisible)}>
          <Ionicons name="options-outline" size={spacing.md} color={colors.foregroundSecondary}/>
          <Text style={styles.meta}>Filtrer et exporter</Text>
          <Ionicons name={toolsVisible ? 'chevron-up' : 'chevron-down'} size={spacing.md} color={colors.muted}/>
        </Pressable>
        {period.fromMs !== null && !toolsVisible ? <Text style={styles.meta}>{periodLabel(period)}.</Text> : null}
        {toolsVisible ? <View style={styles.tools}>
        <Text style={styles.meta}>{periodLabel(period)}.</Text>
        <TextInput accessibilityLabel="Début inclus UTC, AAAA-MM-JJ" style={styles.input} placeholder="Début inclus UTC : AAAA-MM-JJ" placeholderTextColor={colors.muted}
          value={fromDraft} onChangeText={setFromDraft} editable={!exportMutation.isPending} autoCapitalize="none" />
        <TextInput accessibilityLabel="Fin exclue UTC, AAAA-MM-JJ" style={styles.input} placeholder="Fin exclue UTC : AAAA-MM-JJ" placeholderTextColor={colors.muted}
          value={toDraft} onChangeText={setToDraft} editable={!exportMutation.isPending} autoCapitalize="none" />
        <Button variant="secondary" disabled={exportMutation.isPending} onPress={() => {
          try { context.capture(); } catch { return; }
          const fromMs = utcDay(fromDraft), toMs = utcDay(toDraft);
          if (fromMs === null || toMs === null || fromMs >= toMs) { setNotice({ scope, text: 'Saisissez deux dates valides : début inclus et fin exclue, en UTC.' }); return; }
          setNotice(null); setPeriod({ fromMs, toMs });
        }}>Appliquer cette période</Button>
        <Button variant="ghost" disabled={exportMutation.isPending} onPress={() => {
          try { context.capture(); } catch { return; }
          setFromDraft(''); setToDraft(''); setNotice(null); setPeriod({ fromMs: null, toMs: null });
        }}>Consulter l’historique entier</Button>
        <Button disabled={exportMutation.isPending || dirty || !context.focused} onPress={() => { exportMutation.mutate(); }}>Exporter mon historique</Button>
        {dirty ? <Text style={styles.meta}>Appliquez les dates saisies avant d’exporter.</Text> : null}
        </View> : null}
        {progress?.scope === scope ? <Text style={styles.meta}>Préparation {progress.source === 'ledger' ? 'des mouvements' : 'des retraits'} : {progress.entries} opérations.</Text> : null}
        {exportMutation.isPending ? <Button variant="ghost" onPress={() => { cancellation.current = null; }}>Interrompre l’export</Button> : null}
        {notice?.scope === scope ? <Text accessibilityRole="alert" style={styles.message}>{notice.text}</Text> : null}
      </View>}
      ListEmptyComponent={<Text style={styles.message}>{history.isPending ? 'Chargement de l’historique…' : history.isError ? 'Impossible de charger l’historique.'
        : history.hasNextPage ? 'Aucune opération sur cette page. Chargez la suite de l’historique.' : 'Aucune opération pour cette période.'}</Text>}
      ListFooterComponent={<View style={styles.footer}>
        {history.isError ? <><Text style={styles.review}>Le chargement a été interrompu.</Text><Button variant="secondary" onPress={() => { void history.refetch(); }}>Réessayer</Button></> : null}
        {history.hasNextPage ? <Button variant="secondary" disabled={history.isFetchingNextPage || exportMutation.isPending} onPress={() => { void history.fetchNextPage(); }}>Charger la suite</Button> : null}
      </View>} />
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg },
  header: { gap: spacing.md, marginBottom: spacing.lg },
  sources: {flexDirection: 'row', gap: spacing.xs, padding: spacing.xs, backgroundColor: colors.surfaceWarm, borderRadius: radius.md},
  sourceTab: {flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.sm},
  sourceTabSelected: {backgroundColor: colors.surface},
  sourceLabel: {...typography.bodySmall, color: colors.muted},
  sourceLabelSelected: {color: colors.foreground},
  toolsToggle: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.sm},
  tools: {gap: spacing.md},
  input: { ...typography.body, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong, borderRadius: radius.md,
    padding: spacing.md, color: colors.foreground, backgroundColor: colors.surface },
  entry: { gap: spacing.sm, paddingVertical: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  entryTitle: { ...typography.label, color: colors.foreground },
  amount: { ...typography.titleHeader, color: colors.foreground },
  meta: { ...typography.bodySmall, color: colors.foregroundSecondary },
  review: { ...typography.bodySmall, color: colors.warning },
  message: { ...typography.body, color: colors.foreground, paddingVertical: spacing.md },
  footer: { gap: spacing.md, paddingVertical: spacing.lg },
});
