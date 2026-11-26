/**
 * useStripeAccount — React Query hook pour le cycle de vie du compte vendeur
 * Stripe Connect Custom (white-label).
 *
 * Expose :
 * - le statut complet (charges/payouts/requirements/disabledReason/bankLast4)
 * - le refresh manuel inconditionnel (F62/F117)
 * - la mutation d'upload de document d'identité KYC (F59)
 * - la mutation de remplacement de compte bancaire (F60)
 *
 * Le statut est volatil (Stripe le met à jour de façon asynchrone) → staleTime
 * court ; invalidation après chaque mutation.
 */

import { CancelledError, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { getAuthSessionGeneration } from '@/store/authStore';
import {assertTradeSessionCurrent} from '@/services/tradeOperation';
import {
  StripeAccountService,
  isStaleConnectObservation,
  type BankAccountOperationInput,
} from '@/features/wallet/services/stripeAccountService';

export function useStripeAccount(userId: string | undefined, enabled = true, assertContext?: () => void, contextKey?: number | string, options?: {includeBankAccounts?: true}) {
  const queryClient = useQueryClient();
  const generation = getAuthSessionGeneration();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.stripe.all });

  const {
    data: status,
    isLoading,
    isRefetching,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: [...queryKeys.stripe.accountStatus(userId), generation, contextKey ?? 'account', options?.includeBankAccounts ? 'banks' : 'status'],
    queryFn: async ({signal}) => {
      const assertCurrent = () => {
        if (signal.aborted) throw new CancelledError({silent: true});
        try {assertTradeSessionCurrent({uid: userId ?? '', generation});}
        catch {throw new CancelledError({silent: true});}
        assertContext?.();
      };
      try { return await StripeAccountService.getAccountStatus(userId, assertCurrent, options); }
      catch (error) {
        if (signal.aborted) throw new CancelledError({silent: true});
        // A failed read from an obsolete route is cancellation, not a new
        // visible account failure. Current network/provider errors remain errors.
        try {assertCurrent();} catch {throw new CancelledError({silent: true});}
        throw error;
      }
    },
    enabled: enabled && !!userId,
    staleTime: 30 * 1000,
    // The service already performs the bounded, owner-bound Connect rereads.
    // Retain the normal two retries for other current read failures.
    retry: (failureCount, error) => !isStaleConnectObservation(error) &&
      !(error && typeof error === 'object' && 'code' in error && error.code === 'client/stale-operation') && failureCount < 2,
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: ({ frontUri, backUri, assertContext }: { frontUri: string; backUri?: string; assertContext?: () => void }) =>
      StripeAccountService.uploadIdentityDocument(frontUri, backUri, userId, assertContext),
    onSuccess: invalidate,
  });

  // Bank coordinates must not become variables retained by the mutation cache.
  const replaceBankAccount = async ({ input, assertCurrent }: { input: BankAccountOperationInput; assertCurrent?: () => void }) => {
    const response = await StripeAccountService.replaceBankAccount(input, userId, assertCurrent);
    await invalidate();
    assertCurrent?.();
    return response;
  };

  return {
    status: status ?? null,
    isLoading,
    isRefetching,
    isFetching,
    isError,
    refetch,

    uploadDocument: uploadDocumentMutation.mutateAsync,
    isUploadingDocument: uploadDocumentMutation.isPending,

    replaceBankAccount,
  };
}
