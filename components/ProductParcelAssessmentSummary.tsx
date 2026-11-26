import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { PARCEL_CHOICE_LABELS } from '@/utils/productParcelStatement';
import type { ProductParcelAssessment } from '@/types/productParcelReview';
const labels = {deliveryFinding: 'Remise ou réception', locationComparison: 'Comparaison du lieu', lossDocumentFinding: 'Document de perte', parcelContentsFinding: 'Observations de contenu', responsibility: 'Responsabilité', costTreatment: 'Traitement des frais'};
export function ProductParcelAssessmentSummary({assessment}: {assessment: ProductParcelAssessment}) {
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.label}>Appréciation opérateur enregistrée sur les sources disponibles</Text>
    <Text selectable style={styles.body}>{assessment.leg === 'forward' ? 'Aller' : 'Retour'} · étiquette {assessment.labelId ?? 'inconnue'}.</Text>
    {(Object.keys(labels) as (keyof typeof labels)[]).map(key => <Text key={key} selectable style={styles.body}>{labels[key]} : {PARCEL_CHOICE_LABELS[assessment[key]]}.</Text>)}
    <Text selectable style={styles.body}>Motivation : {assessment.motivation}.</Text><Text selectable style={styles.body}>Limites examinées : {assessment.evidenceLimitations}.</Text>
    <Text style={styles.caption}>Cette appréciation documentaire ne certifie ni remise, ni perte officielle ou responsabilité, et ne décide pas des frais, du remboursement ou d’une indemnisation.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, label: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
