import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import type { EligibilityDecision } from '@/types/eligibility';
import { ELIGIBILITY_SCOPE_LABELS } from '@/utils/eligibilityPresentation';
export function EligibilityDecisionCard({ decision }: { decision: EligibilityDecision }) {
  return <View style={styles.card}>
    <Text style={styles.title}>{ELIGIBILITY_SCOPE_LABELS[decision.scope]}</Text>
    <Text style={styles.body}>{decision.allowed ? 'Critères de base satisfaits' : decision.status === 'review_required' ? 'Examen nécessaire' : 'Renseignements ou critères à compléter'}</Text>
    {decision.messages.map(message => <Text key={message} style={styles.body}>{message}</Text>)}
    <Text style={styles.caption}>Évaluation de base au {decision.civilDate ?? 'jour non disponible'} · politique {decision.policyVersion}</Text>
  </View>;
}
const styles = StyleSheet.create({ card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
  title: { ...typography.body, color: colors.foreground }, body: { ...typography.body, color: colors.foregroundSecondary },
  caption: { ...typography.caption, color: colors.muted } });
