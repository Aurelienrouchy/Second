import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { ExceptionalRestitutionSummary } from '@/components/ExceptionalRestitutionSummary';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ExceptionalRestitutionService } from '@/services/exceptionalRestitutionService';
import type { ExceptionalRestitutionContext } from '@/types/exceptionalRestitution';
/** Existing native obligations stay readable without a commercial profile. */
export function ExceptionalRestitutionOwnerPanel({uid, context: caseContext}: {uid: string; context: ExceptionalRestitutionContext}) {
  const contextId = JSON.stringify(caseContext), context = useLabelLifecycleContext(`exceptional-owner:${contextId}`, uid);
  const key = JSON.stringify([uid, contextId, getAuthSessionGeneration(), context.focusRevision]);
  const query = useQuery({queryKey: ['exceptional-restitution-party', key], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(); return ExceptionalRestitutionService.source(uid, caseContext, 'own', () => context.assertCurrent(op));}});
  const source = context.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  if (!source?.instructionId && !query.isError) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Suivi de la restitution exceptionnelle</Text>
    <Text style={styles.caption}>Ce suivi porte sur cette seule obligation. Les documents bancaires privés sont réservés aux opérateurs habilités de Seconde.</Text>
    <Button variant="secondary" disabled={!context.focused || query.isFetching} onPress={() => {try {context.capture(); void query.refetch();} catch { /* Current SDK owner only. */ }}}>Relire le suivi de cette restitution</Button>
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>La source ne peut pas être qualifiée dans cette lecture. Aucun règlement ou absence d’obligation n’est déduit.</Text> : null}
    {source?.instructionId ? <ExceptionalRestitutionSummary source={source} audience="owner" /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
