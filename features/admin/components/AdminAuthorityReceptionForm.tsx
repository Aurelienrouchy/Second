import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, Input} from '@/components/ui';
import type {AuthorityCommand, AuthorityReception} from '@/types/authorityRequest';
import {colors, spacing, typography} from '@/constants/theme';

const empty: AuthorityReception = {requester: {name: '', organization: '', contact: '', capacity: ''}, externalReference: '', externallyReceivedAt: null, summary: '', evidenceReferences: []};
export function AdminAuthorityReceptionForm({disabled, onSubmit}: {disabled: boolean; onSubmit: (command: AuthorityCommand, guard: () => void) => void}) {
  const [form, setForm] = useState(empty), [date, setDate] = useState(''), [references, setReferences] = useState(''), [notice, setNotice] = useState<string | null>(null), revision = useRef(0);
  const edit = (work: () => void) => {revision.current++; setNotice(null); work();};
  const requester = (field: keyof AuthorityReception['requester'], value: string) => edit(() => setForm(old => ({...old, requester: {...old.requester, [field]: value}})));
  const submit = () => {
    const selected = revision.current, guard = () => {if (revision.current !== selected) throw new Error('Le formulaire a changé.');};
    try {
      const evidenceReferences = references.trim() ? references.trim().split('\n').map(line => {const separator = line.indexOf(' | '); if (separator < 1) throw new Error('Chaque référence doit suivre le format référence | description.'); return {reference: line.slice(0, separator).trim(), description: line.slice(separator + 3).trim()};}) : [];
      const reception = {...form, requester: Object.fromEntries(Object.entries(form.requester).map(([key, value]) => [key, value.trim()])) as AuthorityReception['requester'], externalReference: form.externalReference.trim(), summary: form.summary.trim(), externallyReceivedAt: date.trim() || null, evidenceReferences};
      onSubmit({action: 'receive', reception}, guard);
    } catch (error) {setNotice(error instanceof Error ? error.message : 'Vérifiez les champs.');}
  };
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Consigner une demande externe reçue</Text>
    <Text style={styles.caption}>La qualité, l’identité, les coordonnées et les pièces sont des déclarations à examiner. Conservez les originaux dans le canal autorisé ; ne collez ni document d’identité ni secret dans ce formulaire.</Text>
    <Input label="Nom déclaré" value={form.requester.name} onChangeText={v => requester('name', v)} maxLength={300} disabled={disabled}/>
    <Input label="Organisation déclarée" hint="Pour une personne sans organisation, indiquer explicitement : Aucune organisation." value={form.requester.organization} onChangeText={v => requester('organization', v)} maxLength={300} disabled={disabled}/>
    <Input label="Coordonnées déclarées" value={form.requester.contact} onChangeText={v => requester('contact', v)} maxLength={500} disabled={disabled}/>
    <Input label="Qualité ou fonction déclarée" value={form.requester.capacity} onChangeText={v => requester('capacity', v)} maxLength={1000} multiline disabled={disabled}/>
    <Input label="Référence externe" value={form.externalReference} onChangeText={v => edit(() => setForm(old => ({...old, externalReference: v})))} maxLength={300} disabled={disabled}/>
    <Input label="Réception externe déclarée, facultative" hint="Date UTC exacte : 2026-10-17T14:00:00.000Z. Laisser vide si inconnue." value={date} onChangeText={v => edit(() => setDate(v))} maxLength={24} autoCapitalize="none" disabled={disabled}/>
    <Input label="Objet et renseignements demandés" value={form.summary} onChangeText={v => edit(() => setForm(old => ({...old, summary: v})))} maxLength={4000} multiline disabled={disabled}/>
    <Input label="Références des pièces externes, dix au maximum" hint="Une ligne par pièce : référence | description. Aucun fichier ni original n’est importé." value={references} onChangeText={v => edit(() => setReferences(v))} maxLength={13000} multiline disabled={disabled}/>
    <Button disabled={disabled} onPress={submit}>Vérifier la réception avant enregistrement</Button>
    {notice ? <Text accessibilityRole="alert" style={styles.caption}>{notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
