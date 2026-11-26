import { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransportReviewService } from '@/services/transportReviewService';
import { observeAdminReturnToSenderResumeSource } from '@/services/adminFinancialService';
import type { TransportReviewListItem } from '@/types/transportReview';
import type { AdminReturnToSenderFinancialResume } from '@/types/adminReturnToSenderFinancial';
const itemKey = (item: TransportReviewListItem) => item.reviewId;
export function AdminTransportFinancialEntry({uid, disabled, blockedTransactions, onPreview}: {uid: string; disabled: boolean; blockedTransactions: string[];
  onPreview: (transactionId: string, reviewId: string, disputeId: string, resume?: AdminReturnToSenderFinancialResume) => void}) {
  const context = useShippingPurchaseContext('admin-transport-financial-entry', uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision]);
  const [frame, setFrame] = useState<{key: string; input: string; read: {id: string; nonce: string} | null} | null>(null), current = frame?.key === key ? frame : {key, input: '', read: null};
  const read = useQuery({queryKey: ['admin-transport-financial-entry', key, current.read], enabled: context.focused && !disabled && !!current.read, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {const op = context.capture(), transactionId = current.read?.id; if (!transactionId) throw new Error('Commande requise.'); const assertCurrent = () => context.assertCurrent(op);
      const [cases, resumeSource] = await Promise.all([TransportReviewService.list(uid, transactionId, 'admin', null, assertCurrent), observeAdminReturnToSenderResumeSource(uid, transactionId, assertCurrent, 'transport_review')]); assertCurrent();
      if (cases.source.reference.orderRevision !== resumeSource.sourceRevision) throw new Error('Sources modifiées.'); return {cases, resumeSource};}});
  const data = context.focused && !disabled && !read.isFetching && !read.isError && current.read ? read.data : null;
  const resume = data?.resumeSource.qualification === 'qualified' && !data.resumeSource.financial?.success ? data.resumeSource.resume : null;
  const refundPresent = !!data?.cases.source.otherGuards.includes('refund');
  const selectable = !!data && !data.cases.cursor && !blockedTransactions.includes(data.cases.transactionId) && (!refundPresent || !!resume) && !data.resumeSource.financial?.success;
  const renderItem = useCallback(({item}: ListRenderItemInfo<TransportReviewListItem>) => <View style={styles.block}>
    <Text selectable style={styles.caption}>Dossier : {item.reviewId}</Text>
    <Text style={styles.body}>{item.qualification === 'native_review' ? item.kind === 'delivery_correction' ? 'Correction de livraison' : item.kind === 'carrier_exception' ? 'Exception du transporteur' : 'Déclaration participante' : 'Qualification historique inconnue'}.</Text>
    <Button variant="secondary" disabled={!selectable || item.qualification !== 'native_review' || !['delivery_correction', 'carrier_exception'].includes(item.kind) || item.entries.length === 0 || !['open', 'financial_review_required'].includes(item.state)}
      onPress={() => {if (!data || !selectable || item.qualification !== 'native_review' || item.origin.kind !== 'system' || !('provider' in item.origin) || item.origin.provider !== 'shipengine') return; const disputeId = item.kind === 'delivery_correction' ? item.reviewId : item.origin.disputeId;
        if (!disputeId) return; try {const op = context.capture(); context.assertCurrent(op); onPreview(data.cases.transactionId, item.reviewId, disputeId, resume ?? undefined);} catch { /* Stale operator context cannot create a financial preview. */ }}}>
      {resume ? 'Examiner la reprise de l’intention d’origine' : 'Examiner une instruction financière distincte'}
    </Button>
  </View>, [selectable, data, context, onPreview, resume]);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Examen financier d’une enquête de transport</Text>
    <Text style={styles.caption}>La décision documentaire de l’enquête n’autorise aucun remboursement. Saisissez la commande et choisissez explicitement le dossier natif avant l’aperçu financier.</Text>
    <TextInput value={current.input} onChangeText={input => setFrame({key, input, read: null})} maxLength={200} autoCapitalize="none" editable={!disabled}
      placeholder="Référence exacte de la commande" placeholderTextColor={colors.muted} style={styles.input} />
    <Button variant="secondary" disabled={disabled || !context.focused || read.isFetching || !/^[A-Za-z0-9_-]{1,200}$/.test(current.input.trim())}
      onPress={() => setFrame({...current, read: {id: current.input.trim(), nonce: randomUUID()}})}>Lire les enquêtes de cette commande</Button>
    {read.isError ? <Text accessibilityRole="alert" style={styles.caption}>Cette lecture ne peut pas être qualifiée. Relisez les sources avant toute nouvelle instruction.</Text> : null}
    {data ? <><Text style={styles.caption}>{data.cases.cursor ? 'La liste dépasse la limite d’un aperçu financier : une instruction n’est pas proposée.' : 'La lecture native est limitée aux dossiers présents, sans certifier l’historique physique du transport.'}</Text>
      {refundPresent ? <Text style={styles.caption}>Une intention financière existe. Ses références et son résultat d’origine restent prioritaires ; aucune nouvelle intention n’est déduite de cette lecture.</Text> : null}
      {resume ? <Text selectable style={styles.caption}>Même intention : {resume.refundIntentId} · même tentative : {resume.refundAttemptId}. Montants, clé et réservation restent ceux d’origine.</Text> : null}
      {data.resumeSource.financial?.success ? <Text style={styles.caption}>Le règlement d’origine est enregistré. Aucune nouvelle approbation financière n’est proposée ; le crédit bancaire reste non certifié.</Text> : null}
      <View style={styles.list}><FlashList data={data.cases.items} keyExtractor={itemKey} renderItem={renderItem} nestedScrollEnabled /></View>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, block: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 9}, input: {...typography.bodySmall, color: colors.foreground, padding: spacing.md, borderWidth: 1, borderColor: colors.border}});
