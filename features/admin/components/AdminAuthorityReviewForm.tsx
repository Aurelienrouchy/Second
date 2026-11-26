import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, Input} from '@/components/ui';
import type {AuthorityCase, AuthorityCommand, AuthorityReview} from '@/types/authorityRequest';
import {colors, spacing, typography} from '@/constants/theme';

const labels: Record<keyof AuthorityReview, string> = {identity: 'Identité du demandeur', power: 'Pouvoir invoqué', legalBasis: 'Base juridique de la demande', delegation: 'Délégation de la personne qui décide'};
const initial = (): AuthorityReview => ({identity: {state: 'unknown', reason: '', evidenceReferences: []}, power: {state: 'unknown', reason: '', evidenceReferences: []}, legalBasis: {state: 'unknown', reason: '', evidenceReferences: []}, delegation: {state: 'unknown', reason: '', evidenceReferences: []}});
export function AdminAuthorityReviewForm({request, disabled, onSubmit}: {request: AuthorityCase; disabled: boolean; onSubmit: (command: AuthorityCommand, guard: () => void) => void}) {
  const [review, setReview] = useState<AuthorityReview>(() => request.review ?? initial()), [reason, setReason] = useState(''), [additional, setAdditional] = useState(''), [notice, setNotice] = useState<string | null>(null), revision = useRef(0);
  const edit = (work: () => void) => {revision.current++; work();};
  const additionalReferences = additional.split('\n').map(line => line.split(' | ')[0].trim()).filter(Boolean);
  const submit = () => {const selected = revision.current;
    try {
      const evidenceReferences = additional.trim() ? additional.trim().split('\n').map(line => {const separator = line.indexOf(' | '); if (separator < 1) throw new Error('Chaque nouvelle pièce suit le format référence | description.'); return {reference: line.slice(0, separator).trim(), description: line.slice(separator + 3).trim()};}) : [];
      const trimmed = Object.fromEntries(Object.entries(review).map(([key, value]) => [key, {...value, reason: value.reason.trim()}])) as AuthorityReview;
      onSubmit({action: 'record_review', caseId: request.id, source: request.source, reason: reason.trim(), review: trimmed, ...(evidenceReferences.length ? {evidenceReferences} : {})}, () => {if (revision.current !== selected) throw new Error('Les examens ont changé.');});
    } catch (error) {setNotice(error instanceof Error ? error.message : 'Vérifiez les références.');}
  };
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Examens documentaires privés</Text>
    <Text style={styles.caption}>Déclarer un examen ne certifie ni l’identité, ni le pouvoir, ni la légalité d’une communication. Les quatre examens motivés et référencés sont nécessaires avant une préparation documentaire.</Text>
    <Input label="Nouvelles pièces de cet examen, facultatives" hint="Une ligne par pièce : référence | description. Dix références au total, sans doublon avec celles déjà déclarées." value={additional} onChangeText={v => edit(() => setAdditional(v))} maxLength={13000} multiline disabled={disabled}/>
    {(Object.keys(labels) as (keyof AuthorityReview)[]).map(field => <View key={field} style={styles.section}><Text style={styles.title}>{labels[field]}</Text>
      <Button variant="secondary" disabled={disabled} onPress={() => edit(() => setReview(old => ({...old, [field]: {...old[field], state: old[field].state === 'unknown' ? 'declared_reviewed' : 'unknown'}})))}>{review[field].state === 'unknown' ? 'Examen inconnu — déclarer un examen effectué' : 'Examen déclaré effectué — remettre à inconnu'}</Button>
      <Input label="Motivation de cet examen" value={review[field].reason} onChangeText={v => edit(() => setReview(old => ({...old, [field]: {...old[field], reason: v}})))} multiline maxLength={2000} disabled={disabled}/>
      <Text style={styles.caption}>Pièces déclarées : {request.reception.evidenceReferences.map(e => e.reference).join(', ') || 'aucune'}</Text>
      {request.reception.evidenceReferences.map(e => <Button key={e.reference} variant="secondary" disabled={disabled} onPress={() => edit(() => setReview(old => ({...old, [field]: {...old[field], evidenceReferences: old[field].evidenceReferences.includes(e.reference) ? old[field].evidenceReferences.filter(r => r !== e.reference) : [...old[field].evidenceReferences, e.reference]}})))}>{review[field].evidenceReferences.includes(e.reference) ? 'Retirer' : 'Référencer'} : {e.reference}</Button>)}
      {[...new Set(additionalReferences)].filter(reference => !request.reception.evidenceReferences.some(e => e.reference === reference)).map(reference => <Button key={reference} variant="secondary" disabled={disabled} onPress={() => edit(() => setReview(old => ({...old, [field]: {...old[field], evidenceReferences: old[field].evidenceReferences.includes(reference) ? old[field].evidenceReferences.filter(r => r !== reference) : [...old[field].evidenceReferences, reference]}})))}>{review[field].evidenceReferences.includes(reference) ? 'Retirer' : 'Référencer'} la nouvelle pièce : {reference}</Button>)}
    </View>)}
    <Input label="Motivation de l’enregistrement" value={reason} onChangeText={v => edit(() => setReason(v))} maxLength={4000} multiline disabled={disabled}/>
    <Button disabled={disabled} onPress={submit}>Vérifier ces examens avant enregistrement</Button>
    {notice ? <Text accessibilityRole="alert" style={styles.caption}>{notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
