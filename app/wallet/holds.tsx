import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { Button, ScreenHeader, Text } from '@/components/ui';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getSellerHoldReviews } from '@/services/holdReviewService';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import type { HoldReviewCursor, HoldReviewReason, HoldReviewRow } from '@/types/holdReview';
import { formatCents } from '@/utils/formatPrice';
import {readScopedQuery} from '@/utils/readScopedQuery';

const REASON_LABELS: Record<HoldReviewReason, string> = {
  commercial_dispute: 'Litige commercial',
  delivery_correction: 'Correction des données de livraison',
  tracking_reconciliation: 'Suivi de livraison à vérifier',
  purchase_policy_reconciliation: 'Politique de la commande à vérifier',
  return_in_progress: 'Retour en cours d’examen',
  bank_dispute: 'Dossier bancaire',
  refund_reconciliation: 'Remboursement à vérifier',
  label_reconciliation: 'Étiquette de transport à vérifier',
  moderation_review: 'Examen de modération',
  financial_source_reconciliation: 'Montants à vérifier',
  dispute_date_unqualified: 'Date du litige à vérifier',
};
type ReadRow = HoldReviewRow & {readAt: string};
const keyExtractor = (row: ReadRow) => row.transactionId;
const dateLabel = (value: string | null) => value === null ? 'Inconnue' : new Date(value).toLocaleString(APP_LOCALE, {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export default function WalletHoldsScreen() {
  const router = useRouter();
  const {uid, generation} = useAuthStore(useShallow(state => ({uid: state.authenticatedUid, generation: getAuthSessionGeneration()})));
  const context = useShippingPurchaseContext('wallet-hold-reviews:seller-sales', uid);
  const reviews = useInfiniteQuery({
    queryKey: ['seller-hold-reviews', uid, generation, context.focusRevision],
    initialPageParam: null as HoldReviewCursor | null, enabled: !!uid && context.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({pageParam, signal}) => readScopedQuery(signal, () => {
      const operation = context.capture();
      return () => context.assertCurrent(operation);
    }, current => getSellerHoldReviews(uid!, pageParam, current)),
    getNextPageParam: page => page.coverage.hasMore ? page.nextCursor : undefined,
  });
  // A later page may be empty after ownership changed. Its native cursor still
  // advances past every inspected sale, rather than the last visible row.
  const chainQualified = reviews.data?.pages.every((page, index) => page.ownerId === uid &&
    JSON.stringify(reviews.data?.pageParams[index]) === JSON.stringify(index === 0 ? null : reviews.data?.pages[index - 1].nextCursor)) ?? false;
  const visible = !!uid && context.focused && reviews.isSuccess && !reviews.isFetching && !reviews.isError && chainQualified;
  const pages = visible ? reviews.data!.pages : [];
  const rows: ReadRow[] = pages.flatMap(page => page.rows.map(row => ({...row, readAt: page.readAt})));
  const navigate = useCallback((row: HoldReviewRow, target: 'order' | 'support') => {
    if (!visible) return;
    try {
      context.capture();
      if (target === 'order') router.push({pathname: '/orders/[id]', params: {id: row.transactionId}});
      else router.push({pathname: '/settings/support', params: {kind: 'commercial_late', transactionId: row.transactionId}} as never);
    } catch { /* The old account or page cannot open a dossier for the next session. */ }
  }, [context, router, visible]);
  const renderItem = useCallback(({item}: {item: ReadRow}) => {
    const review = item.review;
    const reason = review && Object.prototype.hasOwnProperty.call(REASON_LABELS, review.reason) ? REASON_LABELS[review.reason] : 'Examen à vérifier';
    return <View style={styles.entry}>
      {review ? <>
        <Text style={styles.title}>{reason}</Text>
        <Text style={styles.meta}>Dernier suivi : {dateLabel(review.observedAt)}</Text>
        {review.currentSourceMatches ? <>
          <Text style={styles.amount}>{review.amountCents === null ? 'Montant à vérifier' : `Montant concerné : ${formatCents(review.amountCents)} CAD`}</Text>
          <Text style={styles.meta}>Début de la retenue : {dateLabel(review.startedAt)}</Text>
          <Text style={styles.meta}>Échéance initiale : {dateLabel(review.initialDeadlineAt)}</Text>
          {review.operationalThresholdExceeded === true ? <Text style={styles.review}>Le délai de suivi est dépassé. Contactez l’assistance.</Text> : null}
          {review.operationalAgingThresholdMs !== null && review.operationalThresholdExceeded === null ? <Text style={styles.review}>La date de début reste à vérifier.</Text> : null}
        </> : <Text style={styles.review}>La vente a été modifiée. Actualisez son suivi pour connaître sa situation actuelle.</Text>}
        <Text style={styles.meta}>La date de résolution reste à confirmer.</Text>
      </> : <Text style={styles.review}>{item.reviewQualification === 'absent'
        ? 'Aucun suivi disponible ici. Consultez la commande pour connaître son état.'
        : 'Le montant et les dates de cette retenue sont à vérifier.'}</Text>}
      <Button variant="secondary" disabled={!visible} onPress={() => navigate(item, 'order')}>Voir la commande</Button>
      <Button variant="ghost" disabled={!visible} onPress={() => navigate(item, 'support')}>Contacter l’assistance</Button>
    </View>;
  }, [navigate, visible]);
  const continueReading = () => {
    if (!visible || !reviews.hasNextPage) return;
    try {context.capture(); void reviews.fetchNextPage();} catch { /* Ignore a stale page. */ }
  };
  const refresh = () => {
    if (!uid || !context.focused || reviews.isFetching) return;
    try {context.capture(); void reviews.refetch();} catch { /* Ignore a stale session. */ }
  };
  return <View style={styles.container}>
    <ScreenHeader title="Suivi des retenues" onBack={() => router.back()} />
    <FlashList data={rows} keyExtractor={keyExtractor} renderItem={renderItem} contentContainerStyle={styles.list}
      ListHeaderComponent={<View style={styles.header}>
        {uid ? <Button variant="secondary" disabled={!context.focused || reviews.isFetching} onPress={refresh}>Actualiser</Button> : null}
      </View>}
      ListEmptyComponent={<View style={styles.header}>
        <Text accessibilityRole={reviews.isError || reviews.isSuccess && !chainQualified ? 'alert' : undefined} style={styles.message}>
          {!uid ? 'Connectez-vous pour consulter vos ventes.' : !context.focused ? 'Revenez sur cette page pour actualiser le suivi.'
            : reviews.isPending || reviews.isFetching ? 'Chargement du suivi…'
            : reviews.isError || !chainQualified ? 'Impossible de charger le suivi. Réessayez.'
            : reviews.hasNextPage ? 'Aucun suivi sur cette page. Chargez la suite des ventes.'
            : 'Aucun suivi disponible ici. Consultez vos commandes pour vérifier leurs montants retenus.'}
        </Text>
        {!uid ? <Button variant="secondary" onPress={() => router.push('/(tabs)/profile')}>Accéder à mon compte</Button> : null}
      </View>}
      ListFooterComponent={<View style={styles.footer}>
        {visible && reviews.hasNextPage ? <Button variant="secondary" onPress={continueReading}>Charger la suite</Button> : null}
      </View>} />
  </View>;
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  list: {padding: spacing.lg},
  header: {gap: spacing.md, marginBottom: spacing.lg},
  entry: {gap: spacing.sm, paddingVertical: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  title: {...typography.label, color: colors.foreground},
  amount: {...typography.titleHeader, color: colors.foreground},
  meta: {...typography.bodySmall, color: colors.foregroundSecondary},
  review: {...typography.bodySmall, color: colors.warning},
  message: {...typography.body, color: colors.foreground, paddingVertical: spacing.md},
  footer: {gap: spacing.md, paddingVertical: spacing.lg},
});
