import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { SwapTopUpCheckoutJournal as Journal } from '@/services/swapTopUpCheckoutJournal';
import { SWAP_TOPUP_ACTION_LABELS, SWAP_TOPUP_STATUS_LABELS } from '@/utils/swapTopUpCheckoutPresentation';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import type { SwapTopUpScope, SwapTopUpReceipt } from '@/types/swapTopUpCheckout';
import { colors, spacing, typography } from '@/constants/theme';

/** Own exact receipts remain serviceable before profile, role, consent or NEW permissions. */
export function SwapTopUpCheckoutJournal({uid, scope}: {uid: string; scope: SwapTopUpScope}) {
  const frame = useLabelLifecycleContext(`swap-topup-journal:${scope}`, uid), client = useQueryClient(), lock = useRef(false);
  const generation = getAuthSessionGeneration(), key = JSON.stringify([uid, generation, scope, frame.focusRevision]);
  const [busy, setBusy] = useState<string | null>(null), [receipt, setReceipt] = useState<{key: string; value: SwapTopUpReceipt} | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const journal = useQuery({queryKey: ['swap-topup-journal', uid, scope, generation, frame.focusRevision], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, scope, () => frame.assertCurrent(op));}});
  const pending = frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
  const selection = JSON.stringify([key, pending?.swapId, pending?.requestId]);
  const ownReceipt = receipt?.key === selection && receipt.value.requestId === pending?.requestId ? receipt.value : null;
  const perform = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!pending || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(selection); setNotice(null); const current = () => frame.assertCurrent(op);
    try {
      const result = await Journal[mode](pending, current); current();
      // Keep ephemeral secrets out of component receipt state as well as storage/logs.
      const {payment: _volatilePayment, ...safeReceipt} = result;
      setReceipt({key: selection, value: safeReceipt});
      await client.invalidateQueries({queryKey: ['swap-topup-journal', uid, scope]}); current();
    } catch {try {current(); setNotice({key: selection, text: 'Le même reçu reste à rapprocher. Ne recréez pas le paiement et ne changez pas son moyen de règlement.'}); void journal.refetch();} catch { /* Inactive SDK callbacks have no authority. */ }}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) setBusy(null);}
  };
  return <View style={styles.section}>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal du complément doit être relu avant tout nouvel envoi.</Text> : null}
    <Button variant="secondary" disabled={!frame.focused || !!busy} onPress={() => {try {frame.capture(); void journal.refetch();} catch { /* Inactive. */ }}}>Relire mon journal de complément Troc</Button>
    {pending ? <><Text accessibilityRole="header" style={styles.body}>Intention exacte conservée · {SWAP_TOPUP_ACTION_LABELS[pending.command.action]}</Text>
      <Text selectable style={styles.caption}>Troc {pending.swapId} · {pending.requestId} · total {formatPriceWithCurrency(pending.command.totalCents / 100)}</Text>
      {pending.command.paymentIntentId ? <Text selectable style={styles.caption}>Paiement {pending.command.paymentIntentId} · version {pending.command.intentVersion ?? 'ancienne intention'}.</Text> : null}
      <Text style={styles.caption}>Après une réponse perdue, cette reprise relit le même effet côté serveur. Elle ne recrée ni paiement, confirmation ou annulation. Un résultat inconnu ou en traitement ne permet aucune alternative.</Text>
      <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('observe');}}>Observer et rapprocher cette même intention</Button>
      <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('neutralize');}}>Bloquer les futurs envois non engagés de cette intention</Button>
      {ownReceipt ? <><Text style={styles.caption}>{ownReceipt.state === 'received' ? 'Reçu natif de l’opération enregistré. Il ne prouve pas le règlement du complément.' : ownReceipt.state === 'not_executed' ? `Non-exécution enregistrée : ${ownReceipt.reason}.` : ownReceipt.state === 'engaged' ? 'Un traitement existant est engagé ; aucun nouveau paiement n’est proposé.' : ownReceipt.state === 'unknown' ? 'Le résultat de cette opération native reste inconnu.' : 'Aucun reçu enregistré ; cette absence ne prouve pas une non-exécution.'}</Text>
        {ownReceipt.result ? <Text style={styles.caption}>Observation conservée : {SWAP_TOPUP_STATUS_LABELS[ownReceipt.result.providerStatus]}. Cette observation n’est pas un reçu de règlement.</Text> : null}
        {ownReceipt.futureEffectsNeutralized ? <Text style={styles.caption}>Les futurs envois propres à cette intention sont neutralisés. Un effet déjà engagé reste à rapprocher ; cela ne prouve ni remboursement ni annulation prestataire.</Text> : null}
      </> : null}
      {ownReceipt && ['received', 'not_executed'].includes(ownReceipt.state) && ownReceipt.recordedAt ? <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('acknowledge');}}>Relire le reçu terminal frais et terminer le suivi local</Button> : null}
    </> : null}
    {notice?.key === selection ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
