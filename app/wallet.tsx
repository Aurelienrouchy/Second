/**
 * Wallet Screen (Porte-monnaie)
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Two states:
 * A) Wallet not activated — activation CTA
 * B) Wallet active — three balance buckets (disponible / en attente / bientôt
 *    disponible), withdrawal flow, protection note, transaction history.
 *
 * Funds lifecycle (buyer-protection window):
 *   pendingBalance  → vente en cours (avant livraison)
 *   heldBalance     → livrée, gelée 7 j, "Disponible le {date}"
 *   balance         → retirable
 *
 * Withdrawals are blocked server-side while a dispute is active OR while a
 * sellerDebt remains. The UI surfaces both with the dedicated copy instead of
 * a raw error.
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
import { formatCents } from '@/utils/formatPrice';

// =============================================================================
// COPY (spec UX_PAIEMENT_LIVRAISON — telle quelle)
// =============================================================================

const WALLET_COPY = {
  availableLabel: 'Solde disponible',
  availableHint: 'Retirable à tout moment',
  pendingLabel: 'en attente',
  pendingHint:
    'Vente en cours. Le montant arrivera dans votre solde une fois la commande finalisée.',
  heldLabel: 'bientôt disponible',
  heldDatePrefix: 'Disponible le',
  heldHint:
    'Vos ventes livrées sont libérées 7 jours après la livraison, le temps de la fenêtre de protection acheteur.',
  protectionTitle: 'Protection Seconde',
  protectionBody:
    "Après une livraison, le montant de la vente est conservé 7 jours avant d'arriver dans votre solde. Cette fenêtre permet à l'acheteur·euse de signaler un éventuel problème. Passé ce délai, les fonds deviennent retirables.",
  blockDisputeTitle: 'Retrait momentanément indisponible',
  blockDisputeBody:
    "Un litige est en cours sur l'une de vos transactions. Les retraits sont suspendus le temps de sa résolution. Nous reviendrons vers vous dès que possible.",
  blockDisputeCta: 'Compris',
  blockDebtBannerTitle: 'Régularisation nécessaire',
  blockDebtBannerBody:
    'Un montant de {montant} reste à régulariser sur votre compte. Les retraits sont suspendus tant que ce solde n’est pas réglé. Vos prochaines ventes seront affectées à cette régularisation en priorité.',
  blockDebtAlertTitle: 'Retrait indisponible',
  blockDebtAlertBody:
    'Vous avez un montant à régulariser ({montant}). Les retraits reprendront automatiquement une fois ce solde réglé.',
  blockDebtCta: 'Compris',
  withdrawSuccessTitle: 'Retrait envoyé',
  withdrawSuccessBody:
    'Votre demande de retrait a été enregistrée. Le transfert vers votre compte bancaire sera traité sous 2 à 3 jours ouvrés.',
} as const;

// =============================================================================
// HELPERS
// =============================================================================

/** Substitute {montant} placeholder in copy strings. */
function withMontant(template: string, cents: number): string {
  return template.replace('{montant}', formatCents(cents));
}

/** Long date label for the held-funds release line: "12 mai 2026". */
function formatReleaseDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(APP_LOCALE, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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

/**
 * Resolve a Firebase callable error into a stable code suffix.
 * httpsCallable wraps server HttpsError into FirebaseError with
 * code = "functions/<code>" (e.g. "functions/failed-precondition").
 */
function getCallableErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

function getCallableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Impossible de traiter le retrait.';
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
    color: colors.warning,
    bg: colors.warningLight,
  },
  funds_held: {
    name: 'lock-closed-outline',
    color: colors.warning,
    bg: colors.warningLight,
  },
  funds_released: {
    name: 'lock-open-outline',
    color: colors.success,
    bg: colors.successLight,
  },
  dispute_hold: {
    name: 'alert-circle-outline',
    color: colors.warning,
    bg: colors.warningLight,
  },
  refund_debit: {
    name: 'arrow-up-circle-outline',
    color: colors.danger,
    bg: colors.dangerLight,
  },
  debt_repayment: {
    name: 'checkmark-done-circle-outline',
    color: colors.sage,
    bg: colors.sageLight,
  },
};

/**
 * Credit-side entries are rendered with a leading "+" in success green.
 * Includes funds_released (protection window unlock) and withdrawal_failed
 * (a failed payout re-credited to the available balance).
 */
function isCredit(type: WalletLedgerEntry['type']): boolean {
  return (
    type === 'sale_credit' ||
    type === 'refund_credit' ||
    type === 'funds_released' ||
    type === 'withdrawal_failed'
  );
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

  // ── Derived buckets ──────────────────────────────────────────────────────
  const pendingBalance = wallet?.pendingBalance ?? 0;
  const heldBalance = wallet?.heldBalance ?? 0;
  const sellerDebt = wallet?.sellerDebt ?? 0;
  const heldReleaseAt = wallet?.heldReleaseAt ?? null;
  const hasDebt = sellerDebt > 0;

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

    // Seller debt blocks withdrawals — surface the dedicated copy upfront.
    if (hasDebt) {
      Alert.alert(
        WALLET_COPY.blockDebtAlertTitle,
        withMontant(WALLET_COPY.blockDebtAlertBody, sellerDebt),
        [{ text: WALLET_COPY.blockDebtCta, style: 'default' }],
      );
      return;
    }

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
  }, [user, wallet, router, hasDebt, sellerDebt]);

  /**
   * Map a failed withdrawal into the right user-facing copy.
   * The backend returns `functions/failed-precondition` for both the active
   * dispute and the seller-debt guards; the message text disambiguates them.
   */
  const presentWithdrawError = useCallback(
    (error: unknown) => {
      if (__DEV__) console.error('Wallet withdrawal error:', error);
      const code = getCallableErrorCode(error);
      const message = getCallableErrorMessage(error);

      if (code === 'functions/failed-precondition') {
        const lower = message.toLowerCase();
        if (lower.includes('litige')) {
          Alert.alert(
            WALLET_COPY.blockDisputeTitle,
            WALLET_COPY.blockDisputeBody,
            [{ text: WALLET_COPY.blockDisputeCta, style: 'default' }],
          );
          return;
        }
        if (lower.includes('dû') || lower.includes('régularis') || lower.includes('debt')) {
          Alert.alert(
            WALLET_COPY.blockDebtAlertTitle,
            withMontant(WALLET_COPY.blockDebtAlertBody, sellerDebt),
            [{ text: WALLET_COPY.blockDebtCta, style: 'default' }],
          );
          return;
        }
      }

      Alert.alert('Erreur', message);
    },
    [sellerDebt],
  );

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
                WALLET_COPY.withdrawSuccessTitle,
                WALLET_COPY.withdrawSuccessBody,
              );
              setShowWithdrawal(false);
              setWithdrawalInput('');
            } catch (error: unknown) {
              presentWithdrawError(error);
            }
          },
        },
      ],
    );
  }, [wallet, withdrawalInput, isWithdrawing, withdraw, presentWithdrawError]);

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleProtectionInfo = useCallback(() => {
    Alert.alert(WALLET_COPY.protectionTitle, WALLET_COPY.protectionBody, [
      { text: 'Compris', style: 'default' },
    ]);
  }, []);

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
      // A debt repayment is an allocation, not a balance movement: render it
      // neutrally (no +/-) so the seller sees their debt being cleared without
      // misreading it as a credit to the withdrawable balance.
      const isAllocation = item.type === 'debt_repayment';
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
              isAllocation
                ? styles.ledgerAmountNeutral
                : credit
                  ? styles.ledgerAmountCredit
                  : styles.ledgerAmountDebit,
            ]}
          >
            {isAllocation ? '' : credit ? '+' : '-'}
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
      <View style={styles.container} testID="wallet-screen">
        <ScreenHeader title="Porte-monnaie" onBack={() => router.back()} />
        <View style={styles.content}>
          <Skeleton
            width="100%"
            height={140}
            borderRadius={radius.lg}
            style={styles.skeletonBalance}
          />
          <View style={styles.skeletonActions}>
            <Skeleton width="48%" height={48} borderRadius={radius.md} />
            <Skeleton width="48%" height={48} borderRadius={radius.md} />
          </View>
          <Skeleton width={100} height={18} style={styles.skeletonTitle} />
          {Array.from({ length: 3 }).map((_, i) => (
            <View key={i} style={styles.skeletonLedger}>
              <Skeleton width={40} height={40} borderRadius={radius.full} />
              <View style={styles.skeletonLedgerContent}>
                <Skeleton width="60%" height={14} />
                <Skeleton
                  width="30%"
                  height={12}
                  style={styles.skeletonLedgerDate}
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
      <View style={styles.container} testID="wallet-screen">
        <ScreenHeader title="Porte-monnaie" onBack={() => router.back()} />
        <View style={styles.activationContainer} testID="wallet-activation">

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
            testID="wallet-activate-cta"
          >
            Activer mon porte-monnaie
          </Button>
        </View>
      </View>
    );
  }

  // ── State B: Wallet active ─────────────────────────────────────────────────

  return (
    <View style={styles.container} testID="wallet-screen">
      <ScreenHeader title="Porte-monnaie" onBack={() => router.back()} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
      >
        {/* Available balance card */}
        <View style={styles.balanceCard} testID="wallet-balance-card">
          <Text style={styles.balanceLabel}>{WALLET_COPY.availableLabel}</Text>
          <Text style={styles.balanceAmount}>
            {formatCents(wallet.balance)}
          </Text>
          <Text style={styles.balanceHint}>{WALLET_COPY.availableHint}</Text>
        </View>

        {/* Pending bucket — vente en cours */}
        {pendingBalance > 0 && (
          <View style={styles.bucketCard}>
            <View style={styles.bucketRow}>
              <View style={styles.bucketIconNeutral}>
                <Ionicons
                  name="time-outline"
                  size={18}
                  color={colors.muted}
                />
              </View>
              <View style={styles.bucketTextBlock}>
                <Text style={styles.bucketAmount}>
                  {`${formatCents(pendingBalance)} ${WALLET_COPY.pendingLabel}`}
                </Text>
                <Text style={styles.bucketHint}>{WALLET_COPY.pendingHint}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Held bucket — bientôt disponible (fenêtre de protection 7j) */}
        {heldBalance > 0 && (
          <View style={styles.bucketCard}>
            <View style={styles.bucketRow}>
              <View style={styles.bucketIconHeld}>
                <Ionicons
                  name="lock-closed-outline"
                  size={18}
                  color={colors.warning}
                />
              </View>
              <View style={styles.bucketTextBlock}>
                <Text style={styles.bucketAmount}>
                  {`${formatCents(heldBalance)} ${WALLET_COPY.heldLabel}`}
                </Text>
                {heldReleaseAt ? (
                  <Text style={styles.bucketReleaseLine}>
                    {`${WALLET_COPY.heldDatePrefix} ${formatReleaseDate(heldReleaseAt)}`}
                  </Text>
                ) : null}
                <Text style={styles.bucketHint}>{WALLET_COPY.heldHint}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Seller debt banner — blocks withdrawals */}
        {hasDebt && (
          <View style={styles.debtBanner}>
            <View style={styles.debtIcon}>
              <Ionicons
                name="alert-circle"
                size={18}
                color={colors.danger}
              />
            </View>
            <View style={styles.bucketTextBlock}>
              <Text style={styles.debtTitle}>
                {WALLET_COPY.blockDebtBannerTitle}
              </Text>
              <Text style={styles.debtBody}>
                {withMontant(WALLET_COPY.blockDebtBannerBody, sellerDebt)}
              </Text>
            </View>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionButton, hasDebt && styles.actionButtonDisabled]}
            onPress={handleWithdrawPress}
            testID="wallet-withdraw-button"
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

        {/* Protection note (7-day window) */}
        <Pressable style={styles.protectionNote} onPress={handleProtectionInfo}>
          <Ionicons
            name="shield-checkmark-outline"
            size={18}
            color={colors.sage}
          />
          <View style={styles.protectionTextBlock}>
            <Text style={styles.protectionTitle}>
              {WALLET_COPY.protectionTitle}
            </Text>
            <Text style={styles.protectionBody}>
              {WALLET_COPY.protectionBody}
            </Text>
          </View>
        </Pressable>

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

  skeletonBalance: {
    marginTop: spacing.lg,
  },
  skeletonTitle: {
    marginTop: spacing.xl,
  },
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
  skeletonLedgerContent: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  skeletonLedgerDate: {
    marginTop: spacing.xs,
  },

  // ── Activation (State A) ───────────────────────────────────────────────────

  activationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  activationIconCircle: {
    width: sizing.avatarXL,
    height: sizing.avatarXL,
    borderRadius: radius.full,
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
    fontSize: typography.hero.fontSize,
    lineHeight: typography.hero.lineHeight,
    letterSpacing: typography.hero.letterSpacing,
    color: colors.white,
  },
  balanceHint: {
    ...typography.caption,
    color: colors.whiteTranslucent,
    marginTop: spacing.xs,
  },

  // ── Buckets (pending / held) ───────────────────────────────────────────────

  bucketCard: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  bucketRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bucketIconNeutral: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    borderRadius: radius.full,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  bucketIconHeld: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    borderRadius: radius.full,
    backgroundColor: colors.warningLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  bucketTextBlock: {
    flex: 1,
  },
  bucketAmount: {
    ...typography.label,
    color: colors.foreground,
  },
  bucketReleaseLine: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.xs,
  },
  bucketHint: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
    lineHeight: 18,
  },

  // ── Seller debt banner ─────────────────────────────────────────────────────

  debtBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.dangerLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  debtIcon: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  debtTitle: {
    ...typography.label,
    color: colors.danger,
    marginBottom: spacing.xs,
  },
  debtBody: {
    ...typography.caption,
    color: colors.foreground,
    lineHeight: 18,
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
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionIconCircle: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    ...typography.label,
    color: colors.charcoal,
  },

  // ── Protection note ────────────────────────────────────────────────────────

  protectionNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.sageLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  protectionTextBlock: {
    flex: 1,
  },
  protectionTitle: {
    ...typography.label,
    color: colors.sage,
    marginBottom: spacing.xs,
  },
  protectionBody: {
    ...typography.caption,
    color: colors.foregroundSecondary,
    lineHeight: 18,
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
    ...typography.labelUppercase,
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
