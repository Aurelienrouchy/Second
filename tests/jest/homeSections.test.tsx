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
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import type { SwapPartyItem } from '@/types';
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

const clients: QueryClient[] = [];

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

afterEach(() => {
  // Trending brands set their own 24h gcTime. Dispose the fixture cache
  // after unmount rather than altering the production cache or forcing exit.
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
});

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


const mockRecentPartyItems = jest.fn();
jest.mock('@/services/swapService', () => ({ getRecentPartyItems: (...args: unknown[]) => mockRecentPartyItems(...args) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
import { SwapZoneSection } from '@/components/home/SwapZoneSection';
import { SwapZoneWrapper } from '@/features/home/swap-zone/SwapZoneSection';

const previewItem: SwapPartyItem = {
  id: 'preview', partyId: 'generalist', articleId: 'a1', sellerId: 'seller', sellerName: 'Alice',
  title: 'Veste', price: 35, imageUrl: 'https://example.test/veste.jpg', isSwapped: false, addedAt: new Date(),
};

describe('Home — Espace échanges', () => {
  beforeEach(() => { mockCallable.mockReset(); mockRecentPartyItems.mockReset(); });
  it('affiche le stock total et les vraies photos sans inventer de nouveautés globales', () => {
    const onPress = jest.fn();
    const { UNSAFE_getAllByType } = render(<SwapZoneSection zone={{ id: 'generalist', name: 'Swap Zone', itemsCount: 28 }} items={[previewItem]} newThisWeek={6} onPress={onPress} />);
    expect(screen.getByText('Espace échanges')).toBeOnTheScreen();
    expect(screen.getByText('28 articles à échanger')).toBeOnTheScreen();
    expect(screen.queryByText(/nouveautés|cette semaine/)).toBeNull();
    expect(UNSAFE_getAllByType(Image)[0].props.source).toEqual({ uri: previewItem.imageUrl });
    fireEvent.press(screen.getByText('Découvrir les articles'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('différencie absence d’espace, erreur et chargement', () => {
    const retry = jest.fn();
    const { rerender } = render(<SwapZoneSection />);
    expect(screen.getByText('Aucun espace disponible pour le moment')).toBeOnTheScreen();
    expect(screen.queryByText('Découvrir les articles')).toBeNull();
    rerender(<SwapZoneSection isError onRetry={retry} />);
    expect(screen.getByText('Le catalogue n’a pas pu être chargé')).toBeOnTheScreen();
    expect(screen.queryByText('Bientôt disponible')).toBeNull();
    fireEvent.press(screen.getByText('Réessayer'));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<SwapZoneSection isLoading />);
    expect(screen.getByLabelText('Chargement de l’Espace échanges')).toBeOnTheScreen();
    expect(screen.queryByText('Réessayer')).toBeNull();
  });
  it('garde l’entrée du catalogue ouvert quand le stock est vide ou les aperçus échouent', () => {
    const press = jest.fn();
    const { rerender } = render(<SwapZoneSection zone={{ id: 'generalist', name: 'Swap Zone', itemsCount: 0 }} onPress={press} />);
    expect(screen.getByText('Aucun article à échanger pour le moment. Vous pouvez déjà ajouter les vôtres.')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Découvrir les articles'));
    expect(press).toHaveBeenCalledTimes(1);
    rerender(<SwapZoneSection zone={{ id: 'generalist', name: 'Swap Zone', itemsCount: 28 }} previewsError onPress={press} />);
    expect(screen.getByText('Les aperçus ne sont pas disponibles. Vous pouvez ouvrir le catalogue.')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Découvrir les articles'));
    expect(press).toHaveBeenCalledTimes(2);
  });
  it('le wrapper transmet les photos du hook et navigue vers la route existante', async () => {
    mockCallable.mockResolvedValueOnce({ data: { hasActiveParty: true, party: { id: 'generalist', name: 'Swap Zone', itemsCount: 28 } } });
    mockRecentPartyItems.mockResolvedValueOnce([previewItem]);
    const { UNSAFE_getAllByType } = render(<SwapZoneWrapper />, { wrapper: createWrapper() });
    await waitFor(() => expect(UNSAFE_getAllByType(Image)).toHaveLength(1));
    expect(mockRecentPartyItems).toHaveBeenCalledWith('generalist', 6);
    expect(screen.getByText('28 articles à échanger')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Découvrir les articles'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/swap-zone', params: { source: 'home' } });
  });
  it('le wrapper expose une erreur de chargement et permet une nouvelle tentative', async () => {
    mockCallable.mockRejectedValueOnce(new Error('offline'));
    render(<SwapZoneWrapper />, { wrapper: createWrapper() });
    await waitFor(() => expect(screen.getByText('Le catalogue n’a pas pu être chargé')).toBeOnTheScreen());
    mockCallable.mockResolvedValueOnce({ data: { hasActiveParty: false, party: null } });
    fireEvent.press(screen.getByText('Réessayer'));
    await waitFor(() => expect(screen.getByText('Aucun espace disponible pour le moment')).toBeOnTheScreen());
    expect(mockCallable).toHaveBeenCalledTimes(2);
  });
});
