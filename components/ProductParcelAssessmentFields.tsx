import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Checkbox } from '@/components/ui';
import { ProductParcelChoiceField } from './ProductParcelChoiceField';
import { colors, spacing, typography } from '@/constants/theme';
import { isProductParcelAssessment, PARCEL_CHOICES } from '@/utils/productParcelStatement';
import type { ProductParcelAssessment, ProductParcelOperatorRoutes, ProductParcelSources } from '@/types/productParcelReview';
export function ProductParcelAssessmentFields({sourceKey, sources, enabled, onPrepared, operatorRoutes}: {sourceKey: string; sources: ProductParcelSources; enabled: boolean; onPrepared: (value: ProductParcelAssessment | null) => void; operatorRoutes: ProductParcelOperatorRoutes | null}) {
  const [state, setState] = useState<{key: string; value: Partial<ProductParcelAssessment>; accepted: boolean} | null>(null), form = state?.key === sourceKey ? state : {key: sourceKey, value: {}, accepted: false};
  const change = (patch: Partial<ProductParcelAssessment>) => {if (enabled) {setState({key: sourceKey, value: {...form.value, ...patch}, accepted: false}); onPrepared(null);}};
  useEffect(() => {if (!enabled || state?.key !== sourceKey) onPrepared(null);}, [enabled, state?.key, sourceKey, onPrepared]);
  const leg = form.value.leg ? sources.legs.find(l => l.leg === form.value.leg) : null;
  const destinationKnown = !!form.value.leg && operatorRoutes?.destinationQualification[form.value.leg] === 'native_exact_destination';
  const locationQualified = form.value.locationComparison === 'unknown' || destinationKnown;
  return <View style={styles.section}>
    <Text style={styles.label}>Appréciation documentaire du colis sur les seules sources disponibles</Text><Text style={styles.caption}>L’intégrité du corpus, sa disponibilité et sa complétude restent distinctes. Une issue d’information incomplète ne devient jamais un examen documentaire complet.</Text>
    <ProductParcelChoiceField label="Trajet examiné" value={form.value.leg ?? null} options={PARCEL_CHOICES.leg} disabled={!enabled} onChange={leg => change({leg})} />
    {leg ? <Button variant="secondary" disabled={!enabled} onPress={() => change({labelId: leg.identity?.labelId ?? null})}>{leg.identity ? `Lier explicitement l’étiquette native ${leg.identity.labelId}` : 'Confirmer que l’étiquette actuelle reste inconnue'}</Button> : null}
    {(['deliveryFinding', 'locationComparison', 'lossDocumentFinding', 'parcelContentsFinding', 'responsibility', 'costTreatment'] as const).map(field => <ProductParcelChoiceField key={field} label={({deliveryFinding: 'Réception ou remise dans les sources', locationComparison: 'Comparaison du lieu', lossDocumentFinding: 'Document de perte', parcelContentsFinding: 'Observations de contenu', responsibility: 'Responsabilité', costTreatment: 'Traitement des frais'})[field]}
      value={form.value[field] ?? null} options={field === 'locationComparison' && !destinationKnown ? ['unknown'] as const : PARCEL_CHOICES[field]} disabled={!enabled} onChange={value => change({[field]: value})} />)}
    {!destinationKnown ? <Text style={styles.caption}>La destination exacte de ce trajet n’est pas qualifiée. Sa comparaison reste inconnue ; aucun profil actuel ne peut compléter l’adresse capturée.</Text> : null}
    {(['motivation', 'evidenceLimitations'] as const).map(field => <View key={field} style={styles.section}><Text style={styles.label}>{field === 'motivation' ? 'Motivation de l’appréciation colis' : 'Limites des sources examinées et pièces indisponibles'}</Text><TextInput accessibilityLabel={field === 'motivation' ? 'Motivation de l’appréciation colis' : 'Limites examinées du colis'} multiline editable={enabled} maxLength={4000} style={styles.input} value={form.value[field] ?? ''} onChangeText={value => change({[field]: value})} /></View>)}
    <Checkbox checked={form.accepted} disabled={!enabled} onToggle={() => {const accepted = !form.accepted, value = {...form.value, protocol: 'product_parcel_assessment_v1', availableSourcesOnlyAcknowledged: true}; setState({...form, accepted}); onPrepared(accepted && locationQualified && isProductParcelAssessment(value) ? value : null);}}><Text style={styles.caption}>J’ai examiné les seules sources effectivement disponibles, leur trajet, leur étiquette et leurs limites. Cette appréciation ne décide ni responsabilité, frais, remboursement ou indemnisation.</Text></Checkbox>
    {form.accepted && !isProductParcelAssessment({...form.value, protocol: 'product_parcel_assessment_v1', availableSourcesOnlyAcknowledged: true}) ? <Text accessibilityRole="alert" style={styles.caption}>Choisissez chaque appréciation, liez explicitement l’étiquette ou son absence, et complétez les deux motivations avant confirmation.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, label: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
