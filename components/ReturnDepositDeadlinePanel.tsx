import {useRef, useState, type ComponentType} from 'react';
import {StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useRouter} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import {Button, Checkbox} from '@/components/ui';
import {ReturnDepositDeadlineFacts, returnDepositDeadlineFacts} from '@/components/ReturnDepositDeadlineFacts';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {ReturnDepositDeadlineService as Service, returnDepositDeadlineFailure} from '@/services/returnDepositDeadlineService';
import {ReturnDepositDeadlineJournal as Journal} from '@/services/returnDepositDeadlineJournal';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {createReturnDepositInteraction, returnDepositProposedDate, returnDepositText, formatReturnDepositDate} from '@/utils/returnDepositDeadlineContract';
import {RETURN_DEPOSIT_DEADLINE_CAPABILITY, type ReturnDepositDeadlineAttempt, type ReturnDepositDeadlineCommand, type ReturnDepositDeadlineReceipt, type ReturnDepositDeadlineScope} from '@/types/returnDepositDeadline';
import {colors, spacing, typography} from '@/constants/theme';

export interface ReturnDepositDeadlineReauthenticationProps {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void; purpose?: 'commercial'; parcel?: boolean}
export interface ReturnDepositDeadlinePanelProps {
  compact?: boolean; uid: string; transactionId: string; scope: ReturnDepositDeadlineScope; sourceKey: string;
  assertSelection?: () => void; onRecorded?: () => void;
  ReauthenticationComponent?: ComponentType<ReturnDepositDeadlineReauthenticationProps>;
}
const receiptLabel = {absent: 'Le résultat de cette intention reste inconnu. Aucun nouvel envoi de la prolongation ne sera effectué.', committed: 'Cette instruction documentaire est enregistrée. Elle ne décide ni faute, ni expédition, ni remboursement.', not_executed: 'Cette intention n’a pas été exécutée. Le reçu conserve la raison observée.', neutralized: 'Cette intention a été neutralisée avant exécution.'};
export function ReturnDepositDeadlinePanel({uid, transactionId, scope, sourceKey, assertSelection, onRecorded, ReauthenticationComponent, compact=false}: ReturnDepositDeadlinePanelProps) {
  const viewport = useWindowDimensions(), router = useRouter(), client = useQueryClient();
  const base = useLabelLifecycleContext(JSON.stringify(['return-deposit-deadline', transactionId, sourceKey]), uid);
  const [revision, setRevision] = useState(0), key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, scope, sourceKey, base.focusRevision, revision, viewport.width, viewport.height, viewport.fontScale]);
  const [frame, setFrame] = useState(() => ({key, interaction: createReturnDepositInteraction()})); let liveFrame = frame;
  if (frame.key !== key) {frame.interaction.invalidate(); liveFrame = {key, interaction: createReturnDepositInteraction()}; setFrame(liveFrame);}
  const choice = liveFrame.interaction.capture(), identity = () => {base.capture(); choice();}, selection = () => {identity(); assertSelection?.();};
  const [authenticated, setAuthenticated] = useState<string | null>(null);
  const ownKey = ['return-deposit-deadline-journal', key];
  // Own SDK receipt recovery precedes private-order, role and reauthentication admission.
  const own = useQuery({queryKey: ownKey, enabled: base.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = base.capture(), current = () => {base.assertCurrent(op); choice();};
      const attempt = await Journal.read(uid, transactionId, current); current(); const receipt = attempt ? await Journal.observe(attempt, current) : null; current(); return {attempt, receipt};}});
  const ownReady = base.focused && own.isSuccess && own.fetchStatus === 'idle' && !own.isError && client.getQueryState(ownKey)?.isInvalidated === false;
  const attempt = ownReady ? own.data.attempt : null, ownReceipt = ownReady ? own.data.receipt : null;
  let parentCurrent = false; try {selection(); parentCurrent = true;} catch { /* Own servicing does not inherit a parent admission failure. */ }
  const allowed = parentCurrent && ownReady && attempt === null && (scope === 'owner' || authenticated === key);
  const previewKey = ['return-deposit-deadline-preview', key];
  const preview = useQuery({queryKey: previewKey, enabled: allowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = base.capture(); return Service.preview(uid, transactionId, scope, () => {base.assertCurrent(op); selection();});}});
  const ready = allowed && preview.isSuccess && preview.fetchStatus === 'idle' && !preview.isError && client.getQueryState(previewKey)?.isInvalidated === false;
  const source = ready ? preview.data : null;
  const assertQuery = (qKey: readonly unknown[], data: unknown, updatedAt: number) => {
    const state = client.getQueryState(qKey);
    if (!state || state.status !== 'success' || state.fetchStatus !== 'idle' || state.error !== null || state.isInvalidated || state.data !== data || state.dataUpdatedAt !== updatedAt) throw returnDepositDeadlineFailure();
  };
  const assertOwn = () => {identity(); if (!ownReady) throw returnDepositDeadlineFailure(); assertQuery(ownKey, own.data, own.dataUpdatedAt);};
  const assertRead = () => {assertOwn(); selection(); if (!ready) throw returnDepositDeadlineFailure(); assertQuery(previewKey, preview.data, preview.dataUpdatedAt);};
  const sourceFormKey = JSON.stringify([key, preview.dataUpdatedAt, source?.source]);
  const [form, setForm] = useState({key: sourceFormKey, utcDate: '', motivation: '', partyMessage: '', acknowledged: false});
  const currentForm = form.key === sourceFormKey ? form : {key: sourceFormKey, utcDate: '', motivation: '', partyMessage: '', acknowledged: false};
  const formKey = JSON.stringify([sourceFormKey, currentForm]), [formFrame, setFormFrame] = useState(() => ({key: formKey, interaction: createReturnDepositInteraction()})); let liveForm = formFrame;
  if (formFrame.key !== formKey) {formFrame.interaction.invalidate(); liveForm = {key: formKey, interaction: createReturnDepositInteraction()}; setFormFrame(liveForm);}
  const formFence = liveForm.interaction.capture(), dueAtMs = returnDepositProposedDate(currentForm.utcDate);
  const facts = source ? returnDepositDeadlineFacts(source, scope === 'operator' ? {dueAtMs, motivation: currentForm.motivation.trim(), partyMessage: currentForm.partyMessage.trim()} : null) : [];
  const factsKey = JSON.stringify([sourceFormKey, currentForm.utcDate, currentForm.motivation, currentForm.partyMessage]);
  const [seen, setSeen] = useState<{key: string; ids: string[]}>({key: '', ids: []});
  const seenIds = new Set(seen.key === factsKey ? seen.ids : []), allSeen = facts.length > 0 && facts.every(f => seenIds.has(f.id));
  const lock = useRef(false), [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const [result, setResult] = useState<{key: string; receipt: ReturnDepositDeadlineReceipt} | null>(null);
  const change = (patch: Partial<Omit<typeof currentForm, 'key'>>) => {try {assertRead(); formFence(); liveForm.interaction.invalidate(); setForm({...currentForm, ...patch, key: sourceFormKey});} catch { /* A stale source cannot edit a new instruction. */ }};
  const onSeen = (ids: string[]) => {try {assertRead(); formFence(); const available = new Set(facts.map(f => f.id)); setSeen(old => ({key: factsKey, ids: [...new Set([...(old.key === factsKey ? old.ids : []), ...ids.filter(id => available.has(id))])]}));} catch { /* Old source/form viewport grants no read mark. */ }};
  const refresh = () => {try {identity(); liveFrame.interaction.invalidate(); liveForm.interaction.invalidate(); setAuthenticated(null); setRevision(v => v + 1);} catch { /* Old callbacks cannot refresh a replacement selection. */ }};
  const canExtend = scope === 'operator' && authenticated === key && source?.canExtend === true && !!source.clock && !!source.currentLabelId && dueAtMs !== null &&
    dueAtMs > Date.parse(source.clock.dueAt ?? source.clock.availableAt) && returnDepositText(currentForm.motivation.trim()) && returnDepositText(currentForm.partyMessage.trim());
  const submit = async () => {
    if (lock.current || !canExtend || !source?.clock || !source.currentLabelId || dueAtMs === null || !allSeen || !currentForm.acknowledged) return;
    let op; try {op = base.start();} catch {return;} if (!op) return; lock.current = true; setBusy(key); setNotice(null);
    const current = () => {base.assertCurrent(op); assertRead(); formFence(); if (!canExtend || !allSeen || !currentForm.acknowledged) throw returnDepositDeadlineFailure();};
    const command: ReturnDepositDeadlineCommand = {action: 'extend', sourceHash: source.source.sourceHash, expectedVersion: source.clock.version, expectedLabelId: source.currentLabelId,
      newDueAtMs: dueAtMs, motivation: currentForm.motivation.trim(), partyMessage: currentForm.partyMessage.trim(), acknowledged: true};
    try {
      current(); const payloadHash = await productReviewHash(command); current();
      const a: ReturnDepositDeadlineAttempt = {version: 1, uid, transactionId, scope: 'operator', requestId: randomUUID(), capability: RETURN_DEPOSIT_DEADLINE_CAPABILITY, payloadHash, command};
      const receipt = await Journal.execute(a, current, async () => {current(); const fresh = await Service.preview(uid, transactionId, 'operator', current); current();
        if (!productReviewEqual(fresh, source) || !fresh.canExtend) throw returnDepositDeadlineFailure();});
      current(); setResult({key, receipt}); onRecorded?.();
    } catch (error) {if (base.isCurrent(op)) {try {choice(); setNotice({key, text: error instanceof Error ? error.message : returnDepositDeadlineFailure().message});} catch { /* Stale operation is masked. */ }}}
    finally {if (base.isCurrent(op)) {setBusy(null); void own.refetch(); void client.invalidateQueries({queryKey: previewKey});} base.finish(op); lock.current = false;}
  };
  const recover = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!attempt || lock.current) return; let op; try {op = base.start();} catch {return;} if (!op) return; lock.current = true; setBusy(key);
    const current = () => {base.assertCurrent(op); assertOwn();};
    try {current(); const receipt = await Journal[mode](attempt, current); current(); setResult({key, receipt}); if (mode === 'acknowledge') onRecorded?.();}
    catch (error) {if (base.isCurrent(op)) {try {choice(); setNotice({key, text: error instanceof Error ? error.message : returnDepositDeadlineFailure().message});} catch { /* Own old receipt never changes another dossier. */ }}}
    finally {if (base.isCurrent(op)) {setBusy(null); void own.refetch(); void client.invalidateQueries({queryKey: previewKey});} base.finish(op); lock.current = false;}
  };
  const consultation = () => {assertRead(); formFence(); liveForm.interaction.invalidate(); setForm({...currentForm, acknowledged: false});};
  if(compact&&scope==='owner'){
    const shortReceipt=(state:ReturnDepositDeadlineReceipt['state'])=>state==='committed'?'Le délai a été mis à jour.':state==='absent'?'L’envoi reste à vérifier.':state==='neutralized'?'Cette demande ne sera pas envoyée.':'Cette demande n’a pas été envoyée.';
    return <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>Date limite du retour</Text>
      {!ownReady?<Text accessibilityRole={own.isError?'alert':undefined} style={styles.caption}>{own.isError?'Impossible de retrouver votre demande.':'Chargement des dates…'}</Text>:attempt?<View style={styles.section}>
        <Text style={styles.body}>{ownReceipt?shortReceipt(ownReceipt.state):'L’envoi reste à vérifier.'}</Text>
        {attempt.command.action==='extend'?<><Text style={styles.body}>Date proposée : {formatReturnDepositDate(new Date(attempt.command.newDueAtMs!).toISOString())}</Text>{attempt.command.partyMessage?<Text style={styles.caption}>{attempt.command.partyMessage}</Text>:null}</>:null}
        <Button variant="secondary" disabled={busy===key} onPress={()=>void recover('observe')}>Vérifier ma demande</Button>
        {ownReceipt?.state==='absent'?<Button variant="ghost" disabled={busy===key} onPress={()=>void recover('neutralize')}>Arrêter cet envoi</Button>:null}
        {ownReceipt&&ownReceipt.state!=='absent'?<Button variant="ghost" disabled={busy===key} onPress={()=>void recover('acknowledge')}>Terminer ce suivi</Button>:null}
      </View>:null}
      {source?<>
        {source.clock&&source.qualification==='qualified'&&source.clock.currentLabelMatches&&source.clock.dueAt?<><Text style={styles.body}>À déposer avant le {formatReturnDepositDate(source.clock.dueAt)}</Text>{source.clock.reviewRequired?<Text style={styles.caption}>Seconde vérifie les informations de ce retour.</Text>:null}{source.clock.extensions.map((entry,index)=><View key={index} style={styles.section}><Text style={styles.body}>Délai prolongé jusqu’au {formatReturnDepositDate(entry.newDueAt)}</Text>{entry.partyMessage?<Text style={styles.caption}>{entry.partyMessage}</Text>:null}</View>)}</>:<Text style={styles.caption}>{source.qualification==='historical_terms_not_recorded'?'Contactez Seconde pour connaître le délai de cette ancienne demande.':'Le délai de ce retour doit encore être vérifié.'}</Text>}
      </>:allowed&&!attempt?<Text accessibilityRole={preview.isError?'alert':undefined} style={styles.caption}>{preview.isFetching?'Chargement des dates…':'Impossible de charger la date limite du retour.'}</Text>:null}
      {result?.key===key?<Text style={styles.caption}>{shortReceipt(result.receipt.state)}</Text>:null}
      {notice?.key===key?<Text accessibilityRole="alert" style={styles.caption}>Impossible de confirmer cette demande pour le moment. Vérifiez son état avant de réessayer.</Text>:null}
      <Button variant="ghost" disabled={!base.focused||busy===key} onPress={refresh}>Actualiser</Button>
      <Button variant="secondary" disabled={!base.focused||busy===key} onPress={()=>{try{identity();router.push({pathname:'/settings/support',params:{transactionId,kind:'commercial_late'}}as never);}catch{/* Support independently qualifies access. */}}}>Demander plus de temps</Button>
    </View>;
  }
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Délai de dépôt du retour</Text>
    <Text style={styles.body}>Pour les conditions acceptées de sept jours calendaires, le départ correspond à la première fourniture native du document. Une prolongation motivée reste possible. Dépasser ce délai ne décide ni faute ni remboursement.</Text>
    {!ownReady ? <Text accessibilityRole={own.isError ? 'alert' : undefined} style={styles.caption}>{own.isError ? 'Votre journal ou son reçu ne peut pas être relu. Aucune nouvelle instruction n’est envoyée.' : 'Lecture de votre journal et de son propre reçu…'}</Text> : attempt ? <View style={styles.section}>
      <Text selectable style={styles.caption}>Intention conservée {attempt.requestId} · {attempt.command.action === 'extend' ? 'Prolongation motivée' : 'Ancienne intention de mise à disposition'}</Text>
      <Text selectable style={styles.caption}>Source {attempt.command.sourceHash} · version {attempt.command.expectedVersion} · étiquette {attempt.command.expectedLabelId}.</Text>
      {attempt.command.action === 'extend' ? <><Text style={styles.caption}>Échéance de mon instruction : {formatReturnDepositDate(new Date(attempt.command.newDueAtMs!).toISOString())}.</Text><Text selectable style={styles.caption}>Ma motivation conservée : {attempt.command.motivation}</Text><Text selectable style={styles.caption}>Mon message aux membres : {attempt.command.partyMessage}</Text></> : null}
      <Text style={styles.body}>{ownReceipt ? receiptLabel[ownReceipt.state] : 'Résultat inconnu.'}</Text>
      {ownReceipt?.recordedAt ? <Text style={styles.caption}>Reçu natif : {formatReturnDepositDate(ownReceipt.recordedAt)}.</Text> : null}
      {ownReceipt?.reason ? <Text selectable style={styles.caption}>Raison native : {ownReceipt.reason}.</Text> : null}
      <Button variant="secondary" disabled={busy === key} onPress={() => void recover('observe')}>Relire exactement cette intention</Button>
      {ownReceipt?.state === 'absent' ? <Button variant="secondary" disabled={busy === key} onPress={() => void recover('neutralize')}>Neutraliser cette intention avant exécution</Button> : null}
      {ownReceipt && ownReceipt.state !== 'absent' ? <Button variant="secondary" disabled={busy === key} onPress={() => void recover('acknowledge')}>Reconnaître ce reçu après une nouvelle lecture</Button> : null}
    </View> : null}
    {scope === 'operator' && ownReady && !attempt && ReauthenticationComponent ? <ReauthenticationComponent uid={uid} sourceKey={`return-deposit:${key}`} purpose="commercial" parcel disabled={!parentCurrent || !base.focused || busy === key} onVerified={() => {try {selection(); setAuthenticated(key);} catch { /* Current identity does not grant another selection authority. */ }}}/> : null}
    {source ? <>
      <Text style={styles.body}>{source.qualification === 'qualified' ? 'L’horloge native de ce retour est qualifiée.' : source.qualification === 'historical_terms_not_recorded' ? 'Les conditions historiques ne qualifient aucun délai de dépôt rétroactif.' : 'L’horloge ou l’étiquette actuelle doit être rapprochée. Aucune date de départ n’est inventée.'}</Text>
      {source.clock ? <><Text style={styles.body}>Document fourni : {formatReturnDepositDate(source.clock.availableAt)}.</Text><Text style={styles.body}>Échéance native : {formatReturnDepositDate(source.clock.dueAt)}.</Text>
        {source.clock.reviewRequired ? <Text style={styles.caption}>Une revue est requise dans cette lecture serveur. L’échéance ne ferme aucun recours et ne confirme pas le dépôt du colis.</Text> : null}</> : null}
      <Text style={styles.caption}>La déclaration de réception du colis, les scans du transporteur, le contenu de l’article et les décisions financières restent des preuves distinctes.</Text>
      {scope === 'operator' && source.canExtend ? <View style={styles.section}>
        <Text style={styles.body}>Prolonger l’échéance existante sans déplacer son départ.</Text>
        <TextInput value={currentForm.utcDate} onChangeText={utcDate => change({utcDate, acknowledged: false})} editable={busy !== key} autoCapitalize="none" autoCorrect={false} style={styles.input} placeholder="2026-10-30T17:00:00.000Z" placeholderTextColor={colors.muted} accessibilityLabel="Nouvelle échéance exacte en UTC, format AAAA-MM-JJTHH:mm:ss.sssZ"/>
        <Text style={styles.caption}>{dueAtMs === null ? 'Saisissez une date UTC complète avec millisecondes et Z. L’heure de Toronto sera affichée avant confirmation.' : `Échéance proposée : ${formatReturnDepositDate(new Date(dueAtMs).toISOString())}.`}</Text>
        <TextInput value={currentForm.motivation} onChangeText={motivation => change({motivation, acknowledged: false})} multiline maxLength={2000} editable={busy !== key} style={styles.input} placeholder="Motivation privée de la prolongation" placeholderTextColor={colors.muted} accessibilityLabel="Motivation privée de la prolongation"/>
        <TextInput value={currentForm.partyMessage} onChangeText={partyMessage => change({partyMessage, acknowledged: false})} multiline maxLength={2000} editable={busy !== key} style={styles.input} placeholder="Message adressé aux deux membres" placeholderTextColor={colors.muted} accessibilityLabel="Message adressé aux deux membres"/>
      </View> : null}
      <Text style={styles.caption}>Faits affichés dans le lecteur : {seenIds.size} / {facts.length}. La motivation privée reste réservée aux opérateurs habilités.</Text>
      <ReturnDepositDeadlineFacts key={factsKey} facts={facts} onSeen={onSeen} onReviewOpened={consultation} onReviewClosed={() => {try {consultation();} catch { /* Closing an obsolete source grants nothing. */ }}}/>
      {scope === 'operator' && source.canExtend ? <>
        <Checkbox checked={currentForm.acknowledged} disabled={!allSeen || !canExtend || busy === key} onToggle={() => {if (allSeen && canExtend) change({acknowledged: !currentForm.acknowledged});}}><Text style={styles.body}>J’ai examiné les dates natives, les étiquettes, les prolongations, la nouvelle échéance et les deux textes. Je confirme seulement cette prolongation motivée, sans décision financière ou sur le contenu.</Text></Checkbox>
        <Button disabled={!canExtend || !allSeen || !currentForm.acknowledged || busy === key} onPress={() => void submit()}>Enregistrer cette prolongation motivée</Button>
      </> : null}
    </> : allowed && !attempt ? <Text accessibilityRole={preview.isError ? 'alert' : undefined} style={styles.caption}>{preview.isFetching ? 'Lecture du délai natif et des prolongations…' : 'Le délai ne peut pas être qualifié actuellement. Le propre journal reste accessible séparément.'}</Text> : null}
    {result?.key === key ? <Text style={styles.caption}>{receiptLabel[result.receipt.state]}</Text> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    <Button variant="secondary" disabled={!base.focused || busy === key} onPress={refresh}>Relire le délai et mon journal</Button>
    <Button variant="ghost" disabled={!base.focused || busy === key} onPress={() => {try {identity(); router.push({pathname: '/settings/support', params: {transactionId, kind: 'commercial_late'}} as never);} catch { /* The support route requalifies its own admission. */ }}}>Demander une revue ou une prolongation motivée</Button>
  </View>;
}
const styles = StyleSheet.create({card: {gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceWarm}, section: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
