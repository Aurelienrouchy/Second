import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ProductPhysicalReviewJournal } from '@/services/productPhysicalReviewJournal';
import { productReviewEqual } from '@/services/productReviewService';
import type { ProductPhysicalAttempt, ProductPhysicalCommand, ProductPhysicalContext, ProductPhysicalReceipt } from '@/types/productPhysicalReview';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
/** A receipt is historical proof of one exact intention, never the current transport permission. */
export function ProductPhysicalCommandPanel({uid, context, draft, enabled, verifyNew, onRecorded, onSourceError, material = false, parcel = false}: {
  uid: string; context: ProductPhysicalContext; draft: ProductPhysicalCommand | null; enabled: boolean;
  verifyNew?: () => Promise<() => void>; onRecorded?: () => void; onSourceError?: () => void;
  material?: boolean; parcel?: boolean;
}) {
  const scope = useShippingPurchaseContext(`product-physical-command:${context.id}`, uid), client = useQueryClient();
  const freshContext = useProductParcelContext(JSON.stringify(['product-physical-new', context, draft, enabled]), uid, parcel);
  const key = JSON.stringify([uid, context.id, getAuthSessionGeneration(), scope.focusRevision]), queryKey = ['product-physical-intent', key];
  const pending = useQuery({queryKey, enabled: scope.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const operation = scope.capture(); return ProductPhysicalReviewJournal.pending(uid, context, () => scope.assertCurrent(operation));}});
  const [result, setResult] = useState<{key: string; attempt: ProductPhysicalAttempt; receipt: ProductPhysicalReceipt} | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<{key: string; text: string} | null>(null);
  const saved = scope.focused && pending.isSuccess && !pending.isFetching && !pending.error ? pending.data : null;
  const receipt = saved && result?.key === key && productReviewEqual(saved, result.attempt) ? result.receipt : null;
  const perform = async (action: 'execute' | 'observe' | 'neutralize' | 'ack', fresh = false) => {
    if (!scope.focused || busy === key) return;
    let newFence: (() => void) | null = null, freshOperation: ReturnType<typeof freshContext.capture> | null = null;
    const operation = scope.capture(), current = () => {scope.assertCurrent(operation); if (freshOperation) freshContext.assertCurrent(freshOperation); newFence?.();}; setBusy(key); setError(null);
    try {
      let attempt = saved;
      if (action === 'execute') {
        freshOperation = freshContext.capture();
        if (!enabled || !draft || !verifyNew || pending.error || pending.isFetching || fresh && pending.data !== null || !fresh && (!attempt || !productReviewEqual(attempt.command, draft))) throw new Error('Une nouvelle lecture et un examen explicite des sources exactes sont requis.');
        newFence = await verifyNew(); current();
        if (fresh) {attempt = await ProductPhysicalReviewJournal.stage(uid, draft, current, material, parcel); current(); client.setQueryData(queryKey, attempt);}
      }
      if (!attempt) throw new Error('Votre intention exacte ne peut pas être relue.');
      const native = action === 'ack' ? await ProductPhysicalReviewJournal.acknowledge(attempt, current) : await ProductPhysicalReviewJournal.run(attempt, action, current); current();
      if (action === 'ack') {client.setQueryData(queryKey, null); setResult(null);} else setResult({key, attempt, receipt: native});
      if (native.state === 'committed') onRecorded?.();
      if (native.state === 'not_executed' && native.reason !== 'requester_neutralized') onSourceError?.();
    } catch (e) {if (scope.isCurrent(operation)) {setError({key, text: e instanceof Error ? e.message : 'Le résultat est inconnu. Votre journal est conservé.'}); if (action === 'execute') {onSourceError?.(); void pending.refetch();}}}
    finally {if (scope.isCurrent(operation)) setBusy(null); scope.finish(operation);}
  };
  if (!scope.focused) return null;
  return <View style={styles.section}>
    <Text style={styles.body}>Mon intention d’instruction physique</Text>
    {pending.isFetching || pending.isPending ? <Text style={styles.caption}>Lecture du journal personnel…</Text> : pending.error ? <><Text style={styles.body}>Le journal ne peut pas être qualifié. Aucun nouveau dépôt n’est permis.</Text><Button variant="secondary" onPress={() => {void pending.refetch();}}>Relire le journal</Button></> : null}
    {error?.key === key ? <Text accessibilityRole="alert" style={styles.body}>{error.text}</Text> : null}
    {saved ? <>
      <Text style={styles.caption}>Cette intention conserve ses appréciations, ses sources et son trajet d’origine. Un aperçu récent ne la remplace pas.</Text>
      <Text style={styles.body}>{receipt?.state === 'committed' ? 'Instruction historiquement enregistrée. Sa validité pour les sources et le trajet actuels doit être relue séparément.' : receipt?.state === 'not_executed' ? 'La non-exécution native a été enregistrée.' : 'Résultat à vérifier. Votre intention est conservée.'}</Text>
      {receipt?.recordedAt ? <Text style={styles.caption}>Enregistrée le {new Date(receipt.recordedAt).toLocaleString(APP_LOCALE)}.</Text> : null}
      <Button variant="secondary" disabled={busy === key} onPress={() => {void perform('observe');}}>Relire mon reçu exact</Button>
      <Button variant="secondary" disabled={busy === key || !enabled || !draft || !freshContext.focused || !productReviewEqual(saved.command, draft)} onPress={() => {void perform('execute');}}>Reprendre cette même intention</Button>
      <Button variant="secondary" disabled={busy === key} onPress={() => Alert.alert('Neutraliser cette intention', 'Une instruction déjà enregistrée conserve son vrai reçu. Seule une non-exécution native permet d’abandonner une intention non engagée.', [{text: 'Conserver', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void perform('neutralize');}}])}>Neutraliser l’intention non engagée</Button>
      <Button variant="secondary" disabled={busy === key || !receipt || receipt.state === 'unrecorded'} onPress={() => {void perform('ack');}}>Acquitter après relecture native</Button>
    </> : pending.isSuccess && !pending.error && !pending.isFetching ? <Button disabled={busy === key || !enabled || !draft || !freshContext.focused} onPress={() => {void perform('execute', true);}}>Enregistrer l’instruction examinée</Button> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
