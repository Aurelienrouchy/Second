import {StyleSheet, Text, TextInput, View} from 'react-native';
import {Button} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
import type {LabelParcelObservation, LabelPreviousParcel} from '@/types/labelRouteAmendment';
export interface LabelParcelObservationDraft {weight: string; weightUnit: LabelParcelObservation['weight']['unit']; length: string; width: string; height: string; dimensionUnit: LabelParcelObservation['dimensions']['unit']; observedAt: string; method: string}
export const emptyLabelParcelObservationDraft = (): LabelParcelObservationDraft => ({weight: '', weightUnit: 'unknown', length: '', width: '', height: '', dimensionUnit: 'unknown', observedAt: '', method: ''});
export function buildLabelParcelObservation(d: LabelParcelObservationDraft, previousParcel: LabelPreviousParcel): LabelParcelObservation {
  const number = (s: string) => !s.trim() ? null : /^\d+(?:[.,]\d+)?$/.test(s.trim()) ? Number(s.trim().replace(',', '.')) : Number.NaN;
  return {protocol: 'label_parcel_measurement_statement_v1', previousParcel: {...previousParcel}, weight: {value: d.weightUnit === 'unknown' ? null : number(d.weight), unit: d.weightUnit},
    dimensions: {length: d.dimensionUnit === 'unknown' ? null : number(d.length), width: d.dimensionUnit === 'unknown' ? null : number(d.width), height: d.dimensionUnit === 'unknown' ? null : number(d.height), unit: d.dimensionUnit}, observedAt: d.observedAt.trim() || null, method: d.method.trim() || null};
}
const weightUnits = [{value: 'unknown', label: 'Unité de poids inconnue'}, {value: 'kilogram', label: 'Kilogramme (kg)'}, {value: 'gram', label: 'Gramme (g)'}, {value: 'pound', label: 'Livre (lb)'}, {value: 'ounce', label: 'Once (oz)'}] as const;
const dimensionsUnits = [{value: 'unknown', label: 'Unité de dimensions inconnue'}, {value: 'centimeter', label: 'Centimètre (cm)'}, {value: 'millimeter', label: 'Millimètre (mm)'}, {value: 'inch', label: 'Pouce (in)'}] as const;
const dimensions = [{key: 'length', label: 'Longueur déclarée'}, {key: 'width', label: 'Largeur déclarée'}, {key: 'height', label: 'Hauteur déclarée'}] as const;
export function LabelParcelObservationFields({value, onChange}: {value: LabelParcelObservationDraft; onChange: (value: LabelParcelObservationDraft) => void}) {
  return <View style={styles.section}><Text style={styles.title}>Mesures du colis selon votre observation</Text>
    <Text style={styles.caption}>Indiquez uniquement les mesures connues et leurs unités. Aucune conversion n’est appliquée. Changer d’unité efface les valeurs associées ; une valeur vide reste inconnue et n’est jamais remplacée par zéro.</Text>
    {weightUnits.map(unit => <Button key={unit.value} variant={value.weightUnit === unit.value ? 'primary' : 'secondary'} onPress={() => onChange({...value, weightUnit: unit.value, weight: value.weightUnit === unit.value ? value.weight : ''})}>{unit.label}</Button>)}
    <TextInput accessibilityLabel="Poids observé déclaré" placeholder="Poids déclaré, ou vide si inconnu" value={value.weight} editable={value.weightUnit !== 'unknown'} keyboardType="decimal-pad" maxLength={100} onChangeText={weight => onChange({...value, weight})} style={styles.input} />
    {dimensionsUnits.map(unit => <Button key={unit.value} variant={value.dimensionUnit === unit.value ? 'primary' : 'secondary'} onPress={() => onChange({...value, dimensionUnit: unit.value, ...(value.dimensionUnit === unit.value ? {} : {length: '', width: '', height: ''})})}>{unit.label}</Button>)}
    {dimensions.map(field => <TextInput key={field.key} accessibilityLabel={field.label} placeholder={`${field.label}, ou vide si inconnue`} value={value[field.key]} editable={value.dimensionUnit !== 'unknown'} keyboardType="decimal-pad" maxLength={100} onChangeText={text => onChange({...value, [field.key]: text})} style={styles.input} />)}
    <Text style={styles.caption}>Date d’observation facultative, en UTC exact AAAA-MM-JJTHH:mm:ss.sssZ. Laissez vide si elle est inconnue. Une date future n’est pas recevable.</Text>
    <TextInput accessibilityLabel="Date UTC déclarée de mesure du colis" placeholder="Date UTC, ou vide si inconnue" value={value.observedAt} maxLength={24} autoCapitalize="none" onChangeText={observedAt => onChange({...value, observedAt})} style={styles.input} />
    <TextInput accessibilityLabel="Méthode déclarée de mesure du colis" placeholder="Méthode de mesure et ses limites, facultatif" value={value.method} maxLength={1000} multiline onChangeText={method => onChange({...value, method})} style={styles.input} />
    <Text style={styles.caption}>Ces mesures sont une déclaration. Elles ne certifient ni poids physique, ni tarif, ni admissibilité chez le transporteur.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
