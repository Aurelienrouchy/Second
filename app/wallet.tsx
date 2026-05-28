/**
 * Wallet Screen (Porte-monnaie)
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Two states:
 * A) Wallet not activated — activation CTA
 * B) Wallet active — balance card, action buttons, transaction history
 *
 * Withdrawal flow is inline below the balance card.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button, ScreenHeader, Skeleton, Text } from '@/components/ui';
import { APP_LOCALE } from '@/constants/locale';
import {
  colors,
  fonts,
  radius,
  shadows,
  sizing,
  spacing,
  typography,
} from '@/constants/theme';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useWallet } from '@/hooks/useWallet';
import type { WalletLedgerEntry } from '@/types';

// =============================================================================
// HELPERS
// =============================================================================

/** Format cents to Canadian French display: "45,00 $" */
function formatCents(cents: number): string {
  const dollars = cents / 100;
  return `${dollars.toFixed(2).replace('.', ',')} $`;
}

/** Relative date label: Aujourd'hui, Hier, or "12 mai" */
function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Hier';
  return date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' });
}

/** Icon config per ledger entry type */
const LEDGER_ICON_MAP: Record<
  WalletLedgerEntry['type'],
  { name: keyof typeof Ionicons.glyphMap; color: string; bg: string }
> = {
  sale_credit: {
    name: 'arrow-down-circle-outline',
    color: colors.success,
    bg: colors.successLight,
  },
  purchase_debit: {
    name: 'arrow-up-circle-outline',
    color: colors.danger,
    bg: colors.dangerLight,
  },
  withdrawal: {
    name: 'business-outline',
    color: colors.danger,
    bg: colors.dangerLight,
  },
  refund_credit: {
    name: 'refresh-circle-outline',
    color: colors.success,
    bg: colors.successLight,
  },
  withdrawal_failed: {
    name: 'alert-circle',
    color: colors.danger,
    bg: colors.dangerLight,
  },
};

function isCredit(type: WalletLedgerEntry['type']): boolean {
  return type === 'sale_credit' || type === 'refund_credit';
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function WalletScreen() {
  const router = useRouter();
  const { user } = useAuthRequired();

  const {
    wallet,
    isLoading,
    isRefetching,
    refetch,
    activate,
    isActivating,
    withdraw,
    isWithdrawing,
  } = useWallet(!!user);

  // ── Withdrawal flow state ──────────────────────────────────────────────────

  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [withdrawalInput, setWithdrawalInput] = useState('');

  const handleActivate = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await activate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      if (__DEV__) console.error('Wallet activation error:', error);
      const msg =
        error instanceof Error
          ? error.message
          : "Impossible d'activer le porte-monnaie.";
      Alert.alert('Erreur', msg);
    }
  }, [activate]);

  const handleWithdrawPress = useCallback(() => {
    if (!user) return;

    // Check that user has Stripe Connect set up
    if (!user.stripeAccountId || !user.stripePayoutsEnabled) {
      Alert.alert(
        'Compte de paiement requis',
        'Configurez votre compte de paiement pour retirer vos fonds.',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Configurer',
            onPress: () => router.push('/settings/stripe-onboarding'),
          },
        ],
      );
      return;
    }

    // Pre-fill with full balance in dollars
    if (wallet) {
      const dollars = (wallet.balance / 100).toFixed(2);
      setWithdrawalInput(dollars);
    }
    setShowWithdrawal(true);
  }, [user, wallet, router]);

  const handleWithdrawConfirm = useCallback(async () => {
    if (!wallet || isWithdrawing) return;

    const dollars = parseFloat(withdrawalInput.replace(',', '.'));
    if (isNaN(dollars) || dollars <= 0) {
      Alert.alert('Erreur', 'Veuillez entrer un montant valide.');
      return;
    }

    const cents = Math.round(dollars * 100);

    if (cents < 1000) {
      Alert.alert('Erreur', 'Le montant minimum de retrait est de 10,00 $.');
      return;
    }

    if (cents > wallet.balance) {
      Alert.alert('Erreur', 'Solde insuffisant.');
      return;
    }

    Alert.alert(
      'Confirmer le retrait',
      `Voulez-vous retirer ${formatCents(cents)} vers votre compte bancaire ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: async () => {
            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              await withdraw(cents);
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              Alert.alert(
                'Retrait effectue',
                'Votre demande de retrait a ete envoyee. Le transfert sera traite sous 2-3 jours ouvres.',
              );
              setShowWithdrawal(false);
              setWithdrawalInput('');
            } catch (error: unknown) {
              if (__DEV__) console.error('Wallet withdrawal error:', error);
              const msg =
                error instanceof Error
                  ? error.message
                  : 'Impossible de traiter le retrait.';
              Alert.alert('Erreur', msg);
            }
          },
        },
      ],
    );
  }, [wallet, withdrawalInput, isWithdrawing, withdraw]);

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // ── Ledger list ────────────────────────────────────────────────────────────

  const sortedLedger = useMemo(() => {
    if (!wallet?.ledger) return [];
    return [...wallet.ledger].reverse();
  }, [wallet?.ledger]);

  const renderLedgerItem = useCallback(
    ({ item }: { item: WalletLedgerEntry }) => {
      const icon = LEDGER_ICON_MAP[item.type] ?? {
        name: 'help-circle' as const,
        color: colors.muted,
        bg: colors.backgroundSecondary,
      };
      const credit = isCredit(item.type);

      return (
        <View style={styles.ledgerItem}>
          <View style={[styles.ledgerIcon, { backgroundColor: icon.bg }]}>
            <Ionicons name={icon.name} size={20} color={icon.color} />
          </View>
          <View style={styles.ledgerContent}>
            <Text style={styles.ledgerDescription}>{item.description}</Text>
            <Text style={styles.ledgerDate}>
              {formatRelativeDate(item.createdAt)}
            </Text>
          </View>
          <Text
            style={[
              styles.ledgerAmount,
              credit ? styles.ledgerAmountCredit : styles.ledgerAmountDebit,
            ]}
          >
            {credit ? '+' : '-'}
            {formatCents(Math.abs(item.amount))}
          </Text>
        </View>
      );
    },
    [],
  );

  // ── Loading state ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Porte-monnaie" onBack={() => router.back()} />
        <View style={styles.content}>
          <Skeleton
            width="100%"
            height={140}
            borderRadius={radius.lg}
            style={{ marginTop: spacing.lg }}
          />
          <View style={styles.skeletonActions}>
            <Skeleton width="48%" height={48} borderRadius={radius.md} />
            <Skeleton width="48%" height={48} borderRadius={radius.md} />
          </View>
          <Skeleton
            width={100}
            height={18}
            style={{ marginTop: spacing.xl }}
          />
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} style={styles.skeletonLedger}>
              <Skeleton width={40} height={40} borderRadius={9999} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Skeleton width="60%" height={14} />
                <Skeleton
                  width="30%"
                  height={12}
                  style={{ marginTop: spacing.xs }}
                />
              </View>
              <Skeleton width={60} height={18} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  // ── State A: Wallet not activated ──────────────────────────────────────────

  if (!wallet || !wallet.hasWallet) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Porte-monnaie" onBack={() => router.back()} />
        <View style={styles.activationContainer}>
          <View style={styles.activationIconCircle}>
            <Ionicons
              name="wallet-outline"
              size={48}
              color={colors.primary}
            />
          </View>
          <Text style={styles.activationTitle}>
            Activez votre porte-monnaie
          </Text>
          <Text style={styles.activationDescription}>
            Recevez vos gains de vente directement dans votre porte-monnaie.
            Utilisez votre solde pour acheter des articles ou transférez vers votre
            compte bancaire.
          </Text>
          <Button
            variant="primary"
            fullWidth
            loading={isActivating}
            disabled={isActivating}
            onPress={handleActivate}
            style={styles.activateButton}
          >
            Activer mon porte-monnaie
          </Button>
        </View>
      </View>
    );
  }

  // ── State B: Wallet active ─────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScreenHeader title="Porte-monnaie" onBack={() => router.back()} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
      >
        {/* Balance card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Solde disponible</Text>
          <Text style={styles.balanceAmount}>
            {formatCents(wallet.balance)}
          </Text>
          {wallet.pendingBalance > 0 && (
            <Text style={styles.balancePending}>
              {formatCents(wallet.pendingBalance)} en attente
            </Text>
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <Pressable
            style={styles.actionButton}
            onPress={handleWithdrawPress}
          >
            <View style={styles.actionIconCircle}>
              <Ionicons
                name="download-outline"
                size={20}
                color={colors.primary}
              />
            </View>
            <Text style={styles.actionLabel}>Retirer</Text>
          </Pressable>
        </View>

        {/* Withdrawal form (inline) */}
        {showWithdrawal && (
          <View style={styles.withdrawalForm}>
            <Text style={styles.withdrawalTitle}>Retrait</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Montant</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="0,00"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  value={withdrawalInput}
                  onChangeText={setWithdrawalInput}
                />
                <Text style={styles.inputCurrency}>$</Text>
              </View>
              <Text style={styles.inputHint}>
                Montant minimum : 10,00 $
              </Text>
            </View>

            <View style={styles.withdrawalActions}>
              <Button
                variant="muted"
                style={styles.withdrawalActionButton}
                onPress={() => {
                  setShowWithdrawal(false);
                  setWithdrawalInput('');
                }}
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                style={styles.withdrawalActionButton}
                loading={isWithdrawing}
                disabled={isWithdrawing}
                onPress={handleWithdrawConfirm}
              >
                Confirmer le retrait
              </Button>
            </View>
          </View>
        )}

        {/* Transaction history */}
        <View style={styles.historySection}>
          <Text style={styles.historySectionTitle}>HISTORIQUE</Text>

          {sortedLedger.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons
                name="receipt-outline"
                size={48}
                color={colors.border}
              />
              <Text style={styles.emptyStateText}>
                Aucune transaction pour le moment
              </Text>
            </View>
          ) : (
            <>
              {sortedLedger.map((item) => (
                <React.Fragment key={item.id}>
                  {renderLedgerItem({ item })}
                </React.Fragment>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
  },

  // ── Skeleton ───────────────────────────────────────────────────────────────

  skeletonActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  skeletonLedger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
  },

  // ── Activation (State A) ───────────────────────────────────────────────────

  activationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  activationIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  activationTitle: {
    ...typography.h1,
    color: colors.charcoal,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  activationDescription: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  activateButton: {
    marginTop: spacing.sm,
  },

  // ── Balance card (State B) ─────────────────────────────────────────────────

  balanceCard: {
    backgroundColor: colors.charcoal,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
    ...shadows.medium,
  },
  balanceLabel: {
    ...typography.labelUppercase,
    color: colors.whiteTranslucent,
    marginBottom: spacing.sm,
  },
  balanceAmount: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1,
    color: colors.white,
  },
  balancePending: {
    ...typography.caption,
    color: colors.whiteTranslucent,
    marginTop: spacing.xs,
  },

  // ── Action buttons ─────────────────────────────────────────────────────────

  actionRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    gap: spacing.sm,
  },
  actionIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    ...typography.label,
    color: colors.charcoal,
  },

  // ── Withdrawal form ────────────────────────────────────────────────────────

  withdrawalForm: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  withdrawalTitle: {
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

  // ── History ────────────────────────────────────────────────────────────────

  historySection: {
    marginTop: spacing.xl,
  },
  historySectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
  },
  ledgerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  ledgerIcon: {
    width: sizing.avatarMD,
    height: sizing.avatarMD,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  ledgerContent: {
    flex: 1,
  },
  ledgerDescription: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  ledgerDate: {
    ...typography.caption,
    color: colors.muted,
  },
  ledgerAmount: {
    ...typography.price,
  },
  ledgerAmountCredit: {
    color: colors.success,
  },
  ledgerAmountDebit: {
    color: colors.danger,
  },

  // ── Empty state ────────────────────────────────────────────────────────────

  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
  },
  emptyStateText: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.md,
  },
});
