import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { SUPPORT_PRIVACY_CATEGORIES } from '@/types/supportRequest';
import type { SupportPrivacyCategory, SupportPrivacyScope } from '@/types/supportRequest';
import { SUPPORT_PRIVACY_CATEGORY_LABELS, supportPrivacyObjectError, toggleSupportPrivacyCategory } from '@/utils/supportPrivacyPresentation';

interface Props {value: SupportPrivacyScope | null; onChange: (scope: SupportPrivacyScope | null) => void; disabled: boolean; existing?: boolean}
export function SupportPrivacyScopeFields({value, onChange, disabled, existing = false}: Props) {
  const [objectCategory, setObjectCategory] = useState<SupportPrivacyCategory | null>(null);
  const [objectId, setObjectId] = useState('');
  const objectError = value ? supportPrivacyObjectError(value, objectCategory, objectId) : null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Portée de votre demande, facultative</Text>
    <Text style={styles.body}>{existing ? 'Sans nouvelle précision, la portée déjà enregistrée reste conservée.' :
      'Sans précision, la demande concerne toutes vos données personnelles.'} Une précision ultérieure peut élargir la conservation déjà enregistrée ; elle ne lève pas une protection antérieure.</Text>
    {value ? <>
      <Text style={styles.caption}>Choisissez au moins une catégorie. « Autres données ou portée à préciser » conserve une portée large. Une catégorie ou une référence inconnue peut aussi nécessiter une conservation plus large après examen.</Text>
      <View accessibilityLabel="Catégories de données concernées" style={styles.section}>
        {SUPPORT_PRIVACY_CATEGORIES.map(category => {
          const checked = value.categories.includes(category);
          return <Pressable key={category} accessibilityRole="checkbox" accessibilityState={{checked, disabled}}
            disabled={disabled} style={[styles.choice, checked && styles.selected]} onPress={() => {
              if (disabled) return;
              onChange(toggleSupportPrivacyCategory(value, category));
              if (checked && objectCategory === category) {setObjectCategory(null); setObjectId('');}
            }}>
            <Text style={styles.body}>{SUPPORT_PRIVACY_CATEGORY_LABELS[category]}</Text>
          </Pressable>;
        })}
      </View>
      <Input label="Précisions sur les données concernées, facultatives" value={value.description ?? ''}
        onChangeText={description => onChange({...value, description})} multiline maxLength={2000} disabled={disabled} />
      <Text accessibilityRole="header" style={styles.title}>Références précises, facultatives</Text>
      <Text style={styles.caption}>Si vous connaissez l’identifiant d’une annonce, d’une commande ou d’une autre donnée concernée, ajoutez-le dans sa catégorie. Une référence reste votre déclaration ; elle ne prouve pas que la donnée vous appartient et ne rectifie aucune donnée automatiquement.</Text>
      {value.objects.map(object => <View key={JSON.stringify([object.category, object.id])} style={styles.section}>
        <Text selectable style={styles.body}>{SUPPORT_PRIVACY_CATEGORY_LABELS[object.category]} · {object.id}</Text>
        <Button variant="secondary" disabled={disabled} onPress={() => {if (!disabled) onChange({...value,
          objects: value.objects.filter(item => item.category !== object.category || item.id !== object.id)});}}>Retirer cette référence de la précision</Button>
      </View>)}
      <View accessibilityRole="radiogroup" accessibilityLabel="Catégorie de la référence à ajouter" style={styles.section}>
        {value.categories.map(category => <Pressable key={category} accessibilityRole="radio" accessibilityState={{checked: objectCategory === category, disabled}}
          disabled={disabled} style={[styles.choice, objectCategory === category && styles.selected]} onPress={() => {if (!disabled) setObjectCategory(category);}}>
          <Text style={styles.body}>{SUPPORT_PRIVACY_CATEGORY_LABELS[category]}</Text>
        </Pressable>)}
      </View>
      <Input label="Identifiant exact de la donnée, sans lien ni chemin" value={objectId} onChangeText={text => {if (!disabled) setObjectId(text);}}
        autoCapitalize="none" autoCorrect={false} maxLength={128} disabled={disabled || value.objects.length >= 20} />
      {objectId && objectError ? <Text accessibilityRole="alert" style={styles.body}>{objectError}</Text> : null}
      <Button variant="secondary" disabled={disabled || objectError !== null || value.objects.length >= 20} onPress={() => {
        if (disabled || !objectCategory || supportPrivacyObjectError(value, objectCategory, objectId)) return;
        onChange({...value, objects: [...value.objects, {category: objectCategory, id: objectId}]}); setObjectId('');
      }}>Ajouter cette référence à la demande</Button>
      <Text style={styles.caption}>Les catégories sans référence restent concernées dans leur ensemble. Retirer une précision de ce formulaire ne lève pas une conservation déjà enregistrée. Jusqu’à vingt références peuvent être ajoutées.</Text>
      {!value.categories.length ? <Text accessibilityRole="alert" style={styles.body}>Choisissez au moins une catégorie avant d’envoyer.</Text> : null}
      <Button variant="secondary" disabled={disabled} onPress={() => onChange(null)}>{existing ? 'Conserver la portée enregistrée' : 'Ne pas préciser la portée'}</Button>
    </> : <Button variant="secondary" disabled={disabled} onPress={() => onChange({protocol: 'privacy_scope_v1',
      categories: ['other_or_unknown'], objects: [], description: null})}>Préciser les catégories concernées</Button>}
    <Text style={styles.caption}>N’ajoutez ni numéro d’assurance sociale, ni mot de passe, ni numéro de carte ou copie de pièce d’identité. L’équipe vous indiquera un moyen approprié si une vérification est nécessaire.</Text>
    <Text style={styles.caption}>Le dépôt, une réponse ou le retrait de la demande n’autorise pas à lui seul la destruction des données concernées. Aucune date de suppression n’est promise ici.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  choice: {padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm},
  selected: {borderColor: colors.primary, backgroundColor: colors.surfaceSubtle}});
import { useState } from 'react';
