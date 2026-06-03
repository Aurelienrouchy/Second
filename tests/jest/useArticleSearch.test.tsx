/**
 * useArticleSearch — recherche d'articles (texte + filtres + pagination).
 *
 * Domaine : recherche-decouverte. Ce hook orchestre le state de recherche
 * (terme, filtres taille {value,system}, catégorie), le debounce vs commit
 * immédiat, et l'infinite query React Query qui appelle
 * ArticlesService.searchArticles.
 *
 * On vérifie le COMPORTEMENT MÉTIER, pas l'implémentation :
 *  - gating `enabled` : pas de requête tant qu'il n'y a ni terme, ni filtre,
 *    ni catégorie (sinon on taperait Firestore pour rien).
 *  - debounce : taper un terme ne déclenche la requête qu'après 350 ms ;
 *    commitSearchQuery (OK/Enter) bypasse le debounce.
 *  - hasActiveFilters reflète l'état réel des filtres + catégorie.
 *  - handleFilterRemove respecte la sémantique taille value+system (US ≠ EU)
 *    et le clear par dimension.
 *  - clearAllFilters remet tout à l'état neutre (et coupe la requête).
 *  - agrégation : les pages successives sont aplaties en une liste unique.
 *
 * Vit dans tests/jest/ → ramassé par Jest, ignoré par Vitest (pas de collision).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

// --- Mock du service data (firebase-backend) : on contrôle ce que renvoie
//     searchArticles pour exercer le comportement du hook côté client.
//     Le préfixe `mock` est requis par Jest (hoisting de jest.mock). ---------
const mockSearchArticles = jest.fn();
jest.mock('@/services/articlesService', () => ({
  ArticlesService: {
    searchArticles: (...args: unknown[]) => mockSearchArticles(...args),
  },
}));

import { useArticleSearch } from '@/hooks/useArticleSearch';
import type { ArticleSize } from '@/types';

function makeArticle(id: string) {
  return { id, title: `Article ${id}`, price: 10 } as unknown;
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // Le hook fixe `retry: 3` au niveau de la query (priorité sur le client),
      // mais retryDelay n'y est pas défini → on le neutralise ici pour que les
      // 3 tentatives s'enchaînent sans backoff (test d'erreur déterministe).
      queries: { gcTime: 0, retryDelay: 0 },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return Wrapper;
}

describe('useArticleSearch', () => {
  beforeEach(() => {
    mockSearchArticles.mockReset();
    mockSearchArticles.mockResolvedValue({
      articles: [makeArticle('a1'), makeArticle('a2')],
      lastVisible: null,
      hasMore: false,
    });
  });

  it('ne lance aucune requête quand il n’y a ni terme, ni filtre, ni catégorie', async () => {
    const { result } = renderHook(() => useArticleSearch(), {
      wrapper: createWrapper(),
    });

    // Laisse le temps à une éventuelle requête de partir.
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSearchArticles).not.toHaveBeenCalled();
    expect(result.current.articles).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('lance la requête immédiatement quand commitSearchQuery est appelé (bypass debounce)', async () => {
    const { result } = renderHook(() => useArticleSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.commitSearchQuery('robe');
    });

    await waitFor(() => expect(mockSearchArticles).toHaveBeenCalled());

    // Le terme trimmé est bien passé au service.
    expect(mockSearchArticles.mock.calls[0][0]).toBe('robe');
    await waitFor(() =>
      expect(result.current.articles.map((a) => a.id)).toEqual(['a1', 'a2'])
    );
  });

  it('debounce la frappe : setSearchQuery ne déclenche pas immédiatement la requête', async () => {
    jest.useFakeTimers();
    try {
      const { result } = renderHook(() => useArticleSearch(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setSearchQuery('rob');
      });

      // Avant l'échéance du debounce (350 ms) : aucune requête.
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(mockSearchArticles).not.toHaveBeenCalled();

      // Après l'échéance : la requête part avec le terme débounced.
      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(mockSearchArticles).toHaveBeenCalledTimes(1);
      expect(mockSearchArticles.mock.calls[0][0]).toBe('rob');
    } finally {
      jest.useRealTimers();
    }
  });

  it('expose une catégorie sélectionnée comme filtre actif et déclenche la requête', async () => {
    const { result } = renderHook(() => useArticleSearch(), {
      wrapper: createWrapper(),
    });

    expect(result.current.hasActiveFilters).toBe(false);

    act(() => {
      result.current.setSelectedCategoryPath(['femme', 'femme_robes']);
    });

    await waitFor(() => expect(result.current.hasActiveFilters).toBe(true));
    await waitFor(() => expect(mockSearchArticles).toHaveBeenCalled());

    // La catégorie est transmise via le 2e argument (searchFilters.categoryIds).
    const filtersArg = mockSearchArticles.mock.calls[0][1] as {
      categoryIds?: string[];
    };
    expect(filtersArg.categoryIds).toEqual(['femme', 'femme_robes']);
  });

  it('retire une taille en respectant value+system (US 38 ≠ EU 38)', async () => {
    const us38: ArticleSize = { value: '38', system: 'US' };
    const eu38: ArticleSize = { value: '38', system: 'EU' };

    const { result } = renderHook(
      () => useArticleSearch({ initialFilters: { sizes: [us38, eu38] } }),
      { wrapper: createWrapper() }
    );

    expect(result.current.filters.sizes).toHaveLength(2);

    // Retirer la taille US 38 : la EU 38 doit rester (pas de collision).
    act(() => {
      result.current.handleFilterRemove('sizes', us38);
    });

    expect(result.current.filters.sizes).toEqual([eu38]);
  });

  it('retire toute une dimension quand handleFilterRemove est appelé sans valeur', async () => {
    const { result } = renderHook(
      () =>
        useArticleSearch({
          initialFilters: { colors: ['noir', 'blanc'], brands: ['Nike'] },
        }),
      { wrapper: createWrapper() }
    );

    expect(result.current.filters.colors).toEqual(['noir', 'blanc']);

    act(() => {
      result.current.handleFilterRemove('colors');
    });

    expect(result.current.filters.colors).toEqual([]);
    // Les autres dimensions ne sont pas touchées.
    expect(result.current.filters.brands).toEqual(['Nike']);
  });

  it('clearAllFilters remet les filtres à neutre et coupe la requête', async () => {
    const { result } = renderHook(
      () =>
        useArticleSearch({
          initialFilters: { colors: ['noir'], minPrice: 10, sortBy: 'price_asc' },
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.hasActiveFilters).toBe(true));

    act(() => {
      result.current.clearAllFilters();
    });

    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.filters.colors).toEqual([]);
    expect(result.current.filters.minPrice).toBeUndefined();
    expect(result.current.filters.sortBy).toBe('recent');
  });

  it('agrège les pages successives en une seule liste d’articles', async () => {
    // 1re page : pleine + curseur → hasMore true. 2e page : terminale.
    mockSearchArticles
      .mockResolvedValueOnce({
        articles: [makeArticle('p1a'), makeArticle('p1b')],
        lastVisible: { id: 'cursor1' },
        hasMore: true,
      })
      .mockResolvedValueOnce({
        articles: [makeArticle('p2a')],
        lastVisible: null,
        hasMore: false,
      });

    const { result } = renderHook(() => useArticleSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.commitSearchQuery('jean');
    });

    await waitFor(() =>
      expect(result.current.articles.map((a) => a.id)).toEqual(['p1a', 'p1b'])
    );
    expect(result.current.hasNextPage).toBe(true);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() =>
      expect(result.current.articles.map((a) => a.id)).toEqual([
        'p1a',
        'p1b',
        'p2a',
      ])
    );
    expect(result.current.hasNextPage).toBe(false);
  });

  it('expose le message d’erreur quand le service échoue', async () => {
    mockSearchArticles.mockRejectedValue(new Error('Firestore indisponible'));

    const { result } = renderHook(() => useArticleSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.commitSearchQuery('manteau');
    });

    // Le hook configure `retry: 3` ; retryDelay neutralisé dans le wrapper →
    // les 4 tentatives s'enchaînent sans attente avant que l'erreur remonte.
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.error).toBe('Firestore indisponible');
    expect(result.current.articles).toEqual([]);
  });
});
