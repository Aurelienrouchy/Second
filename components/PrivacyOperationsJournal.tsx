import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {auth} from '@/config/firebaseConfig';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {PrivacyOperationsJournal as Journal} from '@/services/privacyOperationsJournal';
import {privacyFailure, privacyGuard} from '@/services/privacyOperationsService';
import {getAuthSessionGeneration} from '@/store/authStore';
import type {PrivacyReceipt} from '@/types/privacyOperations';
import {colors, spacing, typography} from '@/constants/theme';
export function PrivacyOperationsJournal({uid}: {uid: string}) {
  const sdk = auth.currentUser, frame = useLabelLifecycleContext('privacy-operation-own-journal', uid), lock = useRef(false), client = useQueryClient();
  const [identity, setIdentity] = useState({sdk, revision: 0});
  if (identity.sdk !== sdk) setIdentity({sdk, revision: identity.revision + 1});
  const key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision, identity.revision]);
  const capture = () => {const op = frame.capture(); return privacyGuard(uid, () => {frame.assertCurrent(op); if (sdk !== auth.currentUser) throw privacyFailure();});};
  const [state, setState] = useState<{key: string; busy: boolean; receipt: PrivacyReceipt | null; error: boolean}>({key, busy: false, receipt: null, error: false});
  const query = useQuery({queryKey: ['privacy-operation-own', uid, key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const guard = capture(); return {sdk, value: await Journal.read(uid, guard)};}});
  const pending = frame.focused && query.isSuccess && !query.isFetching && !query.isError && query.data.sdk === sdk && sdk === auth.currentUser ? query.data.value : null;
  const current = state.key === key ? state : null;
  const run = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!pending || lock.current) return; let guard; try {guard = capture();} catch {return;} lock.current = true; setState({key, busy: true, receipt: null, error: false});
    try {const receipt = await Journal[mode](pending, guard); guard(); setState({key, busy: false, receipt, error: false}); await client.invalidateQueries({queryKey: ['privacy-operation-own', uid]}); guard();}
    catch {try {guard(); setState({key, busy: false, receipt: null, error: true});} catch {/* Current SDK only. */}}
    finally {lock.current = false;}
  };
  if (!frame.focused || !pending && !query.isError) return null;
  return <View style={styles.section}><Text style={styles.title}>Mon suivi des opérations sur les données</Text><Text style={styles.caption}>Ce suivi conserve uniquement une référence de dossier, une action, un identifiant d’instruction et une empreinte. Il reste accessible avec votre connexion Firebase après perte du rôle.</Text>
    {pending ? <><Text selectable style={styles.caption}>{pending.descriptor.action} · {pending.requestId}</Text><Button variant="secondary" disabled={current?.busy} onPress={() => {void run('observe');}}>Relire le reçu exact de mon opération</Button><Button variant="secondary" disabled={current?.busy} onPress={() => {void run('neutralize');}}>Neutraliser cette seule intention non enregistrée</Button>
      {current?.receipt?.requestId === pending.requestId && current.receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={current.busy} onPress={() => {void run('acknowledge');}}>Reconnaître ce reçu et libérer le suivi local</Button> : null}
      {current?.receipt ? <Text style={styles.caption}>{current.receipt.state === 'committed' ? 'Instruction enregistrée. Le résultat externe et l’effacement des données doivent être vérifiés séparément.' : current.receipt.state === 'not_executed' ? 'Cette instruction est close sans nouvelle exécution.' : 'Aucune instruction terminale observée. Aucun corps privé n’est conservé pour la renvoyer automatiquement.'}</Text> : null}</> : null}
    {query.isError || current?.error ? <Text accessibilityRole="alert" style={styles.caption}>Reçu inconnu ; conservez cette référence et relisez avant une nouvelle instruction.</Text> : null}
    <Button variant="secondary" disabled={current?.busy || query.isFetching} onPress={() => {try {capture()(); void query.refetch();} catch {/* Stale callback. */}}}>Relire mon suivi minimal des données</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
