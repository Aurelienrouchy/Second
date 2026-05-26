import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { Button, ScreenHeader, Skeleton, Text } from '@/components/ui';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { queryKeys } from '@/lib/queryKeys';
import { SellerBalanceService } from '@/services/sellerBalanceService';
import { SellerBalance } from '@/types';
import { colors, fonts, spacing, radius, sizing, typography } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';

export default function SellerBalanceScreen() {
  const router = useRouter();
  const { user, isLoggedIn } = useAuthRequired();
  const queryClient = useQueryClient();

  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [transitNumber, setTransitNumber] = useState('');
  const [institutionNumber, setInstitutionNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [isProcessingWithdrawal, setIsProcessingWithdrawal] = useState(false);

  const {
    data: balance,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: queryKeys.sellers.balance(user?.id ?? ''),
    queryFn: () => SellerBalanceService.getBalance(user!.id),
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleWithdrawal = async () => {
    if (isProcessingWithdrawal) return;
    setIsProcessingWithdrawal(true);

    const amount = parseFloat(withdrawalAmount);

    if (!amount || amount <= 0) {
      setIsProcessingWithdrawal(false);
      Alert.alert('Erreur', 'Veuillez entrer un montant valide');
      return;
    }

    if (transitNumber.length !== 5) {
      setIsProcessingWithdrawal(false);
      Alert.alert('Erreur', 'Le numéro de transit doit contenir 5 chiffres');
      return;
    }
    if (institutionNumber.length !== 3) {
      setIsProcessingWithdrawal(false);
      Alert.alert('Erreur', "Le numéro d'institution doit contenir 3 chiffres");
      return;
    }
    if (accountNumber.length < 7) {
      setIsProcessingWithdrawal(false);
      Alert.alert('Erreur', 'Le numéro de compte doit contenir au moins 7 chiffres');
      return;
    }

    if (!balance || amount > balance.availableBalance) {
      setIsProcessingWithdrawal(false);
      Alert.alert('Erreur', 'Solde insuffisant');
      return;
    }

    if (amount < 10) {
      setIsProcessingWithdrawal(false);
      Alert.alert('Erreur', `Le montant minimum de retrait est de ${formatPriceWithCurrency(10)}`);
      return;
    }

    Alert.alert(
      'Confirmer le retrait',
      `Voulez-vous retirer ${formatPriceWithCurrency(amount)} vers le compte se terminant par ${accountNumber.slice(-4)} ?`,
      [
        { text: 'Annuler', style: 'cancel', onPress: () => setIsProcessingWithdrawal(false) },
        {
          text: 'Confirmer',
          onPress: async () => {
            try {
              const bankAccount = `${transitNumber}-${institutionNumber}-${accountNumber}`;
              await SellerBalanceService.requestWithdrawal(user!.id, amount, bankAccount);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(
                'Demande envoyée',
                'Votre demande de retrait a été envoyée. Elle sera traitée sous 2-3 jours ouvrés.'
              );
              setShowWithdrawalModal(false);
              setWithdrawalAmount('');
              setTransitNumber('');
              setInstitutionNumber('');
              setAccountNumber('');
              await queryClient.invalidateQueries({
                queryKey: queryKeys.sellers.balance(user!.id),
              });
            } catch (error: unknown) {
              if (__DEV__) console.error('Error requesting withdrawal:', error);
              const message =
                error instanceof Error ? error.message : 'Impossible de traiter la demande';
              Alert.alert('Erreur', message);
            } finally {
              setIsProcessingWithdrawal(false);
            }
          },
        },
      ]
    );
  };

  const renderTransaction = useCallback(
    ({ item }: { item: SellerBalance['transactions'][0] }) => {
      const isWithdrawal = item.type === 'withdrawal';
      const isPending = item.status === 'pending';

      return (
        <View style={styles.transactionItem}>
          <View
            style={[
              styles.transactionIcon,
              isWithdrawal ? styles.transactionIconWithdrawal : styles.transactionIconSale,
            ]}
          >
            <Ionicons
              name={isWithdrawal ? 'arrow-down' : 'arrow-up'}
              size={20}
              color={isWithdrawal ? colors.danger : colors.success}
            />
          </View>

          <View style={styles.transactionContent}>
            <Text style={styles.transactionDescription}>{item.description}</Text>
            <Text style={styles.transactionDate}>
              {item.createdAt.toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
            {isPending && <Text style={styles.transactionStatusPending}>En attente</Text>}
          </View>

          <Text
            style={[styles.transactionAmount, isWithdrawal && styles.transactionAmountNegative]}
          >
            {item.amount > 0 ? '+' : ''}
            {formatPriceWithCurrency(Math.abs(item.amount))}
          </Text>
        </View>
      );
    },
    []
  );

  const keyExtractor = useCallback(
    (item: SellerBalance['transactions'][0]) => item.id,
    []
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mon solde" onBack={() => router.back()} />
        <View style={styles.content}>
          {/* Balance cards skeleton */}
          <View style={styles.skeletonBalanceCards}>
            <Skeleton width="48%" height={110} borderRadius={radius.xl} />
            <Skeleton width="48%" height={110} borderRadius={radius.xl} />
          </View>
          {/* Total card skeleton */}
          <Skeleton width="100%" height={52} borderRadius={radius.lg} style={{ marginTop: spacing.md }} />
          {/* Transaction list skeleton */}
          <View style={{ marginTop: spacing.xl }}>
            <Skeleton width={100} height={18} style={{ marginBottom: spacing.md }} />
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={styles.skeletonTransaction}>
                <Skeleton width={40} height={40} borderRadius={9999} />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Skeleton width="60%" height={14} />
                  <Skeleton width="30%" height={12} style={{ marginTop: spacing.xs }} />
                </View>
                <Skeleton width={60} height={18} />
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mon solde" onBack={() => router.back()} />
        <View style={styles.errorState}>
          <Ionicons name="lock-closed-outline" size={48} color={colors.muted} />
          <Text style={styles.errorStateText}>Connectez-vous pour accéder à votre solde</Text>
          <Button
            variant="primary"
            onPress={() => router.replace('/(tabs)/profile')}
            style={styles.errorStateButton}
          >
            Se connecter
          </Button>
        </View>
      </View>
    );
  }

  if (!balance) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Mon solde" onBack={() => router.back()} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
          <Text style={styles.errorStateText}>Impossible de charger votre solde</Text>
          <Button
            variant="primary"
            onPress={() => refetch()}
            style={styles.errorStateButton}
          >
            Réessayer
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Mon solde" onBack={() => router.back()} />

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
      >
        {/* Balance Cards */}
        <View style={styles.balanceCards}>
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Disponible</Text>
            <Text style={styles.balanceAmount}>
              {formatPriceWithCurrency(balance.availableBalance)}
            </Text>
            <Text style={styles.balanceHint}>Prêt pour retrait</Text>
          </View>

          <View style={[styles.balanceCard, styles.balanceCardPending]}>
            <Text style={styles.balanceLabel}>En attente</Text>
            <Text style={styles.balanceAmount}>
              {formatPriceWithCurrency(balance.pendingBalance)}
            </Text>
            <Text style={styles.balanceHint}>Livraisons en cours</Text>
          </View>
        </View>

        {/* Total Earnings */}
        <View style={styles.totalCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total des gains</Text>
            <Text style={styles.totalAmount}>{formatPriceWithCurrency(balance.totalEarnings)}</Text>
          </View>
        </View>

        {/* Withdrawal Button */}
        {balance.availableBalance >= 10 && !showWithdrawalModal && (
          <Button
            variant="primary"
            fullWidth
            onPress={() => setShowWithdrawalModal(true)}
            style={styles.withdrawalButton}
            textStyle={styles.withdrawalButtonText}
            leftIcon={<Ionicons name="cash-outline" size={20} color={colors.white} />}
          >
            Demander un retrait
          </Button>
        )}

        {/* Withdrawal Form */}
        {showWithdrawalModal && (
          <View style={styles.withdrawalForm}>
            <Text style={styles.withdrawalFormTitle}>Demande de retrait</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Montant</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  value={withdrawalAmount}
                  onChangeText={setWithdrawalAmount}
                />
                <Text style={styles.inputCurrency}>$ CA</Text>
              </View>
              <Text style={styles.inputHint}>
                Disponible: {formatPriceWithCurrency(balance.availableBalance)} (min. {formatPriceWithCurrency(10)})
              </Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Numéro de transit</Text>
              <TextInput
                style={[styles.input, styles.inputStandalone]}
                placeholder="12345"
                placeholderTextColor={colors.muted}
                value={transitNumber}
                onChangeText={(t) => setTransitNumber(t.replace(/\D/g, '').slice(0, 5))}
                keyboardType="number-pad"
                maxLength={5}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{"Numéro d'institution"}</Text>
              <TextInput
                style={[styles.input, styles.inputStandalone]}
                placeholder="001"
                placeholderTextColor={colors.muted}
                value={institutionNumber}
                onChangeText={(t) => setInstitutionNumber(t.replace(/\D/g, '').slice(0, 3))}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Numéro de compte</Text>
              <TextInput
                style={[styles.input, styles.inputStandalone]}
                placeholder="1234567"
                placeholderTextColor={colors.muted}
                value={accountNumber}
                onChangeText={(t) => setAccountNumber(t.replace(/\D/g, '').slice(0, 12))}
                keyboardType="number-pad"
                maxLength={12}
              />
            </View>

            <View style={styles.withdrawalActions}>
              <Button
                variant="muted"
                style={styles.withdrawalActionButton}
                onPress={() => {
                  setShowWithdrawalModal(false);
                  setWithdrawalAmount('');
                  setTransitNumber('');
                  setInstitutionNumber('');
                  setAccountNumber('');
                }}
              >
                Annuler
              </Button>

              <Button
                variant="primary"
                style={styles.withdrawalActionButton}
                loading={isProcessingWithdrawal}
                disabled={isProcessingWithdrawal}
                onPress={handleWithdrawal}
              >
                Confirmer
              </Button>
            </View>
          </View>
        )}

        {/* Transactions History */}
        <View style={styles.historySection}>
          <Text style={styles.historyTitle}>Historique</Text>
          {balance.transactions.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="receipt-outline" size={48} color={colors.border} />
              <Text style={styles.emptyStateText}>Aucune transaction</Text>
            </View>
          ) : (
            <FlashList
              data={balance.transactions.slice().reverse()}
              renderItem={renderTransaction}
              keyExtractor={keyExtractor}
              // @ts-expect-error estimatedItemSize valid at runtime
              estimatedItemSize={80}
              scrollEnabled={false}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  skeletonBalanceCards: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  skeletonTransaction: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  balanceCards: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  balanceCard: {
    flex: 1,
    backgroundColor: colors.success,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  balanceCardPending: {
    backgroundColor: colors.primary,
  },
  balanceLabel: {
    ...typography.label,
    color: colors.white,
    opacity: 0.9,
    marginBottom: spacing.sm,
  },
  balanceAmount: {
    ...typography.priceLarge,
    color: colors.white,
    marginBottom: spacing.xs,
  },
  balanceHint: {
    ...typography.caption,
    color: colors.white,
    opacity: 0.8,
  },
  totalCard: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    ...typography.label,
    color: colors.foreground,
  },
  totalAmount: {
    ...typography.price,
    color: colors.primary,
  },
  withdrawalButton: {
    backgroundColor: colors.success,
    borderColor: colors.success,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
  },
  withdrawalButtonText: {
    color: colors.white,
  },
  withdrawalForm: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  withdrawalFormTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.lg,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.foreground,
    paddingVertical: spacing.sm,
  },
  inputStandalone: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputCurrency: {
    ...typography.label,
    color: colors.muted,
  },
  inputHint: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  withdrawalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  withdrawalActionButton: {
    flex: 1,
  },
  historySection: {
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  historyTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  transactionIcon: {
    width: sizing.avatarMD,
    height: sizing.avatarMD,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  transactionIconSale: {
    backgroundColor: colors.successLight,
  },
  transactionIconWithdrawal: {
    backgroundColor: colors.dangerLight,
  },
  transactionContent: {
    flex: 1,
  },
  transactionDescription: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  transactionDate: {
    ...typography.caption,
    color: colors.muted,
  },
  transactionStatusPending: {
    ...typography.caption,
    color: colors.primary,
    fontFamily: fonts.sansMedium,
    marginTop: spacing.xs,
  },
  transactionAmount: {
    ...typography.price,
    color: colors.success,
  },
  transactionAmountNegative: {
    color: colors.danger,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
  },
  emptyStateText: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.md,
  },
  errorState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  errorStateText: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  errorStateButton: {
    minWidth: 160,
  },
});
