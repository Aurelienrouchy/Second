/**
 * My Sales Screen -- Seller-side sales list
 * Design System: Editorial Luxe -- Cream, Charcoal, Rust, Sage
 */

import { useUser } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { ArticlesService } from '@/services/articlesService';
import { hasUserReviewedTransaction } from '@/services/reviewService';
import { TransactionService } from '@/services/transactionService';
import { Article, Transaction, TransactionStatus } from '@/types';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { Badge, ScreenHeader } from '@/components/ui';
import { getStatusLabel, getStatusVariant } from '@/lib/transactionStatusMeta';
import { queryKeys } from '@/lib/queryKeys';
import { formatPrice } from '@/utils/formatPrice';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { SafeAreaView } from 'react-native-safe-area-context';

interface SaleItem {
  transaction: Transaction;
  article: Article | null;
  hasReview: boolean;
}

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

function SaleCard({
  item,
  onPress,
  onReview,
}: {
  item: SaleItem;
  onPress: () => void;
  onReview?: () => void;
}) {
  const { transaction, article, hasReview } = item;
  const firstImage = article?.images?.[0];
  const dateLabel = transaction.createdAt.toLocaleDateString(APP_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const isReviewable = isReviewableStatus(transaction.status) && !hasReview;
  const isReviewed = isReviewableStatus(transaction.status) && hasReview;

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Image
        source={firstImage?.url ? { uri: firstImage.url } : undefined}
        style={styles.cardImage}
        contentFit="cover"
        transition={200}
        placeholder={firstImage?.blurhash ? { blurhash: firstImage.blurhash } : undefined}
        cachePolicy="memory-disk"
      />
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {article?.title || 'Article indisponible'}
        </Text>
        <Text style={styles.cardPrice}>{formatPrice(transaction.totalAmount)}</Text>
        <View style={styles.statusRow}>
          <Badge variant={getStatusVariant(transaction.status)}>
            {getStatusLabel(transaction.status, 'seller')}
          </Badge>
        </View>
        <Text style={styles.cardDate}>{dateLabel}</Text>
        {isReviewable && (
          <Pressable
            style={styles.reviewButton}
            onPress={(e) => {
              e.stopPropagation();
              onReview?.();
            }}
            hitSlop={4}
          >
            <Ionicons name="star-outline" size={12} color={colors.rust} />
            <Text style={styles.reviewButtonText}>Laisser un avis</Text>
          </Pressable>
        )}
        {isReviewed && (
          <View style={styles.reviewDoneRow}>
            <Ionicons name="checkmark-circle" size={12} color={colors.success} />
            <Text style={styles.reviewDoneText}>Avis laisse</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

export default function MySalesScreen() {
  const user = useUser();
  const { showAuthSheet } = useAuthRequired();
  const router = useRouter();

  const {
    data: sales = [],
    isLoading: loading,
    isRefetching: refreshing,
    refetch,
  } = useQuery<SaleItem[]>({
    queryKey: queryKeys.orders.list(`seller_${user?.id ?? ''}`),
    queryFn: async () => {
      const allTx = await TransactionService.getUserTransactions(user!.id);
      const sellerTx = allTx.filter((t) => t.sellerId === user!.id);

      const articles = await Promise.all(
        sellerTx.map((t) =>
          ArticlesService.getArticleById(t.articleId).catch(() => null),
        ),
      );

      // Check which completed transactions already have reviews
      const reviewChecks = await Promise.all(
        sellerTx.map((tx) => {
          const isCompleted =
            tx.status === 'delivered' || tx.status === 'meetup_completed';
          if (!isCompleted) return Promise.resolve(false);
          return hasUserReviewedTransaction(user!.id, tx.id);
        }),
      );

      return sellerTx.map((tx, i) => ({
        transaction: tx,
        article: articles[i],
        hasReview: reviewChecks[i],
      }));
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const handleSalePress = useCallback(
    (saleItem: SaleItem) => {
      const { transaction } = saleItem;
      if (transaction.chatId) {
        router.push(`/chat/${transaction.chatId}`);
        return;
      }
      if (saleItem.article) {
        router.push(`/article/${saleItem.article.id}`);
      }
    },
    [router],
  );

  const handleReview = useCallback(
    (transactionId: string) => {
      router.push(`/review/${transactionId}`);
    },
    [router],
  );

  if (!user) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mes ventes" onBack={() => router.back()} />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Connexion requise</Text>
          <Text style={styles.emptyText}>
            Connectez-vous pour voir vos ventes
          </Text>
          <Pressable
            style={styles.connectButton}
            onPress={() => showAuthSheet(AUTH_MESSAGES.default)}
          >
            <Text style={styles.connectButtonText}>SE CONNECTER</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScreenHeader title="Mes ventes" onBack={() => router.back()} />

      {loading ? (
        <View style={{ paddingVertical: spacing.sm }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.card}>
              <Skeleton
                width={72}
                height={72}
                borderRadius={radius.sm}
              />
              <View style={[styles.cardInfo, { gap: 6 }]}>
                <Skeleton width="70%" height={14} />
                <Skeleton width="35%" height={16} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Skeleton width={8} height={8} borderRadius={4} />
                  <Skeleton width="50%" height={11} />
                </View>
                <Skeleton width="30%" height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : sales.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="wallet-outline" size={64} color={colors.muted} />
          <Text style={styles.emptyTitle}>Aucune vente</Text>
          <Text style={styles.emptyText}>
            Vos ventes apparaitront ici une fois que vous aurez vendu votre premier
            article.
          </Text>
        </View>
      ) : (
        <FlashList
          data={sales}
          keyExtractor={(item) => item.transaction.id}
          renderItem={({ item }) => (
            <SaleCard
              item={item}
              onPress={() => handleSalePress(item)}
              onReview={() => handleReview(item.transaction.id)}
            />
          )}
          // @ts-expect-error estimatedItemSize valid at runtime
          estimatedItemSize={100}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => refetch()}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingVertical: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  cardImage: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: colors.borderLight,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.charcoal,
    marginBottom: 4,
  },
  cardPrice: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.primary,
    marginBottom: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  cardDate: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
  },
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.rust,
    backgroundColor: colors.primaryLight,
  },
  reviewButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    color: colors.rust,
  },
  reviewDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  reviewDoneText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.success,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 72 + spacing.md,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.charcoal,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },
  connectButton: {
    backgroundColor: colors.charcoal,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.sm,
    minWidth: 200,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  connectButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.16,
    color: colors.cream,
  },
});
