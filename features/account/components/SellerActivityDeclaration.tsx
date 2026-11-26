import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { Button, Checkbox } from '@/components/ui';
import { colors, typography } from '@/constants/theme';
import type { OwnerEligibility, SellerActivityKind } from '@/types/eligibility';
interface Props { eligibility: OwnerEligibility; activity: SellerActivityKind | null; accepted: boolean;
  busy: boolean; uncertain: boolean; isPending: boolean; isRestoring: boolean;
  onActivity: (kind: SellerActivityKind) => void; onToggleAccepted: () => void; onSubmit: () => void }
export function SellerActivityDeclaration({ eligibility, activity, accepted, busy, uncertain, isPending, isRestoring, onActivity, onToggleAccepted, onSubmit }: Props) {
  return <>
      <Text style={styles.title}>Votre activité de vente</Text>
      {eligibility.activityDeclaration ? <Text style={styles.body}>{eligibility.activityDeclaration.statement} · version {eligibility.activityDeclaration.statementVersion} · {eligibility.activityDeclaration.recordedAt ?? 'Date serveur indisponible'}</Text> : null}
      {(['personal', 'professional'] as const).map(value => <Checkbox key={value} checked={activity === value} disabled={busy || uncertain}
        accessibilityLabel={value === 'personal' ? 'Je vends mes articles personnels' : 'Je vends dans le cadre d’une activité professionnelle'}
        onToggle={() => onActivity(value)}>
        <Text style={styles.body}>{value === 'personal' ? 'Je vends mes articles personnels' : 'Je vends dans le cadre d’une activité professionnelle'}</Text>
      </Checkbox>)}
      {activity ? <Checkbox checked={accepted} disabled={busy || uncertain} onToggle={onToggleAccepted}
        accessibilityLabel={eligibility.statements[activity]}><Text style={styles.body}>{eligibility.statements[activity]}</Text></Checkbox> : null}
      <Text style={styles.caption}>Texte de déclaration · version {eligibility.statementVersion}. Une déclaration ne supprime pas un examen en cours.</Text>
      <Button disabled={!activity || !accepted || busy || uncertain || isRestoring} loading={isPending}
        onPress={onSubmit}>Enregistrer ma déclaration</Button>
  </>;
}
const styles=StyleSheet.create({ title:{...typography.h3,color:colors.foreground},body:{...typography.body,color:colors.foregroundSecondary},caption:{...typography.caption,color:colors.muted} });
