import { StyleSheet, Text, View } from 'react-native';
import type { LabelRouteAction, LabelRouteEntry } from '@/types/labelRouteAmendment';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import {LabelParcelObservationCard} from '@/components/LabelParcelObservationCard';
export const LABEL_ROUTE_ACTION_LABELS: Record<LabelRouteAction, string> = {request_route: 'Demander un changement d’adresse', request_parcel: 'Demander une correction de mesures du colis', request_details: 'Demander des précisions', refuse_route: 'Refuser cette demande', propose_route: 'Proposer une route complète', accept_route: 'Accepter cette proposition exacte', withdraw_route: 'Retirer mon accord ou ma demande'};
export function LabelRouteEntryCard({entry}: {entry: LabelRouteEntry}) {
  const addresses = entry.route ? [{title: 'Origine proposée', address: entry.route.origin}, {title: 'Destination proposée', address: entry.route.destination}] : entry.address ? [{title: entry.endpoint === 'origin' ? 'Origine déclarée' : 'Destination déclarée', address: entry.address}] : [];
  return <View style={styles.section}><Text style={styles.body}>{LABEL_ROUTE_ACTION_LABELS[entry.action]}</Text><Text selectable style={styles.body}>{entry.reason}</Text>
    <Text style={styles.caption}>Enregistré le {new Date(entry.recordedAt).toLocaleString(APP_LOCALE)}. Référence {entry.reference.id}. Cet échange est historique ; il ne prouve pas l’état actuel du trajet.</Text>
    {addresses.map(({title, address}) => <Text selectable key={title} style={styles.body}>{title} : {[address.name, address.street, address.line2, address.city, address.province, address.postalCode, address.country].filter(Boolean).join(', ')}.</Text>)}
    {entry.route ? <Text selectable style={styles.caption}>Colis déclaré : {entry.route.parcel.weight.value} kg ; {entry.route.parcel.dimensions.length} × {entry.route.parcel.dimensions.width} × {entry.route.parcel.dimensions.height} cm. Transporteur {entry.route.carrierId} ({entry.route.carrierCode}), service {entry.route.serviceCode}.{entry.route.outboundLabelId ? ` Étiquette aller liée : ${entry.route.outboundLabelId}.` : ''}</Text> : null}
    {entry.parcelObservation ? <LabelParcelObservationCard observation={entry.parcelObservation} /> : null}
    {entry.handoverDeclaration ? <Text style={styles.caption}>Selon la déclaration enregistrée : {entry.handoverDeclaration === 'not_deposited_declared' ? 'colis non déposé' : entry.handoverDeclaration === 'deposited_declared' ? 'colis déjà déposé' : 'état du dépôt inconnu'}. Cette déclaration ne certifie pas la possession physique.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
