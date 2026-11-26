import { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransportReviewService } from '@/services/transportReviewService';
import type { LabelDepositReviewCapability, TransportReviewAttempt, TransportReviewCommand, TransportReviewReceipt, TransportReviewRefusal } from '@/types/transportReview';
const reasons: Record<TransportReviewRefusal, string> = {command_neutralized: 'L’intention a été neutralisée avant son exécution.', source_changed: 'Une source a changé. Un nouvel examen explicite est nécessaire.',
  transport_context_unqualified: 'Le contexte de transport ne peut pas être qualifié.', historical_source_unqualified: 'La source historique doit être rapprochée.', preview_unqualified: 'L’aperçu exact ne peut pas être qualifié.',
  inquiry_capacity_requires_review: 'Ce dossier demande un examen supplémentaire avant une autre démarche.', review_already_resolved: 'Ce dossier comporte déjà une décision.',
  delivery_correction_source_unqualified: 'Les preuves et la situation financière ne qualifient pas cette résolution de correction.', carrier_exception_source_unqualified: 'Les sources ne qualifient pas cette décision sur l’exception du transporteur.',
  deadline_inquiry_only: 'Cette revue de délai autorise uniquement une démarche ou une clôture documentaire.', deadline_source_changed_or_unknown: 'Le délai, l’étiquette ou le manifeste ne qualifie plus cette clôture documentaire.'};
export function TransportReviewCommandPanel({uid, transactionId, sourceKey, command, enabled, onSubmitted, onRecorded, capability, assertNewCurrent}: {uid: string; transactionId: string; sourceKey: string;
  command: TransportReviewCommand | null; enabled: boolean; onSubmitted: () => void; onRecorded: () => void; capability?: LabelDepositReviewCapability; assertNewCurrent?: () => void}) {
  const base = useLabelLifecycleContext(JSON.stringify(['transport-review-journal', transactionId]), uid);
  const fresh = useLabelLifecycleContext(JSON.stringify(['transport-review-send', transactionId, sourceKey, command]), uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, base.focusRevision]);
  const lock = useRef<symbol | null>(null), [busy, setBusy] = useState<string | null>(null);
  const interaction = useRef(0);
  const [result, setResult] = useState<{key: string; attempt: TransportReviewAttempt; receipt: TransportReviewReceipt} | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const pending = useQuery({queryKey: ['transport-review-journal', key], enabled: base.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = base.capture(); return TransportReviewService.pending(uid, () => base.assertCurrent(op));}});
  const ready = base.focused && pending.isSuccess && !pending.isFetching && !pending.isError;
  const attempts = ready ? pending.data.filter(a => a.command.transactionId === transactionId) : [];
  const current = ready && result?.key === key ? result : null;
  const working = busy === key;
  const run = async (a: TransportReviewAttempt, mode: 'execute' | 'observe' | 'neutralize' | 'acknowledge', resume = false) => {
    if (!ready || lock.current || a.uid !== uid || a.command.transactionId !== transactionId || mode === 'execute' && !resume && (!enabled || !command || JSON.stringify(a.command) !== JSON.stringify(command) || a.capability !== capability)) return;
    let op, freshOp; try {op = base.start(); if (!op) return; freshOp = mode === 'execute' && !resume ? fresh.capture() : null;} catch {if (op) base.finish(op); return;}
    const token = Symbol(); lock.current = token; setBusy(key); setNotice(null);
    const epoch = ++interaction.current;
    const assertCurrent = () => {base.assertCurrent(op); if ((capability || a.capability) && interaction.current !== epoch) throw new Error('Cette lecture du journal a changé.'); if (freshOp) {fresh.assertCurrent(freshOp); if (capability) assertNewCurrent?.();}};
    try {const receipt = mode === 'execute' ? await TransportReviewService.execute(a, assertCurrent) : mode === 'observe' ? await TransportReviewService.observe(a, assertCurrent) :
      mode === 'neutralize' ? await TransportReviewService.neutralize(a, assertCurrent) : await TransportReviewService.acknowledge(a, assertCurrent);
      assertCurrent(); await pending.refetch(); assertCurrent(); setResult(mode === 'acknowledge' ? null : {key, attempt: a, receipt}); onSubmitted();
      if (receipt.state === 'committed' && mode !== 'acknowledge') onRecorded();
      if (mode === 'acknowledge') setNotice({key, text: 'Le reçu exact a été relu avant de terminer le suivi local. Toute nouvelle source exige un nouvel examen.'});
    } catch {try {assertCurrent(); onSubmitted(); setNotice({key, text: 'Résultat à vérifier. La même intention et ses sources restent conservées. Relisez-la ou neutralisez-la explicitement avant une nouvelle intention.'}); void pending.refetch();} catch { /* Durable intention stays independent of new admission. */ }}
    finally {base.finish(op); if (lock.current === token) {lock.current = null; if (base.isCurrent(op)) setBusy(null);}}
  };
  if (!base.focused) return null;
  return <View style={styles.section}>
    {pending.isError ? <><Text accessibilityRole="alert" style={styles.caption}>Le suivi local doit être relu avant une nouvelle intention.</Text><Button variant="secondary" onPress={() => {void pending.refetch();}}>Relire le suivi local</Button></> : null}
    {attempts.map(a => <View style={styles.section} key={a.requestId}><Text style={styles.body}>Une intention de transport reste conservée pour cette commande.</Text>
      <Text style={styles.caption}>{a.command.action === 'report_transit' ? a.command.narrative : 'Décision opérateur liée aux sources examinées.'}</Text>
      <Button variant="secondary" disabled={working} onPress={() => {void run(a, 'observe');}}>Relire cette intention exacte</Button>
      {a.capability ? <><Text style={styles.caption}>Requête : {a.requestId} · source d’origine : {a.command.source.sourceHash}. La reprise conserve exactement cette référence et cette version ; le serveur requalifiera toute exécution encore non engagée.</Text><Button variant="secondary" disabled={working} onPress={() => {void run(a, 'execute', true);}}>Reprendre exactement cette intention conservée</Button></> : null}</View>)}
    {ready && !attempts.length && enabled && command ? <Button variant="secondary" disabled={working || !fresh.focused}
      onPress={() => {void run({version: 1, uid, requestId: randomUUID(), command, ...(capability ? {capability} : {})}, 'execute');}}>Enregistrer cette intention exacte</Button> : null}
    {current ? <View style={styles.section}><Text style={styles.body}>{current.receipt.state === 'committed' ? 'Le reçu natif confirme l’enregistrement pour les sources d’origine.' :
      current.receipt.state === 'unrecorded' ? 'Aucun reçu natif enregistré. L’intention reste conservée.' : reasons[current.receipt.reason!]}</Text>
      <Text style={styles.caption}>Ce reçu n’autorise aucun remboursement, mouvement de fonds ou remise en vente.</Text>
      {current.receipt.state === 'unrecorded' ? <Button variant="secondary" disabled={working} onPress={() => {
        let op; try {op = base.capture();} catch {return;} const epoch = ++interaction.current;
        Alert.alert('Neutraliser cette intention', 'La même référence sera conservée pour empêcher une exécution tardive non engagée. Un résultat déjà enregistré conserve son reçu.', [{text: 'Retour', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {try {base.assertCurrent(op); if ((capability || current.attempt.capability) && interaction.current !== epoch) return; void run(current.attempt, 'neutralize');} catch { /* Late native alert has no new permission. */ }}}]);
      }}>Neutraliser cette intention non engagée</Button> :
        <Button variant="secondary" disabled={working} onPress={() => {void run(current.attempt, 'acknowledge');}}>Terminer ce suivi après une nouvelle lecture native</Button>}
    </View> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
