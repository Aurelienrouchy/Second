import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

let mockParams: Record<string, string> = {};
const mockGetShop = jest.fn();
const mockArticleSearch = jest.fn();
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void | (() => void)) => {const ReactRuntime: typeof import('react') = jest.requireActual('react'); ReactRuntime.useEffect(effect, [effect]);} }));
jest.mock('@/store/authStore', () => {const {create} = jest.requireActual('zustand'); return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({}))};});
jest.mock('@/hooks/useAuth', () => ({ useUser: () => null }));
jest.mock('@/hooks/useCategoryNavigation', () => ({ useCategoryNavigation: () => ({ goToRoot: jest.fn() }) }));
jest.mock('@/services/shopService', () => ({ ShopService: { getShopById: (...args: unknown[]) => mockGetShop(...args) } }));
jest.mock('@/features/search/services/searchHistoryService', () => ({ SearchHistoryService: {} }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/features/search/hooks/useArticleSearch', () => ({ useArticleSearch: (args: unknown) => mockArticleSearch(args) }));

import { useSearchScreen } from '@/features/search/hooks/useSearchScreen';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mockGetShop.mockReset(); mockArticleSearch.mockReset();
  mockArticleSearch.mockReturnValue({
    articles: [], filters: {}, searchQuery: '', selectedCategoryPath: [], isLoading: false,
    isPaginating: false, hasNextPage: false, hasActiveFilters: false, isError: false, error: null,
    refetch: jest.fn(), setFilters: jest.fn(), setSearchQuery: jest.fn(), commitSearchQuery: jest.fn(),
    setSelectedCategoryPath: jest.fn(), loadMore: jest.fn(), clearAllFilters: jest.fn(), handleFilterRemove: jest.fn(),
  });
});

describe('shop article search contract', () => {
  it('resolves legacy shop IDs to the owner and pauses the search until lookup completes', async () => {
    mockParams = { shopId: 'shop-document', source: 'shop' };
    mockGetShop.mockResolvedValue({ id: 'shop-document', ownerId: 'owner-user', status: 'approved' });
    const { result } = renderHook(() => useSearchScreen(), { wrapper: wrapper() });
    expect(mockArticleSearch.mock.calls[0][0]).toEqual(expect.objectContaining({ enabled: false, sellerId: undefined }));
    await waitFor(() => expect(mockArticleSearch).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, sellerId: 'owner-user' })));
    expect(mockGetShop).toHaveBeenCalledWith('shop-document');
    expect(result.current.isSearching).toBe(true);
    expect(result.current.availableSortItems.map((s) => s.value)).toEqual(['recent']);
    expect(result.current.getSortLabel()).toBe('Plus récents');
    expect(result.current.getPageTitle()).toBe('Articles de la boutique');
  });

  it('uses explicit seller IDs without a lookup and keeps results open without text filters', () => {
    mockParams = { sellerId: 'owner-user', source: 'shop' };
    const { result } = renderHook(() => useSearchScreen(), { wrapper: wrapper() });
    expect(mockGetShop).not.toHaveBeenCalled();
    expect(mockArticleSearch).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, sellerId: 'owner-user' }));
    expect(result.current.isSearching).toBe(true);
  });

  it('shows unavailable shops as an error and never runs an unscoped search', async () => {
    mockParams = { shopId: 'suspended-shop', query: 'robe' };
    mockGetShop.mockResolvedValue({ ownerId: 'owner-user', status: 'suspended' });
    const { result } = renderHook(() => useSearchScreen(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.searchError).toBe('Cette boutique est indisponible.');
    expect(mockArticleSearch.mock.calls.every(([args]) => args.enabled === false)).toBe(true);
  });

  it('removes the previous category when restoring a recent search without one', () => {
    mockParams = {browse: '1'};
    const api = {...mockArticleSearch.getMockImplementation()!(), selectedCategoryPath: ['femme', 'femme_robes']};
    mockArticleSearch.mockReturnValue(api);
    const {result} = renderHook(() => useSearchScreen(), {wrapper: wrapper()});
    act(() => result.current.handleRecentSearchTap({id: 'recent-1', query: 'veste', filters: {}, timestamp: new Date()}));
    expect(api.setSelectedCategoryPath).toHaveBeenCalledWith([]);
    expect(api.commitSearchQuery).toHaveBeenCalledWith('veste');
  });

  it('keeps a zero maximum price visible as an active filter', () => {
    mockParams = {browse: '1'};
    mockArticleSearch.mockReturnValue({...mockArticleSearch.getMockImplementation()!(), filters: {maxPrice: 0}});
    const {result} = renderHook(() => useSearchScreen(), {wrapper: wrapper()});
    expect(result.current.isPriceActive).toBe(true);
    expect(result.current.getPriceLabel()).toMatch(/^Max 0/);
  });
});
