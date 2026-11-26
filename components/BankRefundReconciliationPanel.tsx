import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {useRef, useState, type ComponentType} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {useInfiniteQuery, useQueryClient} from '@tanstack/react-query';
import {randomUUID} from 'expo-crypto';
import {Button, Checkbox} from '@/components/ui';
import {BankRefundReconciliationLimits} from '@/components/BankRefundReconciliationLimits';
import {BankRefundReconciliationFacts, bankRefundReconciliationFacts} from '@/components/BankRefundReconciliationFacts';
import {BankRefundReconciliationReceiptSummary} from '@/components/BankRefundReconciliationReceiptSummary';
import {BankRefundReconciliationCommandHistory} from '@/components/BankRefundReconciliationCommandHistory';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {BankRefundReconciliationService} from '@/services/bankRefundReconciliationService';
import {BankRefundReconciliationJournal} from '@/services/bankRefundReconciliationJournal';
import {productReviewEqual} from '@/services/productReviewService';
import {BANK_REFUND_RECONCILIATION_ENABLED} from '@/config/featureFlags';
import {createBankRefundReconciliationInteraction} from '@/utils/bankRefundReconciliationContract';
import {BANK_REFUND_RECONCILIATION_CAPABILITY, type BankRefundReconciliationAttempt, type BankRefundReconciliationCommand, type BankRefundReconciliationHistoryRow, type BankRefundReconciliationReceipt, type BankRefundReconciliationReference} from '@/types/bankRefundReconciliation';
import {colors, spacing, typography} from '@/constants/theme';

export interface BankRefundReconciliationReauthenticationProps {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void; purpose?: 'commercial' | 'bank_review'; parcel?: boolean}
export interface BankRefundReconciliationPanelProps {
  uid: string; transactionId: string; disputeId: string; sourceKey: string; assertSelection: () => void;
  ReauthenticationComponent: ComponentType<BankRefundReconciliationReauthenticationProps>;
}
type PageParam = {cursor: {lastId: string}; sourceHash: string} | null;
type HistoryItem = {row: BankRefundReconciliationHistoryRow; disabled: boolean; onSelect: (reference: BankRefundReconciliationReference) => void};
const historyKey = (item: HistoryItem) => item.row.qualification === 'unknown' ? item.row.entryId : item.row.reference.id;
const renderHistory = ({item}: {item: HistoryItem}) => item.row.qualification === 'unknown' ? <Text style={styles.caption}>Entrée {item.row.entryId} : origine documentaire inconnue.</Text> : <View style={styles.section}>
  <Text selectable style={styles.caption}>{item.row.entry.kind === 'report' ? 'Rapport observé' : 'Instruction documentaire'} · {item.row.reference.id} · {item.row.entry.recordedAt}</Text>
  {item.row.entry.kind === 'report' ? <><Text style={styles.caption}>Qualification du graphe : {item.row.entry.report.qualification}. Concordance des sources à l’enregistrement : {item.row.entry.nativeSourceMatchesAtCommit ? 'oui' : 'inconnue ou changée'}.</Text><Button variant="secondary" disabled={item.disabled} onPress={() => {if (item.row.qualification === 'native_documentary_entry') item.onSelect(item.row.reference);}}>Choisir et lire ce rapport exact</Button></> : <Text selectable style={styles.caption}>{item.row.entry.instruction} · {item.row.entry.motivation}. Aucun effet financier autorisé.</Text>}
</View>;
const instructionLabels: Record<NonNullable<BankRefundReconciliationCommand['instruction']>, string> = {missing_evidence: 'Pièces ou preuves manquantes', reconciliation_documented: 'Rapprochement documentaire consigné', financial_review_preparation: 'Préparation d’un examen financier — non exécutable'};

export function BankRefundReconciliationPanel({uid, transactionId, disputeId, sourceKey, assertSelection, ReauthenticationComponent}: BankRefundReconciliationPanelProps) {
  const base = useLabelLifecycleContext(`bank-financial-report:${transactionId}:${disputeId}:${sourceKey}`, uid), client = useQueryClient();
  const [revision, setRevision] = useState(0), [selected, setSelected] = useState<BankRefundReconciliationReference | null>(null);
  const nativeFrame = useShippingPurchaseContext(`bank-financial-native:${transactionId}:${disputeId}:${sourceKey}:${revision}`, uid), nativeKey = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, disputeId, sourceKey, nativeFrame.focusRevision, revision, selected]);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, disputeId, sourceKey, base.focusRevision, revision, selected]);
  const [frame, setFrame] = useState(() => ({key, interaction: createBankRefundReconciliationInteraction()}));
  let liveFrame = frame;
  if (frame.key !== key) {frame.interaction.invalidate(); liveFrame = {key, interaction: createBankRefundReconciliationInteraction()}; setFrame(liveFrame);}
  const choice = liveFrame.interaction.capture(), [authenticated, setAuthenticated] = useState<string | null>(null), [unavailable, setUnavailable] = useState<string | null>(null);
  const guardChoice = () => {base.capture(); assertSelection(); choice();};
  let parentCurrent = false; try {guardChoice(); parentCurrent = true;} catch {/* Entire private projection is masked. */}
  const enabled = parentCurrent && base.focused && BANK_REFUND_RECONCILIATION_ENABLED && authenticated === nativeKey && unavailable !== key;
  const queryKey = ['bank-financial-private-report', key];
  const q = useInfiniteQuery({queryKey, enabled, initialPageParam: null as PageParam, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({pageParam}) => {const op = base.capture(), current = () => {base.assertCurrent(op); guardChoice();}; return BankRefundReconciliationService.read(uid, transactionId, disputeId, 'history', current, pageParam?.sourceHash ?? null, selected, pageParam?.cursor ?? null);},
    getNextPageParam: page => page.nextCursor ? {cursor: page.nextCursor, sourceHash: page.source.sourceHash} : undefined});
  const readable = enabled && q.isSuccess && !q.isFetching && !q.isError;
  const source = readable ? q.data.pages[0] : null;
  const rows = readable ? q.data.pages.flatMap(p => p.rows) : [];
  const ids = rows.map(r => r.qualification === 'unknown' ? r.entryId : r.reference.id);
  const coherent = source !== null && new Set(ids).size === ids.length && q.data?.pages.every(p => p.source.sourceHash === source.source.sourceHash) === true;
  const historyComplete = readable && coherent && !q.hasNextPage && q.data.pages.length > 0 && q.data.pages.at(-1)?.nextCursor === null &&
    rows.every(row => row.qualification === 'native_documentary_entry') && q.data.pages.every((page, index) => {
      const param = q.data.pageParams[index], previous = q.data.pages[index - 1];
      return page.coverage !== null && page.coverage.inspected === page.rows.length && page.coverage.hasMore === (page.nextCursor !== null) &&
        (index === 0 ? param === null : previous.nextCursor !== null && productReviewEqual(param, {sourceHash: source?.source.sourceHash, cursor: previous.nextCursor}));
    });
  const assertRead = () => {
    guardChoice(); const state = client.getQueryState(queryKey);
    if (!coherent || !readable || !state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.error !== null || state.isInvalidated || state.data !== q.data || state.dataUpdatedAt !== q.dataUpdatedAt) throw new Error('La source privée et la sélection du rapport doivent être requalifiées.');
  };
  const facts = source && coherent ? bankRefundReconciliationFacts(source) : [];
  if (source && coherent) {
    // These are actual displayed history facts, not an acknowledgment inferred from their hash.
    const addHistoryFact = (id: string, label: string, value: string) => {
      for (let offset = 0; offset < value.length; offset += 180) facts.push({id: `history:${id}:${offset}`, label, value: value.slice(offset, offset + 180)});
    };
    q.data?.pages.forEach((page, index) => addHistoryFact(`page:${index}`, `Historique · page ${index + 1} · couverture native`, JSON.stringify({sourceHash: page.source.sourceHash, coverage: page.coverage, nextCursor: page.nextCursor})));
    rows.forEach((row, index) => {
      if (row.qualification === 'unknown') {addHistoryFact(`unknown:${index}:${row.entryId}`, `Historique · entrée ${index + 1}`, `${row.entryId} · Origine inconnue : une nouvelle instruction reste bloquée.`); return;}
      const entry = row.entry, prefix = `${index}:${row.reference.id}`;
      addHistoryFact(`${prefix}:reference`, `Historique · entrée ${index + 1} · référence native`, `${row.qualification} · ${row.reference.id} · ${row.reference.contentHash}`);
      addHistoryFact(`${prefix}:identity`, `Historique · entrée ${index + 1} · auteur et intention`, `${entry.actorId} · ${entry.requestId} · commande ${entry.transactionId} · dossier ${entry.disputeId}`);
      addHistoryFact(`${prefix}:action`, `Historique · entrée ${index + 1} · acte et date`, `${entry.kind === 'report' ? 'Rapport observé par GET' : 'Instruction documentaire'} · ${entry.command.action} · ${entry.recordedAt}`);
      addHistoryFact(`${prefix}:source`, `Historique · entrée ${index + 1} · source native du document`, entry.nativeSourceHash);
      addHistoryFact(`${prefix}:note`, `Historique · entrée ${index + 1} · motivation privée`, entry.command.note);
      if (entry.kind === 'report') addHistoryFact(`${prefix}:report`, `Historique · entrée ${index + 1} · portée du rapport`, JSON.stringify({qualification: entry.report.qualification, reasons: entry.report.reasons, startedAt: entry.report.startedAt, observedAt: entry.report.observedAt, nativeSourceMatchesAtCommit: entry.nativeSourceMatchesAtCommit, currentNativeSourceHash: entry.currentNativeSourceHash, coverage: entry.report.coverage, financialExecutionAllowed: false}));
      else addHistoryFact(`${prefix}:instruction`, `Historique · entrée ${index + 1} · instruction non exécutable`, JSON.stringify({instruction: entry.instruction, reportReference: entry.reportReference, reportCorpusHash: entry.reportCorpusHash, documentaryOnly: entry.documentaryOnly, financialExecutionAllowed: false}));
    });
  }
  const factKey = JSON.stringify([key, q.dataUpdatedAt, source?.source.sourceHash, source?.selectedEntry?.id]);
  const [seen, setSeen] = useState<{key: string; ids: string[]}>({key: '', ids: []});
  const seenIds = new Set(seen.key === factKey ? seen.ids : []), allSeen = facts.length > 0 && facts.every(f => seenIds.has(f.id));
  const [form, setForm] = useState<{key: string; action: BankRefundReconciliationCommand['action']; instruction: NonNullable<BankRefundReconciliationCommand['instruction']>; note: string; examined: boolean}>({key: factKey, action: 'capture_report', instruction: 'missing_evidence', note: '', examined: false});
  const currentForm = form.key === factKey ? form : {key: factKey, action: 'capture_report' as const, instruction: 'missing_evidence' as const, note: '', examined: false};
  const formKey = JSON.stringify([factKey, currentForm]), [formFrame, setFormFrame] = useState(() => ({key: formKey, interaction: createBankRefundReconciliationInteraction()}));
  let liveForm = formFrame;
  if (formFrame.key !== formKey) {formFrame.interaction.invalidate(); liveForm = {key: formKey, interaction: createBankRefundReconciliationInteraction()}; setFormFrame(liveForm);}
  const formFence = liveForm.interaction.capture(), lock = useRef(false), [busy, setBusy] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{key: string; value: BankRefundReconciliationReceipt} | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const changeForm = (patch: Partial<Omit<typeof currentForm, 'key'>>) => {try {assertRead(); liveForm.interaction.invalidate(); setForm({...currentForm, ...patch, key: factKey});} catch {/* No stale form change. */}};
  const onSeen = (visible: string[]) => {try {assertRead(); const allowed = new Set(facts.map(f => f.id)); setSeen(old => ({key: factKey, ids: [...new Set([...(old.key === factKey ? old.ids : []), ...visible.filter(id => allowed.has(id))])]}));} catch {/* Old viewport callbacks cannot mark a new corpus as read. */}};
  const chooseReport = (reference: BankRefundReconciliationReference | null) => {try {assertRead(); if (reference && !rows.some(r => r.qualification === 'native_documentary_entry' && r.entry.kind === 'report' && productReviewEqual(r.reference, reference))) throw new Error('Rapport natif absent.'); liveFrame.interaction.invalidate(); setSelected(reference); setAuthenticated(null); setRevision(n => n + 1);} catch {/* Last synchronous native choice wins. */}};
  const canRecord = source?.source.qualification === 'native_current' && historyComplete && allSeen && currentForm.examined && !!currentForm.note.trim() && (currentForm.action === 'capture_report' || source.selectedEntry?.kind === 'report' && selected !== null && rows.some(row => row.qualification === 'native_documentary_entry' && row.entry.kind === 'report' && productReviewEqual(row.reference, selected) && row.entry.id === source.selectedEntry?.id) && source.selectedEntry.nativeSourceMatchesAtCommit && source.selectedEntry.nativeSourceHash === source.source.sourceHash && (currentForm.instruction !== 'reconciliation_documented' || source.selectedEntry.report.qualification === 'complete_referenced_manifest' && source.source.capture.localCoverageQualified));
  const submit = async () => {
    if (lock.current || !canRecord || !source || !BANK_REFUND_RECONCILIATION_ENABLED) return;
    let op; try {op = base.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(key); setNotice(null);
    const current = () => {base.assertCurrent(op); assertRead(); formFence(); if (!historyComplete || !canRecord) throw new Error('Toutes les pages et les références historiques qualifiées doivent être consultées avant une nouvelle instruction.');};
    const command: BankRefundReconciliationCommand = {action: currentForm.action, sourceHash: source.source.sourceHash, reportReference: currentForm.action === 'record_instruction' ? selected : null, instruction: currentForm.action === 'record_instruction' ? currentForm.instruction : null, note: currentForm.note.trim(), acknowledged: true};
    const a: BankRefundReconciliationAttempt = {version: 1, uid, transactionId, disputeId, requestId: randomUUID(), capability: BANK_REFUND_RECONCILIATION_CAPABILITY, command};
    try {
      current(); const r = await BankRefundReconciliationJournal.execute(a, current, async () => {
        current(); const fresh = await BankRefundReconciliationService.read(uid, transactionId, disputeId, 'preview', current, command.sourceHash, command.reportReference); current();
        if (!BANK_REFUND_RECONCILIATION_ENABLED || fresh.source.qualification !== 'native_current' || !allSeen || !currentForm.examined || command.action === 'record_instruction' && (!fresh.selectedEntry || fresh.selectedEntry.kind !== 'report' || !fresh.selectedEntry.nativeSourceMatchesAtCommit || fresh.selectedEntry.nativeSourceHash !== command.sourceHash)) throw new Error('La source et le rapport exact doivent être examinés à nouveau.');
      });
      current(); setReceipt({key, value: r});
      if (r.state === 'received') {current(); liveForm.interaction.invalidate(); setForm({...currentForm, key: '', examined: false, note: ''}); void q.refetch();}
    } catch (error) {try {current(); liveFrame.interaction.invalidate(); setUnavailable(key); setNotice({key, text: error instanceof Error ? error.message : 'Observez la même intention depuis votre journal documentaire.'});} catch {/* No callback from a superseded NEW form. */}}
    finally {base.finish(op); lock.current = false; void client.invalidateQueries({queryKey: ['bank-financial-sdk-journal', uid]}); if (base.isCurrent(op)) setBusy(null);}
  };
  return <View style={styles.section}><BankRefundReconciliationCommandHistory uid={uid}/><BankRefundReconciliationLimits/>
    <ReauthenticationComponent uid={uid} sourceKey={`bank-financial:${nativeKey}`} purpose="bank_review" parcel disabled={!parentCurrent || !base.focused || q.isFetching || busy === key || !BANK_REFUND_RECONCILIATION_ENABLED} onVerified={() => {setAuthenticated(nativeKey);}}/>
    {source && coherent ? <>
      <Text selectable style={styles.caption}>Source actuelle {source.source.qualification} · lecture {source.readAt}. Les rapports précédents sont historiques ; leurs qualifications ne constituent aucune permission actuelle.</Text>
      <View style={styles.historyViewport}><FlashList data={rows.map(row => ({row, disabled: busy === key, onSelect: chooseReport}))} keyExtractor={historyKey} renderItem={renderHistory} nestedScrollEnabled/></View>
      {q.hasNextPage ? <Button variant="secondary" disabled={q.isFetching || busy === key} onPress={() => {try {assertRead(); liveForm.interaction.invalidate(); void q.fetchNextPage();} catch {/* Changed source blocks pagination. */}}}>Lire la page suivante de l’historique documentaire</Button> : <Text style={styles.caption}>Fin de la portion historique parcourue. Aucune exhaustivité externe ou arrivée bancaire n’est certifiée.</Text>}
      {!historyComplete ? <Text style={styles.caption}>Nouvelle instruction bloquée : l’historique doit être parcouru jusqu’à son curseur final, sans entrée inconnue, doublon ou erreur. Les références et résumés qualifiés doivent ensuite être réellement consultés avec le corpus sélectionné.</Text> : null}
      {selected ? <Button variant="secondary" disabled={busy === key} onPress={() => chooseReport(null)}>Revenir à une nouvelle capture distincte</Button> : null}
      <Text style={styles.caption}>Faits du corpus sélectionné effectivement affichés : {seenIds.size} / {facts.length}. Faites défiler les identités, associations, qualifications, couvertures et montants séparés avant de confirmer leur examen. Les montants sont en cents, dans la devise de chaque objet ou groupe. Une ligne inconnue reste inconnue.</Text>
      <BankRefundReconciliationFacts key={factKey} facts={facts} onSeen={onSeen}/>
      <Button variant="secondary" disabled={busy === key} onPress={() => changeForm({action: 'capture_report', examined: false})}>Choisir une nouvelle capture documentaire par GET</Button>
      {source.selectedEntry?.kind === 'report' ? <Button variant="secondary" disabled={busy === key} onPress={() => changeForm({action: 'record_instruction', examined: false})}>Choisir une instruction sur ce rapport exact</Button> : null}
      <Text style={styles.body}>{currentForm.action === 'capture_report' ? 'Nouvelle capture du graphe prestataire — lectures uniquement' : 'Instruction documentaire sur le rapport sélectionné'}</Text>
      {currentForm.action === 'record_instruction' ? (Object.keys(instructionLabels) as NonNullable<BankRefundReconciliationCommand['instruction']>[]).map(instruction => <Button key={instruction} variant="secondary" disabled={busy === key} onPress={() => changeForm({instruction, examined: false})}>{currentForm.instruction === instruction ? 'Choix actuel : ' : ''}{instructionLabels[instruction]}</Button>) : null}
      <TextInput multiline maxLength={2000} value={currentForm.note} editable={busy !== key} onChangeText={note => changeForm({note, examined: false})} style={styles.input} placeholder="Motivation privée et limites de l’examen" placeholderTextColor={colors.muted} accessibilityLabel="Motivation privée documentaire"/>
      <Checkbox checked={currentForm.examined} disabled={busy === key || !historyComplete || !allSeen} onToggle={() => changeForm({examined: !currentForm.examined})}><Text style={styles.caption}>J’ai consulté les références et résumés historiques qualifiés de toutes les pages ainsi que tous les faits du corpus sélectionné, y compris les inconnus et limites de couverture. Cette instruction reste documentaire et non exécutable.</Text></Checkbox>
      <Button disabled={busy === key || !canRecord} onPress={() => void submit()}>{currentForm.action === 'capture_report' ? 'Enregistrer l’intention puis observer le rapport' : 'Consigner cette instruction documentaire'}</Button>
    </> : <Text style={styles.caption}>{q.isFetching ? 'Qualification privée du rapport en cours…' : q.isError ? 'Le rapport privé est masqué : accès, source ou pagination à requalifier.' : 'Le rapport privé sera présenté après qualification actuelle de la sélection et de votre session.'}</Text>}
    {receipt?.key === key ? <BankRefundReconciliationReceiptSummary value={receipt.value}/> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    <Button variant="secondary" disabled={!parentCurrent || !base.focused || busy === key || q.isFetching} onPress={() => {try {guardChoice(); liveFrame.interaction.invalidate(); setAuthenticated(null); setRevision(n => n + 1);} catch {/* No old selection may restart private reading. */}}}>Requalifier et relire la source depuis le début</Button>
    {!BANK_REFUND_RECONCILIATION_ENABLED ? <Text style={styles.caption}>Nouvelles lectures et instructions H19 en préparation. Votre propre journal documentaire reste accessible séparément.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, historyViewport: {height: spacing['4xl'] * 4}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
