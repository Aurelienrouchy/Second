import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Button, Input } from '@/components/ui';
import { ReturnToSenderReportSummary } from '@/components/ReturnToSenderReportSummary';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ReturnToSenderService, returnToSenderSourceReference } from '@/services/returnToSenderService';
import { RETURN_TO_SENDER_STATEMENT, RETURN_TO_SENDER_STATEMENT_VERSION } from '@/types/returnToSender';
import type { ReturnToSenderAttempt, ReturnToSenderCase, ReturnToSenderReceipt, ReturnToSenderSourceReference } from '@/types/returnToSender';
import { colors, radius, spacing, typography } from '@/constants/theme';

const keyExtractor = (item: ReturnToSenderCase) => item.caseId;
export function ReturnToSenderNotice({transactionId, sourceKey}: {transactionId: string; sourceKey: string}) {
  const uid = useAuthenticatedUid(), generation = getAuthSessionGeneration(), router = useRouter();
  const context = useShippingPurchaseContext(JSON.stringify(['return-to-sender', transactionId, sourceKey]), uid);
  const [instance] = useState(() => randomUUID()), [narrative, setNarrative] = useState(''), [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState(''), [receipt, setReceipt] = useState<ReturnToSenderReceipt | null>(null);
  const [examined, setExamined] = useState<{frame: symbol; focusRevision: number; source: ReturnToSenderSourceReference} | null>(null);
  const [workingState, setWorkingState] = useState({frame: context.frame, focusRevision: context.focusRevision, value: false});
  const working = workingState.frame === context.frame && workingState.focusRevision === context.focusRevision && workingState.value;
  const setWorking = (value: boolean) => setWorkingState({frame: context.frame, focusRevision: context.focusRevision, value});
  const frameKey = JSON.stringify([uid, generation, transactionId, sourceKey]);
  const [formFrame, setFormFrame] = useState(frameKey);
  if (formFrame !== frameKey) {setFormFrame(frameKey); setNarrative(''); setAccepted(false); setNotice(''); setReceipt(null); setExamined(null);}
  const queryKey = [instance, uid, generation, transactionId, sourceKey, context.focusRevision];
  const sourceRead = useQuery({queryKey: ['return-to-sender-source', ...queryKey], enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return ReturnToSenderService.source(operation.session.uid, transactionId, () => context.assertCurrent(operation));}});
  const casesRead = useQuery({queryKey: ['return-to-sender-cases', ...queryKey], enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return ReturnToSenderService.cases(operation.session.uid, transactionId, 'owner', () => context.assertCurrent(operation));}});
  const journalRead = useQuery({queryKey: ['return-to-sender-journal', ...queryKey], enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return ReturnToSenderService.journal(operation.session.uid, transactionId, () => context.assertCurrent(operation));}});
  const source = uid && context.focused && sourceRead.isSuccess && !sourceRead.isFetching && !sourceRead.isError ? sourceRead.data : null;
  const cases = uid && context.focused && casesRead.isSuccess && !casesRead.isFetching && !casesRead.isError ? casesRead.data : null;
  const journalReady = !!uid && context.focused && journalRead.isSuccess && !journalRead.isFetching && !journalRead.isError;
  const pending = journalReady ? journalRead.data : null;
  const examinedCurrent = !!source && examined?.frame === context.frame && examined.focusRevision === context.focusRevision &&
    JSON.stringify(examined.source) === JSON.stringify(returnToSenderSourceReference(source));
  const caseSourceReady = !!cases && cases.sourceRevision !== null;
  const refresh = async () => {await Promise.all([sourceRead.refetch(), casesRead.refetch(), journalRead.refetch()]);};
  const examine = async () => {
    if (working || !journalReady || pending) return; const operation = context.start(); if (!operation) return; setWorking(true); setNotice('');
    try {const result = await sourceRead.refetch(); context.assertCurrent(operation);
      if (!result.isSuccess || result.isError || !result.data || !result.data.transportContext) throw new Error('La source de transport actuelle ne peut pas être qualifiée pour un nouveau signalement.');
      setExamined({frame: context.frame, focusRevision: context.focusRevision, source: returnToSenderSourceReference(result.data)}); setAccepted(false);
    } catch (error) {if (context.isCurrent(operation)) {setExamined(null); setNotice(error instanceof Error ? error.message : 'Cette source ne peut pas être examinée.');}}
    finally {if (context.isCurrent(operation)) setWorking(false); context.finish(operation);}
  };
  const perform = async (mode: 'submit' | 'observe' | 'resume' | 'neutralize' | 'acknowledge') => {
    if (working || !journalReady || mode === 'submit' && (pending || !examinedCurrent || !accepted || !narrative.trim() || !source?.transportContext) || mode !== 'submit' && !pending) return;
    const operation = context.start(); if (!operation) return; setWorking(true); setNotice('');
    try {let result: ReturnToSenderReceipt;
      if (mode === 'submit') {
        const source = examined!.source;
        const attempt: ReturnToSenderAttempt = {version: 1, uid: operation.session.uid, requestId: randomUUID(), command: {transactionId,
          narrative: narrative.trim(), statementVersion: RETURN_TO_SENDER_STATEMENT_VERSION, accepted: true, source: {...source, capture: source.capture ? {...source.capture} : null}}};
        result = await ReturnToSenderService.execute(attempt, () => context.assertCurrent(operation));
      } else result = mode === 'resume' ? await ReturnToSenderService.execute(pending!, () => context.assertCurrent(operation), true) :
        mode === 'observe' ? await ReturnToSenderService.observe(pending!, () => context.assertCurrent(operation)) :
        mode === 'neutralize' ? await ReturnToSenderService.neutralize(pending!, () => context.assertCurrent(operation)) : await ReturnToSenderService.acknowledge(pending!, () => context.assertCurrent(operation));
      context.assertCurrent(operation); setReceipt(result);
      setNotice(result.state === 'committed' ? 'Le signalement est enregistré ou relié à son dossier d’origine. Son reçu ne certifie aucun retour physique ni effet financier.' :
        result.state === 'not_executed' ? 'Cette intention n’a pas été exécutée. Son reçu exact reste consultable ; un nouveau récit demande une lecture explicite des sources actuelles.' :
          'Aucun reçu exact n’est visible. L’intention reste conservée ; ne créez pas un nouvel identifiant.');
      if (mode === 'acknowledge') {setNarrative(''); setAccepted(false); setExamined(null);}
      await refresh(); context.assertCurrent(operation);
    } catch (error) {if (context.isCurrent(operation)) {setNotice(error instanceof Error ? error.message : 'Le reçu exact reste inconnu.'); await journalRead.refetch();}}
    finally {if (context.isCurrent(operation)) setWorking(false); context.finish(operation);}
  };
  const renderItem = useCallback(({item}: {item: ReturnToSenderCase}) => <View style={styles.case}>
    <ReturnToSenderReportSummary report={item} />
    {caseSourceReady && cases && item.caseRevision ? <Button variant="secondary" disabled={working} onPress={() => {try {context.capture(); router.push({pathname: '/settings/support', params: {kind: 'commercial_late', transactionId,
      returnToSender: JSON.stringify({kind: 'return_to_sender_report', transactionId, caseId: item.caseId, caseRevision: item.caseRevision, caseHash: item.caseHash,
        financialSourceHash: cases.financialSourceHash, orderRevision: cases.sourceRevision})}} as never);} catch { /* Stale session/source. */ }}}>Demander une instruction pour ce signalement</Button> : null}
  </View>, [caseSourceReady, cases, working, context, router, transactionId]);
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Retour à l’expéditeur : signalement à examiner</Text>
    <Text style={styles.caption}>Un statut de suivi, une ville ou une indication de retour ne suffisent pas à établir un retour à l’expéditeur. Vous pouvez consigner un récit distinct à faire vérifier.</Text>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
    {source ? <>
      <Text style={styles.caption}>{source.captureQualification === 'native_capture' ? source.currentCapture ? 'La capture référencée correspond au suivi qualifié lors de cette lecture.' : 'Une capture native est conservée, mais elle ne qualifie pas le suivi actuel.' : source.captureQualification === 'absent' ? 'Aucune capture n’est présente dans la source lue.' : 'La capture du suivi reste historiquement inconnue.'} Cela ne prouve aucun retour à l’expéditeur.</Text>
      <Text style={styles.caption}>Écritures relues : {source.financialRecording.refundSource === 'absent' ? 'aucun enregistrement de remboursement dans cette source' : 'enregistrement de remboursement présent, résultat non vérifié'} ; {source.financialRecording.releaseSource === 'native_timestamp_recorded' ? 'date native de libération enregistrée' : source.financialRecording.releaseSource === 'absent' ? 'aucune date de libération dans cette source' : 'ancienne libération à rapprocher'}. Aucune réception bancaire ou somme restituée n’est certifiée.</Text>
    </> : <Text style={styles.body}>{sourceRead.isError ? 'La source actuelle ne peut pas être confirmée. Aucun ancien aperçu ne permet une nouvelle déclaration.' : 'Lecture des sources enregistrées…'}</Text>}
    {journalRead.isError ? <Text style={styles.body}>Le journal privé est inaccessible. Les nouvelles intentions restent fermées jusqu’à sa relecture.</Text> : null}
    {pending ? <View style={styles.case}>
      <Text style={styles.title}>Déclaration exacte conservée</Text><Text selectable style={styles.body}>{pending.command.narrative}</Text>
      <Text style={styles.caption}>{RETURN_TO_SENDER_STATEMENT} La reprise conserve le récit et les sources d’origine.</Text>
      <Button disabled={working} onPress={() => {void perform('observe');}}>Relire cette intention exacte</Button>
      <Button variant="secondary" disabled={working} onPress={() => {void perform('resume');}}>Reprendre la même déclaration</Button>
      <Button variant="secondary" disabled={working} onPress={() => {void perform('neutralize');}}>Demander l’arrêt de l’intention non exécutée</Button>
      {receipt?.requestId === pending.requestId && receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={working} onPress={() => {void perform('acknowledge');}}>Reconnaître le reçu relu</Button> : null}
    </View> : <View style={styles.case}>
      <Button variant="secondary" disabled={working || !journalReady} onPress={() => {void examine();}}>Examiner les sources avant un signalement</Button>
      {!examinedCurrent ? <Text style={styles.caption}>Une lecture explicite des sources est nécessaire. Tout changement impose un nouvel examen avant une intention différente.</Text> : null}
      <Input label="Les faits que vous déclarez" value={narrative} onChangeText={setNarrative} multiline maxLength={4000} disabled={working || !journalReady || !examinedCurrent} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{checked: accepted, disabled: working || !examinedCurrent}} disabled={working || !examinedCurrent}
        style={[styles.choice, accepted && styles.selected]} onPress={() => setAccepted(value => !value)}><Text style={styles.body}>{RETURN_TO_SENDER_STATEMENT}</Text></Pressable>
      <Text style={styles.caption}>Ce dépôt ne confirme ni réception, contenu, coût, responsabilité ou faculté d’intercepter le colis. Une instruction de l’équipe reste distincte d’une opération financière ou d’une remise en vente.</Text>
      <Button disabled={working || !journalReady || !examinedCurrent || !accepted || !narrative.trim()} onPress={() => {void perform('submit');}}>Enregistrer ce signalement non vérifié</Button>
    </View>}
    {cases ? cases.items.length ? <View style={styles.viewport}><FlashList data={cases.items} keyExtractor={keyExtractor} renderItem={renderItem} nestedScrollEnabled contentContainerStyle={styles.content} /></View> :
      <Text style={styles.caption}>Aucun dossier qualifié n’est visible. Cela ne prouve pas l’absence d’un retour ou d’un autre signalement à rapprocher.</Text> :
      <Text style={styles.caption}>{casesRead.isError ? 'Les dossiers conservés ne peuvent pas être confirmés ; les anciens résultats sont masqués.' : 'Lecture des dossiers conservés…'}</Text>}
    <Button variant="secondary" disabled={!uid || !context.focused || working || sourceRead.isFetching || casesRead.isFetching || journalRead.isFetching} onPress={() => {try {context.capture(); void refresh();} catch { /* Stale session/source. */ }}}>Relire les dossiers et les sources</Button>
  </View>;
}
const styles = StyleSheet.create({card: {padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceWarm},
  case: {paddingVertical: spacing.sm, gap: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, viewport: {height: spacing['4xl'] * 5}, content: {padding: spacing.xs},
  choice: {padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm}, selected: {backgroundColor: colors.surfaceSubtle, borderColor: colors.primary}});
