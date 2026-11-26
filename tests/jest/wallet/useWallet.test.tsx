import { establishIdentityFixture } from '@/tests/jest/helpers/identityFixture';
beforeEach(() => establishIdentityFixture('u1'));
/**
 * useWallet — hook React Query du porte-monnaie (lecture + mutations).
 *
 * Domaine wallet. Le hook orchestre WalletService ↔ React Query :
 *  - lit l'info wallet (getWalletInfo) avec gating `enabled` ;
 *  - expose 3 mutations (activate / withdraw / payWithWallet) ;
 *  - INVALIDE les bonnes query keys après chaque mutation, pour que l'UI
 *    re-fetche un état frais (la source de vérité reste le backend).
 *
 * Comportement MÉTIER vérifié (pas de tautologie) :
 *  - enabled=false → aucune lecture (on ne tape pas la callable pour un écran
 *    sans utilisateur connecté).
 *  - enabled=true → wallet exposé, isLoading retombe.
 *  - withdraw({attempt, assertCurrent}) transmet l’intention propriétaire immuable en cents et invalide la
 *    clé ['wallet'] → la query d'info est refetchée (2 lectures au total).
 *  - payWithWallet invalide wallet + orders + payments (un achat modifie ces 3
 *    surfaces) — invariant de cohérence cache après paiement.
 *  - une mutation qui échoue (garde serveur) propage l'erreur via mutateAsync
 *    SANS invalider le cache (pas de refetch inutile sur échec).
 *
 * On mocke WalletService pour piloter les retours de façon déterministe.
 * .test.tsx → périmètre Jest (ignoré par Vitest).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

// --- Mock du service data : on contrôle les retours pour exercer le hook. ----
const mockGetWalletInfo = jest.fn();
const mockActivateWallet = jest.fn();
const mockWithdraw = jest.fn();
const mockPayWithWallet = jest.fn();

jest.mock('@/features/wallet/services/walletService', () => ({
  WalletService: {
    getWalletInfo: (...a: unknown[]) => mockGetWalletInfo(...a),
    activateWallet: (...a: unknown[]) => mockActivateWallet(...a),
    withdrawFromWallet: (...a: unknown[]) => mockWithdraw(...a),
    payWithWallet: (...a: unknown[]) => mockPayWithWallet(...a),
  },
}));

import { useWallet } from '@/features/wallet/hooks/useWallet';
import type { WalletInfo } from '@/types';

const withdrawalAttempt: import('@/types/wallet').WithdrawalAttempt = {version: 1, uid: 'u1', requestId: 'withdrawal-attempt-fixture', amountCents: 7000, bankAccountId: 'ba_fixture'};
const assertWithdrawalCurrent = jest.fn();
const ACTIVE_WALLET: WalletInfo = {
  hasWallet: true,
  balance: 12000,
  pendingBalance: 4500,
  heldBalance: 3000,
  heldReleaseAt: '2026-06-10T00:00:00.000Z',
  sellerDebt: 0,
  status: 'active',
  ledger: [],
};

const clients: QueryClient[] = [];

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // Pas de retry/backoff : les tests d'erreur doivent échouer en 1 coup.
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return Wrapper;
}

afterEach(() => {
  cleanup();
  // Mutation caches otherwise retain five-minute GC timers after unmount.
  for (const client of clients) {
    for (const mutation of client.getMutationCache().getAll()) mutation.destroy();
    client.clear();
  }
  clients.length = 0;
});

beforeEach(() => {
  mockGetWalletInfo.mockReset();
  mockActivateWallet.mockReset();
  mockWithdraw.mockReset();
  mockPayWithWallet.mockReset();
  mockGetWalletInfo.mockResolvedValue(ACTIVE_WALLET);
});

describe('useWallet — lecture', () => {
  it('ne lit pas le porte-monnaie quand enabled=false (écran sans utilisateur connecté)', async () => {
    const { result } = renderHook(() => useWallet(false), {
      wrapper: createWrapper(),
    });

    // enabled=false : la query est idle, aucun appel callable.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetWalletInfo).not.toHaveBeenCalled();
    expect(result.current.wallet).toBeNull();
  });

  it('expose les 3 poches une fois la lecture résolue (enabled=true)', async () => {
    const { result } = renderHook(() => useWallet(true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.wallet).not.toBeNull());
    expect(mockGetWalletInfo).toHaveBeenCalledTimes(1);
    expect(result.current.wallet?.balance).toBe(12000);
    expect(result.current.wallet?.pendingBalance).toBe(4500);
    expect(result.current.wallet?.heldBalance).toBe(3000);
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useWallet — withdraw', () => {
  it('retire le MONTANT EN CENTS via le service puis invalide la query info (refetch)', async () => {
    mockWithdraw.mockResolvedValue({ success: true, newBalance: 5000 });

    const { result } = renderHook(() => useWallet(true), {
      wrapper: createWrapper(),
    });

    // 1re lecture initiale.
    await waitFor(() => expect(mockGetWalletInfo).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.withdraw({attempt: withdrawalAttempt, assertCurrent: assertWithdrawalCurrent}); // 70,00 $ en cents
    });

    // Le service reçoit les cents bruts (jamais une conversion en dollars).
    expect(mockWithdraw).toHaveBeenCalledWith(withdrawalAttempt, {assertCurrent: assertWithdrawalCurrent});
    expect(mockWithdraw.mock.calls[0][0].amountCents).toBe(7000);
    expect(mockWithdraw.mock.calls[0][0].requestId).toBe(withdrawalAttempt.requestId);

    // onSuccess invalide ['wallet'] → la query info est refetchée (2e lecture).
    await waitFor(() => expect(mockGetWalletInfo).toHaveBeenCalledTimes(2));
  });

  it('propage l’erreur d’une garde serveur via mutateAsync sans refetch inutile', async () => {
    const err = Object.assign(new Error('Un litige est en cours.'), {
      code: 'functions/failed-precondition',
    });
    mockWithdraw.mockRejectedValue(err);

    const { result } = renderHook(() => useWallet(true), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockGetWalletInfo).toHaveBeenCalledTimes(1));

    await expect(
      act(async () => {
        await result.current.withdraw({attempt: {...withdrawalAttempt, amountCents: 2000}, assertCurrent: assertWithdrawalCurrent});
      }),
    ).rejects.toThrow(/litige/i);

    // Échec → onSuccess ne s'exécute pas → pas de 2e lecture.
    expect(mockGetWalletInfo).toHaveBeenCalledTimes(1);
  });
});

describe('useWallet — payWithWallet', () => {
  it('invalide wallet + orders + payments après un paiement (cohérence cache)', async () => {
    mockPayWithWallet.mockResolvedValue({ success: true, newBalance: 8000 });

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    clients.push(client);
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useWallet(true), { wrapper });
    await waitFor(() => expect(result.current.wallet).not.toBeNull());
    invalidateSpy.mockClear();

    await act(async () => {
      await result.current.payWithWallet('tx_42');
    });

    expect(mockPayWithWallet).toHaveBeenCalledWith('tx_42', {expectedUid: 'u1'});

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      ([arg]) => (arg as { queryKey: unknown[] }).queryKey,
    );
    // Un achat depuis le wallet touche les 3 surfaces de cache.
    expect(invalidatedKeys).toContainEqual(['wallet']);
    expect(invalidatedKeys).toContainEqual(['orders']);
    expect(invalidatedKeys).toContainEqual(['payments']);
  });
});

describe('useWallet — activate', () => {
  it('active le porte-monnaie puis invalide la query info (refetch de l’état activé)', async () => {
    mockActivateWallet.mockResolvedValue({ success: true });
    // Le 1er fetch renvoie un wallet non activé ; après activation, on simule
    // un wallet activé au refetch.
    mockGetWalletInfo
      .mockResolvedValueOnce({
        hasWallet: false,
        balance: 0,
        pendingBalance: 0,
        status: 'inactive',
        ledger: [],
      } as WalletInfo)
      .mockResolvedValue(ACTIVE_WALLET);

    const { result } = renderHook(() => useWallet(true), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.wallet?.hasWallet).toBe(false));

    await act(async () => {
      await result.current.activate();
    });

    expect(mockActivateWallet).toHaveBeenCalledTimes(1);
    // Invalidation → refetch → l'état bascule sur le wallet activé.
    await waitFor(() => expect(result.current.wallet?.hasWallet).toBe(true));
  });
});
