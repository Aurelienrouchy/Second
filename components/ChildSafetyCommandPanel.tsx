import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ChildSafetyReviewJournal } from '@/services/childSafetyReviewJournal';
import { productReviewEqual } from '@/services/productReviewService';
import type { ChildSafetyReviewAttempt, ChildSafetyReviewReceipt, ChildSafetyAdmissionCommand, ChildSafetyPublicationCommand } from '@/types/childSafetyReview';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
/** Own journal servicing remains independent of current admission or source reads. */
export function ChildSafetyCommandPanel({uid, articleId, kind, draft, sourceKey, enabled, verifyNew, onRecorded}: {
  uid: string; articleId: string; kind: ChildSafetyReviewAttempt['kind']; draft: ChildSafetyAdmissionCommand | ChildSafetyPublicationCommand | null;
  sourceKey: string; enabled: boolean; verifyNew?: () => Promise<void>; onRecorded?: () => void;
}) {
  const scope = useShippingPurchaseContext(`child-safety-${kind}:${articleId}`, uid), client = useQueryClient();
  const key = JSON.stringify([uid, articleId, kind, getAuthSessionGeneration(), scope.focusRevision]);
  const queryKey = ['child-safety-intent', key];
  const pending = useQuery({queryKey, enabled: scope.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {
    const operation = scope.capture(); return ChildSafetyReviewJournal.pending(uid, articleId, kind, () => scope.assertCurrent(operation));}});
  const [result, setResult] = useState<{key: string; attempt: ChildSafetyReviewAttempt; receipt: ChildSafetyReviewReceipt} | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<{key: string; text: string} | null>(null);
  const attempt = scope.focused && pending.isSuccess && !pending.isFetching && !pending.error ? pending.data : null;
  const receipt = result?.key === key && attempt && productReviewEqual(result.attempt, attempt) ? result.receipt : null;
  const active = busy === key;
  const perform = async (action: 'execute' | 'observe' | 'neutralize' | 'ack', fresh = false) => {
    if (!scope.focused || active) return;
    const operation = scope.capture(), current = () => scope.assertCurrent(operation);
    setBusy(key); setError(null);
    try {
      let selected = attempt;
      if (fresh) {
        if (!enabled || !draft || !verifyNew || pending.error || pending.isFetching || pending.data !== null) throw new Error('Relisez le dossier et confirmez ses sources actuelles.');
        await verifyNew(); current();
        const staged = kind === 'admission' ? {kind, command: draft as ChildSafetyAdmissionCommand} as const : {kind, command: draft as ChildSafetyPublicationCommand} as const;
        selected = await ChildSafetyReviewJournal.stage(uid, articleId, staged, current); current(); client.setQueryData(queryKey, selected);
      }
      if (!selected) throw new Error('Aucune intention exacte ne peut être relue.');
      if (action === 'execute' && !fresh && (!enabled || !draft || !productReviewEqual(draft, selected.command) || !verifyNew)) throw new Error('Seule l’observation ou la neutralisation de cette ancienne intention est disponible.');
      if (action === 'execute' && !fresh) {await verifyNew!(); current();}
      const observed = action === 'ack' ? await ChildSafetyReviewJournal.acknowledge(selected, current) : await ChildSafetyReviewJournal.run(selected, action, current); current();
      if (action === 'ack') {client.setQueryData(queryKey, null); setResult(null);} else {setResult({key, attempt: selected, receipt: observed});}
      if (observed.state === 'committed') onRecorded?.();
    } catch (e) {if (scope.isCurrent(operation)) setError({key, text: e instanceof Error ? e.message : 'Le résultat demeure inconnu. Le journal est conservé.'});}
    finally {if (scope.isCurrent(operation)) setBusy(null); scope.finish(operation);}
  };
  if (!scope.focused) return null;
  return <View style={styles.section}>
    <Text style={styles.body}>{kind === 'admission' ? 'Intention d’admission de l’annonce' : 'Intention explicite de publication'}</Text>
    {pending.isPending || pending.isFetching ? <Text style={styles.caption}>Lecture de votre journal personnel…</Text> : pending.error ? <><Text style={styles.body}>Le journal ne peut pas être relu ; aucun nouvel envoi n’est permis.</Text><Button variant="secondary" onPress={() => {void pending.refetch();}}>Relire le journal</Button></> : null}
    {error?.key === key ? <Text accessibilityRole="alert" style={styles.body}>{error.text}</Text> : null}
    {attempt ? <>
      <Text style={styles.caption}>L’intention conservée garde ses sources, ses choix et son récit d’origine. Une lecture plus récente ne les remplace pas.</Text>
      <Text style={styles.body}>{receipt?.state === 'committed' ? 'Enregistrement historique qualifié. L’état actuel de l’annonce reste à lire.' : receipt?.state === 'not_executed' ? 'Non-exécution native enregistrée.' : 'Résultat à vérifier ; aucune nouvelle intention ne sera créée.'}</Text>
      {receipt?.recordedAt ? <Text style={styles.caption}>Enregistré le {new Date(receipt.recordedAt).toLocaleString(APP_LOCALE)}.</Text> : null}
      <Button variant="secondary" disabled={active} onPress={() => {void perform('observe');}}>Relire le reçu exact</Button>
      <Button variant="secondary" disabled={active || !enabled || !draft || !productReviewEqual(draft, attempt.command)} onPress={() => {void perform('execute');}}>Reprendre cette même intention</Button>
      <Button variant="secondary" disabled={active} onPress={() => Alert.alert('Neutraliser cette intention', 'Une intention déjà enregistrée conserve son vrai reçu. Une non-exécution native est nécessaire avant de créer une autre intention.', [{text: 'Conserver', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void perform('neutralize');}}])}>Neutraliser l’intention non engagée</Button>
      <Button variant="secondary" disabled={active || !receipt || receipt.state === 'unrecorded'} onPress={() => {void perform('ack');}}>Acquitter après nouvelle lecture native</Button>
    </> : pending.isSuccess && !pending.error && !pending.isFetching ? <Button disabled={active || !enabled || !draft || !sourceKey} onPress={() => {void perform('execute', true);}}>{kind === 'admission' ? 'Enregistrer cette décision examinée' : 'Publier cette préparation autorisée'}</Button> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
