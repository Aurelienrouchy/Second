import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Checkbox } from '@/components/ui';
import { TransportReviewEvidence } from '@/components/TransportReviewEvidence';
import { TransportReviewCommandPanel } from '@/components/TransportReviewCommandPanel';
import { colors, spacing, typography } from '@/constants/theme';
import {useProductParcelContext} from '@/hooks/useProductParcelContext';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
import { TransportReviewService } from '@/services/transportReviewService';
import { getAuthSessionGeneration } from '@/store/authStore';
import type { LabelDepositReviewCapability, TransportInquiryEntry, TransportOperatorCommand, TransportReviewObservation, TransportReviewPreview } from '@/types/transportReview';
interface Form {action: TransportOperatorCommand['action']; reason: string; ownerMessage: string; summary: string; reference: string; occurredAt: string; nextFollowUpAt: string;
  entryKind: TransportInquiryEntry['kind']; entrySource: TransportInquiryEntry['source']; outcome: 'review_completed' | 'signal_not_established' | 'further_action_required'; finding: 'incident_resolved' | 'financial_review_required'}
const initial: Form = {action: 'record_inquiry', reason: '', ownerMessage: '', summary: '', reference: '', occurredAt: '', nextFollowUpAt: '', entryKind: 'assessment', entrySource: 'operator_observation', outcome: 'further_action_required', finding: 'financial_review_required'};
const actionLabels = {record_inquiry: 'Enregistrer une démarche', close_inquiry: 'Clore l’enquête documentaire', resolve_delivery_correction: 'Résoudre cette correction', resolve_carrier_exception: 'Décider sur cette exception'};
const kinds = {evidence: 'Élément à examiner', carrier_contact: 'Contact transporteur', participant_contact: 'Contact participant', follow_up: 'Suivi', assessment: 'Évaluation'} as const;
const sources = {operator_observation: 'Observation opérateur', participant_statement: 'Déclaration participante', carrier_statement: 'Déclaration transporteur', document_reference: 'Référence documentaire'} as const;
const outcomes = {review_completed: 'Examen documentaire terminé', signal_not_established: 'Signal non établi', further_action_required: 'Autre démarche nécessaire'} as const;
export function AdminTransportReviewDecision({uid, transactionId, observation, enabled, onRecorded, capability}: {uid: string; transactionId: string; observation: TransportReviewObservation | null; enabled: boolean; onRecorded: () => void; capability?: LabelDepositReviewCapability}) {
  const context = useProductParcelContext(JSON.stringify(['admin-transport-decision', transactionId, observation?.reference ?? null, capability ?? null]), uid, !!capability);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision, observation?.reference ?? null, capability ?? null]);
  const interactions = useRef(0), [interactionVersion, setInteractionVersion] = useState(0), [verified, setVerified] = useState<string | null>(null);
  const [formState, setForm] = useState<{key: string; form: Form} | null>(null), form = formState?.key === key ? formState.form : initial;
  const [previewState, setPreview] = useState<{key: string; form: string; preview: TransportReviewPreview; intent: TransportOperatorCommand; confirmed: boolean; epoch: number} | null>(null);
  const [message, setMessage] = useState<{key: string; text: string} | null>(null), [busy, setBusy] = useState<string | null>(null);
  const lock = useRef<symbol | null>(null);
  const current = enabled && context.focused && previewState?.key === key && previewState.form === JSON.stringify(form) && (!capability || previewState.epoch === interactionVersion) ? previewState : null;
  const reauthenticationKey = JSON.stringify([key, form]);
  const patch = (value: Partial<Form>) => {const next = ++interactions.current; setInteractionVersion(next); setVerified(null); setForm({key, form: {...form, ...value}}); setPreview(null); setMessage(null);};
  const intent = (): TransportOperatorCommand | null => {
    if (!enabled || !observation?.review || !context.focused) return null;
    if (capability && (observation.review.kind !== 'label_deposit_deadline' || !['record_inquiry', 'close_inquiry'].includes(form.action))) return null;
    if (capability && form.action === 'close_inquiry' && (observation.deadlineContextQualification !== 'same_deadline_and_label' || !observation.labelDepositDeadline?.declarationManifestComplete)) return null;
    const common = {transactionId, reviewId: observation.review.reviewId, source: {...observation.reference}};
    if (form.action === 'record_inquiry') return {...common, action: form.action, entry: {kind: form.entryKind, source: form.entrySource, summary: form.summary.trim(), reference: form.reference.trim() || null,
      occurredAt: form.occurredAt.trim() || null, nextFollowUpAt: form.nextFollowUpAt.trim() || null}};
    const explanation = {reason: form.reason.trim(), ownerMessage: form.ownerMessage.trim()};
    return form.action === 'close_inquiry' ? {...common, ...explanation, action: form.action, outcome: form.outcome} : form.action === 'resolve_delivery_correction' ? {...common, ...explanation, action: form.action} : {...common, ...explanation, action: form.action, finding: form.finding};
  };
  const preview = async () => {
    const command = intent(); if (!command || lock.current || capability && verified !== reauthenticationKey) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(key); setPreview(null); setMessage(null);
    const epoch = ++interactions.current; setInteractionVersion(epoch);
    const assertCurrent = () => {context.assertCurrent(op); if (capability && interactions.current !== epoch) throw new Error('Le choix ou les champs ont changé.');};
    try {const value = await TransportReviewService.preview(uid, command, assertCurrent, capability); assertCurrent();
      setPreview({key, form: JSON.stringify(form), intent: command, preview: value, confirmed: false, epoch});
    } catch {try {assertCurrent(); setMessage({key, text: 'L’aperçu exact ne peut pas être qualifié. Vérifiez les champs, puis relisez explicitement les sources ; aucune instruction n’a été envoyée.'});} catch { /* Preserve newer operator choices. */ }}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  const review = observation?.review;
  const actions: TransportOperatorCommand['action'][] = ['record_inquiry', 'close_inquiry', ...(review?.kind === 'delivery_correction' ? ['resolve_delivery_correction' as const] : review?.kind === 'carrier_exception' ? ['resolve_carrier_exception' as const] : [])];
  return <View style={styles.section}>
    {enabled && observation?.review && context.focused ? <>
      <Text accessibilityRole="header" style={styles.title}>Examen humain de ce dossier exact</Text>
      {actions.map(action => <Button key={action} variant={form.action === action ? 'primary' : 'secondary'} disabled={busy === key} onPress={() => patch({action})}>{actionLabels[action]}</Button>)}
      {form.action === 'record_inquiry' ? <>
        {Object.entries(kinds).map(([kind, label]) => <Button key={kind} variant={form.entryKind === kind ? 'primary' : 'secondary'} onPress={() => patch({entryKind: kind as Form['entryKind']})}>{label}</Button>)}
        {Object.entries(sources).map(([entrySource, label]) => <Button key={entrySource} variant={form.entrySource === entrySource ? 'primary' : 'secondary'} onPress={() => patch({entrySource: entrySource as Form['entrySource']})}>{label}</Button>)}
        <TextInput value={form.summary} onChangeText={summary => patch({summary})} maxLength={2000} multiline placeholder="Résumé de la démarche déclarée" placeholderTextColor={colors.muted} style={styles.input} />
        <TextInput value={form.reference} onChangeText={reference => patch({reference})} maxLength={500} placeholder="Référence documentaire déclarée, si disponible" placeholderTextColor={colors.muted} style={styles.input} />
        <Text style={styles.caption}>Dates déclarées, facultatives : format UTC exact AAAA-MM-JJTHH:mm:ss.sssZ. Laissez vide si inconnues. Aucune date de démarche ou de relance n’est calculée.</Text>
        <TextInput value={form.occurredAt} onChangeText={occurredAt => patch({occurredAt})} autoCapitalize="none" placeholder="Date UTC de la démarche, ou inconnue" placeholderTextColor={colors.muted} style={styles.input} />
        <TextInput value={form.nextFollowUpAt} onChangeText={nextFollowUpAt => patch({nextFollowUpAt})} autoCapitalize="none" placeholder="Date UTC du prochain suivi, ou inconnue" placeholderTextColor={colors.muted} style={styles.input} />
      </> : <>
        {form.action === 'close_inquiry' ? <>
          <Button variant={form.outcome === 'review_completed' ? 'primary' : 'secondary'} onPress={() => patch({outcome: 'review_completed'})}>{outcomes.review_completed}</Button>
          <Button variant={form.outcome === 'signal_not_established' ? 'primary' : 'secondary'} onPress={() => patch({outcome: 'signal_not_established'})}>{outcomes.signal_not_established}</Button>
          <Button variant={form.outcome === 'further_action_required' ? 'primary' : 'secondary'} onPress={() => patch({outcome: 'further_action_required'})}>{outcomes.further_action_required}</Button>
        </> : null}
        {form.action === 'resolve_carrier_exception' ? <><Button variant={form.finding === 'incident_resolved' ? 'primary' : 'secondary'} onPress={() => patch({finding: 'incident_resolved'})}>Incident examiné et résolu pour ses sources</Button>
          <Button variant={form.finding === 'financial_review_required' ? 'primary' : 'secondary'} onPress={() => patch({finding: 'financial_review_required'})}>Examen financier distinct nécessaire</Button></> : null}
        <TextInput value={form.reason} onChangeText={reason => patch({reason})} maxLength={2000} multiline placeholder="Motivation de la décision humaine" placeholderTextColor={colors.muted} style={styles.input} />
        <TextInput value={form.ownerMessage} onChangeText={ownerMessage => patch({ownerMessage})} maxLength={2000} multiline placeholder="Message pour les participants" placeholderTextColor={colors.muted} style={styles.input} />
      </>}
      <Text style={styles.caption}>La fin documentaire de l’enquête ne résout pas les autres obligations. Une résolution de correction ou d’exception exige ses propres sources natives qualifiées. Aucun remboursement, coût, faute ou état physique n’est déduit ici.</Text>
      {capability ? <><Text style={styles.caption}>Cette revue de délai n’autorise que record_inquiry et close_inquiry. La clôture documentaire exige le même délai, la même étiquette et un manifeste complet ; elle ne décide pas du sort du paiement, du colis ou de l’annonce.</Text>
        <AdminFinancialReauthentication key={reauthenticationKey} uid={uid} sourceKey={reauthenticationKey} parcel purpose="commercial" disabled={busy === key || !context.focused} onVerified={() => {
          if (interactions.current !== interactionVersion) return; try {context.capture(); interactions.current++; setInteractionVersion(interactions.current); setVerified(reauthenticationKey); setPreview(null);} catch { /* Reauthentication cannot authorize an old activity or form. */ }
        }} />
      </> : null}
      <Button variant="secondary" disabled={busy === key || !!capability && (verified !== reauthenticationKey || form.action === 'close_inquiry' && (observation.deadlineContextQualification !== 'same_deadline_and_label' || !observation.labelDepositDeadline?.declarationManifestComplete))} onPress={() => {void preview();}}>Examiner l’aperçu exact de cette action</Button>
      {current ? <><TransportReviewEvidence source={current.preview.source} review={current.preview.review} showReferences />
        <Checkbox checked={current.confirmed} disabled={busy === key} onToggle={() => {interactions.current++; setInteractionVersion(interactions.current); setPreview({...current, confirmed: !current.confirmed, epoch: interactions.current});}}><Text style={styles.caption}>J’ai examiné le dossier, les démarches, les références et la situation financière présentées. Je confirme uniquement cette action documentaire sur ces sources exactes, sans autoriser d’argent ou de remise en vente.</Text></Checkbox>
      </> : null}
      {message?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{message.text}</Text> : null}
    </> : null}
    <TransportReviewCommandPanel uid={uid} transactionId={transactionId} sourceKey={key} enabled={!!current?.confirmed && enabled}
      command={current?.confirmed ? {...current.intent, previewId: current.preview.previewId} : null}
      capability={capability} assertNewCurrent={() => {context.capture(); if (capability && (!current?.confirmed || current.epoch !== interactions.current || verified !== reauthenticationKey)) throw new Error('Le choix confirmé doit être préparé à nouveau.');}}
      onSubmitted={() => {if (capability) {try {context.capture(); if (interactions.current !== interactionVersion) return;} catch {return;}} setPreview(null);}}
      onRecorded={() => {if (capability) {try {context.capture(); if (interactions.current !== interactionVersion) return;} catch {return;}} onRecorded();}} />
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md, minHeight: spacing['2xl']}});
