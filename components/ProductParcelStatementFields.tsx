import { StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { ProductMaterialDateFields } from '@/components/ProductMaterialDateFields';
import { ProductParcelChoiceField } from './ProductParcelChoiceField';
import { colors, spacing, typography } from '@/constants/theme';
import { PARCEL_CHOICES, PARCEL_CLOCK_LABELS, PRODUCT_PARCEL_REASONS, PRODUCT_PARCEL_REASON_LABELS,PRODUCT_PARCEL_MIXED_REASON } from '@/utils/productParcelStatement';
import type { ProductParcelStatementDraft } from '@/types/productParcelReview';
const emptyDate = () => ({precision: null, value: ''} as const);
const input = (label: string, value: string | null, max: number, disabled: boolean, change: (text: string) => void) => <View style={styles.section}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value ?? ''} maxLength={max} multiline editable={!disabled} style={styles.input} onChangeText={text => {if (!disabled) change(text);}} /></View>;
export function ProductParcelStatementFields({value, onChange, disabled, actorRole,mixedOrders=false}: {value: ProductParcelStatementDraft; onChange: (value: ProductParcelStatementDraft) => void; disabled: boolean; actorRole: 'buyer' | 'seller' | null;mixedOrders?:boolean}) {
  const change = (patch: Partial<ProductParcelStatementDraft>) => {if (!disabled) onChange({...value, ...patch});};
  const recipient = actorRole && value.leg && actorRole === (value.leg === 'forward' ? 'buyer' : 'seller');
  return <View style={styles.section}>
    <Text style={styles.caption}>Chaque renseignement reste déclaré. Une signature ne prouve pas un accord ; une photo, une masse ou un scan ne certifie pas le contenu du colis.</Text>
    <Text style={styles.label}>Motif du constat</Text>{[...PRODUCT_PARCEL_REASONS,...(mixedOrders&&value.mixedOrderStatement?[PRODUCT_PARCEL_MIXED_REASON]:[])].map(reason => <Button key={reason} variant={value.reason === reason ? 'primary' : 'secondary'} disabled={disabled} onPress={() => change({reason})}>{PRODUCT_PARCEL_REASON_LABELS[reason]}</Button>)}
    {value.reason===PRODUCT_PARCEL_MIXED_REASON?<Text style={styles.caption}>Ce motif décrit seulement un mélange observé ou inconnu. Il ne déclare ni dommage, perte, erreur de lieu, faute ou droit à remboursement.</Text>:null}
    <ProductParcelChoiceField label="Trajet concerné" value={value.leg} options={PARCEL_CHOICES.leg} disabled={disabled} onChange={leg => change({leg})} />
    {input('Référence d’étiquette déclarée, si connue', value.labelId, 200, disabled, labelId => change({labelId}))}
    <ProductParcelChoiceField label="Réception selon votre déclaration" value={value.receipt} options={recipient ? PARCEL_CHOICES.receipt : ['unknown'] as const} disabled={disabled} onChange={receipt => change({receipt})} />
    {!recipient ? <Text style={styles.caption}>Seul le destinataire natif de ce trajet peut déclarer réception ou non-réception. Les observations de l’expéditeur restent recevables avec une réception inconnue.</Text> : null}
    {(['packaging', 'parcel', 'contents', 'location'] as const).map(field => <View key={field}>{input({packaging: 'Emballage déclaré', parcel: 'Aspect du colis déclaré', contents: 'Contenu observé selon vous', location: 'Lieu de remise déclaré'}[field], value[field], field === 'contents' ? 3000 : 2000, disabled, text => change({[field]: text}))}</View>)}
    <ProductParcelChoiceField label="Scellé selon vous" value={value.seal} options={PARCEL_CHOICES.seal} disabled={disabled} onChange={seal => change({seal})} />
    <ProductParcelChoiceField label="Ouverture selon vous" value={value.opening} options={PARCEL_CHOICES.opening} disabled={disabled} onChange={opening => change({opening})} />
    <Text style={styles.label}>Masses déclarées — aucune conversion</Text>
    {value.weights.map((weight, index) => {const edit = (patch: Partial<typeof weight>) => change({weights: value.weights.map(w => w.draftId === weight.draftId ? {...w, ...patch} : w)}); return <View key={weight.draftId} style={styles.section}>
      {input(`Masse ${index + 1}, valeur écrite`, weight.value, 100, disabled, text => edit({value: text}))}
      <ProductParcelChoiceField label="Unité de masse" value={weight.unit} options={PARCEL_CHOICES.unit} disabled={disabled} onChange={unit => edit({unit})} />
      {input('Méthode de pesée déclarée', weight.method, 1000, disabled, method => edit({method}))}
      <ProductParcelChoiceField label="Source de la masse" value={weight.source} options={PARCEL_CHOICES.source} disabled={disabled} onChange={source => edit({source})} />
      <ProductParcelChoiceField label="Moment de la pesée" value={weight.phase} options={PARCEL_CHOICES.phase} disabled={disabled} onChange={phase => edit({phase})} />
      <ProductMaterialDateFields label="Date déclarée de cette pesée" value={weight.occurredAt} disabled={disabled} onChange={occurredAt => edit({occurredAt})} />
      <Button variant="ghost" disabled={disabled} onPress={() => change({weights: value.weights.filter(w => w.draftId !== weight.draftId)})}>Retirer cette masse du brouillon</Button>
    </View>;})}
    <Button variant="secondary" disabled={disabled || value.weights.length >= 10} onPress={() => change({weights: [...value.weights, {draftId: randomUUID(), value: '', unit: null, method: '', source: null, occurredAt: emptyDate(), phase: null}]})}>Ajouter une masse déclarée</Button>
    <Text style={styles.caption}>Les dimensions du colis et sa masse sont distinctes. Aucun changement de contenu, faute ou perte n’est déduit d’une différence de masse.</Text>
    <Text style={styles.label}>Remises successives déclarées</Text>
    {value.handover.map((handover, index) => {const edit = (patch: Partial<typeof handover>) => change({handover: value.handover.map(h => h.draftId === handover.draftId ? {...h, ...patch} : h)}); return <View key={handover.draftId} style={styles.section}>
      <Text style={styles.label}>Remise déclarée {index + 1}</Text><ProductParcelChoiceField label="Remis par" value={handover.from} options={PARCEL_CHOICES.party} disabled={disabled} onChange={from => edit({from})} />
      <ProductParcelChoiceField label="Remis à" value={handover.to} options={PARCEL_CHOICES.party} disabled={disabled} onChange={to => edit({to})} />
      <ProductMaterialDateFields label="Date de la remise déclarée" value={handover.occurredAt} disabled={disabled} onChange={occurredAt => edit({occurredAt})} />
      {input('Observation sur cette remise', handover.observation, 1000, disabled, observation => edit({observation}))}{input('Référence déclarée de cette remise', handover.reference, 500, disabled, reference => edit({reference}))}
      <Button variant="ghost" disabled={disabled} onPress={() => change({handover: value.handover.filter(h => h.draftId !== handover.draftId)})}>Retirer cette remise du brouillon</Button>
    </View>;})}
    <Button variant="secondary" disabled={disabled || value.handover.length >= 20} onPress={() => change({handover: [...value.handover, {draftId: randomUUID(), from: null, to: null, occurredAt: emptyDate(), observation: '', reference: ''}]})}>Ajouter une remise déclarée</Button>
    <ProductParcelChoiceField label="Remise à un tiers selon vous" value={value.thirdParty.recipient} options={PARCEL_CHOICES.recipient} disabled={disabled} onChange={recipient => change({thirdParty: {...value.thirdParty, recipient}})} />
    <ProductParcelChoiceField label="Autorisation du tiers selon vous" value={value.thirdParty.authorization} options={PARCEL_CHOICES.authorization} disabled={disabled} onChange={authorization => change({thirdParty: {...value.thirdParty, authorization}})} />
    <ProductParcelChoiceField label="Signature selon vous" value={value.thirdParty.signature} options={PARCEL_CHOICES.signature} disabled={disabled} onChange={signature => change({thirdParty: {...value.thirdParty, signature}})} />
    {input('Référence déclarée du tiers ou de la signature', value.thirdParty.reference, 500, disabled, reference => change({thirdParty: {...value.thirdParty, reference}}))}
    <ProductParcelChoiceField label="Dépôt selon vous" value={value.deposit.state} options={PARCEL_CHOICES.deposit} disabled={disabled} onChange={state => change({deposit: {...value.deposit, state}})} />
    {input('Lieu de dépôt déclaré', value.deposit.location, 1000, disabled, location => change({deposit: {...value.deposit, location}}))}
    <ProductMaterialDateFields label="Disparition après dépôt, selon vous" value={value.deposit.disappearanceAt} disabled={disabled} onChange={disappearanceAt => change({deposit: {...value.deposit, disappearanceAt}})} />
    {(Object.keys(PARCEL_CLOCK_LABELS) as (keyof typeof PARCEL_CLOCK_LABELS)[]).map(field => <ProductMaterialDateFields key={field} label={PARCEL_CLOCK_LABELS[field]} value={value.chronology[field]} disabled={disabled} onChange={date => change({chronology: {...value.chronology, [field]: date}})} />)}
    <Text style={styles.label}>Document de perte ou d’enquête, selon votre déclaration</Text>
    {value.lossDocument ? <>
      {input('Émetteur déclaré du document', value.lossDocument.issuer, 500, disabled, issuer => change({lossDocument: {...value.lossDocument!, issuer}}))}
      <ProductParcelChoiceField label="Rôle déclaré de l’émetteur" value={value.lossDocument.issuerRole} options={PARCEL_CHOICES.issuerRole} disabled={disabled} onChange={issuerRole => change({lossDocument: {...value.lossDocument!, issuerRole}})} />
      {input('Référence déclarée du document', value.lossDocument.reference, 500, disabled, reference => change({lossDocument: {...value.lossDocument!, reference}}))}
      {input('Étiquette citée dans ce document', value.lossDocument.labelId, 200, disabled, labelId => change({lossDocument: {...value.lossDocument!, labelId}}))}
      <ProductMaterialDateFields label="Date déclarée du document" value={value.lossDocument.issuedAt} disabled={disabled} onChange={issuedAt => change({lossDocument: {...value.lossDocument!, issuedAt}})} />
      <ProductParcelChoiceField label="Conclusion déclarée du document" value={value.lossDocument.conclusion} options={PARCEL_CHOICES.conclusion} disabled={disabled} onChange={conclusion => change({lossDocument: {...value.lossDocument!, conclusion}})} />
      <Button variant="ghost" disabled={disabled} onPress={() => change({lossDocument: null})}>Retirer la description du document</Button>
    </> : <Button variant="secondary" disabled={disabled} onPress={() => change({lossDocument: {issuer: '', issuerRole: null, reference: '', issuedAt: emptyDate(), labelId: '', conclusion: null}})}>Décrire un document dont je dispose</Button>}
    <ProductParcelChoiceField label="Disponibilité déclarée des pièces" value={value.evidenceAvailability} options={PARCEL_CHOICES.evidenceAvailability} disabled={disabled} onChange={evidenceAvailability => change({evidenceAvailability})} />
    {input('Limites et pièces indisponibles selon vous', value.evidenceLimitations, 2000, disabled, evidenceLimitations => change({evidenceLimitations}))}
    {input('Récit personnel du constat', value.statement, 2500, disabled, statement => change({statement}))}
    <Text style={styles.caption}>Les images privées s’ajoutent séparément à la contribution enregistrée. Sans réception, aucune photo du colis ne peut être exigée comme preuve de non-réception.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, label: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
