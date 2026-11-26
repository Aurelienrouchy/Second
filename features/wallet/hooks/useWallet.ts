/**
 * useWallet — React Query hook for the virtual wallet (porte-monnaie).
 *
 * Provides:
 * - wallet data (balance, ledger, status)
 * - activate / withdraw / payWithWallet mutations
 * - automatic query invalidation after mutations
 *
 * All amounts from the backend are in **cents**.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { WalletService } from '@/features/wallet/services/walletService';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { getAuthSessionGeneration } from '@/store/authStore';
import {assertTradeSessionCurrent} from '@/services/tradeOperation';
import {readScopedQuery} from '@/utils/readScopedQuery';
import type { WithdrawalAttempt } from '@/types/wallet';

/**
 * @param enabled Gates the wallet info query (auth presence).
 * @param userId  When provided, also fetches the user's withdrawal requests
 *                (retraits en traitement) — read-only, owner-scoped.
 */
export function useWallet(enabled = true, userId?: string, assertContext?: () => void, contextKey?: number) {
  const queryClient = useQueryClient();
  const authenticatedUid = useAuthenticatedUid();
  const ownerUid = userId ?? authenticatedUid;
  const generation = getAuthSessionGeneration();
  const canRead = enabled && !!ownerUid && ownerUid === authenticatedUid;
  const captureReadGuard = () => () => {
    assertTradeSessionCurrent({uid: ownerUid ?? '', generation});
    assertContext?.();
  };

  // ── Query ──────────────────────────────────────────────────────────────────

  const {
    data: wallet,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: [...queryKeys.wallet.info(), ownerUid, generation, contextKey ?? 'wallet'],
    queryFn: ({signal}) => readScopedQuery(signal, captureReadGuard, current => WalletService.getWalletInfo(ownerUid!, current)),
    enabled: canRead,
    staleTime: 2 * 60 * 1000, // 2 min
    retry: false,
  });

  // ── Withdrawal requests (retraits en traitement) ────────────────────────────

  const {
    data: withdrawals = [],
    isLoading: isLoadingWithdrawals,
    isError: isWithdrawalsError,
    refetch: refetchWithdrawals,
  } = useQuery({
    queryKey: [...queryKeys.wallet.withdrawals(ownerUid ?? ''), generation, contextKey ?? 'wallet'],
    queryFn: ({signal}) => readScopedQuery(signal, captureReadGuard, () => WalletService.getWithdrawalRequests(ownerUid!)),
    enabled: canRead && !!userId,
    staleTime: 60 * 1000, // 1 min — payout lifecycle moves slowly
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  // Invalidating the `wallet` root key also refreshes the withdrawals list
  // (queryKeys.wallet.withdrawals lives under the same `['wallet']` prefix).
  const invalidateWallet = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.wallet.all });

  const activateMutation = useMutation({
    mutationFn: () => WalletService.activateWallet(),
    onSuccess: invalidateWallet,
  });

  const withdrawMutation = useMutation({
    mutationFn: (input: { attempt: WithdrawalAttempt; assertCurrent: () => void }) =>
      WalletService.withdrawFromWallet(input.attempt, { assertCurrent: input.assertCurrent }),
    onSuccess: invalidateWallet,
  });

  const payWithWalletMutation = useMutation({
    mutationFn: (transactionId: string) =>
      WalletService.payWithWallet(transactionId, { expectedUid: ownerUid ?? undefined }),
    onSuccess: () => {
      invalidateWallet();
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
    },
  });

  return {
    wallet: wallet ?? null,
    isLoading,
    isError,
    isRefetching,
    refetch,

    withdrawals,
    isLoadingWithdrawals,
    isWithdrawalsError,
    refetchWithdrawals,

    activate: activateMutation.mutateAsync,
    isActivating: activateMutation.isPending,

    withdraw: withdrawMutation.mutateAsync,
    isWithdrawing: withdrawMutation.isPending,

    payWithWallet: payWithWalletMutation.mutateAsync,
    isPayingWithWallet: payWithWalletMutation.isPending,
  };
}
