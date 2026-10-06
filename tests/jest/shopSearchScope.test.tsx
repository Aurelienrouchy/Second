import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

let mockParams: Record<string, string> = {};
const mockGetShop = jest.fn();
const mockArticleSearch = jest.fn();
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('@/hooks/useAuth', () => ({ useUser: () => null }));
jest.mock('@/hooks/useCategoryNavigation', () => ({ useCategoryNavigation: () => ({ goToRoot: jest.fn() }) }));
jest.mock('@/services/shopService', () => ({ ShopService: { getShopById: (...args: unknown[]) => mockGetShop(...args) } }));
jest.mock('@/services/searchHistoryService', () => ({ SearchHistoryService: {} }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/hooks/useArticleSearch', () => ({ useArticleSearch: (args: unknown) => mockArticleSearch(args) }));

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
});
