import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {PrivacyDataValues} from '@/components/PrivacyDataValues';
import {auth} from '@/config/firebaseConfig';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {PrivacyOperationsService as Service, privacyFailure, privacyGuard} from '@/services/privacyOperationsService';
import type {PrivacyReference} from '@/types/privacyOperations';
import {colors, spacing, typography} from '@/constants/theme';
/** Own released fields only; profile activity and commercial admission are irrelevant. */
export function SupportPrivacyCopies({uid, caseId}: {uid: string; caseId: string}) {
  const sdk = auth.currentUser, frame = useLabelLifecycleContext(`privacy-released-copies:${caseId}`, uid);
  const [identity, setIdentity] = useState({sdk, revision: 0});
  if (identity.sdk !== sdk) setIdentity({sdk, revision: identity.revision + 1});
  const key = JSON.stringify([uid, caseId, getAuthSessionGeneration(), frame.focusRevision, identity.revision]);
  const [state, setState] = useState<{key: string; cursor: string | null; selection: PrivacyReference | null}>({key, cursor: null, selection: null});
  const current = state.key === key ? state : {key, cursor: null, selection: null};
  const guard = () => {const op = frame.capture(); return privacyGuard(uid, () => {frame.assertCurrent(op); if (auth.currentUser !== sdk) throw privacyFailure();});};
  const query = useQuery({queryKey: ['privacy-released-copies', key, current.cursor], enabled: frame.focused && sdk?.uid === uid, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const check = guard(); return {sdk, value: await Service.releasedCopies(uid, caseId, current.cursor, check)};}});
  const source = frame.focused && query.isSuccess && !query.isFetching && !query.isError && query.data.sdk === sdk && sdk === auth.currentUser ? query.data.value : null;
  const detail = useQuery({queryKey: ['privacy-released-copy', key, current.selection], enabled: !!source && !!current.selection, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {if (!current.selection) throw privacyFailure(); const check = guard(); if (!source?.entries.some(e => e.reference.id === current.selection?.id && e.reference.contentHash === current.selection.contentHash)) throw privacyFailure(); return {sdk, value: await Service.releasedCopy(uid, caseId, current.selection, check)};}});
  const copy = source && detail.isSuccess && !detail.isFetching && !detail.isError && detail.data.sdk === auth.currentUser ? detail.data.value : null;
  const change = (cursor: string | null, selection: PrivacyReference | null = null) => {try {guard()(); setState({key, cursor, selection});} catch {/* Same rendered SDK and route only. */}};
  if (!frame.focused) return null;
  return <View style={styles.section}><Text style={styles.title}>Copies de renseignements mises à ma disposition</Text><Text style={styles.caption}>Ces copies contiennent les champs que l’équipe a effectivement sélectionnés pour votre dossier. Elles ne représentent pas une recherche exhaustive ni la clôture de votre demande.</Text>
    {source?.entries.map(e => <Button key={e.reference.id} variant="secondary" onPress={() => change(current.cursor, e.reference)}>Consulter la copie du {e.recordedAt} · {e.entryCount} source(s)</Button>)}
    {source?.entries.length === 0 ? <Text style={styles.caption}>Aucune copie publiée sur cette page.</Text> : null}
    {source?.page.nextCursor ? <Button variant="secondary" onPress={() => change(source.page.nextCursor)}>Page suivante de mes copies</Button> : null}
    {current.cursor ? <Button variant="secondary" onPress={() => change(null)}>Revenir à la première page</Button> : null}
    {copy ? <View style={styles.section}><Text style={styles.caption}>Copie publiée le {copy.copy.recordedAt}. Affichage privé temporaire.</Text>{copy.copy.entries.map(e => <View style={styles.section} key={e.entry.id}><PrivacyDataValues values={e.values}/></View>)}<Button variant="secondary" onPress={() => change(current.cursor)}>Masquer la copie</Button></View> : null}
    {query.isError || detail.isError ? <Text accessibilityRole="alert" style={styles.caption}>La copie doit être relue avec la connexion Firebase propriétaire de ce dossier.</Text> : null}
    <Button variant="secondary" disabled={query.isFetching || detail.isFetching} onPress={() => {try {guard()(); setState({key, cursor: current.cursor, selection: null}); void query.refetch();} catch {/* Stale callback. */}}}>Relire mes copies disponibles</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
