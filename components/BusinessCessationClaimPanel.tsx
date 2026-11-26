import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useBusinessCessationIdentity } from '@/hooks/useBusinessCessationIdentity';
import { BusinessCessationService as Service } from '@/services/businessCessationService';
import { BusinessCessationAction } from './BusinessCessationAction';
import { BusinessCessationPrivateExport } from './BusinessCessationPrivateExport';

export function BusinessCessationClaimPanel({uid, claimId}: {uid: string; claimId: string}) {
  const identity = useBusinessCessationIdentity(uid), owner = identity.owner, native = useShippingPurchaseContext(`cessation-claim-native:${claimId}`, uid), context = useLabelLifecycleContext(`cessation-claim:${claimId}`, uid), client = useQueryClient();
  const key = JSON.stringify([identity.key, claimId, native.focusRevision]);
  const query = useQuery({queryKey: ['business-cessation-claim', uid, claimId, key, context.focusRevision], enabled: context.focused && identity.ready, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = context.capture(), sdk = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== sdk) throw new Error('Connexion modifiée.');}; const claim = await Service.claim(uid, claimId, guard); guard(); return {claim, owner: sdk};}});
  const claim = context.focused && query.isSuccess && !query.isFetching && query.data.owner === auth.currentUser ? query.data.claim : null;
  const [selection, setSelection] = useState<{key: string; owner: typeof owner; planId: string} | null>(null);
  const selected = selection?.key === key && selection.owner === auth.currentUser ? selection : null;
  if (!native.focused) return null;
  return <View style={styles.section}>
    {context.focused ? <><Text accessibilityRole="header" style={styles.title}>Ma réclamation liée au plan</Text>
      {claim ? <><Text selectable style={styles.caption}>Réclamation {claim.claimId}. Obligation : {claim.reference.kind} — {claim.reference.id}.</Text>
        <Text style={styles.caption}>Votre demande est enregistrée pour suivi. L’obligation n’est pas résolue et aucun argent n’est déplacé. Contact déclaré : privacy@seconde.app ; disponibilité effective non vérifiée.</Text>
        <Text style={styles.caption}>Archive privée : {claim.archive.state === 'recorded' ? 'copie exacte enregistrée' : claim.archive.state === 'pending' ? 'export réservé, reprenez sa même référence dans votre suivi' : 'aucune copie enregistrée dans cette lecture'}.</Text>
        {claim.archive.state === 'not_recorded' ? <Button variant="secondary" onPress={() => {try {if (auth.currentUser !== owner) return; context.capture(); setSelection({key, owner, planId: claim.planId});} catch { /* Native own claim only. */ }}}>Préparer l’archive de ma réclamation</Button> : null}
        {claim.archive.state === 'recorded' ? <BusinessCessationPrivateExport uid={uid} target={{kind: 'claim', claimId, planId: claim.planId}} /> : null}
      </> : <Text style={styles.caption}>La réclamation privée reste à relire. Aucun règlement n’est déduit d’une absence ou d’une erreur.</Text>}
      <Button variant="secondary" onPress={() => {try {if (auth.currentUser !== owner) return; context.capture(); void query.refetch();} catch { /* Private read only. */ }}}>Relire ma réclamation de continuité</Button>
    </> : null}
    {selected ? <BusinessCessationAction uid={uid} access="owner" sourceKey={`${key}:export`} command={{action: 'export_claim', planId: selected.planId, claimId}} onRecorded={() => {if (auth.currentUser !== selected.owner) return; setSelection(null); void client.invalidateQueries({queryKey: ['business-cessation-claim', uid, claimId]}); void client.invalidateQueries({queryKey: ['business-cessation-discovery', uid]});}} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
