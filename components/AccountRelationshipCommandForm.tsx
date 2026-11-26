import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Input } from '@/components/ui';
import { AccountRelationshipReauthentication } from '@/components/AccountRelationshipReauthentication';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ACCOUNT_RELATIONSHIP_REVIEW_ENABLED } from '@/config/featureFlags';
import { AccountRelationshipReviewService as Service, isRelationshipCommand, relationshipFailure } from '@/services/accountRelationshipReviewService';
import { AccountRelationshipReviewJournal as Journal } from '@/services/accountRelationshipReviewJournal';
import { productReviewEqual } from '@/services/productReviewService';
import { createRelationshipInteraction, RELATIONSHIP_ASSESSMENT_LABELS, RELATIONSHIP_PAIR_LABELS, RELATIONSHIP_ORDER_LABELS, RELATIONSHIP_FACT_LABELS } from '@/utils/accountRelationshipPresentation';
import { ACCOUNT_RELATIONSHIP_CAPABILITY, RELATIONSHIP_PAIR_ACTIONS, RELATIONSHIP_ORDER_ACTIONS, RELATIONSHIP_ASSESSMENTS, RELATIONSHIP_FACT_QUALIFICATIONS,
  type RelationshipAttempt, type RelationshipCommand, type RelationshipFact, type RelationshipPreview, type RelationshipReauthentication } from '@/types/accountRelationshipReview';
import { colors, spacing, typography } from '@/constants/theme';

export function AccountRelationshipCommandForm({uid, preview, assertSelection, onRecorded, renderReauthentication}: {
  uid: string; preview: RelationshipPreview; assertSelection: () => void; onRecorded: () => void; renderReauthentication?: RelationshipReauthentication;
}) {
  const frame = useLabelLifecycleContext(`relationship-form:${preview.context.supportRequestId}:${preview.scope}`, uid), client = useQueryClient(), lock = useRef(false);
  const [interaction] = useState(createRelationshipInteraction);
  const generation = getAuthSessionGeneration();
  const key = JSON.stringify([uid, generation, preview.scope, preview.context, preview.source, preview.selectedDecision?.reference, frame.focusRevision]);
  const empty = {key, revision: 0, pairAction: null as RelationshipCommand['pairAction'] | null, orderAction: null as RelationshipCommand['orderAction'] | null,
    assessment: null as RelationshipCommand['assessment'] | null, facts: [{qualification: 'unknown', text: ''}] as RelationshipFact[], privateReason: '', statement: '', reconsiderWhen: '',
    messages: (preview.accounts ?? []).map(a => ({userId: a.declaredAccountId, message: ''})), pairConfirmed: false, ordersConfirmed: false, acknowledged: false, authenticated: false};
  const [draft, setDraft] = useState<typeof empty | null>(null), [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const form = draft?.key === key ? draft : empty, admin = preview.scope === 'admin';
  const journal = useQuery({queryKey: ['account-relationship-journal', uid, preview.scope, generation, frame.focusRevision], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, preview.scope, () => frame.assertCurrent(op));}});
  const allowed = ACCOUNT_RELATIONSHIP_REVIEW_ENABLED && frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError && journal.data === null && preview.source.qualification === 'native_current' && typeof preview.source.sourceHash === 'string' && typeof preview.source.version === 'number' && (admin ? preview.canRecordReview && preview.accounts?.length === 2 : preview.canContest && preview.selectedDecision?.action === 'record_review');
  const update = (patch: Partial<typeof form>) => {try {frame.capture(); assertSelection(); interaction.invalidate(); setDraft({...form, ...patch, revision: form.revision + 1, acknowledged: patch.acknowledged ?? false, authenticated: false});} catch { /* Stale choices grant no new intent. */ }};
  let command: RelationshipCommand | null = null;
  if (allowed && form.acknowledged && preview.source.sourceHash !== null && preview.source.version !== null) {
    command = {context: preview.context, source: {sourceHash: preview.source.sourceHash, pairId: preview.source.pairId, version: preview.source.version}, scope: preview.scope,
      action: admin ? 'record_review' : 'contest', pairAction: admin ? form.pairAction! : 'retain_current', orderAction: admin ? form.orderAction! : 'retain_current',
      assessment: admin ? form.assessment! : 'unresolved', facts: admin ? form.facts.map(f => ({...f, text: f.text.trim()})) : [], privateReason: admin ? form.privateReason.trim() : null,
      statement: admin ? null : form.statement.trim(), reconsiderWhen: admin ? form.reconsiderWhen.trim() : null,
      partyMessages: admin ? form.messages.map(m => ({...m, message: m.message.trim()})) : [], decisionReference: admin ? null : preview.selectedDecision!.reference, acknowledged: true};
    if (!isRelationshipCommand(command) || admin && (!form.pairConfirmed || !form.ordersConfirmed || !form.authenticated || !form.facts.length)) command = null;
  }
  const currentChoice = interaction.capture();
  const submit = async () => {
    if (!command || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(key); setNotice(null); let currentExchange = false;
    const current = () => {frame.assertCurrent(op); assertSelection(); currentChoice(); if (!ACCOUNT_RELATIONSHIP_REVIEW_ENABLED) throw relationshipFailure();};
    const attempt: RelationshipAttempt = {version: 1, uid, requestId: randomUUID(), capability: ACCOUNT_RELATIONSHIP_CAPABILITY, command};
    const verifyNew = async () => {
      current(); const fresh = await Service.read(uid, preview.scope, preview.context, command.decisionReference, 'preview', null, current); current();
      if (fresh.source.qualification !== 'native_current' || !productReviewEqual(fresh.source, preview.source) || (admin ? !fresh.canRecordReview || !fresh.accounts || !productReviewEqual(fresh.accounts.map(a => a.declaredAccountId).sort(), command.partyMessages.map(m => m.userId).sort()) : !fresh.canContest || !productReviewEqual(fresh.selectedDecision?.reference, command.decisionReference))) throw relationshipFailure();
      currentExchange = true;
    };
    try {
      current(); await verifyNew(); current(); currentExchange = false;
      await Journal.prepare(attempt, current); current();
      const receipt = await Journal.resume(attempt, current, verifyNew); current();
      setNotice({key, text: receipt.state === 'committed' ? 'L’examen ou la contestation est enregistré pour ces sources exactes. Les permissions actuelles restent à relire.' : receipt.state === 'not_executed' ? `Intention non exécutée : ${receipt.reason}.` : 'Le résultat reste inconnu ; relisez exactement cette intention.'});
      if (currentExchange && receipt.state === 'committed') {current(); onRecorded();}
    } catch (error) {try {current(); setNotice({key, text: `${error instanceof Error ? error.message : 'Résultat inconnu.'} Votre intention déjà conservée reste dans le journal ; ne la recréez pas.`});} catch { /* An older NEW callback cannot affect replacement choices. */ }}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) {setBusy(null); void client.invalidateQueries({queryKey: ['account-relationship-journal', uid, preview.scope]});}}
  };
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.body}>{admin ? 'Examen humain : deux portées indépendantes' : 'Contester la décision exacte qui vous concerne'}</Text>
    {!ACCOUNT_RELATIONSHIP_REVIEW_ENABLED ? <Text style={styles.caption}>Les nouvelles instructions et contestations sont en préparation. Les propres reçus restent accessibles séparément.</Text> : null}
    {admin ? <>
      <Text style={styles.caption}>La restriction de nouveaux engagements ne clôt aucune commande ni opération déjà engagée. La revue de libération ne déclenche aucun transfert, remboursement ou confiscation. Une intention de paiement externe déjà engagée peut conserver son propre parcours de confirmation.</Text>
      {RELATIONSHIP_PAIR_ACTIONS.map(value => <Button key={value} variant={form.pairAction === value ? 'primary' : 'secondary'} disabled={!allowed || busy === key} onPress={() => update({pairAction: value, pairConfirmed: false})}>{RELATIONSHIP_PAIR_LABELS[value]}</Button>)}
      <Checkbox checked={form.pairConfirmed} disabled={!allowed || !form.pairAction || busy === key} onToggle={() => update({pairConfirmed: !form.pairConfirmed})}><Text style={styles.caption}>Je confirme séparément cette action sur les seuls nouveaux engagements de cette paire.</Text></Checkbox>
      {RELATIONSHIP_ORDER_ACTIONS.map(value => <Button key={value} variant={form.orderAction === value ? 'primary' : 'secondary'} disabled={!allowed || busy === key} onPress={() => update({orderAction: value, ordersConfirmed: false})}>{RELATIONSHIP_ORDER_LABELS[value]}</Button>)}
      <Checkbox checked={form.ordersConfirmed} disabled={!allowed || !form.orderAction || busy === key} onToggle={() => update({ordersConfirmed: !form.ordersConfirmed})}><Text style={styles.caption}>Je confirme séparément cette action de revue sur les seules commandes listées. Une clôture de cette revue ne vaut pas autorisation globale de libération.</Text></Checkbox>
      {RELATIONSHIP_ASSESSMENTS.map(value => <Button key={value} variant={form.assessment === value ? 'primary' : 'secondary'} disabled={!allowed || busy === key} onPress={() => update({assessment: value})}>{RELATIONSHIP_ASSESSMENT_LABELS[value]}</Button>)}
      {form.facts.map((fact, i) => <View key={i} style={styles.section}><Text style={styles.body}>Fait, inconnu ou contradiction {i + 1}</Text>
        {RELATIONSHIP_FACT_QUALIFICATIONS.map(value => <Button key={value} variant={fact.qualification === value ? 'primary' : 'secondary'} disabled={!allowed || busy === key} onPress={() => update({facts: form.facts.map((f, index) => index === i ? {...f, qualification: value} : f)})}>{RELATIONSHIP_FACT_LABELS[value]}</Button>)}
        <Input label="Observation examinée et référence native de sa preuve" value={fact.text} multiline maxLength={1000} disabled={!allowed || busy === key} onChangeText={text => update({facts: form.facts.map((f, index) => index === i ? {...f, text} : f)})}/>
        {form.facts.length > 1 ? <Button variant="secondary" disabled={!allowed || busy === key} onPress={() => update({facts: form.facts.filter((_, index) => index !== i)})}>Retirer cette observation préparée</Button> : null}
      </View>)}
      <Button variant="secondary" disabled={!allowed || form.facts.length >= 10 || busy === key} onPress={() => update({facts: [...form.facts, {qualification: 'unknown', text: ''}]})}>Ajouter un fait ou une inconnue</Button>
      <Input label="Motivation privée" value={form.privateReason} multiline maxLength={4000} disabled={!allowed || busy === key} onChangeText={privateReason => update({privateReason})}/>
      <Input label="Conditions et éléments nécessaires à un réexamen" value={form.reconsiderWhen} multiline maxLength={2000} disabled={!allowed || busy === key} onChangeText={reconsiderWhen => update({reconsiderWhen})}/>
      {form.messages.map((m, i) => <Input key={m.userId} label={`Message communiqué uniquement à ${m.userId}`} value={m.message} multiline maxLength={2000} disabled={!allowed || busy === key} onChangeText={message => update({messages: form.messages.map((value, index) => index === i ? {...value, message} : value)})}/>)}
    </> : <><Text selectable style={styles.caption}>Décision {preview.selectedDecision?.reference.id} · version {preview.selectedDecision?.reference.version}. Votre contestation sera liée à cette référence et à sa portée immuables, sans lever automatiquement une restriction.</Text><Input label="Motif de votre contestation" value={form.statement} multiline maxLength={4000} disabled={!allowed || busy === key} onChangeText={statement => update({statement})}/></>}
    <Checkbox checked={form.acknowledged} disabled={!allowed || busy === key} onToggle={() => update({acknowledged: !form.acknowledged})}><Text style={styles.caption}>{admin ? 'J’ai examiné ces deux comptes natifs, les accords, les preuves disponibles, les inconnus et contradictions. Les deux portées et messages ont été examinés séparément ; aucun constat automatique de fraude ou d’identité commune.' : 'Je demande le réexamen de cette décision exacte. Cette demande préserve les autres recours et ne modifie automatiquement ni restriction ni fonds.'}</Text></Checkbox>
    {admin ? <AccountRelationshipReauthentication render={renderReauthentication} uid={uid} sourceKey={`relationship-form:${key}:${form.revision}`} parcel disabled={!allowed || busy === key} onVerified={() => {try {frame.capture(); assertSelection(); currentChoice(); setDraft(old => old?.key === key && old.revision === form.revision ? {...old, authenticated: true} : form.revision === 0 ? {...form, authenticated: true} : old);} catch { /* An old provider callback cannot approve a newer choice. */ }}}/> : null}
    <Button disabled={!command || busy === key} onPress={() => {void submit();}}>{admin ? 'Consigner ces deux instructions exactes' : 'Enregistrer cette contestation exacte'}</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
