import { StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { ProductMaterialDateFields } from './ProductMaterialDateFields';
import { ProductMaterialObservationFields } from './ProductMaterialObservationFields';
import { PRODUCT_MATERIAL_INTERVENTION_LABELS, PRODUCT_MATERIAL_REASONS, PRODUCT_MATERIAL_REASON_LABELS } from '@/utils/productMaterialStatement';
import type { ProductMaterialInterventionKind, ProductMaterialStatementDraft } from '@/types/productMaterialReview';
const interventionStates = [{value: 'none_declared', label: 'Je ne déclare aucune intervention'}, {value: 'declared', label: 'Je déclare une ou plusieurs interventions'}, {value: 'unknown', label: 'Je ne sais pas'}] as const;
const dateLabels = {receivedAt: 'Date de réception selon votre déclaration', inspectedAt: 'Date d’inspection selon votre déclaration', complainedAt: 'Date de première contestation selon votre déclaration'} as const;
export function ProductMaterialStatementFields({value, onChange, disabled = false, actorRole}: {value: ProductMaterialStatementDraft;
  onChange: (next: ProductMaterialStatementDraft) => void; disabled?: boolean; actorRole: 'buyer' | 'seller' | null}) {
  const update = (patch: Partial<ProductMaterialStatementDraft>) => {if (!disabled) onChange({...value, ...patch});};
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Comparer le produit annoncé et le produit reçu</Text>
    <Text style={styles.caption}>Le contenu de la commande, votre souvenir de ce qui était promis et vos observations du produit reçu restent distincts. Cette déclaration ne certifie ni un défaut, une faute, une odeur ou une correspondance de taille et ne gèle pas automatiquement les fonds.</Text>
    <Text style={styles.label}>Quel produit et quelle étape déclarez-vous ?</Text>
    {([{value: 'purchase_received', label: 'Produit reçu lors de l’achat', role: 'buyer'}, {value: 'return_received', label: 'Contenu reçu en retour par le vendeur', role: 'seller'},
      {value: 'offered_item', label: 'Produit proposé par le vendeur', role: 'seller'}, {value: 'unknown', label: 'Étape ou réception inconnue', role: null}] as const)
      .filter(choice => choice.role === null || choice.role === actorRole).map(choice => <Button key={choice.value} disabled={disabled} variant={value.receivedScope === choice.value ? 'primary' : 'secondary'}
        onPress={() => update({receivedScope: choice.value})}>{choice.label}</Button>)}
    <Text style={styles.label}>Motif de votre déclaration</Text>
    {PRODUCT_MATERIAL_REASONS.map(reason => <Button key={reason} disabled={disabled} variant={value.reason === reason ? 'primary' : 'secondary'} onPress={() => update({reason})}>{PRODUCT_MATERIAL_REASON_LABELS[reason]}</Button>)}
    <Text style={styles.label}>Votre récit</Text>
    <TextInput multiline value={value.statement} maxLength={3000} editable={!disabled} style={styles.input} accessibilityLabel="Récit de comparaison matérielle" placeholder="Expliquez la différence ou l’incertitude que vous souhaitez faire examiner" placeholderTextColor={colors.muted} onChangeText={statement => update({statement})} />
    <ProductMaterialObservationFields title="Ce qui était promis selon votre déclaration" value={value.promised} disabled={disabled} onChange={promised => update({promised})} />
    <ProductMaterialObservationFields title={value.receivedScope === 'return_received' ? 'Contenu reçu en retour selon votre observation' : value.receivedScope === 'offered_item' ?
      'Produit proposé selon votre observation' : value.receivedScope === 'purchase_received' ? 'Produit reçu lors de l’achat selon votre observation' : 'Produit observé, étape inconnue'} value={value.received} disabled={disabled} onChange={received => update({received})} />
    <Text accessibilityRole="header" style={styles.title}>Chronologie déclarée</Text>
    <Text style={styles.caption}>Les dates inconnues restent inconnues. Des dates contradictoires mais non futures sont conservées telles que vous les déclarez, pour examen humain.</Text>
    {(Object.keys(dateLabels) as (keyof typeof dateLabels)[]).map(field => <ProductMaterialDateFields key={field} label={dateLabels[field]} value={value.chronology[field]} disabled={disabled}
      onChange={date => update({chronology: {...value.chronology, [field]: date}})} />)}
    <Text accessibilityRole="header" style={styles.title}>Interventions depuis la réception</Text>
    {interventionStates.map(choice => <Button key={choice.value} disabled={disabled} variant={value.interventions.state === choice.value ? 'primary' : 'secondary'}
      onPress={() => update({interventions: {...value.interventions, state: choice.value}})}>{choice.label}</Button>)}
    {value.interventions.state === 'declared' ? <>
      {value.interventions.entries.map((entry, index) => {
        const change = (patch: Partial<typeof entry>) => update({interventions: {...value.interventions, entries: value.interventions.entries.map(i => i.draftId === entry.draftId ? {...i, ...patch} : i)}});
        return <View key={entry.draftId} style={styles.intervention}>
          <Text style={styles.label}>Intervention {index + 1}</Text>
          {(Object.keys(PRODUCT_MATERIAL_INTERVENTION_LABELS) as ProductMaterialInterventionKind[]).map(kind => <Button key={kind} disabled={disabled} variant={entry.kind === kind ? 'primary' : 'secondary'} onPress={() => change({kind})}>{PRODUCT_MATERIAL_INTERVENTION_LABELS[kind]}</Button>)}
          <TextInput value={entry.description} multiline maxLength={1700} editable={!disabled} style={styles.input} placeholder="Décrivez cette intervention" placeholderTextColor={colors.muted} accessibilityLabel={`Description de l’intervention ${index + 1}`} onChangeText={description => change({description})} />
          <ProductMaterialDateFields label="Date déclarée de cette intervention" value={entry.date} disabled={disabled} onChange={date => change({date})} />
          <TextInput value={entry.beforeObservation} multiline maxLength={2000} editable={!disabled} style={styles.input} placeholder="Observation avant l’intervention, si connue" placeholderTextColor={colors.muted} accessibilityLabel={`Observation avant l’intervention ${index + 1}`} onChangeText={beforeObservation => change({beforeObservation})} />
          <TextInput value={entry.afterObservation} multiline maxLength={2000} editable={!disabled} style={styles.input} placeholder="Observation après l’intervention, si connue" placeholderTextColor={colors.muted} accessibilityLabel={`Observation après l’intervention ${index + 1}`} onChangeText={afterObservation => change({afterObservation})} />
          <Button variant="ghost" disabled={disabled} onPress={() => update({interventions: {...value.interventions, entries: value.interventions.entries.filter(i => i.draftId !== entry.draftId)}})}>Retirer cette intervention du brouillon</Button>
        </View>;
      })}
      <Button variant="secondary" disabled={disabled || value.interventions.entries.length >= 10} onPress={() => update({interventions: {...value.interventions,
        entries: [...value.interventions.entries, {draftId: randomUUID(), kind: null, description: '', date: {precision: null, value: ''}, beforeObservation: '', afterObservation: ''}]}})}>Ajouter une intervention déclarée</Button>
    </> : null}
    <Text style={styles.caption}>Au maximum 10 interventions. Une intervention ne prouve ni l’origine du problème ni une faute. Les images, échanges et éventuelles instructions de retour restent des étapes distinctes.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, intervention: {gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border},
  title: {...typography.body, color: colors.foreground}, label: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
