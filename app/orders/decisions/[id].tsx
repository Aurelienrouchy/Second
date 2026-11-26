import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, ScreenHeader } from '@/components/ui';
import { RecourseReasonSheet, type RecourseReasonSheetRef } from '@/components/RecourseReasonSheet';
import { useAutomatedDecision } from '@/features/orders/hooks/useAutomatedDecision';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { supportError } from '@/services/supportRequestService';
import { purchaseAutomaticRefundExplanation } from '@/services/automatedDecisionService';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { AutomatedDecisionEntry } from '@/types/automatedDecision';
import type { SupportDecisionReference } from '@/types/supportRequest';

const keyExtractor = (entry: AutomatedDecisionEntry) => entry.id;
const reasons = [{code: 'human_review', label: 'Je demande une révision humaine de cette entrée'}] as const;
export default function OrderDecisionsScreen() {
  const {id, priorSupportRequestId, decisionId, decisionRevision, decisionHash} = useLocalSearchParams<{id: string; priorSupportRequestId?: string;
    decisionId?: string; decisionRevision?: string; decisionHash?: string}>(), uid = useAuthenticatedUid(), router = useRouter();
  const generation = getAuthSessionGeneration(), scope = JSON.stringify([uid, generation, id, priorSupportRequestId, decisionId, decisionRevision, decisionHash]);
  const context = useShippingPurchaseContext(`decision-screen:${scope}`, uid);
  const decisions = useAutomatedDecision(id, typeof id === 'string' && !!id && !id.includes('/'));
  const linkedReference = decisionId && decisionRevision && decisionHash ? {id: decisionId, revision: decisionRevision, sourceHash: decisionHash} : null;
  const [selected, setSelected] = useState<SupportDecisionReference | null>(linkedReference), [notice, setNotice] = useState(''), [formScope, setFormScope] = useState(scope);
  if (formScope !== scope) {setFormScope(scope); setSelected(linkedReference); setNotice('');}
  const selectedEntry = decisions.entries.find(entry => entry.id === selected?.id && entry.revision === selected.revision && entry.sourceHash === selected.sourceHash);
  const sheet = useRef<RecourseReasonSheetRef>(null);
  const submit = async (_reason: 'human_review', details: string) => {
    if (!selectedEntry || !selected || !decisions.sourceReady || decisions.pendingContest || decisions.otherIntentionPending) return;
    let operation: ReturnType<typeof context.capture>;
    try {operation = context.capture();} catch {return;}
    try {
      const result = await decisions.contest({transactionId: id, decision: selected, reason: details.trim() || 'Je demande une révision humaine de cette entrée précise du journal.',
        ...(priorSupportRequestId ? {priorSupportRequestId} : {})});
      context.assertCurrent(operation); setNotice(result.state === 'committed' ? 'Cette demande de révision est enregistrée. Son reçu ne confirme ni l’examen ni un changement financier.' :
        result.state === 'not_executed' ? 'Cette intention n’a pas été exécutée. Relisez son reçu et la source actuelle.' : 'Le reçu demeure inconnu. Conservez cette intention et observez-la sans créer une autre demande.');
      if (result.state === 'committed') sheet.current?.dismiss();
    } catch (error) {if (context.isCurrent(operation)) setNotice(supportError(error));}
  };
  const recover = async (acknowledge: boolean, resume = false) => {
    if (!decisions.pendingContest || decisions.isContesting) return;
    let operation: ReturnType<typeof context.capture>;
    try {operation = context.capture();} catch {return;}
    try {
      const attempt = decisions.pendingContest;
      const result = resume ? await decisions.resumeContest() : acknowledge ? await decisions.acknowledgeContest() : await decisions.observeContest();
      context.assertCurrent(operation); setNotice(result.state === 'committed' ? 'Le reçu du dépôt initial est confirmé. Le dossier actuel reste consultable dans Mes demandes et recours.' :
        result.state === 'not_executed' ? 'Cette intention n’a pas été exécutée. Son reçu conserve sa source exacte.' : 'Aucun reçu exact n’est visible pour le moment. L’intention reste conservée.');
      if (acknowledge && result.state !== 'unrecorded' && attempt.command.action === 'submit' && attempt.command.decision?.id === selected?.id) {
        await sheet.current?.clearAcknowledgedDraft(); context.assertCurrent(operation);
      }
    } catch (error) {if (context.isCurrent(operation)) setNotice(supportError(error));}
  };
  const renderItem = useCallback(({item}: {item: AutomatedDecisionEntry}) => <View style={styles.card}>
    <Text selectable style={styles.title}>{item.decisionType ?? 'Type à qualifier'}</Text>
    <Text selectable style={styles.caption}>Entrée : {item.id} · Révision : {item.revision}</Text>
    <Text selectable style={styles.body}>{item.result || 'Aucun résultat descriptif enregistré.'}</Text>
    {purchaseAutomaticRefundExplanation(item) ? <Text style={styles.body}>{purchaseAutomaticRefundExplanation(item)}</Text> : null}
    <Text style={styles.caption}>Date consignée : {item.executedAt ?? 'Date absente'}</Text>
    <Text selectable style={styles.caption}>Critères enregistrés : {JSON.stringify(item.criteria)}</Text>
    <Button variant="secondary" disabled={!decisions.sourceReady || decisions.isContesting || !!decisions.pendingContest || decisions.otherIntentionPending}
      onPress={() => {try {context.capture(); setSelected({id: item.id, revision: item.revision, sourceHash: item.sourceHash}); setNotice('');} catch { /* Stale session. */ }}}>
      Sélectionner cette entrée exacte
    </Button>
  </View>, [context.frame, context.focusRevision, decisions.sourceReady, decisions.isContesting, decisions.pendingContest, decisions.otherIntentionPending]);
  return <View style={styles.container}><ScreenHeader title="Décisions enregistrées" onBack={() => router.back()} />
    <FlashList data={decisions.entries} keyExtractor={keyExtractor} renderItem={renderItem} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.section}>
        <Text style={styles.body}>Ce journal contient les entrées consignées pour cette commande privée. Il ne certifie ni l’exécution de tous les effets financiers, ni l’absence d’une décision quand aucune entrée n’est visible.</Text>
        {notice ? <Text selectable style={styles.body}>{notice}</Text> : null}
        {priorSupportRequestId ? <Text selectable style={styles.body}>Nouvelle demande liée au dossier : {priorSupportRequestId}. La référence transmise doit correspondre à une entrée fraîchement relue ; le serveur qualifie le dossier antérieur et conserve son horloge.</Text> : null}
        {decisions.isLogError ? <Text style={styles.body}>Les sources du journal ne peuvent pas être confirmées actuellement. Aucune nouvelle révision n’est proposée depuis une entrée non relue.</Text> : null}
        {decisions.pendingContest ? <View style={styles.card}>
          <Text style={styles.title}>Intention de révision conservée</Text><Text selectable style={styles.caption}>{decisions.pendingContest.requestId}</Text>
          {decisions.pendingContest.command.action === 'submit' ? <Text selectable style={styles.body}>Récit conservé : {decisions.pendingContest.command.narrative}</Text> : null}
          <Button disabled={decisions.isContesting} onPress={() => {void recover(false);}}>Relire exactement cette intention</Button>
          <Button variant="secondary" disabled={decisions.isContesting} onPress={() => {void recover(false, true);}}>Reprendre cette intention avec la même référence</Button>
          {decisions.receipt && decisions.receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={decisions.isContesting} onPress={() => {void recover(true);}}>Reconnaître le reçu relu</Button> : null}
        </View> : decisions.otherIntentionPending || decisions.journalError ? <Text style={styles.body}>Une autre intention ou un journal inaccessible empêche un nouveau dépôt. Relisez Mes demandes et recours.</Text> : null}
        {selected ? <View style={styles.card}>
          <Text style={styles.title}>Source sélectionnée : {selected.id}</Text>
          {selectedEntry ? <><Text selectable style={styles.body}>{selectedEntry.result}</Text><Text style={styles.caption}>Révision {selected.revision}. Le texte et la référence sélectionnés seront conservés dans la demande.</Text>
            <Button disabled={!decisions.sourceReady || decisions.isContesting || !!decisions.pendingContest || decisions.otherIntentionPending}
              onPress={() => {try {context.capture(); sheet.current?.present();} catch { /* Stale session. */ }}}>Décrire ma demande de révision</Button></> :
            <Text style={styles.body}>Cette source sélectionnée ne correspond plus au journal fraîchement relu. Relisez puis sélectionnez explicitement une entrée actuelle.</Text>}
        </View> : null}
        <Button variant="secondary" disabled={decisions.isContesting || !uid} onPress={() => {void decisions.refresh();}}>Relire le journal et l’intention conservée</Button>
        <Button variant="secondary" onPress={() => {try {context.capture(); router.push('/settings/support' as never);} catch { /* Stale session. */ }}}>Mes demandes et recours</Button>
        <Button variant="secondary" onPress={() => {try {context.capture(); router.push('/settings/decisions' as never);} catch { /* Stale session. */ }}}>Vérifications du compte</Button>
      </View>}
      ListEmptyComponent={<Text style={styles.body}>{decisions.isLoadingLog ? 'Relecture…' : 'Aucune entrée qualifiée n’est visible dans cette page. Cela ne prouve pas qu’aucune décision n’a eu lieu.'}</Text>}
      ListFooterComponent={decisions.hasMore ? <Button variant="secondary" disabled={decisions.loadingMore} onPress={() => {void decisions.loadMore();}}>Lire les entrées plus anciennes</Button> : null} />
    <RecourseReasonSheet ref={sheet} key={selected ? JSON.stringify([scope, selected.id, selected.revision, selected.sourceHash]) : scope}
      draftScope={uid && selected ? {uid, transactionId: id, purpose: `contest_${selected.id}`} : undefined}
      title="Demander une révision humaine" intro="Cette demande conserve l’entrée sélectionnée et votre récit. Son dépôt ne change pas les fonds ou vos droits."
      reasons={reasons} showDetailsField submitLabel="Déposer cette demande exacte" isSubmitting={decisions.isContesting} locked={!!decisions.pendingContest || decisions.otherIntentionPending} onSubmit={submit} />
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md}, section: {gap: spacing.md, marginBottom: spacing.md},
  card: {gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted} });
