import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {AuthorityRequestJournal as Journal} from '@/services/authorityRequestJournal';
import type {AuthorityReceipt} from '@/types/authorityRequest';
import {colors, spacing, typography} from '@/constants/theme';

/** Own minimal receipts remain available after loss of the private admin role. */
export function AdminAuthorityRequestJournal({uid}: {uid: string}) {
  const frame = useLabelLifecycleContext('authority-own-journal', uid), client = useQueryClient(), lock = useRef(false);
  const key = ['authority-own-journal', uid, getAuthSessionGeneration(), frame.focusRevision] as const;
  const journal = useQuery({queryKey: key, enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = frame.capture(); return Journal.read(uid, () => frame.assertCurrent(op));}});
  const pending = frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError ? journal.data : null;
  const selection = JSON.stringify([key, pending]), [state, setState] = useState<{key: string; busy: boolean; receipt: AuthorityReceipt | null; notice: string | null} | null>(null);
  const currentState = state?.key === selection ? state : null;
  const perform = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!pending || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setState({key: selection, busy: true, receipt: null, notice: null}); const current = () => frame.assertCurrent(op);
    try {const receipt = await Journal[mode](pending, current); current(); setState({key: selection, busy: false, receipt, notice: null}); await client.invalidateQueries({queryKey: ['authority-own-journal', uid]}); current();}
    catch {try {current(); setState({key: selection, busy: false, receipt: null, notice: 'L’issue reste à rapprocher. Le descripteur est conservé ; aucun récit perdu ne sera reconstitué ou renvoyé.'});} catch {/* Replacement sessions receive no private result. */}}
    finally {frame.finish(op); lock.current = false;}
  };
  if (!pending && !journal.isError) return null;
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.body}>Mon suivi de demandes privées</Text>
    <Text style={styles.caption}>Le suivi local contient seulement la référence de votre instruction. Sa relecture ne dépend pas d’une habilitation actuelle et ne donne accès à aucun récit privé.</Text>
    <Button variant="secondary" disabled={!frame.focused || currentState?.busy} onPress={() => {try {frame.capture(); void journal.refetch();} catch {/* Original SDK owner only. */}}}>Relire mon suivi privé</Button>
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le suivi local ne peut pas être qualifié. Aucune nouvelle instruction n’est proposée.</Text> : null}
    {pending ? <><Text selectable style={styles.caption}>Instruction {pending.requestId} · dossier {pending.descriptor.caseId}</Text>
      <Button variant="secondary" disabled={currentState?.busy} onPress={() => {void perform('observe');}}>Observer le reçu de cette instruction</Button>
      {currentState?.receipt ? <Text style={styles.body}>{currentState.receipt.state === 'committed' ? 'Instruction documentaire enregistrée. Aucun renseignement n’a été communiqué à un tiers.' : currentState.receipt.state === 'not_executed' ? 'Cette instruction n’a pas été exécutée selon le reçu relu.' : 'Aucun reçu enregistré dans cette lecture. Le résultat reste à rapprocher.'}</Text> : null}
      {currentState?.receipt?.state === 'unrecorded' ? <Button variant="secondary" disabled={currentState.busy} onPress={() => {void perform('neutralize');}}>Arrêter cette instruction non enregistrée</Button> : null}
      {currentState?.receipt && currentState.receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={currentState.busy} onPress={() => {void perform('acknowledge');}}>Relire le reçu et acquitter ce suivi local</Button> : null}
    </> : null}
    {currentState?.notice ? <Text accessibilityRole="alert" style={styles.caption}>{currentState.notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
