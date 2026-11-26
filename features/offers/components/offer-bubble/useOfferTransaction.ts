import { useCallback, useEffect } from 'react';
import { CancelledError, useQuery } from '@tanstack/react-query';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransactionService } from '@/services/transactionService';
import { hasBankObligation, hasUnsettledRefund } from '@/utils/refundPresentation';
import type { OfferStatus } from '@/types';

interface UseOfferTransactionParams {
  status: OfferStatus;
  isMeetupOffer: boolean;
  chatId: string;
  currentUserId: string;
  messageId: string;
  linkedTransactionId?: string;
  sellerId?: string;
}
/** Exact offer proof, account-scoped cache and a conservative legacy fallback.
 * A terminal/blocked agreement never becomes a new payable transaction. */
export function useOfferTransaction({status, isMeetupOffer, chatId, currentUserId, messageId, linkedTransactionId, sellerId}: UseOfferTransactionParams) {
  const context = useShippingPurchaseContext(JSON.stringify(['offer-payment', chatId, messageId, linkedTransactionId, sellerId]), currentUserId || null);
  const eligible = status === 'accepted' && !isMeetupOffer && !!chatId && !!currentUserId && !!messageId;
  const enabled = eligible && context.focused;
  const result = useQuery({
    queryKey: ['offer-transaction', currentUserId, chatId, messageId, linkedTransactionId ?? '', sellerId ?? '', status, isMeetupOffer, getAuthSessionGeneration(), context.focusRevision],
    queryFn: async ({signal}) => {
      try {
        if (signal.aborted) throw new CancelledError({revert: true});
        const operation = context.capture();
        // Reservation links the exact order onto this message atomically. A
        // seller waits for that native message update instead of querying the
        // buyer-only discovery index or polling every accepted offer.
        if (sellerId === currentUserId && !linkedTransactionId) return {transaction: null, canStartCheckout: false, ambiguous: false};
        const receipt = await TransactionService.getTransactionForOffer(chatId, operation.session.uid, messageId, linkedTransactionId);
        context.assertCurrent(operation);
        return receipt;
      } catch (error) {
        if (signal.aborted || error && typeof error === 'object' && 'code' in error && error.code === 'client/stale-operation') {
          throw new CancelledError({revert: true});
        }
        throw error;
      }
    },
    enabled, staleTime: 30_000,
  });
  const refresh = useCallback(() => {
    if (!enabled) return;
    try {context.capture();} catch {return;}
    void result.refetch();
  }, [enabled, result.refetch, context.frame, context.focusRevision]);
  const observed = enabled ? result.data?.transaction ?? null : null;
  const transaction = observed && observed.chatId === chatId && observed.offerMessageId === messageId &&
    observed.deliveryType === 'shipping' && [observed.buyerId, observed.sellerId].includes(currentUserId) ? observed : null;
  useEffect(() => {
    if (!enabled || !transaction?.id) return;
    return TransactionService.subscribeToTransaction(transaction.id, refresh, refresh);
  }, [enabled, transaction?.id, refresh]);
  const payable = !!transaction && transaction.status === 'pending_payment' && transaction.buyerId === currentUserId &&
    transaction.offerMessageId === messageId && !hasUnsettledRefund(transaction) && !hasBankObligation(transaction);
  return {
    transactionId: payable ? transaction.id : null,
    transaction,
    isLoading: eligible && (!context.focused || result.isLoading),
    canStartCheckout: enabled && currentUserId !== sellerId && result.data?.canStartCheckout === true && !result.error,
    blocked: enabled && (!!result.error || result.data?.ambiguous === true || !!observed && (!transaction || !payable)),
    error: enabled ? result.error : null,
    beginPayment: () => context.start(),
    refresh,
  };
}
