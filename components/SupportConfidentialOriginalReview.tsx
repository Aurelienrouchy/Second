import {useRef, useState, type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Button, Checkbox, Input} from '@/components/ui';
import {SupportLegalReviewJournal} from '@/components/SupportLegalReviewJournal';
import {auth} from '@/config/firebaseConfig';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {useSupportLegalReview} from '@/hooks/useSupportLegalReview';
import {getAuthSessionGeneration} from '@/store/authStore';
import {supportJournalReference} from '@/services/supportRequestService';
import {SupportLegalReviewService as Service, legalReviewGuard} from '@/services/supportLegalReviewService';
import {SUPPORT_CONFIDENTIAL_FIELD_LABELS} from '@/utils/supportConfidentialityContract';
import type {SupportJournalEntry} from '@/types/supportRequest';
import type {LegalOriginalCommand, LegalOriginalResult} from '@/types/supportLegalReview';
import {colors, spacing, typography} from '@/constants/theme';
export interface LegalReauthenticationProps {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void}
const purposes = {support_handling: 'Traitement de ce dossier de support', privacy_rights: 'Exercice d’un droit de confidentialité', security_review: 'Examen de sécurité de ce dossier'} as const;
/** A source-provided single field; no free-form document path or original is
 * accepted. Private text never enters query data, storage or a repeated receipt. */
export function SupportConfidentialOriginalReview({uid, supportRequestId, sourceKey, pending, assertSelection, renderReauthentication}: {
  uid: string; supportRequestId: string | null; sourceKey: string; pending?: SupportJournalEntry | null; assertSelection?: () => void;
  renderReauthentication: (props: LegalReauthenticationProps) => ReactNode;
}) {
  const [commandSource, setCommandSource] = useState(false), [readRevision, setReadRevision] = useState(0);
  const stable = JSON.stringify([uid, getAuthSessionGeneration(), supportRequestId, commandSource, pending?.requestId]);
  const frame = useLabelLifecycleContext(`legal-original:${stable}:${sourceKey}`, uid), client = useQueryClient(), edit = useRef(0);
  const frameKey = JSON.stringify([stable, sourceKey, frame.focusRevision]);
  const [authenticated, setAuthenticated] = useState<{key: string; owner: NonNullable<typeof auth.currentUser>} | null>(null);
  const allowed = frame.focused && authenticated?.key === stable && authenticated.owner === auth.currentUser;
  const queryKey = ['legal-original-source', frameKey, readRevision] as const;
  const query = useQuery({queryKey, enabled: allowed && readRevision > 0 && !!(commandSource ? pending : supportRequestId), staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {
      const operation = frame.capture(), current = legalReviewGuard(uid, () => {frame.assertCurrent(operation); assertSelection?.();}), owner = auth.currentUser!;
      const reference = commandSource && pending ? await supportJournalReference(pending, current) : null; current();
      const caseId = reference?.supportRequestId ?? supportRequestId; if (!caseId) throw new Error('Choisissez un dossier natif.');
      const value = await Service.originalSource(uid, {caseId, reference}, current); current(); return {owner, value};
    }});
  const source = allowed && query.isSuccess && !query.isFetching && !query.isError && query.data.owner === auth.currentUser ? query.data.value : null;
  const sourceIdentity = JSON.stringify([frameKey, source?.context]), legal = useSupportLegalReview(uid, 'confidential_original', frameKey);
  const [form, setForm] = useState({key: sourceIdentity, field: '', purpose: 'support_handling' as LegalOriginalCommand['purpose'], reason: '', necessity: false, minimization: false});
  const [original, setOriginal] = useState<{key: string; owner: NonNullable<typeof auth.currentUser>; value: LegalOriginalResult} | null>(null);
  if (form.key !== sourceIdentity) {setForm({key: sourceIdentity, field: '', purpose: 'support_handling', reason: '', necessity: false, minimization: false}); setOriginal(null);}
  const target = source?.fields.find(row => row.target.field === form.field && row.target.qualification === 'native_field')?.target;
  const change = (patch: Partial<Omit<typeof form, 'key'>>) => {try {frame.capture(); edit.current++; setOriginal(null); setForm(old => ({...old, ...patch}));} catch {/* Current frame only. */}};
  const read = () => {
    if (!source || !target || !form.necessity || !form.minimization || !form.reason.trim() || !legal.available) return;
    let operation; try {operation = frame.capture();} catch {return;}
    try {
    const owner = query.data!.owner, snapshot = query.data, revision = edit.current;
    const guard = legalReviewGuard(uid, () => {frame.assertCurrent(operation); assertSelection?.(); const state = client.getQueryState(queryKey); if (auth.currentUser !== owner || edit.current !== revision || client.getQueryData(queryKey) !== snapshot || state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated) throw new Error('Relisez ce champ et les sources actuelles.');});
    void legal.execute({action: 'read_original_field', target, context: source.context, purpose: form.purpose, reason: form.reason.trim(), necessityAccepted: true, minimizationAccepted: true}, guard, (result, sdk) => {guard(); if (result.protocol === 'support_confidential_original_v2') setOriginal({key: sourceIdentity, owner: sdk, value: result});});
    } catch {setOriginal(old => old?.owner === auth.currentUser ? old : null);}
  };
  const visible = source && original?.key === sourceIdentity && original.owner === auth.currentUser ? original.value : null;
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Lecture limitée d’un original confidentiel</Text>
    <Text style={styles.caption}>Chaque accès porte sur un seul champ natif et laisse un audit avant son affichage. Votre connexion administrateur actuelle ne désigne aucun responsable légal ou mandataire ; la nécessité de cet accès doit être motivée.</Text>
    {renderReauthentication({uid, sourceKey: `legal-original-native:${stable}`, disabled: legal.busy, onVerified: () => {const owner = auth.currentUser; if (owner?.uid === uid) {setAuthenticated({key: stable, owner}); setReadRevision(0); setOriginal(null);}}})}
    <Button variant="secondary" disabled={!allowed || legal.busy || !supportRequestId} onPress={() => {edit.current++; setCommandSource(false); setReadRevision(0); setOriginal(null);}}>Champs du dossier sélectionné</Button>
    {pending ? <Button variant="secondary" disabled={!allowed || legal.busy} onPress={() => {edit.current++; setCommandSource(true); setReadRevision(0); setOriginal(null);}}>Champs de mon intention native conservée</Button> : null}
    <Button variant="secondary" disabled={!allowed || legal.busy || !(commandSource ? pending : supportRequestId)} onPress={() => {try {frame.capture(); assertSelection?.(); edit.current++; setOriginal(null); setReadRevision(n => n + 1);} catch {/* Current native selection only. */}}}>Lire les références natives et le contexte actuel</Button>
    {source ? <><Text style={styles.caption}>Dossier {source.caseId} · version {source.context.version}. La liste ne contient aucun original.</Text>
      {source.fields.map(row => <Button key={row.target.field} variant={form.field === row.target.field ? 'primary' : 'secondary'} disabled={legal.busy || row.target.qualification !== 'native_field'} onPress={() => change({field: row.target.field, necessity: false, minimization: false})}>{SUPPORT_CONFIDENTIAL_FIELD_LABELS[row.target.field] ?? row.target.field}{row.confined ? ' · champ confiné' : ''}</Button>)}
      {(Object.keys(purposes) as LegalOriginalCommand['purpose'][]).map(purpose => <Button key={purpose} variant={purpose === form.purpose ? 'primary' : 'secondary'} disabled={legal.busy} onPress={() => change({purpose, necessity: false, minimization: false})}>{purposes[purpose]}</Button>)}
      <Input label="Nécessité précise de lire ce seul champ" value={form.reason} maxLength={2000} multiline disabled={legal.busy} onChangeText={reason => change({reason, necessity: false, minimization: false})}/>
      <Checkbox checked={form.necessity} disabled={legal.busy || !target} onToggle={() => change({necessity: !form.necessity})}><Text style={styles.caption}>Cet original est nécessaire à la finalité choisie dans ce dossier actuel.</Text></Checkbox>
      <Checkbox checked={form.minimization} disabled={legal.busy || !target} onToggle={() => change({minimization: !form.minimization})}><Text style={styles.caption}>Je limite ma lecture à ce champ exact et n’en crée aucune copie externe avec cette action.</Text></Checkbox>
      <Button disabled={!legal.available || !target || !form.reason.trim() || !form.necessity || !form.minimization} onPress={read}>Auditer puis lire ce seul original</Button>
      {visible ? <View style={styles.section}><Text style={styles.caption}>Accès audité · {visible.auditReference.id}. Affichage privé temporaire.</Text><Text selectable style={styles.body}>{visible.original}</Text><Button variant="secondary" onPress={() => setOriginal(null)}>Masquer l’original maintenant</Button></View> : null}
    </> : null}
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Les références privées doivent être relues avec une connexion récemment confirmée.</Text> : null}
    {legal.notice && frame.focused ? <Text accessibilityRole="alert" style={styles.caption}>{legal.notice}</Text> : null}
    <SupportLegalReviewJournal uid={uid} area="confidential_original"/>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
