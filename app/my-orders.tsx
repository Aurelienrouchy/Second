/**
 * My Orders Screen — Buyer-side purchase list
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 */

import { useShallow } from 'zustand/react/shallow';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useRequireAuth } from '@/hooks/useAuthRequired';
import { ArticlesService } from '@/services/articlesService';
import { hasUserReviewedTransaction } from '@/features/reviews/services/reviewService';
import { TransactionService } from '@/services/transactionService';
import { Article, Transaction, TransactionStatus } from '@/types';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { APP_LOCALE } from '@/constants/locale';
import { colors, components, radius, sizing, spacing, typography } from '@/constants/theme';
import { Button, ScreenHeader } from '@/components/ui';
import { getStatusLabel } from '@/features/orders/lib/transactionStatusMeta';
import { queryKeys } from '@/lib/queryKeys';
import { track } from '@/lib/analytics';
import { hasBankObligation, hasUnsettledRefund } from '@/utils/refundPresentation';
import { getTransactionFinancialLabel } from '@/utils/transactionFinancialLabel';
import { formatPrice } from '@/utils/formatPrice';
import { getTransactionArticlePresentation } from '@/utils/transactionArticlePresentation';
import { assertTradeSessionCurrent, isTradeProfileCurrent } from '@/services/tradeOperation';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { CancelledError, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { SafeAreaView } from 'react-native-safe-area-context';

interface OrderItem {
  transaction: Transaction;
  article: Article | null;
  hasReview: boolean;
}
const orderKey = (item: OrderItem) => item.transaction.id;

/**
 * Terminal statuses eligible for a review. Mirrors the backend gate in
 * `functions/src/callable/reviews.ts` (`terminalStatuses`): a shipping order is
 * reviewable once `delivered` and stays reviewable after it flips to
 * `completed` (J+7 dispute window), and a meetup order once `meetup_completed`.
 */
function isReviewableStatus(status: TransactionStatus): boolean {
  return (
    status === 'delivered' ||
    status === 'completed' ||
    status === 'meetup_completed'
  );
}

function OrderCard({
  item,
  onPress,
  onReview,
}: {
  item: OrderItem;
  onPress: () => void;
  onReview?: () => void;
}) {
  const { transaction, article, hasReview } = item;
  const itemTerms = getTransactionArticlePresentation(transaction, article);
  const firstImage = itemTerms.images[0];
  const stepLabel = getTransactionFinancialLabel(transaction, 'buyer') ?? getStatusLabel(transaction.status, 'buyer');
  const total = transaction.totalAmount;
  const totalLabel = typeof total === 'number' && Number.isFinite(total) && total > 0
    ? formatPrice(total) : 'Montant à vérifier';
  const dateLabel = transaction.createdAtKnown === false ? 'Date indisponible' : transaction.createdAt.toLocaleDateString(APP_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const isReviewable = !!onReview && isReviewableStatus(transaction.status) && !hasReview && !hasUnsettledRefund(transaction) && !hasBankObligation(transaction);
  const isReviewed = isReviewableStatus(transaction.status) && hasReview;

  return (
    <View style={styles.card} accessible={false}>
      <View style={styles.cardRow} accessible={false}>
        <Pressable
          accessible
          style={styles.cardMain}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Ouvrir ${itemTerms.title}, ${totalLabel}, ${stepLabel}, ${dateLabel}`}
        >
          <Image
            source={firstImage?.url ? {uri: firstImage.url} : undefined}
            style={styles.cardImage}
            contentFit="cover"
            transition={200}
            placeholder={firstImage?.blurhash ? {blurhash: firstImage.blurhash} : undefined}
            cachePolicy="memory-disk"
          />
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={2}>{itemTerms.title}</Text>
            <Text style={styles.cardPrice}>{totalLabel}</Text>
            <Text style={styles.cardStep}>{stepLabel}</Text>
            <Text style={styles.cardDate}>{dateLabel}</Text>
            {isReviewed ? <View style={styles.reviewDoneRow}>
              <Ionicons name="checkmark-circle" size={sizing.iconSM} color={colors.success} />
              <Text style={styles.reviewDoneText}>Avis laissé</Text>
            </View> : null}
          </View>
          <Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted} />
        </Pressable>
      </View>
      {isReviewable ? (
        <Pressable
          accessible
          style={styles.reviewButton}
          accessibilityRole="button"
          accessibilityLabel={`Laisser un avis pour ${itemTerms.title}`}
          onPress={(event) => {
            event.stopPropagation();
            onReview?.();
          }}
          hitSlop={spacing.xs}
        >
          <Ionicons name="star-outline" size={sizing.iconSM} color={colors.rust} />
          <Text style={styles.reviewButtonText}>Laisser un avis</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function MyOrdersScreen() {
  const {uid, normalUser, generation} = useAuthStore(useShallow(state => ({uid: state.authenticatedUid, normalUser: state.user, generation: getAuthSessionGeneration()})));
  const context = useShippingPurchaseContext('historical-orders', uid);
  const { showAuthSheet } = useRequireAuth();
  const router = useRouter();
  // Deep-link target from order_* / funds_released push notifications
  // (functions/src/utils/notifications.ts builds `/my-orders?transactionId=…`).
  const { transactionId: deepLinkTransactionId } = useLocalSearchParams<{
    transactionId?: string;
  }>();
  const handledDeepLinkRef = useRef<string | null>(null);

  const {
    data: orders = [],
    isLoading: loading,
    isError,
    isRefetching: refreshing,
    refetch,
  } = useQuery<OrderItem[]>({
    queryKey: [...queryKeys.orders.list(uid ?? ''), generation, context.focusRevision],
    queryFn: async ({signal}) => {
      try {
        if (signal.aborted) throw new CancelledError({revert: true});
        const operation = context.capture();
        const session = operation.session;
        const allTx = await TransactionService.getUserTransactions(session.uid);
        assertTradeSessionCurrent(session); context.assertCurrent(operation);
        const purchases = allTx.filter(t => t.buyerId === session.uid);

        // Batch the article reads (one `in` query per 30 ids) instead of an N+1
        // of getArticleById (F130).
        const articlesById = await ArticlesService.getArticlesByIds(
          purchases.filter(t => !t.articleSnapshot).map(t => t.articleId),
        ).catch(() => new Map<string, Article>());
        assertTradeSessionCurrent(session); context.assertCurrent(operation);

        // Review checks only run for reviewable (terminal) statuses — a small
        // subset, so this is not the N+1 driver.
        const reviewChecks = await Promise.all(
          purchases.map((tx) => {
            if (!isReviewableStatus(tx.status)) return Promise.resolve(false);
            return hasUserReviewedTransaction(session.uid, tx.id);
          }),
        );
        assertTradeSessionCurrent(session); context.assertCurrent(operation);

        return purchases.map((tx, i) => ({
          transaction: tx,
          article: articlesById.get(tx.articleId) ?? null,
          hasReview: reviewChecks[i],
        }));
      } catch (error) {
        if (signal.aborted || error && typeof error === 'object' && 'code' in error && error.code === 'client/stale-operation') {
          throw new CancelledError({revert: true});
        }
        throw error;
      }
    },
    enabled: !!uid && context.focused,
    staleTime: 0, gcTime: 0, retry: false,
  });

  // The committed focus/generation key starts and refreshes this read. A
  // manual focus refetch would bypass enabled before capture is admissible.
  const targetedOrder = useQuery({
    queryKey: ['orders', uid ?? '', 'deep-link', deepLinkTransactionId ?? '', generation, context.focusRevision],
    enabled: !!uid && context.focused && !!deepLinkTransactionId,
    queryFn: async ({signal}) => {
      try {
        if (signal.aborted) throw new CancelledError({revert: true});
        const operation = context.capture();
        const session = operation.session;
        const transaction = await TransactionService.getTransaction(deepLinkTransactionId!, {expectedUid: session.uid, assertCurrent: () => context.assertCurrent(operation)});
        assertTradeSessionCurrent(session); context.assertCurrent(operation);
        if (!transaction || transaction.buyerId !== session.uid) throw new Error('Commande inaccessible.');
        return transaction;
      } catch (error) {
        if (signal.aborted || error && typeof error === 'object' && 'code' in error && error.code === 'client/stale-operation') {
          throw new CancelledError({revert: true});
        }
        throw error;
      }
    }, staleTime: 30_000,
  });

  const handleOrderPress = useCallback(
    (orderItem: OrderItem, fromDeepLink = false) => {
      const { transaction } = orderItem;
      if (!uid || transaction.buyerId !== uid) return;
      try { context.capture(); } catch { return; }
      track('order_card_tapped', {
        role: 'buyer',
        transaction_id: transaction.id,
        status: transaction.status,
        delivery_type: transaction.deliveryType,
        destination: 'order',
        from_deep_link: fromDeepLink,
      });
      router.push({ pathname: '/orders/[id]', params: { id: transaction.id } });
    },
    [router, uid, context.frame, context.focusRevision],
  );

  // Open the exact private order from a notification, including orders whose
  // listing or conversation is unavailable.
  useEffect(() => {
    if (!deepLinkTransactionId || loading || !context.focused || targetedOrder.isFetching) return;
    const deepLinkKey = JSON.stringify([uid, generation, deepLinkTransactionId]);
    if (handledDeepLinkRef.current === deepLinkKey) return;

    const target = targetedOrder.data ? {transaction: targetedOrder.data, article: null, hasReview: false} : orders.find(
      (o) => o.transaction.id === deepLinkTransactionId,
    );
    if (!target) return;

    handledDeepLinkRef.current = deepLinkKey;
    handleOrderPress(target, true);
  }, [deepLinkTransactionId, loading, orders, targetedOrder.data, targetedOrder.isFetching, handleOrderPress, uid, generation, context.focused]);

  const handleReview = useCallback(
    (transactionId: string) => {
      try {const operation = context.capture(); if (!isTradeProfileCurrent(operation.session)) return;} catch {return;}
      router.push(`/review/${transactionId}`);
    },
    [router, normalUser?.id, context.frame, context.focusRevision],
  );
  const renderOrder = useCallback(({ item }: { item: OrderItem }) => <OrderCard
    item={item} onPress={() => handleOrderPress(item)} onReview={normalUser?.id === uid ? () => handleReview(item.transaction.id) : undefined}
  />, [handleOrderPress, handleReview, normalUser?.id, uid]);

  if (!uid) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mes commandes" onBack={() => router.back()} />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Connexion requise</Text>
          <Text style={styles.emptyText}>
            Connectez-vous pour voir vos commandes
          </Text>
          <Button onPress={() => showAuthSheet(AUTH_MESSAGES.default)}>Se connecter</Button>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScreenHeader title="Mes commandes" onBack={() => router.back()} />

      {loading ? (
        <View style={styles.loadingContent}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={[styles.card, styles.cardRow]}>
              <Skeleton
                width={spacing['4xl']}
                height={spacing['4xl'] + spacing.lg}
                borderRadius={radius.none}
              />
              <View style={[styles.cardInfo, styles.skeletonInfo]}>
                <Skeleton width="70%" height={14} />
                <Skeleton width="35%" height={16} />
                <View style={styles.skeletonRow}>
                  <Skeleton width={8} height={8} borderRadius={4} />
                  <Skeleton width="50%" height={11} />
                </View>
                <Skeleton width="30%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : isError && orders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cloud-offline-outline" size={sizing.iconLG} color={colors.muted} />
          <Text style={styles.emptyTitle}>Consultation indisponible</Text>
          <Text style={styles.emptyText}>Impossible de charger vos commandes pour le moment.</Text>
          <Button variant="secondary" onPress={() => {
            try {context.capture();} catch {return;}
            void refetch();
          }}>Réessayer</Button>
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cube-outline" size={64} color={colors.muted} />
          <Text style={styles.emptyTitle}>Aucune commande</Text>
          <Text style={styles.emptyText}>
            Vos achats apparaîtront ici une fois que vous aurez passé votre première
            commande.
          </Text>
        </View>
      ) : (
        <FlashList
          data={orders}
          keyExtractor={orderKey}
          renderItem={renderOrder}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={isError ? (
            <View style={styles.refreshError}>
              <Text style={styles.emptyText}>Actualisation indisponible.</Text>
              <Button variant="ghost" size="small" onPress={() => {
                try {context.capture();} catch {return;}
                void refetch();
              }}>Réessayer</Button>
            </View>
          ) : null}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                try {context.capture();} catch {return;}
                track('list_refreshed', { screen: 'my_orders', items_count: orders.length });
                refetch();
              }}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  listContent: {paddingVertical: spacing.sm},
  loadingContent: {paddingVertical: spacing.sm},
  skeletonInfo: {gap: spacing.sm},
  skeletonRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  card: {paddingHorizontal: spacing.md, paddingVertical: spacing.lg, gap: spacing.xs},
  cardRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  cardMain: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  cardImage: {
    width: spacing['4xl'],
    height: spacing['4xl'] + spacing.lg,
    borderRadius: radius.none,
    backgroundColor: colors.borderLight,
  },
  cardInfo: {flex: 1, minWidth: 0, gap: spacing.xs},
  cardTitle: {...typography.label, color: colors.foreground},
  cardPrice: {...typography.h2, color: colors.foreground},
  cardStep: {...typography.bodySmall, color: colors.primaryDark},
  cardDate: {...typography.caption, color: colors.foregroundSecondary},
  reviewButton: {
    ...components.button.container,
    ...components.button.small,
    ...components.button.ghost,
    alignSelf: 'flex-start',
    justifyContent: 'flex-start',
    paddingHorizontal: 0,
    marginLeft: spacing['4xl'] + spacing.md,
  },
  reviewButtonText: {...components.button.smallLabel, ...components.button.ghostLabel},
  reviewDoneRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  reviewDoneText: {...typography.caption, color: colors.foregroundSecondary},
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  refreshError: {padding: spacing.md, alignItems: 'center', gap: spacing.xs},
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {...typography.h2, color: colors.foreground, textAlign: 'center'},
  emptyText: {...typography.body, color: colors.foregroundSecondary, textAlign: 'center'},
});
