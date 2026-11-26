import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui';
import { LateCommercialLinkSummary } from '@/components/LateCommercialLinkSummary';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { LateCommercialRecourseService } from '@/services/lateCommercialRecourseService';
import { productReviewEqual } from '@/services/productReviewService';
import type { ProductReviewContribution, ProductReviewContributionEntry } from '@/types/productReview';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import type { LateCommercialTopic } from '@/types/lateCommercialRecourse';

const itemKey = (item: ProductReviewContribution) => item.contributionId;
export function LateCommercialOwnerEntry({uid, transactionId, contributions, sourceHash, enabled, nativeAdmission, supportRequestId}: {
  uid: string; transactionId: string; contributions: ProductReviewContributionEntry[]; sourceHash: string | null; enabled: boolean;
  nativeAdmission: ProductPhysicalDocumentaryAdmission | null; supportRequestId?: string;
}) {
  const router = useRouter(), context = useLabelLifecycleContext(`late-commercial-owner:${transactionId}`, uid);
  const key = JSON.stringify([uid, transactionId, sourceHash, nativeAdmission?.key, enabled, context.focusRevision, supportRequestId]);
  const [selection, setSelection] = useState<{key: string; contribution: ProductReviewContribution} | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const epoch = useRef(0), live = useRef(key), lock = useRef<symbol | null>(null);
  useLayoutEffect(() => {live.current = key; epoch.current++; return () => {live.current = '';};}, [key]);
  const selected = selection?.key === key ? selection.contribution : null;
  const candidates = enabled && context.focused && nativeAdmission ? contributions.flatMap(entry => entry.qualification === 'native_actor_contribution' &&
    entry.contribution.actorId === uid && entry.contribution.actorRole === 'buyer' && ['authenticity', 'nonconformity'].includes(entry.contribution.topic) ? [entry.contribution] : []) : [];
  const source = useQuery({queryKey: ['late-commercial-link-source', key, selected?.contributionId], enabled: !!selected && enabled && !!nativeAdmission && context.focused,
    staleTime: 0, gcTime: 0, retry: false, queryFn: async () => {
      const op = context.capture(); if (!selected || !nativeAdmission) throw new Error('Choisissez un constat natif après lecture du corpus.');
      const assertCurrent = () => {context.assertCurrent(op); nativeAdmission.assertCurrent();};
      const result = await LateCommercialRecourseService.source(uid, transactionId, selected.contributionId, selected.topic as LateCommercialTopic,
        assertCurrent, nativeAdmission.materialCapability !== undefined, nativeAdmission.parcelCapability !== undefined); assertCurrent();
      if (result.link.sourceHash !== sourceHash) throw new Error('Les sources du constat ont changé.');
      return result;
    }});
  const link = selected && source.isSuccess && !source.isFetching && !source.isError ? source.data.link : null;
  const openSupport = async () => {
    if (!link || !nativeAdmission || !enabled || lock.current) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(), capturedEpoch = epoch.current; lock.current = token; setBusy(key); setNotice(null);
    const assertCurrent = () => {context.assertCurrent(op); nativeAdmission.assertCurrent(); if (live.current !== key || epoch.current !== capturedEpoch) throw new Error('Votre choix a changé. Relisez le constat.');};
    try {
      assertCurrent(); await nativeAdmission.revalidate(); assertCurrent();
      const fresh = await LateCommercialRecourseService.source(uid, transactionId, link.contributionId, link.topic, assertCurrent,
        link.materialCapability !== undefined, link.parcelCapability !== undefined); assertCurrent();
      if (!productReviewEqual(fresh.link, link)) throw new Error('La référence actuelle a changé. Sélectionnez à nouveau le constat.');
      assertCurrent();
      router.push((supportRequestId ? {pathname: '/settings/support/[id]', params: {id: supportRequestId, lateCommercial: JSON.stringify(link)}} :
        {pathname: '/settings/support', params: {kind: 'commercial_late', transactionId, lateCommercial: JSON.stringify(link)}}) as never);
    } catch (error) {try {assertCurrent(); setNotice({key, text: error instanceof Error ? error.message : 'Le constat doit être relu.'});} catch { /* Old selection grants no navigation. */ }}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; if (context.isCurrent(op)) setBusy(null);}}
  };
  const renderItem = useCallback(({item}: ListRenderItemInfo<ProductReviewContribution>) => <View style={styles.section}>
    <Text selectable style={styles.body}>{item.statement}</Text>
    <Button variant="secondary" disabled={busy === key} onPress={() => {
      try {context.capture(); nativeAdmission?.assertCurrent(); epoch.current++; setSelection({key, contribution: item}); setNotice(null);} catch { /* Stale corpus. */ }
    }}>Choisir ce constat pour une demande tardive</Button>
  </View>, [busy, key, context, nativeAdmission]);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Demande commerciale tardive</Text>
    <Text style={styles.caption}>Vous pouvez demander un examen après la fenêtre commerciale ou après la libération des fonds. Le ticket existant, l’examen documentaire et toute décision financière restent distincts ; aucun argent déjà versé n’est repris par cette démarche.</Text>
    {candidates.length ? <View style={styles.list}><FlashList data={candidates} keyExtractor={itemKey} renderItem={renderItem} nestedScrollEnabled /></View> :
      <Text style={styles.caption}>Consignez votre constat acheteur d’authenticité ou de différence matérielle, puis relisez le corpus pour le sélectionner ici.</Text>}
    {link ? <><LateCommercialLinkSummary link={link} /><Button disabled={busy === key} onPress={() => {void openSupport();}}>
      {supportRequestId ? 'Joindre ce constat à ma demande existante' : 'Préparer la demande avec ce constat'}</Button></> : null}
    {source.isError ? <Text style={styles.caption}>La référence actuelle ne peut pas être qualifiée. Relisez le dossier et choisissez explicitement le constat.</Text> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 8}});
