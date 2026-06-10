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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  StripeAccountService,
  type ReplaceBankAccountInput,
} from '@/services/stripeAccountService';

export function useStripeAccount(userId: string | undefined, enabled = true) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.stripe.all });

  const {
    data: status,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.stripe.accountStatus(userId),
    queryFn: () => StripeAccountService.getAccountStatus(),
    enabled: enabled && !!userId,
    staleTime: 30 * 1000,
  });

  const uploadDocumentMutation = useMutation({
    mutationFn: ({ frontUri, backUri }: { frontUri: string; backUri?: string }) =>
      StripeAccountService.uploadIdentityDocument(frontUri, backUri),
    onSuccess: invalidate,
  });

  const replaceBankMutation = useMutation({
    mutationFn: (input: ReplaceBankAccountInput) =>
      StripeAccountService.replaceBankAccount(input),
    onSuccess: invalidate,
  });

  return {
    status: status ?? null,
    isLoading,
    isRefetching,
    refetch,

    uploadDocument: uploadDocumentMutation.mutateAsync,
    isUploadingDocument: uploadDocumentMutation.isPending,

    replaceBankAccount: replaceBankMutation.mutateAsync,
    isReplacingBank: replaceBankMutation.isPending,
  };
}
