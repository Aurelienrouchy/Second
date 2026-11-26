import { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { LabelLifecycleReauthentication } from '@/components/LabelLifecycleReauthentication';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { LabelRouteAmendmentJournal } from '@/services/labelRouteAmendmentJournal';
import { productReviewEqual } from '@/services/productReviewService';
import type { LabelRouteCommand } from '@/types/labelRouteAmendment';
import type { LabelLifecycleContext } from '@/types/labelLifecycle';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import {LabelParcelObservationCard} from '@/components/LabelParcelObservationCard';
import {LABEL_ROUTE_ACTION_LABELS} from '@/components/LabelRouteEntryCard';
const parcelReasons: Record<string, string> = {label_parcel_amendment_not_exposed: 'Les nouvelles corrections de colis restent fermées.', parcel_amendment_capability_required: 'La version explicite de cette correction de colis doit être conservée.', previous_parcel_changed: 'La source native du colis précédent a changé ; une nouvelle demande doit être examinée.', parcel_only_route_sources_required: 'Les deux adresses natives précédentes ne qualifient pas cette proposition de correction du colis.'};
/** SDK own receipts never depend on new reader admission, the stage, or a current role. */
export function LabelRouteAmendmentCommandPanel({uid, context, draft = null, verifyNew, assertNewCurrent, onRecorded, onSourceError, onJournalChanged}: {
  uid: string; context: LabelLifecycleContext; draft?: LabelRouteCommand | null; verifyNew?: () => Promise<() => void>; assertNewCurrent?: () => void; onRecorded?: () => void; onSourceError?: () => void; onJournalChanged?: () => void;
}) {
  const frame = useLabelLifecycleContext(`label-route-command:${context.transactionId}:${context.leg}`, uid), client = useQueryClient(), lock = useRef(false), confirmationEpoch = useRef(0);
  const key = JSON.stringify([uid, context, getAuthSessionGeneration(), frame.focusRevision]), journalKey = ['label-route-amendment-intent', key];
  const pending = useQuery({queryKey: journalKey, enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = frame.capture(); return LabelRouteAmendmentJournal.pending(uid, context, () => frame.assertCurrent(op));}});
  const saved = frame.focused && pending.isSuccess && !pending.isFetching && !pending.error ? pending.data : null;
  const native = useQuery({queryKey: ['label-route-amendment-receipt', key, saved?.requestId ?? ''], enabled: !!saved && frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {if (!saved) throw new Error('Relisez votre journal.'); const op = frame.capture(); return LabelRouteAmendmentJournal.run(saved, 'observe', () => frame.assertCurrent(op));}});
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<{key: string; text: string} | null>(null), [confirmed, setConfirmed] = useState<string | null>(null), [recent, setRecent] = useState<string | null>(null);
  const receipt = saved && busy !== key && native.isSuccess && !native.isFetching && !native.error && native.data.actorId === uid && native.data.requestId === saved.requestId && productReviewEqual(native.data.command, saved.command) ? native.data : null;
  const resumeKey = saved ? JSON.stringify([key, saved.requestId, saved.command]) : '', freshKey = draft ? JSON.stringify([key, draft]) : '';
  const needsAdmin = (saved?.command ?? draft)?.scope === 'admin';
  const perform = async (action: 'execute' | 'observe' | 'neutralize' | 'ack', fresh = false, recover = false) => {
    if (!frame.focused || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(key); setError(null); let newFence: (() => void) | null = null, currentExchange = false;
    const epoch = confirmationEpoch.current;
    const current = () => {frame.assertCurrent(op); if (action === 'execute') {if (!recover) assertNewCurrent?.(); if (!fresh && confirmationEpoch.current !== epoch) throw new Error('Votre confirmation de reprise a changé.');} newFence?.();};
    try {
      current();
      let attempt = saved;
      if (action === 'execute') {
        if (fresh) {
          if (!draft || !verifyNew || !pending.isSuccess || pending.isFetching || pending.error || pending.data !== null || needsAdmin && recent !== freshKey) throw new Error('Relisez et confirmez le trajet et sa version.');
          newFence = await verifyNew(); current(); attempt = await LabelRouteAmendmentJournal.stage(uid, draft, current); current(); client.setQueryData(journalKey, attempt);
        } else if (recover) {
          if (!attempt?.command.parcelAmendmentCapability || receipt?.state !== 'unrecorded' || confirmed !== resumeKey || needsAdmin && recent !== resumeKey) throw new Error('Examinez l’intention conservée, sa version et la confirmation opérateur requise.');
        } else {
          if (!attempt || receipt?.state !== 'unrecorded' || !draft || !verifyNew || !productReviewEqual(attempt.command, draft) || confirmed !== resumeKey || needsAdmin && recent !== resumeKey) throw new Error('Le même trajet doit être réexaminé avant tout nouvel envoi.');
          newFence = await verifyNew(); current();
        }
      }
      if (!attempt) throw new Error('Votre intention exacte doit être relue.');
      // Only an execution re-examined against the current draft may update
      // its form. Capability absence never makes a historic tuple current.
      currentExchange = action === 'execute' && !recover && newFence !== null && draft !== null && productReviewEqual(attempt.command, draft);
      const result = action === 'ack' ? await LabelRouteAmendmentJournal.acknowledge(attempt, current) : await LabelRouteAmendmentJournal.run(attempt, action, current); current();
      setConfirmed(null); setRecent(null); if (action === 'ack') client.setQueryData(journalKey, null);
      await client.invalidateQueries({queryKey: ['label-route-amendment-receipt', key]}); current();
      onJournalChanged?.();
      // A historic receipt/recovery owns this journal, never a newer draft.
      if (currentExchange && result.state === 'committed') onRecorded?.(); if (currentExchange && result.state === 'not_executed' && result.reason !== 'requester_neutralized') onSourceError?.();
    } catch (e) {try {current(); setError({key, text: e instanceof Error ? e.message : 'Le résultat reste inconnu ; votre intention est conservée.'}); if (currentExchange) onSourceError?.();} catch { /* Stale NEW errors cannot overwrite a newer admission or form. The journal is still re-read below. */ }}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) {setBusy(null); void pending.refetch(); void native.refetch();}}
  };
  if (!frame.focused) return null;
  return <View style={styles.section}><Text style={styles.title}>Mon intention de correction de trajet ou de colis</Text>
    {pending.isFetching || pending.isPending ? <Text style={styles.caption}>Lecture du journal personnel…</Text> : pending.error ? <Text accessibilityRole="alert" style={styles.body}>Votre journal ne peut pas être qualifié. Aucune nouvelle intention n’est disponible.</Text> : null}
    <Button variant="secondary" disabled={busy === key || pending.isFetching} onPress={() => {void pending.refetch();}}>Relire mon intention conservée</Button>
    {saved ? <><Text selectable style={styles.body}>{saved.command.reason}</Text><Text style={styles.caption}>Référence {saved.requestId}. L’adresse, la route et la version d’origine restent conservées à l’identique.</Text>
      {saved.command.parcelObservation ? <LabelParcelObservationCard observation={saved.command.parcelObservation} /> : null}
      {saved.command.parcelAmendmentCapability ? <>
        <Text style={styles.body}>Action d’origine : {LABEL_ROUTE_ACTION_LABELS[saved.command.action]}.</Text>
        <Text selectable style={styles.caption}>Version de commande : {saved.command.version} · source : {saved.command.sourceHash} · référence liée : {saved.command.reference?.id ?? 'aucune'}.</Text>
        {(saved.command.route ? [{title: 'Origine conservée dans cette intention', address: saved.command.route.origin}, {title: 'Destination conservée dans cette intention', address: saved.command.route.destination}] : saved.command.address ? [{title: 'Adresse déclarée dans cette intention', address: saved.command.address}] : []).map(item => <Text key={item.title} selectable style={styles.body}>{item.title} : {[item.address.name, item.address.street, item.address.line2, item.address.city, item.address.province, item.address.postalCode, item.address.country].filter(Boolean).join(', ')}.</Text>)}
        {saved.command.route ? <Text style={styles.caption}>Colis de la proposition conservée : {saved.command.route.parcel.weight.value} kg ; {saved.command.route.parcel.dimensions.length} × {saved.command.route.parcel.dimensions.width} × {saved.command.route.parcel.dimensions.height} cm. Transporteur : {saved.command.route.carrierId} · service : {saved.command.route.serviceCode}. Ce n’est ni un devis confirmé ni une autorisation de dépense.</Text> : null}
        {saved.command.handoverDeclaration ? <Text style={styles.caption}>Déclaration du dépôt dans cet accord : {saved.command.handoverDeclaration === 'not_deposited_declared' ? 'non déposé selon la déclaration' : saved.command.handoverDeclaration === 'deposited_declared' ? 'déjà déposé selon la déclaration' : 'inconnue'}. Aucune possession physique n’est certifiée.</Text> : null}
        <Text style={styles.caption}>La capacité et les mesures de cette intention sont reprises exactement. Aucun profil, avis ou formulaire nouveau ne les remplace.</Text>
      </> : null}
      {native.isFetching || native.isPending ? <Text style={styles.caption}>Relecture du reçu natif exact…</Text> : native.error ? <Text accessibilityRole="alert" style={styles.caption}>Résultat inconnu. Votre intention n’est pas recréée.</Text> : null}
      {receipt ? <><Text style={styles.body}>{receipt.state === 'committed' ? 'L’échange a été enregistré pour sa version d’origine.' : receipt.state === 'not_executed' ? 'La non-exécution est enregistrée.' : 'Aucun reçu natif retrouvé. Cette absence ne prouve pas une non-exécution.'}</Text>
        {receipt.recordedAt ? <Text style={styles.caption}>Enregistré le {new Date(receipt.recordedAt).toLocaleString(APP_LOCALE)}.</Text> : null}{receipt.reason ? <Text selectable style={styles.caption}>{parcelReasons[receipt.reason] ?? `Motif natif : ${receipt.reason}`}</Text> : null}</> : null}
      <Button variant="secondary" disabled={busy === key || native.isFetching} onPress={() => {void perform('observe');}}>Relire mon reçu exact</Button>
      {receipt?.state === 'unrecorded' ? <>{needsAdmin ? <LabelLifecycleReauthentication key={resumeKey} uid={uid} sourceKey={resumeKey} disabled={busy === key} onVerified={() => setRecent(resumeKey)} /> : null}
        <Checkbox checked={confirmed === resumeKey} onToggle={() => {try {frame.capture(); confirmationEpoch.current++; setConfirmed(confirmed === resumeKey ? null : resumeKey);} catch { /* Old activity never confirms NEW. */ }}}><Text style={styles.body}>Je confirme la reprise de cette même intention après relecture du trajet et de sa version.</Text></Checkbox>
        <Button variant="secondary" disabled={busy === key || !draft || !productReviewEqual(saved.command, draft) || confirmed !== resumeKey || needsAdmin && recent !== resumeKey} onPress={() => {void perform('execute');}}>Envoyer cette même intention examinée</Button>
        {saved.command.parcelAmendmentCapability ? <Button variant="secondary" disabled={busy === key || confirmed !== resumeKey || needsAdmin && recent !== resumeKey} onPress={() => {void perform('execute', false, true);}}>Reprendre l’intention de colis exacte conservée</Button> : null}
        <Button variant="secondary" disabled={busy === key} onPress={() => {let op; try {op = frame.capture();} catch {return;} const epoch = ++confirmationEpoch.current;
          Alert.alert('Neutraliser l’intention non engagée', 'Un échange déjà enregistré conserve son reçu. Cette action ne retire aucun colis et ne modifie aucun paiement.', [{text: 'Conserver', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {try {frame.assertCurrent(op); if (confirmationEpoch.current !== epoch) return; void perform('neutralize');} catch { /* No stale alert may change this journal. */ }}}]);
        }}>Neutraliser si elle n’est pas enregistrée</Button></> : null}
      <Button variant="secondary" disabled={busy === key || !receipt || receipt.state === 'unrecorded'} onPress={() => {void perform('ack');}}>Terminer ce suivi après relecture native</Button>
    </> : pending.isSuccess && !pending.isFetching && !pending.error ? <>{needsAdmin && draft ? <LabelLifecycleReauthentication key={freshKey} uid={uid} sourceKey={freshKey} disabled={busy === key} onVerified={() => setRecent(freshKey)} /> : null}
      <Button disabled={busy === key || !draft || needsAdmin && recent !== freshKey} onPress={() => {void perform('execute', true);}}>Enregistrer cet échange de trajet examiné</Button></> : null}
    {error?.key === key ? <Text accessibilityRole="alert" style={styles.body}>{error.text}</Text> : null}
    <Text style={styles.caption}>Ce reçu n’autorise aucun dépôt, interception, redirection, achat d’étiquette ou débit et ne certifie aucune réception.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
