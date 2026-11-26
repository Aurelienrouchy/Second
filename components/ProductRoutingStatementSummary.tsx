import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { ROUTING_LABELS } from '@/utils/productRoutingStatement';
import type { ProductRoutingStatement, ProductRoutingPlace } from '@/types/productRoutingReview';
const place = (value: ProductRoutingPlace | null) => value ? Object.values(value).filter(Boolean).join(', ') || 'Lieu non précisé' : 'Lieu inconnu';
export function ProductRoutingStatementSummary({ statement }: {
    statement: ProductRoutingStatement;
}) {
    return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Routage déclaré — distinct de la route native</Text>
    <Text style={styles.body}>{ROUTING_LABELS[statement.kind]} · {ROUTING_LABELS[statement.phase]} · {statement.leg === 'forward' ? 'aller' : 'retour'}.</Text>
    <Text selectable style={styles.caption}>Étiquette déclarée : {statement.labelId ?? 'inconnue'}.</Text>
    <Text style={styles.body}>{ROUTING_LABELS[statement.correctionReported]} · {ROUTING_LABELS[statement.source]}. Émetteur déclaré : {statement.issuer ?? 'inconnu'} ; référence {statement.reference ?? 'inconnue'}.</Text>
    <Text style={styles.caption}>Date déclarée : {statement.occurredAt ? new Date(statement.occurredAt).toLocaleString(APP_LOCALE, { timeZone: 'America/Toronto' }) : 'instant inconnu ; voir les précisions du récit'}.</Text>
    <Text selectable style={styles.body}>Ancien lieu rapporté : {place(statement.previousPlace)}. Lieu observé ou nouveau lieu rapporté : {place(statement.observedPlace)}.</Text>
    <Text style={styles.caption}>Pièces : {ROUTING_LABELS[statement.evidenceAvailability]}. Limites : {statement.evidenceLimitations ?? 'non précisées'}.</Text>
    <Text style={styles.caption}>Un transit hors Québec n’établit pas une erreur. L’émetteur, la correction et les lieux restent déclarés. Aucun contrat, label, frais ou fonds n’est modifié ; aucune possession, remise ou récupération physique n’est certifiée.</Text>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, paddingVertical: spacing.sm }, title: { ...typography.body, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foreground }, caption: { ...typography.caption, color: colors.muted } });
