/**
 * My Sales Screen -- Seller-side sales list
 * Design System: Editorial Luxe -- Cream, Charcoal, Rust, Sage
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
import {OrderOptionsList} from '@/features/orders';
import { getStatusLabel } from '@/features/orders/lib/transactionStatusMeta';
import { queryKeys } from '@/lib/queryKeys';
import { track } from '@/lib/analytics';
import { getCallableErrorCode } from '@/utils/callableError';
import { getFinancialErrorMessage, hasBankObligation, hasUnsettledRefund, isRefundConfirmed, refundResultPresentation } from '@/utils/refundPresentation';
import { getTransactionFinancialLabel } from '@/utils/transactionFinancialLabel';
import { formatPrice } from '@/utils/formatPrice';
import { getTransactionArticlePresentation } from '@/utils/transactionArticlePresentation';
import { assertTradeSessionCurrent, isTradeProfileCurrent } from '@/services/tradeOperation';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { CancelledError, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

interface SaleItem {
  transaction: Transaction;
  article: Article | null;
  hasReview: boolean;
}
const saleKey = (item: SaleItem) => item.transaction.id;

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

/**
 * F74 — pre-ship statuses the seller can still cancel (before the first carrier
 * scan flips the tx to `shipped`). Mirrors SELLER_CANCELLABLE in
 * `functions/src/callable/payments.ts`.
 */
function isSellerCancellableStatus(status: TransactionStatus): boolean {
  return status === 'paid' || status === 'label_created';
}

function SaleCard({
  item,
  onPress,
  onReview,
  onOptions,
  isCancelling,
}: {
  item: SaleItem;
  onPress: () => void;
  onReview?: () => void;
  onOptions?: () => void;
  isCancelling?: boolean;
}) {
  const { transaction, article, hasReview } = item;
  const itemTerms = getTransactionArticlePresentation(transaction, article);
  const firstImage = itemTerms.images[0];
  const stepLabel = getTransactionFinancialLabel(transaction, 'seller') ?? getStatusLabel(transaction.status, 'seller');
  // The accepted item amount can differ from both the listing price and the buyer total.
  // Missing or malformed historical amounts are never replaced with zero or today's price.
  const amount = transaction.amount;
  const amountLabel = typeof amount === 'number' && Number.isFinite(amount) && amount > 0
    ? formatPrice(amount) : 'Montant à vérifier';
  const dateLabel = transaction.createdAtKnown === false ? 'Date indisponible' : transaction.createdAt.toLocaleDateString(APP_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const isReviewable = !!onReview && isReviewableStatus(transaction.status) && !hasReview && !hasUnsettledRefund(transaction) && !hasBankObligation(transaction);
  const isReviewed = isReviewableStatus(transaction.status) && hasReview;
  const isCancellable = !!onOptions && isSellerCancellableStatus(transaction.status) && !hasUnsettledRefund(transaction) && !hasBankObligation(transaction);

  return (
    <View style={styles.card} accessible={false}>
      <View style={styles.cardRow} accessible={false}>
        <Pressable
          accessible
          style={styles.cardMain}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Ouvrir ${itemTerms.title}, ${amountLabel}, ${stepLabel}, ${dateLabel}`}
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
            <Text style={styles.cardPrice}>{amountLabel}</Text>
            <Text style={styles.cardStep}>{stepLabel}</Text>
            <Text style={styles.cardDate}>{dateLabel}</Text>
            {isReviewed ? <View style={styles.reviewDoneRow}>
              <Ionicons name="checkmark-circle" size={sizing.iconSM} color={colors.success} />
              <Text style={styles.reviewDoneText}>Avis laissé</Text>
            </View> : null}
          </View>
          {!isCancellable ? <Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted} /> : null}
        </Pressable>
        {isCancellable ? (
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Options de la vente ${itemTerms.title}`}
            accessibilityState={{disabled: !!isCancelling, busy: !!isCancelling}}
            disabled={isCancelling}
            style={styles.optionsButton}
            onPress={(event) => {
              event.stopPropagation();
              onOptions?.();
            }}
          >
            <Ionicons name="ellipsis-horizontal" size={sizing.iconMD} color={colors.foregroundSecondary} />
          </Pressable>
        ) : null}
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

export default function MySalesScreen() {
  const {uid, normalUser, identity: user, generation} = useAuthStore(useShallow(state => ({uid: state.authenticatedUid, normalUser: state.user, identity: state.identityUser, generation: getAuthSessionGeneration()})));
  const context = useShippingPurchaseContext('historical-sales', uid);
  const { showAuthSheet } = useRequireAuth();
  const router = useRouter();
  const cancelling = useRef(new Set<string>());
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [optionsSale, setOptionsSale] = useState<{transaction: Transaction; operation: ReturnType<typeof context.capture>} | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const afterOptionsDismiss = useRef<(() => void) | null>(null);
  const finishOptionsDismiss = () => {
    const action = afterOptionsDismiss.current;
    afterOptionsDismiss.current = null;
    setOptionsSale(null);
    action?.();
  };
  const closeOptions = (action?: () => void) => {
    afterOptionsDismiss.current = action ?? null;
    setOptionsVisible(false);
    // iOS presents the confirmation only after its page sheet has dismissed.
    if (Platform.OS !== 'ios') finishOptionsDismiss();
  };

  const {
    data: sales = [],
    isLoading: loading,
    isError,
    isRefetching: refreshing,
    refetch,
  } = useQuery<SaleItem[]>({
    queryKey: [...queryKeys.orders.list(`seller_${uid ?? ''}`), generation, context.focusRevision],
    queryFn: async ({signal}) => {
      try {
        if (signal.aborted) throw new CancelledError({revert: true});
        const operation = context.capture();
        const session = operation.session;
        const allTx = await TransactionService.getUserTransactions(session.uid);
        assertTradeSessionCurrent(session); context.assertCurrent(operation);
        const sellerTx = allTx.filter(t => t.sellerId === session.uid);

        // Batch the article reads (one `in` query per 30 ids) instead of an N+1
        // of getArticleById (F130).
        const articlesById = await ArticlesService.getArticlesByIds(
          sellerTx.filter(t => !t.articleSnapshot).map(t => t.articleId),
        ).catch(() => new Map<string, Article>());
        assertTradeSessionCurrent(session); context.assertCurrent(operation);

        // Review checks only run for reviewable (terminal) statuses — a small
        // subset, so this is not the N+1 driver.
        const reviewChecks = await Promise.all(
          sellerTx.map((tx) => {
            if (!isReviewableStatus(tx.status)) return Promise.resolve(false);
            return hasUserReviewedTransaction(session.uid, tx.id);
          }),
        );
        assertTradeSessionCurrent(session); context.assertCurrent(operation);

        return sellerTx.map((tx, i) => ({
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

  // The committed focus/generation key refreshes the list; do not bypass its
  // admission with an unconditional refetch while the new frame is mounting.

  const handleSalePress = useCallback(
    (saleItem: SaleItem) => {
      const { transaction } = saleItem;
      if (!uid || transaction.sellerId !== uid) return;
      try { context.capture(); } catch { return; }
      track('order_card_tapped', {
        role: 'seller',
        transaction_id: transaction.id,
        status: transaction.status,
        delivery_type: transaction.deliveryType,
        destination: 'order',
      });
      router.push({ pathname: '/orders/[id]', params: { id: transaction.id } });
    },
    [router, uid, context.frame, context.focusRevision],
  );

  const handleReview = useCallback(
    (transactionId: string) => {
      try {const operation = context.capture(); if (!isTradeProfileCurrent(operation.session)) return;} catch {return;}
      router.push(`/review/${transactionId}`);
    },
    [router, normalUser?.id, context.frame, context.focusRevision],
  );

  // F74 — seller cancels a paid order before the first carrier scan. Explicit
  // confirmation (the server determines the refund and inventory outcome), then
  // refetch so the cancelled row drops out of the cancellable state.
  const handleCancelSale = useCallback(
    (transaction: Transaction) => {
      if (!user || transaction.sellerId !== user.id) return;
      let operation: ReturnType<typeof context.capture>;
      try { operation = context.capture(); } catch { return; }
      const transactionId = transaction.id;
      const statusAtCancel = transaction.status as 'paid' | 'label_created';
      Alert.alert(
        'Demander l’annulation',
        'L’acheteur sera remboursé après confirmation de l’annulation.',
        [
          { text: 'Retour', style: 'cancel' },
          {
            text: 'Confirmer la demande',
            style: 'destructive',
            onPress: async () => {
              if (!context.isCurrent(operation)) return;
              if (cancelling.current.has(transactionId)) return;
              cancelling.current.add(transactionId);
              setCancellingIds(new Set(cancelling.current));
              try {
                const result = await TransactionService.sellerCancelTransaction(transactionId);
                if (!context.isCurrent(operation)) return;
                track('order_cancel_submitted', {
                  transaction_id: transactionId,
                  role: 'seller',
                  source: 'sale_detail',
                  status_at_cancel: statusAtCancel,
                  total_cents: Math.round((transaction.totalAmount || 0) * 100),
                  success: isRefundConfirmed(result),
                });
                const presentation = refundResultPresentation(result);
                Alert.alert(presentation.title, presentation.message);
                refetch();
              } catch (error) {
                if (!context.isCurrent(operation)) return;
                if (__DEV__) console.error('Error cancelling sale:', error);
                track('order_cancel_submitted', {
                  transaction_id: transactionId,
                  role: 'seller',
                  source: 'sale_detail',
                  status_at_cancel: statusAtCancel,
                  total_cents: Math.round((transaction.totalAmount || 0) * 100),
                  success: false,
                  error_code: getCallableErrorCode(error) ?? undefined,
                });
                Alert.alert(
                  'Erreur',
                  getFinancialErrorMessage(error),
                );
              } finally {
                cancelling.current.delete(transactionId);
                if (context.isCurrent(operation)) {
                  setCancellingIds(new Set(cancelling.current));
                  void refetch();
                }
              }
            },
          },
        ],
      );
    },
    [refetch, user?.id, generation, context.frame, context.focusRevision],
  );

  const renderSale = useCallback(({ item }: { item: SaleItem }) => <SaleCard
    item={item}
    onPress={() => handleSalePress(item)}
    onReview={normalUser?.id === uid ? () => handleReview(item.transaction.id) : undefined}
    onOptions={user?.id === uid ? () => {
      try {
        const operation = context.capture();
        setOptionsSale({transaction: item.transaction, operation});
        setOptionsVisible(true);
      } catch {return;}
    } : undefined}
    isCancelling={cancellingIds.has(item.transaction.id)}
  />, [handleSalePress, handleReview, cancellingIds, normalUser?.id, user?.id, uid, context]);

  if (!uid) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mes ventes" onBack={() => router.back()} />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Connexion requise</Text>
          <Text style={styles.emptyText}>
            Connectez-vous pour voir vos ventes
          </Text>
          <Button onPress={() => showAuthSheet(AUTH_MESSAGES.default)}>Se connecter</Button>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScreenHeader title="Mes ventes" onBack={() => router.back()} />

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
      ) : isError && sales.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cloud-offline-outline" size={sizing.iconLG} color={colors.muted} />
          <Text style={styles.emptyTitle}>Consultation indisponible</Text>
          <Text style={styles.emptyText}>Impossible de charger vos ventes pour le moment.</Text>
          <Button variant="secondary" onPress={() => {
            try {context.capture();} catch {return;}
            void refetch();
          }}>Réessayer</Button>
        </View>
      ) : sales.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="wallet-outline" size={64} color={colors.muted} />
          <Text style={styles.emptyTitle}>Aucune vente</Text>
          <Text style={styles.emptyText}>
            Vos ventes apparaîtront ici une fois que vous aurez vendu votre premier
            article.
          </Text>
        </View>
      ) : (
        <FlashList
          data={sales}
          keyExtractor={saleKey}
          renderItem={renderSale}
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
                track('list_refreshed', { screen: 'my_sales', items_count: sales.length });
                refetch();
              }}
              tintColor={colors.primary}
            />
          }
        />
      )}
      <Modal
        visible={optionsVisible && !!optionsSale && context.isCurrent(optionsSale.operation)}
        presentationStyle="pageSheet"
        animationType="slide"
        testID="sale-options-sheet"
        onRequestClose={() => closeOptions()}
        onDismiss={finishOptionsDismiss}
      >
        <SafeAreaProvider style={styles.container}>
          <SafeAreaView style={styles.container} edges={['bottom']}>
            <ScreenHeader title="Cette vente" onBack={() => closeOptions()} />
            <View style={styles.optionsContent}>
              <OrderOptionsList items={[
                {label: 'Voir la commande', icon: 'receipt-outline', onPress: () => {
                  const selected = optionsSale;
                  closeOptions(() => {
                    if (!selected || !context.isCurrent(selected.operation)) return;
                    handleSalePress({transaction: selected.transaction, article: null, hasReview: false});
                  });
                }},
                {label: 'Demander l’annulation', icon: 'close-circle-outline', onPress: () => {
                  const selected = optionsSale;
                  closeOptions(() => {
                    if (!selected || !context.isCurrent(selected.operation)) return;
                    handleCancelSale(selected.transaction);
                  });
                }},
                {label: 'Fermer', icon: 'close-outline', onPress: () => closeOptions()},
              ]} />
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
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
  optionsContent: {padding: spacing.lg},
  optionsButton: {
    minHeight: sizing.minTouchTarget,
    minWidth: sizing.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
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
