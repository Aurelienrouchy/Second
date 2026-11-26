import { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button, Checkbox } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { FraudReviewService } from '@/services/fraudReviewService';
import type { FraudReviewAction as FraudDecisionAction, FraudDecisionAttempt, FraudDecisionPreview, FraudDecisionReceipt, FraudReviewSource } from '@/types/fraudReview';

interface Props {uid: string; enabled: boolean; transactionId: string | null; sourceKey: string;
  onInspectCase: (caseId: string, transactionId: string, source: FraudReviewSource) => void; onRecorded: () => void}
const labels = {retain_review: 'Maintenir la revue', close_review_for_sources: 'Fermer la revue pour ces sources'} as const;
const refusalLabels = {requester_neutralized: 'Cette intention a été neutralisée avant une nouvelle exécution ; aucune source n’a été examinée par cette neutralisation.',
  native_order_source_unqualified: 'La source native de la commande ne peut pas être qualifiée.', source_changed: 'Une source a changé : un nouvel examen explicite est nécessaire après acquittement.',
  no_attributed_case: 'Aucun cas n’est actuellement attribué à cette commande dans la lecture native.', case_set_or_marker_unqualified: 'L’ensemble des cas ou son marqueur ne permet pas de qualifier une fermeture.'} as const;
const referenceKey = (entry: FraudDecisionPreview['cases'][number]) => entry.caseId;
export function AdminFraudReviewDecision({uid, enabled, transactionId, sourceKey, onInspectCase, onRecorded}: Props) {
  const base = useShippingPurchaseContext('admin-fraud-intentions', uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), base.focusRevision]);
  const fresh = useShippingPurchaseContext(JSON.stringify(['admin-fraud-new-decision', transactionId, sourceKey]), uid);
  const lock = useRef<{key: string; token: symbol} | null>(null);
  const [busyState, setBusy] = useState<string | null>(null), busy = busyState === key;
  const [draft, setDraft] = useState<{key: string; frame: symbol; preview: FraudDecisionPreview; requestId: string; action: FraudDecisionAction | null; reason: string; confirmed: boolean} | null>(null);
  const [result, setResult] = useState<{key: string; attempt: FraudDecisionAttempt; receipt: FraudDecisionReceipt} | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const pending = useQuery({queryKey: ['admin-fraud-intentions', key], enabled: enabled && base.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = base.capture(); return FraudReviewService.pending(uid, () => base.assertCurrent(operation));}});
  const journalsReady = enabled && base.focused && !pending.isError && !pending.isFetching && pending.isSuccess;
  const attempts = journalsReady ? pending.data : [];
  const current = journalsReady && draft?.key === key && draft.frame === fresh.frame && draft.preview.transactionId === transactionId ? draft : null;
  const currentResult = journalsReady && result?.key === key ? result : null;
  const canPreview = journalsReady && !!transactionId && !attempts.some(entry => entry.command.transactionId === transactionId) && fresh.focused && !busy;
  const preview = async () => {
    if (!canPreview || !transactionId || lock.current?.key === key) return;
    let operation; try {operation = fresh.start();} catch {return;} if (!operation) return;
    const token = Symbol(); lock.current = {key, token}; setBusy(key); setDraft(null); setNotice(null);
    try {const value = await FraudReviewService.preview(uid, transactionId, () => fresh.assertCurrent(operation)); fresh.assertCurrent(operation);
      setDraft({key, frame: fresh.frame, preview: value, requestId: randomUUID(), action: null, reason: '', confirmed: false});
    } catch {if (fresh.isCurrent(operation)) setNotice({key, text: 'L’aperçu doit être relu depuis les sources actuelles. Aucune instruction n’a été envoyée.'});}
    finally {fresh.finish(operation); if (lock.current?.token === token) {lock.current = null; setBusy(null);}}
  };
  const run = async (a: FraudDecisionAttempt, mode: 'execute' | 'observe' | 'neutralize' | 'acknowledge') => {
    if (!journalsReady || lock.current?.key === key || a.uid !== uid) return;
    let operation, freshOperation;
    try {operation = base.start(); if (!operation) return; freshOperation = mode === 'execute' ? fresh.capture() : null;}
    catch {if (operation) base.finish(operation); return;}
    const assertCurrent = () => {base.assertCurrent(operation); if (freshOperation) fresh.assertCurrent(freshOperation);};
    const token = Symbol(); lock.current = {key, token}; setBusy(key); setNotice(null);
    try {
      const receipt = mode === 'execute' ? await FraudReviewService.execute(a, assertCurrent) : mode === 'observe' ? await FraudReviewService.observe(a, assertCurrent) :
        mode === 'neutralize' ? await FraudReviewService.neutralize(a, assertCurrent) : await FraudReviewService.acknowledge(a, assertCurrent);
      assertCurrent(); setDraft(null);
      if (mode === 'acknowledge') {setResult(null); setNotice({key, text: 'Le reçu natif a été relu avant de terminer ce suivi local. Une autre source exige son propre examen explicite.'});}
      else setResult({key, attempt: a, receipt});
      await pending.refetch(); assertCurrent(); if (receipt.state === 'committed') onRecorded();
    } catch {if (base.isCurrent(operation)) {setDraft(null); setNotice({key, text: 'Résultat à vérifier : conservez la même référence, le motif et les sources. Relisez ou neutralisez cette intention exacte ; aucune nouvelle intention n’est créée automatiquement.'}); void pending.refetch();}}
    finally {base.finish(operation); if (lock.current?.token === token) {lock.current = null; setBusy(null);}}
  };
  const renderReference = useCallback(({item}: ListRenderItemInfo<FraudDecisionPreview['cases'][number]>) => <View style={styles.reference}>
    <Text selectable style={styles.caption}>Cas : {item.caseId} · révision : {item.caseRevision ?? 'inconnue'} · {item.caseSourceHash}</Text>
    <Text selectable style={styles.caption}>Observation : {item.observationId ?? 'inconnue'} · révision : {item.observationRevision ?? 'inconnue'} · empreinte : {item.observationHash ?? 'inconnue'}</Text>
    <Text style={styles.caption}>Qualification actuelle : {item.qualification === 'native_current_case' ? 'source native qualifiée' : 'inconnue'}. Revue humaine : {item.humanAction === 'unreviewed' ? 'non enregistrée pour cette observation' : item.humanAction === 'unknown' ? 'inconnue' : labels[item.humanAction]}.</Text>
    <Button variant="secondary" disabled={busy || !current || item.caseRevision === null} onPress={() => {if (current && item.caseRevision) {
      setDraft(null); onInspectCase(item.caseId, current.preview.transactionId, {caseRevision: item.caseRevision, caseSourceHash: item.caseSourceHash,
        orderRevision: current.preview.source.orderRevision, orderSourceHash: current.preview.source.orderSourceHash});}}}>Lire les observations de ce cas avant un nouvel aperçu</Button>
  </View>, [busy, current, onInspectCase, setDraft]);
  if (!enabled || !base.focused) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Décision humaine sur les sources de risque</Text>
    {pending.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal doit être relu avant toute nouvelle intention.</Text> : null}
    <Button variant="secondary" disabled={!canPreview} onPress={() => {void preview();}}>Examiner toutes les sources actuelles de cette commande</Button>
    {attempts.map(a => <View key={a.command.transactionId} style={styles.reference}>
      <Text selectable style={styles.caption}>Intention conservée : {a.requestId} · commande : {a.command.transactionId}</Text>
      <Text style={styles.body}>{labels[a.command.action]} · motif privé : {a.command.reason}</Text>
      <Text selectable style={styles.caption}>Source : {a.command.source.orderRevision} · {a.command.source.orderSourceHash} · ensemble : {a.command.source.caseSetHash}</Text>
      <Button variant="secondary" disabled={busy} onPress={() => {void run(a, 'observe');}}>Relire cette intention exacte</Button>
    </View>)}
    {current ? <>
      <Text selectable style={styles.caption}>Source commande : {current.preview.source.orderRevision} · {current.preview.source.orderSourceHash} · ensemble : {current.preview.source.caseSetHash}</Text>
      <Text style={styles.caption}>Cas examinés dans cet aperçu : {current.preview.coverage.inspected}. {current.preview.coverage.completeCurrentCaseSet ? 'L’ensemble actuellement attribué est complet dans cette lecture bornée.' : 'L’ensemble dépasse la limite de lecture : une fermeture n’est pas proposée.'} L’historique des risques n’est pas certifié exhaustif.</Text>
      <View style={styles.list}><FlashList data={current.preview.cases} keyExtractor={referenceKey} renderItem={renderReference} nestedScrollEnabled /></View>
      {current.preview.options.map(action => <Button key={action} variant={current.action === action ? 'primary' : 'secondary'}
        disabled={busy || (action === 'retain_review' ? !current.preview.canRetainReview : !current.preview.canCloseOwnReview)}
        onPress={() => setDraft({...current, action, confirmed: false})}>{labels[action]}</Button>)}
      <TextInput value={current.reason} onChangeText={reason => setDraft({...current, reason, confirmed: false})} maxLength={2000} multiline editable={!busy}
        placeholder="Motif privé de la décision humaine" placeholderTextColor={colors.muted} style={styles.input} />
      <Checkbox checked={current.confirmed} disabled={busy || !current.action || !current.reason.trim()}
        onToggle={() => setDraft({...current, confirmed: !current.confirmed})}>
        <Text style={styles.caption}>J’ai examiné toutes les références et leurs observations. Je confirme cette action et ce motif pour ces sources exactes. Une fermeture concerne seulement cette revue ; elle ne prouve aucune fraude ou exonération et n’autorise ni fonds, sanction, expédition ou remise en vente.</Text>
      </Checkbox>
      <Button variant="secondary" disabled={busy || !current.confirmed || !current.action || !current.reason.trim()}
        onPress={() => {if (current.action && current.confirmed) void run({version: 1, uid, requestId: current.requestId, command: {transactionId: current.preview.transactionId,
          source: {...current.preview.source}, action: current.action, reason: current.reason.trim(), acknowledged: true}}, 'execute');}}>Enregistrer cette intention humaine</Button>
      <Button variant="ghost" disabled={busy} onPress={() => setDraft(null)}>Fermer l’aperçu sans envoyer</Button>
    </> : null}
    {currentResult ? <>
      <Text selectable style={styles.caption}>Reçu de la référence {currentResult.attempt.requestId} · commande {currentResult.receipt.transactionId}.</Text>
      <Text style={styles.body}>{currentResult.receipt.state === 'unrecorded' ? 'Aucun reçu natif enregistré ; l’intention reste conservée.' :
        currentResult.receipt.state === 'not_executed' ? 'Cette intention n’a pas été exécutée. Un nouveau contexte exige un nouvel examen après acquittement du reçu.' : 'La décision humaine et son reçu natif sont enregistrés pour les sources d’origine.'}</Text>
      {currentResult.receipt.state === 'not_executed' && currentResult.receipt.reason ? <Text style={styles.caption}>{refusalLabels[currentResult.receipt.reason]}</Text> : null}
      {currentResult.receipt.state === 'committed' ? <Text style={styles.caption}>{currentResult.receipt.ownMarkerRemovedAtCommit ? 'Le marqueur propre à cette revue a été retiré lors de cet enregistrement.' : 'Ce reçu ne constate pas le retrait du marqueur propre à cette revue.'} Il s’agit d’un résultat historique, sans preuve de la permission actuelle ni levée des autres dossiers.</Text> : null}
      {currentResult.receipt.state === 'unrecorded' ? <Button variant="secondary" disabled={busy} onPress={() => Alert.alert('Neutraliser cette intention',
        'Cette action conserve la même référence et bloque une exécution tardive non engagée. Elle ne modifie pas une décision déjà enregistrée ; son reçu original serait relu.',
        [{text: 'Retour', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void run(currentResult.attempt, 'neutralize');}}])}>Neutraliser explicitement cette intention</Button> :
        <Button variant="secondary" disabled={busy} onPress={() => {void run(currentResult.attempt, 'acknowledge');}}>Terminer ce suivi après une nouvelle lecture native</Button>}
    </> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, reference: {gap: spacing.sm, paddingVertical: spacing.sm},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  input: {...typography.bodySmall, color: colors.foreground, padding: spacing.md, borderWidth: 1, borderColor: colors.border, minHeight: spacing['4xl']}, list: {height: spacing.xl * 9}});
