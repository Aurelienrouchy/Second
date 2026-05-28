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

export function useWallet(enabled = true) {
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

  // ── Mutations ──────────────────────────────────────────────────────────────

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
