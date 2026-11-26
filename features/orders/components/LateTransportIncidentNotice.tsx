import { type ComponentType, useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { LateTransportRecoveryPanel } from '@/components/LateTransportRecoveryPanel';
import { LateTransportRecoveryJournal } from '@/components/LateTransportRecoveryJournal';
import { getAuthSessionGeneration } from '@/store/authStore';
import { LateTransportIncidentService } from '@/services/lateTransportIncidentService';
import { APP_LOCALE } from '@/constants/locale';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { LateTransportIncident, LateTransportIncidentPage, LateTransportScope } from '@/types/lateTransportIncident';

const keyExtractor = (item: LateTransportIncident) => item.incidentId;
const localDate = (iso: string) => new Date(iso).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'});
const EMPTY_PAGES: LateTransportIncidentPage[] = [];

export function LateTransportIncidentNotice({transactionId, scope = 'owner', sourceKey = '', showEmpty = false, RecoveryComponent}: {
  transactionId: string; scope?: LateTransportScope; sourceKey?: string; showEmpty?: boolean;
  RecoveryComponent?: ComponentType<{uid: string; transactionId: string; incidentId: string; assertSelection: () => void}>;
}) {
  const uid = useAuthenticatedUid(), generation = getAuthSessionGeneration(), router = useRouter();
  const context = useLabelLifecycleContext(JSON.stringify(['late-transport-incidents', transactionId, scope, sourceKey]), uid);
  const [readInstance] = useState(() => randomUUID());
  const selectionKey = JSON.stringify([uid, transactionId, scope, sourceKey, context.focusRevision]);
  const selectionEpoch = useRef(0);
  const [selection, setSelection] = useState<{key: string; incidentId: string; epoch: number; operation: ReturnType<typeof context.capture>} | null>(null);
  const history = useInfiniteQuery({queryKey: ['late-transport-incidents', readInstance, uid, generation, transactionId, scope, sourceKey, context.focusRevision],
    enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false, initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) => {const operation = context.capture(); return LateTransportIncidentService.read(operation.base.session.uid, transactionId,
      scope, pageParam, () => context.assertCurrent(operation));}, getNextPageParam: page => page.hasMore ? page.cursor ?? undefined : undefined});
  const ready = !!uid && context.focused && history.isSuccess && !history.isFetching && !history.isError;
  const pages = ready ? history.data.pages : EMPTY_PAGES;
  const revision = pages[0]?.sourceRevision;
  const items = pages.flatMap(page => page.items);
  const coherent = typeof revision === 'string' && pages.every(page => page.ownerId === uid && page.transactionId === transactionId && page.sourceRevision === revision) &&
    items.every((item, index) => index === 0 || item.incidentId > items[index - 1].incidentId);
  const visibleItems = ready && coherent ? items : [];
  const renderItem = useCallback(({item}: {item: LateTransportIncident}) => <View style={styles.incident}>
    <Text style={styles.title}>{item.providerStatusCode === 'DE' ? 'Livraison signalée à examiner avec le remboursement' : 'Transit signalé à examiner avec le remboursement'}</Text>
    <Text style={styles.body}>Lecture du transporteur : {localDate(item.providerObservedAt)} (heure du Québec).</Text>
    <Text style={styles.caption}>Observation ajoutée au dossier : {localDate(item.recordedAt)}. Cette date est distincte de l’occurrence.</Text>
    <Text style={styles.body}>{item.providerOccurredAt ? `Occurrence fournie en UTC, affichée à l’heure du Québec : ${localDate(item.providerOccurredAt)}.` : 'Date d’occurrence qualifiée non fournie.'}</Text>
    <Text style={styles.caption}>{item.temporalRelation === 'after_refund_request' ? 'L’occurrence qualifiée se situe après la demande de remboursement enregistrée.'
      : item.temporalRelation === 'before_or_at_refund_request' ? 'L’occurrence qualifiée se situe avant ou à la demande de remboursement. Ce n’est pas une preuve de nouvelle réception après remboursement.'
        : 'L’ordre temporel entre l’occurrence et la demande de remboursement n’est pas qualifié.'}</Text>
    <Text style={styles.body}>Dossier de remboursement lors de cet incident : {item.refund.qualification === 'historical_unknown' ? 'qualification historique inconnue' :
      item.refund.state === 'engaged' ? 'demande engagée et qualifiée dans l’application' : item.refund.state === 'confirmed' ? 'enregistrement natif du remboursement qualifié' : 'résultat à rapprocher'}.</Text>
    {item.refund.requestedAt ? <Text style={styles.caption}>Demande de remboursement enregistrée le {localDate(item.refund.requestedAt)} (heure du Québec).</Text> : null}
    {item.refund.fundsAppliedAt ? <Text style={styles.caption}>Application financière native enregistrée le {localDate(item.refund.fundsAppliedAt)}. Cela n’atteste pas un crédit reçu sur un compte bancaire.</Text> : null}
    <Text style={styles.caption}>{item.currentCapture ? 'La référence de cette observation correspond au suivi identifié lors de cette lecture.' :
      'Cette observation est conservée dans l’historique ; elle ne correspond plus à la capture courante du suivi.'}</Text>
    <Text style={styles.body}>{item.financialSourceCurrent ? 'La source financière concordait lors de cette lecture. La réception des fonds sur un compte bancaire reste non vérifiée.' :
      'La source financière actuelle ne concorde plus avec cet incident. Son ancien résultat ne confirme aucune somme reçue actuellement ; une relecture humaine est nécessaire.'}</Text>
    <Text style={styles.caption}>Cette observation ne confirme ni possession retrouvée, réception par le destinataire ou crédit bancaire. Elle ne crée aucune somme à repayer et n’autorise aucune remise en vente. Une instruction humaine reste nécessaire.</Text>
    <Button variant="secondary" onPress={() => {try {const operation = context.capture(); const epoch = ++selectionEpoch.current; setSelection({key: selectionKey, incidentId: item.incidentId, epoch, operation});} catch { /* Inactive source. */ }}}>Examiner la récupération physique de cet article</Button>
    {scope === 'owner' && item.incidentRevision && item.financialSourceHash && revision ? <Button variant="secondary" onPress={() => {try {
      context.capture(); const pageIndex = pages.findIndex(page => page.items.some(row => row.incidentId === item.incidentId));
      if (pageIndex < 0) return;
      router.push({pathname: '/settings/support', params: {kind: 'commercial_late', transactionId,
        lateTransport: JSON.stringify({kind: 'late_transport_incident', transactionId, incidentId: item.incidentId,
          incidentRevision: item.incidentRevision, incidentHash: item.incidentHash, financialSourceHash: item.financialSourceHash, orderRevision: revision}),
        ...(pageIndex > 0 && pages[pageIndex - 1].cursor ? {incidentCursor: pages[pageIndex - 1].cursor} : {})}} as never);
    } catch { /* Stale session/source. */ }}}>Demander une instruction pour cette observation</Button> : null}
  </View>, [scope, revision, pages, context, router, transactionId, selectionKey]);
  const ownJournal = uid && scope === 'owner' ? <LateTransportRecoveryJournal uid={uid} scope="owner" /> : null;
  const selectedId = selection?.key === selectionKey && visibleItems.some(item => item.incidentId === selection.incidentId) ? selection.incidentId : null;
  const assertSelection = () => {if (!selection || selection.epoch !== selectionEpoch.current || selection.key !== selectionKey) throw new Error('La sélection de l’incident a changé.'); context.assertCurrent(selection.operation);};
  if (ready && coherent && !items.length && !showEmpty && !history.hasNextPage) return ownJournal;
  return <>{ownJournal}<View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Suivi à examiner avec le remboursement</Text>
    <Text style={styles.caption}>Les observations conservées restent distinctes du remboursement et de la réception réelle du colis. Leurs dates n’établissent pas une priorité de traitement.</Text>
    {history.isError ? <Text accessibilityRole="alert" style={styles.body}>Les observations ne peuvent pas être confirmées. Aucun ancien résultat financier ne remplace cette lecture.</Text>
      : history.isFetching ? <Text style={styles.body}>Lecture du dossier enregistré…</Text> : !ready ? <Text style={styles.body}>La lecture privée reste à confirmer.</Text>
        : !coherent ? <Text style={styles.body}>La source a changé ou ne qualifie pas l’ensemble des pages. Les observations sont masquées ; relisez le dossier avant de les consulter.</Text>
          : !items.length ? <Text style={styles.body}>Aucune observation liée au remboursement n’est visible dans cette page. Cette absence ne prouve ni réception, perte du colis ou traitement complet.</Text> : null}
    {visibleItems.length ? <View style={styles.viewport}><FlashList data={visibleItems} keyExtractor={keyExtractor} renderItem={renderItem}
      nestedScrollEnabled contentContainerStyle={styles.eventContent} /></View> : null}
    {ready && coherent && history.hasNextPage ? <Button variant="secondary" disabled={history.isFetching} onPress={() => {try {context.capture(); void history.fetchNextPage();} catch { /* Stale session/source. */ }}}>Lire les observations suivantes</Button> : null}
    <Button variant="secondary" disabled={!uid || !context.focused || history.isFetching} onPress={() => {try {context.capture(); void history.refetch();} catch { /* Stale session/source. */ }}}>Relire les observations enregistrées</Button>
    {uid && selectedId ? RecoveryComponent ? <RecoveryComponent key={selectedId} uid={uid} transactionId={transactionId} incidentId={selectedId} assertSelection={assertSelection} /> : scope === 'owner' ? <LateTransportRecoveryPanel key={selectedId} uid={uid} transactionId={transactionId} incidentId={selectedId} scope="owner" assertSelection={assertSelection} /> : null : null}
    {scope === 'owner' ? <Button variant="ghost" disabled={!uid || !context.focused} onPress={() => {try {context.capture();
      router.push({pathname: '/settings/support', params: {transactionId, kind: 'commercial_late'}} as never);} catch { /* Stale session. */ }}}>Contacter l’équipe pour cette commande</Button>
      : <Text style={styles.caption}>Cette consultation administrative seule n’enregistre aucun traitement humain et ne déclenche aucune action financière ou sur l’article.</Text>}
  </View></>;
}
const styles = StyleSheet.create({card: {padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md, backgroundColor: colors.surfaceWarm, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  incident: {paddingVertical: spacing.sm, gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  viewport: {height: spacing['4xl'] * 5}, eventContent: {padding: spacing.xs} });
