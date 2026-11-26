import React, {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {randomUUID} from 'expo-crypto';
import {useRouter} from 'expo-router';
import {Button, Checkbox, Input} from '@/components/ui';
import {colors, radius, spacing, typography} from '@/constants/theme';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {MessageReportJournal} from '@/services/messageReportJournal';
import {MessageReportService} from '@/services/messageReportService';
import {ReportReasonLabels, type ReportReason} from '@/services/moderationService';
import {getAuthSessionGeneration} from '@/store/authStore';
import {staleTradeOperation} from '@/services/tradeOperation';
import type {MessageExposure, MessageExposureValue, MessageReportAttempt, MessageReportReceipt, MessageReportSelection} from '@/types/messageReportEvidence';
import {CONTENT_SAFETY_ENABLED, CONTENT_REASON_LABELS, type ContentSafetyReason, type ContentUrgency} from '@/types/contentSafety';
import {ContentSafetyPanel} from '@/components/ContentSafetyPanel';
const emptyExposure: MessageExposure = {linkOpened: 'unknown', informationShared: 'unknown', externalPaymentDeclared: 'unknown'};
const exposureFields = [{key: 'linkOpened', label: 'J’ai ouvert un lien demandé dans le message'}, {key: 'informationShared', label: 'J’ai partagé des renseignements'}, {key: 'externalPaymentDeclared', label: 'Je déclare avoir payé hors de Seconde'}] as const;
const exposureValues: {value: MessageExposureValue; label: string}[] = [{value: 'unknown', label: 'Je ne sais pas'}, {value: 'declared_yes', label: 'Oui'}, {value: 'declared_no', label: 'Non'}];
const reasons: ReportReason[] = ['scam', 'harassment', 'spam', 'inappropriate_content', 'other'];
const refusal = (reason: string | null) => ({requester_neutralized: 'Cet envoi a été annulé.', participant_session_unavailable: 'Reconnectez-vous pour poursuivre.', message_source_unavailable: 'Le message n’est plus disponible.', source_changed: 'Le message ou la commande a changé. Ouvrez à nouveau le signalement.', report_already_exists: 'Un signalement existe déjà pour ce message.', capture_identity_conflict: 'Votre signalement doit être vérifié par notre équipe.'}[reason ?? ''] ?? 'Le signalement n’a pas été envoyé.');
export function MessageReportPanel({selection, onDone}: {selection: MessageReportSelection; onDone: () => void}) {
  const uid = useAuthenticatedUid(), router = useRouter(), generation = getAuthSessionGeneration();
  const context = useLabelLifecycleContext(JSON.stringify(['message-report', selection]), uid);
  const interaction = useRef(0);
  const [reason, setReason] = useState<ReportReason|ContentSafetyReason>('scam'), [description, setDescription] = useState('');
  const [safety,setSafety]=useState(false),[urgency,setUrgency]=useState<ContentUrgency>('unknown'),[linkedReview,setLinkedReview]=useState('');
  const [exposure, setExposure] = useState<MessageExposure>({...emptyExposure}), [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [local, setLocal] = useState<MessageReportAttempt | null>(null), [receipt, setReceipt] = useState<MessageReportReceipt | null>(null);
  const [notice, setNotice] = useState(''), [working, setWorking] = useState(false), [neutralizing, setNeutralizing] = useState(false);
  const [previous, setPrevious] = useState({frame: context.frame, focus: context.focusRevision});
  if (previous.frame !== context.frame || previous.focus !== context.focusRevision) {setPrevious({frame: context.frame, focus: context.focusRevision}); setReceipt(null); setNotice(''); setWorking(false); setAcknowledged(null); setNeutralizing(false); setLocal(null);}
  const change = (apply: () => void) => {interaction.current++; setAcknowledged(null); setNeutralizing(false); apply();};
  const journal = useQuery({queryKey: ['message-report-journal', uid, selection.chatId, generation, context.focusRevision], enabled: !!uid && context.focused,
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = context.capture(); return MessageReportJournal.read(uid!, selection.chatId, () => context.assertCurrent(op));}});
  const ready = journal.isSuccess && !journal.isFetching && !journal.isError && context.focused;
  const pending = ready ? journal.data ?? local : local;
  const preview = useQuery({queryKey: ['message-report-preview', uid, selection, safety, linkedReview.trim(), generation, context.focusRevision], enabled: !!uid && context.focused && ready && !pending && !!selection.messageId && (!safety||CONTENT_SAFETY_ENABLED),
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = context.capture(),epoch=interaction.current; return MessageReportService.preview(uid!, selection.chatId, selection.messageId!, selection.transactionId, () => {context.assertCurrent(op);if(interaction.current!==epoch)throw staleTradeOperation();},safety?{linkedReviewId:linkedReview.trim()||null}:undefined);}});
  const source = context.focused && preview.isSuccess && !preview.isFetching && !preview.isError ? preview.data : null;
  const run = async (mode: 'execute' | 'observe' | 'neutralize' | 'acknowledge') => {
    if (!uid || !ready || working) return;
    let a = pending;
    if (!a) {if (mode !== 'execute' || acknowledged !== source?.previewId || source?.source.qualification !== 'native_message' || !source.previewId || !source.source.sourceHash || !source.source.sourceRevision || !selection.messageId) return;
      if(safety&&(!CONTENT_SAFETY_ENABLED||source.contentSafety?.capability!=='content_safety_v1'||source.contentSafety.linkedReviewId!==(linkedReview.trim()||null)||source.contentSafety.linkedReviewQualification==='unknown'))return;
      a = {version: 1, uid, requestId: randomUUID(), command: {chatId: selection.chatId, messageId: selection.messageId, transactionId: selection.transactionId,
        previewId: source.previewId, sourceHash: source.source.sourceHash, sourceRevision: source.source.sourceRevision, reason, description: description.trim() || null, exposure: {...exposure}, acknowledged: true,...(safety?{contentSafety:{protocol:'content_safety_statement_v1',urgency,linkedReviewId:linkedReview.trim()||null} as const}:{})}};}
    if (mode === 'neutralize' && (!neutralizing || receipt?.state !== 'unrecorded')) return;
    let op: ReturnType<typeof context.start>; try {op = context.start();} catch {return;} if (!op) return;
    const epoch = ++interaction.current;
    const assertCurrent = () => {context.assertCurrent(op); if (interaction.current !== epoch) throw staleTradeOperation();};
    setWorking(true); setNotice(''); if (mode === 'execute') setLocal(a);
    try {const result = await MessageReportJournal[mode](a, assertCurrent); assertCurrent(); setReceipt(result); setNeutralizing(false);
      setNotice(result.state === 'committed' ? 'Votre signalement a été reçu.' : result.state === 'not_executed' ? refusal(result.reason) : 'L’envoi reste à vérifier. Vérifiez son état ou reprenez-le.');
      if (mode === 'acknowledge') {setLocal(null); await journal.refetch(); assertCurrent(); onDone();} else {await journal.refetch(); assertCurrent();}
    } catch (error) {try {assertCurrent(); setReceipt(null); setNotice(error instanceof Error ? error.message : 'Le signalement reste à vérifier.'); await journal.refetch();} catch { /* The durable exact intention stays recoverable after a stale callback. */ }}
    finally {try {assertCurrent(); setWorking(false);} catch { /* New activity owns its own UI. */ } context.finish(op);}
  };
  return <View style={styles.card}>
    <Text style={styles.title}>Signaler ce message</Text>
    {journal.isError ? <><Text style={styles.body}>Impossible de vérifier votre dernier signalement.</Text><Button variant="secondary" onPress={() => {change(() => undefined); void journal.refetch();}}>Réessayer</Button></> : !ready ? <Text style={styles.body}>Chargement…</Text> : null}
    {CONTENT_SAFETY_ENABLED&&safety&&ready&&!pending?<Input label="Référence facultative de l’avis concerné" value={linkedReview} editable={!working} onChangeText={v=>change(()=>setLinkedReview(v))}/>:null}
    {pending ? <>
      <Text style={styles.title}>Suivi de votre signalement</Text>
      <Text style={styles.body}>Motif : {ReportReasonLabels[pending.command.reason as ReportReason] ?? CONTENT_REASON_LABELS[pending.command.reason as ContentSafetyReason] ?? pending.command.reason}{'\n'}{pending.command.description ?? 'Aucun détail ajouté.'}</Text>
      {pending.command.contentSafety?<Text style={styles.body}>Situation urgente : {pending.command.contentSafety.urgency === 'yes' ? 'oui' : pending.command.contentSafety.urgency === 'no' ? 'non' : 'à préciser'}.</Text>:null}
      {exposureFields.map(field => <Text key={field.key} style={styles.body}>{field.label} : {exposureValues.find(item => item.value === pending.command.exposure[field.key])?.label}</Text>)}
      <Button variant="secondary" disabled={working || !ready} onPress={() => {void run('observe');}}>Vérifier l’envoi</Button>
      <Button variant="secondary" disabled={working || !ready} onPress={() => {void run('execute');}}>Reprendre l’envoi</Button>
      {receipt?.state === 'unrecorded' ? neutralizing ? <><Text style={styles.body}>Si le signalement est déjà reçu, il sera conservé.</Text>
        <Button disabled={working} onPress={() => {void run('neutralize');}}>Confirmer l’annulation</Button><Button variant="secondary" disabled={working} onPress={() => change(() => setNeutralizing(false))}>Garder cet envoi</Button></> : <Button variant="secondary" disabled={working} onPress={() => change(() => setNeutralizing(true))}>Annuler cet envoi</Button> : null}
      {receipt && receipt.state !== 'unrecorded' ? <Button disabled={working} onPress={() => {void run('acknowledge');}}>Terminer</Button> : null}
    </> : ready && !selection.messageId ? <Text style={styles.body}>Aucun signalement en attente. Appuyez longuement sur un message pour le signaler.</Text> : ready ? <>
      {preview.isFetching ? <Text style={styles.body}>Chargement du message…</Text> : !source || source.source.qualification !== 'native_message' ? <Text style={styles.body}>Ce message n’est plus disponible. Revenez à la conversation pour réessayer.</Text> : <>
        <Text style={styles.title}>Message concerné</Text>
        <Text selectable style={styles.body}>{source.source.text ?? (source.source.imagePresent ? 'Photo envoyée dans la conversation.' : 'Offre sélectionnée.')}</Text>
        {source.source.order?.qualification === 'native_linked_order' ? <Button variant="secondary" disabled={working} onPress={() => {try {context.capture(); router.push({pathname: '/orders/[id]', params: {id: source.source.order!.transactionId!}});} catch { /* Destination requalifies access. */ }}}>Consulter la commande</Button> : selection.transactionId ? <Text style={styles.body}>La commande associée ne peut pas être vérifiée.</Text> : null}
        {CONTENT_SAFETY_ENABLED?<Button variant="secondary" disabled={working} onPress={()=>change(()=>{setSafety(!safety);setReason(safety?'scam':'review_pressure');setDescription('');})}>{safety?'Revenir aux autres motifs':'Déclarer une pression, une menace ou une divulgation'}</Button>:null}
        <Text style={styles.title}>Pourquoi signalez-vous ce message ?</Text>
        {safety?(Object.keys(CONTENT_REASON_LABELS) as ContentSafetyReason[]).map(value=><Button key={value} variant="secondary" disabled={working} onPress={()=>change(()=>setReason(value))}>{reason===value?'Choisi : ':''}{CONTENT_REASON_LABELS[value]}</Button>):reasons.map(value => <Button key={value} variant="secondary" disabled={working} onPress={() => change(() => setReason(value))}>{reason === value ? 'Choisi : ' : ''}{ReportReasonLabels[value]}</Button>)}
        <Input label="Décrivez le problème (facultatif)" multiline maxLength={safety?1000:2000} value={description} editable={!working} onChangeText={text => change(() => setDescription(text))} />
        {safety?<>{(['unknown','yes','no'] as const).map(value=><Button key={value} variant="secondary" disabled={working} onPress={()=>change(()=>setUrgency(value))}>{urgency===value?'Choisi : ':''}Situation urgente : {value==='yes'?'oui':value==='no'?'non':'je ne sais pas'}</Button>)}</>:null}
        {exposureFields.map(field => <View key={field.key} style={styles.group}><Text style={styles.body}>{field.label}</Text>{exposureValues.map(item => <Button key={item.value} variant="secondary" disabled={working} onPress={() => change(() => setExposure(current => ({...current, [field.key]: item.value})))}>{exposure[field.key] === item.value ? 'Choisi : ' : ''}{item.label}</Button>)}</View>)}
        <Checkbox checked={acknowledged === source.previewId} disabled={working} onToggle={() => {interaction.current++; setAcknowledged(value => value === source.previewId ? null : source.previewId);}}><Text style={styles.body}>Je confirme ces informations.</Text></Checkbox>
        <Button disabled={working || acknowledged !== source.previewId} onPress={() => {void run('execute');}}>Envoyer le signalement</Button>
      </>}
    </> : null}
    {receipt ? <Text style={styles.caption}>{receipt.state === 'committed' ? 'Signalement reçu' : receipt.state === 'not_executed' ? 'Signalement non envoyé' : 'Envoi à vérifier'}</Text> : null}
    {notice ? <Text accessibilityRole="alert" style={styles.body}>{notice}</Text> : null}
    {CONTENT_SAFETY_ENABLED&&selection.messageId?<ContentSafetyPanel scope="own" selection={{targetType:'message',targetId:selection.messageId,reportId:receipt?.reportId??null}}/>:null}
  </View>;
}
const styles = StyleSheet.create({card: {gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceWarm, borderRadius: radius.md}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foregroundSecondary}, caption: {...typography.caption, color: colors.muted}, group: {gap: spacing.sm}});
