import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {router} from 'expo-router';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {SellerActivityReviewJournal as Journal} from '@/services/sellerActivityReviewJournal';
import {EligibilityService} from '@/services/eligibilityService';
import type {SellerActivityReviewReceipt} from '@/types/sellerActivityReview';
import {colors, spacing, typography} from '@/constants/theme';

export function AdminSellerActivityReviewJournal({uid, onOpenReview}: {uid: string; onOpenReview?: (id: string) => void}) {
  const frame = useLabelLifecycleContext('seller-activity-review-journal', uid), client = useQueryClient(), lock = useRef(false);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision]);
  const query = useQuery({queryKey: ['seller-activity-review-journal', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, () => frame.assertCurrent(op));}});
  const attempt = frame.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  const binding = JSON.stringify([key, attempt]), [state, setState] = useState<{key: string; busy: boolean; receipt: SellerActivityReviewReceipt | null; notice: string | null} | null>(null);
  const visible = state?.key === binding ? state : null;
  const perform = async (mode: 'observe' | 'neutralize' | 'acknowledge' | 'open') => {
    if (!attempt || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setState({key: binding, busy: true, receipt: null, notice: null}); const current = () => frame.assertCurrent(op);
    try {
      const receipt = mode === 'open' ? await Journal.observe(attempt, current) : await Journal[mode](attempt, current); current();
      if (mode === 'open') {
        if (receipt.state !== 'committed' || !receipt.reviewId) throw new Error('Relisez le reçu natif du dossier créé.');
        const detail = await EligibilityService.getAdminReview(uid, receipt.reviewId, undefined, {}, current); current();
        if (detail.request.id !== receipt.reviewId || detail.request.scope !== 'sell') throw new Error('Le dossier opérateur doit être relu.');
        if (onOpenReview) onOpenReview(receipt.reviewId); else router.push({pathname: '/admin/eligibility', params: {reviewId: receipt.reviewId}} as never);
      }
      current(); setState({key: binding, busy: false, receipt, notice: null}); await client.invalidateQueries({queryKey: ['seller-activity-review-journal']}); current();
    } catch (error) {try {current(); setState({key: binding, busy: false, receipt: null, notice: error instanceof Error ? error.message : 'Relisez le reçu exact. Le suivi est conservé.'});} catch {/* No previous owner's receipt or private error after replacement. */}}
    finally {frame.finish(op); lock.current = false;}
  };
  if (!attempt && !query.isError) return null;
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.body}>Mon suivi d’ouverture d’examen d’activité</Text>
    <Text style={styles.caption}>Le suivi local conserve seulement votre UID, la référence de commande et son empreinte. Aucun motif, note interne ou fait privé n’y est conservé. Il reste consultable par la même session SDK après perte du rôle.</Text>
    {query.isError ? <Text style={styles.caption}>Suivi non qualifié : relisez-le avant une nouvelle instruction.</Text> : null}
    <Button variant="secondary" disabled={!frame.focused || visible?.busy} onPress={() => {try {frame.capture(); void query.refetch();} catch {/* Same SDK owner only. */}}}>Relire mon suivi d’examen</Button>
    {attempt ? <>
      <Text selectable style={styles.caption}>Commande {attempt.requestId} · empreinte {attempt.payloadHash}</Text>
      <Button variant="secondary" disabled={visible?.busy} onPress={() => {void perform('observe');}}>Observer le reçu exact de l’ouverture</Button>
      {visible?.receipt ? <Text style={styles.body}>{visible.receipt.state === 'committed' ? `Dossier natif créé : ${visible.receipt.reviewId}. Avis interne enregistré ; ni livraison sur appareil ni lecture humaine vérifiées.` : visible.receipt.state === 'not_executed' ? `Non exécuté selon le reçu natif : ${visible.receipt.reason}.` : 'Aucun reçu enregistré dans cette lecture. Le résultat ne doit pas être déduit du silence.'}</Text> : null}
      {visible?.receipt?.state === 'unrecorded' ? <Button variant="secondary" disabled={visible.busy} onPress={() => {void perform('neutralize');}}>Neutraliser cette ouverture non enregistrée</Button> : null}
      {visible?.receipt?.state === 'committed' ? <Button variant="secondary" disabled={visible.busy} onPress={() => {void perform('open');}}>Ouvrir le dossier opérateur réellement créé</Button> : null}
      {visible?.receipt && visible.receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={visible.busy} onPress={() => {void perform('acknowledge');}}>Relire le reçu terminal et acquitter ce suivi</Button> : null}
    </> : null}
    {visible?.notice ? <Text accessibilityRole="alert" style={styles.caption}>{visible.notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
