/**
 * Tests métier — useOfferTransaction (components/offer-bubble/useOfferTransaction.ts).
 *
 * Règle métier : une fois une offre 'accepted' et NON-meetup (livraison),
 * la bulle doit retrouver la transaction liée au chat pour afficher le bouton
 * « Payer ». Le hook :
 *  - ne charge RIEN tant que l'offre n'est pas acceptée ;
 *  - ne charge RIEN pour une offre meetup (paiement en main propre) ;
 *  - expose isLoading pendant la requête puis le transactionId au succès ;
 *  - reste silencieux (pas de set state) si l'effet est annulé / en erreur.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { TransactionService } from '@/services/transactionService';

import { useOfferTransaction } from './useOfferTransaction';

jest.mock('@/services/transactionService', () => ({
  TransactionService: {
    getTransactionByChat: jest.fn(),
  },
}));

const getTransactionByChat = TransactionService.getTransactionByChat as jest.Mock;

const baseParams = {
  status: 'accepted' as const,
  isMeetupOffer: false,
  chatId: 'chat-1',
  currentUserId: 'user-1',
};

describe('useOfferTransaction', () => {
  it('ne requête pas la transaction tant que l’offre est pending', () => {
    renderHook(() => useOfferTransaction({ ...baseParams, status: 'pending' }));
    expect(getTransactionByChat).not.toHaveBeenCalled();
  });

  it('ne requête pas pour une offre meetup acceptée (paiement en main propre)', () => {
    renderHook(() => useOfferTransaction({ ...baseParams, isMeetupOffer: true }));
    expect(getTransactionByChat).not.toHaveBeenCalled();
  });

  it('charge la transaction du chat dès qu’une offre livraison est acceptée', async () => {
    getTransactionByChat.mockResolvedValueOnce({ id: 'tx-42' });

    const { result } = renderHook(() => useOfferTransaction(baseParams));

    await waitFor(() => expect(result.current.transactionId).toBe('tx-42'));
    expect(getTransactionByChat).toHaveBeenCalledWith('chat-1', 'user-1');
    expect(result.current.isLoading).toBe(false);
  });

  it('reste sans transaction si aucune n’existe encore pour ce chat', async () => {
    getTransactionByChat.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useOfferTransaction(baseParams));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.transactionId).toBeNull();
  });

  it('avale les erreurs réseau sans crasher ni exposer de transaction', async () => {
    getTransactionByChat.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useOfferTransaction(baseParams));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.transactionId).toBeNull();
  });

  it('n’écrit pas le transactionId si le composant est démonté avant la résolution', async () => {
    let resolve!: (value: { id: string }) => void;
    getTransactionByChat.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );

    const { result, unmount } = renderHook(() => useOfferTransaction(baseParams));

    unmount();
    await act(async () => {
      resolve({ id: 'tx-late' });
      await Promise.resolve();
    });

    // Le hook a posé `cancelled = true` au cleanup → pas de fuite de state.
    expect(result.current.transactionId).toBeNull();
  });

  it('relance une requête quand le chat change', async () => {
    getTransactionByChat.mockResolvedValue({ id: 'tx-a' });

    const { rerender } = renderHook<
      ReturnType<typeof useOfferTransaction>,
      typeof baseParams
    >((props) => useOfferTransaction(props), {
      initialProps: baseParams,
    });

    await waitFor(() => expect(getTransactionByChat).toHaveBeenCalledTimes(1));

    rerender({ ...baseParams, chatId: 'chat-2' });

    await waitFor(() => expect(getTransactionByChat).toHaveBeenCalledTimes(2));
    expect(getTransactionByChat).toHaveBeenLastCalledWith('chat-2', 'user-1');
  });
});
