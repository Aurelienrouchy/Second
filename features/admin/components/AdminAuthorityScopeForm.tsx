import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button, Input} from '@/components/ui';
import {AUTHORITY_PACKAGE_FIELDS} from '@/types/authorityRequest';
import type {AuthorityCase, AuthorityCommand, AuthorityField} from '@/types/authorityRequest';
import {colors, spacing, typography} from '@/constants/theme';

export const AUTHORITY_FIELD_LABELS: Record<AuthorityField, string> = {transactionId: 'Référence de commande', createdAt: 'Date de création', status: 'État enregistré', deliveryType: 'Mode de remise', buyerId: 'Identifiant de l’acheteur', sellerId: 'Identifiant du vendeur', articleTitle: 'Titre de l’article figé', amounts: 'Montants internes en dollars'};
export function AdminAuthorityScopeForm({request, disabled, onSubmit, onEdit}: {request: AuthorityCase; disabled: boolean; onSubmit: (command: AuthorityCommand, guard: () => void) => void; onEdit: () => void}) {
  const [ids, setIds] = useState(request.selection?.transactionIds.join('\n') ?? ''), [fields, setFields] = useState<AuthorityField[]>(request.selection?.fields ?? []), [from, setFrom] = useState(request.selection?.period?.from ?? ''), [to, setTo] = useState(request.selection?.period?.to ?? ''), [reason, setReason] = useState(''), revision = useRef(0);
  const edit = (work: () => void) => {revision.current++; onEdit(); work();};
  const submit = () => {const selected = revision.current; onSubmit({action: 'record_scope', caseId: request.id, source: request.source, reason: reason.trim(), selection: {transactionIds: ids.trim().split('\n').map(v => v.trim()).filter(Boolean).sort(), fields: fields.slice().sort(), period: from.trim() || to.trim() ? {from: from.trim(), to: to.trim()} : null}}, () => {if (revision.current !== selected) throw new Error('La portée a changé.');});};
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Portée minimale de la préparation</Text>
    <Input label="Une à dix références de commandes, une par ligne" value={ids} onChangeText={v => edit(() => setIds(v))} maxLength={1290} multiline disabled={disabled}/>
    {AUTHORITY_PACKAGE_FIELDS.map(field => <Button key={field} variant="secondary" disabled={disabled} onPress={() => edit(() => setFields(old => old.includes(field) ? old.filter(v => v !== field) : [...old, field]))}>{fields.includes(field) ? 'Retirer' : 'Inclure'} : {AUTHORITY_FIELD_LABELS[field]}</Button>)}
    <Input label="Début de période UTC, facultatif" hint="Les deux bornes sont nécessaires si une période est retenue. Format : 2026-10-17T00:00:00.000Z." value={from} onChangeText={v => edit(() => setFrom(v))} maxLength={24} autoCapitalize="none" disabled={disabled}/>
    <Input label="Fin de période UTC, facultative" value={to} onChangeText={v => edit(() => setTo(v))} maxLength={24} autoCapitalize="none" disabled={disabled}/>
    <Input label="Motivation de la sélection et des champs" value={reason} onChangeText={v => edit(() => setReason(v))} maxLength={4000} multiline disabled={disabled}/>
    <Text style={styles.caption}>La période utilise uniquement la date native de création de la commande. Une donnée manquante reste inconnue. Adresses, coordonnées, identité, banque, messages et pièces confidentielles sont exclus.</Text>
    <Button disabled={disabled} onPress={submit}>Vérifier la portée avant enregistrement</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
