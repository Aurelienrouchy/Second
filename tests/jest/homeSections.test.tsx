/**
 * Home / feed sections — hooks de données (recherche-decouverte).
 *
 * Couvre le comportement MÉTIER des hooks qui alimentent les rails de la home :
 *  - useTrendingBrands : appelle la callable getTrendingBrands et expose les
 *    marques tendances (data du résultat callable).
 *  - useDiscoverArticles : infinite query sur getNewArrivals, pagination par
 *    curseur (lastDocId) — la page suivante n'est dispo que si un curseur est
 *    renvoyé, et les pages s'enchaînent.
 *
 * On vérifie aussi le contrat de clés de cache (homeKeys) utilisé par les
 * invalidations ciblées.
 *
 * Vit dans tests/jest/ → ramassé par Jest, ignoré par Vitest (pas de collision).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

// httpsCallable renvoie une fonction unique mockée que chaque test pilote.
const mockCallable = jest.fn();
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => mockCallable),
}));
jest.mock('@/config/firebaseConfig', () => ({ functions: {} }));

import { useTrendingBrands } from '@/features/home/trending-brands/useTrendingBrands';
import { useDiscoverArticles } from '@/features/home/discover/useDiscoverArticles';
import { homeKeys } from '@/features/home/query-keys';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe('useTrendingBrands', () => {
  beforeEach(() => mockCallable.mockReset());

  it('expose les marques tendances renvoyées par la callable', async () => {
    mockCallable.mockResolvedValueOnce({
      data: [
        { name: 'Sézane', articleCount: 42 },
        { name: 'Levi’s', articleCount: 30 },
      ],
    });

    const { result } = renderHook(() => useTrendingBrands(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]).toEqual({ name: 'Sézane', articleCount: 42 });
  });

  it('expose l’état d’erreur quand la callable échoue', async () => {
    mockCallable.mockRejectedValueOnce(new Error('CF down'));

    const { result } = renderHook(() => useTrendingBrands(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useDiscoverArticles', () => {
  beforeEach(() => mockCallable.mockReset());

  it('charge la 1re page et signale une page suivante quand un curseur est renvoyé', async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        articles: [{ id: 'd1' }, { id: 'd2' }],
        lastDocId: 'cursor-1',
      },
    });

    const { result } = renderHook(() => useDiscoverArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0].articles).toHaveLength(2);
    // lastDocId présent → il y a une page suivante.
    expect(result.current.hasNextPage).toBe(true);
  });

  it('n’a pas de page suivante quand lastDocId est null (fin de liste)', async () => {
    mockCallable.mockResolvedValueOnce({
      data: { articles: [{ id: 'd1' }], lastDocId: null },
    });

    const { result } = renderHook(() => useDiscoverArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('enchaîne les pages : fetchNextPage passe le curseur précédent', async () => {
    mockCallable
      .mockResolvedValueOnce({
        data: { articles: [{ id: 'd1' }], lastDocId: 'cursor-1' },
      })
      .mockResolvedValueOnce({
        data: { articles: [{ id: 'd2' }], lastDocId: null },
      });

    const { result } = renderHook(() => useDiscoverArticles(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    // Le 2e appel callable reçoit le curseur de la 1re page.
    const secondArgs = mockCallable.mock.calls[1][0] as { lastDocId: string };
    expect(secondArgs.lastDocId).toBe('cursor-1');
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe('homeKeys — clés de cache des sections', () => {
  it('produit des clés scopées par section pour des invalidations ciblées', () => {
    expect(homeKeys.trendingBrands()).toEqual(['home', 'trending-brands']);
    expect(homeKeys.discover()).toEqual(['home', 'discover']);
    // Toutes les sections partagent la racine 'home' (invalidation globale).
    expect(homeKeys.newArrivals()[0]).toBe('home');
    // Les clés paramétrées incluent leur identifiant.
    expect(homeKeys.swapZoneItems('party-9')).toEqual([
      'home',
      'swap-zone-items',
      'party-9',
    ]);
  });
});
