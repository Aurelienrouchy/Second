import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button, Checkbox, Input} from '@/components/ui';
import {PrivacyDataValues} from '@/components/PrivacyDataValues';
import {usePrivacyOperations} from '@/hooks/usePrivacyOperations';
import {PrivacyOperationsService as Service, privacyFailure} from '@/services/privacyOperationsService';
import type {PrivacyPatch} from '@/types/privacyOperations';
import {colors, spacing, typography} from '@/constants/theme';
export function PrivacyProfileCorrection({uid, caseId, operations}: {uid: string; caseId: string; operations: ReturnType<typeof usePrivacyOperations>}) {
  const edit = useRef(0), [form, setForm] = useState({key: operations.key, version: 0, nameSelected: false, bioSelected: false, displayName: '', bio: '', removeBio: false, reason: '', accepted: false}), [readEpoch, setReadEpoch] = useState(0), [requested, setRequested] = useState<{key: string; revision: number; patch: PrivacyPatch} | null>(null);
  const current = form.key === operations.key ? form : {key: operations.key, version: form.version, nameSelected: false, bioSelected: false, displayName: '', bio: '', removeBio: false, reason: '', accepted: false};
  const change = (next: Partial<typeof current>) => {try {operations.guard(); if (edit.current !== current.version) throw privacyFailure(); edit.current++; setForm({...current, ...next, accepted: false, version: edit.current}); setRequested(null);} catch {/* Current rendered SDK only. */}};
  const queryKey = ['privacy-operations', operations.key, 'profile-preview', readEpoch] as const;
  const query = useQuery({queryKey, enabled: operations.frame.focused && requested?.key === operations.key, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {if (!requested) throw privacyFailure(); const guard = operations.capture(); const value = await Service.profilePreview(uid, caseId, requested.patch, guard); guard(); return {sdk: operations.sdk, value};}});
  const source = query.isSuccess && !query.isFetching && !query.isError && query.data.sdk === operations.sdk && requested?.key === operations.key ? query.data.value : null;
  const preview = () => {try {operations.guard(); if (edit.current !== current.version) throw privacyFailure(); const next: PrivacyPatch = {...(current.nameSelected ? {displayName: current.displayName.trim()} : {}), ...(current.bioSelected ? {bio: current.removeBio ? null : current.bio.trim()} : {})}; setReadEpoch(n => n + 1); setRequested({key: operations.key, revision: edit.current, patch: next});} catch {/* Old form cannot read. */}};
  const correct = () => {
    if (!source || !current.accepted || !current.reason.trim()) return;
    try {if (edit.current !== current.version) throw privacyFailure(); const guard = operations.sourceGuard(queryKey, query.data), revision = current.version; const verify = () => {guard(); if (edit.current !== revision) throw privacyFailure();}; verify();
      void operations.execute({action: 'correct_profile', patch: source.patch, expectedSource: source.source, reason: current.reason.trim()}, verify);
    } catch {/* Current exact before/after only. */}
  };
  return <View style={styles.section}><Text style={styles.title}>Rectification ciblée du profil</Text><Text style={styles.caption}>Choisissez les champs à rectifier. Les identifiants de connexion, l’âge, le nom de membre, les contrats et le registre financier relèvent de parcours distincts.</Text>
    <Checkbox checked={current.nameSelected} disabled={operations.busy} onToggle={() => change({nameSelected: !current.nameSelected})}><Text style={styles.caption}>Rectifier le nom affiché</Text></Checkbox>
    {current.nameSelected ? <Input label="Nouveau nom affiché" value={current.displayName} maxLength={150} disabled={operations.busy} onChangeText={displayName => change({displayName})}/> : null}
    <Checkbox checked={current.bioSelected} disabled={operations.busy} onToggle={() => change({bioSelected: !current.bioSelected})}><Text style={styles.caption}>Rectifier la présentation</Text></Checkbox>
    {current.bioSelected ? <><Checkbox checked={current.removeBio} disabled={operations.busy} onToggle={() => change({removeBio: !current.removeBio})}><Text style={styles.caption}>Retirer la présentation (valeur nulle)</Text></Checkbox>{!current.removeBio ? <Input label="Nouvelle présentation" multiline value={current.bio} maxLength={2000} disabled={operations.busy} onChangeText={bio => change({bio})}/> : null}</> : null}
    <Input label="Motivation de la rectification" value={current.reason} multiline maxLength={4000} disabled={operations.busy} onChangeText={reason => change({reason})}/>
    <Button variant="secondary" disabled={operations.busy || !current.nameSelected && !current.bioSelected || current.nameSelected && !current.displayName.trim()} onPress={preview}>Comparer les valeurs actuelles et demandées</Button>
    {source ? <><Text style={styles.caption}>Valeurs actuelles · révision {source.source.revision}</Text>{Object.entries(source.source.before).map(([field, value]) => <View key={field}><Text style={styles.caption}>{value.present ? 'Champ présent' : 'Champ absent'}</Text><PrivacyDataValues values={{[field]: value.value}}/></View>)}<Text style={styles.caption}>Valeurs demandées</Text><PrivacyDataValues values={source.patch as Record<string, string | null>}/>
      <Checkbox checked={current.accepted} disabled={operations.busy} onToggle={() => {try {operations.sourceGuard(queryKey, query.data)(); if (edit.current !== current.version) throw privacyFailure(); edit.current++; setForm({...current, version: edit.current, accepted: !current.accepted});} catch {/* Fresh preview required. */}}}><Text style={styles.caption}>J’ai rapproché ces valeurs exactes de la demande et examiné leur rectification.</Text></Checkbox>
      <Button disabled={!operations.available || !current.accepted || !current.reason.trim()} onPress={correct}>Enregistrer cette seule rectification</Button></> : null}
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le profil courant doit être relu. Un profil absent ne sera pas recréé.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
