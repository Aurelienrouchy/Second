import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { childSafetyCategory } from '@/functions/src/shared/articleChildSafety';
import type { ArticleChildSafetyDraft } from '@/types/articleChildSafety';
import { colors, spacing, typography } from '@/constants/theme';

/** Choices describe the seller's observations; no initial choice or AI inference. */
export function ArticleChildSafetyFields({categoryIds, value, onChange, disabled = false, readOnly = false, required = false}: {
  categoryIds: string[]; value?: ArticleChildSafetyDraft | null; onChange?: (value: ArticleChildSafetyDraft) => void;
  disabled?: boolean; readOnly?: boolean; required?: boolean;
}) {
  const category = childSafetyCategory(categoryIds);
  if (!required && category !== 'child_clothing' && category !== 'canonical_sleepwear') return null;
  const d = value ?? {};
  const update = (change: ArticleChildSafetyDraft) => {if (!disabled && !readOnly) onChange?.({...d, protocol: 'article_child_safety_statement_v1', ...change});};
  const uses = [{value: 'daywear_only', label: 'Vêtement de jour uniquement'}, {value: 'sleep_or_related', label: 'Sommeil ou usage associé'}, {value: 'unknown', label: 'Je ne sais pas'}] as const;
  const labels = [{value: 'readable', label: 'Étiquette lisible'}, {value: 'missing', label: 'Étiquette absente'}, {value: 'unknown', label: 'Je ne sais pas'}] as const;
  const stylesDeclared = [{value: 'tight_fitting_claimed', label: 'Coupe près du corps, selon mon observation'}, {value: 'loose_fitting_claimed', label: 'Coupe ample, selon mon observation'}, {value: 'unknown', label: 'Je ne sais pas'}] as const;
  const concerns = [{value: 'none_observed', label: 'Aucun problème de sécurité observé'}, {value: 'observed', label: 'Un problème à décrire'}, {value: 'unknown', label: 'Je ne sais pas'}] as const;
  return <View style={styles.container}>
    <Text style={styles.title}>Usage et observations de sécurité</Text>
    <Text style={styles.body}>Décrivez l’usage prévu et vos observations.</Text>
    {category === 'canonical_sleepwear' ? <Text style={styles.body}>Cette catégorie nécessite un examen avant publication, même si vous indiquez un usage de jour.</Text> : null}
    <Text style={styles.label}>Usage prévu</Text>
    {readOnly ? <Text style={styles.body}>{uses.find(c => c.value === d.intendedUse)?.label ?? 'Usage non déclaré'}</Text> : uses.map(c => <Button key={c.value} variant={d.intendedUse === c.value ? 'primary' : 'secondary'} disabled={disabled} onPress={() => update({intendedUse: c.value, ...(c.value === 'daywear_only' && category !== 'canonical_sleepwear' ? {sleepwearStyle: null} : {})})}>{c.label}</Button>)}
    <Text style={styles.label}>Étiquette</Text>
    {readOnly ? <Text style={styles.body}>{labels.find(c => c.value === d.labelStatus)?.label ?? 'Étiquette non déclarée'}</Text> : labels.map(c => <Button key={c.value} variant={d.labelStatus === c.value ? 'primary' : 'secondary'} disabled={disabled} onPress={() => update({labelStatus: c.value, ...(c.value !== 'readable' ? {labelText: null} : {})})}>{c.label}</Button>)}
    {d.labelStatus === 'readable' ? readOnly ? <Text style={styles.body}>{d.labelText ?? 'Mentions non déclarées'}</Text> : <TextInput accessibilityLabel="Recopiez les mentions de l’étiquette" placeholder="Recopiez les mentions de l’étiquette" value={d.labelText ?? ''} maxLength={2000} multiline editable={!disabled} style={styles.input} onChangeText={labelText => update({labelText})} /> : null}
    {d.intendedUse === 'sleep_or_related' || category === 'canonical_sleepwear' || d.sleepwearStyle != null ? <>
      <Text style={styles.label}>Coupe observée</Text>
      {readOnly ? <Text style={styles.body}>{stylesDeclared.find(c => c.value === d.sleepwearStyle)?.label ?? 'Coupe non déclarée'}</Text> : stylesDeclared.map(c => <Button key={c.value} variant={d.sleepwearStyle === c.value ? 'primary' : 'secondary'} disabled={disabled} onPress={() => update({sleepwearStyle: c.value})}>{c.label}</Button>)}
    </> : null}
    <Text style={styles.label}>Observations de sécurité</Text>
    {readOnly ? <Text style={styles.body}>{concerns.find(c => c.value === d.safetyConcern)?.label ?? 'Observation non déclarée'}</Text> : concerns.map(c => <Button key={c.value} variant={d.safetyConcern === c.value ? 'primary' : 'secondary'} disabled={disabled} onPress={() => update({safetyConcern: c.value, ...(c.value === 'none_observed' ? {observation: null} : {})})}>{c.label}</Button>)}
    {d.safetyConcern === 'observed' || d.safetyConcern === 'unknown' ? readOnly ? <Text style={styles.body}>{d.observation ?? 'Aucune précision déclarée'}</Text> : <TextInput accessibilityLabel="Précisez votre observation de sécurité" placeholder={d.safetyConcern === 'observed' ? 'Décrivez le problème observé' : 'Précision facultative'} value={d.observation ?? ''} maxLength={2000} multiline editable={!disabled} style={styles.input} onChangeText={observation => update({observation: observation || null})} /> : null}
  </View>;
}
const styles = StyleSheet.create({container: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, label: {...typography.bodySmall, color: colors.foreground, fontWeight: '600'},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md, minHeight: spacing.xl * 2}});
