import { StyleSheet, Text, TextInput, View } from 'react-native';
import { LabelRouteAddressFields } from '@/components/LabelRouteAddressFields';
import type { LabelRouteAddress, LabelOperationalRoute } from '@/types/labelRouteAmendment';
import { colors, spacing, typography } from '@/constants/theme';
export interface LabelRouteDraft {origin: LabelRouteAddress; destination: LabelRouteAddress; weight: string; length: string; width: string; height: string; carrierId: string; carrierCode: string; serviceCode: string; outboundLabelId: string}
export const emptyLabelRouteAddress = (): LabelRouteAddress => ({name: '', street: '', city: '', province: 'QC', postalCode: '', country: 'CA'});
export const emptyLabelRouteDraft = (): LabelRouteDraft => ({origin: emptyLabelRouteAddress(), destination: emptyLabelRouteAddress(), weight: '', length: '', width: '', height: '', carrierId: '', carrierCode: '', serviceCode: '', outboundLabelId: ''});
export const canonicalLabelRouteAddress = (a: LabelRouteAddress): LabelRouteAddress => ({name: a.name.trim(), street: a.street.trim(), city: a.city.trim(), province: 'QC', country: 'CA', postalCode: a.postalCode.trim().toUpperCase().replace(' ', ''), ...(a.line2?.trim() ? {line2: a.line2.trim()} : {})});
export function buildLabelRouteDraft(v: LabelRouteDraft, leg: 'forward' | 'return'): LabelOperationalRoute {
  const number = (s: string) => /^\d+(?:[.,]\d+)?$/.test(s.trim()) ? Number(s.trim().replace(',', '.')) : Number.NaN;
  return {origin: canonicalLabelRouteAddress(v.origin), destination: canonicalLabelRouteAddress(v.destination), parcel: {weight: {value: number(v.weight), unit: 'kilogram'}, dimensions: {length: number(v.length), width: number(v.width), height: number(v.height), unit: 'centimeter'}}, carrierId: v.carrierId.trim(), carrierCode: v.carrierCode.trim(), serviceCode: v.serviceCode.trim(), outboundLabelId: leg === 'return' ? v.outboundLabelId.trim() : null};
}
const FIELDS = [{key: 'weight', label: 'Poids déclaré en kg'}, {key: 'length', label: 'Longueur en cm'}, {key: 'width', label: 'Largeur en cm'}, {key: 'height', label: 'Hauteur en cm'}, {key: 'carrierId', label: 'Identifiant natif du transporteur (se-…)'}, {key: 'carrierCode', label: 'Code transporteur'}, {key: 'serviceCode', label: 'Code service'}, {key: 'outboundLabelId', label: 'Étiquette aller liée au retour (se-…)'}] as const;
export function LabelRouteFields({value, leg, onChange, addressesLocked = false}: {value: LabelRouteDraft; leg: 'forward' | 'return'; onChange: (value: LabelRouteDraft) => void; addressesLocked?: boolean}) {
  return <View style={styles.section}>{addressesLocked ? <><Text style={styles.caption}>Correction de colis uniquement : les deux adresses natives précédentes sont conservées à l’identique. Un changement d’adresse demande son parcours distinct.</Text>
    <Text selectable style={styles.caption}>Origine conservée : {[value.origin.name, value.origin.street, value.origin.line2, value.origin.city, value.origin.province, value.origin.postalCode, value.origin.country].filter(Boolean).join(', ')}.</Text>
    <Text selectable style={styles.caption}>Destination conservée : {[value.destination.name, value.destination.street, value.destination.line2, value.destination.city, value.destination.province, value.destination.postalCode, value.destination.country].filter(Boolean).join(', ')}.</Text></> : <><LabelRouteAddressFields title="Origine de la proposition" value={value.origin} onChange={origin => onChange({...value, origin})} />
    <LabelRouteAddressFields title="Destination de la proposition" value={value.destination} onChange={destination => onChange({...value, destination})} /></>}
    {FIELDS.filter(f => f.key !== 'outboundLabelId' || leg === 'return').map(f => <TextInput key={f.key} accessibilityLabel={f.label} placeholder={f.label} value={value[f.key]} maxLength={100} autoCapitalize="none" style={styles.input} onChangeText={text => onChange({...value, [f.key]: text})} />)}
    <Text style={styles.caption}>Toute la route, le colis, le transporteur et le service font partie de cette proposition. Ces identifiants ne constituent ni un devis, ni un accord de dépense, ni un achat.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
