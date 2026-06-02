import { useInfiniteQuery } from '@tanstack/react-query';
import { QueryDocumentSnapshot } from 'firebase/firestore';
import { useCallback, useMemo, useState } from 'react';

import { useDebounce } from '@/hooks/useDebounce';
import { queryKeys } from '@/lib/queryKeys';
import { ArticlesService } from '@/services/articlesService';
import { Article, ArticleSize, SearchFilters, SortBy } from '@/types';

const SEARCH_DEBOUNCE_MS = 350;
const PAGE_SIZE = 20;
const SEARCH_STALE_TIME = 5 * 60 * 1000;

interface UseArticleSearchArgs {
  initialFilters?: Partial<SearchFilters>;
  initialQuery?: string;
  initialCategoryPath?: string[];
  excludeUserId?: string;
  sellerId?: string;
}

interface SearchPage {
  articles: Article[];
  lastVisible: QueryDocumentSnapshot | null;
  // Provided by ArticlesService.searchArticles (firebase-backend). True when the
  // service has more documents to paginate even if this page filtered out all
  // of its fetched docs client-side (H4). Until the service ships this field,
  // tsc will flag it — that is expected and owned by firebase-backend.
  hasMore: boolean;
}

const DEFAULT_FILTERS: SearchFilters = {
  colors: [],
  sizes: [],
  materials: [],
  condition: undefined,
  minPrice: undefined,
  maxPrice: undefined,
  brands: [],
  sortBy: 'recent',
};

export function useArticleSearch({
  initialFilters,
  initialQuery,
  initialCategoryPath,
  excludeUserId,
  sellerId,
}: UseArticleSearchArgs = {}) {
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery || '');
  const debouncedSearchQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);

  const [selectedCategoryPath, setSelectedCategoryPath] = useState<string[]>(
    initialCategoryPath || []
  );
  const [filters, setFilters] = useState<SearchFilters>({
    ...DEFAULT_FILTERS,
    ...(initialFilters || {}),
  } as SearchFilters);

  const searchFilters = useMemo(
    () => ({
      category: undefined,
      categoryIds:
        selectedCategoryPath.length > 0 ? selectedCategoryPath : undefined,
      colors: filters.colors ?? [],
      sizes: filters.sizes ?? [],
      materials: filters.materials ?? [],
      condition: filters.condition,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      brands: filters.brands ?? [],
      sortBy: filters.sortBy as SortBy | undefined,
      excludeUserId,
      sellerId,
    }),
    [filters, selectedCategoryPath, excludeUserId, sellerId]
  );

  const queryKey = useMemo(
    () =>
      queryKeys.articles.search({
        query: debouncedSearchQuery.trim(),
        categoryPath: selectedCategoryPath,
        filters: searchFilters as unknown as Record<string, unknown>,
        excludeUserId,
        sellerId,
      }),
    [debouncedSearchQuery, selectedCategoryPath, searchFilters, excludeUserId, sellerId]
  );

  const hasNonDefaultFilters = useMemo(
    () =>
      (filters.colors?.length ?? 0) > 0 ||
      (filters.sizes?.length ?? 0) > 0 ||
      (filters.materials?.length ?? 0) > 0 ||
      (filters.brands?.length ?? 0) > 0 ||
      !!filters.condition ||
      filters.minPrice !== undefined ||
      filters.maxPrice !== undefined ||
      (!!filters.sortBy && filters.sortBy !== 'recent'),
    [filters]
  );

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error: queryError,
    refetch,
  } = useInfiniteQuery<SearchPage, Error>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as QueryDocumentSnapshot | undefined;
      const result = await ArticlesService.searchArticles(
        debouncedSearchQuery.trim() || undefined,
        searchFilters,
        PAGE_SIZE,
        cursor
      );
      return {
        articles: result.articles,
        lastVisible: result.lastVisible,
        // firebase-backend: SearchPage gains `hasMore`. Referenced intentionally.
        hasMore: result.hasMore,
      };
    },
    initialPageParam: undefined as QueryDocumentSnapshot | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.lastVisible ? lastPage.lastVisible : undefined,
    staleTime: SEARCH_STALE_TIME,
    retry: 3,
    enabled: Boolean(
      debouncedSearchQuery.trim() ||
      selectedCategoryPath.length > 0 ||
      hasNonDefaultFilters ||
      sellerId
    ),
  });

  const articles = useMemo(() => {
    if (!data?.pages) return [];
    const flat = data.pages.flatMap((page) => page.articles);
    const transformed = transformArticlesWithLocation(flat, center);
    // Only re-sort client-side when geolocation center is provided (distance sort)
    // Otherwise the service already sorted the results
    if (center) {
      return sortArticles(transformed, filters.sortBy, center);
    }
    return transformed;
  }, [data, center, filters.sortBy]);

  const loadMore = useCallback(() => {
    if (!isFetchingNextPage && hasNextPage) {
      fetchNextPage();
    }
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  const hasActiveFilters = useMemo(
    () =>
      (filters.colors?.length ?? 0) > 0 ||
      (filters.sizes?.length ?? 0) > 0 ||
      (filters.materials?.length ?? 0) > 0 ||
      (filters.brands?.length ?? 0) > 0 ||
      !!filters.condition ||
      filters.minPrice !== undefined ||
      filters.maxPrice !== undefined ||
      (!!filters.sortBy && filters.sortBy !== 'recent') ||
      selectedCategoryPath.length > 0,
    [filters, selectedCategoryPath]
  );

  const setFiltersSafe = useCallback((partial: Partial<SearchFilters>) => {
    setFilters({
      colors: partial.colors ?? [],
      sizes: partial.sizes ?? [],
      materials: partial.materials ?? [],
      condition: partial.condition,
      minPrice: partial.minPrice,
      maxPrice: partial.maxPrice,
      brands: partial.brands ?? [],
      sortBy: partial.sortBy ?? 'recent',
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
  }, []);

  /**
   * Remove a filter dimension. For multi-value dimensions (colors/sizes/
   * materials/brands), passing a `value` removes just that entry; omitting it
   * clears the whole dimension (chip-level remove). Sizes are matched on
   * value+system so US/EU never collide.
   */
  const handleFilterRemove = useCallback(
    (filterType: keyof SearchFilters, value?: string | ArticleSize) => {
      if (filterType === 'colors') {
        setFilters((prev) => ({
          ...prev,
          colors:
            typeof value === 'string'
              ? (prev.colors ?? []).filter((c) => c !== value)
              : [],
        }));
      } else if (filterType === 'sizes') {
        setFilters((prev) => ({
          ...prev,
          sizes:
            value && typeof value === 'object'
              ? (prev.sizes ?? []).filter(
                  (s) => !(s.value === value.value && s.system === value.system)
                )
              : [],
        }));
      } else if (filterType === 'materials') {
        setFilters((prev) => ({
          ...prev,
          materials:
            typeof value === 'string'
              ? (prev.materials ?? []).filter((m) => m !== value)
              : [],
        }));
      } else if (filterType === 'brands') {
        setFilters((prev) => ({
          ...prev,
          brands:
            typeof value === 'string'
              ? (prev.brands ?? []).filter((b) => b !== value)
              : [],
        }));
      } else if (filterType === 'condition') {
        setFilters((prev) => ({ ...prev, condition: undefined }));
      } else if (filterType === 'minPrice') {
        setFilters((prev) => ({ ...prev, minPrice: undefined }));
      } else if (filterType === 'maxPrice') {
        setFilters((prev) => ({ ...prev, maxPrice: undefined }));
      }
    },
    []
  );

  return {
    articles,
    filters,
    searchQuery,
    selectedCategoryPath,
    isLoading,
    isPaginating: isFetchingNextPage,
    hasNextPage: !!hasNextPage,
    hasActiveFilters,
    error: queryError ? queryError.message : null,
    isError: !!queryError,
    refetch,
    setFilters: setFiltersSafe,
    setSearchQuery,
    setSelectedCategoryPath,
    loadMore,
    clearAllFilters,
    handleFilterRemove,
  };
}

export type UseArticleSearchReturn = ReturnType<typeof useArticleSearch>;

export const useUserLocation = () => {
  const [location, setLocation] = useState<GeolocationCenter | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  return { location, locationError };
};
