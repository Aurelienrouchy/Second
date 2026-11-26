import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { CommercialClaimReviewJournal as Journal } from '@/services/commercialClaimReviewJournal';
import { COMMERCIAL_CLAIM_ACTION_LABELS, COMMERCIAL_CLAIM_LIMITS } from '@/utils/commercialClaimReviewPresentation';
import type { CommercialClaimReviewReceipt } from '@/types/commercialClaimReview';
import { colors, spacing, typography } from '@/constants/theme';

/** Only this SDK actor's immutable intention is serviced; no parent form callback. */
export function CommercialClaimReviewJournal({uid}: {uid: string}) {
  const frame = useLabelLifecycleContext('commercial-claim-own-journal', uid), client = useQueryClient(), lock = useRef(false);
  const generation = getAuthSessionGeneration(), key = JSON.stringify([uid, generation, frame.focusRevision]);
  const [busy, setBusy] = useState<string | null>(null), [receipt, setReceipt] = useState<{key: string; value: CommercialClaimReviewReceipt} | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const journal = useQuery({queryKey: ['commercial-claim-own-journal', uid, generation, frame.focusRevision], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, () => frame.assertCurrent(op));}});
  const pending = frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
  const selection = JSON.stringify([key, pending?.requestId, pending?.command]), ownReceipt = receipt?.key === selection ? receipt.value : null;
  const perform = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!pending || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(selection); setNotice(null); const current = () => frame.assertCurrent(op);
    try {
      const value = await Journal[mode](pending, current); current(); setReceipt({key: selection, value});
      await client.invalidateQueries({queryKey: ['commercial-claim-own-journal', uid]}); current();
    } catch {try {current(); setNotice({key: selection, text: 'Le reçu exact reste à rapprocher. Ne recréez pas cette démarche à partir d’une absence de réponse.'});} catch { /* Old SDK callbacks cannot change replacement choices. */ }}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) setBusy(null);}
  };
  return <View style={styles.section}>
    <Button variant="secondary" disabled={!frame.focused || !!busy} onPress={() => {try {frame.capture(); void journal.refetch();} catch { /* Inactive. */ }}}>Relire mon intention de retrait ou de réexamen</Button>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal propre doit être relu avant toute nouvelle démarche.</Text> : null}
    {pending ? <><Text accessibilityRole="header" style={styles.body}>{COMMERCIAL_CLAIM_ACTION_LABELS[pending.command.action]}</Text>
      <Text selectable style={styles.caption}>Commande {pending.command.transactionId} · plainte {pending.command.claimId} · intention {pending.requestId}.</Text>
      <Text selectable style={styles.body}>{pending.command.narrative}</Text><Text style={styles.caption}>{COMMERCIAL_CLAIM_LIMITS}</Text>
      <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('observe');}}>Observer le reçu de cette intention exacte</Button>
      <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('neutralize');}}>Neutraliser ses seuls effets documentaires non engagés</Button>
      {ownReceipt ? <Text style={styles.caption}>{ownReceipt.state === 'committed' ? 'La déclaration documentaire est enregistrée ; aucun effet financier ou clôture n’en résulte.' : ownReceipt.state === 'not_executed' ? 'La non-exécution de cette intention est enregistrée. Les autres démarches restent distinctes.' : 'Aucun reçu natif visible ; cette absence ne démontre pas une non-exécution.'}</Text> : null}
      {ownReceipt && ownReceipt.state !== 'unrecorded' && ownReceipt.recordedAt ? <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('acknowledge');}}>Relire le reçu terminal frais et terminer le suivi local</Button> : null}
    </> : null}
    {notice?.key === selection ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
