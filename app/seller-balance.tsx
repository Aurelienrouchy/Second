import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { SellerBalanceService } from '@/services/sellerBalanceService';
import { SellerBalance } from '@/types';
import { colors } from '@/constants/theme';

export default function SellerBalanceScreen() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [balance, setBalance] = useState<SellerBalance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [iban, setIban] = useState('');
  const [isProcessingWithdrawal, setIsProcessingWithdrawal] = useState(false);

  useEffect(() => {
    if (user) {
      loadBalance();
    }
  }, [user]);

  const loadBalance = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      const balanceData = await SellerBalanceService.getBalance(user.id);
      setBalance(balanceData);
    } catch (error) {
      if (__DEV__) console.error('Error loading balance:', error);
      Alert.alert('Erreur', 'Impossible de charger votre balance');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadBalance();
    setIsRefreshing(false);
  };

  const handleWithdrawal = async () => {
    const amount = parseFloat(withdrawalAmount);

    if (!amount || amount <= 0) {
      Alert.alert('Erreur', 'Veuillez entrer un montant valide');
      return;
    }

    if (!iban || iban.length < 15) {
      Alert.alert('Erreur', 'Veuillez entrer un IBAN valide');
      return;
    }

    if (!balance || amount > balance.availableBalance) {
      Alert.alert('Erreur', 'Solde insuffisant');
      return;
    }

    if (amount < 10) {
      Alert.alert('Erreur', 'Le montant minimum de retrait est de 10€');
      return;
    }

    Alert.alert(
      'Confirmer le retrait',
      `Êtes-vous sûr de vouloir retirer ${amount.toFixed(2)}€ vers le compte ${iban.slice(-4)} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: async () => {
            try {
              setIsProcessingWithdrawal(true);
              await SellerBalanceService.requestWithdrawal(user!.id, amount, iban);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(
                'Demande envoyée',
                'Votre demande de retrait a été envoyée. Elle sera traitée sous 2-3 jours ouvrés.'
              );
              setShowWithdrawalModal(false);
              setWithdrawalAmount('');
              setIban('');
              await loadBalance();
            } catch (error: any) {
              if (__DEV__) console.error('Error requesting withdrawal:', error);
              Alert.alert('Erreur', error.message || 'Impossible de traiter la demande');
            } finally {
              setIsProcessingWithdrawal(false);
            }
          },
        },
      ]
    );
  };

  const renderTransaction = ({ item }: { item: SellerBalance['transactions'][0] }) => {
    const isWithdrawal = item.type === 'withdrawal';
    const isPending = item.status === 'pending';

    return (
      <View style={styles.transactionItem}>
        <View style={[
          styles.transactionIcon,
          isWithdrawal ? styles.transactionIconWithdrawal : styles.transactionIconSale,
        ]}>
          <Ionicons
            name={isWithdrawal ? 'arrow-down' : 'arrow-up'}
            size={20}
            color={isWithdrawal ? '#FF3B30' : '#34C759'}
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
          {isPending && (
            <Text style={styles.transactionStatusPending}>En attente</Text>
          )}
        </View>

        <Text style={[
          styles.transactionAmount,
          isWithdrawal && styles.transactionAmountNegative,
        ]}>
          {item.amount > 0 ? '+' : ''}{item.amount.toFixed(2)}€
        </Text>
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!balance) {
    return null;
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>Ma balance vendeur</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Balance Cards */}
        <View style={styles.balanceCards}>
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Disponible</Text>
            <Text style={styles.balanceAmount}>
              {balance.availableBalance.toFixed(2)}€
            </Text>
            <Text style={styles.balanceHint}>Prêt pour retrait</Text>
          </View>

          <View style={[styles.balanceCard, styles.balanceCardPending]}>
            <Text style={styles.balanceLabel}>En attente</Text>
            <Text style={[styles.balanceAmount, styles.balanceAmountPending]}>
              {balance.pendingBalance.toFixed(2)}€
            </Text>
            <Text style={styles.balanceHint}>Livraisons en cours</Text>
          </View>
        </View>

        {/* Total Earnings */}
        <View style={styles.totalCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total des gains</Text>
            <Text style={styles.totalAmount}>{balance.totalEarnings.toFixed(2)}€</Text>
          </View>
        </View>

        {/* Withdrawal Button */}
        {balance.availableBalance >= 10 && !showWithdrawalModal && (
          <Pressable
            style={styles.withdrawalButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setShowWithdrawalModal(true);
            }}
          >
            <Ionicons name="cash-outline" size={20} color="#FFFFFF" />
            <Text style={styles.withdrawalButtonText}>Demander un retrait</Text>
          </Pressable>
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
                  keyboardType="decimal-pad"
                  value={withdrawalAmount}
                  onChangeText={setWithdrawalAmount}
                />
                <Text style={styles.inputCurrency}>€</Text>
              </View>
              <Text style={styles.inputHint}>
                Disponible: {balance.availableBalance.toFixed(2)}€ (min. 10€)
              </Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>IBAN</Text>
              <TextInput
                style={styles.input}
                placeholder="FR76 1234 5678 9012 3456 7890 123"
                value={iban}
                onChangeText={(text) => setIban(text.toUpperCase())}
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.withdrawalActions}>
              <Pressable
                style={styles.withdrawalCancelButton}
                onPress={() => {
                  setShowWithdrawalModal(false);
                  setWithdrawalAmount('');
                  setIban('');
                }}
              >
                <Text style={styles.withdrawalCancelButtonText}>Annuler</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.withdrawalConfirmButton,
                  isProcessingWithdrawal && styles.withdrawalConfirmButtonDisabled,
                ]}
                onPress={handleWithdrawal}
                disabled={isProcessingWithdrawal}
              >
                {isProcessingWithdrawal ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.withdrawalConfirmButtonText}>Confirmer</Text>
                )}
              </Pressable>
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
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
  },
  backButton: {
    width: 24,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.foreground,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  balanceCards: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  balanceCard: {
    flex: 1,
    backgroundColor: '#34C759',
    borderRadius: 16,
    padding: 20,
  },
  balanceCardPending: {
    backgroundColor: colors.primary,
  },
  balanceLabel: {
    fontSize: 14,
    color: colors.white,
    opacity: 0.9,
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.white,
    marginBottom: 4,
  },
  balanceAmountPending: {
    fontSize: 28,
  },
  balanceHint: {
    fontSize: 12,
    color: colors.white,
    opacity: 0.8,
  },
  totalCard: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.foreground,
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.primary,
  },
  withdrawalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#34C759',
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 20,
    gap: 8,
  },
  withdrawalButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  withdrawalForm: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
  },
  withdrawalFormTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.foreground,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.foreground,
    paddingVertical: 12,
  },
  inputCurrency: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.muted,
  },
  inputHint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
  },
  withdrawalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  withdrawalCancelButton: {
    flex: 1,
    backgroundColor: colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  withdrawalCancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  withdrawalConfirmButton: {
    flex: 1,
    backgroundColor: '#34C759',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  withdrawalConfirmButtonDisabled: {
    opacity: 0.5,
  },
  withdrawalConfirmButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  historySection: {
    marginTop: 32,
    marginBottom: 32,
  },
  historyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: 16,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  transactionIconSale: {
    backgroundColor: '#E8F5E9',
  },
  transactionIconWithdrawal: {
    backgroundColor: '#FFEBEE',
  },
  transactionContent: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.foreground,
    marginBottom: 2,
  },
  transactionDate: {
    fontSize: 12,
    color: colors.muted,
  },
  transactionStatusPending: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#34C759',
  },
  transactionAmountNegative: {
    color: '#FF3B30',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 16,
    color: colors.muted,
    marginTop: 16,
  },
});

