import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { formatCents } from '@/utils/formatPrice';
import { ExceptionalRestitutionJournal as Journal } from '@/services/exceptionalRestitutionJournal';
import type { ExceptionalRestitutionReference as Reference, ExceptionalRestitutionReceipt as Receipt, ExceptionalRestitutionEvidenceReceipt as EvidenceReceipt } from '@/types/exceptionalRestitution';
type Row = {reference: Reference; receipt: Receipt | EvidenceReceipt};
const rowKey = (v: Row) => v.reference.requestId;
const terminal = (row: Row) => (row.reference.kind === 'command' ? ['committed', 'not_executed'] : ['stored', 'stored_requires_review', 'not_executed']).includes(row.receipt.state);
/** Opaque own receipts remain accessible even after loss of current admin role. */
export function AdminExceptionalRestitutionHistory({uid}: {uid: string}) {
  const context = useLabelLifecycleContext('exceptional-restitution-history', uid), client = useQueryClient();
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision]), lock = useRef<symbol | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const query = useQuery({queryKey: ['exceptional-restitution-own', uid, key], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = context.capture(); return Journal.read(uid, () => context.assertCurrent(op));}});
  const ready = context.focused && query.isSuccess && !query.isFetching && !query.isError;
  const run = useCallback(async (reference: Reference, mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!ready || lock.current) return; let op; try {op = context.start();} catch {return;} if (!op) return; const token = Symbol(); lock.current = token; setBusy(true); setNotice(null);
    const current = () => context.assertCurrent(op);
    try {if (mode === 'acknowledge') await Journal.acknowledge(reference, current); else await Journal.service(reference, mode, current); current();
      await client.invalidateQueries({queryKey: ['exceptional-restitution-pending', uid]}); current();
    } catch {if (context.isCurrent(op)) setNotice({key, text: 'La référence d’origine reste conservée. Aucune absence d’effet ni permission nouvelle n’est déduite.'});}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(false);} void query.refetch();}
  }, [ready, context, client, key, query, uid]);
  const renderRow = useCallback(({item}: ListRenderItemInfo<Row>) => <View style={styles.section}>
  <Text selectable style={styles.caption}>Référence {item.reference.requestId} · dossier {item.reference.caseId}.</Text>
  <Text style={styles.body}>{item.receipt.state === 'committed' ? 'Décision humaine enregistrée. Ce reçu ne confirme aucun crédit bancaire ou remboursement Stripe.'
    : item.receipt.state === 'stored' ? 'Document privé conservé. Aucun contenu ou récit ne figure dans ce journal.'
      : item.receipt.state === 'stored_requires_review' ? 'Document conservé pour rapprochement ; aucun règlement supplémentaire n’est déduit.'
        : item.receipt.state === 'not_executed' ? 'La non-exécution de cette seule intention est enregistrée.' : 'Issue à relire. Aucun nouveau corps, document ou paiement n’est renvoyé.'}</Text>
  {item.reference.context.kind === 'refund_error' && item.reference.context.harm === 'seller_debt_compensation' && 'nativeWalletCredit' in item.receipt && item.receipt.nativeWalletCredit ?
    <Text style={styles.caption}>Crédit compensatoire interne natif : {formatCents(item.receipt.nativeWalletCredit.debtOffsetCents)} CAD imputés sur la dette courante et {formatCents(item.receipt.nativeWalletCredit.balanceCreditCents)} CAD ajoutés au solde. Aucun virement ou revenu de vente n’est attesté.</Text> : null}
  <Button variant="secondary" disabled={busy} onPress={() => run(item.reference, 'observe')}>Relire le même reçu exceptionnel</Button>
  {['unrecorded', 'upload_unknown'].includes(item.receipt.state) ? <Button variant="secondary" disabled={busy} onPress={() => run(item.reference, 'neutralize')}>Neutraliser uniquement cette intention non engagée</Button> : null}
  {terminal(item) ? <Button variant="secondary" disabled={busy} onPress={() => run(item.reference, 'acknowledge')}>Relire le reçu terminal puis terminer ce suivi local</Button> : null}
</View>, [busy, run]);
  const rows: Row[] = ready ? [...query.data.commands, ...query.data.evidence] : [];
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Mon suivi des restitutions exceptionnelles</Text>
    <Text style={styles.caption}>Ce journal conserve seulement les références natives. Les pièces, récits et références bancaires ne sont pas enregistrés localement. Après interruption, seule la même intention peut être relue ou neutralisée.</Text>
    <Button variant="secondary" disabled={!context.focused || busy || query.isFetching} onPress={() => {try {context.capture(); void query.refetch();} catch { /* Own receipt read only. */ }}}>Relire mes références exceptionnelles</Button>
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le suivi ne peut pas être qualifié. Ses références restent conservées.</Text> : null}
    {ready && !rows.length ? <Text style={styles.caption}>Aucune référence exceptionnelle conservée pour cette connexion.</Text> : null}
    {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={rowKey} renderItem={renderRow} nestedScrollEnabled /></View> : null}
    {notice?.key === key && context.focused ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 12}});
