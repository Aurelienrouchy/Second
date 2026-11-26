import {StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '@/constants/theme';
import {APP_LOCALE} from '@/constants/locale';
import type {LabelParcelObservation} from '@/types/labelRouteAmendment';
const weightUnits = {kilogram: 'kg', gram: 'g', pound: 'lb', ounce: 'oz', unknown: 'unité inconnue'};
const dimensionUnits = {centimeter: 'cm', millimeter: 'mm', inch: 'in', unknown: 'unité inconnue'};
export function LabelParcelObservationCard({observation}: {observation: LabelParcelObservation}) {
  const previous = observation.previousParcel;
  return <View style={styles.section}><Text style={styles.body}>Correction de mesures déclarée, sans demande de changement d’adresse</Text>
    <Text style={styles.caption}>Source précédente : {previous.qualification === 'native_current_label_route' ? 'route native de l’étiquette courante lors de la demande' : previous.qualification === 'native_historical_route' ? 'route historique native lors de la demande' : 'inconnue'}. Cette référence historique ne prouve pas son actualité.</Text>
    <Text selectable style={styles.caption}>Empreinte précédente : {previous.sourceHash ?? 'inconnue'} · étiquette : {previous.labelId ?? 'inconnue ou non liée à cette source historique'}.</Text>
    <Text style={styles.body}>Poids déclaré : {observation.weight.value ?? 'inconnu'} {weightUnits[observation.weight.unit]}.</Text>
    <Text style={styles.body}>Dimensions déclarées : {observation.dimensions.length ?? 'inconnue'} × {observation.dimensions.width ?? 'inconnue'} × {observation.dimensions.height ?? 'inconnue'} {dimensionUnits[observation.dimensions.unit]}.</Text>
    <Text style={styles.caption}>Date d’observation déclarée : {observation.observedAt ? new Date(observation.observedAt).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'}) : 'inconnue'} (heure du Québec).</Text>
    <Text selectable style={styles.caption}>Méthode déclarée : {observation.method ?? 'inconnue'}.</Text>
    <Text style={styles.caption}>Aucune conversion n’a été appliquée. La déclaration ne certifie ni mesures physiques, ni coût ou autorisation de transport ; la source précédente reste conservée.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
