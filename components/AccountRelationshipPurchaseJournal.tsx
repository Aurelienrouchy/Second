import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { AccountRelationshipReauthentication } from '@/components/AccountRelationshipReauthentication';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { AccountRelationshipPurchaseJournal as Journal } from '@/services/accountRelationshipPurchaseJournal';
import type { RelationshipPurchaseReceipt, RelationshipReauthentication } from '@/types/accountRelationshipReview';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { colors, spacing, typography } from '@/constants/theme';

/** Own original receipts are read before any current admin role or selected ticket. */
export function AccountRelationshipPurchaseJournal({uid, renderReauthentication}: {uid: string; renderReauthentication?: RelationshipReauthentication}) {
  const frame = useLabelLifecycleContext('relationship-purchase-own-journal', uid), client = useQueryClient(), lock = useRef(false);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision]);
  const [busy, setBusy] = useState<string | null>(null), [receipt, setReceipt] = useState<{key: string; value: RelationshipPurchaseReceipt} | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const [authenticated, setAuthenticated] = useState<string | null>(null);
  const journal = useQuery({queryKey: ['relationship-purchase-journal', uid, getAuthSessionGeneration(), frame.focusRevision], enabled: frame.focused,
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = frame.capture(); return Journal.read(uid, () => frame.assertCurrent(op));}});
  const pending = frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
  const selection = JSON.stringify([key, pending]), ownReceipt = receipt?.key === selection ? receipt.value : null;
  const perform = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!pending || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(selection); setNotice(null); const current = () => frame.assertCurrent(op);
    try {
      if (mode === 'neutralize' && authenticated !== selection) throw new Error('Confirmez votre identité opérateur pour arrêter cette intention non exécutée.');
      const result = await Journal[mode](pending, current); current(); setReceipt({key: selection, value: result}); setAuthenticated(null);
      await client.invalidateQueries({queryKey: ['relationship-purchase-journal', uid]}); current();
    } catch {try {current(); setAuthenticated(null); setNotice({key: selection, text: 'La même issue reste à rapprocher en lecture. L’intention exacte est conservée ; aucun nouvel envoi de la commande d’origine n’est proposé.'});} catch { /* No stale receipt is exposed to a replacement identity. */ }}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) setBusy(null);}
  };
  if (!pending && !journal.isError) return null;
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.body}>Mon journal d’achat historique</Text>
    <Text style={styles.caption}>Ce journal conserve uniquement votre instruction exacte. Sa relecture ne dépend ni du dossier sélectionné, ni d’une nouvelle habilitation ; elle n’ouvre aucune nouvelle commande.</Text>
    <Button variant="secondary" disabled={!frame.focused || !!busy} onPress={() => {try {frame.capture(); void journal.refetch();} catch { /* SDK owner frame only. */ }}}>Relire mon journal d’achat historique</Button>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le propre journal ne peut pas être qualifié. Aucun nouvel envoi n’est proposé.</Text> : null}
    {pending ? <>
      <Text selectable style={styles.caption}>Instruction {pending.requestId} · achat {pending.command.transactionId} · décision {pending.command.relationshipReference.id} · source {pending.command.sourceHash}.</Text>
      <Text style={styles.body}>Commande d’origine : neutraliser cette capacité carte historique ; total {formatPriceWithCurrency(pending.command.totalCents / 100)} CAD, portion portefeuille {formatPriceWithCurrency(pending.command.walletCents / 100)} CAD.</Text>
      <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('observe');}}>Observer le reçu exact, sans nouvel envoi</Button>
      {ownReceipt ? <Text style={styles.body}>{ownReceipt.state === 'received' ? 'Neutralisation de la seule capacité carte observée dans le reçu natif.' : ownReceipt.state === 'not_executed' ? 'Instruction non exécutée selon le reçu natif.'
        : ownReceipt.state === 'authorized' ? 'Instruction autorisée, résultat encore à rapprocher en lecture.' : ownReceipt.state === 'unknown' ? 'Résultat inconnu : seule une nouvelle observation est proposée.' : 'Aucun reçu natif enregistré dans cette lecture. Le résultat reste à rapprocher, sans renvoi de la commande.'}</Text> : null}
      {ownReceipt?.result ? <Text style={styles.caption}>Observation prestataire : {ownReceipt.result.providerObservedAt}. {ownReceipt.result.walletObligationOpen ? 'L’obligation portefeuille demeure ouverte.' : 'Aucune obligation portefeuille ouverte qualifiée dans ce reçu.'} Aucun fonds n’a été déplacé et l’état de la commande ou du stock n’a pas été modifié.</Text> : null}
      {ownReceipt?.state === 'unrecorded' ? <>
        <Text style={styles.caption}>Vous pouvez demander l’arrêt de cette seule intention si elle n’a pas été autorisée. Une issue déjà autorisée ou inconnue restera à rapprocher en lecture.</Text>
        <AccountRelationshipReauthentication render={renderReauthentication} uid={uid} sourceKey={`relationship-purchase-stop:${selection}`} parcel disabled={!!busy || !frame.focused}
          onVerified={() => {try {frame.capture(); setAuthenticated(selection);} catch { /* Original owner/intent frame only. */ }}}/>
        <Button variant="secondary" disabled={!!busy || authenticated !== selection} onPress={() => {void perform('neutralize');}}>Arrêter cette intention non exécutée</Button>
      </> : null}
      {ownReceipt && ['received', 'not_executed'].includes(ownReceipt.state) ? <Button variant="secondary" disabled={!!busy} onPress={() => {void perform('acknowledge');}}>Relire le reçu frais et acquitter ce suivi local</Button> : null}
    </> : null}
    {notice?.key === selection ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
