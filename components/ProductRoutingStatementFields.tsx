import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { ProductMaterialDateFields } from '@/components/ProductMaterialDateFields';
import { colors, spacing, typography } from '@/constants/theme';
import { ROUTING_CHOICES, ROUTING_LABELS } from '@/utils/productRoutingStatement';
import type { ProductRoutingStatementDraft, ProductRoutingPlace } from '@/types/productRoutingReview';
const placeLabels: Record<keyof ProductRoutingPlace, string> = { country: 'Pays déclaré', province: 'Province ou région déclarée', city: 'Ville déclarée', postalCode: 'Code postal déclaré', detail: 'Précisions du lieu déclaré' };
export function ProductRoutingStatementFields({ value, disabled, onChange }: {
    value: ProductRoutingStatementDraft;
    disabled: boolean;
    onChange: (value: ProductRoutingStatementDraft) => void;
}) {
    const change = (patch: Partial<ProductRoutingStatementDraft>) => { if (!disabled)
        onChange({ ...value, ...patch }); };
    return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Observation d’acheminement ou correction rapportée</Text>
    <Text style={styles.caption}>Ce constat sera ajouté au dossier sans remplacer un constat antérieur. Un transit hors Québec n’établit pas une erreur. Les lieux décrits, y compris à l’extérieur du Québec, ne deviennent pas une nouvelle adresse contractuelle.</Text>
    {(Object.keys(ROUTING_CHOICES) as (keyof typeof ROUTING_CHOICES)[]).map(field => <View key={field} style={styles.section}>
      <Text style={styles.body}>{({ kind: 'Nature du constat', phase: 'Phase observée', correctionReported: 'Correction rapportée selon vous', source: 'Source déclarée de cette information', evidenceAvailability: 'Disponibilité des pièces du routage' })[field]}</Text>
      {ROUTING_CHOICES[field].map(option => <Button key={option} variant={value[field] === option ? 'primary' : 'secondary'} disabled={disabled} onPress={() => change({ [field]: option })}>{ROUTING_LABELS[option]}</Button>)}
    </View>)}
    {(['issuer', 'reference', 'evidenceLimitations'] as const).map(field => <View key={field} style={styles.section}><Text style={styles.body}>{({ issuer: 'Émetteur de la correction ou de l’information rapportée, si connu', reference: 'Référence du message ou document, si connue', evidenceLimitations: 'Limites et pièces indisponibles selon vous' })[field]}</Text>
      <TextInput accessibilityLabel={({ issuer: 'Émetteur déclaré de l’information de routage', reference: 'Référence déclarée de routage', evidenceLimitations: 'Limites déclarées du routage' })[field]} value={value[field] ?? ''} maxLength={field === 'evidenceLimitations' ? 2000 : 500} multiline editable={!disabled} style={styles.input} onChangeText={text => change({ [field]: text })}/></View>)}
    <ProductMaterialDateFields label="Date de l’observation ou correction rapportée" value={value.occurredAt} disabled={disabled} onChange={occurredAt => change({ occurredAt })}/>
    {(['previousPlace', 'observedPlace'] as const).map(field => <View key={field} style={styles.section}><Text style={styles.body}>{field === 'previousPlace' ? 'Ancien lieu rapporté' : 'Nouveau lieu ou lieu observé rapporté'}</Text>
      <Button variant={value[field] === null ? 'primary' : 'secondary'} disabled={disabled} onPress={() => change({ [field]: null })}>Lieu inconnu</Button>
      <Button variant={value[field] !== null ? 'primary' : 'secondary'} disabled={disabled} onPress={() => change({ [field]: value[field] ?? { country: '', province: '', city: '', postalCode: '', detail: '' } })}>Décrire ce lieu sans le certifier</Button>
      {value[field] ? (Object.keys(placeLabels) as (keyof ProductRoutingPlace)[]).map(key => <View key={key} style={styles.section}><Text style={styles.caption}>{placeLabels[key]}</Text><TextInput accessibilityLabel={`${field === 'previousPlace' ? 'Ancien lieu' : 'Lieu observé'} : ${placeLabels[key]}`} value={value[field]?.[key] ?? ''} maxLength={key === 'city' ? 300 : key === 'detail' ? 1000 : 100} multiline editable={!disabled} style={styles.input} onChangeText={text => change({ [field]: { ...value[field]!, [key]: text } })}/></View>) : null}
    </View>)}
    <Text style={styles.caption}>Le trajet et l’étiquette sont ceux choisis explicitement dans le constat colis. Une correction rapportée ne modifie ni l’étiquette, le contrat, les frais ou les fonds, et ne promet aucune interception ou récupération physique.</Text>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.sm }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted }, input: { ...typography.bodySmall, color: colors.foreground, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md } });
