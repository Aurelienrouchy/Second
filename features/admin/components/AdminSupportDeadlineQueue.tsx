import {auth} from '@/config/firebaseConfig';
import {useRouter} from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useSupportProjectionGeneration } from '@/hooks/useSupportProjectionGeneration';
import { getAuthSessionGeneration } from '@/store/authStore';
import { SupportRequestService } from '@/services/supportRequestService';
import { assertSupportProjectionGeneration, isSupportProjectionCurrent } from '@/services/supportProjectionGuard';
import { staleTradeOperation } from '@/services/tradeOperation';
import type { SupportDeadlineCursor, SupportDeadlineItem, SupportDeadlineLane, SupportDeadlinePage } from '@/types/supportRequest';

interface Props {uid: string; sourceKey: string; assertSelection: () => void; onSelect: (supportRequestId: string) => void; initialLane?: SupportDeadlineLane}
const rowKey = (item: SupportDeadlineItem) => item.id;
const clockLabels: Record<SupportDeadlineItem['clock']['state'], string> = {
  overdue: 'Échéance suivie dépassée', due_today: 'Échéance suivie aujourd’hui', pending: 'Échéance suivie à venir', unknown: 'Horloge native à vérifier', not_actionable: 'Aucune réponse prestataire autorisée par cette observation',
};
const canReadDetail = (item: SupportDeadlineItem) => item.version !== null && item.sourceRevision !== null &&
  item.id.length <= 128 && item.id.trim() === item.id && (item.kind !== 'bank_dispute' || item.clock.qualification === 'native_provider_observation' && item.transactionId !== null);
const quebecTime = (value: string) => new Date(value).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'});

/** A native metadata page. Opening an item requires a new current-admin detail read. */
export function AdminSupportDeadlineQueue({uid, sourceKey, assertSelection, onSelect, initialLane = 'dated'}: Props) {
  const [lane, setLane] = useState<SupportDeadlineLane>(initialLane);
  const [cursor, setCursor] = useState<SupportDeadlineCursor | null>(null);
  const [reload, setReload] = useState(0);
  const projection = useSupportProjectionGeneration();
  const dossier = JSON.stringify([sourceKey, lane, cursor, reload, projection]);
  const context = useLabelLifecycleContext(`admin-support-deadlines:${dossier}`, uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), dossier, context.focusRevision]);
  const queryKey = ['support-admin-deadlines', key] as const;
  const client = useQueryClient(), router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const busy = busyKey === key;
  const current = () => {assertSelection(); assertSupportProjectionGeneration(projection);};
  const query = useQuery({queryKey, structuralSharing: false, enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async () => {
      const operation = context.capture(), owner = auth.currentUser;
      const value = await SupportRequestService.deadlineQueue(uid, lane, cursor, () => {context.assertCurrent(operation); current(); if (!owner || auth.currentUser !== owner) throw staleTradeOperation();});
      return {owner, value};
    }});
  const page = context.focused && query.isSuccess && !query.isFetching && query.data.owner === auth.currentUser && isSupportProjectionCurrent(query.data.value) ? query.data.value : null;
  const assertPage = (expected: SupportDeadlinePage) => {
    current();
    const state = client.getQueryState(queryKey);
    if (!isSupportProjectionCurrent(expected) || client.getQueryData(queryKey) !== query.data || query.data?.value !== expected || query.data.owner !== auth.currentUser || state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw staleTradeOperation();
  };
  const choose = (value: SupportDeadlineLane) => {
    try {context.capture(); current(); if (busy || value === lane) return; setLane(value); setCursor(null); setNotice(null);} catch { /* Superseded lane or operator. */ }
  };
  const refresh = () => {
    try {context.capture(); current(); if (busy) return; setCursor(null); setReload(value => value + 1); setNotice(null);} catch { /* Superseded context. */ }
  };
  const next = () => {
    if (!page || busy || !page.page.hasMore || !page.page.cursor) return;
    try {context.capture(); assertPage(page); setCursor(page.page.cursor); setNotice(null);} catch { /* Old pages are not pagination permission. */ }
  };
  const open = async (item: SupportDeadlineItem) => {
    if (!page || busy || !canReadDetail(item)) return;
    let operation;
    try {assertPage(page); operation = context.start();} catch {return;}
    if (!operation) return;
    setBusyKey(key); setNotice(null);
    const guard = () => {context.assertCurrent(operation); assertPage(page);};
    try {
      if (item.kind === 'bank_dispute') {const target = await SupportRequestService.deadlineBankTarget(uid, item, cursor, guard); guard(); router.push({pathname: '/admin/bank-deadline', params: {target: JSON.stringify(target)}} as never); return;}
      const detail = await SupportRequestService.deadlineDetail(uid, item, guard);
      guard();
      if (detail.request.id !== item.id || detail.request.version !== item.version || detail.sourceRevision !== item.sourceRevision) throw staleTradeOperation();
      onSelect(detail.request.id);
    } catch {
      if (context.isCurrent(operation)) setNotice({key, text: 'Ce dossier ou votre accès a changé, ou la lecture a échoué. Relisez la file et sélectionnez sa source actuelle.'});
    } finally {context.finish(operation); if (context.isCurrent(operation)) setBusyKey(null);}
  };
  const renderItem = useCallback(({item}: ListRenderItemInfo<SupportDeadlineItem>) => <View style={styles.record}>
    <Text accessibilityRole="header" style={styles.body}>{clockLabels[item.clock.state]} · {item.kind === 'bank_dispute' ? 'Contestation bancaire' : item.kind === 'personal_data_access' ? 'Accès aux renseignements' : 'Rectification'}</Text>
    <Text selectable style={styles.caption}>Référence : {item.id} · Version {item.version ?? 'inconnue'} · Révision {item.sourceRevision ?? 'inconnue'}.</Text>
    <Text style={styles.body}>{item.clock.statutoryDueDate ? `Date suivie : ${item.clock.statutoryDueDate}.` : 'Aucune échéance native qualifiée.'}</Text>
    {item.kind === 'bank_dispute' ? <><Text style={styles.body}>{item.clock.providerDueAt ? `Échéance prestataire enregistrée : ${quebecTime(item.clock.providerDueAt)} (Québec) · ${item.clock.providerDueAt}` : 'Aucune date de réponse prestataire qualifiée ; aucune date n’est inventée.'}</Text><Text style={styles.caption}>Observation native enregistrée : {item.providerObservedAt ? `${quebecTime(item.providerObservedAt)} (Québec) · ${item.providerObservedAt}` : 'inconnue'}. Cette file ne constitue pas une lecture actuelle du prestataire.</Text></> : null}
    {item.clock.receivedAt ? <Text style={styles.caption}>Réception enregistrée : {quebecTime(item.clock.receivedAt)} (heure du Québec).</Text> : null}
    {item.clock.recordedDueDate && item.clock.qualification === 'unknown' ? <Text style={styles.caption}>Date conservée, non qualifiée : {item.clock.recordedDueDate}.</Text> : null}
    <Text selectable style={styles.caption}>Origine de l’horloge : {item.clock.clockOriginSupportRequestId ?? 'à vérifier'}. Affectation : {item.assignedAdminId ?? 'aucune enregistrée'}.</Text>
    <Text style={styles.caption}>{item.responseRecorded ? 'Une réponse est enregistrée ; sa présence ne prouve pas que l’obligation est terminée.' : 'Aucune réponse enregistrée dans cette source.'}</Text>
    <Text style={styles.caption}>État du dossier : {item.status ?? 'inconnu'}. Une affectation ou un retrait ne prolonge pas automatiquement l’échéance.</Text>
    {item.deadlineAlert ? <Text style={styles.caption}>Alerte observée : {quebecTime(item.deadlineAlert.observedAt)} (Québec). {item.deadlineAlert.awaitingAdmin ? 'Aucun destinataire opérateur qualifié lors du passage ; reprise requise.' : `${item.deadlineAlert.inAppNoticesPrepared} avis dans l’application préparé(s).`} Aucune remise sur appareil ni lecture humaine n’est attestée ; aucune échéance n’est prolongée.</Text> : <Text style={styles.caption}>Aucune alerte native qualifiée sur cette source ; cela ne prouve aucun examen humain.</Text>}
    <Button variant="secondary" disabled={!page || busy || !canReadDetail(item)} onPress={() => {void open(item);}}>Relire puis ouvrir ce dossier</Button>
    {!canReadDetail(item) ? <Text style={styles.caption}>Cette référence historique nécessite un rapprochement avant l’ouverture par le lecteur de dossier courant.</Text> : null}
  </View>, [page, busy, open]);
  if (!context.focused) return null;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Échéances de confidentialité et de contestations bancaires</Text>
    <Text style={styles.caption}>Cette file suit la réception enregistrée dans l’application. Une réception antérieure par un autre canal reste à qualifier ; aucun délai bancaire ou recours externe n’est prolongé.</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel="Sources des échéances" style={styles.section}>
      {(['dated', 'unknown', 'bank'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: lane === value, disabled: busy}}
        disabled={busy} style={[styles.choice, lane === value && styles.selected]} onPress={() => choose(value)}>
        <Text style={styles.body}>{value === 'bank' ? 'Banque : dernières observations natives enregistrées' : value === 'dated' ? 'Horloges qualifiées, échéances anciennes d’abord' : 'Horloges inconnues, parcours de tous les documents'}</Text>
      </Pressable>)}
    </View>
    {query.isError ? <Text accessibilityRole="alert" style={styles.body}>La file n’a pas pu être qualifiée. Aucune absence de demande ni fin d’obligation n’est confirmée.</Text> : null}
    {page ? <>
      <Text style={styles.caption}>Page observée le {quebecTime(page.observedAt)} (heure du Québec) : {page.page.inspected} documents inspectés, {page.page.returned} demandes affichées, {page.page.excluded} documents exclus de ce volet.</Text>
      <FlashList data={page.items} renderItem={renderItem} keyExtractor={rowKey} scrollEnabled={false}
        ListEmptyComponent={<Text style={styles.body}>Aucune demande affichable sur cette page. {page.page.hasMore ? 'Le parcours peut continuer après les documents inspectés.' : 'Cette lecture ne certifie pas l’absence globale de demandes.'}</Text>} />
      <Text style={styles.caption}>{page.page.completeScan ? 'Ce volet tient sur cette lecture bornée.' : page.page.hasMore ? 'Des documents restent à parcourir.' : 'Fin de ce parcours de pages.'} Les pages successives ne forment pas une capture globale cohérente.</Text>
      {page.page.hasMore ? <Button variant="secondary" disabled={busy || query.isFetching} onPress={next}>Lire la page suivante</Button> : null}
    </> : query.isFetching ? <Text style={styles.caption}>Lecture de la page actuelle…</Text> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.body}>{notice.text}</Text> : null}
    <Button variant="secondary" disabled={busy} onPress={refresh}>Relire ce volet depuis le début</Button>
    <Text style={styles.caption}>Aucun récit, note ou pièce n’est affiché dans cette file. Le suivi ne prouve ni disponibilité humaine, ni examen complet, ni traitement juridique terminé. Il n’exécute aucun mouvement financier.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.md}, record: {gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md,
  borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  choice: {padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm}, selected: {backgroundColor: colors.surfaceSubtle, borderColor: colors.primary}});
