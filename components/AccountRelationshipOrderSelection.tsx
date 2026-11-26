import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { relationshipId } from '@/services/accountRelationshipReviewService';
import type { RelationshipOrder } from '@/types/accountRelationshipReview';
import { colors, spacing, typography } from '@/constants/theme';

export function AccountRelationshipOrderSelection({sourceKey, orders, onChange, onEdit, disabled}: {
  sourceKey: string; orders: RelationshipOrder[]; onChange: (orders: RelationshipOrder[]) => void; onEdit: () => void; disabled: boolean;
}) {
  const [draft, setDraft] = useState({key: sourceKey, kind: null as RelationshipOrder['kind'] | null, id: ''});
  const form = draft.key === sourceKey ? draft : {key: sourceKey, kind: null, id: ''};
  const update = (patch: Partial<typeof form>) => {onEdit(); setDraft({...form, ...patch});};
  return <View style={styles.section}><Text style={styles.body}>Commandes exactes à examiner</Text>
    <Text style={styles.caption}>Choisissez des références d’achat ou de Troc. Le serveur relit les accords natifs et leur paire de participants ; aucune recherche par nom, adresse, banque ou identité n’est effectuée.</Text>
    {orders.map((order, i) => <View key={`${order.kind}/${order.id}`} style={styles.section}><Text selectable style={styles.body}>{order.kind === 'purchase' ? 'Achat' : 'Troc'} · {order.id}</Text><Button variant="secondary" disabled={disabled} onPress={() => onChange(orders.filter((_, index) => index !== i))}>Retirer cette référence de la portée préparée</Button></View>)}
    {(['purchase', 'swap'] as const).map(kind => <Button key={kind} variant={form.kind === kind ? 'primary' : 'secondary'} disabled={disabled} onPress={() => update({kind})}>{kind === 'purchase' ? 'Achat' : 'Troc'}</Button>)}
    <Input label="Référence exacte de la commande" value={form.id} maxLength={128} autoCapitalize="none" disabled={disabled} onChangeText={id => update({id})}/>
    <Button variant="secondary" disabled={disabled || !form.kind || !relationshipId(form.id.trim()) || orders.length >= 10 || orders.some(o => o.kind === form.kind && o.id === form.id.trim())} onPress={() => {if (!form.kind || !relationshipId(form.id.trim())) return; onChange([...orders, {kind: form.kind, id: form.id.trim()}]); setDraft({...form, id: ''});}}>Ajouter explicitement cette référence</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
