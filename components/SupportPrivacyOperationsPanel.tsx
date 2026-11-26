import {useState, type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {PrivacyCaptureReview} from '@/components/PrivacyCaptureReview';
import {PrivacyDispositionReview} from '@/components/PrivacyDispositionReview';
import {PrivacyProfileCorrection} from '@/components/PrivacyProfileCorrection';
import type {LegalReauthenticationProps} from '@/components/SupportConfidentialOriginalReview';
import {auth} from '@/config/firebaseConfig';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {usePrivacyOperations} from '@/hooks/usePrivacyOperations';
import {getAuthSessionGeneration} from '@/store/authStore';
import {PrivacyOperationsService as Service, isPrivacyCapture, isPrivacyDisposition, isPrivacyDispositionScope, privacyFailure} from '@/services/privacyOperationsService';
import type {PrivacyCollection, PrivacyReference} from '@/types/privacyOperations';
import {colors, spacing, typography} from '@/constants/theme';
const collections = {captures: 'Captures des sources connues', dispositions: 'Autorisations et étapes ciblées', copies: 'Copies publiées', corrections: 'Rectifications enregistrées', inspections: 'Périmètres de conservation paginés'} as const;
/** Always-mounted native challenge; private projections are separately fenced by AppState. */
export function SupportPrivacyOperationsPanel({uid, caseId, kind, sourceKey, assertSelection, renderReauthentication}: {
  uid: string; caseId: string | null; kind: 'personal_data_access' | 'personal_data_correction' | null; sourceKey: string; assertSelection?: () => void; renderReauthentication: (props: LegalReauthenticationProps) => ReactNode;
}) {
  const stable = JSON.stringify([uid, getAuthSessionGeneration(), caseId, kind, sourceKey]), native = useShippingPurchaseContext(`privacy-native:${stable}`, uid);
  const operations = usePrivacyOperations(uid, caseId, stable, assertSelection);
  const nativeKey = JSON.stringify([stable, native.focusRevision]);
  const [authenticated, setAuthenticated] = useState<{key: string; sdk: typeof auth.currentUser} | null>(null), [revision, setRevision] = useState(0);
  const [choice, setChoice] = useState<{key: string; collection: PrivacyCollection; cursor: string | null; selection: PrivacyReference | null}>({key: operations.key, collection: 'captures', cursor: null, selection: null});
  const current = choice.key === operations.key ? choice : {key: operations.key, collection: 'captures' as const, cursor: null, selection: null};
  const enabled = !!caseId && !!kind && operations.frame.focused && authenticated?.key === nativeKey && authenticated.sdk === operations.sdk && operations.sdk === auth.currentUser && revision > 0;
  const queryKey = ['privacy-operations', operations.key, 'state', current.collection, current.cursor, revision] as const;
  const query = useQuery({queryKey, enabled, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {if (!caseId) throw privacyFailure(); const guard = operations.capture(); const value = await Service.state(uid, caseId, current.collection, current.cursor, guard); guard(); return {sdk: operations.sdk, value};}});
  const state = enabled && query.isSuccess && !query.isFetching && !query.isError && query.data.sdk === auth.currentUser ? query.data.value : null;
  const assertSource = () => {if (!state) throw privacyFailure(); operations.sourceGuard(queryKey, query.data)();};
  const selected = state?.entries.find(e => e.reference.id === current.selection?.id && e.reference.contentHash === current.selection.contentHash);
  const choose = (collection: PrivacyCollection, cursor: string | null = null, selection: PrivacyReference | null = null) => {try {operations.guard(); setChoice({key: operations.key, collection, cursor, selection});} catch {/* Current private frame only. */}};
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Traitement encadré des renseignements personnels</Text><Text style={styles.caption}>Direction · privacy@seconde.app. La capture des sources connues, la communication minimisée, la rectification et les opérations ciblées restent distinctes. Aucun nom de responsable, mandat ni délai légal n’est inventé.</Text>
    {renderReauthentication({uid, sourceKey: `privacy-operations-native:${nativeKey}`, disabled: operations.busy || !caseId || !kind, onVerified: () => {try {native.capture(); if (!operations.sdk || auth.currentUser !== operations.sdk) throw privacyFailure(); setAuthenticated({key: nativeKey, sdk: operations.sdk}); setRevision(0);} catch {/* No authority from an old SDK callback. */}}})}
    <Button variant="secondary" disabled={!caseId || !kind || operations.busy || authenticated?.key !== nativeKey || authenticated.sdk !== operations.sdk || !operations.frame.focused} onPress={() => {try {operations.guard(); setRevision(n => n + 1); setChoice({key: operations.key, collection: current.collection, cursor: null, selection: null});} catch {/* Fresh selection required after OAuth. */}}}>Lire les sources privées actuelles de ce dossier</Button>
    {state && caseId ? <><Text style={styles.caption}>Dossier natif {state.caseId} · propriétaire {state.ownerId}. Page de {state.page.inspected} éléments ; aucune conclusion globale sur les données.</Text>
      {(Object.keys(collections) as PrivacyCollection[]).map(collection => <Button key={collection} variant={current.collection === collection ? 'primary' : 'secondary'} disabled={operations.busy} onPress={() => choose(collection)}>{collections[collection]}</Button>)}
      {current.collection === 'captures' ? <Button disabled={!operations.available} onPress={() => {try {assertSource(); void operations.execute({action: 'capture_prepare'}, assertSource);} catch {/* No new capture from old source. */}}}>Préparer une nouvelle capture à un instant natif fixe</Button> : null}
      {state.entries.map(e => <View key={e.reference.id} style={styles.section}><Text style={styles.caption}>{isPrivacyCapture(e, caseId) ? `Capture ${e.status} · version ${e.version} · ${e.inspected} document(s)` : isPrivacyDispositionScope(e, caseId) ? `Périmètre ${e.status} · version ${e.version} · ${e.progress.pages} page(s)` : isPrivacyDisposition(e, caseId) ? `${e.target.service} · ${e.state} · version ${e.version}` : `Enregistré le ${'recordedAt' in e ? e.recordedAt : ''}`}</Text>{(current.collection === 'captures' || current.collection === 'dispositions' || current.collection === 'inspections') ? <Button variant="secondary" disabled={operations.busy} onPress={() => {try {assertSource(); choose(current.collection, current.cursor, e.reference);} catch {/* Old native row. */}}}>Examiner cet élément natif</Button> : null}</View>)}
      {state.page.nextCursor ? <Button variant="secondary" disabled={operations.busy} onPress={() => {try {assertSource(); choose(current.collection, state.page.nextCursor);} catch {/* Current native cursor only. */}}}>Page suivante du registre</Button> : null}{current.cursor ? <Button variant="secondary" disabled={operations.busy} onPress={() => choose(current.collection)}>Première page du registre</Button> : null}
      {selected && isPrivacyCapture(selected, caseId) ? <PrivacyCaptureReview key={JSON.stringify([operations.key, selected.reference, selected.version])} uid={uid} caseId={caseId} capture={selected} operations={operations} assertSource={assertSource}/> : null}
      {kind === 'personal_data_correction' ? <PrivacyProfileCorrection uid={uid} caseId={caseId} operations={operations}/> : null}
      <PrivacyDispositionReview uid={uid} caseId={caseId} operations={operations} selection={selected && isPrivacyDisposition(selected, caseId) ? selected.reference : null} inspectionSelection={selected && isPrivacyDispositionScope(selected, caseId) ? selected.reference : null}/>
    </> : null}
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Les sources privées nécessitent une connexion administrateur récente et un dossier natif accessible.</Text> : null}
    {operations.notice && operations.frame.focused ? <Text accessibilityRole="alert" style={styles.caption}>{operations.notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
