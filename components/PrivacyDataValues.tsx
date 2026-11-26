import {StyleSheet, Text, View} from 'react-native';
import type {PrivacyJson} from '@/types/privacyOperations';
import {colors, spacing, typography} from '@/constants/theme';
const labels: Record<string, string> = {displayName: 'Nom affiché', bio: 'Présentation', email: 'Courriel', phoneNumber: 'Téléphone', username: 'Nom de membre', dateOfBirth: 'Date de naissance', createdAt: 'Création', updatedAt: 'Mise à jour', title: 'Titre', description: 'Description', content: 'Contenu', type: 'Type', status: 'État', amount: 'Montant', currency: 'Devise', address: 'Adresse', preferences: 'Préférences', timestamp: 'Date', query: 'Recherche'};
const describe = (value: PrivacyJson): string => value === null ? 'Aucune valeur' : typeof value === 'boolean' ? value ? 'Oui' : 'Non' : typeof value === 'object' ? Array.isArray(value) ? value.map(describe).join(' ; ') : Object.entries(value).map(([k, v]) => `${labels[k] ?? k} : ${describe(v)}`).join('\n') : String(value);
export function PrivacyDataValues({values}: {values: Record<string, PrivacyJson>}) {
  return <View style={styles.section}>{Object.entries(values).map(([field, value]) => <View key={field} style={styles.field}><Text style={styles.label}>{labels[field] ?? field}</Text><Text selectable style={styles.value}>{describe(value)}</Text></View>)}</View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, field: {gap: spacing.xs}, label: {...typography.caption, color: colors.muted}, value: {...typography.bodySmall, color: colors.foreground}});
