import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button, Checkbox, Input} from '@/components/ui';
import {PrivacyCaptureEntry} from '@/components/PrivacyCaptureEntry';
import {usePrivacyOperations} from '@/hooks/usePrivacyOperations';
import {PrivacyOperationsService as Service, privacyFailure} from '@/services/privacyOperationsService';
import type {PrivacyCapture, PrivacyEntry} from '@/types/privacyOperations';
import {colors, spacing, typography} from '@/constants/theme';
export function PrivacyCaptureReview({uid, caseId, capture, operations, assertSource}: {uid: string; caseId: string; capture: PrivacyCapture; operations: ReturnType<typeof usePrivacyOperations>; assertSource: () => void}) {
  const [cursor, setCursor] = useState<string | null>(null), edit = useRef(0);
  const key = JSON.stringify([operations.key, capture.reference, capture.version, cursor]);
  const [form, setForm] = useState({key, version: 0, selected: {} as Record<string, string[]>, reason: '', necessary: false, minimized: false});
  const current = form.key === key ? form : {key, version: form.version, selected: {}, reason: '', necessary: false, minimized: false};
  const queryKey = ['privacy-operations', operations.key, 'capture-entries', key] as const;
  const query = useQuery({queryKey, enabled: operations.frame.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const guard = operations.capture(); assertSource(); const value = await Service.captureEntries(uid, caseId, capture.reference, cursor, () => {guard(); assertSource();}); return {sdk: operations.sdk, value};}});
  const source = query.isSuccess && !query.isFetching && !query.isError && query.data.sdk === operations.sdk && operations.frame.focused ? query.data.value : null;
  const handleChange = (patch: Partial<typeof current>) => {try {operations.guard(); assertSource(); if (edit.current !== current.version) throw privacyFailure(); edit.current++; setForm({...current, ...patch, version: edit.current});} catch {/* Current page only. */}};
  const handleToggleField = (entry: PrivacyEntry, field: string) => {
    const fields = current.selected[entry.id] ?? [], next = fields.includes(field) ? fields.filter(f => f !== field) : [...fields, field];
    handleChange({selected: {...current.selected, [entry.id]: next}, necessary: false, minimized: false});
  };
  const release = () => {
    if (!source || !current.necessary || !current.minimized || !current.reason.trim() || source.capture.status !== 'complete') return;
    try {
      if (edit.current !== current.version) throw privacyFailure();
      const pageGuard = operations.sourceGuard(queryKey, query.data), revision = current.version;
      const verify = () => {pageGuard(); assertSource(); if (edit.current !== revision) throw privacyFailure();}; verify();
      const selections = source.entries.flatMap(e => {const fields = current.selected[e.id] ?? []; return fields.length ? [{entry: {id: e.id, contentHash: e.contentHash}, fields}] : [];});
      void operations.execute({action: 'release_copy', captureReference: capture.reference, selections, reason: current.reason.trim(), minimizationAccepted: true, necessityAccepted: true}, verify);
    } catch {/* No release from old source/SDK. */}
  };
  return <View style={styles.section}><Text style={styles.title}>Examen des champs capturés</Text><Text style={styles.caption}>Instant Firestore fixe : {new Date(capture.nativeReadTime.seconds * 1000).toISOString()} · {capture.nativeReadTime.nanoseconds} ns. {capture.pages} page(s), {capture.inspected} document(s) examinés, {capture.unknownEntries} projection(s) inconnue(s).</Text>
    <Text style={styles.caption}>{capture.status === 'complete' ? 'Les sources natives enregistrées dans cet inventaire ont été parcourues. Les traitements externes et lieux non inventoriés demandent un examen séparé.' : capture.status === 'unavailable' ? 'Le point historique est indisponible. Aucun remplacement par des données courantes n’est utilisé.' : `Capture en cours : ${capture.cursor.phase}. Poursuivre ajoute une seule page au même instant.`}</Text>
    {capture.inventory.unknowns.map(u => <Text key={u} style={styles.caption}>{u}</Text>)}
    {capture.status === 'capturing' ? <Button disabled={!operations.available} onPress={() => {try {assertSource(); void operations.execute({action: 'capture_advance', captureReference: capture.reference, expectedCaptureVersion: capture.version}, assertSource);} catch {/* Stale source. */}}}>Capturer la prochaine page au même instant</Button> : null}
    {source?.entries.map(e => <PrivacyCaptureEntry key={e.id} entry={e} selected={current.selected[e.id] ?? []} disabled={operations.busy || capture.status !== 'complete'} onToggle={handleToggleField}/>)}
    {source?.nextCursor ? <Button variant="secondary" disabled={operations.busy} onPress={() => {try {operations.guard(); assertSource(); if (edit.current !== current.version) throw privacyFailure(); edit.current++; setForm({...current, key: '', version: edit.current}); setCursor(source.nextCursor);} catch {/* Current page only. */}}}>Page suivante des champs capturés</Button> : null}
    {cursor ? <Button variant="secondary" disabled={operations.busy} onPress={() => {try {operations.guard(); assertSource(); if (edit.current !== current.version) throw privacyFailure(); edit.current++; setForm({...current, key: '', version: edit.current}); setCursor(null);} catch {/* Current source only. */}}}>Première page des champs</Button> : null}
    <Input label="Motif de communication de ces seuls champs" value={current.reason} multiline maxLength={4000} disabled={operations.busy} onChangeText={reason => handleChange({reason, necessary: false, minimized: false})}/>
    <Checkbox checked={current.necessary} disabled={!source || operations.busy} onToggle={() => handleChange({necessary: !current.necessary})}><Text style={styles.caption}>J’ai lu les champs cochés et vérifié leur nécessité pour la demande.</Text></Checkbox>
    <Checkbox checked={current.minimized} disabled={!source || operations.busy} onToggle={() => handleChange({minimized: !current.minimized})}><Text style={styles.caption}>J’ai examiné les droits des tiers et limité cette copie aux champs communicables.</Text></Checkbox>
    <Button disabled={!operations.available || !source || capture.status !== 'complete' || !Object.values(current.selected).some(a => a.length) || !current.reason.trim() || !current.necessary || !current.minimized} onPress={release}>Mettre cette copie sélectionnée à disposition du propriétaire</Button>
    <Text style={styles.caption}>La sélection concerne cette page seulement. Chaque copie peut contenir jusqu’à 20 sources ; sa publication ne clôture pas la demande.</Text>
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Relisez la capture native et son périmètre courant.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
