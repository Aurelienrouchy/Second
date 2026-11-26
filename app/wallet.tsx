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
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { Redirect, useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Platform,
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
  components,
  fonts,
  radius,
  shadows,
  sizing,
  spacing,
  typography,
} from '@/constants/theme';
import { useAuthenticatedSession, useAuthenticatedUid } from '@/hooks/useAuth';
import { useWallet } from '@/features/wallet/hooks/useWallet';
import { WithdrawalTimingNotice } from '@/features/wallet';
import { useStripeAccount } from '@/features/wallet/hooks/useStripeAccount';
import { useWalletWithdrawalIdentity } from '@/hooks/useWalletWithdrawalIdentity';
import { parseConnectPayoutRestriction } from '@/features/wallet/utils/stripeRequirements';
import { WalletService } from '@/features/wallet/services/walletService';
import { AuthService } from '@/services/authService';
import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration } from '@/store/authStore';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { hasTerminalWithdrawalReceipt, hasQualifiedWithdrawalNonExecution } from '@/services/withdrawalIntentJournal';
import type { WalletLedgerEntry, WithdrawalRequest } from '@/types';
import type { WalletOrderReview, WithdrawalAttempt, WithdrawalIntentResult } from '@/types/wallet';
import { formatCents } from '@/utils/formatPrice';
import { track } from '@/lib/analytics';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';
import {isSmallBalanceSettlement} from '@/utils/smallBalanceClosure';
import {readScopedQuery} from '@/utils/readScopedQuery';

// =============================================================================
// COPY (spec UX_PAIEMENT_LIVRAISON — telle quelle)
// =============================================================================

const WALLET_COPY = {
  availableLabel: 'Mon solde',
  availableHint: 'Retraits à partir de 10,00 $.',
  pendingLabel: 'en attente',
  pendingHint:
    'Ventes en cours de finalisation.',
  heldLabel: 'fonds conservés',
  heldDatePrefix: 'Libération prévue à partir du',
  heldHint:
    'Disponibles après finalisation des commandes.',
  blockDisputeTitle: 'Retrait momentanément indisponible',
  blockDisputeBody:
    'Vos retraits sont suspendus pendant l’examen d’un dossier financier. Consultez vos ventes ou contactez notre équipe.',
  blockDisputeCta: 'Compris',
  blockDisputeBannerTitle: 'Litige en cours',
  blockDisputeBannerBody:
    'Les retraits sont suspendus pendant l’examen du litige. Consultez la vente concernée pour suivre son avancement.',
  blockDebtBannerTitle: 'Régularisation nécessaire',
  blockDebtBannerBody:
    'Un montant de {montant} reste à régulariser sur votre compte. Les retraits sont suspendus tant que ce solde n’est pas réglé. Vos prochaines ventes seront affectées à cette régularisation en priorité.',
  blockDebtAlertTitle: 'Retrait indisponible',
  blockDebtAlertBody:
    'Vous avez un montant à régulariser ({montant}). Une fois ce montant réglé, les autres vérifications financières et le statut du compte restent nécessaires avant un retrait.',
  blockDebtCta: 'Compris',
  withdrawSuccessTitle: 'Demande de retrait enregistrée',
  withdrawSuccessBody:
    'Consultez les demandes existantes pour suivre son traitement. Cet enregistrement ne confirme pas la réception des fonds sur votre compte bancaire.',
  withdrawalsSectionTitle: 'DEMANDES DE RETRAIT',
  withdrawalProcessingLabel: 'Retrait en traitement',
  withdrawalProcessingHint: 'Votre virement est en cours de traitement.',
  withdrawalCompletedLabel: 'Virement envoyé',
  withdrawalFailedLabel: 'Retrait échoué',
  withdrawalFailedHint:
    'Le virement n’a pas abouti. La restitution au solde dépend du retour des fonds confirmé.',
  // Internal balance movements — neutral, not a loss (F127).
  fundsHeldMovementHint: 'Fonds en attente de libération',
  fundsReleasedMovementHint: 'Fonds crédités au solde',
} as const;

// =============================================================================
// HELPERS
// =============================================================================

/** Substitute {montant} placeholder in copy strings. */
function withMontant(template: string, cents: number): string {
  return template.replace('{montant}', formatCents(cents));
}

/** Decimal input is accepted exactly; excess precision is never silently rounded. */
function parseWithdrawalCents(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseWalletOrderReview(value: unknown): WalletOrderReview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 100;
  const date = (v: unknown) => v === null || typeof v === 'string' && Number.isFinite(Date.parse(v));
  if (r.protocol !== 'wallet_order_review_v1' || r.scope !== 'seller_delivered_orders' || r.limit !== 100 ||
      !count(r.inspectedCount) || typeof r.truncated !== 'boolean' || r.globalCoverage !== false ||
      !count(r.blockedOrderCount) || !count(r.qualifiedCandidateCount) || r.blockedOrderCount > r.inspectedCount ||
      r.qualifiedCandidateCount > r.inspectedCount || r.truncated !== (r.inspectedCount === 100) ||
      !Array.isArray(r.deliveryCorrections) || r.deliveryCorrections.length > r.inspectedCount) return null;
  const seen = new Set<string>();
  for (const entry of r.deliveryCorrections) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const c = entry as Record<string, unknown>;
    if (typeof c.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(c.transactionId) || seen.has(c.transactionId) ||
        !(c.correctionId === null || typeof c.correctionId === 'string' && /^[a-f0-9]{64}$/.test(c.correctionId)) ||
        !['release_suspended', 'released_review_required', 'resolved', 'unqualified_marker'].includes(String(c.state)) ||
        typeof c.blocked !== 'boolean' || typeof c.resolutionReceiptQualified !== 'boolean' ||
        c.blocked === false && (c.state !== 'resolved' || c.resolutionReceiptQualified !== true) ||
        c.resolutionReceiptQualified === true && (c.blocked !== false || c.state !== 'resolved') ||
        typeof c.message !== 'string' || !c.message.trim() || c.message.length > 2000 || c.action !== 'contactSupport' ||
        !date(c.detectedAt) || !date(c.originalDeliveryAt) || !date(c.originalFundsReleaseAt) || !date(c.originalFundsReleasedAt)) return null;
    seen.add(c.transactionId);
  }
  if (r.deliveryCorrections.filter(c => c.blocked === true).length > r.blockedOrderCount) return null;
  return value as WalletOrderReview;
}

function withdrawalReceiptHint(receipt: WithdrawalIntentResult): string {
  if (hasQualifiedWithdrawalNonExecution(receipt)) return 'Cette demande n’a déclenché aucun virement. Terminez son suivi avant de faire un nouveau retrait.';
  if (receipt.ownerMessage) return receipt.ownerMessage;
  switch (receipt.operationState) {
    case 'completed': return 'Le prestataire confirme le versement de cette demande. Si vous ne le retrouvez pas, contactez notre équipe.';
    case 'recovered': return 'Les fonds sont revenus dans votre solde.';
    case 'submitted': return 'La demande de virement est enregistrée. Cela ne confirme pas encore la réception sur votre compte bancaire.';
    case 'reserved': return 'Les fonds de cette demande sont réservés. Son envoi bancaire reste à vérifier.';
    default: return 'Vérifiez le résultat de ce retrait avant de faire une nouvelle demande.';
  }
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
    color: colors.muted,
    bg: colors.backgroundSecondary,
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
  refund_hold: {
    name: 'lock-closed-outline',
    color: colors.muted,
    bg: colors.backgroundSecondary,
  },
  dispute_hold_released: {
    name: 'lock-open-outline',
    color: colors.muted,
    bg: colors.backgroundSecondary,
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

const LEDGER_LABELS: Record<WalletLedgerEntry['type'], string> = {
  sale_credit: 'Vente', purchase_debit: 'Achat', withdrawal: 'Retrait', refund_credit: 'Remboursement reçu',
  withdrawal_failed: 'Retour d’un retrait', funds_held: 'Fonds en attente', funds_released: 'Fonds disponibles',
  dispute_hold: 'Fonds retenus', refund_hold: 'Remboursement en cours', dispute_hold_released: 'Fin de la retenue',
  refund_debit: 'Remboursement d’un achat', debt_repayment: 'Régularisation',
};

/**
 * Internal balance movements (held ↔ available) within the protection window.
 * These shuffle money between the seller's own buckets — they are NOT a gain or
 * a loss, so they render WITHOUT a +/- sign and in a neutral tone (F127). A
 * `funds_held` line in particular must never look like a red debit.
 */
function isInternalMovement(type: WalletLedgerEntry['type']): boolean {
  return type === 'funds_held' || type === 'funds_released' || type === 'refund_hold' || type === 'dispute_hold_released' || type === 'dispute_hold';
}

/**
 * Credit-side entries are rendered with a leading "+" in success green.
 * Includes withdrawal_failed (a failed payout re-credited to the available
 * balance). funds_released is handled as a neutral internal movement, not a
 * credit (F127).
 */
function isCredit(type: WalletLedgerEntry['type']): boolean {
  return (
    type === 'sale_credit' ||
    type === 'refund_credit' ||
    type === 'withdrawal_failed'
  );
}

/** Presentation (icon + copy + tone) for an in-progress withdrawal request. */
function getWithdrawalPresentation(request: WithdrawalRequest): {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  label: string;
  hint: string;
} {
  if (request.status === 'not_executed' && request.nonExecutionReceiptQualified === true) return {
    icon: 'close-circle-outline', color: colors.warning, bg: colors.warningLight,
    label: 'Retrait non envoyé', hint: 'Cette demande n’a déclenché aucun virement.',
  };
  if (request.reconciliationRequired || request.payoutRecovery?.state === 'awaiting_return' ||
      request.payoutRecovery?.state === 'reconciliation_required') return {
    icon: 'alert-circle-outline', color: colors.warning, bg: colors.warningLight,
    label: 'Retrait à vérifier', hint: request.ownerMessage ?? 'Le résultat et le retour des fonds doivent être vérifiés. Aucune nouvelle demande ne peut utiliser ces fonds.',
  };
  if (request.recoveryReceiptQualified) return {
    icon: 'refresh-circle-outline', color: colors.success, bg: colors.successLight,
    label: 'Fonds revenus au solde', hint: 'Consultez votre solde pour voir le montant disponible.',
  };
  switch (request.status) {
    case 'completed':
      return {
        icon: 'checkmark-circle-outline',
        color: colors.success,
        bg: colors.successLight,
        label: request.completionReceiptQualified ? WALLET_COPY.withdrawalCompletedLabel : 'Versement à vérifier',
        hint: request.completionReceiptQualified ? 'Le versement a été envoyé. Vérifiez sa réception auprès de votre banque.'
          : 'Contactez notre équipe si ce versement n’apparaît pas sur votre compte bancaire.',
      };
    case 'failed':
      return {
        icon: 'alert-circle-outline',
        color: colors.danger,
        bg: colors.dangerLight,
        label: WALLET_COPY.withdrawalFailedLabel,
        hint: WALLET_COPY.withdrawalFailedHint,
      };
    case 'processing':
      return {
        icon: 'time-outline',
        color: colors.warning,
        bg: colors.warningLight,
        label: WALLET_COPY.withdrawalProcessingLabel,
        hint: WALLET_COPY.withdrawalProcessingHint,
      };
    default: return {
      icon: 'help-circle-outline', color: colors.warning, bg: colors.warningLight,
      label: 'Résultat du retrait à vérifier', hint: 'Le statut enregistré ne permet pas de confirmer un versement ou une restitution.',
    };
  }
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function WalletScreen() {
  const uid = useAuthenticatedUid();
  const linkedIdentitySession = useWalletWithdrawalIdentity(uid);
  const params = useLocalSearchParams<{closureSettlement?: string | string[]}>(), closureRequested = params.closureSettlement === 'review';
  if (!uid) return <Redirect href="/(tabs)/profile" />;
  return <WalletContent key={`${uid}:${getAuthSessionGeneration()}:${closureRequested}`} closureRequested={closureRequested} linkedIdentitySession={linkedIdentitySession}/>;
}

function WalletContent({closureRequested, linkedIdentitySession}: {closureRequested: boolean; linkedIdentitySession: ReturnType<typeof useWalletWithdrawalIdentity>}) {
  const router = useRouter();
  const { uid, identity: user } = useAuthenticatedSession();
  const screenContext = useRef({ active: false, epoch: 0 });
  const [focusEpoch, setFocusEpoch] = useState(0);
  useFocusEffect(useCallback(() => {
    let activity = AppState.currentState;
    screenContext.current.active = activity === 'active'; screenContext.current.epoch++;
    setFocusEpoch(screenContext.current.active ? screenContext.current.epoch : 0);
    const subscription = AppState.addEventListener('change', state => {
      if (state === activity) return; activity = state;
      screenContext.current.active = state === 'active'; screenContext.current.epoch++;
      setFocusEpoch(screenContext.current.active ? screenContext.current.epoch : 0);
    });
    return () => { subscription.remove(); screenContext.current.active = false; screenContext.current.epoch++; setFocusEpoch(0); };
  }, []));
  const captureCurrent = useCallback(() => {
    const session = captureTradeSession(uid ?? undefined), epoch = screenContext.current.epoch;
    if (!screenContext.current.active || AppState.currentState !== 'active') throw new Error('La page a changé.');
    return () => {
      assertTradeSessionCurrent(session);
      if (!screenContext.current.active || AppState.currentState !== 'active' || screenContext.current.epoch !== epoch) throw new Error('La page a changé.');
    };
  }, [uid]);
  const assertCurrentScreen = useCallback(() => {
    if (focusEpoch <= 0 || screenContext.current.epoch !== focusEpoch) throw new Error('La page a changé.');
    captureCurrent()();
  }, [captureCurrent, focusEpoch]);
  const { status: accountStatus, refetch: refetchAccountStatus, isFetching: isAccountFetching,
    isError: isAccountError } = useStripeAccount(uid ?? undefined, focusEpoch > 0, assertCurrentScreen, focusEpoch);

  const pendingWithdrawalQuery = useQuery({
    queryKey: ['wallet-withdrawal-intent', uid, getAuthSessionGeneration(), focusEpoch],
    queryFn: ({signal}) => readScopedQuery(signal, captureCurrent, current => WalletService.readPendingWithdrawal(uid!, current)),
    enabled: !!uid && focusEpoch > 0,
    staleTime: 0,
    gcTime: 15 * 60 * 1000,
    retry: false,
  });

  const {
    wallet,
    isLoading,
    isError,
    isRefetching,
    refetch,
    withdrawals,
    isLoadingWithdrawals,
    isWithdrawalsError,
    refetchWithdrawals,
    activate,
    isActivating,
  } = useWallet(!!uid && focusEpoch > 0, uid ?? undefined, assertCurrentScreen, focusEpoch);
  const [walletReviewEpoch, setWalletReviewEpoch] = useState<number | null>(null);
  useEffect(() => {
    if (!uid || focusEpoch <= 0) return;
    let mounted = true;
    let assertCurrent: () => void;
    try { assertCurrent = captureCurrent(); } catch { return; }
    void (async () => {
      const observation = await refetch();
      try { assertCurrent(); } catch { return; }
      if (mounted) setWalletReviewEpoch(observation.isSuccess && !observation.isError ? focusEpoch : null);
    })();
    return () => { mounted = false; };
  }, [uid, focusEpoch, captureCurrent, refetch]);
  const walletReviewCurrent = focusEpoch > 0 && walletReviewEpoch === focusEpoch && !isRefetching && !isError;
  const walletOrderReview = walletReviewCurrent ? parseWalletOrderReview(wallet?.walletOrderReview) : null;
  const knownOrderBlock = !!walletOrderReview && (walletOrderReview.blockedOrderCount > 0 || walletOrderReview.deliveryCorrections.some(c => c.blocked));
  const financialReview = walletReviewCurrent ? wallet?.walletFinancialReview ?? null : null;
  const debtReview = walletReviewCurrent ? wallet?.sellerDebtReview ?? null : null;
  const financialReadBlocked = !financialReview || financialReview.status !== 'clear' ||
    financialReview.coverage.some(coverage => coverage.truncated);
  const payoutRestriction = !isAccountFetching && !isAccountError && uid
    ? parseConnectPayoutRestriction(accountStatus?.payoutRestriction, uid) : null;
  const payoutStatusTitle = payoutRestriction?.category === 'under_review' ? 'Compte en cours de revue'
    : payoutRestriction?.category === 'restricted' ? 'Compte de paiement restreint'
    : payoutRestriction?.category === 'information_required' ? 'Informations à compléter'
    : payoutRestriction?.category === 'pending_verification' ? 'Vérification en attente'
    : payoutRestriction?.category === 'bank_destination' ? 'Destination bancaire à examiner'
    : 'Statut du compte à vérifier';
  const payoutStatusMessage = payoutRestriction?.message ?? 'Impossible de vérifier votre compte de paiement. Actualisez la page ou contactez notre équipe.';
  const restrictionRoute = payoutRestriction?.action === 'correctBankDetails' ? '/settings/bank-account' as const
    : payoutRestriction?.action === 'completeIdentityInformation' ? '/settings/stripe-onboarding' as const : '/settings/help' as const;

  // ── Withdrawal flow state ──────────────────────────────────────────────────

  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [expandedWithdrawal, setExpandedWithdrawal] = useState<string | null>(null);
  const [withdrawalInput, setWithdrawalInput] = useState('');
  const [withdrawPassword, setWithdrawPassword] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawalReview, setWithdrawalReview] = useState<{ attempt: WithdrawalAttempt; last4: string } | null>(null);
  const withdrawalBusy = useRef(false);
  const withdrawalProvider = AuthService.getAuthProvider();
  const withdrawalUsesPassword = withdrawalProvider === 'password' ||
    (withdrawalProvider === 'apple.com' && Platform.OS !== 'ios' && AuthService.hasPasswordProvider());
  const canReauthenticateWithdrawal = withdrawalProvider === 'password' || withdrawalProvider === 'google.com' ||
    (withdrawalProvider === 'apple.com' && (Platform.OS === 'ios' || AuthService.hasPasswordProvider()));
  const {proof: linkedIdentity, busy: linkedIdentityBusy, notice: linkedIdentityNotice,
    assertProof: assertLinkedWithdrawalIdentity, clear: clearLinkedIdentity, bindReview: bindLinkedIdentityReview} = linkedIdentitySession;
  const linkedIdentityReady = linkedIdentitySession.ready &&
    (!linkedIdentity?.reviewRequestId || linkedIdentity.reviewRequestId === withdrawalReview?.attempt.requestId);
  const identityDisplayKey = linkedIdentity ? JSON.stringify([linkedIdentity.uid, linkedIdentity.authTime, linkedIdentity.navigationRevision]) : null;
  const [displayedIdentity, setDisplayedIdentity] = useState<string | null>(null);
  const identityAtMount = useRef(linkedIdentity);
  if (identityDisplayKey !== displayedIdentity) {
    setDisplayedIdentity(identityDisplayKey); setWithdrawalInput(''); setWithdrawalReview(null);
    if (identityDisplayKey) setShowWithdrawal(true);
  }
  useFocusEffect(useCallback(() => {
    const resetInterruptedForm = () => {
      setWithdrawPassword(''); setShowWithdrawal(false); setWithdrawalInput('');
      setWithdrawalReview(null); setIsWithdrawing(false); withdrawalBusy.current = false;
    };
    if (!identityAtMount.current) resetInterruptedForm();
    const subscription = AppState.addEventListener('change', state => {if (state !== 'active') {resetInterruptedForm(); clearLinkedIdentity();}});
    return () => {subscription.remove(); resetInterruptedForm();};
  }, [setWithdrawPassword, setShowWithdrawal, setWithdrawalInput, setWithdrawalReview, clearLinkedIdentity]));

  // ── Derived buckets ──────────────────────────────────────────────────────
  const pendingBalance = wallet?.pendingBalance ?? 0;
  const heldBalance = wallet?.heldBalance ?? 0;
  const sellerDebt = debtReview?.sellerDebtCents ?? null;
  const heldReleaseAt = wallet?.heldReleaseAt ?? null;
  const hasDebt = sellerDebt !== null && sellerDebt > 0;
  // Payouts blocked while a Stripe account exists but verification isn't done
  // (KYC restriction / closed bank account). Distinct from "no account yet".
  const accountReady = accountStatus?.success === true && accountStatus.hasAccount && accountStatus.payoutEligible === true &&
    payoutRestriction?.category === 'none';
  const payoutsBlocked = !accountReady;
  const withdrawalInProgress = withdrawals.some(request => request.status === 'processing' || request.reconciliationRequired ||
    request.payoutRecovery?.state === 'awaiting_return' || request.payoutRecovery?.state === 'reconciliation_required' ||
    request.status === 'failed' && !request.recoveryReceiptQualified || request.status === 'unknown');
  const pendingWithdrawal = pendingWithdrawalQuery.data ?? null;
  const withdrawalReadBlocked = pendingWithdrawalQuery.isPending || pendingWithdrawalQuery.isError || !!pendingWithdrawal;
  // The URL selects an examination only. The first small request still needs
  // recent reauthentication and a fresh native paused-closure context below.
  const smallClosureReview = closureRequested && wallet?.hasWallet === true && Number.isSafeInteger(wallet.balance) && wallet.balance >= 1 && wallet.balance < 1000;
  const hasWithdrawableAmount = wallet !== null && Number.isSafeInteger(wallet.balance) &&
    (wallet.balance >= 1000 || smallClosureReview);
  const canWithdraw = (PAYMENTS_ENABLED || smallClosureReview) && accountReady && wallet?.hasWallet === true && wallet.status === 'active' &&
    hasWithdrawableAmount && !hasDebt && !financialReadBlocked && debtReview?.status === 'qualified' && !knownOrderBlock &&
    !withdrawalReadBlocked && !withdrawalInProgress && !isWithdrawalsError && !isLoadingWithdrawals;
  // Server observations preserve the identity of each dossier. A refund or a
  // release on another order cannot resolve a reserve here.
  const hasActiveDisputeHold = financialReview?.status === 'blocked' &&
    financialReview.reasons.some(reason => reason === 'bank_dispute' || reason === 'commercial_dispute');

  // Emit wallet_viewed once the wallet resolves (activated or not).
  const viewedRef = useRef(false);
  useEffect(() => {
    if (isLoading || sellerDebt === null || viewedRef.current) return;
    viewedRef.current = true;
    track('wallet_viewed', {
      has_wallet: !!wallet?.hasWallet,
      balance_cents: wallet?.balance ?? 0,
      pending_balance_cents: pendingBalance,
      held_balance_cents: heldBalance,
      seller_debt_cents: sellerDebt,
      has_active_dispute_hold: hasActiveDisputeHold,
      payouts_blocked: payoutsBlocked,
      withdrawals_in_progress_count: withdrawals.filter((w) => w.status === 'processing').length,
    });
  }, [
    isLoading,
    wallet,
    pendingBalance,
    heldBalance,
    sellerDebt,
    hasActiveDisputeHold,
    payoutsBlocked,
    withdrawals,
  ]);

  const handleActivate = useCallback(async () => {
    if (!PAYMENTS_ENABLED || !uid) return;
    let assertCurrent: () => void;
    try { assertCurrent = captureCurrent(); } catch { return; }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await activate();
      assertCurrent();
      track('wallet_activated', { success: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      try { assertCurrent(); } catch { return; }
      if (__DEV__) console.error('Wallet activation error:', error);
      track('wallet_activated', {
        success: false,
        error_code: getCallableErrorCode(error) ?? undefined,
      });
      const msg =
        error instanceof Error
          ? error.message
          : "Impossible d'activer le porte-monnaie.";
      Alert.alert('Erreur', msg);
    }
  }, [activate, uid, captureCurrent]);

  const handleWithdrawPress = useCallback(() => {
    if ((!PAYMENTS_ENABLED && !smallClosureReview) || !uid) return;
    try { captureCurrent()(); } catch { return; }

    const balanceCents = wallet?.balance ?? 0;

    if (financialReadBlocked || debtReview?.status !== 'qualified') {
      Alert.alert('Situation financière à vérifier', 'Les vérifications actuelles ne permettent pas une nouvelle demande de retrait. Consultez les dossiers ou contactez notre équipe.');
      return;
    }

    // Seller debt blocks withdrawals — surface the dedicated copy upfront.
    if (hasDebt) {
      track('withdrawal_cta_tapped', {
        outcome: 'blocked',
        balance_cents: balanceCents,
        blocked_reason: 'debt',
      });
      Alert.alert(
        WALLET_COPY.blockDebtAlertTitle,
        sellerDebt === null ? 'Le montant à régulariser reste à vérifier.' : withMontant(WALLET_COPY.blockDebtAlertBody, sellerDebt),
        [{ text: WALLET_COPY.blockDebtCta, style: 'default' }],
      );
      return;
    }

    // No Stripe account yet → guide to setup.
    if (accountStatus?.success === true && accountStatus.hasAccount === false) {
      Alert.alert(
        'Compte de paiement requis',
        'Configurez votre compte de paiement pour retirer vos fonds.',
        [
          {
            text: 'Annuler',
            style: 'cancel',
            onPress: () =>
              track('withdrawal_cta_tapped', {
                outcome: 'blocked',
                balance_cents: balanceCents,
                blocked_reason: 'no_stripe_account',
                cta_chosen: 'later',
              }),
          },
          {
            text: 'Configurer',
            onPress: () => {
              track('withdrawal_cta_tapped', {
                outcome: 'blocked',
                balance_cents: balanceCents,
                blocked_reason: 'no_stripe_account',
                cta_chosen: 'configure',
              });
              router.push('/settings/stripe-onboarding');
            },
          },
        ],
      );
      return;
    }

    // Account exists but payouts are disabled (KYC restriction / bank issue) →
    // surface the real blocker and route to remediation, never let the user
    // believe the account is fully active (F62/F117).
    if (!accountReady) {
      Alert.alert(
        payoutStatusTitle,
        payoutStatusMessage,
        [
          {
            text: 'Plus tard',
            style: 'cancel',
            onPress: () =>
              track('withdrawal_cta_tapped', {
                outcome: 'blocked',
                balance_cents: balanceCents,
                blocked_reason: 'payouts_disabled',
                cta_chosen: 'later',
              }),
          },
          {
            text: payoutRestriction?.action === 'correctBankDetails' ? 'Consulter la banque'
              : payoutRestriction?.action === 'completeIdentityInformation' ? 'Consulter les informations' : 'Contacter notre équipe',
            onPress: () => {
              track('withdrawal_cta_tapped', {
                outcome: 'blocked',
                balance_cents: balanceCents,
                blocked_reason: 'payouts_disabled',
                cta_chosen: 'resolve',
              });
              router.push(restrictionRoute);
            },
          },
        ],
      );
      return;
    }

    track('withdrawal_cta_tapped', {
      outcome: 'form_opened',
      balance_cents: balanceCents,
    });

    // Pre-fill with full balance in dollars
    if (wallet) {
      const dollars = (wallet.balance / 100).toFixed(2);
      setWithdrawalInput(dollars);
    }
    setShowWithdrawal(true);
  }, [uid, wallet, router, hasDebt, sellerDebt, accountStatus, accountReady, financialReadBlocked, debtReview,
    payoutStatusTitle, payoutStatusMessage, payoutRestriction, restrictionRoute, captureCurrent,
    setWithdrawalInput, setShowWithdrawal, smallClosureReview]);

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
            sellerDebt === null ? 'Le montant à régulariser reste à vérifier. Contactez notre équipe.' : withMontant(WALLET_COPY.blockDebtAlertBody, sellerDebt),
            [{ text: WALLET_COPY.blockDebtCta, style: 'default' }],
          );
          return;
        }
      }

      Alert.alert('Erreur', message);
    },
    [sellerDebt],
  );

  const handleWithdrawReview = useCallback(async () => {
    if (!wallet || withdrawalBusy.current || !canWithdraw || !uid) return;
    try { captureCurrent()(); } catch { return; }
    if (!withdrawalUsesPassword) {
      try { assertLinkedWithdrawalIdentity(); } catch (error) {
        clearLinkedIdentity(); Alert.alert('Identité à confirmer', error instanceof Error ? error.message : 'Confirmez votre identité.'); return;
      }
    }
    const bankAccountId = accountStatus?.bankAccountId;
    const last4 = accountStatus?.bankAccountLast4;
    if (!bankAccountId || !last4 || !canReauthenticateWithdrawal || (withdrawalUsesPassword && !withdrawPassword)) {
      Alert.alert('Identité et compte à vérifier', withdrawalUsesPassword && !withdrawPassword
        ? 'Saisissez votre mot de passe pour confirmer votre identité.'
        : 'Actualisez le compte bancaire avant une demande.'); return;
    }
    const amountCents = parseWithdrawalCents(withdrawalInput);
    if (amountCents === null) { Alert.alert('Montant invalide', 'Saisissez un montant avec au plus deux décimales.'); return; }
    if (amountCents < 1000 && !smallClosureReview) { Alert.alert('Montant minimum', 'Le montant minimum de retrait est de 10,00 $.'); return; }
    if (amountCents > wallet.balance) { Alert.alert('Solde insuffisant', 'Actualisez le solde puis vérifiez le montant.'); return; }
    if (smallClosureReview) {
      let assertCurrent: () => void; try {assertCurrent = captureCurrent();} catch {return;}
      withdrawalBusy.current = true; setIsWithdrawing(true); setWithdrawalReview(null);
      try {
        if (withdrawalUsesPassword) await AuthService.reauthenticate(withdrawPassword, assertCurrent);
        else if (linkedIdentityReady) assertCurrent();
        else throw new Error('Confirmez votre identité avec un moyen de connexion disponible.');
        assertCurrent();
        const closure = await AuthService.deleteAccount('pause', {expectedUid: uid, assertCurrent}); assertCurrent();
        const context = closure.smallBalanceSettlement;
        if (closure.status === 'complete' || closure.deletionComplete || !isSmallBalanceSettlement(context)) throw new Error('La fermeture en pause et le petit solde intégral doivent être vérifiés. Aucun retrait n’a été demandé.');
        const freshWallet = await refetch(), freshAccount = await refetchAccountStatus(); assertCurrent();
        if (!withdrawalUsesPassword) assertLinkedWithdrawalIdentity();
        if (freshWallet.isError || freshWallet.data?.balance !== context.amountCents || freshAccount.isError || freshAccount.data?.payoutEligible !== true || freshAccount.data.bankAccountId !== bankAccountId || freshAccount.data.bankAccountLast4 !== last4 || parseConnectPayoutRestriction(freshAccount.data.payoutRestriction, uid)?.category !== 'none') throw new Error('Le solde ou la banque a changé. Relisez le dossier avant confirmation.');
        setWithdrawalInput((context.amountCents / 100).toFixed(2));
        const attempt: WithdrawalAttempt = {version: 1, uid, requestId: randomUUID(), amountCents: context.amountCents, bankAccountId, closureSettlement: {protocol: context.protocol, sourceHash: context.sourceHash}};
        if (!withdrawalUsesPassword) bindLinkedIdentityReview(attempt.requestId, linkedIdentity);
        setWithdrawalReview({attempt, last4});
      } catch (error) {try {assertCurrent(); Alert.alert('Restitution à vérifier', error instanceof Error ? error.message : 'Relisez la fermeture et le petit solde.');} catch {/* No replacement owner's alert. */}}
      finally {try {assertCurrent(); setIsWithdrawing(false); withdrawalBusy.current = false;} catch {/* Original frame only. */}}
      return;
    }
    if (!withdrawalUsesPassword) {
      let assertCurrent: () => void; try {assertCurrent = captureCurrent();} catch {return;}
      withdrawalBusy.current = true; setIsWithdrawing(true);
      try {
        const [freshWallet, freshAccount] = await Promise.all([refetch(), refetchAccountStatus()]); assertCurrent();
        assertLinkedWithdrawalIdentity();
        if (freshWallet.isError || freshAccount.isError || freshWallet.data?.balance !== wallet.balance ||
            freshAccount.data?.payoutEligible !== true || freshAccount.data.bankAccountId !== bankAccountId || freshAccount.data.bankAccountLast4 !== last4 ||
            parseConnectPayoutRestriction(freshAccount.data.payoutRestriction, uid)?.category !== 'none') throw new Error('Le solde ou la banque a changé. Relisez-les avant de vérifier le retrait.');
        const attempt: WithdrawalAttempt = {version: 1, uid, requestId: randomUUID(), amountCents, bankAccountId};
        bindLinkedIdentityReview(attempt.requestId, linkedIdentity);
        setWithdrawalReview({attempt, last4});
      } catch (error) {try {assertCurrent(); Alert.alert('Retrait à vérifier', error instanceof Error ? error.message : 'Relisez le solde et la banque.');} catch {/* Old navigation cannot present a review. */}}
      finally {try {assertCurrent(); setIsWithdrawing(false); withdrawalBusy.current = false;} catch {/* Original active frame only. */}}
      return;
    }
    setWithdrawalReview({ attempt: { version: 1, uid, requestId: randomUUID(), amountCents, bankAccountId }, last4 });
  }, [wallet, canWithdraw, uid, captureCurrent, accountStatus, canReauthenticateWithdrawal,
    withdrawalUsesPassword, withdrawPassword, withdrawalInput, setWithdrawalReview, setWithdrawalInput, smallClosureReview, withdrawalProvider, refetch, refetchAccountStatus,
    linkedIdentityReady, linkedIdentity, assertLinkedWithdrawalIdentity, clearLinkedIdentity, bindLinkedIdentityReview]);

  const handleWithdrawConfirm = useCallback(async () => {
    if (!withdrawalReview || !wallet || isWithdrawing || withdrawalBusy.current || !canWithdraw) return;
    let assertCurrent: () => void;
    try { assertCurrent = captureCurrent(); } catch { return; }
    const { attempt, last4 } = withdrawalReview;
    if (!withdrawalUsesPassword) {
      try { assertLinkedWithdrawalIdentity(attempt.requestId); } catch (error) {
        clearLinkedIdentity(); setWithdrawalReview(null); Alert.alert('Identité à confirmer', error instanceof Error ? error.message : 'Confirmez votre identité.'); return;
      }
    }
    const actor = captureTradeSession(attempt.uid);
    const confirmedPassword = withdrawPassword;
    if (!canReauthenticateWithdrawal || (withdrawalUsesPassword && !confirmedPassword)) return;
    withdrawalBusy.current = true;
    setIsWithdrawing(true);
    let journalMayExist = false;
    try {
      assertCurrent();
      if (withdrawalUsesPassword) await AuthService.reauthenticate(confirmedPassword, assertCurrent);
      else if (linkedIdentityReady) assertCurrent();
      else throw new Error('Contactez notre équipe pour vérifier votre identité.');
      assertCurrent();
      const currentUser = auth.currentUser;
      if (!currentUser || currentUser.uid !== actor.uid) throw new Error('La session a changé.');
      await currentUser.getIdToken(true);
      assertCurrent();
      setWithdrawPassword('');
      if (attempt.closureSettlement) {
        const closure = await AuthService.deleteAccount('pause', {expectedUid: attempt.uid, assertCurrent}); assertCurrent();
        if (!isSmallBalanceSettlement(closure.smallBalanceSettlement) || closure.smallBalanceSettlement.sourceHash !== attempt.closureSettlement.sourceHash || closure.smallBalanceSettlement.amountCents !== attempt.amountCents) throw new Error('Le contexte de fermeture ou le solde a changé. Relisez-le avant une nouvelle confirmation.');
      }
      const observed = await refetchAccountStatus();
      assertCurrent();
      if (observed.isError || observed.data?.success !== true || observed.data.payoutEligible !== true ||
          observed.data.bankAccountId !== attempt.bankAccountId || observed.data.bankAccountLast4 !== last4 ||
          parseConnectPayoutRestriction(observed.data.payoutRestriction, attempt.uid)?.category !== 'none') {
        throw new Error('Le statut ou la destination bancaire a changé. Relisez le compte avant une nouvelle demande.');
      }
      assertCurrent();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // The service persists the exact intention before dispatch. Any subsequent
      // error retains it, including a server refusal or an interrupted response.
      if (!withdrawalUsesPassword) assertLinkedWithdrawalIdentity(attempt.requestId);
      journalMayExist = true;
      clearLinkedIdentity();
      const receipt = await WalletService.withdrawFromWallet(attempt, { assertCurrent });
      assertCurrent();
      track('withdrawal_submitted', { amount_cents: attempt.amountCents, validation_result: 'ok',
        success: receipt.intentCommitted });
      setShowWithdrawal(false); setWithdrawalInput(''); setWithdrawalReview(null);
      // Never assign receipt.newBalance: it is the historical debit receipt.
      await pendingWithdrawalQuery.refetch();
      assertCurrent();
      await Promise.allSettled([refetch(), refetchWithdrawals()]);
      assertCurrent();
    } catch (error: unknown) {
      try { assertCurrent(); } catch { return; }
      track('withdrawal_submitted', { amount_cents: attempt.amountCents, validation_result: 'ok',
        success: false, error_code: getCallableErrorCode(error) ?? undefined });
      if (journalMayExist) {
        setShowWithdrawal(false); setWithdrawalInput(''); setWithdrawalReview(null);
        await pendingWithdrawalQuery.refetch();
        try { assertCurrent(); } catch { return; }
        Alert.alert('Retrait à vérifier', 'Relisez la demande enregistrée. Le montant et la banque restent liés à cette demande ; aucune seconde demande ne sera envoyée.');
      } else presentWithdrawError(error);
    } finally {
      try { assertCurrent(); setWithdrawPassword(''); setIsWithdrawing(false); withdrawalBusy.current = false; } catch { /* Stale screen cannot adopt an outcome. */ }
    }
  }, [withdrawalReview, wallet, isWithdrawing, canWithdraw, captureCurrent, withdrawPassword, canReauthenticateWithdrawal, linkedIdentityReady, linkedIdentity, assertLinkedWithdrawalIdentity, clearLinkedIdentity,
    withdrawalUsesPassword, withdrawalProvider, refetchAccountStatus, pendingWithdrawalQuery, refetch, refetchWithdrawals, presentWithdrawError,
    setWithdrawPassword, setShowWithdrawal, setWithdrawalInput, setWithdrawalReview]);

  const handleFinishWithdrawal = useCallback(async () => {
    if (!pendingWithdrawal || withdrawalBusy.current || !hasTerminalWithdrawalReceipt(pendingWithdrawal.receipt)) return;
    let assertCurrent: () => void;
    try { assertCurrent = captureCurrent(); } catch { return; }
    withdrawalBusy.current = true; setIsWithdrawing(true);
    try {
      await WalletService.finishWithdrawal(pendingWithdrawal.attempt, assertCurrent);
      assertCurrent();
      await pendingWithdrawalQuery.refetch();
      assertCurrent();
      await Promise.allSettled([refetch(), refetchWithdrawals()]);
      assertCurrent();
    } catch (error: unknown) {
      try { assertCurrent(); } catch { return; }
      presentWithdrawError(error);
    } finally {
      try { assertCurrent(); setIsWithdrawing(false); withdrawalBusy.current = false; } catch { /* Keep the journal after a stale result. */ }
    }
  }, [pendingWithdrawal, captureCurrent, pendingWithdrawalQuery, refetch, refetchWithdrawals, presentWithdrawError]);

  const handleRefresh = useCallback(async () => {
    let assertCurrent: () => void;
    try { assertCurrent = captureCurrent(); } catch { return; }
    track('list_refreshed', { screen: 'wallet', items_count: withdrawals.length });
    await pendingWithdrawalQuery.refetch();
    assertCurrent();
    await Promise.allSettled([refetch(), refetchWithdrawals(), refetchAccountStatus()]);
    assertCurrent();
    // General balance/list observations never clear the original intention.
  }, [pendingWithdrawalQuery, refetch, refetchWithdrawals, refetchAccountStatus, withdrawals.length, captureCurrent]);

  const pendingWithdrawalPanel = pendingWithdrawalQuery.isPending ? (
    <Text style={styles.bucketHint}>Lecture de la dernière demande de retrait…</Text>
  ) : pendingWithdrawalQuery.isError ? (
    <View style={styles.withdrawalsSection}>
      <Text style={styles.withdrawalTitle}>Demande de retrait à vérifier</Text>
      <Text style={styles.inputHint}>Vérifiez votre dernière demande avant d’effectuer un nouveau retrait.</Text>
      <Button variant="secondary" onPress={handleRefresh}>Relire la demande</Button>
      <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
    </View>
  ) : pendingWithdrawal ? (
    <View style={styles.withdrawalsSection}>
      <Text style={styles.withdrawalTitle}>{hasQualifiedWithdrawalNonExecution(pendingWithdrawal.receipt) ? 'Demande refusée avant engagement' : 'Suivi de votre demande de retrait'}</Text>
      <Text style={styles.ledgerDescription}>{formatCents(pendingWithdrawal.attempt.amountCents)}</Text>
      <Text style={styles.inputHint}>{withdrawalReceiptHint(pendingWithdrawal.receipt)}</Text>
      {hasTerminalWithdrawalReceipt(pendingWithdrawal.receipt) ? <Button variant="secondary" loading={isWithdrawing}
        disabled={isWithdrawing || pendingWithdrawalQuery.isFetching} onPress={handleFinishWithdrawal}>Terminer</Button>
        : <Button variant="secondary" disabled={isWithdrawing || pendingWithdrawalQuery.isFetching} onPress={handleRefresh}>Actualiser le retrait</Button>}
      <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
    </View>
  ) : null;

  // ── Ledger list ────────────────────────────────────────────────────────────

  // The backend returns the ledger already sorted most-recent-first
  // (orderBy createdAt desc). Render it as-is — do NOT reverse (F47).
  const sortedLedger = wallet?.ledger ?? [];

  const renderLedgerItem = useCallback(
    ({ item }: { item: WalletLedgerEntry }) => {
      const knownType = typeof item.type === 'string' && Object.prototype.hasOwnProperty.call(LEDGER_ICON_MAP, item.type);
      const icon = knownType ? LEDGER_ICON_MAP[item.type] : {
        name: 'help-circle' as const,
        color: colors.muted,
        bg: colors.backgroundSecondary,
      };
      // Neutral entries carry NO +/- sign and a calm tone:
      //  - debt_repayment: an allocation clearing a debt, not a balance credit.
      //  - funds_held / funds_released: internal moves between the seller's own
      //    buckets (held ↔ available). A `funds_held` line must never read as a
      //    red loss — it is the protection window, not a debit (F127).
      const isAllocation = item.type === 'debt_repayment';
      const isMovement = isInternalMovement(item.type);
      const isNeutral = !knownType || isAllocation || isMovement;
      const credit = knownType && isCredit(item.type);

      // Clarify what an internal movement means right under the description.
      const movementHint =
        item.type === 'funds_held'
          ? WALLET_COPY.fundsHeldMovementHint
          : item.type === 'funds_released'
            ? WALLET_COPY.fundsReleasedMovementHint
            : item.type === 'refund_hold'
              ? 'Réserve interne pendant le traitement du remboursement'
              : item.type === 'dispute_hold_released'
                ? 'Fin d’un gel interne ; cette ligne n’est pas un nouveau revenu'
                : item.type === 'dispute_hold'
                  ? 'Fonds déplacés vers une réserve interne ; cette ligne n’est pas une nouvelle dépense'
            : null;
      const qualifiedFinancialEntry = item.financialQualification === 'qualified';
      const debtAdded = qualifiedFinancialEntry && item.type === 'refund_debit' &&
        typeof item.debtRecordedCents === 'number' && Number.isSafeInteger(item.debtRecordedCents) && item.debtRecordedCents >= 0
        ? item.debtRecordedCents : null;

      return (
        <View style={styles.ledgerItem}>
          <View style={[styles.ledgerIcon, { backgroundColor: icon.bg }]}>
            <Ionicons name={icon.name} size={20} color={icon.color} />
          </View>
          <View style={styles.ledgerContent}>
            <Text style={styles.ledgerDescription}>{knownType ? LEDGER_LABELS[item.type] : 'Mouvement à vérifier'}</Text>
            {movementHint ? (
              <Text style={styles.ledgerMovementHint}>{movementHint}</Text>
            ) : null}
            {item.type === 'refund_debit' && <Text style={styles.ledgerMovementHint}>{debtAdded !== null
              ? `${formatCents(item.amount)} prélevés dans les soldes ; ${formatCents(debtAdded)} ajoutés au montant à régulariser.`
              : 'L’attribution entre solde prélevé et montant à régulariser reste à vérifier.'}</Text>}
            {isAllocation && <Text style={styles.ledgerMovementHint}>{qualifiedFinancialEntry && item.amountMeaning === 'debt_allocation'
              ? `${formatCents(item.amount)} affectés à la régularisation. Cette ligne n’est pas un versement au solde disponible.`
              : 'Cette allocation reste à vérifier ; elle ne prouve pas un versement au solde disponible.'}</Text>}
            <Text style={styles.ledgerDate}>
              {formatRelativeDate(item.createdAt)}
            </Text>
          </View>
          <Text
            style={[
              styles.ledgerAmount,
              isNeutral
                ? styles.ledgerAmountNeutral
                : credit
                  ? styles.ledgerAmountCredit
                  : styles.ledgerAmountDebit,
            ]}
          >
            {!knownType && (!Number.isSafeInteger(item.amount) || item.amount < 0) ? 'Montant à vérifier'
              : item.type === 'refund_debit' && item.amount === 0 && debtAdded !== null && debtAdded > 0
              ? `Dette +${formatCents(debtAdded)}`
              : `${isNeutral ? '' : credit ? '+' : '-'}${formatCents(Math.abs(item.amount))}`}
          </Text>
        </View>
      );
    },
    [],
  );

  const historyAccess = <View style={styles.historyLinks}><Pressable accessibilityRole="button" accessibilityLabel="Consulter l’historique financier"
    testID="wallet-history-link"
    style={styles.historyAccess} onPress={() => {
      if (!uid) return;
      try { captureTradeSession(uid); router.push('/wallet/history' as never); } catch { /* SDK owner identity is required. */ }
    }}><Ionicons name="receipt-outline" size={sizing.iconMD} color={colors.foreground} />
      <Text style={styles.historyLinkLabel}>Tout l’historique</Text>
      <Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Aide pour les fonds bloqués"
      testID="wallet-holds-link"
      style={styles.historyAccess} onPress={() => {
        try {captureCurrent()(); router.push('/wallet/holds' as never);} catch { /* Existing sales require the current SDK owner. */ }
      }}><Ionicons name="hourglass-outline" size={sizing.iconMD} color={colors.foreground} />
        <Text style={styles.historyLinkLabel}>Aide pour les fonds bloqués</Text>
        <Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
      </Pressable></View>;

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

  if (isError || !wallet) return <View style={styles.container} testID="wallet-screen">
    <ScreenHeader title="Porte-monnaie" onBack={() => router.back()} />
    <View style={styles.activationContainer}>
      <Text style={styles.activationTitle}>Solde à vérifier</Text>
      <Text style={styles.activationDescription}>Impossible de consulter le porte-monnaie pour le moment. Aucune activation n’a été lancée.</Text>
      {pendingWithdrawalPanel}
      <Button onPress={handleRefresh}>Réessayer la consultation</Button>
      <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
      {historyAccess}
    </View>
  </View>;

  // ── State A: Wallet not activated ──────────────────────────────────────────

  if (!wallet.hasWallet && withdrawals.length === 0 && !pendingWithdrawal && !pendingWithdrawalQuery.isError) {
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
            {PAYMENTS_ENABLED ? 'Activez votre porte-monnaie' : 'Aucun porte-monnaie existant'}
          </Text>
          <Text style={styles.activationDescription}>
            {PAYMENTS_ENABLED ? 'Recevez vos gains de vente dans votre porte-monnaie. Les achats et retraits restent soumis au statut de votre compte.'
              : 'Les nouveaux paiements et l’activation de nouveaux porte-monnaie sont désactivés. Vous pouvez consulter vos dossiers existants et contacter notre équipe.'}
          </Text>
          {pendingWithdrawalPanel}
          {PAYMENTS_ENABLED && !withdrawalReadBlocked && <Button
            variant="primary"
            fullWidth
            loading={isActivating}
            disabled={isActivating}
            onPress={handleActivate}
            style={styles.activateButton}
            testID="wallet-activate-cta"
          >
            Activer mon porte-monnaie
          </Button>}
          {isLoadingWithdrawals ? <Text style={styles.activationDescription}>Lecture des demandes de retrait existantes…</Text> : null}
          {isWithdrawalsError ? <Text style={styles.activationDescription}>Impossible de relire les demandes de retrait existantes.</Text> : null}
          <Button variant="secondary" onPress={handleRefresh}>Actualiser la consultation</Button>
          <Button variant="ghost" onPress={() => router.push('/settings/stripe-onboarding')}>Consulter le compte de paiement</Button>
          <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
          {historyAccess}
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
        {wallet.hasWallet ? <View style={styles.balanceCard} testID="wallet-balance-card">
          <Text style={styles.balanceLabel}>{WALLET_COPY.availableLabel}</Text>
          <Text style={styles.balanceAmount}>
            {formatCents(wallet.balance)}
          </Text>
          <Text style={styles.balanceHint}>{!PAYMENTS_ENABLED ? 'Consultation uniquement : les nouveaux paiements et retraits sont désactivés.'
            : payoutsBlocked ? 'Le statut actuel du compte ne permet pas de retrait. Le solde reste consultable.' : hasDebt ? 'Une régularisation est nécessaire avant un retrait.' : WALLET_COPY.availableHint}</Text>
        </View> : <Text style={styles.activationDescription}>Aucun porte-monnaie actif. Les demandes de retrait existantes restent consultables ci-dessous.</Text>}
        {pendingWithdrawalPanel}
        {financialReadBlocked || financialReview?.status === 'blocked' ? <View style={styles.disputeBanner} accessibilityRole="alert">
          <View style={styles.bucketTextBlock}>
            <Text style={styles.disputeTitle}>{financialReview?.status === 'blocked' ? 'Nouveaux retraits suspendus pour le compte'
              : financialReadBlocked ? 'Situation financière à vérifier' : 'Vérifications financières du compte'}</Text>
            <Text style={styles.debtBody}>{financialReview?.status === 'blocked'
              ? 'Les retraits sont suspendus pendant l’examen d’une commande.'
              : 'Actualisez la page ou contactez notre équipe pour vérifier la disponibilité de vos fonds.'}</Text>
            {financialReview?.linkedOrders.map(order => <Button key={order.transactionId} variant="ghost" onPress={() => {
              try { captureCurrent()(); } catch { return; }
              router.push({ pathname: '/orders/[id]', params: { id: order.transactionId } });
            }}>Voir la commande</Button>)}
            {financialReadBlocked && <Button variant="ghost" onPress={() => router.push('/settings/help')}>Faire examiner la situation</Button>}
          </View>
        </View> : null}
        {knownOrderBlock || !walletOrderReview || walletOrderReview.truncated ? <View style={styles.disputeBanner}>
          <View style={styles.bucketTextBlock}>
            <Text style={styles.disputeTitle}>Vérification des commandes</Text>
            <Text style={styles.debtBody}>Certaines commandes doivent être vérifiées. Consultez leur détail ou contactez notre équipe.</Text>
            {walletOrderReview?.deliveryCorrections.map(correction => <View key={correction.transactionId}>
              <Text style={styles.disputeTitle}>{correction.blocked ? 'Correction de livraison à examiner' : 'Correction examinée'}</Text>
              <Text style={styles.debtBody}>{correction.message}</Text>
              <Button variant="ghost" onPress={() => {
                try { captureCurrent()(); } catch { return; }
                router.push({ pathname: '/orders/[id]', params: { id: correction.transactionId } });
              }}>Consulter cette commande</Button>
              <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter l’équipe</Button>
            </View>)}
          </View>
        </View> : null}

        {/* Pending bucket — vente en cours */}
        {pendingBalance > 0 && (
          <Pressable style={styles.bucketCard} accessibilityRole="button" accessibilityLabel="Suivre mes ventes en cours"
            testID="wallet-pending-sales-link" onPress={() => {
              try {captureCurrent()(); router.push('/my-sales');} catch { /* Keep the current owner for this navigation. */ }
            }}>
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
              <Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted} />
            </View>
          </Pressable>
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
                {heldReleaseAt && walletOrderReview && !walletOrderReview.truncated && !knownOrderBlock && !financialReadBlocked ? (
                  <Text style={styles.bucketReleaseLine}>
                    {`Premières disponibilités prévues dès le ${formatReleaseDate(heldReleaseAt)}`}
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
                {sellerDebt === null ? 'Le montant actuel reste à vérifier.' : withMontant(WALLET_COPY.blockDebtBannerBody, sellerDebt)}
              </Text>
              <Text style={styles.debtBody}>Les mouvements récents ne représentent pas l’historique complet de cette régularisation. Les autres conditions du compte restent applicables.</Text>
              <Button variant="ghost" onPress={() => router.push('/settings/help')}>Faire examiner la régularisation</Button>
            </View>
          </View>
        )}

        {/* Server-qualified financial reserve; never inferred from unrelated ledger entries. */}
        {hasActiveDisputeHold && (
          <View style={styles.disputeBanner}>
            <View style={styles.disputeIcon}>
              <Ionicons name="alert-circle" size={18} color={colors.warning} />
            </View>
            <View style={styles.bucketTextBlock}>
              <Text style={styles.disputeTitle}>
                {WALLET_COPY.blockDisputeBannerTitle}
              </Text>
              <Text style={styles.debtBody}>
                {WALLET_COPY.blockDisputeBannerBody}
              </Text>
            </View>
          </View>
        )}

        {/* Payouts blocked banner — action required (F62/F117) */}
        {payoutsBlocked && (
          <View
            style={styles.payoutBlockedBanner}
            testID="wallet-payouts-blocked"
          >
            <View style={styles.payoutBlockedIcon}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
            </View>
            <View style={styles.bucketTextBlock}>
              <Text style={styles.debtTitle}>
                {payoutStatusTitle}
              </Text>
              <Text accessibilityRole="alert" style={styles.debtBody}>
                {payoutStatusMessage} Le solde et l’historique restent accessibles.
              </Text>
              <Button variant="ghost" onPress={() => router.push(restrictionRoute)}>{payoutRestriction?.action === 'correctBankDetails'
                ? 'Consulter la destination bancaire' : payoutRestriction?.action === 'completeIdentityInformation'
                  ? 'Consulter les informations demandées' : 'Contacter notre équipe'}</Button>
              <Button variant="ghost" disabled={isAccountFetching} onPress={handleRefresh}>Actualiser le statut</Button>
            </View>
          </View>
        )}

        {/* Action buttons */}
        {PAYMENTS_ENABLED && !showWithdrawal && <View style={styles.actionRow}>
          <Pressable
            style={[
              styles.actionButton,
              !canWithdraw && styles.actionButtonDisabled,
            ]}
            disabled={!canWithdraw}
            accessibilityRole="button"
            accessibilityLabel="Retirer de l’argent"
            accessibilityHint={!hasWithdrawableAmount ? 'Au moins 10 dollars de solde disponible sont nécessaires.' : undefined}
            accessibilityState={{disabled: !canWithdraw}}
            onPress={handleWithdrawPress}
            testID="wallet-withdraw-button"
          >
            <Ionicons name="download-outline" size={20} color={colors.foreground} />
            <Text style={styles.actionLabel}>Retirer</Text>
          </Pressable>
        </View>}

        {/* Bank account management — useful after a failed payout (F60) */}
        {(accountStatus?.hasAccount || !!user?.stripeAccountId) && (
          <Pressable
            style={styles.bankLinkRow}
            onPress={() => router.push('/settings/bank-account')}
            testID="wallet-bank-account-link"
          >
            <View style={styles.actionIconCircle}>
              <Ionicons
                name="business-outline"
                size={18}
                color={colors.primary}
              />
            </View>
            <View style={styles.bucketTextBlock}>
              <Text style={styles.bankLinkTitle}>Compte bancaire</Text>
              <Text style={styles.bankLinkSubtitle}>
                Gérer vos comptes de retrait
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}
        {wallet.balance > 0 && wallet.balance < 1000 && <View style={styles.disputeBanner}>
          <View style={styles.bucketTextBlock}>
            <Text style={styles.disputeTitle}>Solde inférieur au minimum de retrait</Text>
            <Text style={styles.debtBody}>Le minimum de retrait est de 10,00 $. Votre solde de {formatCents(wallet.balance)} est conservé.</Text>
            {smallClosureReview ? <Button variant="secondary" disabled={!canWithdraw} onPress={handleWithdrawPress}>Examiner la restitution du petit solde entier</Button> : <Button variant="ghost" onPress={() => router.push('/settings/delete-account')}>Consulter la fermeture et le petit solde</Button>}
            <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
          </View>
        </View>}

        {/* Withdrawal form (inline) */}
        {showWithdrawal && canWithdraw && (
          <View style={styles.withdrawalForm}>
            <Text style={styles.withdrawalTitle}>{smallClosureReview ? 'Restitution liée à une fermeture en pause' : 'Retrait'}</Text>
            {smallClosureReview ? <Text style={styles.inputHint}>Votre identité sera confirmée et votre demande de fermeture sera mise en pause pour suivre vos engagements existants. Le solde entier et la banque seront vérifiés et présentés avant l’envoi. Cette restitution ne supprime pas votre compte.</Text> : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Montant</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  accessibilityLabel="Montant du retrait en dollars canadiens"
                  accessibilityHint={smallClosureReview ? 'Petit solde entier, relu depuis la fermeture mise en pause' : 'Montant minimum de 10 dollars canadiens'}
                  accessibilityState={{ disabled: isWithdrawing }}
                  style={styles.input}
                  placeholder="0,00"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  value={withdrawalInput}
                  onChangeText={value => { setWithdrawalInput(value); setWithdrawalReview(null); }}
                  editable={!isWithdrawing && !smallClosureReview}
                />
                <Text style={styles.inputCurrency}>$</Text>
              </View>
              <Text style={styles.inputHint}>
                {smallClosureReview ? 'Restitution du solde entier uniquement, entre 0,01 $ et 9,99 $.' : 'Montant minimum : 10,00 $'}
              </Text>
            </View>

            {withdrawalUsesPassword ? <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirmer mon identité</Text>
              <TextInput accessibilityLabel="Mot de passe pour confirmer mon identité avant le retrait" accessibilityState={{ disabled: isWithdrawing }} style={styles.input} value={withdrawPassword} onChangeText={value => { setWithdrawPassword(value); setWithdrawalReview(null); }}
                secureTextEntry autoCapitalize="none" editable={!isWithdrawing}
                placeholder="Mot de passe" placeholderTextColor={colors.muted} />
            </View> : <View style={styles.inputGroup}>
              <Text style={styles.inputHint}>{canReauthenticateWithdrawal
                ? linkedIdentityReady ? 'Identité confirmée.' : `Confirmez votre identité avec ${withdrawalProvider === 'google.com' ? 'Google' : 'Apple'} pour continuer.`
                : 'Contactez notre équipe pour confirmer votre identité.'}</Text>
              {canReauthenticateWithdrawal ? <Button variant="secondary" loading={linkedIdentityBusy}
                disabled={linkedIdentityBusy || isWithdrawing || linkedIdentityReady}
                onPress={() => { setWithdrawalReview(null); setWithdrawalInput(''); void linkedIdentitySession.verify(); }}>Confirmer mon identité</Button> : null}
              {linkedIdentityNotice ? <Text accessibilityLiveRegion="polite" style={styles.inputHint}>{linkedIdentityNotice}</Text> : null}
            </View>}

            {withdrawalReview ? <View style={styles.withdrawalSummary}>
              <Text style={styles.bucketAmount}>{formatCents(withdrawalReview.attempt.amountCents)}</Text>
              <Text style={styles.inputHint}>Vers votre compte •••• {withdrawalReview.last4}</Text>
            </View> : null}

            <View style={styles.withdrawalActions}>
              <Button
                variant="muted"
                style={styles.withdrawalActionButton}
                onPress={() => {
                  setShowWithdrawal(false);
                  setWithdrawalInput('');
                  setWithdrawPassword('');
                  setWithdrawalReview(null);
                  clearLinkedIdentity();
                }}
                disabled={isWithdrawing}
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                style={styles.withdrawalActionButton}
                loading={isWithdrawing}
                disabled={isWithdrawing || linkedIdentityBusy || !canWithdraw || !canReauthenticateWithdrawal ||
                  (withdrawalUsesPassword ? !withdrawPassword : !linkedIdentityReady)}
                onPress={withdrawalReview ? handleWithdrawConfirm : handleWithdrawReview}
              >
                {withdrawalReview ? 'Confirmer le retrait' : 'Continuer'}
              </Button>
            </View>
          </View>
        )}

        {isLoadingWithdrawals ? <Text style={styles.bucketHint}>Lecture des demandes de retrait existantes…</Text> : null}
        {isWithdrawalsError ? <View style={styles.withdrawalsSection}>
          <Text style={styles.bucketHint}>Impossible de relire les demandes de retrait existantes.</Text>
          <Button variant="secondary" onPress={() => { void refetchWithdrawals(); }}>Réessayer</Button>
        </View> : null}
        {/* Retraits en cours (withdrawal_requests) — F128 */}
        {withdrawals.length > 0 && (
          <View style={styles.withdrawalsSection}>
            <Text style={styles.historySectionTitle}>
              {WALLET_COPY.withdrawalsSectionTitle}
            </Text>
            {withdrawals.map((w) => {
              const p = getWithdrawalPresentation(w);
              return (
                <View key={w.id} style={styles.withdrawalRow}>
                  <View style={[styles.ledgerIcon, { backgroundColor: p.bg }]}>
                    <Ionicons name={p.icon} size={20} color={p.color} />
                  </View>
                  <View style={styles.ledgerContent}>
                    <Text style={styles.ledgerDescription}>{p.label}</Text>
                    <Text style={styles.withdrawalHint}>
                      {w.status === 'completed' && !w.completionReceiptQualified && !w.reconciliationRequired ? p.hint : w.ownerMessage ?? p.hint}
                    </Text>
                    <Text style={styles.ledgerDate}>
                      {w.createdAt ? formatRelativeDate(w.createdAt.toISOString()) : 'Date de demande à vérifier'}
                    </Text>
                    <Text style={styles.ledgerDate}>
                      {w.nonExecutionReceiptQualified ? 'Aucun montant débité.' : w.historicalDestination ? `${w.historicalDestination.bankName ? `${w.historicalDestination.bankName} · ` : ''}•••• ${w.historicalDestination.last4}`
                        : 'Compte destinataire à vérifier'}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityState={{expanded: expandedWithdrawal === w.id}}
                      style={styles.withdrawalDetailsToggle} onPress={() => setExpandedWithdrawal(expandedWithdrawal === w.id ? null : w.id)}>
                      <Text style={styles.bankLinkSubtitle}>{expandedWithdrawal === w.id ? 'Masquer les détails' : 'Détails du retrait'}</Text>
                    </Pressable>
                    {expandedWithdrawal === w.id ? <>
                    {w.destinationQualification === 'legacy_saved_payout' ? <Text style={styles.ledgerDate}>
                      Ancien virement rapproché par sa référence bancaire. Le masque du compte d’origine n’est pas disponible.
                    </Text> : null}
                    {!w.nonExecutionReceiptQualified ? <WithdrawalTimingNotice withdrawalRequestId={w.id} sourceKey={JSON.stringify([w.status, w.reconciliationRequired ?? null, w.payoutId ?? null, w.completionReceiptQualified ?? null])} /> : null}
                    {w.payoutFailure ? <Text style={styles.ledgerDate}>
                      {w.payoutFailure.status === 'canceled' ? 'Annulation bancaire' : 'Échec bancaire'}
                      {` · ${formatReleaseDate(w.payoutFailure.observedAt.toISOString())}`}
                    </Text> : null}
                    {w.payoutRecovery?.compensatedAt && w.recoveryReceiptQualified ? <Text style={styles.ledgerDate}>
                      Restitution confirmée le {formatReleaseDate(w.payoutRecovery.compensatedAt.toISOString())}
                    </Text> : null}
                    {(w.nonExecutionReceiptQualified || w.reconciliationRequired || w.payoutFailure || w.status === 'failed' || w.status === 'unknown' || w.status === 'completed') ? <>
                      <Button variant="ghost" onPress={handleRefresh}>Actualiser le retrait</Button>
                      {(w.ownerAction === 'getStripeAccountStatus' || w.ownerBankAction === 'getStripeAccountStatus') ?
                        <Button variant="ghost" onPress={() => router.push('/settings/bank-account')}>Vérifier le compte bancaire</Button> : null}
                      <Button variant="ghost" onPress={() => {
                        try {
                          assertCurrentScreen();
                          router.push({ pathname: '/settings/support', params: { kind: 'withdrawal_timing_assistance', withdrawalRequestId: w.id } } as never);
                        } catch { /* Keep a stale account or screen from selecting a withdrawal. */ }
                      }}>Obtenir de l’aide</Button>
                    </> : null}
                    </> : null}
                  </View>
                  <Text style={[styles.ledgerAmount, { color: p.color }]}>
                    {w.amountQualified ? formatCents(w.amount) : 'Montant à vérifier'}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Transaction history */}
        <View style={styles.historySection}>
          <Text style={styles.historySectionTitle}>HISTORIQUE</Text>
          {historyAccess}

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

  // ── Active dispute banner ──────────────────────────────────────────────────

  disputeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.warningLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  disputeIcon: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  disputeTitle: {
    ...typography.label,
    color: colors.warning,
    marginBottom: spacing.xs,
  },

  // ── Payouts blocked banner ─────────────────────────────────────────────────

  payoutBlockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  payoutBlockedIcon: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Bank account link ──────────────────────────────────────────────────────

  bankLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  bankLinkTitle: {
    ...typography.label,
    color: colors.foreground,
  },
  bankLinkSubtitle: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },

  // ── Action buttons ─────────────────────────────────────────────────────────

  actionRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  actionButton: {
    ...components.button.container,
    ...components.button.primary,
    flex: 1,
  },
  actionButtonDisabled: {
    opacity: components.button.disabledOpacity,
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
    ...components.button.label,
    ...components.button.primaryLabel,
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
  withdrawalSummary: {padding: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md},
  withdrawalDetailsToggle: {paddingVertical: spacing.sm},
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

  // ── Withdrawals in progress ──────────────────────────────────────────────────

  withdrawalsSection: {
    marginTop: spacing.xl,
  },
  withdrawalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  withdrawalHint: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
    lineHeight: 16,
  },

  // ── History ────────────────────────────────────────────────────────────────

  historySection: {
    marginTop: spacing.xl,
  },
  historyAccess: {paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  historyLinks: {alignSelf: 'stretch', marginVertical: spacing.sm},
  historyLinkLabel: {...typography.bodySmall, color: colors.foreground, flex: 1},
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
  ledgerMovementHint: {
    ...typography.caption,
    color: colors.muted,
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
  ledgerAmountNeutral: {
    color: colors.sage,
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
