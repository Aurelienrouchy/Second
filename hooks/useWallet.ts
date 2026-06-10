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
import { WalletService } from '@/services/walletService';

/**
 * @param enabled Gates the wallet info query (auth presence).
 * @param userId  When provided, also fetches the user's withdrawal requests
 *                (retraits en traitement) — read-only, owner-scoped.
 */
export function useWallet(enabled = true, userId?: string) {
  const queryClient = useQueryClient();

  // ── Query ──────────────────────────────────────────────────────────────────

  const {
    data: wallet,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.wallet.info(),
    queryFn: () => WalletService.getWalletInfo(),
    enabled,
    staleTime: 2 * 60 * 1000, // 2 min
  });

  // ── Withdrawal requests (retraits en traitement) ────────────────────────────

  const {
    data: withdrawals = [],
    isLoading: isLoadingWithdrawals,
    refetch: refetchWithdrawals,
  } = useQuery({
    queryKey: queryKeys.wallet.withdrawals(userId ?? ''),
    queryFn: () => WalletService.getWithdrawalRequests(userId!),
    enabled: enabled && !!userId,
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
    mutationFn: (amount: number) => WalletService.withdrawFromWallet(amount),
    onSuccess: invalidateWallet,
  });

  const payWithWalletMutation = useMutation({
    mutationFn: (transactionId: string) =>
      WalletService.payWithWallet(transactionId),
    onSuccess: () => {
      invalidateWallet();
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
    },
  });

  return {
    wallet: wallet ?? null,
    isLoading,
    isRefetching,
    refetch,

    activate: activateMutation.mutateAsync,
    isActivating: activateMutation.isPending,

    withdraw: withdrawMutation.mutateAsync,
    isWithdrawing: withdrawMutation.isPending,

    payWithWallet: payWithWalletMutation.mutateAsync,
    isPayingWithWallet: payWithWalletMutation.isPending,
  };
}
