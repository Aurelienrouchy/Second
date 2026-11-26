import { StyleSheet, Text, View } from 'react-native';
import type { LabelRouteCapturedContext } from '@/types/labelRouteAmendment';
import { colors, spacing, typography } from '@/constants/theme';
export function LabelRouteCaptureCard({title, context, labelId}: {title: string; context: LabelRouteCapturedContext | null; labelId?: string | null}) {
  return <View style={styles.section}><Text style={styles.title}>{title}</Text>{context ? <>
    {labelId ? <Text selectable style={styles.caption}>Étiquette {labelId}.</Text> : null}
    {(['shipFrom', 'shipTo'] as const).map(endpoint => {const a = context[endpoint]; return <Text key={endpoint} selectable style={styles.body}>{endpoint === 'shipFrom' ? 'Origine' : 'Destination'} : {[a.name, a.addressLine1, a.addressLine2, a.cityLocality, a.stateProvince, a.postalCode, a.countryCode].filter(Boolean).join(', ')}.</Text>;})}
    <Text style={styles.caption}>Colis enregistré : {context.parcel.weight.value} kg ; {context.parcel.dimensions.length} × {context.parcel.dimensions.width} × {context.parcel.dimensions.height} cm. La capture ne prouve ni possession ni disponibilité actuelle du transporteur.</Text>
  </> : <Text style={styles.caption}>Capture inconnue ou non qualifiée. Aucune adresse de profil ne la remplace.</Text>}</View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
