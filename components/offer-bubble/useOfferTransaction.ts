/**
 * useOfferTransaction — loads the transaction tied to a chat once an offer
 * is accepted (and isn't a meetup offer).
 *
 * Returns `{ transactionId, isLoading }` so the parent bubble can render the
 * "Pay now" button when ready.
 */

import { useEffect, useState } from 'react';

import { TransactionService } from '@/services/transactionService';
import type { OfferStatus } from '@/types';

interface UseOfferTransactionParams {
  status: OfferStatus;
  isMeetupOffer: boolean;
  chatId: string;
  currentUserId: string;
}

export function useOfferTransaction({
  status,
  isMeetupOffer,
  chatId,
  currentUserId,
}: UseOfferTransactionParams) {
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (status !== 'accepted' || isMeetupOffer) return;

    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        const transaction = await TransactionService.getTransactionByChat(
          chatId,
          currentUserId,
        );
        if (transaction && !cancelled) {
          setTransactionId(transaction.id);
        }
      } catch (error) {
        if (__DEV__) console.error('Error loading transaction:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, isMeetupOffer, chatId, currentUserId]);

  return { transactionId, isLoading };
}
