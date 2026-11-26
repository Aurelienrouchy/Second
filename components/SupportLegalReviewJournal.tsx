import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {SupportLegalReviewJournal as Journal} from '@/services/supportLegalReviewJournal';
import type {LegalReviewArea, LegalReviewReceipt} from '@/types/supportLegalReview';
import {colors, spacing, typography} from '@/constants/theme';

/** Own metadata only: no role, private case body, JPEG or original is required. */
export function SupportLegalReviewJournal({uid, area}: {uid: string; area: LegalReviewArea}) {
  const frame = useLabelLifecycleContext(`legal-own-journal:${area}`, uid), lock = useRef(false);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), area, frame.focusRevision]);
  const [state, setState] = useState<{key: string; busy: boolean; receipt: LegalReviewReceipt | null; notice: string} | null>(null);
  const query = useQuery({queryKey: ['support-legal-review-journal', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, area, () => frame.assertCurrent(op));}});
  const pending = frame.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  const current = state?.key === key ? state : null;
  const run = async (mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (!pending || lock.current || !frame.focused) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setState({key, busy: true, receipt: null, notice: ''}); const guard = () => frame.assertCurrent(op);
    try {const receipt = await Journal[mode](pending, guard); guard(); setState({key, busy: false, receipt, notice: ''}); await query.refetch(); guard();}
    catch {if (frame.isCurrent(op)) setState({key, busy: false, receipt: null, notice: 'Le reçu exact reste inconnu. Conservez cette référence ; aucun original ou fichier privé ne sera renvoyé par sa relecture.'});}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) setState(old => old?.key === key ? {...old, busy: false} : old);}
  };
  if (!frame.focused || !pending && !query.isError) return null;
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>{area === 'confidential_original' ? 'Mon suivi des accès aux champs confidentiels' : 'Mon suivi des examens de demandes externes'}</Text>
    <Text style={styles.caption}>Seuls votre identifiant d’instruction, la référence du dossier et son empreinte sont conservés localement. Ce suivi reste consultable après perte du rôle ; il ne rouvre aucun texte, document ou paquet.</Text>
    {pending ? <><Text selectable style={styles.caption}>Instruction {pending.requestId} · dossier {pending.descriptor.caseId}</Text>
      <Button variant="secondary" disabled={current?.busy} onPress={() => {void run('observe');}}>Relire le reçu exact de cette instruction privée</Button>
      <Button variant="secondary" disabled={current?.busy} onPress={() => {void run('neutralize');}}>Arrêter seulement cette instruction non enregistrée</Button>
      {current?.receipt?.requestId === pending.requestId && current.receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={current.busy} onPress={() => {void run('acknowledge');}}>Reconnaître le reçu et libérer le suivi local</Button> : null}
      {current?.receipt ? <Text style={styles.caption}>{current.receipt.state === 'committed' ? 'Acte enregistré. Les données privées ne sont jamais réaffichées par ce reçu.' : current.receipt.state === 'not_executed' ? 'Intention close sans nouvel acte. Une copie de stockage intermédiaire n’est pas déclarée effacée.' : 'Aucun reçu terminal dans cette lecture. L’issue demeure à rapprocher.'}</Text> : null}
    </> : null}
    {query.isError || current?.notice ? <Text accessibilityRole="alert" style={styles.caption}>{current?.notice || 'Le suivi local doit être relu avant une nouvelle instruction dans ce domaine.'}</Text> : null}
    <Button variant="secondary" disabled={current?.busy || query.isFetching} onPress={() => {try {frame.capture(); void query.refetch();} catch {/* Current SDK owner only. */}}}>Relire mon suivi minimal</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
