import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { SwapHoldReviewService } from '@/services/swapHoldReviewService';
import { staleTradeOperation } from '@/services/tradeOperation';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { APP_LOCALE } from '@/constants/locale';
import { colors, radius, spacing, typography } from '@/constants/theme';

const date = (value: string) => new Date(value).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'});
const reasons = {commercial_dispute: 'Un litige est en cours d’examen.', financial_source_reconciliation: 'Les montants sont en cours de vérification.',
  reception_source_reconciliation: 'Les confirmations de réception sont à vérifier.', hold_clock_unqualified: 'L’échéance de la retenue est à vérifier.'};
export function SwapHoldReviewNotice({swapId, sourceKey}: {swapId: string; sourceKey: string}) {
  const uid = useAuthenticatedUid(), generation = getAuthSessionGeneration(), router = useRouter();
  const context = useShippingPurchaseContext(JSON.stringify(['swap-hold-review', swapId, sourceKey]), uid);
  const [instance] = useState(() => randomUUID());
  const queryClient = useQueryClient();
  const [application, setApplication] = useState(() => ({state: AppState.currentState, revision: 0}));
  const applicationRef = useRef(application);
  useEffect(() => {
    const observe = (state: typeof AppState.currentState) => {
      applicationRef.current = {state, revision: applicationRef.current.revision + 1};
      setApplication(applicationRef.current);
    };
    const subscription = AppState.addEventListener('change', observe);
    if (applicationRef.current.state !== AppState.currentState) observe(AppState.currentState);
    return () => {applicationRef.current = {...applicationRef.current, revision: applicationRef.current.revision + 1}; subscription.remove();};
  }, []);
  const active = !!uid && context.focused && application.state === 'active' && AppState.currentState === 'active';
  const captureRead = () => {
    const operation = context.capture(), revision = applicationRef.current.revision;
    const assertCurrent = () => {
      context.assertCurrent(operation);
      if (applicationRef.current.state !== 'active' || AppState.currentState !== 'active' || applicationRef.current.revision !== revision) throw staleTradeOperation();
    };
    assertCurrent(); return {uid: operation.session.uid, assertCurrent};
  };
  const holdKey = ['swap-hold-review', instance, uid, generation, swapId, sourceKey, context.focusRevision, application.revision];
  const releaseKey = ['swap-fund-release-log', instance, uid, generation, swapId, sourceKey, context.focusRevision, application.revision];
  const read = useQuery({queryKey: holdKey,
    enabled: active, staleTime: 0, gcTime: 0, retry: false, placeholderData: undefined,
    queryFn: () => {const operation = captureRead(); return SwapHoldReviewService.read(operation.uid, swapId, operation.assertCurrent);}});
  const release = useQuery({queryKey: releaseKey,
    enabled: active, staleTime: 0, gcTime: 0, retry: false, placeholderData: undefined,
    queryFn: () => {const operation = captureRead(); return SwapHoldReviewService.readReleaseDecision(operation.uid, swapId, operation.assertCurrent);}});
  const value = active && read.isFetchedAfterMount && read.isSuccess && !read.isFetching && !read.isError && !read.isPlaceholderData &&
    queryClient.getQueryState(holdKey)?.isInvalidated !== true ? read.data : null;
  const releaseValue = active && release.isFetchedAfterMount && release.isSuccess && !release.isFetching && !release.isError && !release.isPlaceholderData &&
    queryClient.getQueryState(releaseKey)?.isInvalidated !== true ? release.data : null;
  const current = value?.currentSource;
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Suivi du complément</Text>
    {read.isError ? <Text accessibilityRole="alert" style={styles.body}>Impossible de charger le suivi du complément.</Text>
      : !value ? <Text style={styles.body}>Chargement du suivi…</Text> : <>
        <Text style={styles.body}>{current?.state === 'no_topup' ? 'Aucun complément monétaire n’est identifié pour cet échange.' :
          current?.state === 'release_recorded' ? 'La libération du complément est enregistrée dans le porte-monnaie.' :
            current?.state === 'held' ? 'Le complément est retenu pour cet échange.' : 'Le complément est à vérifier par notre équipe.'}</Text>
        {current?.state !== 'no_topup' ? <>
          <Text style={styles.body}>Montant : {current?.amountCents == null ? 'à vérifier' : formatPriceWithCurrency(current.amountCents / 100)}.</Text>
          {current?.financialQualification !== 'native_linked_movements' ? <Text style={styles.caption}>Le montant du complément reste à confirmer.</Text> : null}
          <Text style={styles.caption}>Début de retenue : {current?.startedAt ? date(current.startedAt) : 'date inconnue'}.</Text>
          <Text style={styles.caption}>Échéance initiale : {current?.initialDeadlineAt ? date(current.initialDeadlineAt) : 'date inconnue'}.</Text>
          <Text style={styles.caption}>{current?.deadlineState === 'elapsed' ? 'L’échéance initiale est dépassée. Consultez le suivi de la libération ci-dessous.' :
            current?.deadlineState === 'future' ? 'La libération reste soumise au suivi de l’échange.' : 'L’échéance reste à vérifier.'}</Text>
          <Text style={styles.caption}>{current?.bothReceptionsAt ? `Les deux membres ont confirmé la réception le ${date(current.bothReceptionsAt)}.` : 'Les deux confirmations de réception restent à vérifier.'}</Text>
          {current?.reason ? <Text style={styles.body}>{reasons[current.reason]}</Text> : null}
        </> : null}
        {value.review ? <Text style={styles.caption}>Dernier examen : {date(value.review.observedAt)}. {value.review.currentSourceMatches ? 'La date de résolution reste à confirmer.' : 'L’échange a été modifié depuis cet examen.'}</Text>
          : value.reviewQualification === 'unqualified' ? <Text style={styles.caption}>Le résultat du dernier examen reste à vérifier.</Text> : null}
        {value.review && !value.review.currentSourceMatches ? <>
          <Text style={styles.caption}>Montant lors de cet ancien examen : {value.review.source.amountCents === null ? 'inconnu' : formatPriceWithCurrency(value.review.source.amountCents / 100)}. {value.review.source.reason ? reasons[value.review.source.reason] : ''}</Text>
          <Text style={styles.caption}>Ancien début de retenue : {value.review.source.startedAt ? date(value.review.source.startedAt) : 'date inconnue'}. Ancienne échéance : {value.review.source.initialDeadlineAt ? date(value.review.source.initialDeadlineAt) : 'date inconnue'}.</Text>
        </> : null}
      </>}
    <View style={styles.releaseDecision}>
      <Text accessibilityRole="header" style={styles.title}>Libération du complément</Text>
      {release.isError ? <Text accessibilityRole="alert" style={styles.body}>Impossible de charger le suivi de la libération.</Text>
        : !releaseValue ? <Text style={styles.body}>Chargement du suivi…</Text>
          : releaseValue.journalState === 'not_recorded' ? <Text style={styles.body}>Le détail de la libération n’est pas disponible ici. Consultez votre porte-monnaie ou contactez l’assistance.</Text>
            : releaseValue.journalState === 'unqualified' ? <Text style={styles.body}>Le montant et la date de libération restent à vérifier.</Text>
              : releaseValue.journalState === 'recorded' ? <>
                <Text style={styles.body}>{releaseValue.entry.result}</Text>
                <Text style={styles.body}>Montant libéré dans le porte-monnaie : {formatPriceWithCurrency(releaseValue.entry.criteria.releasedCents / 100)}.</Text>
                <Text style={styles.caption}>Libération enregistrée le {date(releaseValue.entry.executedAt)} (heure du Québec).</Text>
                <Text style={styles.caption}>Au moment de la libération : échange terminé ; {releaseValue.entry.criteria.disputed === false ? 'aucun litige enregistré' : 'état du litige non renseigné'}.</Text>
                <Text style={styles.caption}>Les deux membres avaient confirmé la réception le {date(releaseValue.entry.criteria.bothReceptionsAt)}.</Text>
                <Text style={styles.caption}>Début de retenue : {date(releaseValue.entry.criteria.heldAt)}. Échéance initiale : {date(releaseValue.entry.criteria.initialDeadlineAt)}.</Text>
                <Button variant="secondary" disabled={!active || release.isFetching} onPress={() => {
                  try {
                    captureRead(); const selected = queryClient.getQueryState(releaseKey);
                    if (!selected || selected.status !== 'success' || selected.fetchStatus !== 'idle' || selected.error !== null || selected.isInvalidated || selected.data !== releaseValue)
                      throw staleTradeOperation();
                    const entry = releaseValue.entry;
                    router.push({pathname: '/settings/support', params: {kind: 'automated_decision_review', swapId,
                      decisionId: entry.id, decisionRevision: entry.revision, decisionHash: entry.sourceHash}} as never);
                  } catch { /* A stale read grants no new review request. */ }
                }}>Demander une vérification</Button>
              </> : null}
    </View>
    <Button variant="secondary" disabled={!active || read.isFetching || release.isFetching} onPress={() => {try {captureRead(); void Promise.all([read.refetch(), release.refetch()]);} catch { /* Session no longer current. */ }}}>Actualiser le suivi</Button>
    <Button variant="ghost" disabled={!active} onPress={() => {try {captureRead(); router.push({pathname: '/settings/support', params: {kind: 'swap_hold_assistance', swapId}} as never);} catch { /* Session no longer current. */ }}}>Demander de l’aide pour le complément</Button>
  </View>;
}
const styles = StyleSheet.create({card: {padding: spacing.md, margin: spacing.md, gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceWarm},
  releaseDecision: {gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
