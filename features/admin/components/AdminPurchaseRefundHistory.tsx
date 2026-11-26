import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {ConvenienceReturnJournal} from '@/services/convenienceReturnJournal';
import type {ConvenienceReturnIncidentAttempt, ConvenienceReturnIncidentReceipt} from '@/types/convenienceReturn';
import {colors, spacing, typography} from '@/constants/theme';
import {formatCents} from '@/utils/formatPrice';
import { AdminProductFinancialHistory } from './AdminProductFinancialHistory';
/** Same financial journals and fresh native receipts; no NEW permission in this entry. */
export function AdminPurchaseRefundHistory({uid, refreshKey = 0}: {uid: string; refreshKey?: number}) {
  const frame = useLabelLifecycleContext('own-convenience-return-incidents', uid), client = useQueryClient();
  const key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision, refreshKey]), queryKey = ['own-convenience-return-incidents', key];
  const query = useQuery({queryKey, enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = frame.capture(); return ConvenienceReturnJournal.readIncidents(uid, () => frame.assertCurrent(op));}});
  const ready = frame.focused && query.isSuccess && query.fetchStatus === 'idle' && !query.isError && client.getQueryState(queryKey)?.isInvalidated === false;
  const [results, setResults] = useState<{key: string; rows: Record<string, ConvenienceReturnIncidentReceipt>}>({key: '', rows: {}});
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null), [busy, setBusy] = useState<string | null>(null), lock = useRef(false);
  const run = async (attempt: ConvenienceReturnIncidentAttempt, mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!ready || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return; lock.current = true; setBusy(key);
    const current = () => {frame.assertCurrent(op); const state = client.getQueryState(queryKey);
      if (!state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.error !== null || state.isInvalidated || state.data !== query.data || state.dataUpdatedAt !== query.dataUpdatedAt) throw new Error('Votre journal doit être relu.');};
    try {current(); const receipt = await (mode === 'observe' ? ConvenienceReturnJournal.observeIncident : mode === 'neutralize' ? ConvenienceReturnJournal.neutralizeIncident : ConvenienceReturnJournal.acknowledgeIncident)(attempt, current); current();
      setResults(old => ({key, rows: {...(old.key === key ? old.rows : {}), [attempt.requestId]: receipt}}));
      setNotice({key, text: mode === 'acknowledge' ? 'Le reçu natif exact a été relu et cette intention locale acquittée. Aucune nouvelle action n’a été exécutée.' : 'Le reçu propre de cette intention a été relu ; aucune nouvelle instruction n’est envoyée.'});
      if (mode === 'acknowledge') void query.refetch();
    } catch (e) {if (frame.isCurrent(op)) setNotice({key, text: `${e instanceof Error ? e.message : 'Résultat inconnu.'} L’intention exacte reste conservée.`});}
    finally {if (frame.isCurrent(op)) setBusy(null); frame.finish(op); lock.current = false;}
  };
  return <><AdminProductFinancialHistory uid={uid} refreshKey={refreshKey} allocationOnly />
    <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Mes instructions d’incident de retour conservées</Text><Text style={styles.caption}>Ces références appartiennent à votre session. Leur relecture et leur neutralisation n’exigent pas de nouveau rôle opérateur ; elles ne donnent aucune permission nouvelle.</Text>
      {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal propre ne peut pas être qualifié. Aucune intention n’est supprimée ni renvoyée.</Text> : null}
      {ready ? query.data.map(attempt => {const receipt = results.key === key ? results.rows[attempt.requestId] : null; return <View key={attempt.requestId} style={styles.section}>
        <Text selectable style={styles.caption}>Commande {attempt.transactionId} · intention {attempt.requestId} · {attempt.command.action === 'close_unfurnished_return' ? 'clôture avant fourniture' : 'rapprochement du coût réel'}.</Text>
        <Text style={styles.caption}>{receipt ? receipt.state === 'committed' ? 'Instruction enregistrée dans son reçu natif.' : receipt.state === 'absent' ? 'Reçu non enregistré : résultat encore inconnu.' : receipt.state === 'neutralized' ? 'Intention neutralisée avant exécution.' : 'Cette intention n’a pas été exécutée.' : 'Résultat à relire ; aucun envoi automatique.'}</Text>
        {receipt?.result?.kind === 'closed' ? <Text style={styles.caption}>{receipt.result.providerOutcome === 'purchased_unfurnished' ? 'L’acquisition de cette étiquette est prouvée, mais son document n’a pas été fourni. Seconde assume son coût.' : receipt.result.providerOutcome === 'unknown' ? 'Le résultat fournisseur reste inconnu. Seconde assume le risque du coût éventuel ; aucune absence d’achat n’est attestée.' : receipt.result.providerOutcome === 'validation_rejected' ? 'La validation fournisseur de cette seule tentative a été rejetée.' : 'Cette tentative est clôturée avant invocation d’achat.'} Aucun remboursement ni mouvement de fonds n’est exécuté par cette instruction.</Text> : null}
        {receipt?.result?.kind === 'variance_adopted' ? <Text style={styles.caption}>Prix article {formatCents(receipt.result.grossArticleCents)} · plafond accepté {formatCents(receipt.result.acceptedCostCents)} · coût réel {formatCents(receipt.result.actualCostCents)} · déduction effective {formatCents(receipt.result.deductionCents)} · net acheteur {formatCents(receipt.result.netRefundCents)} · écart Seconde {formatCents(receipt.result.platformVarianceCents)}. Aucun versement n’est prouvé.</Text> : null}
        <Button variant="secondary" disabled={busy === key} onPress={() => void run(attempt, 'observe')}>Relire ce reçu exact</Button>
        {receipt?.state === 'absent' ? <Button variant="secondary" disabled={busy === key} onPress={() => void run(attempt, 'neutralize')}>Neutraliser cette intention avant exécution</Button> : null}
        {receipt && receipt.state !== 'absent' ? <Button variant="secondary" disabled={busy === key} onPress={() => void run(attempt, 'acknowledge')}>Relire le reçu définitif et acquitter</Button> : null}
      </View>;}) : null}
      <Button variant="ghost" disabled={!frame.focused || busy === key} onPress={() => {try {frame.capture(); void query.refetch();} catch { /* A stale owner cannot reread another journal. */ }}}>Relire mes références d’incident</Button>
      {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    </View></>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
