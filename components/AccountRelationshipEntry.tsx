import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { RELATIONSHIP_PAIR_LABELS, RELATIONSHIP_ORDER_LABELS, RELATIONSHIP_FACT_LABELS, RELATIONSHIP_ASSESSMENT_LABELS } from '@/utils/accountRelationshipPresentation';
import type { RelationshipEntry, RelationshipReference } from '@/types/accountRelationshipReview';

export function AccountRelationshipEntry({entry, onSelect}: {entry: RelationshipEntry; onSelect?: (reference: RelationshipReference) => void}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>{entry.action === 'contest' ? 'Contestation historique' : 'Examen humain historique'} · version {entry.reference.version}</Text>
    <Text selectable style={styles.caption}>Dossier {entry.context.supportRequestId} · {entry.recordedAt} · {entry.reference.id}</Text>
    <Text style={styles.body}>{RELATIONSHIP_ASSESSMENT_LABELS[entry.assessment]}</Text>
    <Text style={styles.caption}>{RELATIONSHIP_PAIR_LABELS[entry.pairAction]}. {RELATIONSHIP_ORDER_LABELS[entry.orderAction]}.</Text>
    {entry.message ? <Text selectable style={styles.body}>Message qui vous est adressé : {entry.message}</Text> : null}
    {entry.statement ? <Text selectable style={styles.body}>Contestation déclarée : {entry.statement}</Text> : null}
    {entry.privateReason ? <Text selectable style={styles.body}>Motivation privée : {entry.privateReason}</Text> : null}
    {entry.facts?.map((fact, index) => <Text selectable key={index} style={styles.body}>{RELATIONSHIP_FACT_LABELS[fact.qualification]} : {fact.text}</Text>)}
    {entry.partyMessages?.map(m => <Text selectable key={m.userId} style={styles.body}>Message à {m.userId} : {m.message}</Text>)}
    {entry.reconsiderWhen ? <Text selectable style={styles.body}>Condition de réexamen : {entry.reconsiderWhen}</Text> : null}
    <Text style={styles.caption}>Ces actions portent sur leurs sources historiques. Elles ne certifient pas les permissions actuelles, une identité commune ou une fraude et ne créent aucun remboursement.</Text>
    {onSelect && entry.action === 'record_review' ? <Button variant="secondary" onPress={() => onSelect(entry.reference)}>Examiner cette décision exacte pour la contester</Button> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
