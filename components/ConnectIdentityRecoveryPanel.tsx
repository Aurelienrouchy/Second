import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {ConnectIdentityRecoveryService, connectRecoveryReference} from '@/services/connectIdentityRecoveryService';
import {colors, spacing, typography} from '@/constants/theme';

export function ConnectIdentityRecoveryPanel({uid, scope = 'own', ownerId = uid, recoveryReference = null, sourceKey = '', assertSelection}: {
  uid: string; scope?: 'own' | 'admin'; ownerId?: string; recoveryReference?: string | null; sourceKey?: string; assertSelection?: () => void;
}) {
  const [action, setAction] = useState<'create' | 'delete'>('create'), [selection, setSelection] = useState<string | null>(null), serial = useRef(0);
  const [renderSerial, setRenderSerial] = useState(0);
  const frame = useLabelLifecycleContext(JSON.stringify(['connect-identity-recovery', scope, ownerId, action, recoveryReference, sourceKey]), uid);
  const referenceQualified = recoveryReference === null || connectRecoveryReference(recoveryReference) !== null;
  const key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision, scope, ownerId, action, recoveryReference, sourceKey, renderSerial]);
  const query = useQuery({queryKey: ['connect-identity-recovery', key], enabled: frame.focused && referenceQualified && selection === key, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = frame.capture(), n = serial.current; return ConnectIdentityRecoveryService.read(uid, {scope, ownerId, action, recoveryReference: action === 'create' ? connectRecoveryReference(recoveryReference) : null}, () => {
      frame.assertCurrent(op); assertSelection?.(); if (serial.current !== n) throw new Error('La sélection Connect a changé.');
    });}});
  const data = frame.focused && selection === key && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  const read = () => {try {frame.capture(); assertSelection?.(); serial.current++; setRenderSerial(serial.current); setSelection(JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision, scope, ownerId, action, recoveryReference, sourceKey, serial.current]));} catch {/* No old support owner or SDK frame. */}};
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>Référence de reprise du compte de paiement</Text>
    {frame.focused && connectRecoveryReference(recoveryReference) ? <Text selectable style={styles.caption}>Issue précédente inconnue · référence {recoveryReference}</Text> : null}
    {!referenceQualified ? <Text style={styles.caption}>La référence fournie est non qualifiée. Relisez son statut exact ; aucune lecture de remplacement n’est lancée.</Text> : null}
    <Text style={styles.caption}>Cette lecture vérifie l’instruction indépendante conservée pour ce compte. Elle ne recrée pas de compte et n’autorise aucun paiement, retrait ou suppression.</Text>
    <Button variant="secondary" disabled={!frame.focused || query.isFetching} onPress={() => {try {frame.capture(); assertSelection?.(); serial.current++; setRenderSerial(serial.current); setSelection(null); setAction(action === 'create' ? 'delete' : 'create');} catch {/* No stale selection. */}}}>{action === 'create' ? 'Instruction de création' : 'Instruction de suppression'}</Button>
    <Button variant="secondary" disabled={!frame.focused || query.isFetching || !referenceQualified} onPress={read}>Lire cette référence conservée</Button>
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>La source indépendante ou l’accès actuel ne peut pas être confirmé. L’issue demeure inconnue ; aucune nouvelle configuration n’est autorisée ici.</Text> : null}
    {data ? <>
      <Text style={styles.body}>{data.state === 'claim_recorded_outcome_unqualified' ? 'Instruction conservée ; résultat prestataire non qualifié' : 'Aucune instruction observée dans cette lecture'}</Text>
      <Text style={styles.caption}>L’absence d’instruction observée ne prouve pas l’absence d’une opération chez le prestataire. Une qualification indépendante reste nécessaire.</Text>
      {data.recoveryReference ? <Text selectable style={styles.caption}>Référence opaque : {data.recoveryReference}</Text> : null}
      {data.claim ? <Text selectable style={styles.caption}>Instruction {data.claim.commandId} · époque {data.claim.epoch} · compte {data.claim.accountId ?? 'non qualifié'}.</Text> : null}
      <Text style={styles.caption}>Observation {data.readAt}. Aucun règlement financier attesté.</Text>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
