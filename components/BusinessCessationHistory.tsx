import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useBusinessCessationIdentity } from '@/hooks/useBusinessCessationIdentity';
import { BusinessCessationJournal as Journal } from '@/services/businessCessationJournal';
import { BusinessCessationService as Service } from '@/services/businessCessationService';
import type { BusinessCessationAccess as Access, BusinessCessationReference as Reference, BusinessCessationPlan as Plan, BusinessCessationClaim as Claim } from '@/types/businessCessation';
import { BusinessCessationAction } from './BusinessCessationAction';
import { BusinessCessationClaimPanel } from './BusinessCessationClaimPanel';
import {readScopedQuery} from '@/utils/readScopedQuery';

type NativeItem = Plan | Claim;
const nativeKey = (item: NativeItem) => item.protocol === 'business_cessation_plan_v1' ? item.planId : item.claimId;

export function BusinessCessationHistory({uid, access, onPlanSelected, onClaimSelected}: {
  uid: string; access: Access; onPlanSelected?: (planId: string) => void; onClaimSelected?: (claimId: string) => void;
}) {
  const identity = useBusinessCessationIdentity(uid), owner = identity.owner, context = useLabelLifecycleContext(`cessation-history:${access}`, uid), native = useShippingPurchaseContext(`cessation-history-native:${access}`, uid), client = useQueryClient();
  const key = JSON.stringify([identity.key, access, native.focusRevision]), lock = useRef<symbol | null>(null);
  const query = useQuery({queryKey: ['business-cessation-history', uid, access, key, context.focusRevision], enabled: context.focused && identity.ready, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: ({signal}) => {const sdk = auth.currentUser; return readScopedQuery(signal, () => {
      const op = context.capture(); return () => {context.assertCurrent(op); if (auth.currentUser !== sdk) throw new Error('Connexion modifiée.');};
    }, async guard => ({entries: await Journal.read(uid, access, guard), owner: sdk}));}});
  const entries = context.focused && query.isSuccess && !query.isFetching && query.data.owner === auth.currentUser ? query.data.entries : [];
  const discovery = useInfiniteQuery({queryKey: ['business-cessation-discovery', uid, access, key, context.focusRevision], enabled: context.focused && identity.ready,
    initialPageParam: null as string | null, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: ({pageParam, signal}) => {const sdk = auth.currentUser; return readScopedQuery(signal, () => {
      const op = context.capture(); return () => {context.assertCurrent(op); if (auth.currentUser !== sdk) throw new Error('Connexion modifiée.');};
    }, async guard => ({page: await Service.discover(uid, access, pageParam, guard), owner: sdk}));},
    getNextPageParam: value => value.page.hasMore ? value.page.cursor : undefined});
  const nativeItems = context.focused && !discovery.isError ? [...new Map((discovery.data?.pages.flatMap<NativeItem>(p => p.owner === auth.currentUser ? p.page.items : []) ?? []).map(item => [nativeKey(item), item])).values()] : [];
  const [selected, setSelected] = useState<{key: string; owner: typeof owner; reference?: Reference; claimId?: string} | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const current = selected?.key === key && selected.owner === auth.currentUser ? selected : null;
  const refresh = () => {if (auth.currentUser === owner) {void client.invalidateQueries({queryKey: ['business-cessation-history', uid]}); void client.invalidateQueries({queryKey: ['business-cessation-discovery', uid]});}};
  const service = async (reference: Reference, mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (auth.currentUser !== owner || lock.current) return; let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(true); setNotice(''); const guard = () => {context.assertCurrent(op); if (auth.currentUser !== owner) throw new Error('Connexion modifiée.');};
    try {if (mode === 'acknowledge') await Journal.acknowledge(reference, guard); else await Journal.service(reference, mode, guard); guard();}
    catch {if (context.isCurrent(op) && owner === auth.currentUser) setNotice('Le même suivi reste conservé ; aucune absence d’effet n’est supposée.');}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(false);} if (context.isCurrent(op) && owner === auth.currentUser) refresh();}
  };
  const choose = useCallback((value: {reference?: Reference; claimId?: string}, notify?: () => void) => {try {if (auth.currentUser !== owner) return; context.capture(); native.capture(); setSelected({key, owner, ...value}); notify?.();} catch { /* Own native receipt only. */ }}, [owner, context, native, key]);
  const renderNative = useCallback(({item}: {item: NativeItem}) => <View style={styles.section}>
    <Text style={styles.caption}>{item.protocol === 'business_cessation_plan_v1' ? `Plan documentaire, version ${item.version}. Créé le ${item.createdAt ?? 'date non qualifiée'}.` : `Réclamation conservée pour traitement. Enregistrée le ${item.recordedAt ?? 'date non qualifiée'}. Aucune obligation n’est déclarée résolue.`}</Text>
    <Button variant="secondary" onPress={() => item.protocol === 'business_cessation_plan_v1' ? choose({}, () => onPlanSelected?.(item.planId)) : choose({claimId: item.claimId}, () => onClaimSelected?.(item.claimId))}>{item.protocol === 'business_cessation_plan_v1' ? 'Relire ce plan retrouvé sur le serveur' : 'Relire ma réclamation retrouvée sur le serveur'}</Button>
  </View>, [choose, onPlanSelected, onClaimSelected]);
  if (!native.focused) return null;
  return <View style={styles.section}>
    {context.focused ? <><Text accessibilityRole="header" style={styles.title}>Mon suivi du dossier de continuité</Text>
      <Text style={styles.caption}>Seules les références opaques sont conservées sur cet appareil. Les reçus propres restent lisibles après perte du rôle ; une reprise relit le corps réservé sur le serveur, jamais sur cet appareil.</Text>
      <Button variant="secondary" disabled={busy} onPress={() => {try {if (auth.currentUser !== owner) return; context.capture(); refresh();} catch { /* Own GET only. */ }}}>Relire mon suivi de continuité</Button>
      <Text style={styles.caption}>{access === 'admin' ? 'Les plans sont retrouvés depuis les dossiers natifs, avec votre rôle administrateur actuel.' : 'Vos réclamations sont retrouvées sur le serveur, même après réinstallation ou acquittement d’un reçu local.'}</Text>
      <View style={styles.list}><FlashList data={nativeItems} keyExtractor={nativeKey} renderItem={renderNative} ListEmptyComponent={<Text style={styles.caption}>{discovery.isError ? 'La liste native ne peut pas être qualifiée. Les reçus propres restent accessibles séparément.' : 'Aucun dossier sur les pages natives lues ; cela ne prouve pas l’absence d’obligation.'}</Text>} /></View>
      {discovery.hasNextPage ? <Button variant="secondary" disabled={discovery.isFetchingNextPage} onPress={() => {try {if (auth.currentUser !== owner) return; context.capture(); void discovery.fetchNextPage();} catch { /* Same actor and native cursor only. */ }}}>Lire les dossiers de continuité suivants</Button> : null}
      {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le suivi ne peut pas être qualifié. Les références restent conservées.</Text> : null}
      {entries.map(({reference, receipt}) => <View key={reference.requestId} style={styles.section}>
        <Text selectable style={styles.caption}>Intention {reference.requestId} : {receipt.state}. {receipt.action ?? 'Aucune instruction retrouvée'}.</Text>
        <Text style={styles.caption}>Ce reçu n’active aucune cessation et n’exécute aucun mouvement financier.</Text>
        <Button variant="secondary" disabled={busy} onPress={() => {void service(reference, 'observe');}}>Relire cette même intention de continuité</Button>
        {receipt.state === 'unrecorded' ? <Button variant="secondary" disabled={busy} onPress={() => {void service(reference, 'neutralize');}}>Neutraliser cette intention si elle n’est pas réservée</Button> : null}
        {receipt.state === 'pending' ? <Button variant="secondary" disabled={busy} onPress={() => choose({reference})}>Examiner la reprise de cet export réservé</Button> : null}
        {receipt.planId && access === 'admin' ? <Button variant="secondary" disabled={busy} onPress={() => choose({}, () => onPlanSelected?.(receipt.planId!))}>Relire le plan de ce reçu</Button> : null}
        {receipt.claimId && access === 'owner' ? <Button variant="secondary" disabled={busy} onPress={() => choose({claimId: receipt.claimId!}, () => onClaimSelected?.(receipt.claimId!))}>Relire la réclamation de ce reçu</Button> : null}
        {['recorded', 'not_executed'].includes(receipt.state) ? <Button variant="secondary" disabled={busy} onPress={() => {void service(reference, 'acknowledge');}}>Acquitter ce reçu de continuité</Button> : null}
      </View>)}
      {notice ? <Text accessibilityRole="alert" style={styles.caption}>{notice}</Text> : null}
    </> : null}
    {current?.reference ? <BusinessCessationAction uid={uid} access={access} sourceKey={`${key}:${current.reference.requestId}`} reference={current.reference} onRecorded={refresh} /> : null}
    {current?.claimId && access === 'owner' ? <BusinessCessationClaimPanel uid={uid} claimId={current.claimId} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {minHeight: spacing.xl * 4, height: spacing.xl * 8}});
