import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { formatCents } from '@/utils/formatPrice';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useBusinessCessationIdentity } from '@/hooks/useBusinessCessationIdentity';
import { BusinessCessationService as Service } from '@/services/businessCessationService';
import type { SupportRequest } from '@/types/supportRequest';
import type { BusinessCessationLane as Lane, BusinessCessationOwnObligations as Obligations } from '@/types/businessCessation';
import { BusinessCessationStatus } from './BusinessCessationStatus';
import { BusinessCessationAction } from './BusinessCessationAction';
import { BusinessCessationClaimPanel } from './BusinessCessationClaimPanel';

const lanes: {lane: Lane; label: string}[] = [{lane: 'purchases', label: 'Mes achats'}, {lane: 'sales', label: 'Mes ventes'}, {lane: 'swaps_initiated', label: 'Mes Trocs proposés'}, {lane: 'swaps_received', label: 'Mes Trocs reçus'}, {lane: 'withdrawals', label: 'Mes retraits'}, {lane: 'wallet', label: 'Mon portefeuille'}, {lane: 'support', label: 'Mes dossiers de support'}];
type Item = Obligations['items'][number];
const rowKey = (item: Item) => JSON.stringify(item.reference);
export function BusinessCessationOwnerPanel({uid, request}: {uid: string; request: SupportRequest}) {
  const identity = useBusinessCessationIdentity(uid), owner = identity.owner, native = useShippingPurchaseContext(`cessation-owner-native:${request.id}`, uid), context = useLabelLifecycleContext(`cessation-owner:${request.id}`, uid);
  const key = JSON.stringify([identity.key, request.id, request.version, native.focusRevision]), admissible = request.ownerId === uid && request.kind === 'access_interruption';
  const [lane, setLane] = useState<Lane>('purchases');
  const [selection, setSelection] = useState<{key: string; owner: typeof owner; item: Item; planId: string; nonce: string} | null>(null);
  const [claim, setClaim] = useState<{key: string; owner: typeof owner; claimId: string} | null>(null);
  const statusQuery = useQuery({queryKey: ['business-cessation-status', uid, key, context.focusRevision], enabled: context.focused && identity.ready && admissible, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = context.capture(), sdk = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== sdk) throw new Error('Connexion modifiée.');}; const status = await Service.status(uid, guard); guard(); return {status, owner: sdk};}});
  const status = context.focused && statusQuery.isSuccess && !statusQuery.isFetching && statusQuery.data.owner === auth.currentUser ? statusQuery.data.status : null;
  const list = useInfiniteQuery({queryKey: ['business-cessation-own-obligations', uid, lane, key, context.focusRevision], enabled: context.focused && identity.ready && admissible, initialPageParam: null as string | null, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async ({pageParam}) => {const op = context.capture(), sdk = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== sdk) throw new Error('Connexion modifiée.');}; const page = await Service.obligations(uid, lane, pageParam, guard); guard(); return {page, owner: sdk};}, getNextPageParam: value => value.page.hasMore ? value.page.cursor : undefined});
  const items = context.focused ? [...new Map((list.data?.pages.flatMap(p => p.owner === auth.currentUser ? p.page.items : []) ?? []).map(i => [rowKey(i), i])).values()] : [];
  const live = useRef({key, lane, items, planId: status?.planId});
  useLayoutEffect(() => {live.current = {key, lane, items, planId: status?.planId};});
  const choose = useCallback((item: Item) => {try {if (!admissible || auth.currentUser !== owner || live.current.key !== key || live.current.lane !== lane || !status?.planId || live.current.planId !== status.planId || !live.current.items.some(i => i.sourceHash === item.sourceHash && rowKey(i) === rowKey(item))) return; context.capture(); native.capture(); setSelection({key, owner, item, planId: status.planId, nonce: randomUUID()}); setClaim(null);} catch { /* Native own list only. */ }}, [admissible, owner, status, context, native, key, lane]);
  const renderItem = useCallback(({item}: {item: Item}) => <View style={styles.row}><Text style={styles.caption}>{item.reference.kind === 'wallet' ? 'Mon portefeuille' : `${item.reference.kind} — ${item.reference.id}`}. État : {item.status ?? 'à qualifier'}. {item.amountCents !== null && item.currency === 'CAD' ? `${formatCents(item.amountCents)} CAD` : 'Montant non qualifié.'}</Text><Button variant="secondary" disabled={!status?.planId} onPress={() => choose(item)}>Rattacher cette obligation native au plan</Button></View>, [choose, status?.planId]);
  const selected = selection?.key === key && selection.owner === auth.currentUser && admissible ? selection : null;
  const claimId = claim?.key === key && claim.owner === auth.currentUser ? claim.claimId : null;
  if (!native.focused || !admissible) return null;
  return <View style={styles.section}>
    {context.focused ? <><Text accessibilityRole="header" style={styles.title}>Ma réclamation de continuité</Text>
      {status ? <BusinessCessationStatus status={status} /> : <Text style={styles.caption}>Le plan et le contrôle restent à relire. Aucune disponibilité du contact ou réserve de fonds n’est supposée.</Text>}
      {!status?.planId ? <Text style={styles.caption}>Aucun plan natif n’est indiqué par le contrôle dans cette lecture. Votre dossier d’interruption d’accès reste accessible ; aucune réclamation n’est inventée.</Text> : null}
      <Text style={styles.caption}>Choisissez un de vos objets natifs. Le serveur vérifiera à nouveau votre droit sur cette seule obligation ; sa présence ne prouve pas une somme due ou un règlement.</Text>
      {lanes.map(value => <Button key={value.lane} variant="secondary" onPress={() => {try {if (auth.currentUser !== owner) return; context.capture(); setLane(value.lane); setSelection(null);} catch { /* No old-account selection. */ }}}>{value.label}</Button>)}
      <View style={styles.list}><FlashList data={items} renderItem={renderItem} keyExtractor={rowKey} ListEmptyComponent={<Text style={styles.caption}>{list.isError ? 'Cette catégorie ne peut pas être qualifiée actuellement.' : 'Aucune obligation sur les pages lues de cette catégorie.'}</Text>} /></View>
      {list.hasNextPage ? <Button variant="secondary" disabled={list.isFetchingNextPage} onPress={() => {try {if (auth.currentUser !== owner) return; context.capture(); void list.fetchNextPage();} catch { /* Same native lane only. */ }}}>Lire les obligations suivantes de cette catégorie</Button> : null}
    </> : null}
    {selected ? <BusinessCessationAction uid={uid} access="owner" sourceKey={`${key}:${selected.nonce}`} command={{action: 'link_claim', planId: selected.planId, supportRequestId: request.id, reference: selected.item.reference}} onRecorded={receipt => {if (auth.currentUser !== selected.owner) return; setSelection(null); if (receipt.claimId) setClaim({key, owner: selected.owner, claimId: receipt.claimId});}} /> : null}
    {claimId ? <BusinessCessationClaimPanel uid={uid} claimId={claimId} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, row: {gap: spacing.xs, paddingVertical: spacing.sm}, list: {minHeight: spacing.xl * 4, height: spacing.xl * 8}});
