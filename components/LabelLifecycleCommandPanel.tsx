import { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { LabelLifecycleReauthentication } from '@/components/LabelLifecycleReauthentication';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { LabelLifecycleJournal } from '@/services/labelLifecycleJournal';
import { productReviewEqual } from '@/services/productReviewService';
import type { LabelLifecycleCommand, LabelLifecycleContext } from '@/types/labelLifecycle';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
/** Only a freshly observed own receipt is rendered. An escaped operation keeps its exact journal. */
export function LabelLifecycleCommandPanel({uid, context, draft = null, verifyNew, onRecorded, onSourceError}: {uid: string; context: LabelLifecycleContext; draft?: LabelLifecycleCommand | null; verifyNew?: () => Promise<() => void>; onRecorded?: () => void; onSourceError?: () => void}) {
  const frame = useLabelLifecycleContext(`label-lifecycle-command:${context.transactionId}:${context.leg}`, uid), client = useQueryClient(), lock = useRef(false);
  const key = JSON.stringify([uid, context, getAuthSessionGeneration(), frame.focusRevision]), journalKey = ['label-lifecycle-intent', key];
  const pending = useQuery({queryKey: journalKey, enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = frame.capture(); return LabelLifecycleJournal.pending(uid, context, () => frame.assertCurrent(op));}});
  const saved = frame.focused && pending.isSuccess && !pending.isFetching && !pending.error ? pending.data : null;
  const receiptKey = ['label-lifecycle-receipt', key, saved?.requestId ?? ''];
  const native = useQuery({queryKey: receiptKey, enabled: !!saved && frame.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {if (!saved) throw new Error('Relisez le journal.'); const op = frame.capture(); return LabelLifecycleJournal.run(saved, 'observe', () => frame.assertCurrent(op));}});
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<{key: string; text: string} | null>(null), [confirmed, setConfirmed] = useState<string | null>(null), [recent, setRecent] = useState<string | null>(null);
  const receipt = saved && busy !== key && native.isSuccess && !native.isFetching && !native.error && native.data.requestId === saved.requestId && productReviewEqual(native.data.command, saved.command) ? native.data : null;
  const resumeKey = saved ? JSON.stringify([key, saved.requestId, saved.command]) : '', freshKey = draft ? JSON.stringify([key, draft]) : '';
  const selected = saved?.command ?? draft, needsAdmin = selected?.scope === 'admin';
  const resumeNeedsRecent = needsAdmin && receipt?.state === 'unrecorded';
  const perform = async (action: 'execute' | 'observe' | 'neutralize' | 'recover' | 'ack', fresh = false) => {
    if (!frame.focused || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(key); setError(null); let newFence: (() => void) | null = null;
    const current = () => {frame.assertCurrent(op); newFence?.();};
    try {
      let attempt = saved;
      if (action === 'execute') {
        if (fresh) {if (!draft || !verifyNew || !pending.isSuccess || pending.isFetching || pending.error || pending.data !== null || needsAdmin && recent !== freshKey) throw new Error('Examinez et confirmez les sources actuelles.'); newFence = await verifyNew(); current(); attempt = await LabelLifecycleJournal.stage(uid, draft, current); current(); client.setQueryData(journalKey, attempt);}
        else {
          if (!attempt || receipt?.state !== 'unrecorded' || !draft || !verifyNew || !productReviewEqual(attempt.command, draft) || confirmed !== resumeKey || resumeNeedsRecent && recent !== resumeKey) throw new Error('Réexaminez les sources et confirmez cette même intention non engagée.');
          newFence = await verifyNew(); current();
        }
      }
      if (action === 'recover' && (!receipt || !['reserved', 'reconciliation_required'].includes(receipt.state) || confirmed !== resumeKey)) throw new Error('Relisez et confirmez le suivi exact de l’effet engagé.');
      if (!attempt) throw new Error('Votre intention exacte ne peut pas être relue.');
      const result = action === 'ack' ? await LabelLifecycleJournal.acknowledge(attempt, current) : await LabelLifecycleJournal.run(attempt, action, current); current();
      setConfirmed(null); setRecent(null);
      if (action === 'ack') client.setQueryData(journalKey, null);
      await client.invalidateQueries({queryKey: ['label-lifecycle-receipt', key]}); current();
      if (result.state === 'committed') onRecorded?.();
      if (result.state === 'not_executed' && result.reason !== 'requester_neutralized') onSourceError?.();
    } catch (e) {if (frame.isCurrent(op)) {setError({key, text: e instanceof Error ? e.message : 'Le résultat est inconnu. Votre journal exact est conservé.'}); if (action === 'execute') onSourceError?.();}}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) {setBusy(null); void pending.refetch(); void native.refetch();}}
  };
  if (!frame.focused) return null;
  return <View style={styles.section}><Text style={styles.title}>Mon intention d’étiquette</Text>
    {pending.isPending || pending.isFetching ? <Text style={styles.caption}>Lecture du journal personnel…</Text> : pending.error ? <Text accessibilityRole="alert" style={styles.body}>Votre journal ne peut pas être qualifié. Aucun nouvel achat n’est permis.</Text> : null}
    <Button variant="secondary" disabled={busy === key || pending.isFetching} onPress={() => {void pending.refetch();}}>Relire mon journal</Button>
    {saved ? <><Text selectable style={styles.caption}>Commande {context.transactionId} · {context.leg === 'forward' ? 'aller' : 'retour'} · référence {saved.requestId}.</Text>
      <Text selectable style={styles.body}>Instruction d’origine : {saved.command.message}</Text><Text style={styles.caption}>Cette intention conserve ses références, son devis et son autorisation de coût d’origine ; elle n’est jamais recréée à partir de l’aperçu récent.</Text>
      {native.isFetching || native.isPending ? <Text style={styles.caption}>Relecture native du reçu exact…</Text> : native.error ? <Text accessibilityRole="alert" style={styles.body}>Le reçu reste inconnu ; votre journal est conservé.</Text> : null}
      {receipt ? <><Text style={styles.body}>{receipt.state === 'committed' ? 'Cette instruction ou observation a été enregistrée.' : receipt.state === 'not_executed' ? 'La non-exécution native est enregistrée.' : receipt.state === 'reserved' ? 'L’opération est engagée ; son résultat reste à suivre.' : receipt.state === 'reconciliation_required' ? 'Le résultat exige un rapprochement ; aucune seconde intention payante ne doit être créée.' : 'Aucun reçu natif trouvé ; cela ne prouve pas une non-exécution.'}</Text>
        {receipt.recordedAt ? <Text style={styles.caption}>Enregistré le {new Date(receipt.recordedAt).toLocaleString(APP_LOCALE)}.</Text> : null}
        {receipt.reason ? <Text selectable style={styles.caption}>Motif natif : {receipt.reason}</Text> : null}</> : null}
      <Button variant="secondary" disabled={busy === key || native.isFetching} onPress={() => {void perform('observe');}}>Relire mon reçu exact</Button>
      {needsAdmin ? <LabelLifecycleReauthentication key={resumeKey} uid={uid} sourceKey={resumeKey} disabled={busy === key} onVerified={() => setRecent(resumeKey)} /> : null}
      <Checkbox checked={confirmed === resumeKey} onToggle={() => setConfirmed(confirmed === resumeKey ? null : resumeKey)}><Text style={styles.body}>Je demande la reprise de cette même intention exacte. Les preuves d’un effet engagé sont recherchées d’abord ; tout effet encore nouveau exige de nouveau l’autorité et les gardes serveur. Une absence de résultat n’autorise pas un autre achat.</Text></Checkbox>
      {receipt && ['reserved', 'reconciliation_required'].includes(receipt.state) ? <Button variant="secondary" disabled={busy === key || confirmed !== resumeKey} onPress={() => {void perform('recover');}}>Retrouver l’effet engagé sans nouvelle opération</Button> : <Button variant="secondary" disabled={busy === key || receipt?.state !== 'unrecorded' || !draft || !productReviewEqual(saved.command, draft) || confirmed !== resumeKey || resumeNeedsRecent && recent !== resumeKey} onPress={() => {void perform('execute');}}>Envoyer cette même intention après nouvel examen</Button>}
      <Button variant="secondary" disabled={busy === key || !receipt || ['committed', 'not_executed'].includes(receipt.state)} onPress={() => Alert.alert('Neutraliser cette intention', 'Le serveur vérifie qu’aucune opération n’est partie avant de bloquer un effet encore non engagé. Tout vrai effet ou résultat inconnu reste conservé. Cela ne rembourse pas et n’annule pas une étiquette.', [{text: 'Conserver', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void perform('neutralize');}}])}>Neutraliser si l’opération n’est pas partie</Button>
      <Button variant="secondary" disabled={busy === key || !receipt || !['committed', 'not_executed'].includes(receipt.state)} onPress={() => {void perform('ack');}}>Terminer ce suivi après relecture native</Button>
    </> : pending.isSuccess && !pending.isFetching && !pending.error ? <>{needsAdmin && draft ? <LabelLifecycleReauthentication key={freshKey} uid={uid} sourceKey={freshKey} disabled={busy === key} onVerified={() => setRecent(freshKey)} /> : null}<Button disabled={busy === key || !draft || needsAdmin && recent !== freshKey} onPress={() => {void perform('execute', true);}}>Enregistrer cette intention examinée</Button></> : null}
    {error?.key === key ? <Text accessibilityRole="alert" style={styles.body}>{error.text}</Text> : null}
    <Text style={styles.caption}>Ce reçu ne certifie aucune interception, possession, réception, remise en stock ou arrivée d’argent.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
