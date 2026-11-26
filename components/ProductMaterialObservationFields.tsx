import { StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import type { ProductMaterialObservationDraft, ProductMaterialObservationKey } from '@/types/productMaterialReview';
import { PRODUCT_MATERIAL_OBSERVATION_LABELS, PRODUCT_MATERIAL_OBSERVATION_LIMITS } from '@/utils/productMaterialStatement';
const systems = [{value: 'EU', label: 'Système européen déclaré'}, {value: 'US', label: 'Système américain déclaré'}, {value: 'unknown', label: 'Système inconnu'}] as const;
const units = [{value: 'cm', label: 'Centimètres'}, {value: 'mm', label: 'Millimètres'}, {value: 'in', label: 'Pouces'}, {value: 'unknown', label: 'Unité inconnue'}] as const;
export function ProductMaterialObservationFields({title, value, onChange, disabled = false}: {title: string; value: ProductMaterialObservationDraft;
  onChange: (next: ProductMaterialObservationDraft) => void; disabled?: boolean}) {
  const update = (patch: Partial<ProductMaterialObservationDraft>) => {if (!disabled) onChange({...value, ...patch});};
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    <Text style={styles.caption}>Décrivez ce que vous connaissez. Un champ laissé vide reste inconnu ; aucune information de l’annonce actuelle n’est recopiée automatiquement.</Text>
    {(Object.keys(PRODUCT_MATERIAL_OBSERVATION_LIMITS) as ProductMaterialObservationKey[]).map(field => <View key={field} style={styles.field}>
      <Text style={styles.label}>{PRODUCT_MATERIAL_OBSERVATION_LABELS[field]}</Text>
      <TextInput value={value[field]} onChangeText={text => update({[field]: text})} multiline editable={!disabled} maxLength={PRODUCT_MATERIAL_OBSERVATION_LIMITS[field]}
        accessibilityLabel={`${title} : ${PRODUCT_MATERIAL_OBSERVATION_LABELS[field]}`} placeholder="Inconnu si vous ne disposez pas de cette information" placeholderTextColor={colors.muted} style={styles.input} />
    </View>)}
    <Text style={styles.label}>Système de taille indiqué</Text>
    {systems.map(choice => <Button key={choice.value} variant={value.sizeSystem === choice.value ? 'primary' : 'secondary'} disabled={disabled} onPress={() => update({sizeSystem: choice.value})}>{choice.label}</Button>)}
    <Text style={styles.caption}>Le système n’est pas sélectionné initialement. Aucune équivalence EU/US ou conclusion sur la taille n’est calculée.</Text>
    <Text style={styles.label}>Couleurs déclarées</Text>
    <TextInput value={value.colors} multiline editable={!disabled} maxLength={4200} onChangeText={colors => update({colors})} style={styles.input}
      accessibilityLabel={`${title} : couleurs déclarées`} placeholder="Une couleur par ligne ; vide si inconnu" placeholderTextColor={colors.muted} />
    <Text style={styles.label}>Matières déclarées</Text>
    <TextInput value={value.materials} multiline editable={!disabled} maxLength={4200} onChangeText={materials => update({materials})} style={styles.input}
      accessibilityLabel={`${title} : matières déclarées`} placeholder="Une matière par ligne ; vide si inconnu" placeholderTextColor={colors.muted} />
    <Text style={styles.caption}>Au maximum 20 couleurs et 20 matières, 200 caractères par ligne. Aucun intitulé ou mélange n’est interprété ou converti.</Text>
    <Text style={styles.label}>Mesures déclarées, si disponibles</Text>
    {value.measurements.map((measurement, index) => {
      const change = (patch: Partial<typeof measurement>) => update({measurements: value.measurements.map(m => m.draftId === measurement.draftId ? {...m, ...patch} : m)});
      return <View key={measurement.draftId} style={styles.measurement}>
        <Text style={styles.label}>Mesure {index + 1}</Text>
        <TextInput value={measurement.name} maxLength={200} editable={!disabled} style={styles.input} placeholder="Nom de la mesure, par exemple largeur sous les bras" placeholderTextColor={colors.muted} onChangeText={name => change({name})} accessibilityLabel={`Nom de la mesure ${index + 1}`} />
        <TextInput value={measurement.value} maxLength={100} editable={!disabled} style={styles.input} placeholder="Valeur telle que vous la déclarez, même approximative" placeholderTextColor={colors.muted} onChangeText={value => change({value})} accessibilityLabel={`Valeur déclarée de la mesure ${index + 1}`} />
        {units.map(choice => <Button key={choice.value} variant={measurement.unit === choice.value ? 'primary' : 'secondary'} disabled={disabled} onPress={() => change({unit: choice.value})}>{choice.label}</Button>)}
        <TextInput value={measurement.method} multiline maxLength={1000} editable={!disabled} style={styles.input} placeholder="Méthode ou emplacement de la mesure, si connu" placeholderTextColor={colors.muted} onChangeText={method => change({method})} accessibilityLabel={`Méthode déclarée de la mesure ${index + 1}`} />
        <Button variant="ghost" disabled={disabled} onPress={() => update({measurements: value.measurements.filter(m => m.draftId !== measurement.draftId)})}>Retirer cette mesure du brouillon</Button>
      </View>;
    })}
    <Button variant="secondary" disabled={disabled || value.measurements.length >= 20} onPress={() => update({measurements: [...value.measurements, {draftId: randomUUID(), name: '', value: '', unit: null, method: ''}]})}>Ajouter une mesure déclarée</Button>
    <Text style={styles.caption}>Les valeurs et unités restent celles de votre déclaration. Ces mesures ne certifient pas les dimensions réelles ou la façon dont le vêtement va.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, field: {gap: spacing.xs}, measurement: {gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border},
  title: {...typography.body, color: colors.foreground}, label: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
