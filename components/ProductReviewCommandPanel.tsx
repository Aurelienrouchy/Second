import { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ProductReviewJournal } from '@/services/productReviewJournal';
import { productReviewEqual } from '@/services/productReviewService';
import type { ProductReviewAttempt, ProductReviewContext, ProductReviewReceipt, ProductReviewRefusal } from '@/types/productReview';
const refusal: Record<ProductReviewRefusal, string> = {requester_neutralized: 'Cette intention a été neutralisée avant son enregistrement.',
  source_changed: 'Une source a changé. Relisez le dossier avant une nouvelle déclaration explicite.', reference_unqualified: 'La référence examinée ne peut plus être qualifiée.',
  incomplete_case_history: 'Les éléments accessibles ne qualifient pas un examen documentaire complet.', product_material_review_not_exposed: 'Ce parcours matériel reste fermé. L’intention n’a pas été exécutée.', product_parcel_review_not_exposed: 'Ce parcours colis reste fermé. L’intention n’a pas été exécutée.'};
type Draft = Pick<ProductReviewAttempt, 'type' | 'command'>;
/** Own historical receipts remain accessible even when current private admission fails. */
export function ProductReviewCommandPanel({uid, context, sourceKey, draft, enabled, onRecorded, onSubmitted, allowResume = true, material = false, parcel = false, routeAmendment = false, verifyNew, assertNewCurrent, onSourceError}: {uid: string; context: ProductReviewContext;
  sourceKey: string; draft: Draft | null; enabled: boolean; onRecorded: () => void; onSubmitted: () => void; allowResume?: boolean; material?: boolean;
  verifyNew?: () => Promise<() => void>; assertNewCurrent?: () => void; onSourceError?: () => void; parcel?: boolean; routeAmendment?: boolean}) {
  const base = useProductParcelContext(JSON.stringify(['product-review-journal', context]), uid, parcel);
  const fresh = useProductParcelContext(JSON.stringify(['product-review-new', context, sourceKey, draft]), uid, parcel);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context, base.focusRevision]);
  const lock = useRef<symbol | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{key: string; attempt: ProductReviewAttempt; receipt: ProductReviewReceipt} | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const pending = useQuery({queryKey: ['product-review-journal', key], enabled: base.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = base.capture(); return ProductReviewJournal.pending(uid, context, () => base.assertCurrent(op));}});
  const ready = base.focused && pending.isSuccess && !pending.isFetching && !pending.isError;
  const attempt = ready ? pending.data : null, current = ready && result?.key === key ? result : null, working = busy === key;
  const run = async (a: ProductReviewAttempt, mode: 'execute' | 'observe' | 'resume' | 'neutralize' | 'acknowledge') => {
    if ((mode === 'execute' || mode === 'resume') && a.type === 'workflow' && (a.routeAmendmentCapability === 'label_route_amendment_v1') !== (parcel && routeAmendment)) return;
    const commercialNew = (a.type === 'commercial_return' || a.parcelCapability === 'product_review_parcel_v1') && (mode === 'execute' || mode === 'resume');
    if (!ready || lock.current || mode === 'resume' && !allowResume || commercialNew && (!verifyNew || !enabled || !draft || a.type !== draft.type || !productReviewEqual(a.command, draft.command)) || a.uid !== uid || !productReviewEqual(a.context, context) || mode === 'execute' &&
      (!enabled || !draft || a.type !== draft.type || !productReviewEqual(a.command, draft.command))) return;
    let op, newOp; try {op = base.start(); if (!op) return; newOp = mode === 'execute' || commercialNew ? fresh.capture() : null;} catch {if (op) base.finish(op); return;}
    const token = Symbol(); lock.current = token; setBusy(key); setNotice(null);
    let nativeFence: (() => void) | null = null, currentExchange = false, submitted = false;
    const assertCurrent = () => {base.assertCurrent(op); if (newOp) fresh.assertCurrent(newOp); if (mode === 'execute') assertNewCurrent?.(); nativeFence?.();};
    const notifySubmitted = () => {if (!submitted) {submitted = true; onSubmitted();}};
    try {
      assertCurrent();
      if (commercialNew || mode === 'execute' && verifyNew) {nativeFence = await verifyNew!(); assertCurrent();}
      // Only this explicit NEW execution owns the current form. A historical
      // replay never becomes current merely because its capability is absent.
      currentExchange = mode === 'execute' && enabled && !!draft && a.type === draft.type && productReviewEqual(a.command, draft.command) && (!verifyNew || nativeFence !== null);
      const receipt = await ProductReviewJournal[mode](a, assertCurrent); assertCurrent();
      await pending.refetch(); assertCurrent(); setResult(mode === 'acknowledge' ? null : {key, attempt: a, receipt});
      if (currentExchange) {assertCurrent(); notifySubmitted(); if (receipt.state === 'committed') onRecorded();}
      if (mode === 'acknowledge') setNotice({key, text: 'Le reçu exact a été relu avant de terminer le suivi local. Une nouvelle démarche exige une nouvelle lecture explicite.'});
    } catch {
      try {assertCurrent(); setNotice({key, text: 'Résultat à vérifier. La même intention reste conservée avec son texte et ses sources. Relisez-la, reprenez-la à l’identique ou neutralisez-la explicitement.'}); if (currentExchange) {notifySubmitted(); if (commercialNew) onSourceError?.();}}
      catch { /* A stale execution cannot overwrite the replacement form or admission. */ }
      if (base.isCurrent(op)) void pending.refetch();
    }
    finally {base.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  if (!base.focused) return null;
  return <View style={styles.section}>
    {pending.isError ? <><Text accessibilityRole="alert" style={styles.caption}>Le journal privé doit être relu avant toute autre intention.</Text><Button variant="secondary" onPress={() => {void pending.refetch();}}>Relire le journal privé</Button></> : null}
    {attempt ? <View style={styles.section}><Text style={styles.body}>Une intention exacte reste conservée pour ce dossier.</Text>
      <Text selectable style={styles.body}>{attempt.type === 'contribution' ? attempt.command.statement : attempt.type === 'commercial_return' ? attempt.command.partyMessage : attempt.command.text}</Text>
      <Text style={styles.caption}>Son contenu reste lié à sa source d’origine ; aucune source récente ne le remplace.</Text>
      <Button variant="secondary" disabled={working} onPress={() => {void run(attempt, 'observe');}}>Relire cette intention exacte</Button></View> : null}
    {ready && !attempt && enabled && draft ? <Button variant="secondary" disabled={working || !fresh.focused} onPress={() => {
      const a = {version: 1, uid, requestId: randomUUID(), context, ...draft, ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {}), ...(parcel && routeAmendment && draft.type === 'workflow' ? {routeAmendmentCapability: 'label_route_amendment_v1'} : {}), ...(draft.type === 'contribution' && 'routingStatement' in draft.command ? {routingCapability: 'product_review_routing_v1'} : {}),...(draft.type==='contribution'&&'mixedOrderStatement'in draft.command?{mixedOrdersCapability:'product_review_mixed_orders_v1'}:{})} as ProductReviewAttempt; void run(a, 'execute');}}>
      {material && draft.type === 'contribution' ? 'Enregistrer ce qui est déclaré' : 'Enregistrer cette intention exacte'}</Button> : null}
    {current && attempt?.requestId === current.attempt.requestId ? <View style={styles.section}>
      <Text style={styles.body}>{current.receipt.state === 'committed' ? 'Le reçu natif confirme l’enregistrement historique pour les sources d’origine. Il ne certifie pas le produit ni l’état actuel du dossier.' :
        current.receipt.state === 'unrecorded' ? 'Aucun reçu natif enregistré. Cette absence n’annule pas l’intention.' : refusal[current.receipt.reason!]}</Text>
      {current.receipt.state === 'unrecorded' ? <>{allowResume && (current.attempt.type !== 'workflow' || (current.attempt.routeAmendmentCapability === 'label_route_amendment_v1') === (parcel && routeAmendment)) && (current.attempt.type !== 'commercial_return' && !current.attempt.parcelCapability || !!verifyNew && enabled && !!draft && draft.type === current.attempt.type && productReviewEqual(draft.command, current.attempt.command)) ? <Button variant="secondary" disabled={working} onPress={() => {void run(current.attempt, 'resume');}}>Reprendre exactement cette intention</Button> : null}
        <Button variant="secondary" disabled={working} onPress={() => Alert.alert('Neutraliser cette intention', 'La même référence sera conservée pour empêcher une exécution tardive non engagée. Un résultat déjà enregistré conserve son reçu.',
          [{text: 'Retour', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void run(current.attempt, 'neutralize');}}])}>Neutraliser l’intention non engagée</Button></> :
        <Button variant="secondary" disabled={working} onPress={() => {void run(current.attempt, 'acknowledge');}}>Terminer ce suivi après une nouvelle lecture native</Button>}
    </View> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
