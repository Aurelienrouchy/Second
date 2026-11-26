import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Input, ScreenHeader } from '@/components/ui';
import { useOwnerAdmissionRefusals } from '@/hooks/useOwnerAdmissionRefusals';
import { supportError } from '@/services/supportRequestService';
import { getAuthSessionGeneration } from '@/store/authStore';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { OwnerAdmissionDecision } from '@/types/automatedDecision';
import type { SupportDecisionReference } from '@/types/supportRequest';

const keyExtractor = (entry: OwnerAdmissionDecision) => entry.id;
const operations = {acceptMeetupOffer: 'Acceptation d’une rencontre', proposeMultiSwap: 'Nouvelle proposition de Troc', acceptSwap: 'Acceptation d’un Troc', createArticle: 'Publication d’une annonce', updateArticle: 'Modification d’une annonce', relistArticle: 'Remise en vente d’une annonce'};
export default function AdmissionDecisionsScreen() {
  const params = useLocalSearchParams<{decisionId?: string; decisionRevision?: string; decisionHash?: string; priorSupportRequestId?: string}>(), router = useRouter();
  const decisions = useOwnerAdmissionRefusals(params.decisionId, params.priorSupportRequestId, JSON.stringify([params.decisionRevision, params.decisionHash])), context = decisions.context;
  const scope = JSON.stringify([decisions.uid, getAuthSessionGeneration(), params.decisionId, params.decisionRevision, params.decisionHash, params.priorSupportRequestId]);
  const initial = params.decisionId && params.decisionRevision && params.decisionHash ? {id: params.decisionId, revision: params.decisionRevision, sourceHash: params.decisionHash} : null;
  const [selected, setSelected] = useState<SupportDecisionReference | null>(initial), [narrative, setNarrative] = useState(''), [notice, setNotice] = useState('');
  const [formScope, setFormScope] = useState(scope), interaction = useRef(0);
  if (formScope !== scope) {setFormScope(scope); setSelected(initial); setNarrative(''); setNotice('');}
  const entry = decisions.entries.find(item => item.id === selected?.id && item.revision === selected.revision && item.sourceHash === selected.sourceHash);
  const ready = decisions.sourceReady && !!entry && !!selected && !decisions.pendingContest && !decisions.otherIntentionPending && !decisions.working;
  const perform = async (mode: 'submit' | 'observe' | 'neutralize' | 'acknowledge') => {
    if (decisions.working || mode === 'submit' && !ready) return;
    let operation; try {operation = context.capture();} catch {return;}
    const revision = interaction.current;
    try {
      const result = mode === 'submit' ? await decisions.submit(selected!, narrative, () => {context.assertCurrent(operation); if (revision !== interaction.current) throw new Error('Le formulaire a changé. Relisez la demande.');}) :
        await decisions.recover(mode);
      context.assertCurrent(operation);
      setNotice(result.state === 'committed' ? 'Votre demande d’examen est enregistrée. Retrouvez-la dans Mes demandes et recours.' :
        result.state === 'not_executed' ? mode === 'acknowledge' ? 'Cette demande n’a pas été envoyée. Vous pouvez en préparer une autre.'
          : 'Cette demande n’a pas été envoyée. Confirmez ce résultat pour pouvoir en préparer une autre.' :
          'L’envoi reste à vérifier. Vérifiez son état avant de préparer une autre demande.');
      if (mode === 'acknowledge' && result.state !== 'unrecorded') {interaction.current++; setNarrative('');}
    } catch (error) {if (context.isCurrent(operation)) setNotice(supportError(error));}
  };
  const renderItem = useCallback(({item}: {item: OwnerAdmissionDecision}) => <View style={styles.card}>
    <Text style={styles.title}>{operations[item.operation]}</Text>
    <Text style={styles.caption}>{item.executedAt ? new Date(item.executedAt).toLocaleDateString('fr-CA', {day: 'numeric', month: 'long', year: 'numeric'}) : 'Date indisponible'}</Text>
    {item.messages.map((message, index) => <Text key={item.reasons[index]} selectable style={styles.body}>{message}</Text>)}
    <Button variant="secondary" disabled={!decisions.sourceReady || decisions.working || !!decisions.pendingContest || decisions.otherIntentionPending || !item.revision}
      onPress={() => {try {context.capture(); if (!item.revision) return; interaction.current++; setSelected({id: item.id, revision: item.revision, sourceHash: item.sourceHash}); setNarrative(''); setNotice('');} catch { /* Stale activity. */ }}}>
      Demander un examen
    </Button>
  </View>, [context.frame, context.focusRevision, decisions.sourceReady, decisions.working, decisions.pendingContest, decisions.otherIntentionPending]);
  return <View style={styles.container}><ScreenHeader title="Vérifications du compte" onBack={() => router.back()} />
    <FlashList data={decisions.entries} keyExtractor={keyExtractor} renderItem={renderItem} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={styles.section}>
        <Text style={styles.body}>Retrouvez les renseignements à compléter lorsqu’une action n’a pas pu aboutir. Si vous pensez qu’il y a une erreur, demandez un examen par notre équipe.</Text>
        {!decisions.uid ? <Text style={styles.body}>Connectez-vous au compte concerné pour consulter ses vérifications.</Text> : null}
        {decisions.logError ? <Text style={styles.body}>Impossible de charger vos vérifications. Réessayez avant de demander un examen.</Text> : null}
        {decisions.unknownEntries > 0 ? <Text style={styles.body}>Certaines vérifications ne peuvent pas être affichées pour le moment.</Text> : null}
        {notice ? <Text accessibilityRole="alert" selectable style={styles.body}>{notice}</Text> : null}
        {params.priorSupportRequestId ? <Text style={styles.body}>Cette demande fait suite à un dossier existant.</Text> : null}
        {decisions.pendingContest ? <View style={styles.card}>
          <Text style={styles.title}>Demande à vérifier</Text>
          {decisions.pendingContest.command.action === 'submit' ? <Text selectable style={styles.body}>{decisions.pendingContest.command.narrative}</Text> : null}
          <Button disabled={decisions.working} onPress={() => {void perform('observe');}}>Vérifier l’état de ma demande</Button>
          <Button variant="secondary" disabled={decisions.working} onPress={() => {void perform('neutralize');}}>Annuler l’envoi en attente</Button>
          <Text style={styles.caption}>Une demande déjà enregistrée reste accessible dans Mes demandes et recours.</Text>
          {decisions.receipt && decisions.receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={decisions.working} onPress={() => {void perform('acknowledge');}}>Confirmer le résultat</Button> : null}
        </View> : decisions.otherIntentionPending || decisions.journalError ? <Text style={styles.body}>Une demande reste à vérifier. Ouvrez Mes demandes et recours avant d’en préparer une autre.</Text> : null}
        {selected ? <View style={styles.card}>
          <Text style={styles.title}>Demander un examen</Text>
          {entry ? <><Text style={styles.body}>{operations[entry.operation]}</Text>
            <Input label="Votre demande d’examen" accessibilityLabel="Votre demande d’examen" value={narrative} maxLength={4000} multiline disabled={!ready}
              onChangeText={value => {interaction.current++; setNarrative(value);}} />
            <Text style={styles.caption}>Expliquez les observations ou renseignements à corriger. N’ajoutez pas de pièce d’identité, de coordonnées bancaires ou de mot de passe.</Text>
            <Button disabled={!ready || !narrative.trim()} loading={decisions.working} onPress={() => {void perform('submit');}}>Envoyer ma demande</Button></> :
            <Text style={styles.body}>Actualisez les vérifications pour retrouver l’action concernée avant d’envoyer votre demande.</Text>}
        </View> : null}
        <Button variant="secondary" disabled={!decisions.uid || decisions.working} onPress={() => {try {context.capture(); void decisions.refresh();} catch { /* Stale activity. */ }}}>Actualiser les vérifications</Button>
        {params.decisionId ? <Button variant="secondary" onPress={() => {try {context.capture(); router.replace('/settings/decisions' as never);} catch { /* Stale activity. */ }}}>Toutes mes vérifications</Button> : null}
        <Button variant="secondary" onPress={() => {try {context.capture(); router.push('/settings/eligibility' as never);} catch { /* Stale activity. */ }}}>Mes renseignements et demandes de correction</Button>
        <Button variant="secondary" onPress={() => {try {context.capture(); router.push('/settings/support' as never);} catch { /* Stale activity. */ }}}>Mes demandes et recours</Button>
      </View>}
      ListEmptyComponent={<Text style={styles.body}>{decisions.isLoading && decisions.uid ? 'Chargement…' : 'Aucune vérification à afficher sur cette page.'}</Text>}
      ListFooterComponent={decisions.hasMore ? <Button variant="secondary" disabled={decisions.loadingMore || decisions.working} onPress={() => {try {context.capture(); void decisions.loadMore();} catch { /* Stale activity. */ }}}>Lire la page suivante</Button> : null} />
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md}, section: {gap: spacing.md, marginBottom: spacing.md},
  card: {gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
