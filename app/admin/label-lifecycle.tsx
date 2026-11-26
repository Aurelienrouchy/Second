import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, ScreenHeader } from '@/components/ui';
import { LabelLifecyclePanel } from '@/components/LabelLifecyclePanel';
import { LabelLifecycleOwnHistory } from '@/components/LabelLifecycleOwnHistory';
import { AdminLabelLifecycleQueue, AdminSectionNav } from '@/features/admin';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { isLabelLifecycleContext } from '@/services/labelLifecycleService';
import type { LabelLifecycleContext, LabelLifecycleLeg } from '@/types/labelLifecycle';
import { colors, spacing, typography } from '@/constants/theme';
export default function AdminLabelLifecycleScreen() {
  const uid = useAuthenticatedUid(), router = useRouter(), params = useLocalSearchParams<{transactionId?: string; leg?: string}>();
  const frame = useLabelLifecycleContext('label-lifecycle-admin-selection', uid), key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision]);
  const [search, setSearch] = useState<{key: string; id: string; leg: LabelLifecycleLeg | null} | null>(null), [selection, setSelection] = useState<{key: string; context: LabelLifecycleContext} | null>(null);
  const form = search?.key === key ? search : {key, id: '', leg: null}, candidate = {transactionId: params.transactionId, leg: params.leg};
  const selected = selection?.key === key ? selection.context : isLabelLifecycleContext(candidate) ? candidate : null;
  const select = (context: LabelLifecycleContext) => {try {frame.capture(); setSelection({key, context}); router.setParams({transactionId: context.transactionId, leg: context.leg});} catch { /* No stale private selection. */ }};
  return <View style={styles.container}><ScreenHeader title="Suivi des étiquettes" onBack={() => router.back()} /><AdminSectionNav /><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.body}>Examinez l’étiquette exacte et son trajet. Les droits opérateur, les sources et les gardes sont requalifiés sur le serveur ; cette page n’autorise aucun transport ni mouvement de fonds par elle-même.</Text>
    {uid && frame.focused ? <AdminLabelLifecycleQueue uid={uid} onSelect={select} /> : null}
    {uid && frame.focused ? <AdminLabelLifecycleQueue uid={uid} onSelect={select} stream="orphan_alerts" /> : null}
    <TextInput accessibilityLabel="Référence exacte de la commande" value={form.id} maxLength={128} autoCapitalize="none" autoCorrect={false} style={styles.input} onChangeText={id => setSearch({...form, id})} />
    <Button variant={form.leg === 'forward' ? 'primary' : 'secondary'} onPress={() => setSearch({...form, leg: 'forward'})}>Trajet aller</Button><Button variant={form.leg === 'return' ? 'primary' : 'secondary'} onPress={() => setSearch({...form, leg: 'return'})}>Trajet retour</Button>
    <Button variant="secondary" disabled={!uid || !frame.focused || !isLabelLifecycleContext({transactionId: form.id.trim(), leg: form.leg})} onPress={() => {const context = {transactionId: form.id.trim(), leg: form.leg}; if (isLabelLifecycleContext(context)) select(context);}}>Lire cette commande et ce trajet</Button>
    {uid && selected && frame.focused ? <LabelLifecyclePanel key={JSON.stringify(selected)} uid={uid} context={selected} scope="admin" parcelAmendment /> : null}
    {uid && frame.focused ? <LabelLifecycleOwnHistory uid={uid} /> : null}
  </ScrollView></View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
