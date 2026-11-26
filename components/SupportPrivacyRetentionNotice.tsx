import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import type { SupportPrivacyRetention } from '@/types/supportRequest';
import { SUPPORT_PRIVACY_CATEGORY_LABELS } from '@/utils/supportPrivacyPresentation';

export function SupportPrivacyRetentionNotice({retention, compact = false}: {retention: SupportPrivacyRetention; compact?: boolean}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Conservation liée à cette demande</Text>
    <Text style={styles.body}>{retention.qualification === 'native_preservation'
      ? 'Une mesure de conservation est enregistrée. Sa levée nécessite encore un examen qualifié.'
      : 'La portée de conservation ne peut pas être qualifiée dans cet historique. Une conservation large reste à examiner.'}</Text>
    {!compact ? <>
      <Text style={styles.body}>{retention.protectedCategories.includes('other_or_unknown') ? 'L’ensemble des données personnelles reste concerné, y compris les catégories encore à préciser.' :
        `Catégories protégées : ${retention.protectedCategories.map(category => SUPPORT_PRIVACY_CATEGORY_LABELS[category]).join(', ')}.`}</Text>
      {retention.declaredScope?.description ? <Text selectable style={styles.body}>Précisions déclarées : {retention.declaredScope.description}</Text> : null}
      {retention.declaredScope?.objects.map(object => <Text selectable key={`declared:${JSON.stringify([object.category, object.id])}`} style={styles.caption}>
        Référence déclarée dans la demande : {SUPPORT_PRIVACY_CATEGORY_LABELS[object.category]} · {object.id}
      </Text>)}
      {retention.protectedObjects.slice(0, 20).map(object => <Text selectable key={`${object.category}/${object.id}`} style={styles.caption}>
        Référence conservée : {SUPPORT_PRIVACY_CATEGORY_LABELS[object.category]} · {object.id}
      </Text>)}
      {retention.protectedObjects.length > 20 ? <Text style={styles.caption}>{retention.protectedObjects.length} références protégées au total ; seules les 20 premières sont présentées ici. Cette vue n’est pas un export exhaustif.</Text> : null}
      {retention.initialReceivedAt ? <Text style={styles.caption}>Réception initiale suivie : {new Date(retention.initialReceivedAt).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'})} (heure du Québec) · Version {retention.ticketVersion}.</Text> : null}
      <Text style={styles.caption}>Une réponse ou un retrait ne lève pas cette conservation. Aucune échéance légale de destruction ni restauration d’une donnée déjà supprimée n’est attestée.</Text>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
